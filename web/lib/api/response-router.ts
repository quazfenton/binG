/**
 * Response Router - Consolidated Response Handling & Request Routing
 * 
 * Merges:
 * - lib/tools/unified-response-handler.ts (response formatting, tool extraction)
 * - lib/api/priority-request-router.ts (priority-based routing, circuit breaker)
 * 
 * Provides unified interface for:
 * - Request routing through priority chain
 * - Response formatting and normalization
 * - Tool invocation extraction
 * - Circuit breaker protection
 * - Quota management
 * - Streaming event generation
 * 
 * @example
 * ```typescript
 * import { responseRouter } from '@/lib/api/response-router'
 * 
 * const result = await responseRouter.routeAndFormat({
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   userId: 'user_123',
 *   enableTools: true,
 * })
 * 
 * // result contains unified response with tool invocations, commands, etc.
 * ```
 */

import { createLogger } from '@/lib/utils/logger'
import { chatLogger } from '@/lib/chat/chat-logger'
import { normalizeToolInvocations, type ToolInvocation } from '@/lib/types/tool-invocation'
import { quotaManager } from '@/lib/management/quota-manager'
import { detectRequestType } from '@/lib/utils/request-type-detector'
import {
  extractFsActionWrites,
  extractReasoningContent,
  parseStructuredPathList,
} from '@/lib/chat/file-edit-parser'

// Import router services
import { fastAgentService, type FastAgentRequest, type FastAgentResponse } from '@/lib/chat/fast-agent-service'
import { n8nAgentService, type N8nAgentRequest, type N8nAgentResponse } from '@/lib/chat/n8n-agent-service'
import { customFallbackService, type CustomFallbackRequest, type CustomFallbackResponse } from '@/lib/chat/custom-fallback-service'
import { enhancedLLMService, type EnhancedLLMRequest } from '@/lib/chat/enhanced-llm-service'
import { initializeComposioService, getComposioService, type ComposioToolRequest } from '@/lib/integrations/composio-service'

// Import tools
import { getToolManager, getUnifiedToolRegistry, getToolDiscoveryService, getToolErrorHandler } from '@/lib/tools'
import { toolAuthManager } from '@/lib/tools/tool-authorization-manager'
import { sandboxBridge } from '@/lib/sandbox'

// Import state for session management
import { sessionManager } from '@/lib/session/session-manager'

// Import V2 gateway client for containerized OpenCode
import {
  submitJobToGateway,
  submitJobToRedisQueue,
  waitForJobCompletion,
  checkGatewayHealth,
  type V2JobRequest,
} from './v2-gateway-client'

// Import telemetry for observability
import {
  startSpan,
  recordRequest,
  recordEndpointUsage,
  recordCircuitBreakerState,
  recordV2JobSubmission,
  recordV2JobCompletion,
  recordQuotaUsage,
  recordToolExecution,
} from './response-router-telemetry'

const logger = createLogger('API:ResponseRouter')

// ============================================================================
// Type Definitions
// ============================================================================

export type LLMMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface LLMMessage {
  role: LLMMessageRole
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>
  toolCalls?: Array<{
    id: string
    name: string
    arguments: Record<string, any>
  }>
  toolResults?: Array<{
    toolCallId: string
    result: any
  }>
}

export interface RouterRequest {
  messages: LLMMessage[]
  provider: string
  model: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  apiKeys?: Record<string, string>
  requestId?: string
  userId?: string
  enableTools?: boolean
  enableSandbox?: boolean
  enableComposio?: boolean
  conversationId?: string
  /** When true, the Vercel AI SDK handles tool calling natively — skip regex intent parsing */
  nativeToolCalling?: boolean
  /** Spec amplification mode: 'normal' (disabled), 'enhanced', or 'max' */
  mode?: 'normal' | 'enhanced' | 'max'
}

export interface RouterResponse {
  success: boolean
  content?: string
  stream?: AsyncGenerator<any> // For real-time streaming responses
  data?: any
  source: string
  priority: number
  fallbackChain?: string[]
  metadata?: Record<string, any>
}

export interface UnifiedResponse {
  success: boolean
  content: string
  stream?: AsyncGenerator<any> // For real-time streaming responses
  source: string
  priority: number
  data: {
    content: string
    usage?: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
    }
    model?: string
    provider?: string
    toolCalls?: any[]
    toolInvocations?: ToolInvocation[]
    files?: any[]
    reasoning?: string
    chainedAgents?: string[]
    qualityScore?: number
    processingSteps?: any[]
    reflectionResults?: any[]
    multiModalContent?: any[]
    iterations?: number
    classifications?: Record<string, any>
    optimizations?: Record<string, any>
    isFallback?: boolean
    fallbackReason?: string
    requiresAuth?: boolean
    authUrl?: string
    toolName?: string
    authProvider?: string
    composioMcp?: {
      url?: string
      headers?: Record<string, string>
    }
    messageMetadata?: Record<string, any>
  }
  commands?: {
    request_files?: string[]
    write_diffs?: Array<{ path: string; diff: string }>
  }
  metadata?: {
    duration?: number
    routedThrough?: string
    fallbackChain?: string[]
    triedEndpoints?: number
    actualProvider?: string
    actualModel?: string
    messageMetadata?: Record<string, any>
    timestamp: string
    streaming?: boolean // For real-time streaming responses
    specAmplification?: {
      enabled: boolean
      mode: 'normal' | 'enhanced' | 'max'
      fastModel: string
      sectionsGenerated: number
      refinementIterations: number
      duration: number
      timedOut: boolean
      specScore: number
    }
  }
}

// Endpoint statistics
interface EndpointStats {
  successes: number
  failures: number
  lastSuccessTime: number
  lastFailureTime: number
}

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

type CircuitState = 'closed' | 'open' | 'half-open'

interface CircuitBreakerConfig {
  failureThreshold: number
  recoveryTimeoutMs: number
  failureWindowMs: number
}

interface CircuitBreakerState {
  state: CircuitState
  failures: number
  successes: number
  lastFailureTime: number
  lastSuccessTime: number
  failureTimestamps: number[]
}

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 12,
  recoveryTimeoutMs: 15000,  // 15s — recover quickly
  failureWindowMs: 120000,   // 2 min window — old failures expire
}

/**
 * Smart per-endpoint circuit breaker.
 *
 * Key differences from naive implementation:
 * - Failures decay over time (failureWindowMs) so transient bursts don't accumulate
 * - Rate-limit errors (429) count less than hard failures (weighted scoring)
 * - NEVER blocks the 'original-system' endpoint — it's the last-resort fallback
 * - If ALL endpoints would be blocked, forces the least-failed one back to closed
 * - Higher thresholds (12 vs old 5) because different providers share the router
 */
class CircuitBreaker {
  private states = new Map<string, CircuitBreakerState>()
  private readonly config: CircuitBreakerConfig

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config }
  }

  private getState(endpoint: string): CircuitBreakerState {
    if (!this.states.has(endpoint)) {
      this.states.set(endpoint, {
        state: 'closed',
        failures: 0,
        successes: 0,
        lastFailureTime: 0,
        lastSuccessTime: 0,
        failureTimestamps: [],
      })
    }
    return this.states.get(endpoint)!
  }

  shouldSkip(endpoint: string): boolean {
    // SAFETY: Never skip original-system — it's the last-resort LLM route
    if (endpoint === 'original-system') {
      return false
    }

    const state = this.getState(endpoint)
    const now = Date.now()

    if (state.state === 'closed') {
      return false
    }

    if (state.state === 'open') {
      if (now - state.lastFailureTime >= this.config.recoveryTimeoutMs) {
        state.state = 'half-open'
        console.log(`[CircuitBreaker] ${endpoint}: half-open — allowing probe request`)
        return false
      }
      return true
    }

    // half-open: allow one test request then block additional concurrent ones
    if (state.state === 'half-open') {
      return true
    }

    return false
  }

  recordSuccess(endpoint: string): void {
    const state = this.getState(endpoint)
    state.successes++
    state.lastSuccessTime = Date.now()
    // A success clears all failure history — the provider is working
    state.failures = 0
    state.failureTimestamps = []

    if (state.state === 'half-open' || state.state === 'open') {
      state.state = 'closed'
      console.log(`[CircuitBreaker] ${endpoint}: closed (recovered)`)
    }
  }

  recordFailure(endpoint: string, error?: any): void {
    const state = this.getState(endpoint)
    const now = Date.now()

    // Classify the error — rate-limits are less severe
    const isRateLimit = error?.status === 429 ||
      (error?.message || '').toLowerCase().includes('rate limit') ||
      (error?.message || '').toLowerCase().includes('quota')
    const isTransient = [502, 503, 504].includes(error?.status) ||
      (error?.message || '').toLowerCase().includes('overloaded')

    // Rate-limits and transient errors add fewer "virtual" failure timestamps
    // A single rate-limit adds 0 extra timestamps (just 1 real one)
    // A hard failure adds 2 timestamps (counts triple towards threshold)
    const weight = isRateLimit ? 1 : isTransient ? 1 : 2

    state.failures++
    state.lastFailureTime = now

    for (let i = 0; i < weight; i++) {
      state.failureTimestamps.push(now)
    }

    // Prune timestamps outside the window
    state.failureTimestamps = state.failureTimestamps.filter(
      t => t > now - this.config.failureWindowMs,
    )

    if (state.failureTimestamps.length >= this.config.failureThreshold) {
      state.state = 'open'
      console.log(
        `[CircuitBreaker] ${endpoint}: OPEN (${state.failureTimestamps.length}/${this.config.failureThreshold} weighted failures in window)`,
      )

      // SAFETY: check if this leaves zero available endpoints
      this.enforceLastRouteSafety()
    }
  }

  /**
   * If ALL endpoints are open, force the one with the fewest recent failures
   * back to closed. We NEVER fully block all LLM routes.
   */
  private enforceLastRouteSafety(): void {
    if (this.states.size === 0) return

    const allOpen = Array.from(this.states.values()).every(s => s.state === 'open')
    if (!allOpen) return

    // Find endpoint with fewest recent failures
    let bestEndpoint: string | null = null
    let bestFailures = Infinity

    for (const [ep, s] of this.states) {
      if (s.failureTimestamps.length < bestFailures) {
        bestFailures = s.failureTimestamps.length
        bestEndpoint = ep
      }
    }

    if (bestEndpoint) {
      this.reset(bestEndpoint)
      console.warn(
        `[CircuitBreaker] SAFETY: All endpoints OPEN — forced ${bestEndpoint} back to CLOSED`,
      )
    }
  }

  getStats(endpoint: string): {
    state: CircuitState
    failures: number
    successes: number
    failureRate: number
    recentFailures: number
  } {
    const state = this.getState(endpoint)
    const total = state.failures + state.successes
    const now = Date.now()
    const recentFailures = state.failureTimestamps.filter(
      t => t > now - this.config.failureWindowMs,
    ).length

    return {
      state: state.state,
      failures: state.failures,
      successes: state.successes,
      failureRate: total > 0 ? state.failures / total : 0,
      recentFailures,
    }
  }

  reset(endpoint: string): void {
    this.states.set(endpoint, {
      state: 'closed',
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      failureTimestamps: [],
    })
  }

  getAllStates(): Map<string, CircuitBreakerState> {
    return new Map(this.states)
  }
}

// ============================================================================
// Response Router Class
// ============================================================================

export class ResponseRouter {
  private circuitBreaker: CircuitBreaker
  private composioService: ReturnType<typeof initializeComposioService> | null
  private endpointStats: Map<string, EndpointStats>

  constructor() {
    this.circuitBreaker = new CircuitBreaker()
    this.composioService = initializeComposioService()
    this.endpointStats = new Map()
  }

  /**
   * Update endpoint statistics
   */
  private updateStats(endpoint: string, success: boolean): void {
    const stats = this.endpointStats.get(endpoint) || {
      successes: 0,
      failures: 0,
      lastSuccessTime: 0,
      lastFailureTime: 0,
    }

    if (success) {
      stats.successes++
      stats.lastSuccessTime = Date.now()
    } else {
      stats.failures++
      stats.lastFailureTime = Date.now()
    }

    this.endpointStats.set(endpoint, stats)
  }

  /**
   * Get endpoint statistics
   */
  getEndpointStats(endpoint: string): EndpointStats | undefined {
    return this.endpointStats.get(endpoint)
  }

  /**
   * Get all endpoint statistics
   */
  getAllEndpointStats(): Map<string, EndpointStats> {
    return new Map(this.endpointStats)
  }

  /**
   * Route request through priority chain and format response
   */
  async routeAndFormat(request: RouterRequest): Promise<UnifiedResponse> {
    const startTime = Date.now()
    const requestId = request.requestId || `req_${Date.now()}`

    // Start trace span
    const span = startSpan('responseRouter.routeAndFormat', {
      requestId,
      userId: request.userId,
      provider: request.provider,
      model: request.model,
    })

    try {
      // Route request
      const routerResponse = await this.routeRequest(request, span)

      // NEW: Handle streaming responses (return stream generator for real-time parsing)
      if (routerResponse.stream && typeof routerResponse.stream === 'object' && Symbol.asyncIterator in routerResponse.stream) {
        // This is a streaming response - return it with the stream generator
        // The caller will consume chunks as they arrive
        // IMPORTANT: Preserve existing content for fallback standard streaming path
        // (in case caller doesn't use the stream generator)
        return {
          success: true,
          content: routerResponse.content || '', // Preserve content for standard streaming fallback
          stream: routerResponse.stream, // Pass through the async generator
          data: {
            ...routerResponse.data,
            streaming: true,
          },
          source: routerResponse.source,
          priority: routerResponse.priority,
          metadata: {
            streaming: true,
            timestamp: new Date().toISOString(),
          },
        }
      }

      // Format response (non-streaming path)
      const unifiedResponse = this.formatResponse(routerResponse, requestId)

      // Record metrics
      const duration = Date.now() - startTime
      recordRequest(duration, unifiedResponse.success)
      span.setAttribute('response.duration_ms', duration)
      span.setAttribute('response.success', unifiedResponse.success)

      // Add timing metadata
      unifiedResponse.metadata.duration = duration

      span.end()
      return unifiedResponse
    } catch (error: any) {
      logger.error('Request routing failed:', error.message)
      span.recordError(error)
      span.end()

      const duration = Date.now() - startTime
      recordRequest(duration, false)

      return {
        success: false,
        content: error.message || 'Request failed',
        source: 'error',
        priority: 999,
        data: {
          content: error.message || 'Request failed',
        },
        metadata: {
          duration,
          timestamp: new Date().toISOString(),
        },
      }
    }
  }

  /**
   * Route request through priority chain
   */
  private async routeRequest(request: RouterRequest, span?: any): Promise<RouterResponse> {
    const errors: Array<{ endpoint: string; error: Error }> = []
    const fallbackChain: string[] = []
    const requestType = detectRequestType(request.messages)

    // Define endpoint priority chain
    const endpoints = [
      {
        name: 'fast-agent',
        priority: 0,
        // DISABLED - Fast-agent has known issues with empty responses and routing
        // Even if FAST_AGENT_ENABLED is set, skip this endpoint
        enabled: false,
        service: fastAgentService,
        healthCheck: () => fastAgentService.healthCheck(),
        // Use shouldHandle for proper provider support and complexity gating
        canHandle: (req: RouterRequest) => false,  // Always skip fast-agent
        processRequest: async (req: RouterRequest) => {
          const response = await fastAgentService.processRequest({
            messages: req.messages,
            provider: req.provider,
            model: req.model,
            temperature: req.temperature,
            maxTokens: req.maxTokens,
            stream: req.stream,
            userId: req.userId,
            requestId: req.requestId,
          } as FastAgentRequest)
          return this.normalizeFastAgentResponse(response)
        },
      },
      {
        name: 'original-system',
        priority: 1,
        enabled: true,
        service: enhancedLLMService,
        healthCheck: async () => true,
        // Do not handle tool/sandbox requests - let specialized endpoints handle those
        // Tool requests need actual tool execution (Arcade/Nango APIs), not just LLM responses
        // Sandbox requests need actual sandbox execution, not just LLM responses
        canHandle: (req: RouterRequest) => {
          const detectedType = detectRequestType(req.messages)
          // When native tool calling is enabled (Vercel AI SDK), handle tool requests here
          // instead of routing to regex-based intent parsing
          if (detectedType === 'tool' && req.enableTools !== false && !req.nativeToolCalling) {
            return false
          }
          // Skip if this is a sandbox request and sandbox is enabled
          // Sandbox requests should go to sandbox-agent (priority 6) or v2-gateway (priority 7)
          if (detectedType === 'sandbox' && req.enableSandbox !== false) {
            return false
          }
          return true
        },
        processRequest: async (req: RouterRequest) => {
          // Pass all required fields including tool/sandbox flags
          const detectedType = detectRequestType(req.messages)
          
          // NEW: Use streaming method when stream=true for real-time token streaming
          if (req.stream === true) {
            // For streaming, we return an async generator that yields tokens as they arrive
            // The caller (routeWithSpecAmplification or routeAndFormat) handles the streaming
            const streamGenerator = enhancedLLMService.generateStreamingResponse({
              messages: req.messages,
              provider: req.provider,
              model: req.model,
              temperature: req.temperature,
              maxTokens: req.maxTokens,
              stream: true,
              userId: req.userId,
              requestId: req.requestId,
              conversationId: req.conversationId || req.requestId || `conv_${Date.now()}`,
              enableTools: req.enableTools ?? (detectedType === 'tool' && !!req.userId),
              enableSandbox: req.enableSandbox ?? (detectedType === 'sandbox' && !!req.userId),
              isSandboxCommand: detectedType === 'sandbox',
              apiKeys: req.apiKeys,
            } as EnhancedLLMRequest)
            
            return {
              success: true,
              content: '', // Will be filled by streaming chunks
              stream: streamGenerator, // Pass stream generator to caller
              data: {
                source: 'original-system',
                type: 'streaming',
                streaming: true,
              },
            }
          }
          
          // Non-streaming: use standard generateResponse
          const response = await enhancedLLMService.generateResponse({
            messages: req.messages,
            provider: req.provider,
            model: req.model,
            temperature: req.temperature,
            maxTokens: req.maxTokens,
            stream: req.stream,
            userId: req.userId,
            requestId: req.requestId,
            conversationId: req.conversationId || req.requestId || `conv_${Date.now()}`,
            enableTools: req.enableTools ?? (detectedType === 'tool' && !!req.userId),
            enableSandbox: req.enableSandbox ?? (detectedType === 'sandbox' && !!req.userId),
            isSandboxCommand: detectedType === 'sandbox',
            apiKeys: req.apiKeys,
          } as EnhancedLLMRequest)
          return this.normalizeOriginalResponse(response)
        },
      },
      {
        name: 'n8n-agents',
        priority: 2,
        enabled: process.env.N8N_ENABLED === 'true',
        service: n8nAgentService,
        healthCheck: () => n8nAgentService.healthCheck(),
        canHandle: (req: RouterRequest) => {
          const detectedType = detectRequestType(req.messages)
          if (detectedType === 'tool' || detectedType === 'sandbox') {
            return false
          }
          return true
        },
        processRequest: async (req: RouterRequest) => {
          const response = await n8nAgentService.processRequest({
            messages: req.messages,
            userId: req.userId,
            requestId: req.requestId,
          } as N8nAgentRequest)
          return this.normalizeN8nResponse(response)
        },
      },
      {
        name: 'custom-fallback',
        priority: 3,
        enabled: process.env.CUSTOM_FALLBACK_ENABLED === 'true',
        service: customFallbackService,
        healthCheck: () => customFallbackService.healthCheck(),
        canHandle: (req: RouterRequest) => {
          const detectedType = detectRequestType(req.messages)
          if (detectedType === 'tool' || detectedType === 'sandbox') {
            return false
          }
          return true
        },
        processRequest: async (req: RouterRequest) => {
          const response = await customFallbackService.processRequest({
            messages: req.messages,
            provider: req.provider,
            model: req.model,
          } as CustomFallbackRequest)
          return this.normalizeCustomFallbackResponse(response)
        },
      },
      {
        name: 'tool-execution',
        priority: 4,
        enabled: (req: RouterRequest) => req.enableTools !== false && !!req.userId,
        service: null,
        healthCheck: async () => {
          try {
            const toolManager = getToolManager()
            return !!toolManager && !!(process.env.ARCADE_API_KEY || process.env.NANGO_SECRET_KEY)
          } catch {
            return false
          }
        },
        canHandle: (req: RouterRequest) => req.enableTools !== false && !!req.userId,
        processRequest: async (req: RouterRequest) => this.processToolRequest(req, true),
      },
      {
        name: 'composio-tools',
        priority: 5,
        enabled: (req: RouterRequest) => !!this.composioService && process.env.COMPOSIO_ENABLED !== 'false' && !!req.userId,
        service: this.composioService,
        healthCheck: async () => this.composioService?.healthCheck() ?? false,
        canHandle: (req: RouterRequest) => {
          // Composio should ONLY handle OAuth tool requests (gmail, github, slack, etc.)
          // NOT general tool requests
          if (!req.userId || req.enableComposio === false) return false
          
          // Check if request explicitly wants Composio
          if (req.enableComposio === true) return true
          
          // Detect if message contains OAuth tool requests
          const lastMessage = req.messages[req.messages.length - 1]
          const content = typeof lastMessage?.content === 'string' ? lastMessage.content : ''
          const contentLower = content.toLowerCase()
          
          // OAuth tools that should use Composio
          const oauthTools = [
            'gmail', 'google', 'github', 'slack', 'notion', 'discord',
            'telegram', 'twitter', 'spotify', 'dropbox', 'salesforce',
            'hubspot', 'zoom', 'teams', 'linear', 'jira', 'confluence',
          ]
          
          // Check if message mentions OAuth tools
          return oauthTools.some(tool => contentLower.includes(tool))
        },
        processRequest: async (req: RouterRequest) => this.processComposioRequest(req),
      },
      {
        name: 'sandbox-agent',
        priority: 6,
        enabled: (req: RouterRequest) => req.enableSandbox !== false && !!req.userId,
        service: sandboxBridge,
        healthCheck: async () => {
          const sandboxProvider = process.env.SANDBOX_PROVIDER || 'daytona'
          return !!process.env[`${sandboxProvider.toUpperCase()}_API_KEY`]
        },
        canHandle: (req: RouterRequest) => req.enableSandbox !== false && !!req.userId,
        processRequest: async (req: RouterRequest) => this.processSandboxRequest(req),
      },
      {
        name: 'v2-opencode-gateway',
        priority: 7,
        enabled: (req: RouterRequest) => process.env.V2_AGENT_ENABLED === 'true' || process.env.OPENCODE_CONTAINERIZED === 'true',
        service: null,
        healthCheck: async () => {
          const health = await checkGatewayHealth()
          return health.healthy
        },
        canHandle: (req: RouterRequest) => {
          // V2 is best for code/agent tasks
          const requestType = detectRequestType(req.messages)
          return requestType === 'sandbox' || requestType === 'tool' || req.enableTools === true
        },
        processRequest: async (req: RouterRequest) => this.processV2GatewayRequest(req),
      },
      {
        name: 'emergency-llm-fallback',
        priority: 8,
        enabled: true,
        service: enhancedLLMService,
        healthCheck: async () => true,
        // Always handle as last resort - even tool/sandbox requests if all else failed
        canHandle: () => true,
        processRequest: async (req: RouterRequest) => {
          logger.warn('Using emergency LLM fallback - specialized endpoints unavailable', {
            requestId: req.requestId,
            userId: req.userId,
          })
          // Call LLM without tool/sandbox execution - just get text response
          const response = await enhancedLLMService.generateResponse({
            messages: req.messages,
            provider: req.provider,
            model: req.model,
            temperature: req.temperature,
            maxTokens: req.maxTokens,
            stream: req.stream,
            userId: req.userId,
            requestId: req.requestId,
            conversationId: req.conversationId || req.requestId || `conv_${Date.now()}`,
            enableTools: false,  // Disable tools for fallback
            enableSandbox: false,  // Disable sandbox for fallback
            isSandboxCommand: false,
            apiKeys: req.apiKeys,
          } as EnhancedLLMRequest)
          
          // Preserve normalized metadata (usage, model, provider) while adding fallback flags
          const normalized = this.normalizeOriginalResponse(response)
          return {
            ...normalized,
            data: {
              ...normalized.data,
              // Include any additional metadata from response if present
              ...(response as any).metadata,
              isFallback: true,
              fallbackReason: 'Specialized endpoints unavailable, using LLM text response',
            },
          }
        },
      },
    ]

    // Filter enabled endpoints and sort by priority
    const enabledEndpoints = endpoints
      .filter(e => {
        // For endpoints with dynamic enabled check, evaluate it
        if (typeof e.enabled === 'function') {
          return e.enabled(request)
        }
        return e.enabled
      })
      .sort((a, b) => a.priority - b.priority)

    // Route through priority chain
    for (const endpoint of enabledEndpoints) {
      const endpointStartTime = Date.now()

      // Check circuit breaker
      if (this.circuitBreaker.shouldSkip(endpoint.name)) {
        fallbackChain.push(`${endpoint.name} (circuit breaker open)`)
        continue
      }

      // Check if endpoint can handle request
      if (!endpoint.canHandle(request)) {
        continue
      }

      // Health check (skip for original-system)
      if (endpoint.name !== 'original-system') {
        const isHealthy = await endpoint.healthCheck()
        if (!isHealthy) {
          fallbackChain.push(`${endpoint.name} (unhealthy)`)
          continue
        }
      }

      // Create child span for endpoint
      const endpointSpan = span?.startSpan?.(`endpoint.${endpoint.name}`) || null
      endpointSpan?.setAttributes({
        endpoint: endpoint.name,
        priority: endpoint.priority,
      })

      try {
        logger.debug(`Routing to ${endpoint.name}`)
        const response = await endpoint.processRequest(request)

        // Record success
        this.circuitBreaker.recordSuccess(endpoint.name)
        this.updateStats(endpoint.name, true)
        recordEndpointUsage(endpoint.name, Date.now() - endpointStartTime, true)
        endpointSpan?.setAttribute('success', true)
        endpointSpan?.setAttribute('duration_ms', Date.now() - endpointStartTime)

        // Record quota usage
        const quotaProvider = this.mapEndpointToProvider(endpoint.name)
        if (quotaProvider) {
          const remaining = quotaManager.getRemainingCalls(quotaProvider)
          recordQuotaUsage(quotaProvider, 1)
          endpointSpan?.setAttribute('quota.provider', quotaProvider)
          endpointSpan?.setAttribute('quota.remaining', remaining)
        }

        endpointSpan?.end()
        return {
          success: true,
          ...response,
          source: endpoint.name,
          priority: endpoint.priority,
          fallbackChain: fallbackChain.length > 0 ? fallbackChain : undefined,
        }
      } catch (error: any) {
        logger.error(`${endpoint.name} failed:`, error.message)
        endpointSpan?.recordError(error)
        endpointSpan?.end()

        // Record failure
        this.circuitBreaker.recordFailure(endpoint.name, error)
        this.updateStats(endpoint.name, false)
        recordEndpointUsage(endpoint.name, Date.now() - endpointStartTime, false)

        // Record circuit breaker state change
        const cbStats = this.circuitBreaker.getStats(endpoint.name)
        recordCircuitBreakerState(endpoint.name, cbStats.state)

        errors.push({ endpoint: endpoint.name, error })
        // Don't truncate error messages - they contain important provider/model info
        fallbackChain.push(`${endpoint.name} (error: ${error.message})`)
      }
    }

    // All endpoints failed
    return {
      success: false,
      content: 'All endpoints failed',
      source: 'emergency-fallback',
      priority: 999,
      fallbackChain,
      metadata: {
        errors: errors.map(e => ({ endpoint: e.endpoint, error: e.error.message })),
        allEndpointsFailed: true,
      },
    }
  }

  /**
   * Format response through unified handler
   * Enhanced with empty content detection and fallback handling
   */
  private formatResponse(response: RouterResponse, requestId: string): UnifiedResponse {
    const content = this.extractContent(response)
    const commands = this.extractCommands(content)
    const toolInvocations = this.extractToolInvocations(response)
    const reasoning = this.extractReasoning(response, content)
    const usage = this.calculateUsage(response, content)
    const toolName = response.data?.toolName
    const authProvider = this.inferProviderFromToolName(toolName)
    const requiresAuth = !!response.data?.requiresAuth

    // Detect empty/missing content and add diagnostic info
    let finalContent = content
    if (!content || !content.trim()) {
      // Check if we have tool invocations, files, or processing steps
      const hasTools = !!response.data?.toolCalls?.length || !!response.data?.toolInvocations?.length
      const hasFiles = !!response.data?.files?.length
      const hasSteps = !!response.data?.processingSteps?.length
      const hasMultiModal = !!response.data?.multiModalContent?.length

      if (hasTools || hasFiles || hasSteps || hasMultiModal) {
        // Content is empty but we have data - this is a parsing issue
        logger.warn('Response has data but no content - extraction may have failed', {
          requestId,
          hasTools,
          hasFiles,
          hasSteps,
          hasMultiModal,
          source: response.source,
        })
        // Content will be built from data in extractContent, so this should not happen
        // If it does, add a diagnostic message
        finalContent = `[Response received from ${response.source} with ${
          hasSteps ? `${response.data.processingSteps.length} processing steps` :
          hasTools ? `${response.data.toolCalls?.length || 0} tool calls` :
          hasFiles ? `${response.data.files?.length || 0} files` :
          hasMultiModal ? `${response.data.multiModalContent?.length || 0} media items` :
          'data'
        }. Check tool invocations or files for results.]`
      } else if (response.success !== false) {
        // Successfully routed but no content at all - this is an error
        logger.error('Empty response received from successful endpoint', {
          requestId,
          source: response.source,
          priority: response.priority,
        })
        finalContent = `[Warning: Empty response received from ${response.source}. This may indicate a parsing or routing issue.]`
      }
    }

    return {
      success: response.success !== false,
      content: finalContent,
      source: response.source || 'unknown',
      priority: response.priority || 999,
      data: {
        content: finalContent,
        usage,
        model: (response.metadata as any)?.actualModel || (response.data as any)?.model || (response as any)?.model,
        provider: (response.metadata as any)?.actualProvider || (response.data as any)?.provider || (response as any)?.provider,
        toolCalls: (response.data as any)?.toolCalls,
        toolInvocations,
        files: (response.data as any)?.files,
        chainedAgents: (response.data as any)?.chainedAgents,
        qualityScore: (response.data as any)?.qualityScore,
        processingSteps: (response.data as any)?.processingSteps,
        reflectionResults: (response.data as any)?.reflectionResults,
        multiModalContent: (response.data as any)?.multiModalContent,
        iterations: (response.data as any)?.iterations,
        classifications: (response.data as any)?.classifications,
        optimizations: (response.data as any)?.optimizations,
        isFallback: (response.data as any)?.isFallback,
        fallbackReason: (response.data as any)?.fallbackReason,
        requiresAuth,
        authUrl: (response.data as any)?.authUrl,
        toolName,
        authProvider,
        composioMcp: (response.data as any)?.composioMcp || response.metadata?.composioMcp,
        messageMetadata: (response.data as any)?.messageMetadata,
        reasoning,
      },
      commands,
      metadata: {
        duration: response.metadata?.duration,
        routedThrough: response.metadata?.routedThrough || response.source,
        fallbackChain: response.fallbackChain || response.metadata?.fallbackChain,
        triedEndpoints: response.metadata?.triedEndpoints,
        actualProvider: response.metadata?.actualProvider,
        actualModel: response.metadata?.actualModel,
        timestamp: new Date().toISOString(),
        messageMetadata: requiresAuth
          ? {
              requiresAuth: true,
              authUrl: (response.data as any)?.authUrl,
              toolName,
              provider: authProvider,
            }
          : undefined,
      },
    }
  }

  /**
   * Extract content from response
   * Enhanced to handle FastAgent responses with processingSteps, toolCalls, and files
   */
  private extractContent(response: any): string {
    // Direct content string
    if (typeof response.content === 'string' && response.content.trim()) {
      return response.content.trim()
    }

    // Content in data object
    if (response.data?.content && typeof response.data.content === 'string') {
      return response.data.content.trim()
    }

    // LLM-style response (choices[0].message.content)
    if (response.choices?.[0]?.message?.content) {
      return response.choices[0].message.content
    }

    // FastAgent: Build content from processingSteps if content is empty
    if (response.data?.processingSteps?.length > 0) {
      const completedSteps = response.data.processingSteps
        .filter((step: any) => step.status === 'completed' || step.result)
        .map((step: any, idx: number) => {
          const stepText = `Step ${idx + 1}: ${step.step || 'Unknown step'}`
          const resultText = step.result ? `\n  Result: ${step.result}` : ''
          return stepText + resultText
        })
      
      if (completedSteps.length > 0) {
        return completedSteps.join('\n\n')
      }
    }

    // FastAgent: Build content from toolCalls if no text content
    if (response.data?.toolCalls?.length > 0) {
      const toolSummary = response.data.toolCalls
        .map((tool: any, idx: number) => {
          const name = tool.name || tool.function?.name || 'unknown'
          const args = tool.arguments || tool.function?.arguments || '{}'
          return `Tool ${idx + 1}: ${name}(${args})`
        })
        .join('\n')
      
      return `Tools executed:\n${toolSummary}`
    }

    // FastAgent: Build content from files if no text content
    if (response.data?.files?.length > 0) {
      const fileSummary = response.data.files
        .map((file: any, idx: number) => {
          const path = file.path || 'unknown'
          const type = file.type || 'file'
          // Include first few lines of content if available
          const contentPreview = file.content 
            ? `\n  Content preview:\n${file.content.split('\n').slice(0, 5).join('\n  ')}`
            : ''
          return `File ${idx + 1}: ${path} (${type})${contentPreview}`
        })
        .join('\n')
      
      return `Files created/modified:\n${fileSummary}`
    }

    // FastAgent: Build content from chainedAgents
    if (response.data?.chainedAgents?.length > 0) {
      return `Chained agents: ${response.data.chainedAgents.join(' → ')}`
    }

    // FastAgent: Build content from multiModalContent
    if (response.data?.multiModalContent?.length > 0) {
      const multimodalSummary = response.data.multiModalContent
        .map((item: any, idx: number) => {
          const type = item.type || 'unknown'
          const metadata = item.metadata ? ` (${JSON.stringify(item.metadata)})` : ''
          return `${idx + 1}. ${type}${metadata}`
        })
        .join('\n')
      
      return `Multi-modal content:\n${multimodalSummary}`
    }

    // Fallback: Return empty string if nothing found
    return ''
  }

  /**
   * Extract commands from content
   */
  /**
   * Extract commands from content
   * Enhanced with fallback parser for raw code blocks (Bug #1 fix)
   * Fixed regex to handle ] in content (Bug #8 fix)
   */
  private extractCommands(content: string): { request_files?: string[]; write_diffs?: Array<{ path: string; diff: string }> } | undefined {
    try {
      // Primary: Parse structured command block format
      const match = content.match(/=== COMMANDS_START ===([\s\S]*?)=== COMMANDS_END ===/)
      if (match) {
        return this.parseStructuredCommands(match[1])
      }

      // Fallback: Parse raw markdown code blocks with filenames
      // Return as write_diffs to apply the file changes
      const rawFiles = this.parseRawCodeBlocks(content)
      if (rawFiles && rawFiles.length > 0) {
        return { write_diffs: rawFiles }
      }

      return undefined
    } catch {
      return undefined
    }
  }

  /**
   * Parse structured command block format
   */
  private parseStructuredCommands(block: string): { request_files?: string[]; write_diffs?: Array<{ path: string; diff: string }> } | undefined {
    try {
      const extractArraySection = (source: string, key: string): string | null => {
        const match = source.match(new RegExp(`${key}:\\s*\\[`))
        if (!match || match.index === undefined) return null

        const startIdx = source.indexOf('[', match.index)
        let bracketDepth = 0
        let activeQuote: '"' | "'" | '`' | null = null

        for (let i = startIdx + 1; i < source.length; i += 1) {
          const char = source[i]
          const previous = i > 0 ? source[i - 1] : ''

          if (activeQuote) {
            if (char === activeQuote && previous !== '\\') {
              activeQuote = null
            }
            continue
          }

          if (char === '"' || char === '\'' || char === '`') {
            activeQuote = char
            continue
          }

          if (char === '[') bracketDepth += 1
          else if (char === ']') {
            if (bracketDepth === 0) {
              return source.substring(startIdx + 1, i)
            }
            bracketDepth -= 1
          }
        }

        return null
      }

      const requestFilesContent = extractArraySection(block, 'request_files')
      const request_files = requestFilesContent ? parseStructuredPathList(requestFilesContent) : []

      let write_diffs: Array<{ path: string; diff: string }> = []
      const diffsContent = extractArraySection(block, 'write_diffs')
      if (diffsContent !== null) {
        const items = diffsContent
          .split(/\},\s*\{/)
          .map(s => s.trim())
          .filter(Boolean)
          .map(s => s.replace(/^\{/, '').replace(/\}$/, ''))

        write_diffs = items.map(raw => {
          const pathMatch = raw.match(/path:\s*"([^"]+)"/)
          const diffMatch = raw.match(/diff:\s*"([\s\S]*?)"\s*$/)
          return {
            path: pathMatch?.[1] || '',
            diff: (diffMatch?.[1] || '').replace(/\\n/g, '\n'),
          }
        }).filter(d => d.path)
      }

      return { request_files, write_diffs }
    } catch {
      return undefined
    }
  }

  /**
   * Fallback parser for raw markdown code blocks (Bug #1 fix)
   */
  private parseRawCodeBlocks(content: string): Array<{ path: string; diff: string }> | undefined {
    const write_diffs: Array<{ path: string; diff: string }> = []
    
    const codeBlockRegex = /```(\w+)\s+(?:\/?([^\s]+(?:\/[^\s]+)*))?\s*\n([\s\S]*?)```/g
    let match
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const [, language, filePath, code] = match
      
      if (['bash', 'sh', 'shell', 'zsh'].includes(language.toLowerCase())) continue
      if (!filePath || filePath.includes('.') === false) continue
      
      const validExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.html', '.css', '.json', '.md', '.yaml', '.yml', '.toml', '.config']
      if (!validExtensions.some(ext => filePath.toLowerCase().endsWith(ext))) continue
      
      let cleanPath = filePath.replace(/^\//, '').trim()
      if (cleanPath.includes('://') || cleanPath.startsWith('http')) continue
      
      write_diffs.push({ path: cleanPath, diff: code.trim() })
    }
    
    return write_diffs.length > 0 ? write_diffs : undefined
  }

  /**
   * Extract tool invocations from response
   */
  private extractToolInvocations(response: any): ToolInvocation[] {
    return normalizeToolInvocations(
      response.data?.toolInvocations ||
      response.messageMetadata?.toolInvocations ||
      response.metadata?.toolInvocations ||
      response.data?.toolResults
    )
  }

  /**
   * Extract reasoning from response
   */
  private extractReasoning(response: any, content?: string): string | undefined {
    const explicitReasoning =
      response.data?.reasoning ||
      response.data?.reasoningTrace ||
      response.metadata?.reasoning ||
      response.metadata?.reasoningTrace

    if (Array.isArray(explicitReasoning)) {
      const joined = explicitReasoning.filter(Boolean).join('\n')
      return joined || undefined
    }
    if (typeof explicitReasoning === 'string' && explicitReasoning.trim()) {
      return explicitReasoning.trim()
    }

    const parsed = extractReasoningContent(content ?? this.extractContent(response))
    return parsed.reasoning || undefined
  }

  /**
   * Calculate usage statistics
   */
  private calculateUsage(response: any, content?: string): { promptTokens: number; completionTokens: number; totalTokens: number } {
    if (response.usage || response.data?.usage) {
      const usage = response.usage || response.data.usage
      return {
        promptTokens: usage.promptTokens || usage.prompt_tokens || 0,
        completionTokens: usage.completionTokens || usage.completion_tokens || 0,
        totalTokens: usage.totalTokens || usage.total_tokens || 0,
      }
    }

    const estimatedTokens = Math.ceil((content ?? this.extractContent(response)).length / 4)

    return {
      promptTokens: 0,
      completionTokens: estimatedTokens,
      totalTokens: estimatedTokens,
    }
  }

  /**
   * Infer provider from tool name
   */
  private inferProviderFromToolName(toolName?: string): string | undefined {
    if (!toolName || typeof toolName !== 'string') return undefined
    const normalized = toolName.toLowerCase()
    if (normalized.startsWith('gmail.') || normalized.startsWith('google')) return 'google'
    if (normalized.startsWith('github.')) return 'github'
    if (normalized.startsWith('slack.')) return 'slack'
    if (normalized.startsWith('notion.')) return 'notion'
    if (normalized.startsWith('discord.')) return 'discord'
    if (normalized.startsWith('twitter.') || normalized.startsWith('x.')) return 'twitter'
    if (normalized.startsWith('spotify.')) return 'spotify'
    if (normalized.startsWith('twilio.')) return 'twilio'
    return normalized.split('.')[0]
  }

  /**
   * Map endpoint name to quota provider key
   */
  private mapEndpointToProvider(endpointName: string): string | null {
    switch (endpointName) {
      case 'fast-agent':
      case 'n8n-agents':
      case 'custom-fallback':
      case 'original-system':
        // Regular LLM routing should not consume tool/sandbox quotas
        // This prevents exhausting unrelated quotas and disabling sandbox/tool routing
        return null;
      default:
        return null;
    }
  }

  /**
   * Normalize FastAgent response
   * Ensures all FastAgent-specific fields are properly passed through
   */
  private normalizeFastAgentResponse(response: FastAgentResponse): RouterResponse {
    return {
      success: response.success,
      content: response.content || '',  // Keep original content (may be empty if tools/files only)
      data: {
        ...(response as any).data,
        // Ensure all FastAgent fields are preserved
        toolCalls: (response as any).toolCalls,
        files: (response as any).files,
        chainedAgents: (response as any).chainedAgents,
        processingSteps: (response as any).processingSteps,
        reflectionResults: (response as any).reflectionResults,
        multiModalContent: (response as any).multiModalContent,
        qualityScore: (response as any).qualityScore,
        estimatedDuration: (response as any).estimatedDuration,
        iterationCount: (response as any).iterationCount,
        fallbackToOriginal: (response as any).fallbackToOriginal,
      },
      source: 'fast-agent',
      priority: 0,
    }
  }

  /**
   * Normalize original system response
   */
  private normalizeOriginalResponse(response: any): RouterResponse {
    // Preserve actual LLM provider/model from response metadata if available
    // This prevents showing 'original-system' as the provider when a real LLM provider was used
    const actualProvider = response.metadata?.actualProvider || response.provider || 'original-system';
    const actualModel = response.metadata?.actualModel || response.model;
    
    return {
      success: true,
      content: response.content || response.choices?.[0]?.message?.content,
      data: {
        usage: response.usage,
        model: actualModel,
        provider: actualProvider,
      },
      source: 'original-system',
      priority: 1,
      metadata: {
        actualProvider,
        actualModel,
      },
    }
  }

  /**
   * Normalize N8N response
   */
  private normalizeN8nResponse(response: N8nAgentResponse): RouterResponse {
    return {
      success: response.success,
      content: (response as any).content,
      data: (response as any).data,
      source: 'n8n-agents',
      priority: 2,
    }
  }

  /**
   * Normalize custom fallback response
   */
  private normalizeCustomFallbackResponse(response: CustomFallbackResponse): RouterResponse {
    return {
      success: response.success,
      content: (response as any).content,
      data: (response as any).data,
      source: 'custom-fallback',
      priority: 3,
    }
  }

  /**
   * Build canonical tool invocation record
   */
  private buildCanonicalToolInvocationRecord(params: {
    toolName: string
    args?: Record<string, unknown>
    result?: unknown
    provider?: string
    sourceSystem: string
    requestId?: string
    conversationId?: string
  }): Record<string, unknown> {
    return {
      toolName: params.toolName,
      args: params.args ?? {},
      result: params.result,
      provider: params.provider,
      sourceSystem: params.sourceSystem,
      requestId: params.requestId,
      conversationId: params.conversationId,
    }
  }

  /**
   * Build canonical tool invocations
   */
  private buildCanonicalToolInvocations(params: {
    toolName: string
    args?: Record<string, unknown>
    result?: unknown
    provider?: string
    sourceSystem: string
    requestId?: string
    conversationId?: string
  }): ToolInvocation[] {
    return normalizeToolInvocations([this.buildCanonicalToolInvocationRecord(params)])
  }

  /**
   * Detect tool intent from messages
   */
  private detectToolIntent(messages: LLMMessage[]): { detectedTool: string | null; toolInput: any; error?: string } {
    const lastMessage = messages[messages.length - 1]
    const content = typeof lastMessage?.content === 'string' ? lastMessage.content : ''

    // Look for tool call patterns
    const toolCallMatch = content.match(/<tool\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool>/)
    if (toolCallMatch) {
      try {
        return {
          detectedTool: toolCallMatch[1],
          toolInput: JSON.parse(toolCallMatch[2] || '{}'),
        }
      } catch {
        return {
          detectedTool: toolCallMatch[1],
          toolInput: {},
          error: 'Invalid tool arguments JSON',
        }
      }
    }

    // Check for function call patterns
    if (lastMessage?.toolCalls?.length > 0) {
      const toolCall = lastMessage.toolCalls[0]
      return {
        detectedTool: toolCall.name || null,
        toolInput: toolCall.arguments || {},
      }
    }

    return { detectedTool: null, toolInput: {} }
  }

  /**
   * Process tool request via unified registry
   */
  private async processToolRequest(request: RouterRequest, allowFallbackToComposio: boolean = true): Promise<any> {
    if (!request.userId) {
      return {
        content: 'User ID required for tool access',
        data: {
          source: 'tool-execution',
          requiresAuth: true,
          error: 'User ID not provided',
        },
      }
    }

    try {
      const unifiedRegistry = getUnifiedToolRegistry()
      const toolDiscovery = getToolDiscoveryService()
      const errorHandler = getToolErrorHandler()

      // Detect tool intent from messages
      const detectionResult = this.detectToolIntent(request.messages)

      if (!detectionResult.detectedTool) {
        // No tool detected, fall through to composio
        if (allowFallbackToComposio) {
          return await this.processComposioRequestInternal(request, false)
        }
        return {
          content: 'No tool intent detected',
          data: { source: 'tool-execution', type: 'no_intent' },
        }
      }

      // Check authorization
      const isAuthorized = await toolAuthManager.isAuthorized(request.userId, detectionResult.detectedTool)
      if (!isAuthorized) {
        const provider = toolAuthManager.getRequiredProvider(detectionResult.detectedTool)
        if (provider) {
          const authUrl = toolAuthManager.getAuthorizationUrl(provider)
          return {
            content: `I need authorization to use ${detectionResult.detectedTool}. Please connect your account to proceed.`,
            data: {
              source: 'tool-execution',
              requiresAuth: true,
              authUrl,
              toolName: detectionResult.detectedTool,
              type: 'auth_required',
            },
          }
        }
      }

      // Execute via unified registry
      const result = await unifiedRegistry.executeTool(
        detectionResult.detectedTool,
        detectionResult.toolInput,
        {
          userId: request.userId,
          conversationId: request.requestId || `conv_${Date.now()}`,
          metadata: { sessionId: `session_${request.requestId}` },
        },
      )

      if (result.success) {
        // Record usage for statistics
        toolDiscovery.recordUsage(detectionResult.detectedTool, true, 0)

        return {
          content: result.output ? JSON.stringify(result.output) : `Tool ${detectionResult.detectedTool} executed successfully`,
          data: {
            source: 'tool-execution',
            toolCalls: [{ name: detectionResult.detectedTool, arguments: detectionResult.toolInput }],
            toolResults: [{ name: detectionResult.detectedTool, result: result.output }],
            toolInvocations: this.buildCanonicalToolInvocations({
              toolName: detectionResult.detectedTool,
              args: detectionResult.toolInput,
              result: result.output,
              provider: result.provider ?? toolAuthManager.getRequiredProvider(detectionResult.detectedTool) ?? 'unknown',
              sourceSystem: 'response-router',
              requestId: request.requestId,
              conversationId: request.requestId,
            }),
            type: 'tool_execution',
          },
        }
      }

      // Handle errors with unified error handler
      const toolError = errorHandler.handleError(
        new Error(result.error || 'Tool execution failed'),
        detectionResult.detectedTool,
        detectionResult.toolInput,
      )

      // Record failed usage
      toolDiscovery.recordUsage(detectionResult.detectedTool, false, 0)

      // If auth required, return auth URL
      if (toolError.category === 'authentication' || result.authRequired) {
        const provider = toolAuthManager.getRequiredProvider(detectionResult.detectedTool)
        const authUrl = provider ? toolAuthManager.getAuthorizationUrl(provider) : result.authUrl
        return {
          content: `Authorization required for ${detectionResult.detectedTool}. Please connect your account.`,
          data: {
            source: 'tool-execution',
            requiresAuth: true,
            authUrl,
            toolName: detectionResult.detectedTool,
            type: 'auth_required',
          },
        }
      }

      // Fallback to Composio if unified registry failed
      if (allowFallbackToComposio) {
        logger.info('Unified registry failed, falling back to Composio')
        const fallback = await this.processComposioRequestInternal(request, false)
        if (fallback?.data?.type === 'auth_required' || fallback?.data?.type === 'composio_execution') {
          return fallback
        }
      }

      // Return error with hints
      return {
        content: `Tool execution failed: ${toolError.message}\n\nHints:\n${toolError.hints?.join('\n') || 'Please try again'}`,
        data: {
          source: 'tool-execution',
          error: toolError.message,
          category: toolError.category,
          retryable: toolError.retryable,
          hints: toolError.hints,
          type: 'error',
        },
      }
    } catch (error) {
      logger.error('Tool processing error:', error)
      const errorHandler = getToolErrorHandler()
      const toolError = errorHandler.handleError(error, 'unknown')

      if (allowFallbackToComposio) {
        logger.info('Tool execution error, falling back to Composio')
        const fallback = await this.processComposioRequestInternal(request, false)
        if (fallback?.data?.type === 'auth_required' || fallback?.data?.type === 'composio_execution') {
          return fallback
        }
      }

      return {
        content: `Tool execution failed: ${toolError.message}`,
        data: {
          source: 'tool-execution',
          error: toolError.message,
          category: toolError.category,
          hints: toolError.hints,
          type: 'error',
        },
      }
    }
  }

  /**
   * Process Composio tool request with 800+ toolkits
   */
  private async processComposioRequest(request: RouterRequest): Promise<any> {
    return this.processComposioRequestInternal(request, true)
  }

  private async processComposioRequestInternal(request: RouterRequest, allowFallbackToToolExecution: boolean): Promise<any> {
    if (!this.composioService) {
      return {
        content: 'Composio service not available',
        data: {
          source: 'composio-tools',
          error: 'Service not initialized',
        },
      }
    }

    if (!request.userId) {
      return {
        content: 'User ID required for Composio tool access',
        data: {
          source: 'composio-tools',
          requiresAuth: true,
          error: 'User ID not provided',
        },
      }
    }

    try {
      const composioRequest: ComposioToolRequest = {
        messages: request.messages,
        userId: request.userId,
        stream: request.stream,
        requestId: request.requestId || `comp_${Date.now()}`,
        enableAllTools: true,
      }

      const result = await this.composioService.processToolRequest(composioRequest)

      // Handle authentication required
      if (result.requiresAuth) {
        const toolkitName = result.authToolkit || 'the requested service'
        const inferredProvider = toolkitName.toLowerCase().includes('gmail') || toolkitName.toLowerCase().includes('google')
          ? 'google'
          : toolkitName.toLowerCase()
        const authUrl = result.authUrl || toolAuthManager.getAuthorizationUrl(inferredProvider)
        return {
          content: result.content || `I need authorization to use ${toolkitName} through Composio. Please connect your account to proceed.`,
          data: {
            source: 'composio-tools',
            requiresAuth: true,
            authUrl,
            toolkit: toolkitName,
            provider: inferredProvider,
            toolName: toolkitName,
            type: 'auth_required',
            composioSessionId: result.metadata?.sessionId,
            composioMcp: result.metadata?.mcp,
          },
        }
      }

      const genericNoOutput =
        !result.content ||
        result.content.trim().length === 0 ||
        result.content.includes('Tool request was processed but returned no text output') ||
        (result.content.includes('Tool request was processed (') && result.content.includes('but returned no text output'))

      // If Composio did not produce actionable output, fallback to deterministic tool pipeline
      if (genericNoOutput && allowFallbackToToolExecution) {
        logger.info('Composio no-output, falling back to tool-execution')
        const fallback = await this.processToolRequest(request, false)
        if (fallback?.data?.type === 'auth_required' || fallback?.data?.type === 'tool_execution') {
          return fallback
        }
      }

      // Success response
      const canonicalToolInvocations = Array.isArray(result.toolCalls)
        ? normalizeToolInvocations(
            result.toolCalls.map((toolCall: any, index: number) =>
              this.buildCanonicalToolInvocationRecord({
                toolName: toolCall?.name ?? toolCall?.toolName ?? `composio-tool-${index + 1}`,
                args: toolCall?.arguments ?? toolCall?.args ?? toolCall?.input ?? {},
                result: toolCall?.result ?? toolCall?.output,
                provider: 'composio',
                sourceSystem: 'response-router',
                requestId: request.requestId,
                conversationId: result.metadata?.sessionId ?? request.requestId,
              }),
            ),
          )
        : []

      return {
        content: result.content || 'Tool request completed.',
        data: {
          source: 'composio-tools',
          type: 'composio_execution',
          toolCalls: result.toolCalls,
          toolInvocations: canonicalToolInvocations,
          connectedAccounts: result.connectedAccounts,
          composioSessionId: result.metadata?.sessionId,
          composioMcp: result.metadata?.mcp,
          toolsUsed: result.metadata?.toolsUsed,
          executionTime: result.metadata?.executionTime,
        },
      }
    } catch (error: any) {
      logger.error('Composio processing error:', error)
      return {
        content: `I encountered an error while processing your request with Composio: ${error.message}`,
        data: {
          source: 'composio-tools',
          error: error.message,
          type: 'error',
        },
      }
    }
  }

  /**
   * Process sandbox request
   */
  private async processSandboxRequest(request: RouterRequest): Promise<any> {
    if (!request.userId) {
      return {
        content: 'User authentication required for sandbox access',
        data: {
          source: 'sandbox-agent',
          requiresAuth: true,
          error: 'User ID not provided',
        },
      }
    }

    try {
      const session = await sessionManager.getOrCreateSession(request.userId, request.conversationId || request.requestId || 'default')

      if (!session.sandboxHandle) {
        return {
          content: 'Sandbox not available',
          data: {
            source: 'sandbox-agent',
            error: 'No sandbox handle',
          },
        }
      }

      // Execute command in sandbox
      const lastMessage = request.messages[request.messages.length - 1]
      const command = typeof lastMessage?.content === 'string' ? lastMessage.content : ''

      const result = await session.sandboxHandle.executeCommand(command, session.workspacePath)

      return {
        content: result.output || 'Command executed',
        data: {
          source: 'sandbox-agent',
          type: 'sandbox_execution',
          exitCode: result.exitCode,
          success: result.success,
        },
      }
    } catch (error: any) {
      logger.error('Sandbox processing error:', error)
      return {
        content: `Sandbox execution failed: ${error.message}`,
        data: {
          source: 'sandbox-agent',
          error: error.message,
          type: 'error',
        },
      }
    }
  }

  /**
   * Process V2 Gateway request (containerized OpenCode)
   */
  private async processV2GatewayRequest(request: RouterRequest): Promise<any> {
    const v2StartTime = Date.now()
    const v2Span = startSpan('v2.gateway.process', {
      userId: request.userId,
      conversationId: request.conversationId,
      model: request.model,
    })

    try {
      recordV2JobSubmission()
      v2Span?.setAttribute('v2.submitted', true)

      if (!request.userId) {
        v2Span?.setAttribute('error', 'User ID not provided')
        v2Span?.end()
        return {
          content: 'User authentication required for V2 agent',
          data: {
            source: 'v2-opencode-gateway',
            requiresAuth: true,
            error: 'User ID not provided',
          },
        }
      }

      // Extract last user message as task
      const lastMessage = request.messages[request.messages.length - 1]
      const task = typeof lastMessage?.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage?.content || '')

      // Build context from conversation history
      const context = request.messages
        .filter(m => m.role !== 'system')
        .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
        .join('\n')

      // Submit job to V2 gateway
      const v2Request: V2JobRequest = {
        userId: request.userId,
        conversationId: request.conversationId || request.requestId || 'default',
        prompt: task,
        context,
        model: request.model,
      }

      // Try gateway first, fallback to Redis queue
      let jobResponse
      try {
        jobResponse = await submitJobToGateway(v2Request)
        logger.info('Job submitted to V2 gateway', {
          jobId: jobResponse.jobId,
          sessionId: jobResponse.sessionId,
        })
        v2Span?.setAttribute('v2.method', 'gateway')
      } catch (gatewayError: any) {
        logger.warn('Gateway unavailable, falling back to Redis queue:', gatewayError.message)
        jobResponse = await submitJobToRedisQueue(v2Request)
        logger.info('Job submitted to Redis queue', {
          jobId: jobResponse.jobId,
          sessionId: jobResponse.sessionId,
        })
        v2Span?.setAttribute('v2.method', 'redis')
      }

      // Wait for job completion (with timeout)
      const timeoutMs = request.stream ? 30000 : 120000 // Shorter timeout for streaming
      const result = await waitForJobCompletion(
        jobResponse.jobId,
        jobResponse.sessionId,
        timeoutMs
      )

      // Record completion
      const v2Duration = Date.now() - v2StartTime
      recordV2JobCompletion(v2Duration, true)
      v2Span?.setAttribute('v2.duration_ms', v2Duration)
      v2Span?.setAttribute('v2.success', true)

      // Extract response from job result
      const content = result.result?.response || result.result?.content || 'Task completed'
      const toolInvocations = result.result?.toolInvocations || []
      const steps = result.result?.steps || []

      v2Span?.end()
      return {
        content,
        data: {
          source: 'v2-opencode-gateway',
          type: 'v2_execution',
          jobId: jobResponse.jobId,
          sessionId: jobResponse.sessionId,
          toolInvocations,
          processingSteps: steps,
          agent: 'opencode',
          model: request.model,
        },
      }
    } catch (error: any) {
      logger.error('V2 gateway processing error:', error)
      const v2Duration = Date.now() - v2StartTime
      recordV2JobCompletion(v2Duration, false)
      v2Span?.recordError(error)
      v2Span?.setAttribute('v2.success', false)
      v2Span?.end()

      return {
        content: `V2 agent execution failed: ${error.message}`,
        data: {
          source: 'v2-opencode-gateway',
          error: error.message,
          type: 'error',
          fallbackToV1: true,
        },
      }
    }
  }

  /**
   * Dual-path inference with spec amplification
   * 
   * V1 MODE ONLY - Regular LLM calls with spec amplification
   * Does NOT work with V2 agent mode
   * 
   * Runs parallel execution:
   * 1. Primary: Normal LLM response
   * 2. Secondary: Fast model generates improvement spec
   * 
   * Then refines primary response based on spec
   * 
   * @param request - Router request with mode
   * @returns Unified response with refinements
   */
  async routeWithSpecAmplification(
    request: RouterRequest & {
      mode?: 'normal' | 'enhanced' | 'max'
      agentMode?: 'v1' | 'v2' | 'auto'
      emit?: (event: string, data: any) => void
    }
  ): Promise<UnifiedResponse> {
    const startTime = Date.now()
    const span = startSpan('response-router.spec-amplification')
    let fastModel: any = null
    
    try {
      // V2 AGENT MODE: Skip spec amplification entirely
      // V2 has its own planning/execution system
      if (request.agentMode === 'v2') {
        logger.debug('V2 agent mode detected, skipping spec amplification')
        return await this.routeAndFormat(request)
      }
      
      // Normal mode = skip spec amplification
      if (request.mode === 'normal' || !request.mode) {
        return await this.routeAndFormat(request)
      }
      
      // Get fastest model from telemetry
      const { getModelStatsFromTelemetry, getSpecGenerationModel } = await import('@/lib/models/model-ranker')
      const modelStats = await getModelStatsFromTelemetry()
      fastModel = await getSpecGenerationModel()

      // Fallback: If no telemetry data available, use Mistral Small (fast & cheap)
      if (!fastModel) {
        logger.info('No telemetry data available, using Mistral Small as fallback for spec generation')
        fastModel = {
          provider: 'mistral',
          model: 'mistral-small-latest',
          avgLatency: 500,
          failureRate: 0.01,
          lastUpdated: Date.now(),
          totalCalls: 0,
          successRate: 0.99,
          score: 0.5,
          rank: 1
        }
      }

      logger.info('Spec amplification enabled', {
        fastModel: fastModel.model,
        mode: request.mode,
        provider: fastModel.provider,
        fromTelemetry: !!getSpecGenerationModel()
      })

      // PRIMARY ALREADY DONE BY CALLER - extract from messages
      // The caller (route.ts) passes the assistant response in messages
      logger.debug('Spec: Extracting primary from messages', { 
        messageCount: request.messages.length,
        lastRole: request.messages[request.messages.length - 1]?.role,
      })
      const lastAssistantMsg = [...request.messages].reverse().find(m => m.role === 'assistant')
      const primaryContent = typeof lastAssistantMsg?.content === 'string' 
        ? lastAssistantMsg.content 
        : ''

      logger.debug('Spec: Primary content extracted', { 
        contentLength: primaryContent.length,
        hasContent: !!primaryContent,
      })

      const primaryData: UnifiedResponse = {
        success: true,
        content: primaryContent,
        source: 'spec-amplification',
        priority: 0,
        data: {
          content: primaryContent,
        }
      }

      // Generate spec only (primary already done by caller)
      const { buildSpecPrompt } = await import('@/lib/prompts/spec-generator')
      const { enhancedLLMService } = await import('@/lib/chat/enhanced-llm-service')
      
      // Generate unique request ID for spec generation
      const specRequestId = `spec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

      // Extract user message for spec prompt
      const lastUserMsg = [...request.messages].reverse().find(m => m.role === 'user')
      const userContent = typeof lastUserMsg?.content === 'string' 
        ? lastUserMsg.content 
        : JSON.stringify(lastUserMsg?.content || '')
      
      logger.debug('Building spec prompt', { 
        userContentLength: userContent.length,
        specRequestId,
      })

      const specPromise = enhancedLLMService.generateResponse({
        provider: fastModel.provider,
        model: fastModel.model,
        messages: buildSpecPrompt(userContent),
        maxTokens: 4000,
        stream: false,
        requestId: specRequestId
      })

      // Wrap spec promise to match expected type for runBackgroundRefinement
      const wrappedSpecPromise = specPromise.then(response => ({
        success: true,
        data: response,
        error: null,
      })).catch(err => ({
        success: false,
        data: null,
        error: err,
      }))

      // Trigger background refinement (fire-and-forget)
      this.runBackgroundRefinement({
        primaryData,
        specGenerationPromise: wrappedSpecPromise,
        request,
        fastModel,
        startTime,
      }).catch(err => {
        logger.error('Background refinement failed', {
          error: err?.message,
          stack: err?.stack,
          requestId: request.requestId,
          hasPrimaryContent: !!primaryContent,
          primaryContentLength: primaryData?.content?.length,
        })
      })

      // Return minimal response - primary already returned by caller
      return {
        success: true,
        content: '',
        source: 'spec-amplification',
        priority: 0,
        data: {
          content: '',
        }
      }

    } catch (error) {
      const hasFastModelInCatch = typeof fastModel !== 'undefined'
      logger.error('Spec amplification failed', {
        error: error?.message,
        stack: error?.stack,
        requestId: request?.requestId,
        hasFastModel: hasFastModelInCatch,
        mode: request?.mode,
      })
      recordEndpointUsage('spec-generation', Date.now() - startTime, false)

      // Fallback to normal routing
      return await this.routeAndFormat(request)
    } finally {
      span.end()
    }
  }

  /**
   * Run refinement in background, sending updates via SSE
   * Creates new chat messages for each refinement improvement
   */
  private async runBackgroundRefinement(params: {
    primaryData: UnifiedResponse
    specGenerationPromise: Promise<{ success: boolean; data?: any; error?: any }>
    request: RouterRequest & { mode?: 'normal' | 'enhanced' | 'max'; emit?: (event: string, data: any) => void }
    fastModel: any
    startTime: number
  }): Promise<void> {
    const { primaryData, specGenerationPromise, request, fastModel, startTime } = params
    const { safeParseSpec, chunkSpec, explodeChunks } = await import('@/lib/chat/spec-parser')
    const { validateSpec, scoreSpec } = await import('@/lib/prompts/spec-generator')

    logger.info('Spec: runBackgroundRefinement started', {
      requestId: request.requestId,
      mode: request.mode,
      hasEmit: !!request.emit,
      primaryContentLength: primaryData?.content?.length,
      startTimeMs: Date.now() - startTime,
    })

    try {
      // Wait for spec generation
      logger.debug('Waiting for spec generation to complete')
      const specResult = await specGenerationPromise
      logger.debug('Spec generation result', { 
        success: specResult.success,
        hasData: !!specResult.data,
        error: specResult.error?.message,
      })

      if (!specResult.success) {
        logger.warn('Spec generation failed in background', { error: specResult.error })
        const emitFunc = request.emit || (() => {});
        emitFunc('spec_amplification', { stage: 'spec_failed', error: specResult.error?.message })
        return
      }

      const specResponse = specResult.data
      const rawSpec = specResponse.content || ''

      // Parse spec
      const parsed = safeParseSpec(rawSpec)
      logger.debug('Spec parsed', { 
        success: !!parsed, 
        hasGoal: !!parsed?.goal,
        sectionsCount: parsed?.sections?.length,
        rawSpecLength: rawSpec.length,
      })
      if (!parsed) {
        logger.warn('Spec parsing failed in background')
        const emitFunc2 = request.emit || (() => {});
        emitFunc2('spec_amplification', { stage: 'parse_failed' })
        return
      }

      // Validate spec quality
      const isValid = validateSpec(parsed)
      logger.debug('Spec validation', { isValid, specGoal: parsed.goal?.substring(0, 50) })
      if (!isValid) {
        logger.warn('Spec validation failed in background')
        const emitFunc3 = request.emit || (() => {});
        emitFunc3('spec_amplification', { stage: 'validation_failed' })
        return
      }

      const specScore = scoreSpec(parsed)
      logger.debug('Spec: Scored', { score: specScore, threshold: 4 })
      if (specScore < 4) {
        logger.warn('Spec quality too low in background', { score: specScore })
        const emitFunc4 = request.emit || (() => {});
        emitFunc4('spec_amplification', { stage: 'low_quality', score: specScore })
        return
      }

      logger.debug('Spec: About to emit thinking', { 
        hasEmit: !!request.emit,
        emitType: typeof request.emit,
      })
      // Emit spec as thinking/reasoning so it shows in the expandable thinking UI
      // Use safe emit to avoid crash when stream is closed
      const emitFuncThinking = request.emit || (() => {});
      try {
        const specSummary = formatSpecForThinking(parsed, specScore);
        logger.debug('Spec: Thinking content length', { length: specSummary.length })
        emitFuncThinking('thinking', {
          type: 'thinking',
          content: specSummary,
          timestamp: Date.now(),
        });
      } catch (emitErr) {
        logger.warn('Spec: Thinking emit failed (stream likely closed)', { 
          error: emitErr?.message,
          errorStack: emitErr?.stack,
        })
      }

      // Chunk spec
      let chunks = chunkSpec(parsed)
      logger.debug('Spec: Chunked', { chunkCount: chunks.length, mode: request.mode })
      if (request.mode === 'max') {
        chunks = explodeChunks(chunks)
      }

      const primaryProvider = primaryData.data?.provider || fastModel?.provider || 'openrouter'
      const primaryModel = primaryData.data?.model || fastModel?.model || request.model
      logger.debug('Spec: Refinement config', { 
        provider: primaryProvider, 
        model: primaryModel,
        baseResponseLength: (primaryData.content || '').length,
        userId: !!request.userId,
        conversationId: !!request.conversationId,
      })

      // Check emit function status before DAG call
      if (!request.emit) {
        logger.warn('Spec: No emit function - stream likely closed before DAG')
      } else {
        logger.debug('Spec: Emit function present, will pass to DAG')
      }

      // FIX: Make emit function safe (no-op) instead of passing undefined
      // This allows spec amplification events to be sent without crashing
      // The emit calls are still wrapped in if (request.emit) checks
      const safeEmit = request.emit ? request.emit : () => {};
      
      // Run refinement with safe emit function
      const { executeRefinementWithDAG } = await import('@/lib/chat/dag-refinement-engine')
      logger.info('Spec: Starting DAG refinement', { 
        chunkCount: chunks.length, 
        mode: request.mode,
        emitPresent: !!request.emit,
      })
      
      let refinedOutput: string
      try {
        logger.debug('About to call executeRefinementWithDAG')
        refinedOutput = await executeRefinementWithDAG({
          model: primaryModel,
          provider: primaryProvider,
          baseResponse: primaryData.content || '',
          chunks,
          mode: request.mode as 'enhanced' | 'max',
          userId: request.userId,
          conversationId: request.conversationId,
          maxConcurrency: request.mode === 'max' ? 3 : 2,
          timeBudgetMs: request.mode === 'max' ? 180_000 : 120_000,
          emit: safeEmit // Use safe emit - won't crash even if stream is closed
        })
        logger.debug('Spec: DAG returned', { 
          outputLength: refinedOutput.length, 
          hasContent: !!refinedOutput,
          outputPreview: refinedOutput.substring(0, 300),
        })
      } catch (dagErr) {
        logger.error('Spec: DAG execution failed', { 
          error: dagErr?.message, 
          stack: dagErr?.stack,
          chunkCount: chunks.length,
          primaryContentLength: primaryData?.content?.length,
        })
        // Continue without refinement - don't block on DAG failure
        refinedOutput = primaryData.content || ''
      }

      // Apply filesystem edits from refined output using the same pipeline as main chat
      // Import the exported function from route.ts - ensures consistent handling
      logger.debug('Spec: Extracting file writes from refined output', { 
        refinedOutputLength: refinedOutput.length,
        refinedOutputPreview: refinedOutput.substring(0, 200),
      })
      const fileWriteEdits = extractFsActionWrites(refinedOutput);
      logger.debug('File writes extracted', { count: fileWriteEdits.length, edits: fileWriteEdits.map(e => e.path) })
      let filesystemEdits: Awaited<ReturnType<typeof import('@/app/api/chat/route').applyFilesystemEditsFromResponse>> | null = null;
      
      // SECURITY: Only apply filesystem edits when we have a concrete owner and conversation context
      // Use filesystemOwnerId if available (handles anonymous users correctly), otherwise fall back to userId
      const ownerIdForEdits = (request as any).filesystemOwnerId || request.userId;
      // Fallback: derive conversationId from requestId if missing (prevents refinement edits from being silently dropped)
      // SECURITY: Validate requestId to prevent path traversal attacks - only allow safe alphanumeric characters
      const rawConversationId =
        request.conversationId ||
        (request.requestId && /^[a-zA-Z0-9_-]+$/.test(request.requestId) ? request.requestId : undefined);

      if (ownerIdForEdits && rawConversationId) {
        // CRITICAL FIX: Use normalizeSessionId to extract simple session folder name
        // This prevents composite IDs like "anon:timestamp:001" from leaking into paths
        const { normalizeSessionId } = await import('@/lib/virtual-filesystem/scope-utils');
        const simpleSessionId = normalizeSessionId(rawConversationId) || rawConversationId; // Use original if normalize returns empty
        const compositeConversationId = `${ownerIdForEdits}:${rawConversationId}`;

        logger.debug('Spec: Applying refinement filesystem edits', {
          ownerId: ownerIdForEdits.toString(),
          conversationId: compositeConversationId,
          scopePath: `project/sessions/${simpleSessionId}`,
          refinedOutputLength: refinedOutput.length,
          hasFileWrites: fileWriteEdits.length > 0,
        })

        try {
          const { applyFilesystemEditsFromResponse } = await import('@/app/api/chat/route')

          filesystemEdits = await applyFilesystemEditsFromResponse({
            ownerId: ownerIdForEdits.toString(),
            conversationId: compositeConversationId,
            requestId: `refinement-${Date.now()}`,
            scopePath: `project/sessions/${simpleSessionId}`,
            lastUserMessage: '',
            attachedPaths: [],
            responseContent: refinedOutput,
          })
          logger.debug('Refinement filesystem edits result', {
            appliedCount: filesystemEdits?.applied?.length,
            errors: filesystemEdits?.errors?.length,
          })
        } catch (fsError) {
          logger.error('Spec: Refinement filesystem edit application failed', {
            error: fsError?.message,
            stack: fsError?.stack,
          })
        }
      } else {
        logger.warn('Skipping filesystem edits for spec enhancement: missing ownerId or conversationId', {
          hasOwnerId: !!ownerIdForEdits,
          hasConversationId: !!rawConversationId,
          source: (request as any).filesystemOwnerId ? 'filesystemOwnerId' : 'userId',
        })
      }

      // Send refined content via SSE - use safe emit to avoid crashes
      // FIX: Always emit spec_amplification events (frontend can reconnect)
      const emitFunc = request.emit || (() => {});
      
      // Emit stage: 'started' to trigger UI loading indicator
      // Note: frontend handles 'started' not 'starting'
      emitFunc('spec_amplification', { 
        stage: 'started', 
        timestamp: Date.now() 
      });
      // Format improvements as a properly spaced list
      const improvements = formatRefinementsAsList(parsed, refinedOutput, chunks, fileWriteEdits);

      const eventData: any = {
        stage: 'complete',
        refinedContent: improvements,
        specScore,
        sectionsProcessed: chunks.length,
        hasFileWrites: fileWriteEdits.length > 0,
        fileWrites: fileWriteEdits.map(w => ({ path: w.path, operation: 'write' })),
        // CRITICAL FIX: Also emit fileEdits for frontend display
        // Frontend uses this for enhanced-diff-viewer
        fileEdits: fileWriteEdits.map(w => ({
          path: w.path,
          content: w.content,
          operation: 'write',
        }))
      }

      // Include filesystem metadata if edits were applied
      // Frontend will display file edit UI with accept/deny options
      if (filesystemEdits && filesystemEdits.transactionId) {
        eventData.filesystem = {
          status: filesystemEdits.status,
          transactionId: filesystemEdits.transactionId,
          applied: filesystemEdits.applied,
          errors: filesystemEdits.errors,
          requestedFiles: filesystemEdits.requestedFiles,
          scopePath: filesystemEdits.scopePath,
          sessionId: filesystemEdits.sessionId,
        }
      }

      // Use emitFunc for safe emission (works even if stream closed)
      emitFunc('spec_amplification', eventData)

      logger.info('Background refinement complete', { specScore, sectionsProcessed: chunks.length })

    } catch (error) {
      logger.error('Background refinement error', {
        error: error?.message,
        stack: error?.stack,
        hasPrimaryData: !!primaryData,
        primaryContentLength: primaryData?.content?.length,
        hasRequest: !!request,
        requestId: request?.requestId,
        mode: request?.mode,
      })
      const emitFuncErr = request.emit || (() => {});
      emitFuncErr('spec_amplification', { 
        stage: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      })
    }
  }

  /**
   * Create streaming events from unified response
   */
  createStreamingEvents(
    response: UnifiedResponse,
    requestId: string,
    options?: {
      includeReasoning?: boolean;
      includeToolState?: boolean;
      includeFilesystem?: boolean;
      includeDiffs?: boolean;
      chunkSize?: number;
      emitPrimaryContentImmediately?: boolean;
    }
  ): string[] {
    // Use enhanced streaming events module
    const { createStreamingEvents } = require('./streaming-events')
    return createStreamingEvents(response, requestId, {
      includeReasoning: options?.includeReasoning ?? true,
      includeToolState: options?.includeToolState ?? true,
      includeFilesystem: options?.includeFilesystem ?? true,
      includeDiffs: options?.includeDiffs ?? true,
      chunkSize: options?.chunkSize ?? 8,
      emitPrimaryContentImmediately: options?.emitPrimaryContentImmediately ?? true,
    })
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitBreakerStats(): Map<string, any> {
    const stats = new Map<string, any>()
    for (const [endpoint, state] of this.circuitBreaker.getAllStates()) {
      stats.set(endpoint, this.circuitBreaker.getStats(endpoint))
    }
    return stats
  }

  /**
   * Reset circuit breaker for endpoint
   */
  resetCircuitBreaker(endpoint: string): void {
    this.circuitBreaker.reset(endpoint)
  }

  /**
   * Get comprehensive router statistics
   */
  getRouterStats(): {
    circuitBreaker: Map<string, any>
    endpoints: Map<string, EndpointStats>
  } {
    return {
      circuitBreaker: this.getCircuitBreakerStats(),
      endpoints: this.getAllEndpointStats(),
    }
  }
}

/**
 * Format a parsed spec into a readable thinking/reasoning block
 * for display in the expandable thinking UI.
 */
function formatSpecForThinking(spec: any, score: number): string {
  const lines: string[] = [];
  lines.push('## Spec Generation Plan');
  lines.push('');
  if (spec.goal) {
    lines.push(`**Goal:** ${spec.goal}`);
    lines.push('');
  }
  if (spec.sections && spec.sections.length > 0) {
    lines.push(`**${spec.sections.length} sections planned:**`);
    lines.push('');
    for (const section of spec.sections) {
      lines.push(`### ${section.title || section.name || 'Section'}`);
      if (section.priority != null) {
        lines.push(`Priority: ${section.priority}`);
      }
      if (section.tasks && section.tasks.length > 0) {
        for (const task of section.tasks) {
          const taskStr = typeof task === 'string' ? task : task.description || task.title || JSON.stringify(task);
          lines.push(`- ${taskStr}`);
        }
      }
      lines.push('');
    }
  }
  if (spec.executionStrategy) {
    lines.push(`**Strategy:** ${spec.executionStrategy}`);
  }
  lines.push(`**Quality score:** ${score}/10`);
  return lines.join('\n');
}

/**
 * Format refinement results as a clean, spaced list of improvements.
 * Replaces the raw "spec completed" message with actual improvement details.
 */
function formatRefinementsAsList(spec: any, refinedOutput: string, chunks: any[], fileWrites: any[]): string {
  const lines: string[] = [];

  if (spec.sections && spec.sections.length > 0) {
    lines.push('### Improvements Applied');
    lines.push('');

    for (const section of spec.sections) {
      const sectionTitle = section.title || section.name || 'General';
      const tasks = section.tasks || [];
      if (tasks.length > 0) {
        lines.push(`**${sectionTitle}:**`);
        for (const task of tasks) {
          const taskStr = typeof task === 'string' ? task : task.description || task.title || JSON.stringify(task);
          lines.push(`- ${taskStr}`);
        }
        lines.push('');
      }
    }
  }

  if (fileWrites.length > 0) {
    lines.push('**Files modified:**');
    for (const fw of fileWrites) {
      lines.push(`- \`${fw.path}\``);
    }
    lines.push('');
  }

  lines.push('Let me know if you want anything else!');

  return lines.join('\n');
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const responseRouter = new ResponseRouter()

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * @deprecated Use responseRouter.routeAndFormat()
 */
export async function routeAndFormatRequest(request: RouterRequest): Promise<UnifiedResponse> {
  return responseRouter.routeAndFormat(request)
}

/**
 * @deprecated Use responseRouter.routeWithSpecAmplification()
 */
export async function routeWithSpecAmplification(
  request: RouterRequest & { mode?: 'normal' | 'enhanced' | 'max' }
): Promise<UnifiedResponse> {
  return responseRouter.routeWithSpecAmplification(request)
}

/**
 * @deprecated Use responseRouter.createStreamingEvents()
 */
export function createStreamingEvents(response: UnifiedResponse, requestId: string): string[] {
  return responseRouter.createStreamingEvents(response, requestId)
}
