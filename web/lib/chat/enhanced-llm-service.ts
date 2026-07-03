/**
 * Enhanced LLM Service with Fallback System
 *
 * Integrates the Enhanced API Client with the existing LLM service
 * to provide robust API communication with fallback mechanisms.
 *
 * Supports task-specific providers for optimized performance:
 * - EMBEDDING_PROVIDER for embeddings (e.g., mistral-embed)
 * - AGENT_PROVIDER for agent completions (e.g., Mistral)
 * - OCR_PROVIDER for OCR processing (e.g., Mistral OCR)
 * - etc.
 */

import { enhancedAPIClient, type RequestConfig, type APIResponse } from './enhanced-api-client';
import { wireFinishReasonSteer, wireFCGateZeroCallsSteer, emitFCGateZeroCallsLog, incompleteConfidenceThreshold } from '../orchestra/steer-service';
import { llmService, type LLMRequest, type LLMResponse, type StreamingResponse, type LLMMessage, PROVIDERS } from '../providers/llm-providers';
import { PROVIDER_FALLBACK_CHAINS, getConfiguredFallbackChain } from '../providers/provider-fallback-chains';
import { coordinateConcurrentFallback } from './llm-fallback-coordinator';
import { toolContextManager } from '../tools/tool-context-manager';
import { getToolManager, TOOL_REGISTRY } from '../tools';
import { sandboxBridge } from '../sandbox';
import { type LLMToolDefinition } from '../sandbox/providers/llm-provider';
import { getProviderForTask, getModelForTask } from '../config/task-providers';
import { normalizeSessionId } from '../virtual-filesystem/scope-utils';
import { advancedToolCallDispatcher } from '../tools/tool-integration/parsers/dispatcher';
import { callMCPToolFromAI_SDK, getMCPToolsForAI_SDK } from '../mcp/architecture-integration';
import { normalizeSchemaForAI } from '@bing/shared/agent/tool-schema';
import { chatLogger } from './chat-logger'
import { recordToolCallTelemetry, prepareTelemetryPayload } from '../errors/logging-utils';
import { chatRequestLogger } from './chat-request-logger';
import { isCLIProvider } from './vercel-ai-streaming';
import { recordRateLimitError } from '../providers/model-ranker';
import { sandboxMetrics } from '@/lib/backend/metrics';
import { classifyFailure, FailureType, TUNNEL_DNS_ERROR } from '@/lib/errors/failure-classifier';
import { is530Blacklisted, record530ErrorIfApplicable, maybeReset530OnSuccess } from '@/lib/orchestra/provider-530-tracker';
// PR-W -- DRY helper consumed at the success-return reset pair.
import { maybeResetBothTrackers } from '@/lib/orchestra/provider-530-tracker';
// PR-E: success-side reset for the 5xx-blacklist tracker; parallels maybeReset530OnSuccess.
import { maybeResetServerErrorOnSuccess } from '@/lib/orchestra/provider-server-error-tracker';
// PR-E: opt-in wire-up so 5xx server errors (parallel to 530 origin-unreachable) are tracked via
// record5xxErrorIfApplicable (5xx tracker) and record530ErrorIfApplicable
// (530 tracker) fire in tandem — pure record-or-noop helpers that NEVER
// cross-wipe each other's counter. Single source of truth at line 730.
import { isServerErrorBlacklisted, record5xxErrorIfApplicable } from '@/lib/orchestra/provider-server-error-tracker';

export interface EnhancedLLMRequest extends LLMRequest {
  fallbackProviders?: string[];
  retryOptions?: {
    maxAttempts?: number;
    backoffStrategy?: 'exponential' | 'linear' | 'fixed';
    baseDelay?: number;
    maxDelay?: number;
  };
  enableCircuitBreaker?: boolean;
  enableTools?: boolean;
  enableSandbox?: boolean;
  isSandboxCommand?: boolean; // Explicit flag for sandbox/command requests
  userId?: string;
  conversationId?: string;
  requestId?: string;
  /** VFS scope path for session-scoped file operations (e.g., "workspace/sessions/001") */
  scopePath?: string;
  task?: 'chat' | 'code' | 'embedding' | 'image' | 'tool' | 'agent' | 'ocr'; // Task-specific provider selection
  /** Request a bundled context pack (file tree + contents) for LLM */
  contextPack?: {
    format?: 'markdown' | 'xml' | 'json' | 'plain';
    maxTotalSize?: number;
    includePatterns?: string[];
    excludePatterns?: string[];
    maxLinesPerFile?: number;
  };
  /** Auto-attach relevant files to subsequent LLM calls as agent discovers areas to edit */
  autoAttachFiles?: boolean;
  /** Abort signal for cancelling streaming requests */
  signal?: AbortSignal;
  /** Request timeout in milliseconds (default: 90s) */
  timeoutMs?: number;
}

export interface LLMEndpointConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
}

export class EnhancedLLMService {
  private endpointConfigs: Map<string, LLMEndpointConfig> = new Map();
  private fallbackChains: Map<string, string[]> = new Map();
  private persistedKeysLoaded = false;

  constructor() {
    this.initializeEndpointConfigs();
    this.setupFallbackChains();
    this.startHealthMonitoring();
    // Lazy-load persisted API keys on first use (avoids async in constructor)
  }

  /**
   * Load persisted provider API keys from client-side secure storage.
   * Keys are stored in request-scoped configs so they're isolated per-request.
   */
  private async loadPersistedApiKeys(requestId?: string): Promise<void> {
    if (this.persistedKeysLoaded) return;
    this.persistedKeysLoaded = true;

    try {
      const { getStoredProviderApiKeys } = await import('../providers/provider-keys');
      const storedKeys = await getStoredProviderApiKeys();

      for (const [provider, apiKey] of Object.entries(storedKeys)) {
        if (apiKey && !this.endpointConfigs.has(provider)) {
          // Register as request-scoped config (tied to this "session" via requestId or a session key)
          this.registerUserProviderConfig(provider, apiKey, requestId || 'session-init');
        }
      }

      if (Object.keys(storedKeys).length > 0) {
        chatLogger.debug('Loaded persisted provider API keys', { requestId }, {
          providers: Object.keys(storedKeys),
        });
      }
    } catch (error) {
      // Non-fatal — if loading fails, fall back to server-side env vars only
      chatLogger.warn('Failed to load persisted provider keys, using server defaults', { requestId });
    }
  }

  /**
   * Public API: Get all stored provider API keys (without values for security).
   * Useful for UI to show which providers have user-configured keys.
   */
  async getStoredProviderKeyProviders(): Promise<string[]> {
    const { getStoredProviderApiKeys } = await import('../providers/provider-keys');
    const keys = await getStoredProviderApiKeys();
    return Object.keys(keys);
  }

  /**
   * Public API: Remove a stored provider API key.
   */
  async removeStoredProviderKey(provider: string): Promise<void> {
    const { removeProviderApiKey } = await import('../providers/provider-keys');
    await removeProviderApiKey(provider);
    // Also remove from request-scoped configs
    for (const key of this.requestScopedConfigs.keys()) {
      if (key.startsWith(`${provider}:`)) {
        this.requestScopedConfigs.delete(key);
        this.requestConfigTimestamps.delete(key);
      }
    }
  }

  private initializeEndpointConfigs(): void {
    const configs: LLMEndpointConfig[] = [
      {
        provider: 'openrouter',
        baseUrl: process.env.OPENROUTER_BASE_URL || process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY || '',
         models: PROVIDERS.openrouter.models.map(m => typeof m === 'string' ? m : m.id),
        priority: 1
      },
      {
        provider: 'chutes',
        baseUrl: 'https://llm.chutes.ai/v1',
        apiKey: process.env.CHUTES_API_KEY || '',
         models: PROVIDERS.chutes.models.map(m => typeof m === 'string' ? m : m.id),
        priority: 2
      },
      {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
         models: PROVIDERS.anthropic.models.map(m => typeof m === 'string' ? m : m.id),
        priority: 3
      },
      {
        provider: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: process.env.GOOGLE_API_KEY || '',
         models: PROVIDERS.google.models.map(m => typeof m === 'string' ? m : m.id),
        priority: 4
      },
      {
        provider: 'mistral',
        baseUrl: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
        apiKey: process.env.MISTRAL_API_KEY || '',
         models: PROVIDERS.mistral.models.map(m => typeof m === 'string' ? m : m.id),
        priority: 5
      },
      {
        provider: 'github',
        baseUrl: process.env.GITHUB_MODELS_BASE_URL || 'https://models.inference.ai.azure.com',
        apiKey: process.env.GITHUB_MODELS_API_KEY || process.env.AZURE_OPENAI_API_KEY || '',
         models: PROVIDERS.github.models.map(m => typeof m === 'string' ? m : m.id),
        priority: 6
      },
      {
        provider: 'portkey',
        baseUrl: 'https://api.portkey.ai/v1',
        apiKey: process.env.PORTKEY_API_KEY || '',
         models: PROVIDERS.portkey.models.map(m => typeof m === 'string' ? m : m.id),
        priority: 7
      },
      {
        provider: 'zen',
        baseUrl: process.env.ZEN_BASE_URL || 'https://api.zen.ai/v1',
        apiKey: process.env.ZEN_API_KEY || '',
         models: PROVIDERS.zen.models.map(m => typeof m === 'string' ? m : m.id),
        priority: 8
      },
      {
        provider: 'nvidia',
        baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        apiKey: process.env.NVIDIA_API_KEY || '',
         models: PROVIDERS.nvidia.models.map(m => typeof m === 'string' ? m : m.id),
        priority: 9
      },
      {
        provider: 'groq',
        baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY || '',
         models: (PROVIDERS.groq?.models || []).map(m => typeof m === 'string' ? m : m.id),
        priority: 10
      },
      {
        provider: 'together',
        baseUrl: process.env.TOGETHER_BASE_URL || 'https://api.together.xyz/v1',
        apiKey: process.env.TOGETHER_API_KEY || '',
         models: (PROVIDERS.together?.models || []).map(m => typeof m === 'string' ? m : m.id),
        priority: 11
      },
      {
        provider: 'deepinfra',
        baseUrl: process.env.DEEPINFRA_BASE_URL || 'https://api.deepinfra.com/v1/openai',
        apiKey: process.env.DEEPINFRA_API_KEY || '',
         models: (PROVIDERS.deepinfra?.models || []).map(m => typeof m === 'string' ? m : m.id),
        priority: 12
      },
      {
        provider: 'fireworks',
        baseUrl: process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1',
        apiKey: process.env.FIREWORKS_API_KEY || '',
         models: (PROVIDERS.fireworks?.models || []).map(m => typeof m === 'string' ? m : m.id),
        priority: 13
      },
      {
        provider: 'ninerouter',
        baseUrl: process.env.NINEROUTER_BASE_URL || 'http://ninerouter:3000/v1',
        apiKey: process.env.NINEROUTER_API_KEY || process.env.QUAZ_API_KEY || '',
         models: (PROVIDERS.ninerouter?.models || []).map(m => typeof m === 'string' ? m : m.id),
        priority: 14
      },
    ];

    configs.forEach(config => {
      if (config.apiKey) {
        this.endpointConfigs.set(config.provider, config);
      }
    });
  }

  /**
   * Register a provider config for a user-provided API key.
   * 
   * SECURITY: Instead of storing in shared singleton state (which causes cross-request
   * credential leakage), this stores in a request-scoped Map keyed by request context.
   * The config is only used for the current request chain and never persists across requests.
   * 
   * For client-side persistence, API keys should be stored in the user's browser localStorage
   * or indexedDB, and passed with each request via the apiKeys parameter.
   */
  private requestScopedConfigs: Map<string, LLMEndpointConfig> = new Map();
  private requestConfigTimestamps: Map<string, number> = new Map();
  private static readonly REQUEST_CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly REQUEST_CONFIG_MAX_ENTRIES = 1000; // Prevent memory abuse
  
  private registerUserProviderConfig(provider: string, userApiKey: string, requestId?: string): void {
    const providerDef = PROVIDERS[provider];
    if (!providerDef) {
      chatLogger.warn('Unknown provider, cannot register config', { provider });
      return;
    }

    // Get base URL from env var or use default based on provider
    const baseUrl = this.getDefaultBaseUrlForProvider(provider);

    // SECURITY: Use request-scoped key to avoid cross-request credential leakage
    // The key includes requestId to ensure isolation
    const configKey = requestId ? `${provider}:${requestId}` : `${provider}:anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const config: LLMEndpointConfig = {
      provider,
      baseUrl,
      apiKey: userApiKey,
       models: (providerDef.models || []).map(m => typeof m === 'string' ? m : m.id),
      priority: 99 // Low priority for user-provided configs
    };

    // Enforce max entries to prevent memory abuse
    if (this.requestScopedConfigs.size >= EnhancedLLMService.REQUEST_CONFIG_MAX_ENTRIES) {
      this.cleanupExpiredConfigs();
    }

    this.requestScopedConfigs.set(configKey, config);
    this.requestConfigTimestamps.set(configKey, Date.now());
    chatLogger.debug('Registered request-scoped provider config', { provider, requestId });
  }

  /**
   * Clean up expired request-scoped configs to prevent memory leaks.
   */
  private cleanupExpiredConfigs(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.requestConfigTimestamps) {
      if (now - timestamp > EnhancedLLMService.REQUEST_CONFIG_TTL_MS) {
        this.requestScopedConfigs.delete(key);
        this.requestConfigTimestamps.delete(key);
      }
    }
  }

  /**
   * Get request-scoped provider config if available and not expired, otherwise fall back to shared config.
   */
  private getProviderConfigForRequest(provider: string, requestId?: string): LLMEndpointConfig | undefined {
    // First try request-scoped config
    if (requestId) {
      const requestKey = `${provider}:${requestId}`;
      const requestConfig = this.requestScopedConfigs.get(requestKey);
      if (requestConfig) {
        // Check if expired
        const timestamp = this.requestConfigTimestamps.get(requestKey);
        if (timestamp && Date.now() - timestamp <= EnhancedLLMService.REQUEST_CONFIG_TTL_MS) {
          return requestConfig;
        }
        // Expired - clean up
        this.requestScopedConfigs.delete(requestKey);
        this.requestConfigTimestamps.delete(requestKey);
      }
    }
    // Fall back to shared config (server-side env vars only)
    return this.endpointConfigs.get(provider);
  }

  /**
   * Get default base URL for a provider
   */
  private getDefaultBaseUrlForProvider(provider: string): string {
    const baseUrlMap: Record<string, string> = {
      'openai': process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      'anthropic': 'https://api.anthropic.com/v1',
      'google': 'https://generativelanguage.googleapis.com/v1beta',
      'mistral': process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
      'nvidia': process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      'openrouter': process.env.OPENROUTER_BASE_URL || process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
      'github': process.env.GITHUB_MODELS_BASE_URL || 'https://models.inference.ai.azure.com',
      'groq': 'https://api.groq.com/openai/v1',
      'together': 'https://api.together.xyz/v1',
      'deepinfra': 'https://api.deepinfra.com/v1/openai',
      'fireworks': 'https://api.fireworks.ai/inference/v1',
      'xai': process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
      'anyscale': 'https://api.endpoints.anyscale.com/v1',
      'lepton': 'https://<your-workspace>.lepton.run/api/v1',
      'chutes': 'https://llm.chutes.ai/v1',
      'portkey': 'https://api.portkey.ai/v1',
      'zen': process.env.ZEN_BASE_URL || 'https://api.zen.ai/v1',
      'ninerouter': process.env.NINEROUTER_BASE_URL || 'http://ninerouter:3000/v1',
    };
    return baseUrlMap[provider] || `https://api.${provider}.com/v1`;
  }

  private setupFallbackChains(): void {
    // Use centralized fallback chains from provider-fallback-chains.ts
    // This ensures all paths (enhanced-llm-service, unified-agent, etc.)
    // use the same fallback provider order.
    // Filter to providers supported by llmService.generateResponse (non-streaming path)
    const nonStreamingSupportedProviders = [
      'openai', 'anthropic', 'google', 'cohere', 'together', 'replicate',
      'portkey', 'openrouter', 'chutes', 'mistral', 'github', 'zen',
      'opencode', 'antigravity'
    ];
    for (const [provider, chain] of Object.entries(PROVIDER_FALLBACK_CHAINS)) {
      const compatibleChain = chain.filter(fallbackProvider =>
        nonStreamingSupportedProviders.includes(fallbackProvider)
      );
      this.fallbackChains.set(provider, compatibleChain);
    }
  }

  private startHealthMonitoring(): void {
    const endpoints = Array.from(this.endpointConfigs.values()).map(config => config.baseUrl);
    enhancedAPIClient.startHealthMonitoring(endpoints, 60000);
  }

  async generateResponse(request: EnhancedLLMRequest): Promise<LLMResponse> {
    const { enableTools, enableSandbox, userId, conversationId, requestId, provider, fallbackProviders, retryOptions, enableCircuitBreaker = true, task, apiKeys, contextPack, autoAttachFiles, ...llmRequest } = request;
    const requestStartTime = Date.now();

    // Load persisted API keys on first use (lazy, async-safe)
    await this.loadPersistedApiKeys(requestId);

    // Use explicitly passed provider first, then task-specific provider, then default
    const actualProvider = provider || (task ? getProviderForTask(task) : getProviderForTask('chat'));
    const actualModel = task
      ? getModelForTask(task, llmRequest.model)
      : llmRequest.model || 'default';  // Default model if none specified

    // CRITICAL FIX: Dynamically register provider if user provided API key but provider isn't configured.
    // Uses request-scoped storage to prevent cross-request credential leakage.
    // Also persist the key for future requests if it's new.
    if (!this.getProviderConfigForRequest(actualProvider, requestId)) {
      const userApiKey = apiKeys?.[actualProvider];
      if (userApiKey && PROVIDERS[actualProvider]) {
        this.registerUserProviderConfig(actualProvider, userApiKey, requestId);
        chatLogger.debug('Dynamically registered request-scoped provider config', { requestId, provider: actualProvider });

        // Persist for future use (encrypted, client-side)
        const { saveProviderApiKey } = await import('../providers/provider-keys');
        await saveProviderApiKey(actualProvider, userApiKey);
      }
    }

    // Override API key with user-provided key if available for this provider
    const userApiKey = apiKeys?.[actualProvider];
    if (userApiKey) {
      chatLogger.debug('Using user-provided API key', { requestId, provider: actualProvider });
    }

    // Generate smart context pack if requested — intelligently select and rank files
    let contextPackBundle = '';
    if (contextPack && userId && conversationId) {
      try {
        const { generateSmartContext } = await import('@/lib/virtual-filesystem/smart-context');
        const rootPath = normalizeSessionId(conversationId) || '/';
        
        // O(1) Session File Lookup: Use incremental tracker instead of re-scanning messages
        let recentFiles: string[] = [];
        try {
          const { getSessionFiles } = await import('@/lib/virtual-filesystem/session-file-tracker');
          recentFiles = getSessionFiles(conversationId, 10); // O(1) lookup
        } catch (error: any) {
          chatLogger.debug('Session file lookup failed', { error: error.message });
        }
        
        const pack = await generateSmartContext({
          userId,
          prompt: (llmRequest.messages && llmRequest.messages.length > 0 && typeof llmRequest.messages[llmRequest.messages.length - 1]?.content === 'string')
            ? (llmRequest.messages[llmRequest.messages.length - 1].content as any)
            : '',
          conversationId,
          explicitFiles: contextPack.includePatterns || [],
          recentSessionFiles: recentFiles,
          maxTotalSize: contextPack.maxTotalSize || 500000,
          format: contextPack.format || 'markdown',
          maxLinesPerFile: contextPack.maxLinesPerFile || 500,
        });
        
        contextPackBundle = pack.bundle;
        chatLogger.debug('Smart context pack generated', { requestId }, {
          filesIncluded: pack.filesIncluded,
          totalFilesInVfs: pack.totalFilesInVfs,
          vfsIsEmpty: pack.vfsIsEmpty,
          warnings: pack.warnings.length,
        });
      } catch (error: any) {
        chatLogger.warn('Smart context pack generation failed, continuing without it', { requestId }, {
          error: error.message,
        });
      }
    }

    // Inject context pack bundle into system message if available
    let processedMessages = llmRequest.messages;
    if (contextPackBundle) {
      processedMessages = [
        ...llmRequest.messages,
      ];
      // Prepend context pack to first system message or add as new system message
      const systemMsgIdx = processedMessages.findIndex(m => m.role === 'system');
      const contextFormat = contextPack?.format?.toUpperCase() || 'JSON';
      const contextPrefix = `\n\n--- WORKSPACE CONTEXT (${contextFormat}) ---\n${contextPackBundle}\n--- END CONTEXT ---\n`;
      if (systemMsgIdx >= 0) {
        const sysMsg = processedMessages[systemMsgIdx];
        processedMessages[systemMsgIdx] = {
          ...sysMsg,
          content: typeof sysMsg.content === 'string'
            ? sysMsg.content + contextPrefix
            : sysMsg.content,
        };
      } else {
        processedMessages = [
          { role: 'system' as const, content: contextPrefix },
          ...processedMessages,
        ];
      }
    }

    // Auto-inject core powers as a separate USER message (preserves prompt caching)
    // Only ubiquitous, always-beneficial powers (e.g. URL scraping) are injected proactively.
    // All other powers are discovered on-demand via power_list/power_read tools.
    try {
      const { appendAutoInjectPowers } = await import('@/lib/powers');
      const src = llmRequest.messages || processedMessages;
      const lastUserMsg = [...src].reverse().find(m => m.role === 'user');
      const lastUserText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      appendAutoInjectPowers(processedMessages, lastUserText);
    } catch (powersErr: any) {
      chatLogger.debug('Auto-inject powers skipped (generateResponse)', { error: powersErr?.message });
    }

    chatLogger.debug('Enhanced LLM service processing request', { requestId, provider: actualProvider, model: actualModel, userId }, {
      task,
      enableTools,
      enableSandbox,
      fallbackProviders: fallbackProviders?.length,
      usesUserApiKey: !!userApiKey,
      hasContextPack: !!contextPackBundle,
      autoAttachFiles: !!autoAttachFiles,
    });

    // Compute session-aware scopePath for VFS tools
    const sessionIdFromConv = normalizeSessionId(conversationId || '');
    const computedScopePath = request.scopePath 
      || (sessionIdFromConv ? `workspace/sessions/${sessionIdFromConv}` : 'workspace/sessions/000');

    // If tools are enabled and user ID is provided, process tools
    if (enableTools && userId && conversationId) {
      const toolResult = await this.processToolRequest(
        llmRequest.messages,
        userId,
        conversationId,
        computedScopePath
      );

      if (toolResult.requiresAuth && toolResult.authUrl) {
        chatLogger.info('Tool auth required', { requestId, userId }, {
          toolName: toolResult.toolName,
        });
        return {
          content: `I need authorization to use ${toolResult.toolName}. Please connect your account to proceed.`,
          tokensUsed: 0,
          finishReason: 'tool_auth_required',
          timestamp: new Date(),
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          metadata: {
            requiresAuth: true,
            authUrl: toolResult.authUrl,
            toolName: toolResult.toolName
          }
        };
      }

      if (toolResult.toolCalls && toolResult.toolCalls.length > 0) {
        // Store tool results in request metadata instead of injecting synthetic messages
        // This avoids provider compatibility issues (Anthropic rejects 'tool' role, Google maps it incorrectly)
        const updatedRequest = {
          ...llmRequest,
          provider: actualProvider,
          model: actualModel,
          toolCalls: toolResult.toolCalls,
          toolResults: toolResult.toolResults,
          // Pass user API key to provider after tool execution
          apiKey: userApiKey,
        };

        return await this.callProviderWithEnhancedClient(actualProvider, updatedRequest, retryOptions, enableCircuitBreaker, requestId);
      }
    }

    // Only process sandbox request if explicitly flagged as a sandbox/command request
    // This prevents short-circuiting normal LLM flow for all messages when sandbox is enabled
    if (request.isSandboxCommand && userId && conversationId) {
      return await this.processSandboxRequest(request, userId, conversationId);
    }

    const postProcessToolCalls = async (response: LLMResponse): Promise<LLMResponse> => {
      if (!enableTools || !userId || !conversationId) {
        return response;
      }

      return this.executeModelToolCallsFromResponse(response, userId, conversationId, computedScopePath);
    };

    // Try primary provider first
    try {
      const fullRequest = {
        ...llmRequest,
        messages: processedMessages,
        provider: actualProvider,
        model: actualModel,
        // Use user's API key if provided, otherwise the provider config's key will be used
        apiKey: userApiKey,
      };

      // Log request start for telemetry
      await chatRequestLogger.logRequestStart(
        requestId || `llm-${Date.now()}`,
        userId || 'anonymous',
        actualProvider,
        actualModel,
        fullRequest.messages,
        fullRequest.stream || false
      );
      
      // The enhanced-llm-service now returns cleanly on success or throws categorized errors.
      // The UnifiedAgentService orchestrates fallbacks based on these categorized errors.
      try {
        const response = await this.callProviderWithEnhancedClient(actualProvider, fullRequest, retryOptions, enableCircuitBreaker, requestId);
        
        // Record response success telemetry with correct fallback tracking
        const latencyMs = Date.now() - requestStartTime;
        // Use response metadata's actual provider/model if available (set by llm-providers after fallback)
        const recordedProvider = response.metadata?.actualProvider || actualProvider;
        const recordedModel = response.metadata?.actualModel || actualModel;
        const { redactedArgs: successArgs, originStack: successStack } = prepareTelemetryPayload({
          args: {
            provider: recordedProvider,
            model: recordedModel,
            latencyMs,
            contentLength: response.content?.length || 0,
            success: true,
            fallbackOccurred: response.metadata?.actualProvider && response.metadata.actualProvider !== actualProvider,
          },
        });
        recordToolCallTelemetry({
          toolCallId: requestId || null,
          redactedArgs: successArgs,
          originStack: successStack,
        }).catch((err) => { chatLogger.debug(`Failed to record response success telemetry: ${err}`); });

        return await postProcessToolCalls(response);
      } catch (primaryError: any) {
        // Enhance error first to get the failureType
        const enhancedError = this.enhanceError(primaryError, actualProvider, actualModel);
        
        // Record error telemetry with actual provider/model (may have fallen back before failure)
        const latencyMs = Date.now() - requestStartTime;
        const { redactedArgs: errorArgs, originStack: errorStack } = prepareTelemetryPayload({
          args: {
            provider: actualProvider,
            model: actualModel,
            latencyMs,
            errorType: enhancedError.failureType || 'unknown',
            success: false,
            totalAttempts: (primaryError as any).totalAttempts || 1,
          },
        });
        recordToolCallTelemetry({
          toolCallId: requestId || null,
          redactedArgs: errorArgs,
          originStack: errorStack,
        }).catch((err) => { chatLogger.debug(`Failed to record error telemetry: ${err}`); });

        // Try fallback chain before giving up to the response-router.
        // Unlike the streaming path (which already iterates fallbacks),
        // the non-streaming path was falling back to the response-router's
        // endpoint chain (original-system → n8n → custom-fallback → etc.),
        // which are completely different services — not LLM provider fallbacks.
        // This wires the centralized fallback chain so when the primary
        // provider fails (e.g., ninerouter tunnel is stale), we immediately
        // try the configured fallback providers (nvidia, mistral, google, ...)
        // before handing control back to the response-router.
        const fallbackChain = getConfiguredFallbackChain(actualProvider);
        let fallbackAttempted = false;

        if (fallbackChain.length > 0) {
          for (const fallbackProvider of fallbackChain) {
            // FIX: Skip providers blacklisted for 2+ consecutive 530 errors
            if (is530Blacklisted(fallbackProvider) || isServerErrorBlacklisted(fallbackProvider)) {
                // PR-E: 5xx-blacklist iteration skip (paired with 530 skip). The provider
                // is excluded from the chain regardless of whether the cause was origin-unreachable
                // (530/1016/tunnel-DNS) or generic 5xx (500/502/503/504).
                // is530Blacklisted(...) || isServerErrorBlacklisted(...) share the same iteration-step
                // fallback: skip and move to the next provider in the chain.
              chatLogger.warn('530 BLACKLISTED in enhanced-llm-service, skipping fallback', { fallbackProvider });
              continue;
            }

            const fallbackConfig = this.getProviderConfigForRequest(fallbackProvider, requestId);
            if (!fallbackConfig) continue;

            const compatibleModel = this.findCompatibleModel(actualModel, fallbackConfig.models);
            if (!compatibleModel) continue;

            try {
              chatLogger.info('Falling back to provider (non-streaming)', {
                requestId,
                primaryProvider: actualProvider,
                fallbackProvider,
                model: compatibleModel,
              });

              const fallbackApiKey = apiKeys?.[fallbackProvider] || fallbackConfig.apiKey || undefined;
              const fallbackRequest = {
                ...fullRequest,
                provider: fallbackProvider,
                model: compatibleModel,
                apiKey: fallbackApiKey,
              };

              const response = await this.callProviderWithEnhancedClient(
                fallbackProvider,
                fallbackRequest,
                retryOptions,
                enableCircuitBreaker,
                requestId,
              );

              // Record fallback success telemetry
              const fallbackLatencyMs = Date.now() - requestStartTime;
              const { redactedArgs: fallbackArgs, originStack: fallbackStack } = prepareTelemetryPayload({
                args: {
                  provider: fallbackProvider,
                  model: compatibleModel,
                  latencyMs: fallbackLatencyMs,
                  contentLength: response.content?.length || 0,
                  success: true,
                  fallbackOccurred: true,
                },
              });
              recordToolCallTelemetry({
                toolCallId: requestId || null,
                redactedArgs: fallbackArgs,
                originStack: fallbackStack,
              }).catch((err) => { chatLogger.debug(`Failed to record fallback telemetry: ${err}`); });

              sandboxMetrics.fallbackSuccessTotal.inc({
                layer: 'layer1',
                primary_provider: actualProvider,
                fallback_provider: fallbackProvider,
              });
              chatLogger.info('Fallback provider succeeded (non-streaming)', {
                requestId,
                fallbackProvider,
                model: compatibleModel,
                latencyMs: fallbackLatencyMs,
              });

              return await postProcessToolCalls(response);
        } catch (fallbackError: any) {
          fallbackAttempted = true;
          // PR-E + PR-H: both trackers fire here in parallel — pure
          // record-or-noop, NEVER cross-wipe each other's Map. Non-
          // matching error signatures (4xx, 5xx-mismatch, 530-mismatch)
          // leave both counters untouched; only the corresponding
          // success-path helpers decrement them on a successful
          // round-trip (gated by ENABLE_*_RESET_ON_SUCCESS).
          record5xxErrorIfApplicable(fallbackProvider, fallbackError);
          record530ErrorIfApplicable(fallbackProvider, fallbackError);
          chatLogger.warn('Fallback provider failed (non-streaming)', {
                requestId,
                fallbackProvider,
                error: fallbackError.message,
              });
              // Continue to next fallback in chain
            }
          }
        }

        // All fallbacks exhausted (or no fallbacks configured).
        // Log the failure and re-throw with the original enhanced error
        // so the response-router can try its own endpoint fallbacks.
        if (fallbackAttempted) {
          chatLogger.warn('All fallback providers failed (non-streaming)', {
            requestId,
            primaryProvider: actualProvider,
            attemptedFallbacks: fallbackChain,
          });
        }

        // Re-throw with categorization so the Orchestrator knows how to handle the retry/fallback
        throw enhancedError;
      }
    } catch (outerError: any) {
      throw outerError;
    }
  }

  async *generateStreamingResponse(request: any) {
    const { provider, fallbackProviders, requestId, apiKeys, contextPack, ...llmRequest } = request;
    const primaryProvider = provider || getProviderForTask('chat');
    const streamStartTime = Date.now();

    // CRITICAL FIX: CLI providers (opencode-cli, pi, kilocode, etc.) spawn local binaries
    // and have their own streaming logic. They must NOT go through Vercel AI SDK.
    if (isCLIProvider(primaryProvider)) {
      chatLogger.info('[CLI-PROVIDER] Routing CLI provider to binary spawn path', {
        requestId,
        provider: primaryProvider,
        model: llmRequest.model,
      });

      yield* this.streamWithCLIBinary(primaryProvider, request, requestId);
      return;
    }

    // Load persisted API keys on first use (lazy, async-safe)
    await this.loadPersistedApiKeys(requestId);

    // CRITICAL FIX: Dynamically register provider if user provided API key but provider isn't configured.
    // Uses request-scoped storage to prevent cross-request credential leakage.
    // Also persist the key for future requests if it's new.
    if (!this.getProviderConfigForRequest(primaryProvider, requestId)) {
      const userApiKey = apiKeys?.[primaryProvider];
      if (userApiKey && PROVIDERS[primaryProvider]) {
        this.registerUserProviderConfig(primaryProvider, userApiKey, requestId);
        chatLogger.debug('Dynamically registered request-scoped provider config (streaming)', { requestId, provider: primaryProvider });

        // Persist for future use (encrypted, client-side)
        const { saveProviderApiKey } = await import('../providers/provider-keys');
        await saveProviderApiKey(primaryProvider, userApiKey);
      }
    }

    // Use user-provided API key if available for this provider
    const userApiKey = apiKeys?.[primaryProvider];
    if (userApiKey) {
      chatLogger.debug('Using user-provided API key (streaming)', { requestId, provider: primaryProvider });
    }

    // Generate smart context pack if requested — intelligently select and rank files
    let contextPackBundle = '';
    if (contextPack && request.userId && request.conversationId) {
      try {
        const { generateSmartContext } = await import('@/lib/virtual-filesystem/smart-context');
        const rootPath = normalizeSessionId(request.conversationId) || '/';
        
        // O(1) Session File Lookup: Use incremental tracker instead of re-scanning messages
        let recentFiles: string[] = [];
        try {
          const { getSessionFiles } = await import('@/lib/virtual-filesystem/session-file-tracker');
          recentFiles = getSessionFiles(request.conversationId || '', 10); // O(1) lookup
        } catch (error: any) {
          chatLogger.debug('Session file lookup failed (streaming)', { error: error.message });
        }
        
        const pack = await generateSmartContext({
          userId: request.userId,
          prompt: (llmRequest.messages && llmRequest.messages.length > 0 && typeof llmRequest.messages[llmRequest.messages.length - 1]?.content === 'string')
            ? (llmRequest.messages[llmRequest.messages.length - 1].content as any)
            : '',
          conversationId: request.conversationId,
          explicitFiles: contextPack.includePatterns || [],
          recentSessionFiles: recentFiles,
          maxTotalSize: contextPack.maxTotalSize || 500000,
          format: contextPack.format || 'markdown',
          maxLinesPerFile: contextPack.maxLinesPerFile || 500,
        });
        
        contextPackBundle = pack.bundle;
        chatLogger.debug('Smart context pack generated (streaming)', { requestId }, {
          filesIncluded: pack.filesIncluded,
          totalFilesInVfs: pack.totalFilesInVfs,
          vfsIsEmpty: pack.vfsIsEmpty,
          warnings: pack.warnings.length,
        });
      } catch (error: any) {
        chatLogger.warn('Smart context pack generation failed (streaming)', { requestId }, {
          error: error.message,
        });
      }
    }

    // Inject context pack into system message
    let processedMessages = llmRequest.messages;
    if (contextPackBundle) {
      const systemMsgIdx = processedMessages.findIndex(m => m.role === 'system');
      const contextFormat = contextPack.format?.toUpperCase() || 'JSON';
      const contextPrefix = `\n\n--- WORKSPACE CONTEXT (${contextFormat}) ---\n${contextPackBundle}\n--- END CONTEXT ---\n`;
      if (systemMsgIdx >= 0) {
        const sysMsg = processedMessages[systemMsgIdx];
        processedMessages = processedMessages.map((m, i) =>
          i === systemMsgIdx
            ? { ...m, content: typeof m.content === 'string' ? m.content + contextPrefix : m.content }
            : m
        );
      } else {
        processedMessages = [{ role: 'system' as const, content: contextPrefix }, ...processedMessages];
      }
    }

    // Auto-inject core powers as a separate USER message (preserves prompt caching)
    try {
      const { appendAutoInjectPowers } = await import('@/lib/powers');
      const src = llmRequest.messages || processedMessages;
      const lastUserMsg = [...src].reverse().find(m => m.role === 'user');
      const lastUserText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      appendAutoInjectPowers(processedMessages, lastUserText);
    } catch (powersErr: any) {
      chatLogger.debug('Auto-inject powers skipped (streaming)', { error: powersErr?.message });
    }

    try {
      // Map provider names to Vercel AI SDK identifiers.
      // - Direct Vercel AI SDK providers use their own name.
      // - OpenAI-compatible providers keep their own name — getVercelModel() resolves
      //   the correct apiKey/baseURL via OPENAI_COMPATIBLE_PROVIDERS config.
      // - Mapping them all to 'openai' caused the wrong API key (OPENAI_API_KEY)
      //   and wrong baseURL to be used.
      const vercelProviderMap: Record<string, import('./vercel-ai-streaming').VercelProvider | string> = {
        // Direct Vercel AI SDK providers
        'openai': 'openai',
        'anthropic': 'anthropic',
        'google': 'google',
        'mistral': 'mistral',
        'openrouter': 'openrouter',
        // OpenAI-compatible providers — keep original name for correct key/baseURL resolution
        'chutes': 'chutes',
        'github': 'github',
        'zen': 'zen',
        'nvidia': 'nvidia',
        'together': 'together',
        'groq': 'groq',
        'fireworks': 'fireworks',
        'xai': 'xai',
        'anyscale': 'anyscale',
        'deepinfra': 'deepinfra',
        'lepton': 'lepton',
        // Custom providers (via compatibility wrapper)
        'zo': 'zo',
      };

      const vercelProvider = vercelProviderMap[primaryProvider];

      // Extract system messages BEFORE sanitization so they can be passed
      // via the `system` parameter of streamWithVercelAI's new `system` option.
      // This avoids the fragile round-trip:
      //   extract → sanitize → re-attach → convertMessages → re-extract → system param
      let systemPrompt = '';
      try {
        const systemMsgs = (processedMessages || []).filter((m: any) => m?.role === 'system');
        systemPrompt = systemMsgs
          .map((m: any) => (typeof m.content === 'string' ? m.content : ''))
          .filter(Boolean)
          .join('\n\n');
      } catch { /* best effort */ }

      // Save a copy with system messages for the auto-re-prompt path.
      // streamWithServerAutoRePrompt builds re-prompt message arrays from
      // the messages parameter and calls streamWithVercelAI without a system
      // option, so system content must remain in the messages array for that path.
      const messagesForAutoRePrompt = [...processedMessages];

      if (vercelProvider) {
        try {
          const { sanitizeMessages } = await import('./message-sanitizer');
          processedMessages = sanitizeMessages(processedMessages || []);
        } catch (err: any) {
          chatLogger.debug('Streaming message sanitization failed, continuing with coercion', { requestId, error: err?.message });
          processedMessages = (processedMessages || [])
            .filter((m: any) => m?.role !== 'system')  // Strip system messages even in fallback
            .map((m: any) => ({
              role: (m?.role && m.role !== 'system') ? m.role : 'user',
              content: typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content || ''),
            }));
        }

        // Build tools if enabled — Vercel AI SDK handles tool calling natively
        let vercelTools: Record<string, any> | undefined;
        
        // CRITICAL FIX: Always build tools when file operations are possible.
        // Previously required BOTH enableTools AND userId to be truthy, but
        // anonymous users (userId from cookie) and auto-detected tool requests
        // were being excluded, causing "No tools provided" warnings.
        const shouldBuildTools = request.enableTools !== false;  // Default true unless explicitly disabled
        
        if (shouldBuildTools) {
          const effectiveUserId = request.userId || 'anonymous';  // Allow anonymous users
          try {
            const { getAllTools } = await import('./vercel-ai-tools');
            // Compute session-aware scopePath for VFS tools
            const sessionIdFromConv = normalizeSessionId(request.conversationId || '');
            const computedScopePath = (request as any).scopePath
              || (sessionIdFromConv ? `workspace/sessions/${sessionIdFromConv}` : 'workspace/sessions/000');

            // Extract last user message for trigger-matching powers (lazy tool loading)
            const lastUserMsgForPowers = [...(llmRequest.messages || [])].reverse().find(m => m.role === 'user');
            const lastUserMessageForPowers = typeof lastUserMsgForPowers?.content === 'string'
              ? lastUserMsgForPowers.content
              : '';

            vercelTools = await getAllTools({
              userId: effectiveUserId,
              conversationId: request.conversationId,
              sessionId: sessionIdFromConv,
              requestId,
              scopePath: computedScopePath,  // Session-aware path for VFS tools
              lastUserMessage: lastUserMessageForPowers,  // For power trigger-matching
            });

            chatLogger.info('[TOOLS] ✅ Tools built successfully', {
              requestId,
              toolCount: Object.keys(vercelTools).length,
              toolNames: Object.keys(vercelTools),
              userId: effectiveUserId,
              wasAnonymous: !request.userId,
            });

            // FIX: Merge VFS MCP tools (write_file, read_file, apply_diff, etc.)
            // into the Vercel AI SDK tool set so the LLM can call them during streaming.
            try {
              const { getVFSToolDefinitions, getVFSTool, runWithToolContext } = await import('../mcp/vfs-mcp-tools');
              const { tool: createTool } = await import('ai');
              const vfsToolDefs = getVFSToolDefinitions();
              for (const toolDef of vfsToolDefs) {
                const toolName = toolDef.function.name;
                // Don't overwrite existing tools
                if (!vercelTools![toolName]) {
                  vercelTools![toolName] = createTool({
                    description: toolDef.function.description,
                    // AI SDK v6 uses `inputSchema`, not `parameters`.
                    inputSchema: normalizeSchemaForAI(toolDef.function.parameters),
                    execute: async (args: Record<string, any>) => {
                      const vfsTool = getVFSTool(toolName);
                      if (!vfsTool) {
                        throw new Error(`Unknown VFS tool: ${toolName}`);
                      }

                      // DEBUG: Log scopePath being passed to tool
                      chatLogger.info('[VFS MCP] Tool invoked (streaming path)', {
                        tool: toolName,
                        userId: request.userId,
                        requestId,
                        scopePath: (request as any).scopePath,
                        args: Object.keys(args || {}),
                        path: args?.path || args?.files?.map((f: any) => f.path)?.join(', ') || undefined,
                      });

                      const result = await runWithToolContext(
                        {
                          userId: request.userId || 'anonymous',
                          sessionId: sessionIdFromConv,
                          scopePath: computedScopePath,  // Use session-aware scope path
                        },
                        async () => vfsTool.execute(args || {}, {
                          messages: [],
                          toolCallId: `vfs-${toolName}-${Date.now()}`,
                        })
                      ) as any;

                      // Log completion
                      if (result?.success) {
                        chatLogger.info('[VFS MCP] Tool completed (streaming path)', {
                          tool: toolName,
                          success: true,
                          userId: request.userId,
                          requestId,
                          resultKeys: Object.keys(result || {}),
                        });
                        // Return just the message - LLM needs concise tool feedback
                        return typeof result === 'object' && 'message' in result
                          ? result.message
                          : JSON.stringify(result);
                      } else {
                        chatLogger.warn('[VFS MCP] Tool failed (streaming path)', {
                          tool: toolName,
                          success: false,
                          error: typeof result?.error === 'string' ? result.error : result?.error instanceof Error ? result.error.message : undefined,
                          userId: request.userId,
                          requestId,
                        });
                        throw new Error(typeof result?.error === 'string' ? result.error : result?.error instanceof Error ? result.error.message : `VFS tool ${toolName} execution failed`);
                      }
                    },
                  });
                }
              }
              chatLogger.debug('VFS tools merged into Vercel AI SDK tool set', {
                requestId,
                vfsToolCount: vfsToolDefs.length,
                totalToolCount: Object.keys(vercelTools!).length,
              });
            } catch (vfsErr: any) {
              chatLogger.warn('Failed to merge VFS tools into Vercel AI SDK', { requestId, error: vfsErr.message });
            }

            // Pre-detect URLs in the last user message and inject enhanced hint with context
            const lastUserMsg = [...llmRequest.messages].reverse().find(m => m.role === 'user');
            const lastText = typeof lastUserMsg?.content === 'string'
              ? lastUserMsg.content
              : (lastUserMsg?.content as any[])?.find?.((c: any) => c.type === 'text')?.text || '';
            // Skip URL detection - extractPublicUrls not currently available
            const urlRegex = /https?:\/\/[^\s]+/g;
            const detectedUrls = lastText.match(urlRegex) || [];
            if (detectedUrls.length > 0 && vercelTools?.['web_fetch']) {
              // Extract the question/context (everything except the URLs)
              const textWithoutUrls = lastText.replace(urlRegex, '').trim();
              const questionContext = textWithoutUrls.length > 500 
                ? textWithoutUrls.substring(0, 500) 
                : textWithoutUrls;
              
              llmRequest.messages = [
                ...llmRequest.messages,
                {
                  role: 'system' as const,
                  content: `[Tool hint: URLs detected: ${detectedUrls.join(', ')}| Use the web_fetch tool to read these pages and answer the question. Context: ${questionContext || 'Extract all meaningful content from these URLs'}]`,
                },
              ];
              chatLogger.info('URL detected in prompt, injected web_fetch hint with context', { 
                requestId, 
                urls: detectedUrls,
                hasContext: !!questionContext,
                contextLength: questionContext.length,
              });
            }
          } catch (toolErr: any) {
            chatLogger.warn('Failed to build Vercel AI tools, proceeding without', { requestId, error: toolErr.message });
          }
        } else {
          chatLogger.debug('[TOOLS] Tools explicitly disabled by request.enableTools=false', { requestId });
        }

        // ENHANCED: Log tools being passed to stream
        if (vercelTools && Object.keys(vercelTools).length > 0) {
          chatLogger.info('[TOOLS] ✅ Tools passed to streamWithVercelAI', {
            requestId,
            toolCount: Object.keys(vercelTools).length,
            toolNames: Object.keys(vercelTools),
          });
        } else {
          // CRITICAL FIX: Provide actionable diagnostics for missing tools
          chatLogger.warn('[TOOLS] ⚠ No tools provided to stream - file operations will use text parsing only', {
            provider,
            model: llmRequest.model,
            requestId,
            enableTools: request.enableTools,
            userId: request.userId,
            shouldHaveBuilt: request.enableTools !== false,
            reason: request.enableTools === false ? 'explicitly disabled' : 'tool build failed (check errors above)',
            implications: 'LLM will not use function calling - must rely on text-based tool parsing',
          });
        }

        // Wrap with auto-continue support
        const { streamWithAutoContinue, streamWithServerAutoRePrompt } = await import('@/lib/virtual-filesystem/smart-context');
        // Use the concurrent-fallback wrapper: after 20s of silence on the
        // primary, fires the next provider in the configured chain in
        // parallel and races them on the first chunk. Cancels the loser
        // (truly aborts the in-flight HTTP request so API credits aren't
        // wasted). Pass concurrentFallbackMs: 0 to fall back to the legacy
        // in-place speculative fallback inside streamWithVercelAI.
        // Pass the class-bound findCompatibleModel as the second argument
        // so the concurrent fallback coordinator can resolve a model ID
        // the fallback provider's catalog can actually serve.
        const baseStream = streamWithConcurrentFallback({
          ...({
            provider: vercelProvider,
            model: llmRequest.model || 'default',
          } as any),
          messages: processedMessages,
          system: systemPrompt || undefined,
          temperature: llmRequest.temperature || 0.7,
          maxTokens: llmRequest.maxTokens || 4096,
          // Use user's API key if provided, otherwise the provider config's key
          apiKey: userApiKey || llmRequest.apiKey,
          maxRetries: 0,
          maxSteps: 10,  // Allow up to 10 tool call iterations for multi-file operations
          tools: vercelTools,
          toolCallStreaming: !!vercelTools,
          smoothStreaming: true,
          // Pass abort signal and timeout for cancellation support
          signal: request.signal,
          timeoutMs: request.timeoutMs || 90000,
        }, this.findCompatibleModel.bind(this));

        // Chain: streamWithAutoContinue detects continuation needs,
        // streamWithServerAutoRePrompt actually re-calls LLM with tool results
        const autoContinueStream = streamWithAutoContinue(baseStream, {
          userId: request.userId || 'anonymous',
          conversationId: request.conversationId,
          enableAutoContinue: true,
        });

        yield* streamWithServerAutoRePrompt(autoContinueStream, {
          userId: request.userId || 'anonymous',
          conversationId: request.conversationId,
          messages: messagesForAutoRePrompt,
          tools: vercelTools,
          provider: primaryProvider,
          model: llmRequest.model || 'default',
          temperature: llmRequest.temperature || 0.7,
          maxTokens: llmRequest.maxTokens || 4096,
          maxRePrompts: 3,
          signal: request.signal,
        });

        const streamLatency = Date.now() - streamStartTime;
        chatLogger.info('Vercel AI SDK streaming completed', { requestId, provider: primaryProvider, model: llmRequest.model }, {
          latencyMs: streamLatency,
        });
        return;
      }

      // Fallback to legacy streaming for unsupported providers
      // CLI providers are already routed above, so this fallback is for other legacy providers
      chatLogger.warn('Provider not supported by Vercel AI SDK, using legacy streaming', { provider: primaryProvider });

      const fullRequest = { ...llmRequest, messages: processedMessages, provider: primaryProvider, apiKey: userApiKey || llmRequest.apiKey };

      // Wrap with auto-continue support
      const { streamWithAutoContinue, streamWithServerAutoRePrompt } = await import('@/lib/virtual-filesystem/smart-context');
      const baseStream = llmService.generateStreamingResponse(fullRequest);
      const autoContinueStream = streamWithAutoContinue(baseStream, {
        userId: request.userId || 'anonymous',
        conversationId: request.conversationId,
        enableAutoContinue: true,
      });        yield* streamWithServerAutoRePrompt(autoContinueStream, {
          userId: request.userId || 'anonymous',
          conversationId: request.conversationId,
          messages: messagesForAutoRePrompt,
          provider: primaryProvider,
          model: llmRequest.model || 'default',
          temperature: llmRequest.temperature || 0.7,
          maxTokens: llmRequest.maxTokens || 4096,
          maxRePrompts: 3,
          signal: request.signal,
        });

        const streamLatency = Date.now() - streamStartTime;
        chatLogger.info('Legacy streaming completed successfully', { requestId, provider: primaryProvider, model: llmRequest.model }, {
        latencyMs: streamLatency,
      });
    } catch (error) {
      const streamLatency = Date.now() - streamStartTime;
      chatLogger.warn('Streaming failed for primary provider', { requestId, provider: primaryProvider, model: llmRequest.model }, {
        latencyMs: streamLatency,
        error: error instanceof Error ? error.message : String(error),
      });

      // FIX: Loop through ALL available fallback providers (not just the first one)
      // This mirrors the behavior of generateResponse() which tries every fallback in the chain
      const fallbacks = fallbackProviders || this.fallbackChains.get(primaryProvider) || [];
      
      // First pass: try healthy providers
      let availableFallbacks = fallbacks.filter(fallbackProvider => {
        const hasConfig = !!this.getProviderConfigForRequest(fallbackProvider, requestId);
        const isHealthy = this.isProviderHealthy(fallbackProvider);
        const supportsStream = !!PROVIDERS[fallbackProvider]?.supportsStreaming;
        if (!hasConfig || !isHealthy || !supportsStream) {
          chatLogger.debug('Streaming fallback excluded provider', {
            requestId,
            provider: fallbackProvider,
            hasConfig,
            isHealthy,
            supportsStreaming: supportsStream,
          });
        }
        return hasConfig && isHealthy && supportsStream;
      });

      // SAFETY NET: If no healthy providers available, try ALL configured providers as a last resort
      // This prevents total failure when health checks incorrectly marked providers as unhealthy
      if (availableFallbacks.length === 0) {
        chatLogger.warn('No healthy fallback providers available, trying all configured providers as last resort', {
          requestId,
          fallbacks,
        });
        availableFallbacks = fallbacks.filter(fallbackProvider => {
          const hasConfig = !!this.getProviderConfigForRequest(fallbackProvider, requestId);
          const supportsStream = !!PROVIDERS[fallbackProvider]?.supportsStreaming;
          return hasConfig && supportsStream;
        });
        chatLogger.info('Last resort fallback providers', {
          requestId,
          availableFallbacks,
        });
      }

      chatLogger.debug('Streaming fallback candidates', {
        requestId,
        requestedFallbacks: fallbacks,
        availableFallbacks: availableFallbacks,
      });

      if (availableFallbacks.length === 0) {
        throw this.createEnhancedError(
          `No streaming fallback providers available for ${primaryProvider}`,
          'NO_STREAMING_FALLBACKS',
          error as Error
        );
      }

      const { streamWithAutoContinue } = await import('@/lib/virtual-filesystem/smart-context');
      let lastFallbackError: Error = error as Error;
      const fallbackChainLog: string[] = [];
      fallbackChainLog.push(`${primaryProvider}/${llmRequest.model} failed: ${error instanceof Error ? error.message : String(error)}`);

      for (let attemptIndex = 0; attemptIndex < availableFallbacks.length; attemptIndex++) {
        const fallbackProvider = availableFallbacks[attemptIndex];
        const fallbackConfig = this.getProviderConfigForRequest(fallbackProvider, requestId)!;
        const supportedModel = this.findCompatibleModel(llmRequest.model, fallbackConfig.models);

        if (!supportedModel) {
          chatLogger.debug('Streaming fallback skipped — model not supported', {
            requestId,
            provider: fallbackProvider,
            model: llmRequest.model,
          });
          fallbackChainLog.push(`${fallbackProvider}/${llmRequest.model} skipped: model not supported`);
          continue;
        }

        try {
          chatLogger.info('Falling back to streaming provider', {
            requestId,
            provider: fallbackProvider,
            model: supportedModel,
            attempt: attemptIndex + 1,
            totalAvailable: availableFallbacks.length,
          });

          // Resolve correct API key for this fallback provider
          const fallbackApiKey = apiKeys?.[fallbackProvider] || fallbackConfig.apiKey || undefined;
          const fallbackRequest = {
            ...llmRequest,
            messages: processedMessages,
            model: supportedModel,
            provider: fallbackProvider,
            apiKey: fallbackApiKey,
          };

          const baseStream = llmService.generateStreamingResponse(fallbackRequest);

          // Emit metadata chunk with actual fallback provider/model for telemetry tracking
          yield {
            content: '',
            isComplete: false,
            timestamp: new Date(),
            metadata: {
              actualProvider: fallbackProvider,
              actualModel: supportedModel,
              fallbackOccurred: true,
              fallbackChain: fallbackChainLog,
            }
          };
          
          yield* streamWithAutoContinue(baseStream, {
            userId: request.userId || 'anonymous',
            conversationId: request.conversationId,
            enableAutoContinue: true,
          });

          const fallbackLatency = Date.now() - streamStartTime;
          sandboxMetrics.fallbackSuccessTotal.inc({
            layer: 'layer1',
            primary_provider: primaryProvider,
            fallback_provider: fallbackProvider,
          });
          chatLogger.info('Streaming fallback completed successfully', {
            requestId,
            provider: fallbackProvider,
            model: supportedModel,
            attempt: attemptIndex + 1,
            latencyMs: fallbackLatency,
          });
          return; // Success — exit the generator
        } catch (fallbackError) {
          const fallbackLatency = Date.now() - streamStartTime;
          const errorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          chatLogger.warn('Streaming fallback provider failed', {
            requestId,
            provider: fallbackProvider,
            model: supportedModel,
            attempt: attemptIndex + 1,
            latencyMs: fallbackLatency,
            error: errorMsg,
          });
          fallbackChainLog.push(`${fallbackProvider}/${supportedModel} failed: ${errorMsg}`);
          lastFallbackError = fallbackError instanceof Error ? fallbackError : new Error(errorMsg);
          // Continue to next fallback in chain
        }
      }

      // All fallbacks exhausted — yield sassy message before throwing
      yield {
        content: 'Stfu!',
        isComplete: true,
        finishReason: 'error',
        timestamp: new Date(),
        metadata: {
          error: `All streaming providers failed (primary: ${primaryProvider}, ${availableFallbacks.length} fallbacks attempted)`,
        },
      };

      throw this.createEnhancedError(
        `All streaming providers failed (primary: ${primaryProvider}, ${availableFallbacks.length} fallbacks attempted)`,
        'ALL_STREAMING_PROVIDERS_FAILED',
        lastFallbackError
      );
    }
  }

  private async callProviderWithEnhancedClient(
    provider: string,
    request: LLMRequest & { toolCalls?: any[]; toolResults?: any[] },
    retryOptions?: any,
    enableCircuitBreaker: boolean = true,
    requestId?: string
  ): Promise<LLMResponse> {
    // Use request-scoped config if available, otherwise fall back to shared server config
    const config = this.getProviderConfigForRequest(provider, requestId);
    if (!config) {
      throw new Error(`Provider ${provider} not configured`);
    }

    // Use request's API key if provided (user override), otherwise fall back to the config's key
    // (which could be request-scoped user key OR server env var)
    const effectiveApiKey = (request.apiKey && request.apiKey.trim() !== '')
      ? request.apiKey
      : config.apiKey;

    // CRITICAL: Validate API key is present before making request
    if (!effectiveApiKey || effectiveApiKey.trim() === '') {
      chatLogger.error(`Provider ${provider} missing API key`, { requestId, provider }, {
        hasApiKey: !!effectiveApiKey,
        apiKeyLength: effectiveApiKey?.length || 0,
        envVarName: this.getEnvVarNameForProvider(provider),
        isUserProvided: !!request.apiKey,
      });
      throw new Error(`${provider} API key not configured. Please set ${this.getEnvVarNameForProvider(provider)} in your environment variables.`);
    }

    const callStartTime = Date.now();

    // Filter messages for provider compatibility
    // OpenAI supports 'tool' role, but Anthropic and Google do not
    const filteredMessages = this.filterMessagesForProvider(request.messages, provider);

    const providerRequest = {
      ...request,
      messages: filteredMessages,
      // Use effective API key (user-provided or server config)
      apiKey: effectiveApiKey,
    };

    chatLogger.debug('Calling provider', { requestId, provider, model: request.model }, {
      messageCount: filteredMessages.length,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      apiKeySet: !!config.apiKey,
      requestHasKey: !!providerRequest.apiKey,
    });

    try {
      const response = await llmService.generateResponse(providerRequest);
      const callLatency = Date.now() - callStartTime;
      chatLogger.debug('Provider call completed', { requestId, provider, model: request.model }, {
        latencyMs: callLatency,
        tokensUsed: response.tokensUsed,
        finishReason: response.finishReason,
      });
      // PR-C: clear the 530-blacklist counter on success (default OFF flag — no-op when disabled).
      // PR-E: pair the 5xx success-reset alongside the 530-reset. Both tracks
      // are independently blacklisted and independently recoverable; a provider
      // that succeeds a 5xx-storm caller could clear both, while a provider that
      // recovered from a 530 tunnel-DNS event should NOT be affected by an
      // unrelated 5xx blacklist.
      // PR-W -- single-call both-trackers reset (replaces the manual pair).
      maybeResetBothTrackers(provider);
      return response;
    } catch (error) {
      const type = classifyFailure(error);
      sandboxMetrics.circuitBreakerOperations.inc({ provider, operation: 'call', result: type });
      const callLatency = Date.now() - callStartTime;
      chatLogger.debug('Provider call failed', { requestId, provider, model: request.model }, {
        latencyMs: callLatency,
        error: error instanceof Error ? error.message : String(error),
        failureType: type,
      });
      throw this.enhanceError(error as Error, provider, request.model);
    }
  }

  private getEnvVarNameForProvider(provider: string): string {
    const envVarMap: Record<string, string> = {
      'openrouter': 'OPENROUTER_API_KEY',
      'chutes': 'CHUTES_API_KEY',
      'anthropic': 'ANTHROPIC_API_KEY',
      'google': 'GOOGLE_API_KEY',
      'mistral': 'MISTRAL_API_KEY',
      'github': 'GITHUB_MODELS_API_KEY or AZURE_OPENAI_API_KEY',
      'portkey': 'PORTKEY_API_KEY',
      'zen': 'ZEN_API_KEY',
      'openai': 'OPENAI_API_KEY',
      'cohere': 'COHERE_API_KEY',
      'together': 'TOGETHER_API_KEY',
      'replicate': 'REPLICATE_API_TOKEN',
    };
    return envVarMap[provider] || `${provider.toUpperCase()}_API_KEY`;
  }

  /**
   * Filter messages for provider compatibility.
   * - OpenAI: Supports 'tool' and 'assistant' roles with tool calls
   * - Anthropic: Only supports 'user' and 'assistant' roles
   * - Google: Maps 'tool' to 'user' which is incorrect
   */
  private filterMessagesForProvider(
    messages: LLMMessage[],
    provider: string
  ): LLMMessage[] {
    // OpenAI-compatible providers can handle tool messages
    const openAICompatible = ['openrouter', 'chutes', 'portkey'];
    if (openAICompatible.includes(provider)) {
      return messages;
    }

    // For other providers (Anthropic, Google, etc.), filter out synthetic tool messages
    return messages.filter(msg => {
      // Remove 'tool' role messages
      if (msg.role === 'tool') return false;

      // Remove assistant messages that are just JSON-stringified tool calls
      if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content) {
        try {
          const parsed = JSON.parse(msg.content);
          if (Array.isArray(parsed) && parsed.every(item => item.id && item.type && item.function)) {
            return false; // This is a synthetic tool call message
          }
        } catch {
          // Not JSON, keep the message
        }
      }

      return true;
    });
  }

  private findCompatibleModel(requestedModel: string, availableModels: string[]): string | null {
    if (availableModels.includes(requestedModel)) {
      return requestedModel;
    }

    const modelFamily = this.extractModelFamily(requestedModel);
    const compatibleModel = availableModels.find(model => 
      this.extractModelFamily(model) === modelFamily
    );

    return compatibleModel || availableModels[0] || null;
  }

  private extractModelFamily(model: string): string {
    const patterns = [
      /^(gpt-[34])/i,
      /^(claude-[23])/i,
      /^(gemini)/i,
      /^(llama)/i,
      /^(deepseek)/i,
      /^(mixtral)/i
    ];

    for (const pattern of patterns) {
      const match = model?.match(pattern);
      if (match) {
        return match[1].toLowerCase();
      }
    }

    return model?.split('-')[0].toLowerCase() || 'unknown';
  }

  private isProviderHealthy(provider: string): boolean {
    const config = this.endpointConfigs.get(provider);
    if (!config) return false;

    const health = enhancedAPIClient.getEndpointHealth(config.baseUrl) as any;
    // Default to healthy if no health data exists (avoids excluding providers that were
    // incorrectly marked unhealthy by the old bogus health check pings)
    if (!health || health.lastCheck === 0) return true;
    return health.isHealthy !== false;
  }

  private enhanceError(error: Error, provider: string, model?: string): Error & { failureType?: FailureType } {
    const enhancedError = error as Error & { failureType?: FailureType };
    enhancedError.failureType = classifyFailure(error);
    
    const msg = error.message.toLowerCase();

    // Check for HTTP status codes first (more specific than text patterns)
    if (msg.includes('401') || msg.includes('403')) {
      enhancedError.message = `Authentication failed for ${provider}. Please check your API key configuration.`;
    } else if (msg.includes('429') || msg.includes('rate limit')) {
      // CRITICAL: Record rate limit error for circuit breaker tracking
      // This prevents infinite retry loops on rate-limited models
      recordRateLimitError(provider, model || 'default');
      enhancedError.message = `Rate limit exceeded for ${provider}. The system will automatically try alternative providers.`;
    } else if (msg.includes('402') || msg.includes('quota') || msg.includes('billing')) {
      enhancedError.message = `API quota exceeded for ${provider}. Switching to alternative provider.`;
    } else if (msg.includes('408') || msg.includes('504') || msg.includes('timeout')) {
      enhancedError.message = `Request timeout for ${provider}. The system will retry with exponential backoff.`;
    } else if (TUNNEL_DNS_ERROR.test(msg)) {
      // trycloudflare/stale-tunnel DNS error: the tunnel endpoint for this
      // provider is no longer resolving. Mark as PERMANENT so the retry layer
      // immediately fails over to a different provider instead of retrying 3x.
      enhancedError.failureType = 'PERMANENT';
      enhancedError.message = `Tunnel DNS error for ${provider} (stale tunnel). The tunnel endpoint is no longer resolving. Switching to alternative provider.`;
    } else if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
      enhancedError.message = `Network error connecting to ${provider}. Checking alternative providers.`;
    } else if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
      enhancedError.message = `Service error from ${provider}: ${error.message}`;
    } else {
      enhancedError.message = `Service error from ${provider}: ${error.message}`;
    }

    return enhancedError;
  }

  private createEnhancedError(message: string, code: string, originalError: Error): Error {
    const error = new Error(message);
    (error as any).code = code;
    (error as any).originalError = originalError;
    return error;
  }

  /**
   * Route CLI providers (opencode-cli, pi, etc.) to their native binary spawn path.
   * These providers spawn local binaries instead of using API calls.
   */
  private async *streamWithCLIBinary(
    provider: string,
    request: EnhancedLLMRequest,
    requestId?: string
  ): AsyncGenerator<StreamingResponse> {
    // EnhancedLLMRequest extends LLMRequest, so request IS the LLM request
    const messages = request.messages || [];
    const lastUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
    const userMessage = typeof lastUserMessage?.content === 'string'
      ? lastUserMessage.content
      : (Array.isArray(lastUserMessage?.content)
          ? (lastUserMessage.content.find((c: any) => c.type === 'text') as any)?.text || ''
          : '');

    const userId = request.userId || 'anonymous';
    const conversationId = request.conversationId || '';
    const sessionId = normalizeSessionId(conversationId) || 'default';
    const model = request.model || 'local';

    chatLogger.info('[CLI-PROVIDER] Starting CLI binary streaming', {
      requestId,
      provider,
      userId,
      sessionId,
      model,
      messageLength: userMessage.length,
    });

    try {
      let result: any;
      // Bug #69 helper-input scoping: `tools` is block-scoped inside the
      // opencode-cli branch below (it's `let tools: LLMToolDefinition[] = []`
      // inside the `if (provider === 'opencode-cli')` block). The FC-GATE-0-calls
      // detector runs AFTER this if/elseif/else chain. Hoist the tool count to
      // outer scope so the detector can read it without triggering a TDZ /
      // ReferenceError on the block-scoped variable. The pi branch doesn't
      // build tools (its native binary-spawn path), so it leaves toolsCount==0
      // and the FC-GATE detector short-circuits — acceptable since pi has its
      // own observable failure modes.
      let toolsCount = 0;

      if (provider === 'opencode-cli') {
        // Check if opencode binary is available
        const { findOpencodeBinarySync } = await import('../drivers/opencode/find-opencode-binary');
        const binaryPath = findOpencodeBinarySync();
        if (!binaryPath) {
          chatLogger.error('[CLI-PROVIDER] opencode binary not found', { requestId });
          yield {
            content: 'OpenCode CLI binary not found. Please install it with: npm install -g opencode-ai',
            isComplete: true,
            finishReason: 'error',
            timestamp: new Date(),
            metadata: { error: 'OpenCode CLI not installed', actualProvider: provider },
          };
          return;
        }

        // Import and use OpencodeV2Provider
        const { OpencodeV2Provider } = await import('../sandbox/spawn/opencode-cli');
        const providerInstance = new OpencodeV2Provider({
          session: {
            userId,
            conversationId,
            enableMcp: true,
            workspaceDir: request.scopePath || `workspace/sessions/${sessionId}`,
          },
        });

         // Build tools if needed - getAllTools returns Record<string, Tool>
         // For CLI provider, we need LLMToolDefinition[] with raw JSON schema.
         // The OpenCode CLI provider can handle tool execution through the executeTool callback,
         // but requires tool definitions. We'll provide minimal stub definitions.
         let tools: LLMToolDefinition[] = [];
         if (request.enableTools !== false) {
           try {
             const { getAllTools } = await import('./vercel-ai-tools');
             const vercelTools = await getAllTools({
               userId,
               conversationId,
               sessionId,
               requestId,
               scopePath: request.scopePath || `workspace/sessions/${sessionId}`,
               lastUserMessage: userMessage,
             });
             // Convert to LLMToolDefinition format for opencode-cli
             // We use Object.entries to preserve the tool names which are the keys
             tools = Object.entries(vercelTools).map(([name, t]) => {
               const v = t as any;
               const description = v.description || '';
               
               // Heuristic extraction of parameters for the CLI provider
               let parameters: any = { type: 'object', properties: {}, required: [] };
               
               try {
                 const schema = v.parameters || v.inputSchema;
                 if (schema && typeof schema === 'object' && schema._def) {
                   // Extract basic shape if it's a ZodObject
                   if (schema._def.typeName === 'ZodObject') {
                     const shape = schema._def.shape?.() || {};
                     for (const [key, field] of Object.entries(shape)) {
                       const typeName = (field as any)._def?.typeName;
                       let type = 'string';
                       if (typeName === 'ZodNumber') type = 'number';
                       else if (typeName === 'ZodBoolean') type = 'boolean';
                       else if (typeName === 'ZodArray') type = 'array';
                       else if (typeName === 'ZodObject') type = 'object';
                       
                       parameters.properties[key] = { type };
                       // Basic check for required fields (not ZodOptional/ZodNullable)
                       if (typeName !== 'ZodOptional' && typeName !== 'ZodNullable') {
                         parameters.required.push(key);
                       }
                     }
                   }
                 } else if (schema && (schema.type === 'object' || schema.properties)) {
                   // Already looks like a JSON schema
                   parameters = schema;
                 }
               } catch (e) {
                 // Fallback to empty object on error
               }

               return {
                 name,
                 description,
                 parameters,
               };
             });
             chatLogger.debug('[CLI-PROVIDER] Built tools for opencode-cli', {
               requestId,
               toolCount: tools.length,
             });
             // Bug #69: hoist the tool count to outer scope (see declaration
             // before the if/elseif/else chain) so the FC-GATE-0-calls detector
             // — which lives after the chain ends — can read it.
             toolsCount = tools.length;
           } catch (toolErr: any) {
              chatLogger.warn('[CLI-PROVIDER] Failed to build tools for opencode-cli', {
                requestId,
                error: toolErr.message,
              });
            }
          }

          // Get system prompt from messages
          const systemMessage = messages.find((m: any) => m.role === 'system');
          const systemPrompt = typeof systemMessage?.content === 'string'
            ? systemMessage.content
            : '';

          const toolManager = getToolManager();
          result = await providerInstance.runAgentLoop({
            userMessage,
            tools,
            systemPrompt,
            maxSteps: 15,
            cwd: request.scopePath || `workspace/sessions/${sessionId}`,
            executeTool: async (toolName: string, args: Record<string, any>) => {
              try {
                return await toolManager.executeTool(toolName, args, {
                  userId,
                  conversationId,
                  metadata: { source: 'cli_provider', provider },
                });
              } catch (err: any) {
                return { success: false, output: `Tool execution failed: ${err.message}`, exitCode: 1 };
              }
            },
            onToolExecution: (toolName: string, args: any, toolResult: any) => {
              chatLogger.debug('[CLI-PROVIDER] Tool execution', { requestId, provider, toolName, success: toolResult.success });
            },
            onStreamChunk: () => {},
          });
        } else if (provider === 'pi') {

        // Check if pi binary is available
        const { findPiBinarySync } = await import('../drivers/agent-bins/find-pi-binary');
        const binaryPath = findPiBinarySync();
        if (!binaryPath) {
          chatLogger.error('[CLI-PROVIDER] pi binary not found', { requestId });
          yield {
            content: 'Pi CLI binary not found. Please install it.',
            isComplete: true,
            finishReason: 'error',
            timestamp: new Date(),
            metadata: { error: 'Pi CLI not installed', actualProvider: provider },
          };
          return;
        }

        // Use the actual LLM provider from request.model, or default to 'anthropic'
        // The 'pi' provider is a CLI wrapper that delegates to an actual LLM provider
        const actualLlmProvider = request.model && request.model !== 'local' 
          ? request.model.split('/')[0]  // Extract provider from model like 'anthropic/claude-3.5'
          : 'anthropic';  // Default to anthropic if no model specified
        
        const { createCliPiSession } = await import('../drivers/pi/pi-cli-session');
        
        // Wrap createCliPiSession in try-catch to handle initialization failures
        let session: any;
        try {
          session = await createCliPiSession({
            cwd: request.scopePath || process.cwd(),
            mode: 'local',
            provider: actualLlmProvider,
            modelId: model !== 'local' ? model : undefined,
          });
        } catch (initError: any) {
          chatLogger.error('[CLI-PROVIDER] Failed to initialize pi session', { requestId, error: initError.message });
          yield {
            content: `Failed to initialize Pi session: ${initError.message}`,
            isComplete: true,
            finishReason: 'error',
            timestamp: new Date(),
            metadata: { error: initError.message, actualProvider: provider },
          };
          return;
        }

        // Yield streaming chunks as they come
        let streamedContent = '';
        session.subscribe((event: any) => {
          if (event.type === 'message_update') {
            const delta = event.assistantMessageEvent?.delta || '';
            streamedContent += delta;
            // Yield partial content immediately
            chatLogger.debug('[CLI-PROVIDER] PI streaming chunk', {
              requestId,
              provider,
              chunkLength: delta.length,
              totalSoFar: streamedContent.length,
            });
          }
        });

        // Wrap session.prompt() in try-catch to handle runtime errors
        try {
          await session.prompt(userMessage, { streamingBehavior: 'steer' });
        } catch (promptErr: any) {
          chatLogger.error('[CLI-PROVIDER] Pi session.prompt() failed', { requestId, error: promptErr.message });
          session.dispose();
          yield {
            content: `Pi session error: ${promptErr.message}`,
            isComplete: true,
            finishReason: 'error',
            timestamp: new Date(),
            metadata: { error: promptErr.message, actualProvider: provider },
          };
          return;
        }
        
        // Wait for agent_end event or timeout (max 60 seconds)
        const maxWait = 60000;
        await new Promise<void>((resolve) => {
          session.subscribe((event: any) => {
            if (event.type === 'agent_end') {
              resolve();
            }
          });
          setTimeout(resolve, maxWait);
        });

        const finalMessages = await session.getMessages();
        const lastMessage = finalMessages[finalMessages.length - 1];

        result = {
          response: lastMessage?.content?.[0]?.text || streamedContent,
          messages: finalMessages,
        };
        // Only dispose if session was successfully created
        if (session?.dispose) {
          session.dispose();
        }

      } else {
        // Unknown CLI provider - yield error
        chatLogger.error('[CLI-PROVIDER] Unknown CLI provider', { requestId, provider });
        yield {
          content: `Unknown CLI provider: ${provider}. Supported CLI providers: opencode-cli, pi`,
          isComplete: true,
          finishReason: 'error',
          timestamp: new Date(),
          metadata: { error: `Provider "${provider}" is not a recognized CLI provider`, actualProvider: provider },
        };
        return;
      }

      chatLogger.info('[CLI-PROVIDER] CLI streaming completed', {
        requestId,
        provider,
        responseLength: result.response?.length || 0,
        steps: result.steps?.length || 0,
      });

      // Bug #69 (Pass-5 #69 regression cycle fix): the prior detector at this
      // site called wireFinishReasonSteer with availableTools hardcoded to 0,
      // which short-circuited the inner guard (`availableTools > 0`) and
      // produced NO steer prompt — the FC-GATE-0-calls failure mode went
      // unflagged and unsteered in the run.log audit. The replacement uses
      // wireFCGateZeroCallsSteer (which CAN detect the FC-GATE condition
      // with availableTools > 0) and emits the [FC-GATE-ZERO-CALLS] structured
      // marker distinct from the legacy [STEER] finishReason stop line —
      // run.log greppers can now spot the FC-GATE failure mode specifically.
      // Detection is no longer scoped to mistral-large/qwen3.5 — ANY model can
      // hit this when FC-GATE passes Phase 1 but the model emits text instead
      // of tool calls. The steer path short-circuits the fallback chain: the
      // steer prompt goes into the NEXT turn rather than triggering a
      // provider retry (which would burn credits on a model that already
      // demonstrated FC-GATE capability).
      const toolCallsDone = (result.steps || []).reduce(
        (n, s) => n + ((s as any).toolCalls || []).length, 0
      );
      // Bug #69 outer-scope read: previously referenced `Array.isArray(tools)`
      // here, but `tools` is block-scoped to the `if (provider === 'opencode-cli')`
      // branch above. Read from the hoisted `toolsCount` instead.
      const availableTools = toolsCount;
      try {
        const detection = wireFCGateZeroCallsSteer({
          toolCallsDone,
          availableTools,
          responseText: result.response || '',
          finishReason: 'stop',
          provider,
          model,
        });
        if (detection.detected) {
          // Pass-8 seam-cleanup followup (b): delegate the structured warn
          // to the single-sourced helper exported from steer-service.ts.
          // The marker string + field naming is owned by steer-service so
          // the bug-69 test exercises the same code path as production.
          emitFCGateZeroCallsLog({
            provider,
            model,
            availableTools,
            toolCallsDone,
            responseLength: (result.response || '').length,
            steerLength: detection.steer?.length || 0,
          });
        }
      } catch { /* steer helper failure is non-fatal */ }

      yield {
        content: result.response || '',
        isComplete: true,
        finishReason: 'stop',
        timestamp: new Date(),
        metadata: {
          actualProvider: provider,
          actualModel: model,
          steps: result.steps || [],
        },
      };

    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      chatLogger.error('[CLI-PROVIDER] CLI streaming failed', { requestId, provider, error: errorMsg });

      yield {
        content: '',
        isComplete: true,
        finishReason: 'error',
        timestamp: new Date(),
        metadata: { error: errorMsg, actualProvider: provider },
      };
    }
  }

  getProviderHealth(): Record<string, any> {
    const health: Record<string, any> = {};
    
    this.endpointConfigs.forEach((config, provider) => {
      const endpointHealth = enhancedAPIClient.getEndpointHealth(config.baseUrl);
      health[provider] = {
        ...config,
        health: endpointHealth,
        circuitBreaker: enhancedAPIClient.getCircuitBreakerStats()
          .find(cb => cb.endpoint === config.baseUrl)
      };
    });

    return health;
  }

  getAvailableProviders(): string[] {
    return Array.from(this.endpointConfigs.keys())
      .filter(provider => this.isProviderHealthy(provider));
  }

  resetProviderHealth(provider?: string): void {
    if (provider) {
      const config = this.endpointConfigs.get(provider);
      if (config) {
        enhancedAPIClient.resetCircuitBreaker(config.baseUrl);
      }
    } else {
      enhancedAPIClient.resetCircuitBreaker();
    }
  }

  async processToolRequest(messages: LLMMessage[], userId: string, conversationId: string, scopePath?: string) {
    try {
      const result = await toolContextManager.processToolRequest(
        messages,
        userId,
        conversationId,
        scopePath
      );

      return {
        requiresAuth: result.requiresAuth,
        authUrl: result.authUrl,
        toolName: result.toolName,
        toolCalls: result.toolCalls,
        toolResults: result.toolResults,
        content: result.content
      };
    } catch (error: any) {
      chatLogger.error('Tool request processing error', { error: error?.message, stack: error?.stack });
      return {
        requiresAuth: false,
        toolCalls: [],
        toolResults: [],
        content: `Error processing tool request: ${error.message}`
      };
    }
  }

  // Redact sensitive/large fields from tool args for orchestrator logging
  private redactArgsForOrchestrator(args: any) {
    if (!args || typeof args !== 'object') return args;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(args)) {
      const key = String(k || '');
      const lower = key.toLowerCase();
      if (['content', 'body', 'file'].some(s => lower.includes(s))) {
        out[key] = '[REDACTED]';
        continue;
      }
      if (key === 'files' && Array.isArray(v)) {
        out[key] = v.map((f: any) => ({ path: f?.path, name: f?.name }));
        continue;
      }
      if (typeof v === 'string' && v.length > 200) {
        out[key] = v.slice(0, 200) + '...[TRUNCATED]';
      } else {
        out[key] = v;
      }
    }
    return out;
  }

  private async executeModelToolCallsFromResponse(
    response: LLMResponse,
    userId: string,
    conversationId: string,
    scopePath?: string
  ): Promise<LLMResponse> {
    const toolCalls = await this.extractToolCallsFromLLMResponse(response, userId);
    if (toolCalls.length === 0) {
      return response;
    }

    const toolManager = getToolManager();
    const executedCalls: Array<{ name: string; arguments: Record<string, any> }> = [];
    const toolResults: Array<{ name: string; success: boolean; output?: any; error?: string; authUrl?: string }> = [];
    const toolInvocations: Array<{
      toolCallId: string;
      toolName: string;
      state: 'partial-call' | 'call' | 'result';
      args: Record<string, any>;
      result?: any;
    }> = [];
    const reasoningTrace: string[] = [];

    for (const call of toolCalls) {
      const resolvedTool = this.resolveToolKey(call.name);
      const resolvedMCPTool = resolvedTool ? null : await this.resolveMCPToolName(call.name, userId);
      const selectedTool = resolvedTool || resolvedMCPTool;

      if (!selectedTool) {
        toolResults.push({
          name: call.name,
          success: false,
          error: `Unknown tool: ${call.name}`
        });
        continue;
      }

      executedCalls.push({ name: selectedTool, arguments: call.arguments });
      const toolCallId = `tool-${selectedTool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      toolInvocations.push({
        toolCallId,
        toolName: selectedTool,
        state: 'partial-call',
        args: call.arguments,
      });
      toolInvocations.push({
        toolCallId,
        toolName: selectedTool,
        state: 'call',
        args: call.arguments,
      });
      reasoningTrace.push(`Selected tool '${selectedTool}' with parsed arguments.`);

      // Orchestrator instrumentation: redacted dump of constructed tool call
      try {
        const redacted = this.redactArgsForOrchestrator(call.arguments || {});
        chatLogger.info('[Orchestrator] Executing tool', { tool: selectedTool, userId, conversationId, args: redacted });
      } catch (e) {
        chatLogger.debug('[Orchestrator] Failed to redact tool args', { error: (e as any)?.message || String(e) });
      }

      const result = resolvedTool
        ? await toolManager.executeTool(
            selectedTool,
            call.arguments,
            {
              userId,
              conversationId,
              metadata: { source: 'llm_tool_use' }
            }
          )
        : await callMCPToolFromAI_SDK(selectedTool, call.arguments, userId, scopePath);

      toolResults.push({
        name: selectedTool,
        success: result.success,
        output: result.output,
        error: result.error,
        authUrl: (result as any).authUrl
      });
      toolInvocations.push({
        toolCallId,
        toolName: selectedTool,
        state: 'result',
        args: call.arguments,
        result: result.success
          ? { output: result.output }
          : { error: result.error || 'Tool execution failed' },
      });
      reasoningTrace.push(
        result.success
          ? `Tool '${selectedTool}' completed successfully.`
          : `Tool '${selectedTool}' failed: ${result.error || 'unknown error'}.`,
      );
    }

    const authRequired = toolResults.find(r => !r.success && !!r.authUrl);
    if (authRequired?.authUrl) {
      return {
        ...response,
        content: `I need authorization to use ${authRequired.name}. Please connect your account to proceed.`,
        finishReason: 'tool_auth_required',
        metadata: {
          ...(response as any).metadata,
          requiresAuth: true,
          authUrl: authRequired.authUrl,
          toolName: authRequired.name,
          toolCalls: executedCalls,
          toolResults,
          toolInvocations,
          reasoningTrace,
        }
      } as LLMResponse;
    }

    const summaryLines = toolResults.map(r => {
      if (r.success) return `- ${r.name}: success`;
      return `- ${r.name}: failed (${r.error || 'unknown error'})`;
    });

    const appendedSummary = summaryLines.length > 0
      ? `\n\nTool execution results:\n${summaryLines.join('\n')}`
      : '';

    return {
      ...response,
      content: `${response.content || ''}${appendedSummary}`.trim(),
      metadata: {
        ...(response as any).metadata,
        toolCalls: executedCalls,
        toolResults,
        toolInvocations,
        reasoningTrace,
      }
    } as LLMResponse;
  }

  private resolveToolKey(rawName: string): string | null {
    if (!rawName) return null;
    const registryKeys = Object.keys(TOOL_REGISTRY);
    if (registryKeys.includes(rawName)) return rawName;

    const normalized = rawName.toLowerCase().replace(/[\s_/-]+/g, '.');
    if (registryKeys.includes(normalized)) return normalized;

    const compact = normalized.replace(/[^a-z0-9]/g, '');
    const match = registryKeys.find(key => key.replace(/[^a-z0-9]/g, '') === compact);
    return match || null;
  }

  private async resolveMCPToolName(rawName: string, userId?: string): Promise<string | null> {
    if (!rawName) return null;

    const mcpToolNames = (await getMCPToolsForAI_SDK(userId)).map((tool) => tool.function.name);
    if (mcpToolNames.includes(rawName)) return rawName;

    const normalized = rawName.toLowerCase().replace(/[\s_/-]+/g, '.');
    const normalizedMatch = mcpToolNames.find((name) => name.toLowerCase().replace(/[\s_/-]+/g, '.') === normalized);
    if (normalizedMatch) return normalizedMatch;

    const compact = normalized.replace(/[^a-z0-9]/g, '');
    const compactMatch = mcpToolNames.find((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '') === compact);
    return compactMatch || null;
  }

  private async extractToolCallsFromLLMResponse(response: LLMResponse, userId?: string): Promise<Array<{ name: string; arguments: Record<string, any> }>> {
    // Prefer canonical tool calls from provider response (native tool_use blocks)
    const nativeToolCalls = (response as any)?.toolCalls || (response as any)?.tool_calls;
    if (Array.isArray(nativeToolCalls) && nativeToolCalls.length > 0) {
      return nativeToolCalls.map((tc: any) => ({
        name: tc.name || tc.function?.name || 'unknown',
        arguments: tc.arguments || tc.function?.arguments || tc.args || tc.input || {},
      }));
    }

    const nativeTools = Object.entries(TOOL_REGISTRY).map(([name, cfg]) => ({
      name,
      inputSchema: cfg.inputSchema as any,
    }));
    const mcpTools = (await getMCPToolsForAI_SDK(userId)).map((tool) => ({
      name: tool.function.name,
      inputSchema: tool.function.parameters as any,
    }));
    const tools = [...nativeTools, ...mcpTools];
    const dispatch = await advancedToolCallDispatcher.dispatch(
      {
        provider: (response as any)?.provider,
        model: (response as any)?.model,
        content: response.content,
        metadata: (response as any)?.metadata || {},
      },
      tools,
    );

    const seen = new Set<string>();
    const calls: Array<{ name: string; arguments: Record<string, any> }> = [];
    for (const call of dispatch.calls) {
      const key = `${call.name}:${JSON.stringify(call.arguments)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push({
        name: call.name,
        arguments: call.arguments,
      });
    }

    if (dispatch.rejected.length > 0) {
      chatLogger.warn('[EnhancedLLMService] Rejected tool calls during parser validation', { rejectedCount: dispatch.rejected.length, rejected: dispatch.rejected });
    }

    return calls;
  }

  async processSandboxRequest(request: EnhancedLLMRequest, userId: string, conversationId: string): Promise<LLMResponse> {
    try {
      const session = await sandboxBridge.getOrCreateSession(userId);

      const lastUserMessage = request.messages
        .filter(m => m.role === 'user')
        .pop()?.content;

      if (!lastUserMessage) {
        return {
          content: 'No user message found to process in sandbox',
          tokensUsed: 0,
          finishReason: 'error',
          timestamp: new Date(),
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }

      // Type guard: Ensure content is a string, not an array of content parts
      let commandString: string;
      if (typeof lastUserMessage !== 'string') {
        // Handle array content by extracting text from parts
        if (Array.isArray(lastUserMessage)) {
          commandString = lastUserMessage
            .filter(part => typeof part === 'string' || (part as any).type === 'text')
            .map(part => typeof part === 'string' ? part : (part as any).text || '')
            .join(' ');
        } else {
          return {
            content: 'Invalid message format: expected string or text content',
            tokensUsed: 0,
            finishReason: 'error',
            timestamp: new Date(),
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          };
        }
      } else {
        commandString = lastUserMessage;
      }

      // Extract command from natural language input
      // Look for common command patterns and extract the actual shell command
      const extractedCommand = this.extractCommandFromNaturalLanguage(commandString);
      
      // Validate and sanitize command input before execution
      const validatedCommand = this.validateSandboxCommand(extractedCommand);
      if (!validatedCommand.isValid) {
        return {
          content: `Command rejected: ${validatedCommand.reason}`,
          tokensUsed: 0,
          finishReason: 'error',
          timestamp: new Date(),
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }

      const result = await sandboxBridge.executeCommand(session.sandboxId, validatedCommand.command);

      // Define model from request so the finishReason IIFE can reference it
      const model = request.model || 'local';

      return {
        content: `Sandbox execution completed.\n\nOutput:\n${result.output || 'No output'}${result.exitCode !== undefined && result.exitCode !== 0 ? `\n\nExit code: ${result.exitCode}` : ''}`,
  tokensUsed: 0,
  finishReason: (() => {
    const sandboxToolCallsDone = (result.steps || []).reduce(
      (n: number, st: any) => n + ((st.toolCalls || []).length), 0
    );
    return (result.success && sandboxToolCallsDone === 0 && (model.includes('mistral-large') || model.includes('qwen3.5')))
      ? 'incomplete-response'
      : result.success ? 'stop' : 'error';
  })(),
        timestamp: new Date(),
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        metadata: {
          success: result.success,
          exitCode: result.exitCode
        }
      };
    } catch (error: any) {
      chatLogger.error('Sandbox request processing error', { error: error?.message, stack: error?.stack });
      return {
        content: `Error executing in sandbox: ${error.message}`,
        tokensUsed: 0,
        finishReason: 'error',
        timestamp: new Date(),
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }
  }

  /**
   * Validates and sanitizes command input before sandbox execution.
   * Prevents command injection attacks by blocking dangerous patterns.
   */
  private validateSandboxCommand(command: string): { isValid: boolean; command: string; reason?: string } {
    return validateSandboxCommand(command);
  }

  /**
   * Extracts shell commands from natural language input.
   * Converts phrases like "please run ls -la" to "ls -la".
   */
  private extractCommandFromNaturalLanguage(input: string): string {
    const trimmedInput = input.trim();

    // Common natural language prefixes to strip
    const commandPrefixes = [
      /^(?:please\s+)?(?:run|execute|exec)\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:run|execute)\s+/i,
      /^(?:could\s+you\s+)?(?:please\s+)?(?:run|execute)\s+/i,
      /^(?:i\s+want\s+to\s+)?(?:run|execute)\s+/i,
      /^(?:i\s+need\s+to\s+)?(?:run|execute)\s+/i,
      /^(?:let['']s\s+)?(?:run|execute)\s+/i,
      /^(?:just\s+)?(?:run|execute)\s+/i,
      /^(?:show\s+me\s+)/i,
      /^(?:check\s+)/i,
      /^(?:list\s+)/i,
      /^(?:display\s+)/i,
    ];

    let command = trimmedInput;
    for (const prefix of commandPrefixes) {
      const match = command.match(prefix);
      if (match) {
        command = command.replace(prefix, '');
        break;
      }
    }

    // Remove trailing punctuation that's common in natural language
    command = command.replace(/[.!?,;]+$/, '').trim();

    // Remove quote wrappers if present
    const quoteMatch = command.match(/^["'](.+)["']$/);
    if (quoteMatch) {
      command = quoteMatch[1];
    }

    return command.trim() || trimmedInput;
  }

  destroy(): void {
    enhancedAPIClient.destroy();
  }
}

/**
 * Validates and sanitizes command input before sandbox execution.
 * Prevents command injection attacks by blocking dangerous patterns.
 * Exported as standalone function for use in sandbox execute API.
 */
export function validateSandboxCommand(command: string): { isValid: boolean; command: string; reason?: string } {
  if (!command || typeof command !== 'string') {
    return { isValid: false, command: '', reason: 'Command is required' };
  }

  // Length limit to prevent resource exhaustion
  const MAX_COMMAND_LENGTH = 10000;
  if (command.length > MAX_COMMAND_LENGTH) {
    return { isValid: false, command: '', reason: `Command exceeds maximum length of ${MAX_COMMAND_LENGTH} characters` };
  }

  const trimmedCommand = command.trim();

  // Block dangerous command patterns that could escape sandbox or cause harm
  const dangerousPatterns = [
    // Network exfiltration attempts (using [^|]* instead of .* to prevent backtracking)
    /\bcurl\b[^|]*\|\s*(?:ba)?sh\b/i,
    /\bwget\b[^|]*\|\s*(?:ba)?sh\b/i,
    // Privilege escalation
    /\bsudo\b/i,
    /\bsu\b\s+/i,
    // Container escape attempts
    /\bdocker\b/i,
    /\bkubectl\b/i,
    // Filesystem traversal beyond workspace
    /\.\.\/\.\./,
    /\/etc\/passwd/,
    /\/etc\/shadow/,
    // Process manipulation
    /\bpkill\b/i,
    /\bkillall\b/i,
    // Code execution in other languages (using \s+ instead of .*)
    /\bpython[3]?\s+-c\b/i,
    /\bperl\s+-e\b/i,
    /\bruby\s+-e\b/i,
    // Base64 decode and execute patterns
    /\bbase64\b[^|]*\|\s*(?:ba)?sh\b/i,
    /\bbase64\b[^|]*\|\s*bash\b/i,
    // Eval patterns
    /\beval\s*\(/i,
    /\bexec\s*\(/i,
    // Netcat with exec flag
    /\bnc\s+-e\b/i,
    /\bnetcat\s+-e\b/i,
    // Additional dangerous patterns for common attack vectors
    /\bnode\s+-e\b/i,
    /\bphp\s+-r\b/i,
    /\bbash\s+-c\b/i,
    /\bzsh\s+-c\b/i,
    /\bsh\s+-c\b/i,
    // Piping to any shell variant
    /\|\s*(ba)?sh\b/i,
    /\|\s*bash\b/i,
    /\|\s*zsh\b/i,
    /\|\s*ash\b/i,
    // Command substitution
    /\$\([^)]+\)/,
    /`[^`]+`/,
  ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmedCommand)) {
        return { isValid: false, command: '', reason: 'Command contains potentially dangerous pattern' };
      }
    }

    // Universal shell metacharacter check - applied to ALL commands
    // These characters can enable command injection or redirection attacks
    const dangerousChars = [';', '&&', '||', '|', '`', '$', '>', '<', '&', '\n', '\r'];
    for (const char of dangerousChars) {
      if (trimmedCommand.includes(char)) {
        return {
          isValid: false,
          command: '',
          reason: `Command contains unsafe character: ${char}`
        };
      }
    }

    // Allow-list of safe command prefixes for common development tasks
    // NOTE: Container tools and general-purpose interpreters are intentionally excluded
    // as they can be used to escape sandbox or execute arbitrary code
    // NOTE: Destructive commands (rm, chmod, chown) are excluded to prevent data loss
    // NOTE: Network download and package install commands are RESTRICTED to prevent
    // arbitrary code execution via downloaded payloads or malicious package installation
    const safeCommandPrefixes = [
      // File operations (read-only and safe create)
      'ls ', 'cat ', 'head ', 'tail ', 'wc ', 'grep ', 'find ', 'tree ',
      'pwd ', 'cd ', 'mkdir ', 'rmdir ', 'cp ', 'mv ', 'touch ',
      'ln ', 'readlink ',
      // Text processing
      'sed ', 'awk ', 'cut ', 'sort ', 'uniq ', 'tr ', 'rev ',
      'echo ', 'printf ',
      // Build tools and compilers (safe, produce deterministic output)
      'npm ', 'yarn ', 'pnpm ', 'bun ', 'cargo ', 'go ',
      'make ', 'cmake ', 'gcc ', 'g++ ', 'clang ', 'rustc ',
      // Version control
      'git ', 'svn ', 'hg ',
      // Testing
      'jest ', 'mocha ', 'pytest ', 'cargo test', 'go test ',
      // System info (read-only)
      'uname ', 'whoami ', 'id ', 'date ', 'time ', 'uptime ', 'df ', 'du ',
      'env ', 'printenv ', 'which ', 'whereis ', 'type ',
      // Network (read-only diagnostics only - no downloads)
      'ping ', 'dig ', 'nslookup ', 'netstat ', 'ss ', 'traceroute ',
      // Process info (read-only)
      'ps ', 'top ', 'htop ', 'pgrep ', 'pidof ',
      // Package managers (read-only operations ONLY)
      'apt list ', 'apt-cache ', 'yum list ', 'dnf list ', 'apk search ', 'brew list ',
      // Text editors (interactive, don't execute code)
      'vim ', 'vi ', 'nano ', 'emacs ', 'code ',
      // Documentation
      'man ', 'help ', '--help', '-h ',
    ];

    // Additional blocklist for dangerous argument patterns (defense in depth)
    const dangerousArgPatterns = [
      /rm\s+-rf\s/i,          // rm -rf (recursive force delete)
      /rm\s+--no-preserve-root/i,  // rm --no-preserve-root
      /chmod\s+(-[aR]*7|000)/i,    // chmod with dangerous permissions
      /chown\s+.*:.*\//i,     // chown with recursive paths
      /\s-\w*f\s/i,           // force flag patterns
    ];

    for (const pattern of dangerousArgPatterns) {
      if (pattern.test(trimmedCommand)) {
        return {
          isValid: false,
          command: '',
          reason: 'Command contains dangerous argument pattern'
        };
      }
    }

    // Check if command starts with a safe prefix or is a simple command
    const lowerCommand = trimmedCommand.toLowerCase();
    const isSafePrefix = safeCommandPrefixes.some(prefix =>
      lowerCommand.startsWith(prefix.toLowerCase())
    );

    // Also allow simple commands without arguments (e.g., "ls", "pwd")
    const simpleCommand = trimmedCommand.split(/\s+/)[0].toLowerCase();
    const isSimpleSafeCommand = safeCommandPrefixes.some(prefix =>
      prefix.trim() === simpleCommand
    );

    if (!isSafePrefix && !isSimpleSafeCommand) {
      return {
        isValid: false,
        command: '',
        reason: 'Command not in allowed list'
      };
    }

    return { isValid: true, command: trimmedCommand };
  }

// CRITICAL FIX: Use globalThis to survive Next.js hot-reloading
// Without this, dynamically registered user-provider configs are lost
declare global {
   
  var __enhancedLLMService__: EnhancedLLMService | undefined;
}

export const enhancedLLMService = globalThis.__enhancedLLMService__ ?? (globalThis.__enhancedLLMService__ = new EnhancedLLMService());


/**
 * Concurrent-fallback wrapper around streamWithVercelAI.
 *
 * Runs the primary provider stream in parallel with the next provider in
 * the configured fallback chain. After `silenceMs` of silence on the
 * primary, the fallback is fired; whichever emits a chunk first wins, the
 * loser's AbortController is fired (truly cancelling the in-flight HTTP
 * request so API credits are not wasted).
 *
 * Pass `concurrentFallbackMs: 0` to disable the coordinator and fall back
 * to the in-place single-fallback speculative race inside
 * `streamWithVercelAI`. Default: 20000 (20s).
 *
 * The internal `streamWithVercelAI` speculative fallback is disabled via
 * `speculativeFallbackMs: 0` to avoid double-fallback. The coordinator is
 * the single source of truth for the parallel-fallback race.
 *
 * @see llm-fallback-coordinator.ts for the race algorithm
 * @see vercel-ai-streaming.ts for the underlying stream factory
 */
export async function* streamWithConcurrentFallback(
  options: import('./vercel-ai-streaming').VercelStreamOptions & {
    /** Per-call override; 0 disables. Default 20000. */
    concurrentFallbackMs?: number;
    /** Override the fallback chain (e.g. for tests). */
    fallbackChain?: string[];
  },
  /**
   * Optional cross-provider model resolver. When provided, the fallback
   * handle uses this to pick a model ID that the fallback provider's
   * catalog can actually serve (instead of the original model, which may
   * not be supported by the fallback provider). Passed in by the caller
   * because streamWithConcurrentFallback is a standalone function with no
   * `this` binding to the EnhancedLLMService class.
   */
  findCompatibleModelFn?: (requestedModel: string, availableModels: string[]) => string | null,
): AsyncGenerator<import('../providers/llm-providers').StreamingResponse> {
  const {
    concurrentFallbackMs = 20000,
    fallbackChain,
    ...rest
  } = options;
  const { streamWithVercelAI } = await import('./vercel-ai-streaming');

  // Disabled: delegate so the internal speculative fallback runs as before.
  if (concurrentFallbackMs <= 0) {
    yield* streamWithVercelAI(options);
    return;
  }

  // PR-Z — first-chunk upstream timeout. The Vercel AI SDK's internal
  // `firstTokenTimeoutMs` (default 30s via LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS
  // in vercel-ai-streaming.ts:516) fires AFTER the silenceMs (20s) has
  // already started the chain-walk in `coordinateConcurrentFallback`. On
  // a Mistral hang (TCP/DNS) with no first chunk, both timers race and
  // the auto-controlled cleanup can bleed past 60s before any abort
  // propagates to the chain-walk's `signal?.aborted` check. Layer a
  // CLEARABLE first-chunk envelope around `streamWithVercelAI` so the
  // upstream controller aborts at `firstChunkTimeoutMs` regardless of
  // which internal timer fires. The envelope's `try/finally` clears the
  // timer on first success so long healthy streams (TTFT > 15s) are
  // unaffected. Default 25s covers any real provider's worst-case
  // cold-start while bounding the Mistral hang to O(silenceMs +
  // firstChunkTimeoutMs) wall-clock — well within the 120s route-level
  // stall watchdog (route layer's hard ceiling).
  // PR-Z2 (Stage 2 follow-up): NaN-guarded parseInt so a typo env-var
  // (e.g. LLM_STREAM_FIRST_CHUNK_TIMEOUT_MS=abc) cannot silently fall through
  // to setTimeout(0), which would abort the upstream envelope on the FIRST tick.
  const _rawFirstChunkMs = parseInt(
    process.env.LLM_STREAM_FIRST_CHUNK_TIMEOUT_MS ?? '25000', 10,
  );
  const firstChunkTimeoutMs =
    Number.isFinite(_rawFirstChunkMs) && _rawFirstChunkMs > 0
      ? _rawFirstChunkMs
      : 25000;

  // Helper: wrap streamWithVercelAI in a StreamHandle with an abort handle.
  const wrapAsHandle = (providerOverride?: string) => {
    const controller = new AbortController();
    const mergedSignal = rest.signal
      ? AbortSignal.any([rest.signal, controller.signal])
      : controller.signal;
    // Cross-provider model resolution: if the caller passed a
    // findCompatibleModel function (EnhancedLLMService does this), use
    // it to pick a model ID that the fallback provider's catalog can
    // actually serve. Without this, a stalled primary can launch a
    // fallback with an unsupported model ID and fail immediately,
    // turning the rescue into a no-op on exactly the cross-provider
    // case this feature exists for. When no resolver is provided
    // (e.g. from tests or external callers), fall through to the
    // original model ID.
    const modelForHandle = providerOverride && findCompatibleModelFn
      ? findCompatibleModelFn(
          options.model,
          ((PROVIDERS as any)[providerOverride]?.models || []).map((m: any) =>
            typeof m === 'string' ? m : m.id,
          ),
        ) || options.model
      : options.model;
    const upstreamGen = streamWithVercelAI({
      ...rest,
      ...(providerOverride
        ? { provider: providerOverride, model: modelForHandle }
        : {}),
      signal: mergedSignal,
      speculativeFallbackMs: 0,
    } as any);
    // PR-Z — clearable first-chunk envelope. Race a setTimeout against
    // the FIRST `.next()` resolution on the underlying iterator; clear
    // the timer on success via try/finally so a thrown (aborted)
    // upstream still cleans up. Yields the first chunk manually, then
    // iterates the rest synchronously — same call pattern as
    // `drainIterator` in llm-fallback-coordinator.ts but inline so the
    // timer can observe the first `.next()` resolution.
    const upstreamIter = upstreamGen[Symbol.asyncIterator]();
    let firstChunkTimer: NodeJS.Timeout | undefined = setTimeout(
      () => controller.abort(new Error(
        `Upstream first-chunk timeout exceeded (${firstChunkTimeoutMs}ms)`,
      )),
      firstChunkTimeoutMs,
    );
    const firstChunkEnvelope: AsyncGenerator<any> = (async function* () {
      try {
        const first = await upstreamIter.next();
        // PR-Z2 (Stage 2 follow-up): success-path timer clear removed -- the
        // `finally` clause below clears firstChunkTimer regardless of
        // completion path, so the inline clear here is redundant. Single
        // source of truth in `finally`.
        // PR-Z2 (Stage 2 follow-up): early return when first.done -- saves
        // one extra `.next()` round-trip when the upstream is empty.
        if (first.done) return;
        yield first.value;
        while (true) {
          const next = await upstreamIter.next();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        if (firstChunkTimer !== undefined) {
          clearTimeout(firstChunkTimer);
          firstChunkTimer = undefined;
        }
      }
    })();
    return Promise.resolve({
      gen: firstChunkEnvelope,
      abort: () => controller.abort(),
    });
  };

  yield* coordinateConcurrentFallback({
    primaryProvider: options.provider,
    model: options.model,
    fallbackChain,
    silenceMs: concurrentFallbackMs,
    signal: options.signal,
    requestId: `ellm-${Date.now()}`,
    createPrimaryStream: () => wrapAsHandle(),
    createFallbackStream: (fbProvider) => wrapAsHandle(fbProvider),
  });
}
