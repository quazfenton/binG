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
import { toolContextManager } from '../tools/tool-context-manager';
import { getToolManager, TOOL_REGISTRY } from '../tools';
import { sandboxBridge } from '../sandbox';
import { getProviderForTask, getModelForTask } from '../config/task-providers';
import { advancedToolCallDispatcher } from '../tools/tool-integration/parsers/dispatcher';
import { callMCPToolFromAI_SDK, getMCPToolsForAI_SDK } from '../mcp/architecture-integration';
import { chatLogger } from './chat-logger';

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
  task?: 'chat' | 'code' | 'embedding' | 'image' | 'tool' | 'agent' | 'ocr'; // Task-specific provider selection
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
      }
    ];

    configs.forEach(config => {
      if (config.apiKey) {
        this.endpointConfigs.set(config.provider, config);
      }
    });
  }

  private setupFallbackChains(): void {
    this.fallbackChains.set('openrouter', ['mistral', 'google', 'github', 'zen']);
    this.fallbackChains.set('chutes', ['openrouter', 'anthropic', 'google', 'mistral', 'github']);
    this.fallbackChains.set('anthropic', ['openrouter', 'mistral', 'google', 'github']);
    this.fallbackChains.set('google', ['openrouter', 'mistral', 'github', 'zen']);
    this.fallbackChains.set('mistral', ['openrouter', 'chutes', 'anthropic', 'google', 'github']);
    this.fallbackChains.set('github', ['openrouter', 'mistral', 'google', 'zen']);
    this.fallbackChains.set('portkey', ['openrouter', 'google', 'mistral', 'github']);
    this.fallbackChains.set('zen', ['mistral', 'google', 'openrouter', 'github']);
  }

  private startHealthMonitoring(): void {
    const endpoints = Array.from(this.endpointConfigs.values()).map(config => config.baseUrl);
    enhancedAPIClient.startHealthMonitoring(endpoints, 60000);
  }

  async generateResponse(request: EnhancedLLMRequest): Promise<LLMResponse> {
    const { enableTools, enableSandbox, userId, conversationId, requestId, provider, fallbackProviders, retryOptions, enableCircuitBreaker = true, task, ...llmRequest } = request;
    const requestStartTime = Date.now();

    // Use explicitly passed provider first, then task-specific provider, then default
    const actualProvider = provider || (task ? getProviderForTask(task) : getProviderForTask('chat'));
    const actualModel = task ? getModelForTask(task, llmRequest.model) : llmRequest.model;

    chatLogger.debug('Enhanced LLM service processing request', { requestId, provider: actualProvider, model: actualModel, userId }, {
      task,
      enableTools,
      enableSandbox,
      fallbackProviders: fallbackProviders?.length,
    });

    // If tools are enabled and user ID is provided, process tools
    if (enableTools && userId && conversationId) {
      const toolResult = await this.processToolRequest(
        llmRequest.messages,
        userId,
        conversationId
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
          toolResults: toolResult.toolResults
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

      return this.executeModelToolCallsFromResponse(response, userId, conversationId);
    };

    // Try primary provider first
    try {
      const fullRequest = { ...llmRequest, provider: actualProvider, model: actualModel };
      const response = await this.callProviderWithEnhancedClient(actualProvider, fullRequest, retryOptions, enableCircuitBreaker, requestId);
      const latency = Date.now() - requestStartTime;
      chatLogger.info('Provider request completed', { requestId, provider: actualProvider, model: actualModel }, {
        latencyMs: latency,
        tokensUsed: response.tokensUsed,
        finishReason: response.finishReason,
      });
      
      // Add metadata about actual provider/model used
      const enhancedResponse = {
        ...response,
        metadata: {
          ...response.metadata,
          actualProvider,
          actualModel,
          fallbackChain: [],
        },
      };
      
      return await postProcessToolCalls(enhancedResponse);
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
            model: supportedModel,
            provider: fallbackProvider
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
    const { provider, fallbackProviders, requestId, ...llmRequest } = request;
    const primaryProvider = provider || getProviderForTask('chat');
    const streamStartTime = Date.now();

    chatLogger.debug('Starting streaming request', { requestId, provider: primaryProvider, model: llmRequest.model });

    try {
      const fullRequest = { ...llmRequest, provider: primaryProvider };
      yield* llmService.generateStreamingResponse(fullRequest);
      const streamLatency = Date.now() - streamStartTime;
      chatLogger.info('Streaming completed successfully', { requestId, provider: primaryProvider, model: llmRequest.model }, {
        latencyMs: streamLatency,
      });
    } catch (error) {
      const streamLatency = Date.now() - streamStartTime;
      chatLogger.warn('Streaming failed for primary provider', { requestId, provider: primaryProvider, model: llmRequest.model }, {
        latencyMs: streamLatency,
        error: error instanceof Error ? error.message : String(error),
      });
      
      const fallbacks = fallbackProviders || this.fallbackChains.get(primaryProvider) || [];
      const availableFallbacks = fallbacks.filter(fallbackProvider => 
        this.endpointConfigs.has(fallbackProvider) && 
        this.isProviderHealthy(fallbackProvider) &&
        PROVIDERS[fallbackProvider]?.supportsStreaming
      );

      if (availableFallbacks.length === 0) {
        throw this.createEnhancedError(
          `No streaming fallback providers available for ${primaryProvider}`,
          'NO_STREAMING_FALLBACKS',
          error as Error
        );
      }

      const fallbackProvider = availableFallbacks[0];
      const fallbackConfig = this.endpointConfigs.get(fallbackProvider)!;
      const supportedModel = this.findCompatibleModel(llmRequest.model, fallbackConfig.models);

      if (supportedModel) {
        chatLogger.info('Falling back to streaming provider', { requestId, provider: fallbackProvider, model: supportedModel });
        const fallbackRequest = {
          ...llmRequest,
          model: supportedModel,
          provider: fallbackProvider
        };

        yield* llmService.generateStreamingResponse(fallbackRequest);
        const fallbackLatency = Date.now() - streamStartTime;
        chatLogger.info('Streaming fallback completed', { requestId, provider: fallbackProvider, model: supportedModel }, {
          latencyMs: fallbackLatency,
        });
      } else {
        throw this.createEnhancedError(
          `No compatible model found for streaming fallback`,
          'NO_COMPATIBLE_MODEL',
          error as Error
        );
      }
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

    // CRITICAL: Validate API key is present before making request
    if (!config.apiKey || config.apiKey.trim() === '') {
      chatLogger.error(`Provider ${provider} missing API key`, { requestId, provider }, {
        hasApiKey: !!config.apiKey,
        apiKeyLength: config.apiKey?.length || 0,
        envVarName: this.getEnvVarNameForProvider(provider),
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
      // CRITICAL FIX: Pass API key explicitly in request for providers that support it
      // This ensures API keys from env vars are used even if llmService wasn't initialized properly
      // Note: Using 'apiKey' (singular) which is read by generateResponse method
      apiKey: config.apiKey,
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
      const match = model.match(pattern);
      if (match) {
        return match[1].toLowerCase();
      }
    }

    return model.split('-')[0].toLowerCase();
  }

  private isProviderHealthy(provider: string): boolean {
    const config = this.endpointConfigs.get(provider);
    if (!config) return false;

    const health = enhancedAPIClient.getEndpointHealth(config.baseUrl) as any;
    return health.isHealthy !== false;
  }

  private enhanceError(error: Error, provider: string): Error {
    const enhancedError = new Error(error.message);
    const errorMessage = error.message.toLowerCase();

    // Check for HTTP status codes first (more specific than text patterns)
    if (error.message.includes('401') || error.message.includes('403')) {
      enhancedError.message = `Authentication failed for ${provider}. Please check your API key configuration.`;
    } else if (error.message.includes('429') || error.message.includes('rate limit')) {
      enhancedError.message = `Rate limit exceeded for ${provider}. The system will automatically try alternative providers.`;
    } else if (error.message.includes('402') || error.message.includes('quota') || error.message.includes('billing')) {
      enhancedError.message = `API quota exceeded for ${provider}. Switching to alternative provider.`;
    } else if (error.message.includes('408') || error.message.includes('504') || error.message.includes('timeout')) {
      enhancedError.message = `Request timeout for ${provider}. The system will retry with exponential backoff.`;
    } else if (error.message.includes('network') || error.message.includes('fetch') || error.message.includes('connection')) {
      enhancedError.message = `Network error connecting to ${provider}. Checking alternative providers.`;
    } else if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
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

  async processToolRequest(messages: LLMMessage[], userId: string, conversationId: string) {
    try {
      const result = await toolContextManager.processToolRequest(
        messages,
        userId,
        conversationId
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
    conversationId: string
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
        : await callMCPToolFromAI_SDK(selectedTool, call.arguments, userId);

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

export const enhancedLLMService = new EnhancedLLMService();
