/**
 * Priority Request Router - Routes requests through priority-based endpoint chain
 * Ensures requests are handled by the most capable available service with automatic fallback
 * 
 * Features:
 * - Circuit breaker pattern for fault tolerance
 * - Failure rate tracking with automatic recovery
 * - Health check integration
 * - Quota management
 */

import { fastAgentService, type FastAgentRequest, type FastAgentResponse } from './fast-agent-service';
import { n8nAgentService, type N8nAgentRequest, type N8nAgentResponse } from './n8n-agent-service';
import { customFallbackService, type CustomFallbackRequest, type CustomFallbackResponse } from './custom-fallback-service';
import { enhancedLLMService, type EnhancedLLMRequest } from './enhanced-llm-service';
import { getToolManager, getUnifiedToolRegistry, getToolDiscoveryService, getToolErrorHandler } from '../tools';
import { toolAuthManager } from '../tools/tool-authorization-manager';
import { sandboxBridge } from '../sandbox';
import type { LLMMessage } from './llm-providers';
import { detectRequestType } from '../utils/request-type-detector';
import { normalizeToolInvocations } from '@/lib/types/tool-invocation';
import { initializeComposioService, getComposioService, type ComposioToolRequest } from '../platforms/composio-service';
import { quotaManager } from '../management/quota-manager';

// ===========================================
// Circuit Breaker Pattern Implementation
// ===========================================

/**
 * Circuit breaker states
 */
type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting recovery */
  recoveryTimeoutMs: number;
  /** Time window for counting failures */
  failureWindowMs: number;
}

/**
 * Circuit breaker state for an endpoint
 */
interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  failureTimestamps: number[];
}

/**
 * Default circuit breaker configuration
 * 
 * Tuned for production:
 * - Opens after 5 failures within 1 minute
 * - Attempts recovery after 30 seconds
 * - Half-open allows 1 test request
 */
const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 10,
  recoveryTimeoutMs: 15000,  // 15 seconds — recover faster, never block for long
  failureWindowMs: 90000,    // 90 seconds — wider window so transient bursts don't trigger
};

/**
 * Circuit breaker class for endpoint fault tolerance
 */
class CircuitBreaker {
  private states = new Map<string, CircuitBreakerState>();
  private readonly config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  private buildCanonicalToolInvocations(params: {
    toolName: string;
    args?: Record<string, unknown>;
    result?: unknown;
    provider?: string;
    sourceSystem: string;
    requestId?: string;
    conversationId?: string;
  }) {
    return normalizeToolInvocations([this.buildCanonicalToolInvocationRecord(params)]);
  }

  private buildCanonicalToolInvocationRecord(params: {
    toolName: string;
    args?: Record<string, unknown>;
    result?: unknown;
    provider?: string;
    sourceSystem: string;
    requestId?: string;
    conversationId?: string;
  }): Record<string, unknown> {
    return {
      toolName: params.toolName,
      args: params.args ?? {},
      result: params.result,
      provider: params.provider,
      sourceSystem: params.sourceSystem,
      requestId: params.requestId,
      conversationId: params.conversationId,
    };
  }

  /**
   * Get or create circuit breaker state for endpoint
   */
  private getState(endpoint: string): CircuitBreakerState {
    if (!this.states.has(endpoint)) {
      this.states.set(endpoint, {
        state: 'closed',
        failures: 0,
        successes: 0,
        lastFailureTime: 0,
        lastSuccessTime: 0,
        failureTimestamps: [],
      });
    }
    return this.states.get(endpoint)!;
  }

  /**
   * Check if endpoint should be skipped (circuit open)
   */
  shouldSkip(endpoint: string): boolean {
    const state = this.getState(endpoint);
    const now = Date.now();

    if (state.state === 'closed') {
      return false;  // Circuit closed, allow requests
    }

    if (state.state === 'open') {
      // Check if recovery timeout has elapsed
      if (now - state.lastFailureTime >= this.config.recoveryTimeoutMs) {
        console.log(`[CircuitBreaker] ${endpoint}: Opening half-open circuit for test request`);
        state.state = 'half-open';  // Allow one test request
        return false;
      }
      console.log(`[CircuitBreaker] ${endpoint}: Circuit OPEN - skipping (retry in ${Math.round((this.config.recoveryTimeoutMs - (now - state.lastFailureTime)) / 1000)}s)`);
      return true;  // Skip this endpoint
    }

    if (state.state === 'half-open') {
      // CRITICAL: A probe is already running; block additional requests until probe completes
      // This prevents race condition where multiple concurrent requests all get through during half-open
      console.log(`[CircuitBreaker] ${endpoint}: Circuit HALF-OPEN - probe already running, skipping`);
      return true;  // Skip - probe already in progress
    }

    return false;
  }

  /**
   * Record successful request
   */
  recordSuccess(endpoint: string): void {
    const state = this.getState(endpoint);
    const now = Date.now();

    state.successes++;
    state.lastSuccessTime = now;
    state.failures = 0;  // Reset failures on success
    state.failureTimestamps = [];  // Clear failure history

    if (state.state === 'half-open') {
      console.log(`[CircuitBreaker] ${endpoint}: Test request succeeded - closing circuit`);
      state.state = 'closed';  // Recovery successful
    }

    this.logState(endpoint);
  }

  /**
   * Record failed request
   */
  recordFailure(endpoint: string): void {
    const state = this.getState(endpoint);
    const now = Date.now();

    state.failures++;
    state.lastFailureTime = now;
    state.failureTimestamps.push(now);

    // Remove old failures outside the window
    const windowStart = now - this.config.failureWindowMs;
    state.failureTimestamps = state.failureTimestamps.filter(t => t > windowStart);

    // Check if we should open the circuit
    if (state.failureTimestamps.length >= this.config.failureThreshold) {
      if (state.state !== 'open') {
        console.warn(`[CircuitBreaker] ${endpoint}: Circuit OPENED after ${state.failures} failures in ${this.config.failureWindowMs / 1000}s`);
        state.state = 'open';
      }
    }

    this.logState(endpoint);
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(endpoint: string): {
    state: CircuitState;
    failures: number;
    successes: number;
    failureRate: number;
  } {
    const state = this.getState(endpoint);
    const total = state.failures + state.successes;
    
    return {
      state: state.state,
      failures: state.failures,
      successes: state.successes,
      failureRate: total > 0 ? state.failures / total : 0,
    };
  }

  /**
   * Log current state (for debugging)
   */
  private logState(endpoint: string): void {
    const state = this.getState(endpoint);
    console.debug(`[CircuitBreaker] ${endpoint}: state=${state.state}, failures=${state.failures}, successes=${state.successes}`);
  }

  /**
   * Reset circuit breaker for endpoint (manual override)
   */
  reset(endpoint: string): void {
    this.states.set(endpoint, {
      state: 'closed',
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      failureTimestamps: [],
    });
    console.log(`[CircuitBreaker] ${endpoint}: Circuit manually reset`);
  }

  /**
   * Get all circuit breaker states (for monitoring)
   */
  getAllStates(): Map<string, CircuitBreakerState> {
    return new Map(this.states);
  }
}

export interface RouterRequest {
  messages: LLMMessage[];
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  apiKeys?: Record<string, string>;
  requestId?: string;
  userId?: string;
  enableTools?: boolean;
  enableSandbox?: boolean;
  enableComposio?: boolean;
}

export interface RouterResponse {
  success: boolean;
  content?: string;
  data?: any;
  source: string;
  priority: number;
  fallbackChain?: string[];
  metadata?: Record<string, any>;
}

export interface EndpointConfig {
  name: string;
  priority: number;
  enabled: boolean;
  service: any;
  healthCheck: () => Promise<boolean>;
  canHandle: (request: any) => boolean;
  processRequest: (request: any) => Promise<any>;
}

class PriorityRequestRouter {
  private endpoints: EndpointConfig[];
  private routingStats: Map<string, { success: number; failures: number }>;
  private readonly composioService: ReturnType<typeof initializeComposioService>;
  private readonly circuitBreaker: CircuitBreaker;

  constructor() {
    this.routingStats = new Map();
    this.circuitBreaker = new CircuitBreaker();
    // Initialize Composio service if available
    this.composioService = initializeComposioService();
    this.endpoints = this.initializeEndpoints();
  }

  /**
   * Get circuit breaker statistics for monitoring
   */
  getCircuitBreakerStats(): Map<string, any> {
    const stats = new Map<string, any>();
    for (const [endpoint, state] of this.circuitBreaker.getAllStates()) {
      stats.set(endpoint, this.circuitBreaker.getStats(endpoint));
    }
    return stats;
  }

  /**
   * Build canonical tool invocation record for Composio/tool-execution responses
   */
  private buildCanonicalToolInvocationRecord(params: {
    toolName: string;
    args?: Record<string, unknown>;
    result?: unknown;
    provider?: string;
    sourceSystem: string;
    requestId?: string;
    conversationId?: string;
  }): Record<string, unknown> {
    return {
      toolName: params.toolName,
      args: params.args ?? {},
      result: params.result,
      provider: params.provider,
      sourceSystem: params.sourceSystem,
      requestId: params.requestId,
      conversationId: params.conversationId,
    };
  }

  /**
   * Build canonical tool invocations array for response normalization
   */
  private buildCanonicalToolInvocations(params: {
    toolName: string;
    args?: Record<string, unknown>;
    result?: unknown;
    provider?: string;
    sourceSystem: string;
    requestId?: string;
    conversationId?: string;
  }) {
    return normalizeToolInvocations([this.buildCanonicalToolInvocationRecord(params)]);
  }

  /**
   * Manually reset circuit breaker for endpoint (for debugging/operations)
   */
  resetCircuitBreaker(endpoint: string): void {
    this.circuitBreaker.reset(endpoint);
  }

  private getToolServicePreference(): 'composio-tools' | 'tool-execution' | 'auto' {
    const preferred = (process.env.TOOL_HANDLER || process.env.TOOL_PROVIDER || 'auto').toLowerCase();
    if (preferred === 'composio' || preferred === 'composio-tools') return 'composio-tools';
    if (preferred === 'tool-execution' || preferred === 'arcade' || preferred === 'nango') return 'tool-execution';
    return 'auto';
  }

  private reorderForToolPreference(endpoints: EndpointConfig[]): EndpointConfig[] {
    const preference = this.getToolServicePreference();
    if (preference === 'auto') return endpoints;

    const preferred = endpoints.filter(e => e.name === preference);
    const secondary = endpoints.filter(e => e.name === (preference === 'composio-tools' ? 'tool-execution' : 'composio-tools'));
    const others = endpoints.filter(e => e.name !== 'composio-tools' && e.name !== 'tool-execution');
    return [...preferred, ...secondary, ...others];
  }

  /**
   * Map endpoint name to quota provider key
   */
  private mapEndpointToProvider(endpointName: string): string | null {
    switch (endpointName) {
      case 'composio-tools':
        return 'composio';
      case 'tool-execution': {
        // Prefer arcade when configured, otherwise fall back to nango
        if (process.env.ARCADE_API_KEY) return 'arcade';
        if (process.env.NANGO_SECRET_KEY) return 'nango';
        return null;
      }
      case 'sandbox-agent': {
        // Use the actual sandbox provider configured in the system
        const sandboxProvider = process.env.SANDBOX_PROVIDER || 'daytona';
        return sandboxProvider;
      }
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
   * Initialize endpoint configurations in priority order
   * Priority: LLM reasoning first, then specialized tools as fallbacks
   */
  private initializeEndpoints(): EndpointConfig[] {
    const endpoints: EndpointConfig[] = [
      // Priority 0: Fast-Agent (Primary LLM - reasoning, conversation, general tasks)
      {
        name: 'fast-agent',
        priority: 0,
        enabled: process.env.FAST_AGENT_ENABLED === 'true',
        service: fastAgentService,
        healthCheck: () => fastAgentService.healthCheck(),
        canHandle: (req) => fastAgentService.shouldHandle(this.convertToFastAgentRequest(req)),
        processRequest: async (req) => {
          const response = await fastAgentService.processRequest(this.convertToFastAgentRequest(req));
          return this.normalizeFastAgentResponse(response);
        }
      },
      // Priority 1: Original Enhanced LLM Service (Built-in LLM fallback)
      {
        name: 'original-system',
        priority: 1,
        enabled: true,
        service: enhancedLLMService,
        healthCheck: async () => true, // Always available
        // Do not handle tool/sandbox requests - let specialized endpoints handle those
        canHandle: (req) => {
          const requestType = detectRequestType(req.messages);
          // Skip if this is a tool request and tools are enabled
          if (requestType === 'tool' && (req.enableTools !== false || req.enableComposio !== false)) {
            return false;
          }
          // Skip if this is a sandbox request and sandbox is enabled
          if (requestType === 'sandbox' && req.enableSandbox !== false) {
            return false;
          }
          return true;
        },
        processRequest: async (req) => {
          // Convert request with all required fields including tool/sandbox flags
          const requestType = detectRequestType(req.messages);
          const enhancedRequest = this.convertToEnhancedLLMRequest(req);
          // Ensure tool/sandbox flags are passed through
          enhancedRequest.enableTools = req.enableTools ?? requestType === 'tool';
          enhancedRequest.enableSandbox = req.enableSandbox ?? requestType === 'sandbox';
          enhancedRequest.isSandboxCommand = requestType === 'sandbox';
          
          const response = await enhancedLLMService.generateResponse(enhancedRequest);
          return this.normalizeOriginalResponse(response);
        }
      },
      // Priority 2: n8n Agent Chaining (Complex workflows and external integrations)
      {
        name: 'n8n-agents',
        priority: 2,
        enabled: process.env.N8N_ENABLED === 'true',
        service: n8nAgentService,
        healthCheck: () => n8nAgentService.healthCheck(),
        canHandle: (req) => n8nAgentService.shouldHandle(this.convertToN8nRequest(req)),
        processRequest: async (req) => {
          const response = await n8nAgentService.processRequest(this.convertToN8nRequest(req));
          return this.normalizeN8nResponse(response);
        }
      },
      // Priority 3: Custom Fallback (Additional fallback layer)
      {
        name: 'custom-fallback',
        priority: 3,
        enabled: process.env.CUSTOM_FALLBACK_ENABLED === 'true',
        service: customFallbackService,
        healthCheck: () => customFallbackService.healthCheck(),
        canHandle: () => true, // Always accepts
        processRequest: async (req) => {
          const response = await customFallbackService.processRequest(this.convertToCustomFallbackRequest(req));
          return this.normalizeCustomFallbackResponse(response);
        }
      },
      // Priority 4: Composio Tools (800+ toolkits - only when explicitly detected)
      {
        name: 'composio-tools',
        priority: 4,
        enabled: !!this.composioService && process.env.COMPOSIO_ENABLED !== 'false',
        service: this.composioService,
        healthCheck: async () => {
          if (!this.composioService) return false;
          return this.composioService.healthCheck();
        },
        canHandle: (req) => {
          return !!this.composioService && !!req.userId && req.enableComposio !== false
            && detectRequestType(req.messages) === 'tool'
            && quotaManager.isAvailable('composio');
        },
        processRequest: async (req) => {
          return await this.processComposioRequest(req);
        }
      },
      // Priority 5: Tool Execution (Arcade/Nango - only when explicitly detected)
      {
        name: 'tool-execution',
        priority: 5,
        enabled: true,
        service: null, // Lazily initialized to prevent crashes if ../tools is missing
        healthCheck: async () => {
          try {
            // Check if tool manager and Arcade/Nango are configured
            const toolManager = getToolManager();
            return !!toolManager && !!(process.env.ARCADE_API_KEY || process.env.NANGO_SECRET_KEY);
          } catch {
            return false;
          }
        },
        canHandle: (req) => {
          return detectRequestType(req.messages) === 'tool' && !!req.userId && req.enableTools !== false
            && (quotaManager.isAvailable('arcade') || quotaManager.isAvailable('nango'));
        },
        processRequest: async (req) => {
          // Process tool request with authorization
          return await this.processToolRequest(req);
        }
      },
      // Priority 6: Sandbox Agent (Code execution - only when explicitly detected)
      {
        name: 'sandbox-agent',
        priority: 6,
        enabled: true,
        service: sandboxBridge,
        healthCheck: async () => {
          // Check if sandbox provider is configured
          return !!(process.env.SANDBOX_PROVIDER);
        },
        canHandle: (req) => {
          const sandboxProvider = (process.env.SANDBOX_PROVIDER || 'daytona') as string;
          return detectRequestType(req.messages) === 'sandbox' && !!req.userId && req.enableSandbox !== false
            && quotaManager.isAvailable(sandboxProvider);
        },
        processRequest: async (req) => {
          // Process sandbox request
          return await this.processSandboxRequest(req);
        }
      }
    ];

    // Sort by priority and filter enabled
    return endpoints
      .filter(e => e.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Route request through priority chain with circuit breaker protection
   */
  async route(request: RouterRequest): Promise<RouterResponse> {
    const errors: Array<{ endpoint: string; error: Error }> = [];
    const fallbackChain: string[] = [];
    const startTime = Date.now();
    const requestType = detectRequestType(request.messages);
    const preferSpecialized = !!request.userId && (
      (requestType === 'tool' && (request.enableComposio !== false || request.enableTools !== false)) ||
      (requestType === 'sandbox' && request.enableSandbox !== false)
    );

    let orderedEndpoints = preferSpecialized
      ? [
          ...this.endpoints.filter(e => e.name !== 'original-system'),
          ...this.endpoints.filter(e => e.name === 'original-system'),
        ]
      : this.endpoints;

    if (requestType === 'tool' && preferSpecialized) {
      orderedEndpoints = this.reorderForToolPreference(orderedEndpoints);
      const toolChain = orderedEndpoints
        .map(e => e.name)
        .filter(name => name === 'composio-tools' || name === 'tool-execution' || name === 'original-system');
      console.log(
        `[Router] Tool routing context: preference=${this.getToolServicePreference()} ` +
        `composio=${process.env.COMPOSIO_ENABLED !== 'false' && !!process.env.COMPOSIO_API_KEY} ` +
        `arcade=${!!process.env.ARCADE_API_KEY} ` +
        `nango=${!!(process.env.NANGO_SECRET_KEY || process.env.NANGO_API_KEY)} ` +
        `chain=${toolChain.join(' -> ')}`
      );
    }

    console.log(`[Router] Starting request routing. Available endpoints: ${orderedEndpoints.map(e => e.name).join(', ')}`);

    for (const endpoint of orderedEndpoints) {
      try {
        console.log(`[Router] Trying endpoint: ${endpoint.name} (priority ${endpoint.priority})`);

        // ===========================================
        // CIRCUIT BREAKER CHECK
        // Skip endpoint if circuit is OPEN
        // ===========================================
        if (this.circuitBreaker.shouldSkip(endpoint.name)) {
          const stats = this.circuitBreaker.getStats(endpoint.name);
          console.warn(
            `[Router] ${endpoint.name}: SKIPPED (circuit breaker OPEN - ` +
            `${stats.failures} failures, retry in ~30s)`
          );
          fallbackChain.push(`${endpoint.name} (circuit breaker open)`);
          continue;
        }

        // Check if endpoint can handle this request
        if (!endpoint.canHandle(request)) {
          console.log(`[Router] ${endpoint.name} cannot handle this request type, skipping`);
          continue;
        }

        // Skip health check for original-system (regular chat) to avoid latency
        // Health checks are still performed for tool/sandbox endpoints
        if (endpoint.name !== 'original-system') {
          const isHealthy = await endpoint.healthCheck();
          if (!isHealthy) {
            console.warn(`[Router] ${endpoint.name} health check failed, trying next`);
            fallbackChain.push(`${endpoint.name} (unhealthy)`);
            continue;
          }
        }

        // Process request
        console.log(`[Router] Routing to ${endpoint.name}`);
        const response = await endpoint.processRequest(request);

        // ===========================================
        // Validate response - treat unsuccessful payloads as failures
        // ===========================================
        // Endpoint handlers can return structured failure payloads (success: false or type: 'error')
        // We must throw these as errors so fallback routing and circuit-breaker accounting work correctly
        if (response?.success === false || response?.data?.type === 'error') {
          const endpointError =
            response?.data?.error ||
            response?.content ||
            'Endpoint returned unsuccessful response';
          throw new Error(endpointError);
        }

        // ===========================================
        // CIRCUIT BREAKER: Record SUCCESS
        // ===========================================
        this.circuitBreaker.recordSuccess(endpoint.name);
        
        // Track success in stats
        this.updateStats(endpoint.name, true);

        // Map endpoint name to quota provider key
        const quotaProvider = this.mapEndpointToProvider(endpoint.name);
        if (quotaProvider) {
          quotaManager.recordUsage(quotaProvider);
        }

        const duration = Date.now() - startTime;

        // Get actual provider/model from response
        // For fallback scenarios, response.data.provider will show "original -> fallback" format
        const actualProvider = response.data?.provider || endpoint.name;
        const actualModel = response.data?.model || request.model;

        console.log(`[Router] Request successfully handled by ${endpoint.name} in ${duration}ms (requested: ${request.provider}/${request.model}, actual: ${actualProvider}/${actualModel})`);

        return {
          success: true,
          ...response,
          source: endpoint.name,
          priority: endpoint.priority,
          fallbackChain: fallbackChain.length > 0 ? fallbackChain : undefined,
          metadata: {
            ...response.metadata,
            duration,
            routedThrough: endpoint.name,
            triedEndpoints: fallbackChain.length + 1,
            actualProvider,
            actualModel,
            quotaRemaining: quotaProvider ? quotaManager.getRemainingCalls(quotaProvider) : Infinity,
            circuitBreakerState: this.circuitBreaker.getStats(endpoint.name),
          }
        };

      } catch (error) {
        const err = error as Error;

        // Skip verbose logging for expected "not configured" errors
        const isNotConfiguredError = err.message.includes('not configured');
        if (!isNotConfiguredError) {
          console.error(`[Router] ${endpoint.name} failed:`, err.message);
        } else {
          console.log(`[Router] ${endpoint.name} skipped: ${err.message}`);
        }

        // ===========================================
        // CIRCUIT BREAKER: Record FAILURE
        // ===========================================
        this.circuitBreaker.recordFailure(endpoint.name);
        
        // Track failure in stats
        this.updateStats(endpoint.name, false);

        errors.push({ endpoint: endpoint.name, error: err });
        fallbackChain.push(`${endpoint.name} (error: ${err.message.substring(0, 50)})`);

        // Continue to next endpoint
      }
    }

    // All endpoints failed - this should be extremely rare with proper fallback configuration
    const duration = Date.now() - startTime;

    // Only log full error details if there were actual errors (not just "not configured")
    const actualErrors = errors.filter(e => !e.error.message.includes('not configured'));
    if (actualErrors.length > 0) {
      console.error('[Router] All endpoints failed:', errors);
    } else {
      console.log('[Router] No configured providers available');
    }

    // Return a final emergency response
    return {
      success: false,
      content: "Sorry, but I can't process your request due to technical difficulties. Please try again in a moment.",
      source: 'emergency-fallback',
      priority: 999,
      fallbackChain,
      metadata: {
        duration,
        errors: errors.map(e => ({ endpoint: e.endpoint, error: e.error.message })),
        allEndpointsFailed: true
      }
    };
  }

  /**
   * Process Composio tool request with 800+ toolkits
   */
  private async processComposioRequest(request: RouterRequest): Promise<any> {
    return this.processComposioRequestInternal(request, true);
  }

  private async processComposioRequestInternal(request: RouterRequest, allowFallbackToToolExecution: boolean): Promise<any> {
    if (!this.composioService) {
      return {
        content: 'Composio service not available',
        data: {
          source: 'composio-tools',
          error: 'Service not initialized'
        }
      };
    }

    if (!request.userId) {
      return {
        content: 'User ID required for Composio tool access',
        data: {
          source: 'composio-tools',
          requiresAuth: true,
          error: 'User ID not provided'
        }
      };
    }

    try {
      const composioRequest: ComposioToolRequest = {
        messages: request.messages,
        userId: request.userId,
        stream: request.stream,
        requestId: request.requestId || `comp_${Date.now()}`,
        // Enable all toolkits by default for maximum capability
        enableAllTools: true
      };

      const result = await this.composioService.processToolRequest(composioRequest);

      // Handle authentication required
      if (result.requiresAuth) {
        const toolkitName = result.authToolkit || 'the requested service';
        const inferredProvider = toolkitName.toLowerCase().includes('gmail') || toolkitName.toLowerCase().includes('google')
          ? 'google'
          : toolkitName.toLowerCase();
        const authUrl = result.authUrl || toolAuthManager.getAuthorizationUrl(inferredProvider);
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
          }
        };
      }

      const genericNoOutput =
        !result.content ||
        result.content.trim().length === 0 ||
        result.content.includes('Tool request was processed but returned no text output') ||
        result.content.includes('Tool request was processed (') && result.content.includes('but returned no text output');

      // If Composio did not produce actionable output, fallback to deterministic tool pipeline.
      if (genericNoOutput && allowFallbackToToolExecution) {
        console.log('[Router] Composio no-output -> fallback tool-execution');
        const fallback = await this.processToolRequestInternal(request, false);
        if (fallback?.data?.type === 'auth_required' || fallback?.data?.type === 'tool_execution') {
          return fallback;
        }
      }

      // Success response
      const canonicalToolInvocations = Array.isArray(result.toolCalls)
        ? normalizeToolInvocations(
            result.toolCalls.map((toolCall: any, index: number) => this.buildCanonicalToolInvocationRecord({
              toolName: toolCall?.name ?? toolCall?.toolName ?? `composio-tool-${index + 1}`,
              args: toolCall?.arguments ?? toolCall?.args ?? toolCall?.input ?? {},
              result: toolCall?.result ?? toolCall?.output,
              provider: 'composio',
              sourceSystem: 'priority-router',
              requestId: request.requestId,
              conversationId: result.metadata?.sessionId ?? request.requestId,
            }))
          )
        : [];
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
          executionTime: result.metadata?.executionTime
        }
      };
    } catch (error: any) {
      console.error('[Router] Composio processing error:', error);
      return {
        content: `I encountered an error while processing your request with Composio: ${error.message}`,
        data: {
          source: 'composio-tools',
          error: error.message,
          type: 'error'
        }
      };
    }
  }

  /**
   * Convert router request to Fast-Agent format
   */
  private convertToFastAgentRequest(request: RouterRequest): FastAgentRequest {
    return {
      messages: request.messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      })),
      provider: request.provider,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      requestId: request.requestId
    };
  }

  /**
   * Convert router request to n8n format
   */
  private convertToN8nRequest(request: RouterRequest): N8nAgentRequest {
    return {
      messages: request.messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      })),
      provider: request.provider,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      requestId: request.requestId
    };
  }

  /**
   * Convert router request to custom fallback format
   */
  private convertToCustomFallbackRequest(request: RouterRequest): CustomFallbackRequest {
    return {
      messages: request.messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      })),
      provider: request.provider,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      requestId: request.requestId
    };
  }

  /**
   * Convert router request to enhanced LLM format
   */
  private convertToEnhancedLLMRequest(request: RouterRequest): EnhancedLLMRequest {
    const requestType = detectRequestType(request.messages);
    return {
      messages: request.messages,
      provider: request.provider,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      stream: false, // Non-streaming for routing
      apiKeys: request.apiKeys,
      userId: request.userId,
      conversationId: request.requestId || `conv_${Date.now()}`,
      enableTools: request.enableTools ?? requestType === 'tool',
      enableSandbox: request.enableSandbox ?? requestType === 'sandbox',
      isSandboxCommand: requestType === 'sandbox',
      enableCircuitBreaker: true,
      retryOptions: {
        maxAttempts: 2,
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 5000
      }
    };
  }

  /**
   * Normalize Fast-Agent response
   * CRITICAL: Preserve all fields including success/error/fallback for proper routing logic
   */
  private normalizeFastAgentResponse(response: FastAgentResponse): any {
    return {
      success: response.success,
      content: response.content || '',
      data: {
        content: response.content || '',
        toolCalls: response.toolCalls,
        files: response.files,
        chainedAgents: response.chainedAgents,
        qualityScore: response.qualityScore,
        processingSteps: response.processingSteps,
        reflectionResults: response.reflectionResults,
        multiModalContent: response.multiModalContent,
        // Preserve these fields for routing logic to distinguish real responses from fallbacks/errors
        fallbackToOriginal: response.fallbackToOriginal,
        error: response.error
      }
    };
  }

  /**
   * Normalize n8n response
   */
  private normalizeN8nResponse(response: N8nAgentResponse): any {
    return {
      content: response.content || '',
      data: {
        content: response.content || '',
        chainedAgents: response.chainedAgents,
        iterations: response.iterations,
        classifications: response.classifications,
        optimizations: response.optimizations
      }
    };
  }

  /**
   * Normalize custom fallback response
   */
  private normalizeCustomFallbackResponse(response: CustomFallbackResponse): any {
    return {
      content: response.content,
      data: {
        content: response.content,
        provider: response.provider,
        model: response.model,
        isFallback: response.isFallback,
        fallbackReason: response.fallbackReason
      }
    };
  }

  /**
   * Normalize original system response
   */
  private normalizeOriginalResponse(response: any): any {
    // Preserve actual LLM provider/model from response metadata if available
    // This prevents showing 'original-system' as the provider when a real LLM provider was used
    const actualProvider = response.metadata?.actualProvider || response.provider || 'original-system';
    const actualModel = response.metadata?.actualModel || response.model;
    
    return {
      content: response.content || '',
      data: {
        ...response,
        provider: actualProvider,
        model: actualModel,
        actualProvider,
        actualModel,
      },
      metadata: {
        actualProvider,
        actualModel,
        fallbackChain: response.metadata?.fallbackChain,
      },
    };
  }

  /**
   * Update routing statistics
   */
  private updateStats(endpoint: string, success: boolean): void {
    const stats = this.routingStats.get(endpoint) || { success: 0, failures: 0 };
    
    if (success) {
      stats.success++;
    } else {
      stats.failures++;
    }
    
    this.routingStats.set(endpoint, stats);
  }

  /**
   * Get routing statistics
   */
  getStats(): Record<string, { success: number; failures: number; successRate: number }> {
    const stats: Record<string, any> = {};
    
    this.routingStats.forEach((value, key) => {
      const total = value.success + value.failures;
      stats[key] = {
        ...value,
        successRate: total > 0 ? (value.success / total) * 100 : 0
      };
    });
    
    return stats;
  }

  /**
   * Get available endpoints
   */
  getAvailableEndpoints(): string[] {
    return this.endpoints.map(e => e.name);
  }

  /**
   * Get quota status for all providers
   */
  getQuotaStatus() {
    return quotaManager.getAllQuotas();
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.routingStats.clear();
  }

  /**
   * Process tool request with unified registry
   */
  private async processToolRequest(request: RouterRequest): Promise<any> {
    return this.processToolRequestInternal(request, true);
  }

  private async processToolRequestInternal(request: RouterRequest, allowFallbackToComposio: boolean): Promise<any> {
    if (!request.userId) {
      return {
        content: 'User authentication required for tool access',
        data: {
          source: 'tool-execution',
          requiresAuth: true,
          error: 'User ID not provided'
        }
      };
    }

    try {
      // Try unified registry first
      const unifiedRegistry = getUnifiedToolRegistry();
      const toolDiscovery = getToolDiscoveryService();
      const errorHandler = getToolErrorHandler();

      // Detect tool intent from messages
      const detectionResult = this.detectToolIntent(request.messages);
      
      if (!detectionResult.detectedTool) {
        // No tool detected, fall through to composio
        if (allowFallbackToComposio) {
          return await this.processComposioRequestInternal(request, false);
        }
        return {
          content: 'No tool intent detected',
          data: { source: 'tool-execution', type: 'no_intent' }
        };
      }

      // Check authorization
      const isAuthorized = await toolAuthManager.isAuthorized(request.userId, detectionResult.detectedTool);
      if (!isAuthorized) {
        const provider = toolAuthManager.getRequiredProvider(detectionResult.detectedTool);
        if (provider) {
          const authUrl = toolAuthManager.getAuthorizationUrl(provider);
          return {
            content: `I need authorization to use ${detectionResult.detectedTool}. Please connect your account to proceed.`,
            data: {
              source: 'tool-execution',
              requiresAuth: true,
              authUrl,
              toolName: detectionResult.detectedTool,
              type: 'auth_required'
            }
          };
        }
      }

      // Execute via unified registry
      const result = await unifiedRegistry.executeTool(
        detectionResult.detectedTool,
        detectionResult.toolInput,
        {
          userId: request.userId,
          conversationId: request.requestId || `conv_${Date.now()}`,
          metadata: { sessionId: `session_${request.requestId}` }
        }
      );

      if (result.success) {
        // Record usage for statistics
        toolDiscovery.recordUsage(detectionResult.detectedTool, true, 0);
        
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
              sourceSystem: 'priority-router',
              requestId: request.requestId,
              conversationId: request.requestId,
            }),
            type: 'tool_execution'
          }
        };
      }

      // Handle errors with unified error handler
      const toolError = errorHandler.handleError(
        new Error(result.error || 'Tool execution failed'),
        detectionResult.detectedTool,
        detectionResult.toolInput
      );

      // Record failed usage
      toolDiscovery.recordUsage(detectionResult.detectedTool, false, 0);

      // If auth required, return auth URL
      if (toolError.category === 'authentication' || result.authRequired) {
        const provider = toolAuthManager.getRequiredProvider(detectionResult.detectedTool);
        const authUrl = provider ? toolAuthManager.getAuthorizationUrl(provider) : result.authUrl;
        return {
          content: `Authorization required for ${detectionResult.detectedTool}. Please connect your account.`,
          data: {
            source: 'tool-execution',
            requiresAuth: true,
            authUrl,
            toolName: detectionResult.detectedTool,
            type: 'auth_required'
          }
        };
      }

      // Fallback to Composio if unified registry failed
      if (allowFallbackToComposio) {
        console.log('[Router] unified registry failed, falling back to Composio');
        const fallback = await this.processComposioRequestInternal(request, false);
        if (fallback?.data?.type === 'auth_required' || fallback?.data?.type === 'composio_execution') {
          return fallback;
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
          type: 'error'
        }
      };
    } catch (error) {
      console.error('[Router] Tool processing error:', error);
      const errorHandler = getToolErrorHandler();
      const toolError = errorHandler.handleError(error, 'unknown');
      
      if (allowFallbackToComposio) {
        console.log('[Router] tool-execution error -> fallback composio-tools');
        const fallback = await this.processComposioRequestInternal(request, false);
        if (fallback?.data?.type === 'auth_required' || fallback?.data?.type === 'composio_execution') {
          return fallback;
        }
      }
      
      return {
        content: `Tool execution failed: ${toolError.message}`,
        data: {
          source: 'tool-execution',
          error: toolError.message,
          category: toolError.category,
          hints: toolError.hints,
          type: 'error'
        }
      };
    }
  }

  /**
   * Detect tool intent from messages (helper)
   */
  private detectToolIntent(messages: LLMMessage[]): { detectedTool: string | null; toolInput: any; error?: string } {
    // Simple extraction - in production use proper LLM-based tool extraction
    const lastMessage = messages[messages.length - 1];
    const content = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
    
    // Look for tool call patterns
    const toolCallMatch = content.match(/<tool\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool>/);
    if (toolCallMatch) {
      try {
        return {
          detectedTool: toolCallMatch[1],
          toolInput: JSON.parse(toolCallMatch[2] || '{}'),
        };
      } catch {
        return {
          detectedTool: toolCallMatch[1],
          toolInput: {},
          error: 'Invalid tool arguments JSON',
        };
      }
    }
    
    // Check for function call patterns
    const lastMessageAny = lastMessage as any;
    if (lastMessageAny?.tool_calls?.length > 0) {
      const toolCall = lastMessageAny.tool_calls[0];
      return {
        detectedTool: toolCall.function?.name || null,
        toolInput: toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {},
      };
    }

    return { detectedTool: null, toolInput: {} };
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
          error: 'User ID not provided'
        }
      };
    }

    try {
      const session = await sandboxBridge.getOrCreateSession(request.userId);

      const lastUserMessage = request.messages
        .filter(m => m.role === 'user')
        .pop()?.content;

      // Handle array content (multimodal messages) by extracting text parts
      let messageContent: string;
      if (typeof lastUserMessage !== 'string') {
        if (Array.isArray(lastUserMessage)) {
          messageContent = lastUserMessage
            .filter(part => typeof part === 'string' || (part as any).type === 'text')
            .map(part => typeof part === 'string' ? part : (part as any).text || '')
            .join(' ');
        } else {
          return {
            content: 'No user message found to process',
            data: {
              source: 'sandbox-agent',
              error: 'Invalid message format'
            }
          };
        }
      } else {
        messageContent = lastUserMessage;
      }

      if (!messageContent || messageContent.trim() === '') {
        return {
          content: 'No user message found to process',
          data: {
            source: 'sandbox-agent',
            error: 'No message content'
          }
        };
      }

      // Use the agent loop (LLM-driven tool calling), NOT raw command execution
      try {
        const { runAgentLoop } = await import('../orchestra/agent-loop');
        const result = await runAgentLoop({
          userMessage: messageContent,
          sandboxId: session.sandboxId,
          conversationHistory: request.messages,
        });

        return {
          content: result.response,
          data: {
            source: 'sandbox-agent',
            sandboxId: session.sandboxId,
            steps: result.steps,
            totalSteps: result.totalSteps,
            type: 'sandbox_execution'
          }
        };
      } catch (agentError: any) {
        // If the agent loop module is not available, fall back to informing the user
        console.warn('[Router] Sandbox agent loop not available:', agentError.message);
        return {
          content: 'The sandbox code execution module is not configured. Please set SANDBOX_PROVIDER and install the required SDK.',
          data: {
            source: 'sandbox-agent',
            error: 'sandbox_not_configured',
            type: 'error'
          }
        };
      }
    } catch (error: any) {
      console.error('[Router] Sandbox processing error:', error);
      return {
        content: `I encountered an error while executing in the sandbox: ${error.message}`,
        data: {
          source: 'sandbox-agent',
          error: error.message,
          type: 'error'
        }
      };
    }
  }
}

// Export singleton instance
export const priorityRequestRouter = new PriorityRequestRouter();
