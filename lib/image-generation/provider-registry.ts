/**
 * Image Generation Provider Registry
 * Manages multiple providers with fallback chain support
 */

import type {
  ImageGenerationProvider,
  ImageGenerationParams,
  ImageGenerationResponse,
  ProviderConfig,
  ProviderRegistryEntry,
  FallbackChainConfig,
  ImageGenerationError,
  ImageGenerationErrorType,
} from './types';
import { ImageGenerationErrorType as ErrorType } from './types';
import { MistralImageProvider } from './providers/mistral-provider';
import { ReplicateImageProvider } from './providers/replicate-provider';

const DEFAULT_TIMEOUT = parseInt(process.env.IMAGE_GENERATION_TIMEOUT_MS || '120000', 10);

/**
 * Provider Registry
 * Manages registration, discovery, and fallback execution of image generation providers
 */
export class ImageProviderRegistry {
  private providers: Map<string, ProviderRegistryEntry> = new Map();
  private defaultChain: FallbackChainConfig = {
    providers: this.getDefaultProviderChain(),
    retryOnErrors: ['UNAVAILABLE', 'RATE_LIMITED', 'TIMEOUT'],
    maxRetries: 1,
    timeout: DEFAULT_TIMEOUT,
  };

  /**
   * Get default provider chain from environment
   */
  private getDefaultProviderChain(): string[] {
    const envChain = process.env.IMAGE_GENERATION_PROVIDERS;
    if (envChain) {
      return envChain.split(',').map(p => p.trim()).filter(Boolean);
    }
    return ['mistral', 'replicate'];
  }

  /**
   * Register a provider
   */
  register(
    provider: ImageGenerationProvider,
    priority: number = 10,
    enabled: boolean = true
  ): void {
    this.providers.set(provider.id, {
      provider,
      priority,
      enabled,
      available: false,
    });
  }

  /**
   * Get a provider by ID
   */
  getProvider(id: string): ImageGenerationProvider | undefined {
    return this.providers.get(id)?.provider;
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): ImageGenerationProvider[] {
    return Array.from(this.providers.values())
      .filter((entry) => entry.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map((entry) => entry.provider);
  }

  /**
   * Get available providers (runtime check)
   */
  async getAvailableProviders(): Promise<ImageGenerationProvider[]> {
    const available: ImageGenerationProvider[] = [];
    
    for (const [id, entry] of this.providers) {
      if (!entry.enabled) continue;
      
      try {
        const isAvailable = await entry.provider.isAvailable();
        entry.available = isAvailable;
        if (isAvailable) {
          available.push(entry.provider);
        }
      } catch {
        entry.available = false;
      }
    }
    
    return available.sort(
      (a, b) => 
        (this.providers.get(a.id)?.priority || 10) - 
        (this.providers.get(b.id)?.priority || 10)
    );
  }

  /**
   * Initialize all providers with configuration
   */
  initializeAll(configs: Record<string, ProviderConfig>): void {
    for (const [providerId, config] of Object.entries(configs)) {
      const provider = this.getProvider(providerId);
      if (provider) {
        provider.initialize(config);
      }
    }
  }

  /**
   * Generate image with fallback chain
   * Tries providers in order until one succeeds
   */
  async generateWithFallback(
    params: ImageGenerationParams,
    chainConfig?: Partial<FallbackChainConfig>,
    signal?: AbortSignal
  ): Promise<ImageGenerationResponse> {
    const config: FallbackChainConfig = { 
      ...this.defaultChain, 
      ...chainConfig,
      timeout: chainConfig?.timeout || this.defaultChain.timeout 
    };
    const errors: Array<{ provider: string; error: Error }> = [];
    const fallbackChain: string[] = [];

    const providerOrder = config.providers.filter((id) => this.providers.has(id));
    
    if (providerOrder.length === 0) {
      throw this.createError(
        'No image generation providers configured',
        ErrorType.NOT_CONFIGURED
      );
    }

    for (const providerId of providerOrder) {
      const entry = this.providers.get(providerId);
      if (!entry || !entry.enabled) continue;

      fallbackChain.push(providerId);
      let retries = 0;

      while (retries <= (config.maxRetries || 0)) {
        try {
          const timeoutController = new AbortController();
          const timeoutId = setTimeout(() => {
            timeoutController.abort();
          }, config.timeout || DEFAULT_TIMEOUT);

          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              timeoutController.abort();
            });
          }

          console.log(`[ImageProvider] Attempting generation with ${providerId} (attempt ${retries + 1})`);
          
          const result = await entry.provider.generate(params, timeoutController.signal);
          clearTimeout(timeoutId);

          result.fallbackChain = fallbackChain;
          return result;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push({ provider: providerId, error: err });

          const shouldRetry = this.shouldRetry(err, config);

          if (!shouldRetry) {
            // ✅ FIX 4: Add small delay before trying next provider in fallback chain
            if (fallbackChain.length > 1) {
              await this.delay(500);
            }
            console.log(`[ImageProvider] ${providerId} failed, moving to next provider`);
            break;
          }

          retries++;
          if (retries > (config.maxRetries || 0)) {
            console.log(`[ImageProvider] ${providerId} exhausted retries`);
            break;
          }

          await this.delay(Math.min(1000 * Math.pow(2, retries), 5000));
        }
      }
    }

    const lastError = errors[errors.length - 1];
    throw this.createError(
      `All providers failed. Errors: ${errors.map((e) => `${e.provider}: ${e.error.message}`).join('; ')}`,
      ErrorType.GENERATION_FAILED,
      lastError?.error,
      fallbackChain
    );
  }

  /**
   * Generate using a specific provider (no fallback)
   */
  async generateWithProvider(
    providerId: string,
    params: ImageGenerationParams,
    signal?: AbortSignal
  ): Promise<ImageGenerationResponse> {
    const entry = this.providers.get(providerId);
    
    if (!entry) {
      throw this.createError(
        `Provider "${providerId}" not found`,
        ErrorType.NOT_CONFIGURED
      );
    }

    if (!entry.enabled) {
      throw this.createError(
        `Provider "${providerId}" is disabled`,
        ErrorType.NOT_CONFIGURED
      );
    }

    return await entry.provider.generate(params, signal);
  }

  /**
   * Set the default fallback chain
   */
  setDefaultChain(chain: FallbackChainConfig): void {
    this.defaultChain = chain;
  }

  /**
   * Enable/disable a provider
   */
  setProviderEnabled(providerId: string, enabled: boolean): void {
    const entry = this.providers.get(providerId);
    if (entry) {
      entry.enabled = enabled;
    }
  }

  /**
   * Check if a provider should be retried based on error type
   */
  private shouldRetry(error: Error, config: FallbackChainConfig): boolean {
    const errorTypes = config.retryOnErrors || ['UNAVAILABLE', 'RATE_LIMITED', 'TIMEOUT'];
    
    // Check if error message contains retry-worthy indicators
    const errorMessage = error.message.toLowerCase();
    
    if (errorTypes.includes('TIMEOUT') && (errorMessage.includes('timeout') || errorMessage.includes('timed out'))) {
      return true;
    }
    
    if (errorTypes.includes('RATE_LIMITED') && (errorMessage.includes('rate limit') || errorMessage.includes('429'))) {
      return true;
    }
    
    if (errorTypes.includes('UNAVAILABLE') && (errorMessage.includes('unavailable') || errorMessage.includes('503'))) {
      return true;
    }

    return false;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a standardized error
   */
  private createError(
    message: string,
    type: ImageGenerationErrorType,
    originalError?: Error,
    fallbackChain?: string[]
  ): ImageGenerationError {
    const error = new Error(message) as ImageGenerationError;
    error.name = 'ImageGenerationError';
    (error as any).type = type;
    (error as any).provider = 'registry';
    (error as any).originalError = originalError;
    (error as any).fallbackChain = fallbackChain;
    return error;
  }
}

/**
 * Create and configure the default registry with built-in providers
 */
export function createDefaultRegistry(): ImageProviderRegistry {
  const registry = new ImageProviderRegistry();

  // Register built-in providers
  registry.register(new MistralImageProvider(), 1, true); // Priority 1 (highest)
  registry.register(new ReplicateImageProvider(), 2, true); // Priority 2

  return registry;
}

/**
 * Singleton registry instance
 */
let defaultRegistry: ImageProviderRegistry | null = null;

export function getDefaultRegistry(): ImageProviderRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createDefaultRegistry();
  }
  return defaultRegistry;
}
