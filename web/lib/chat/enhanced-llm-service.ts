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
import { llmService, type LLMRequest, type LLMResponse, type StreamingResponse, type LLMMessage, PROVIDERS } from './llm-providers';
import { PROVIDER_FALLBACK_CHAINS } from './provider-fallback-chains';
import { toolContextManager } from '../tools/tool-context-manager';
import { getToolManager, TOOL_REGISTRY } from '../tools';
import { sandboxBridge } from '../sandbox';
import { getProviderForTask, getModelForTask } from '../config/task-providers';
import { advancedToolCallDispatcher } from '../tools/tool-integration/parsers/dispatcher';
import { callMCPToolFromAI_SDK, getMCPToolsForAI_SDK } from '../mcp/architecture-integration';
import { chatLogger } from './chat-logger';
import { chatRequestLogger } from './chat-request-logger';

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
  /** VFS scope path for session-scoped file operations (e.g., "project/sessions/001") */
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

  constructor() {
    this.initializeEndpointConfigs();
    this.setupFallbackChains();
    this.startHealthMonitoring();
  }

  private initializeEndpointConfigs(): void {
    const configs: LLMEndpointConfig[] = [
      {
        provider: 'openrouter',
        baseUrl: process.env.OPENROUTER_BASE_URL || process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY || '',
        models: PROVIDERS.openrouter.models,
        priority: 1
      },
      {
        provider: 'chutes',
        baseUrl: 'https://llm.chutes.ai/v1',
        apiKey: process.env.CHUTES_API_KEY || '',
        models: PROVIDERS.chutes.models,
        priority: 2
      },
      {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        models: PROVIDERS.anthropic.models,
        priority: 3
      },
      {
        provider: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: process.env.GOOGLE_API_KEY || '',
        models: PROVIDERS.google.models,
        priority: 4
      },
      {
        provider: 'mistral',
        baseUrl: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
        apiKey: process.env.MISTRAL_API_KEY || '',
        models: PROVIDERS.mistral.models,
        priority: 5
      },
      {
        provider: 'github',
        baseUrl: process.env.GITHUB_MODELS_BASE_URL || 'https://models.inference.ai.azure.com',
        apiKey: process.env.GITHUB_MODELS_API_KEY || process.env.AZURE_OPENAI_API_KEY || '',
        models: PROVIDERS.github.models,
        priority: 6
      },
      {
        provider: 'portkey',
        baseUrl: 'https://api.portkey.ai/v1',
        apiKey: process.env.PORTKEY_API_KEY || '',
        models: PROVIDERS.portkey.models,
        priority: 7
      },
      {
        provider: 'zen',
        baseUrl: process.env.ZEN_BASE_URL || 'https://api.zen.ai/v1',
        apiKey: process.env.ZEN_API_KEY || '',
        models: PROVIDERS.zen.models,
        priority: 8
      },
      {
        provider: 'nvidia',
        baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        apiKey: process.env.NVIDIA_API_KEY || '',
        models: PROVIDERS.nvidia.models,
        priority: 9
      }
    ];

    configs.forEach(config => {
      if (config.apiKey) {
        this.endpointConfigs.set(config.provider, config);
      }
    });
  }

  /**
   * Dynamically register a provider config using a user-provided API key.
   * This allows users to use any provider defined in PROVIDERS without
   * requiring server-side env vars for each one.
   */
  private registerUserProviderConfig(provider: string, userApiKey: string): void {
    const providerDef = PROVIDERS[provider];
    if (!providerDef) {
      chatLogger.warn('Unknown provider, cannot register config', { provider });
      return;
    }

    // Get base URL from env var or use default based on provider
    const baseUrl = this.getDefaultBaseUrlForProvider(provider);

    const config: LLMEndpointConfig = {
      provider,
      baseUrl,
      apiKey: userApiKey,
      models: providerDef.models || [],
      priority: 99 // Low priority for user-provided configs
    };

    this.endpointConfigs.set(provider, config);
    chatLogger.debug('Registered user provider config', { provider, baseUrl });
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
      'anyscale': 'https://api.endpoints.anyscale.com/v1',
      'lepton': 'https://<your-workspace>.lepton.run/api/v1',
      'chutes': 'https://llm.chutes.ai/v1',
      'portkey': 'https://api.portkey.ai/v1',
      'zen': process.env.ZEN_BASE_URL || 'https://api.zen.ai/v1',
    };
    return baseUrlMap[provider] || `https://api.${provider}.com/v1`;
  }

  private setupFallbackChains(): void {
    // Use centralized fallback chains from provider-fallback-chains.ts
    // This ensures all paths (enhanced-llm-service, unified-agent, etc.)
    // use the same fallback provider order.
    for (const [provider, chain] of Object.entries(PROVIDER_FALLBACK_CHAINS)) {
      this.fallbackChains.set(provider, chain);
    }
  }

  private startHealthMonitoring(): void {
    const endpoints = Array.from(this.endpointConfigs.values()).map(config => config.baseUrl);
    enhancedAPIClient.startHealthMonitoring(endpoints, 60000);
  }

  async generateResponse(request: EnhancedLLMRequest): Promise<LLMResponse> {
    const { enableTools, enableSandbox, userId, conversationId, requestId, provider, fallbackProviders, retryOptions, enableCircuitBreaker = true, task, apiKeys, contextPack, autoAttachFiles, ...llmRequest } = request;
    const requestStartTime = Date.now();

    // Use explicitly passed provider first, then task-specific provider, then default
    const actualProvider = provider || (task ? getProviderForTask(task) : getProviderForTask('chat'));
    const actualModel = task
      ? getModelForTask(task, llmRequest.model)
      : llmRequest.model || 'default';  // Default model if none specified

    // CRITICAL FIX: Dynamically register provider if user provided API key but provider isn't in endpointConfigs.
    // This allows user-provided keys to work for any provider defined in PROVIDERS,
    // without requiring server-side env vars for every provider.
    if (!this.endpointConfigs.has(actualProvider)) {
      const userApiKey = apiKeys?.[actualProvider];
      if (userApiKey && PROVIDERS[actualProvider]) {
        this.registerUserProviderConfig(actualProvider, userApiKey);
        chatLogger.debug('Dynamically registered user-provided provider config', { requestId, provider: actualProvider });
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
        const rootPath = conversationId.split(':').pop() || '/';
        
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
          format: contextPack.format || 'json',
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
      const contextPrefix = `\n\n--- WORKSPACE CONTEXT (JSON) ---\n${contextPackBundle}\n--- END CONTEXT ---\n`;
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
    const sessionIdFromConv = conversationId?.includes(':') 
      ? conversationId.split(':')[1] 
      : conversationId;
    const computedScopePath = request.scopePath 
      || (sessionIdFromConv ? `project/sessions/${sessionIdFromConv}` : 'project');

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
      }

      // Log request start for telemetry
      await chatRequestLogger.logRequestStart(
        requestId || `llm-${Date.now()}`,
        userId || 'anonymous',
        actualProvider,
        actualModel,
        fullRequest.messages,
        fullRequest.stream || false
      )
      
      const response = await this.callProviderWithEnhancedClient(actualProvider, fullRequest, retryOptions, enableCircuitBreaker, requestId)
      const latency = Date.now() - requestStartTime
      chatLogger.info('Provider request completed', { requestId, provider: actualProvider, model: actualModel }, {
        latencyMs: latency,
        tokensUsed: response.tokensUsed,
        finishReason: response.finishReason,
      })

      // Add metadata about actual provider/model used
      const enhancedResponse = {
        ...response,
        metadata: {
          ...response.metadata,
          actualProvider,
          actualModel,
          fallbackChain: [],
        },
      }

      const result = await postProcessToolCalls(enhancedResponse)
      
      // Record telemetry for model ranking — use ACTUAL provider/model (handles fallbacks)
      await chatRequestLogger.logRequestComplete(
        requestId || `llm-${Date.now()}`,
        true,  // success
        undefined,  // responseSize
        typeof response.tokensUsed === 'number'
          ? { prompt: 0, completion: 0, total: response.tokensUsed }
          : response.tokensUsed,
        latency,
        undefined,  // error
        actualProvider,
        actualModel,
      )
      
      return result
    } catch (primaryError) {
      const primaryLatency = Date.now() - requestStartTime;
      chatLogger.warn('Primary provider failed', { requestId, provider: actualProvider, model: actualModel }, {
        latencyMs: primaryLatency,
        error: primaryError instanceof Error ? primaryError.message : String(primaryError),
      });

      const fallbacks = fallbackProviders || this.fallbackChains.get(actualProvider) || [];
      const availableFallbacks = fallbacks.filter(fallbackProvider =>
        this.endpointConfigs.has(fallbackProvider) &&
        this.isProviderHealthy(fallbackProvider)
      );

      // Track the fallback chain with detailed error information
      const fallbackChainLog: string[] = [];
      fallbackChainLog.push(`${actualProvider}/${actualModel} failed: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`);

      if (availableFallbacks.length === 0) {
        chatLogger.error('No healthy fallback providers available', { requestId, provider: actualProvider }, {
          attemptedFallbacks: fallbacks.length,
        });
        throw this.createEnhancedError(
          `No healthy fallback providers available for ${actualProvider}`,
          'NO_FALLBACKS_AVAILABLE',
          primaryError as Error
        );
      }

      for (let attemptIndex = 0; attemptIndex < availableFallbacks.length; attemptIndex++) {
        const fallbackProvider = availableFallbacks[attemptIndex];
        const fallbackStartTime = Date.now();
        let fallbackModelUsed = actualModel;

        try {
          chatLogger.info('Trying fallback provider', { requestId, provider: fallbackProvider, model: actualModel }, {
            attempt: attemptIndex + 1,
            totalFallbacks: availableFallbacks.length,
          });

          const fallbackConfig = this.endpointConfigs.get(fallbackProvider)!;
          const supportedModel = this.findCompatibleModel(actualModel, fallbackConfig.models);

          if (!supportedModel) {
            const modelError = `Model '${actualModel}' not supported by ${fallbackProvider}`;
            chatLogger.warn('Model not supported by fallback provider', { requestId, provider: fallbackProvider, model: actualModel });
            fallbackChainLog.push(`${fallbackProvider}/${actualModel} skipped: ${modelError}`);
            continue;
          }

          fallbackModelUsed = supportedModel;

          const fallbackRequest = {
            ...llmRequest,
            messages: processedMessages,
            model: supportedModel,
            provider: fallbackProvider,
            // Pass user API key to fallback provider
            apiKey: userApiKey,
          };

          const response = await this.callProviderWithEnhancedClient(
            fallbackProvider,
            fallbackRequest,
            retryOptions,
            enableCircuitBreaker,
            requestId
          );

          const fallbackLatency = Date.now() - fallbackStartTime;
          chatLogger.info('Fallback provider succeeded', { requestId, provider: fallbackProvider, model: supportedModel }, {
            latencyMs: fallbackLatency,
            attempt: attemptIndex + 1,
            tokensUsed: response.tokensUsed,
          });

          // FIX: Record fallback model telemetry under its ACTUAL name
          await chatRequestLogger.logRequestComplete(
            requestId || `llm-${Date.now()}`,
            true,
            undefined,
            typeof response.tokensUsed === 'number'
              ? { prompt: 0, completion: 0, total: response.tokensUsed }
              : response.tokensUsed,
            fallbackLatency,
            undefined,
            fallbackProvider,
            supportedModel,
          ).catch(() => {}); // don't throw on telemetry failure

          // Build successful fallback response with full metadata
          const fallbackResponse = {
            ...response,
            metadata: {
              ...response.metadata,
              actualProvider: fallbackProvider,
              actualModel: supportedModel,
              fallbackChain: fallbackChainLog,
            },
          };
          return await postProcessToolCalls(fallbackResponse);
        } catch (fallbackError) {
          const fallbackLatency = Date.now() - fallbackStartTime;
          const errorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          chatLogger.warn('Fallback provider failed', { requestId, provider: fallbackProvider, model: fallbackModelUsed }, {
            latencyMs: fallbackLatency,
            attempt: attemptIndex + 1,
            error: errorMsg,
          });
          fallbackChainLog.push(`${fallbackProvider}/${fallbackModelUsed} failed: ${errorMsg}`);
          continue;
        }
      }

      throw this.createEnhancedError(
        'All providers failed to generate response',
        'ALL_PROVIDERS_FAILED',
        primaryError as Error
      );
    }
  }

  async *generateStreamingResponse(request: EnhancedLLMRequest): AsyncGenerator<StreamingResponse> {
    const { provider, fallbackProviders, requestId, apiKeys, contextPack, ...llmRequest } = request;
    const primaryProvider = provider || getProviderForTask('chat');
    const streamStartTime = Date.now();

    // CRITICAL FIX: Dynamically register provider if user provided API key but provider isn't in endpointConfigs.
    if (!this.endpointConfigs.has(primaryProvider)) {
      const userApiKey = apiKeys?.[primaryProvider];
      if (userApiKey && PROVIDERS[primaryProvider]) {
        this.registerUserProviderConfig(primaryProvider, userApiKey);
        chatLogger.debug('Dynamically registered user-provided provider config (streaming)', { requestId, provider: primaryProvider });
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
        const rootPath = request.conversationId.split(':').pop() || '/';
        
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
          format: contextPack.format || 'json',
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
      const contextPrefix = `\n\n--- WORKSPACE CONTEXT (JSON) ---\n${contextPackBundle}\n--- END CONTEXT ---\n`;
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

    try {
      // NEW: Use Vercel AI SDK for unified streaming across all providers
      const { streamWithVercelAI } = await import('./vercel-ai-streaming');

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
        'anyscale': 'anyscale',
        'deepinfra': 'deepinfra',
        'lepton': 'lepton',
        // Custom providers (via compatibility wrapper)
        'zo': 'zo',
      };

      const vercelProvider = vercelProviderMap[primaryProvider];

      if (vercelProvider) {
        // Build tools if enabled — Vercel AI SDK handles tool calling natively
        let vercelTools: Record<string, any> | undefined;
        if (request.enableTools && request.userId) {
          try {
            const { getAllTools, extractPublicUrls } = await import('./vercel-ai-tools');
            // Compute session-aware scopePath for VFS tools
            const sessionIdFromConv = request.conversationId?.includes(':') 
              ? request.conversationId.split(':')[1] 
              : request.conversationId;
            const computedScopePath = (request as any).scopePath 
              || (sessionIdFromConv ? `project/sessions/${sessionIdFromConv}` : 'project');
            
            vercelTools = await getAllTools({
              userId: request.userId,
              conversationId: request.conversationId,
              sessionId: sessionIdFromConv,
              requestId,
              scopePath: computedScopePath,  // Session-aware path for VFS tools
            });

            // FIX: Merge VFS MCP tools (write_file, read_file, apply_diff, etc.)
            // into the Vercel AI SDK tool set so the LLM can call them during streaming.
            try {
              const { getVFSToolDefinitions, getVFSTool, toolContextStore } = await import('../mcp/vfs-mcp-tools');
              const { tool: createTool } = await import('ai');
              const vfsToolDefs = getVFSToolDefinitions();
              for (const toolDef of vfsToolDefs) {
                const toolName = toolDef.function.name;
                // Don't overwrite existing tools
                if (!vercelTools![toolName]) {
                  vercelTools![toolName] = createTool({
                    description: toolDef.function.description,
                    parameters: toolDef.function.parameters,
                    // @ts-expect-error AI SDK v6 tool execute signature changed frequently
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

                      const result = await toolContextStore.run(
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
                          error: result?.error,
                          userId: request.userId,
                          requestId,
                        });
                        throw new Error(result?.error || `VFS tool ${toolName} execution failed`);
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

            // Pre-detect URLs in the last user message and inject a hint
            const lastUserMsg = [...llmRequest.messages].reverse().find(m => m.role === 'user');
            const lastText = typeof lastUserMsg?.content === 'string'
              ? lastUserMsg.content
              : (lastUserMsg?.content as any[])?.find?.((c: any) => c.type === 'text')?.text || '';
            const detectedUrls = extractPublicUrls(lastText);
            if (detectedUrls.length > 0 && vercelTools['web_fetch']) {
              llmRequest.messages = [
                ...llmRequest.messages,
                {
                  role: 'system' as const,
                  content: `[Tool hint: URLs detected in user message. Use the web_fetch tool to read: ${detectedUrls.join(', ')}]`,
                },
              ];
              chatLogger.info('URL detected in prompt, injected web_fetch hint', { requestId, urls: detectedUrls });
            }
          } catch (toolErr: any) {
            chatLogger.warn('Failed to build Vercel AI tools, proceeding without', { requestId, error: toolErr.message });
          }
        }

      // Wrap with auto-continue support
        const { streamWithAutoContinue } = await import('@/lib/virtual-filesystem/smart-context');
        const baseStream = streamWithVercelAI({
          provider: vercelProvider,
          model: llmRequest.model || 'default',
          messages: processedMessages,
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
        });

        yield* streamWithAutoContinue(baseStream, {
          userId: request.userId || 'anonymous',
          conversationId: request.conversationId,
          enableAutoContinue: true,
        });

        const streamLatency = Date.now() - streamStartTime;
        chatLogger.info('Vercel AI SDK streaming completed', { requestId, provider: primaryProvider, model: llmRequest.model }, {
          latencyMs: streamLatency,
        });
        return;
      }

      // Fallback to legacy streaming for unsupported providers
      chatLogger.warn('Provider not supported by Vercel AI SDK, using legacy streaming', { provider: primaryProvider });

      const fullRequest = { ...llmRequest, messages: processedMessages, provider: primaryProvider, apiKey: userApiKey || llmRequest.apiKey };

      // Wrap with auto-continue support
      const { streamWithAutoContinue } = await import('@/lib/virtual-filesystem/smart-context');
      const baseStream = llmService.generateStreamingResponse(fullRequest);
      yield* streamWithAutoContinue(baseStream, {
        userId: request.userId || 'anonymous',
        conversationId: request.conversationId,
        enableAutoContinue: true,
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
        const hasConfig = this.endpointConfigs.has(fallbackProvider);
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
          const hasConfig = this.endpointConfigs.has(fallbackProvider);
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
        const fallbackConfig = this.endpointConfigs.get(fallbackProvider)!;
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

          const fallbackRequest = {
            ...llmRequest,
            messages: processedMessages,
            model: supportedModel,
            provider: fallbackProvider,
            // Pass user API key to fallback provider
            apiKey: userApiKey,
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
    const config = this.endpointConfigs.get(provider);
    if (!config) {
      throw new Error(`Provider ${provider} not configured`);
    }

    // Use request's API key if provided (user override), otherwise fall back to server config
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
      return response;
    } catch (error) {
      const callLatency = Date.now() - callStartTime;
      chatLogger.debug('Provider call failed', { requestId, provider, model: request.model }, {
        latencyMs: callLatency,
        error: error instanceof Error ? error.message : String(error),
      });
      throw this.enhanceError(error as Error, provider);
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

  private enhanceError(error: Error, provider: string): Error {
    const enhancedError = new Error(error.message);
    const msg = error.message.toLowerCase();

    // Check for HTTP status codes first (more specific than text patterns)
    if (msg.includes('401') || msg.includes('403')) {
      enhancedError.message = `Authentication failed for ${provider}. Please check your API key configuration.`;
    } else if (msg.includes('429') || msg.includes('rate limit')) {
      enhancedError.message = `Rate limit exceeded for ${provider}. The system will automatically try alternative providers.`;
    } else if (msg.includes('402') || msg.includes('quota') || msg.includes('billing')) {
      enhancedError.message = `API quota exceeded for ${provider}. Switching to alternative provider.`;
    } else if (msg.includes('408') || msg.includes('504') || msg.includes('timeout')) {
      enhancedError.message = `Request timeout for ${provider}. The system will retry with exponential backoff.`;
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
      console.error('Tool request processing error:', error);
      return {
        requiresAuth: false,
        toolCalls: [],
        toolResults: [],
        content: `Error processing tool request: ${error.message}`
      };
    }
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
      console.warn('[EnhancedLLMService] Rejected tool calls during parser validation:', dispatch.rejected);
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

      return {
        content: `Sandbox execution completed.\n\nOutput:\n${result.output || 'No output'}${result.exitCode !== undefined && result.exitCode !== 0 ? `\n\nExit code: ${result.exitCode}` : ''}`,
        tokensUsed: 0,
        finishReason: result.success ? 'stop' : 'error',
        timestamp: new Date(),
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        metadata: {
          success: result.success,
          exitCode: result.exitCode
        }
      };
    } catch (error: any) {
      console.error('Sandbox request processing error:', error);
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
  // eslint-disable-next-line no-var
  var __enhancedLLMService__: EnhancedLLMService | undefined;
}

export const enhancedLLMService = globalThis.__enhancedLLMService__ ?? (globalThis.__enhancedLLMService__ = new EnhancedLLMService());
