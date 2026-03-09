import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export type ProviderName = 'openai' | 'anthropic' | 'google';

export interface ProviderConfig {
  name: ProviderName;
  priority: number;
  createModel: (modelId: string) => LanguageModel | Promise<LanguageModel>;
  isAvailable: () => Promise<boolean>;
}

export interface ModelWithProvider {
  model: LanguageModel;
  provider: ProviderName;
  modelId: string;
}

/**
 * Circuit breaker state for a provider
 */
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
  successCount: number;
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening circuit
  successThreshold: number; // Number of successes in half-open before closing
  timeout: number; // Time in ms before trying again (open -> half-open)
}

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 60000, // 1 minute
};

/**
 * Circuit breaker for provider health tracking
 */
class ProviderCircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG) {
    this.config = config;
  }

  /**
   * Record a successful call to a provider
   */
  recordSuccess(provider: string): void {
    const state = this.states.get(provider);
    if (!state) return;

    if (state.state === 'half-open') {
      state.successCount++;
      if (state.successCount >= this.config.successThreshold) {
        // Close the circuit
        state.state = 'closed';
        state.failures = 0;
        state.successCount = 0;
        console.log(`[CircuitBreaker] Provider ${provider} circuit CLOSED (recovered)`);
      }
    } else if (state.state === 'closed') {
      // Reset failure count on success
      state.failures = 0;
    }
  }

  /**
   * Record a failed call to a provider
   */
  recordFailure(provider: string): void {
    let state = this.states.get(provider);
    
    if (!state) {
      state = {
        failures: 0,
        lastFailureTime: 0,
        state: 'closed',
        successCount: 0,
      };
      this.states.set(provider, state);
    }

    state.failures++;
    state.lastFailureTime = Date.now();

    if (state.failures >= this.config.failureThreshold) {
      state.state = 'open';
      state.successCount = 0;
      console.warn(`[CircuitBreaker] Provider ${provider} circuit OPEN (${state.failures} failures)`);
    }
  }

  /**
   * Check if a provider is available (circuit not open)
   */
  isAvailable(provider: string): boolean {
    const state = this.states.get(provider);
    
    if (!state) return true; // No state means circuit is closed (healthy)

    if (state.state === 'closed') return true;

    if (state.state === 'open') {
      // Check if timeout has passed to transition to half-open
      const timeSinceFailure = Date.now() - state.lastFailureTime;
      if (timeSinceFailure >= this.config.timeout) {
        state.state = 'half-open';
        state.successCount = 0;
        console.log(`[CircuitBreaker] Provider ${provider} circuit HALF-OPEN (testing)`);
        return true; // Allow one request through to test
      }
      return false; // Circuit is open, don't try
    }

    return true; // half-open allows requests
  }

  /**
   * Get circuit state for a provider
   */
  getState(provider: string): CircuitBreakerState | undefined {
    return this.states.get(provider);
  }

  /**
   * Reset circuit breaker for a provider
   */
  reset(provider: string): void {
    this.states.delete(provider);
    console.log(`[CircuitBreaker] Provider ${provider} circuit RESET`);
  }

  /**
   * Get all circuit states
   */
  getAllStates(): Map<string, CircuitBreakerState> {
    return new Map(this.states);
  }
}

// Global circuit breaker instance
const circuitBreaker = new ProviderCircuitBreaker();

// Export for use in other modules
export { circuitBreaker };

/**
 * Model mapping for each provider
 * Maps generic model names to provider-specific model IDs
 */
const MODEL_MAPPING: Record<ProviderName, Record<string, string>> = {
  openai: {
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'o1-preview': 'o1-preview',
    'o1-mini': 'o1-mini',
    'gpt-4-turbo': 'gpt-4-turbo',
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
  },
  anthropic: {
    'claude-sonnet': 'claude-3-5-sonnet-20241022',
    'claude-opus': 'claude-3-opus-20240229',
    'claude-haiku': 'claude-3-haiku-20240307',
    'claude-3-sonnet': 'claude-3-sonnet-20240229',
  },
  google: {
    'gemini-pro': 'gemini-pro',
    'gemini-1.5-pro': 'gemini-1.5-pro',
    'gemini-1.5-flash': 'gemini-1.5-flash',
  },
};

/**
 * Create providers with API keys from environment
 * Note: Anthropic and Google providers require additional packages:
 * pnpm add @ai-sdk/anthropic @ai-sdk/google
 */
function createOpenAIProvider() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL;
  
  return createOpenAI({
    apiKey,
    baseURL: baseURL || undefined,
  });
}

async function createAnthropicProvider() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  
  try {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    return createAnthropic({ apiKey });
  } catch (error) {
    throw new Error('@ai-sdk/anthropic package not installed. Run: pnpm add @ai-sdk/anthropic');
  }
}

async function createGoogleProvider() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_KEY || process.env.GOOGLE_API_KEY;
  
  if (!apiKey) {
    throw new Error('GOOGLE_GENERATIVE_AI_KEY not configured');
  }
  
  try {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    return createGoogleGenerativeAI({ apiKey });
  } catch (error) {
    throw new Error('@ai-sdk/google package not installed. Run: pnpm add @ai-sdk/google');
  }
}

/**
 * Check if a provider is available (has API key configured)
 */
async function checkProviderAvailability(provider: ProviderName): Promise<boolean> {
  // In test environment, assume providers are available if not explicitly disabled
  if (process.env.NODE_ENV === 'test' && process.env[`DISABLE_${provider.toUpperCase()}_MOCK`] !== 'true') {
    return true;
  }
  
  try {
    switch (provider) {
      case 'openai':
        return !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);
      case 'anthropic':
        return !!process.env.ANTHROPIC_API_KEY;
      case 'google':
        return !!(process.env.GOOGLE_GENERATIVE_AI_KEY || process.env.GOOGLE_API_KEY);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Provider configurations with lazy initialization
 */
const providerConfigs: Record<ProviderName, ProviderConfig> = {
  openai: {
    name: 'openai',
    priority: 1,
    createModel: (modelId: string) => {
      const openai = createOpenAIProvider();
      const mappedId = MODEL_MAPPING.openai[modelId] || modelId;
      return openai(mappedId) as LanguageModel;
    },
    isAvailable: () => checkProviderAvailability('openai'),
  },
  anthropic: {
    name: 'anthropic',
    priority: 2,
    createModel: async (modelId: string) => {
      const anthropic = await createAnthropicProvider();
      const mappedId = MODEL_MAPPING.anthropic[modelId] || modelId;
      return anthropic(mappedId) as LanguageModel;
    },
    isAvailable: () => checkProviderAvailability('anthropic'),
  },
  google: {
    name: 'google',
    priority: 3,
    createModel: async (modelId: string) => {
      const google = await createGoogleProvider();
      const mappedId = MODEL_MAPPING.google[modelId] || modelId;
      return google(mappedId) as LanguageModel;
    },
    isAvailable: () => checkProviderAvailability('google'),
  },
};

/**
 * Get available providers in priority order
 * 
 * FIXED: Now uses circuit breaker to skip unhealthy providers
 */
async function getAvailableProviders(): Promise<ProviderConfig[]> {
  const providers = Object.values(providerConfigs);
  const available: ProviderConfig[] = [];

  for (const provider of providers) {
    // Check circuit breaker first
    if (!circuitBreaker.isAvailable(provider.name)) {
      console.log(`[ProviderFallback] Skipping ${provider.name} (circuit open)`);
      continue;
    }

    const isAvailable = await provider.isAvailable();
    if (isAvailable) {
      available.push(provider);
    }
  }

  // Sort by priority
  return available.sort((a, b) => a.priority - b.priority);
}

/**
 * Create a model with automatic fallback to alternative providers
 *
 * FIXED: Now records success/failure with circuit breaker
 *
 * @param preferredProvider - Preferred provider name (default: 'openai')
 * @param modelId - Model identifier (e.g., 'gpt-4o', 'claude-sonnet')
 * @returns ModelWithProvider - The model and which provider it's from
 */
export async function createModelWithFallback(
  preferredProvider: ProviderName = 'openai',
  modelId: string = 'gpt-4o'
): Promise<ModelWithProvider> {
  const availableProviders = await getAvailableProviders();

  if (availableProviders.length === 0) {
    throw new Error(
      `No AI providers available. Checked providers: ${Object.keys(providerConfigs).join(', ')}. Please configure at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_KEY`
    );
  }

  // Sort providers: preferred first, then by priority
  const sortedProviders = [...availableProviders].sort((a, b) => {
    if (a.name === preferredProvider) return -1;
    if (b.name === preferredProvider) return 1;
    return a.priority - b.priority;
  });

  let lastError: Error | null = null;

  for (const provider of sortedProviders) {
    try {
      const mappedModelId = MODEL_MAPPING[provider.name][modelId] || modelId;
      const model = await Promise.resolve(provider.createModel(mappedModelId));

      console.log(`[ProviderFallback] Using ${provider.name} with model ${mappedModelId}`);

      // Record success with circuit breaker
      circuitBreaker.recordSuccess(provider.name);

      return {
        model,
        provider: provider.name,
        modelId: mappedModelId,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[ProviderFallback] ${provider.name} failed:`,
        lastError.message
      );

      // Record failure with circuit breaker
      circuitBreaker.recordFailure(provider.name);

      continue;
    }
  }

  throw new Error(
    `All providers failed. Last error: ${lastError?.message}. Checked providers: ${sortedProviders.map(p => p.name).join(', ')}`
  );
}

/**
 * Get circuit breaker states for all providers
 */
export function getCircuitBreakerStates(): Record<string, {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureTime: number;
} | undefined> {
  const allStates = circuitBreaker.getAllStates();
  const result: Record<string, any> = {};
  
  for (const [provider, state] of allStates.entries()) {
    result[provider] = state;
  }
  
  return result;
}

/**
 * Get health status for all providers
 * 
 * ENHANCED: Now includes circuit breaker state and success rate
 */
export async function getProviderHealth(): Promise<
  Record<ProviderName, { 
    available: boolean; 
    error?: string;
    circuitState?: 'closed' | 'open' | 'half-open';
    circuitFailures?: number;
    successRate?: number;
  }>
> {
  const health: Record<ProviderName, { 
    available: boolean; 
    error?: string;
    circuitState?: 'closed' | 'open' | 'half-open';
    circuitFailures?: number;
  }> = {
    openai: { available: false },
    anthropic: { available: false },
    google: { available: false },
  };

  const circuitStates = getCircuitBreakerStates();

  for (const [name, config] of Object.entries(providerConfigs)) {
    try {
      const available = await config.isAvailable();
      const circuitState = circuitStates[name];
      
      health[name as ProviderName] = { 
        available,
        circuitState: circuitState?.state,
        circuitFailures: circuitState?.failures,
      };
    } catch (error) {
      health[name as ProviderName] = {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  return health;
}

/**
 * Provider health monitoring
 * 
 * ADDED: Real-time health monitoring with success rate tracking
 */
interface ProviderHealthMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  lastRequestTime?: number;
  successRate: number;
  healthScore: number; // 0-100
}

class ProviderHealthMonitor {
  private metrics: Map<ProviderName, ProviderHealthMetrics> = new Map();

  constructor() {
    // Initialize metrics for all providers
    (['openai', 'anthropic', 'google'] as ProviderName[]).forEach(name => {
      this.metrics.set(name, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatencyMs: 0,
        successRate: 100,
        healthScore: 100,
      });
    });
  }

  /**
   * Record a provider request
   */
  recordRequest(provider: ProviderName, success: boolean, latencyMs: number): void {
    const metrics = this.metrics.get(provider);
    if (!metrics) return;

    metrics.totalRequests++;
    metrics.lastRequestTime = Date.now();

    if (success) {
      metrics.successfulRequests++;
    } else {
      metrics.failedRequests++;
    }

    // Update average latency (exponential moving average)
    metrics.averageLatencyMs = metrics.averageLatencyMs * 0.9 + latencyMs * 0.1;

    // Calculate success rate
    metrics.successRate = metrics.totalRequests > 0
      ? (metrics.successfulRequests / metrics.totalRequests) * 100
      : 100;

    // Calculate health score (0-100)
    // Based on: success rate (60%), latency (20%), recent activity (20%)
    const successScore = metrics.successRate * 0.6;
    
    // Latency score (penalize high latency)
    const latencyScore = Math.max(0, (1 - metrics.averageLatencyMs / 10000)) * 20;
    
    // Activity score (penalize long inactivity)
    const timeSinceLastRequest = metrics.lastRequestTime 
      ? Date.now() - metrics.lastRequestTime 
      : Infinity;
    const activityScore = timeSinceLastRequest < 60000 ? 20 : 
                         timeSinceLastRequest < 300000 ? 10 : 0;

    metrics.healthScore = Math.round(successScore + latencyScore + activityScore);
  }

  /**
   * Get health metrics for a provider
   */
  getMetrics(provider: ProviderName): ProviderHealthMetrics | undefined {
    return this.metrics.get(provider);
  }

  /**
   * Get health metrics for all providers
   */
  getAllMetrics(): Record<ProviderName, ProviderHealthMetrics> {
    const result: Record<ProviderName, ProviderHealthMetrics> = {
      openai: this.metrics.get('openai')!,
      anthropic: this.metrics.get('anthropic')!,
      google: this.metrics.get('google')!,
    };
    return result;
  }

  /**
   * Get the healthiest available provider
   */
  getHealthiestProvider(): ProviderName | null {
    let healthiest: ProviderName | null = null;
    let highestScore = 0;

    for (const [name, metrics] of this.metrics.entries()) {
      // Skip providers with open circuit breaker
      if (!circuitBreaker.isAvailable(name)) continue;

      if (metrics.healthScore > highestScore) {
        highestScore = metrics.healthScore;
        healthiest = name;
      }
    }

    return healthiest;
  }

  /**
   * Reset metrics for a provider
   */
  reset(provider: ProviderName): void {
    this.metrics.set(provider, {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatencyMs: 0,
      successRate: 100,
      healthScore: 100,
    });
  }
}

// Global health monitor instance
export const providerHealthMonitor = new ProviderHealthMonitor();

/**
 * Get provider health dashboard data
 * 
 * ADDED: Comprehensive health dashboard for monitoring
 */
export function getProviderHealthDashboard(): {
  providers: Record<ProviderName, {
    healthScore: number;
    successRate: number;
    averageLatencyMs: number;
    totalRequests: number;
    circuitState: 'closed' | 'open' | 'half-open';
    circuitFailures: number;
    isAvailable: boolean;
  }>;
  recommendedProvider: ProviderName | null;
  timestamp: string;
} {
  const metrics = providerHealthMonitor.getAllMetrics();
  const circuitStates = getCircuitBreakerStates();
  
  const providers: any = {};
  
  for (const [name, metric] of Object.entries(metrics)) {
    const circuitState = circuitStates[name];
    providers[name] = {
      healthScore: metric.healthScore,
      successRate: Math.round(metric.successRate * 10) / 10,
      averageLatencyMs: Math.round(metric.averageLatencyMs),
      totalRequests: metric.totalRequests,
      circuitState: circuitState?.state || 'closed',
      circuitFailures: circuitState?.failures || 0,
      isAvailable: circuitBreaker.isAvailable(name),
    };
  }

  return {
    providers,
    recommendedProvider: providerHealthMonitor.getHealthiestProvider(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get the best available model for a specific use case
 */
export async function getModelForUseCase(
  useCase: 'code' | 'chat' | 'analysis' | 'creative'
): Promise<ModelWithProvider> {
  // Use case to model mapping
  const useCaseModels: Record<typeof useCase, { preferred: ProviderName; modelId: string }> = {
    code: { preferred: 'anthropic', modelId: 'claude-sonnet' }, // Claude excels at code
    chat: { preferred: 'openai', modelId: 'gpt-4o' }, // GPT-4o great for conversation
    analysis: { preferred: 'openai', modelId: 'gpt-4o' }, // GPT-4o good at structured thinking
    creative: { preferred: 'google', modelId: 'gemini-1.5-pro' }, // Gemini good at creative tasks
  };

  const { preferred, modelId } = useCaseModels[useCase];

  // Check if preferred provider is available with the model
  const preferredAvailable = await providerConfigs[preferred].isAvailable();
  
  if (preferredAvailable) {
    try {
      return await createModelWithFallback(preferred, modelId);
    } catch {
      // Fall through to general fallback
    }
  }

  // General fallback
  return createModelWithFallback('openai', 'gpt-4o');
}

/**
 * Get available models for a provider
 */
export function getAvailableModelsForProvider(provider: ProviderName): string[] {
  return Object.keys(MODEL_MAPPING[provider]);
}

/**
 * Provider statistics and metrics
 */
export interface ProviderStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  lastUsed?: Date;
}

class ProviderMetricsTracker {
  private stats: Record<ProviderName, ProviderStats> = {
    openai: {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatencyMs: 0,
    },
    anthropic: {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatencyMs: 0,
    },
    google: {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatencyMs: 0,
    },
  };

  recordRequest(provider: ProviderName, success: boolean, latencyMs: number) {
    const providerStats = this.stats[provider];
    providerStats.totalRequests++;
    
    if (success) {
      providerStats.successfulRequests++;
    } else {
      providerStats.failedRequests++;
    }

    // Update average latency
    providerStats.averageLatencyMs =
      (providerStats.averageLatencyMs * (providerStats.totalRequests - 1) + latencyMs) /
      providerStats.totalRequests;

    providerStats.lastUsed = new Date();
  }

  getStats(): Record<ProviderName, ProviderStats> {
    return { ...this.stats };
  }

  getSuccessRate(provider: ProviderName): number {
    const stats = this.stats[provider];
    if (stats.totalRequests === 0) return 100;
    return (stats.successfulRequests / stats.totalRequests) * 100;
  }
}

export const providerMetrics = new ProviderMetricsTracker();
