/**
 * Enhanced LLM Service with Fallback System
 * 
 * Integrates the Enhanced API Client with the existing LLM service
 * to provide robust API communication with fallback mechanisms.
 */

import { enhancedAPIClient, type RequestConfig, type APIResponse } from './enhanced-api-client';
import { llmService, type LLMRequest, type LLMResponse, type StreamingResponse, PROVIDERS } from './llm-providers';

export interface EnhancedLLMRequest extends LLMRequest {
  fallbackProviders?: string[];
  retryOptions?: {
    maxAttempts?: number;
    backoffStrategy?: 'exponential' | 'linear' | 'fixed';
    baseDelay?: number;
    maxDelay?: number;
  };
  enableCircuitBreaker?: boolean;
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
    // Configure endpoint mappings for different providers
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
    // Define fallback chains for different providers
    this.fallbackChains.set('openrouter', ['chutes', 'anthropic', 'google']);
    this.fallbackChains.set('chutes', ['openrouter', 'anthropic', 'google']);
    this.fallbackChains.set('anthropic', ['openrouter', 'chutes', 'google']);
    this.fallbackChains.set('google', ['openrouter', 'chutes', 'anthropic']);
    this.fallbackChains.set('portkey', ['openrouter', 'chutes', 'anthropic']);
  }

  private startHealthMonitoring(): void {
    const endpoints = Array.from(this.endpointConfigs.values()).map(config => config.baseUrl);
    enhancedAPIClient.startHealthMonitoring(endpoints, 60000); // Check every minute
  }

  async generateResponse(request: EnhancedLLMRequest): Promise<LLMResponse> {
    const { provider, fallbackProviders, retryOptions, enableCircuitBreaker = true, ...llmRequest } = request;

    try {
      // Try primary provider first
      const fullRequest = { ...llmRequest, provider };
      return await this.callProviderWithEnhancedClient(provider, fullRequest, retryOptions, enableCircuitBreaker);
    } catch (primaryError) {
      console.warn(`Primary provider ${provider} failed:`, primaryError);

      // Determine fallback providers
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

      // Try fallback providers
      for (const fallbackProvider of availableFallbacks) {
        try {
          console.log(`Trying fallback provider: ${fallbackProvider}`);
          
          // Check if the model is supported by the fallback provider
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

          // Add fallback information to response
          return {
            ...response,
            provider: `${provider} -> ${fallbackProvider}` // Indicate fallback was used
          };
        } catch (fallbackError) {
          console.warn(`Fallback provider ${fallbackProvider} failed:`, fallbackError);
          continue;
        }
      }

      // All providers failed
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
      // For streaming, we'll use the original service but with enhanced error handling
      const fullRequest = { ...llmRequest, provider };
      yield* llmService.generateStreamingResponse(fullRequest);
    } catch (error) {
      console.warn(`Streaming failed for ${provider}:`, error);
      
      // For streaming fallback, we need to restart the stream with a different provider
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

      // Try first available streaming fallback
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

    // For now, we'll use the original LLM service but wrap it with enhanced error handling
    // In a full implementation, we would refactor the LLM service to use the enhanced client
    try {
      return await llmService.generateResponse(request);
    } catch (error) {
      // Enhance the error with better user messages
      throw this.enhanceError(error as Error, provider);
    }
  }

  private findCompatibleModel(requestedModel: string, availableModels: string[]): string | null {
    // Direct match
    if (availableModels.includes(requestedModel)) {
      return requestedModel;
    }

    // Try to find similar models based on naming patterns
    const modelFamily = this.extractModelFamily(requestedModel);
    const compatibleModel = availableModels.find(model => 
      this.extractModelFamily(model) === modelFamily
    );

    return compatibleModel || availableModels[0] || null; // Return first available as last resort
  }

  private extractModelFamily(model: string): string {
    // Extract model family from model name (e.g., "gpt-4" from "gpt-4-turbo")
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
    return health.isHealthy !== false; // Default to healthy if no health data
  }

  private enhanceError(error: Error, provider: string): Error {
    const enhancedError = new Error(error.message);
    
    // Add user-friendly messages based on error patterns
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

  // Health and monitoring methods
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

  // Cleanup
  destroy(): void {
    enhancedAPIClient.destroy();
  }
}

// Export singleton instance
export const enhancedLLMService = new EnhancedLLMService();