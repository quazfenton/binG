/**
 * Enhanced LLM Service with Fallback System
 * 
 * Integrates the Enhanced API Client with the existing LLM service
 * to provide robust API communication with fallback mechanisms.
 */

import { enhancedAPIClient, type RequestConfig, type APIResponse } from './enhanced-api-client';
import { llmService, type LLMRequest, type LLMResponse, type StreamingResponse, PROVIDERS } from './llm-providers';
import { toolContextManager } from '../services/tool-context-manager';
import { sandboxBridge } from '../sandbox';

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
  userId?: string;
  conversationId?: string;
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
        baseUrl: process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENAI_API_KEY || '',
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
        provider: 'portkey',
        baseUrl: 'https://api.portkey.ai/v1',
        apiKey: process.env.PORTKEY_API_KEY || '',
        models: PROVIDERS.portkey.models,
        priority: 5
      }
    ];

    configs.forEach(config => {
      if (config.apiKey) {
        this.endpointConfigs.set(config.provider, config);
      }
    });
  }

  private setupFallbackChains(): void {
    this.fallbackChains.set('openrouter', ['chutes', 'anthropic', 'google']);
    this.fallbackChains.set('chutes', ['openrouter', 'anthropic', 'google']);
    this.fallbackChains.set('anthropic', ['openrouter', 'chutes', 'google']);
    this.fallbackChains.set('google', ['openrouter', 'chutes', 'anthropic']);
    this.fallbackChains.set('portkey', ['openrouter', 'chutes', 'anthropic']);
  }

  private startHealthMonitoring(): void {
    const endpoints = Array.from(this.endpointConfigs.values()).map(config => config.baseUrl);
    enhancedAPIClient.startHealthMonitoring(endpoints, 60000);
  }

  async generateResponse(request: EnhancedLLMRequest): Promise<LLMResponse> {
    const { enableTools, enableSandbox, userId, conversationId, provider, fallbackProviders, retryOptions, enableCircuitBreaker = true, ...llmRequest } = request;

    // If tools are enabled and user ID is provided, process tools
    if (enableTools && userId && conversationId) {
      const toolResult = await this.processToolRequest(
        llmRequest.messages,
        userId,
        conversationId
      );

      if (toolResult.requiresAuth && toolResult.authUrl) {
        return {
          content: `AUTH_REQUIRED:${toolResult.authUrl}:${toolResult.toolName}`,
          tokensUsed: 0,
          finishReason: 'tool_auth_required',
          timestamp: new Date(),
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }

      if (toolResult.toolCalls && toolResult.toolCalls.length > 0) {
        const updatedMessages = [
          ...llmRequest.messages,
          { role: 'assistant' as const, content: JSON.stringify(toolResult.toolCalls) },
          { role: 'tool' as const, content: JSON.stringify(toolResult.toolResults) }
        ];

        const updatedRequest = {
          ...llmRequest,
          messages: updatedMessages
        };

        return await this.callProviderWithEnhancedClient(provider, updatedRequest, retryOptions, enableCircuitBreaker);
      }
    }

    // If sandbox is enabled, process sandbox request
    if (enableSandbox && userId && conversationId) {
      return await this.processSandboxRequest(request, userId, conversationId);
    }

    // Try primary provider first
    try {
      const fullRequest = { ...llmRequest, provider };
      return await this.callProviderWithEnhancedClient(provider, fullRequest, retryOptions, enableCircuitBreaker);
    } catch (primaryError) {
      console.warn(`Primary provider ${provider} failed:`, primaryError);

      const fallbacks = fallbackProviders || this.fallbackChains.get(provider) || [];
      const availableFallbacks = fallbacks.filter(fallbackProvider =>
        this.endpointConfigs.has(fallbackProvider) &&
        this.isProviderHealthy(fallbackProvider)
      );

      if (availableFallbacks.length === 0) {
        throw this.createEnhancedError(
          `No healthy fallback providers available for ${provider}`,
          'NO_FALLBACKS_AVAILABLE',
          primaryError as Error
        );
      }

      for (const fallbackProvider of availableFallbacks) {
        try {
          console.log(`Trying fallback provider: ${fallbackProvider}`);

          const fallbackConfig = this.endpointConfigs.get(fallbackProvider)!;
          const supportedModel = this.findCompatibleModel(llmRequest.model, fallbackConfig.models);

          if (!supportedModel) {
            console.warn(`Model ${llmRequest.model} not supported by ${fallbackProvider}, skipping`);
            continue;
          }

          const fallbackRequest = {
            ...llmRequest,
            model: supportedModel,
            provider: fallbackProvider
          };

          const response = await this.callProviderWithEnhancedClient(
            fallbackProvider,
            fallbackRequest,
            retryOptions,
            enableCircuitBreaker
          );

          return {
            ...response,
            provider: `${provider} -> ${fallbackProvider}`
          };
        } catch (fallbackError) {
          console.warn(`Fallback provider ${fallbackProvider} failed:`, fallbackError);
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
    const { provider, fallbackProviders, ...llmRequest } = request;

    try {
      const fullRequest = { ...llmRequest, provider };
      yield* llmService.generateStreamingResponse(fullRequest);
    } catch (error) {
      console.warn(`Streaming failed for ${provider}:`, error);
      
      const fallbacks = fallbackProviders || this.fallbackChains.get(provider) || [];
      const availableFallbacks = fallbacks.filter(fallbackProvider => 
        this.endpointConfigs.has(fallbackProvider) && 
        this.isProviderHealthy(fallbackProvider) &&
        PROVIDERS[fallbackProvider]?.supportsStreaming
      );

      if (availableFallbacks.length === 0) {
        throw this.createEnhancedError(
          `No streaming fallback providers available for ${provider}`,
          'NO_STREAMING_FALLBACKS',
          error as Error
        );
      }

      const fallbackProvider = availableFallbacks[0];
      const fallbackConfig = this.endpointConfigs.get(fallbackProvider)!;
      const supportedModel = this.findCompatibleModel(llmRequest.model, fallbackConfig.models);

      if (supportedModel) {
        console.log(`Falling back to streaming provider: ${fallbackProvider}`);
        const fallbackRequest = {
          ...llmRequest,
          model: supportedModel,
          provider: fallbackProvider
        };

        yield* llmService.generateStreamingResponse(fallbackRequest);
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
    request: LLMRequest,
    retryOptions?: any,
    enableCircuitBreaker: boolean = true
  ): Promise<LLMResponse> {
    const config = this.endpointConfigs.get(provider);
    if (!config) {
      throw new Error(`Provider ${provider} not configured`);
    }

    try {
      return await llmService.generateResponse(request);
    } catch (error) {
      throw this.enhanceError(error as Error, provider);
    }
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
    
    if (error.message.includes('API key')) {
      enhancedError.message = `Authentication failed for ${provider}. Please check your API key configuration.`;
    } else if (error.message.includes('rate limit')) {
      enhancedError.message = `Rate limit exceeded for ${provider}. The system will automatically try alternative providers.`;
    } else if (error.message.includes('quota')) {
      enhancedError.message = `API quota exceeded for ${provider}. Switching to alternative provider.`;
    } else if (error.message.includes('timeout')) {
      enhancedError.message = `Request timeout for ${provider}. The system will retry with exponential backoff.`;
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      enhancedError.message = `Network error connecting to ${provider}. Checking alternative providers.`;
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

      const result = await sandboxBridge.executeCommand(session.sandboxId, lastUserMessage);

      return {
        content: `Sandbox execution completed.\n\nOutput:\n${result.stdout || 'No output'}\n${result.stderr ? `\nErrors:\n${result.stderr}` : ''}`,
        tokensUsed: 0,
        finishReason: 'stop',
        timestamp: new Date(),
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
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

  destroy(): void {
    enhancedAPIClient.destroy();
  }
}

export const enhancedLLMService = new EnhancedLLMService();