/**
 * LLM Provider Router with Dynamic Latency Tracking
 * 
 * Routes LLM requests to optimal provider based on:
 * - Real-time latency metrics
 * - Provider availability
 * - Cost optimization
 * - Model capabilities
 * 
 * Features:
 * - Tracks p50, p95, p99 latency per provider
 * - Automatic failover on high latency
 * - Cost-aware routing
 * - Model-based routing
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('LLM:ProviderRouter');

/**
 * LLM Provider type
 */
export type LLMProviderType =
  | 'openai'
  | 'openrouter'
  | 'anthropic'
  | 'google'
  | 'mistral'
  | 'cohere'
  | 'together'
  | 'chutes'
  | 'groq'
  | 'deepseek';

/**
 * Latency metrics for a provider
 */
interface ProviderLatencyMetrics {
  provider: LLMProviderType;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  sampleCount: number;
  successRate: number;
  lastUpdated: number;
  recentLatencies: number[];
  recentSuccesses: boolean[];
}

/**
 * Provider selection result
 */
export interface ProviderSelectionResult {
  provider: LLMProviderType;
  model: string;
  reason: string;
  estimatedLatencyMs: number;
  costPer1kTokens: number;
}

/**
 * Dynamic latency tracker for LLM providers
 */
class LLMProviderLatencyTracker {
  private metrics = new Map<LLMProviderType, ProviderLatencyMetrics>();
  private readonly MAX_SAMPLES = 100;
  private readonly STALE_THRESHOLD_MS = 300000; // 5 minutes

  constructor() {
    const providers: LLMProviderType[] = [
      'openai', 'openrouter', 'anthropic', 'google', 'mistral',
      'cohere', 'together', 'chutes', 'groq', 'deepseek'
    ];

    for (const provider of providers) {
      this.metrics.set(provider, {
        provider,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        sampleCount: 0,
        successRate: 1,
        lastUpdated: Date.now(),
        recentLatencies: [],
        recentSuccesses: [],
      });
    }
  }

  /**
   * Record request latency and success
   */
  record(
    provider: LLMProviderType,
    latencyMs: number,
    success: boolean
  ): void {
    const metric = this.metrics.get(provider);
    if (!metric) return;

    // Add to rolling windows
    metric.recentLatencies.push(latencyMs);
    metric.recentSuccesses.push(success);

    if (metric.recentLatencies.length > this.MAX_SAMPLES) {
      metric.recentLatencies.shift();
      metric.recentSuccesses.shift();
    }

    // Update statistics
    metric.sampleCount++;
    metric.lastUpdated = Date.now();
    metric.avgLatencyMs = this.calculateAverage(metric.recentLatencies);
    metric.p50LatencyMs = this.calculatePercentile(metric.recentLatencies, 50);
    metric.p95LatencyMs = this.calculatePercentile(metric.recentLatencies, 95);
    metric.p99LatencyMs = this.calculatePercentile(metric.recentLatencies, 99);
    metric.successRate = this.calculateSuccessRate(metric.recentSuccesses);

    logger.debug(`Provider ${provider} latency: ${latencyMs}ms, success: ${success}`, {
      avg: metric.avgLatencyMs.toFixed(0),
      p95: metric.p95LatencyMs.toFixed(0),
      successRate: (metric.successRate * 100).toFixed(1) + '%',
    });
  }

  /**
   * Get current metrics for provider
   */
  getMetrics(provider: LLMProviderType): ProviderLatencyMetrics | null {
    return this.metrics.get(provider) || null;
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): IterableIterator<ProviderLatencyMetrics> {
    return this.metrics.values();
  }

  /**
   * Get all providers sorted by latency (fastest first)
   */
  getProvidersByLatency(): LLMProviderType[] {
    return Array.from(this.metrics.values())
      .filter(m => m.sampleCount > 0 && Date.now() - m.lastUpdated < this.STALE_THRESHOLD_MS)
      .sort((a, b) => {
        // Sort by weighted score: 70% latency, 30% success rate
        const scoreA = a.avgLatencyMs * 0.7 + (1 - a.successRate) * 1000;
        const scoreB = b.avgLatencyMs * 0.7 + (1 - b.successRate) * 1000;
        return scoreA - scoreB;
      })
      .map(m => m.provider);
  }

  /**
   * Get fastest available provider
   */
  getFastestProvider(minSuccessRate: number = 0.9): LLMProviderType | null {
    const providers = this.getProvidersByLatency();
    for (const provider of providers) {
      const metric = this.metrics.get(provider);
      if (metric && metric.successRate >= minSuccessRate) {
        return provider;
      }
    }
    return null;
  }

  /**
   * Check if provider latency is acceptable
   */
  isLatencyAcceptable(
    provider: LLMProviderType,
    thresholdMs: number = 3000
  ): boolean {
    const metric = this.metrics.get(provider);
    if (!metric || metric.sampleCount === 0) return true;
    return metric.p95LatencyMs < thresholdMs;
  }

  /**
   * Get latency tier
   */
  getLatencyTier(provider: LLMProviderType): 'low' | 'medium' | 'high' {
    const metric = this.metrics.get(provider);
    if (!metric || metric.sampleCount === 0) return 'medium';

    if (metric.p95LatencyMs < 1000) return 'low';      // < 1s
    if (metric.p95LatencyMs < 3000) return 'medium';   // 1-3s
    return 'high';                                      // > 3s
  }

  /**
   * Get estimated cost per 1k tokens
   */
  getEstimatedCost(provider: LLMProviderType): number {
    const costs: Record<LLMProviderType, number> = {
      'openai': 0.03,      // GPT-4o mini
      'openrouter': 0.001, // Free tier models
      'anthropic': 0.015,  // Claude Haiku
      'google': 0.00075,   // Gemini Flash
      'mistral': 0.00015,  // Mistral Small
      'cohere': 0.001,
      'together': 0.0002,
      'chutes': 0.0001,
      'groq': 0.00005,
      'deepseek': 0.00014,
    };
    return costs[provider] || 0.001;
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private calculateSuccessRate(values: boolean[]): number {
    if (values.length === 0) return 1;
    const successes = values.filter(v => v).length;
    return successes / values.length;
  }
}

/**
 * LLM Provider Router
 */
export class LLMProviderRouter {
  private latencyTracker: LLMProviderLatencyTracker;

  constructor() {
    this.latencyTracker = new LLMProviderLatencyTracker();
  }

  /**
   * Select optimal provider based on latency and requirements
   */
  selectOptimalProvider(options: {
    model?: string;
    requireStreaming?: boolean;
    costSensitivity?: 'low' | 'medium' | 'high';
    latencySensitivity?: 'low' | 'medium' | 'high';
    excludedProviders?: LLMProviderType[];
  }): ProviderSelectionResult {
    const {
      model,
      requireStreaming = true,
      costSensitivity = 'medium',
      latencySensitivity = 'medium',
      excludedProviders = [],
    } = options;

    // Get all providers sorted by latency
    const rankedProviders = this.latencyTracker.getProvidersByLatency();

    // Filter out excluded providers
    const availableProviders = rankedProviders.filter(
      p => !excludedProviders.includes(p)
    );

    if (availableProviders.length === 0) {
      // Fallback to openrouter if no providers available
      return {
        provider: 'openrouter',
        model: model || 'deepseek/deepseek-r1-0528:free',
        reason: 'No providers available, using fallback',
        estimatedLatencyMs: 2000,
        costPer1kTokens: 0.001,
      };
    }

    // Score providers
    const scores = availableProviders.map(provider => {
      const metric = this.latencyTracker.getMetrics(provider);
      const cost = this.latencyTracker.getEstimatedCost(provider);

      let score = 100;
      const reasons: string[] = [];

      // Latency scoring (0-40 points)
      if (metric && metric.sampleCount > 0) {
        if (metric.p95LatencyMs < 500) {
          score += 40;
          reasons.push(`Excellent latency (${metric.p95LatencyMs.toFixed(0)}ms p95)`);
        } else if (metric.p95LatencyMs < 1500) {
          score += 25;
          reasons.push(`Good latency (${metric.p95LatencyMs.toFixed(0)}ms p95)`);
        } else if (metric.p95LatencyMs < 3000) {
          score += 10;
          reasons.push(`Moderate latency (${metric.p95LatencyMs.toFixed(0)}ms p95)`);
        } else {
          score -= 20;
          reasons.push(`High latency (${metric.p95LatencyMs.toFixed(0)}ms p95)`);
        }
      }

      // Success rate scoring (0-30 points)
      if (metric && metric.sampleCount > 0) {
        if (metric.successRate >= 0.99) {
          score += 30;
        } else if (metric.successRate >= 0.95) {
          score += 20;
        } else if (metric.successRate >= 0.90) {
          score += 10;
        } else {
          score -= 30;
          reasons.push(`Low success rate (${(metric.successRate * 100).toFixed(1)}%)`);
        }
      }

      // Cost scoring (0-20 points)
      if (costSensitivity === 'high') {
        if (cost < 0.0005) {
          score += 20;
          reasons.push(`Very low cost ($${cost.toFixed(4)}/1k tokens)`);
        } else if (cost < 0.002) {
          score += 10;
        } else if (cost > 0.01) {
          score -= 15;
          reasons.push(`High cost ($${cost.toFixed(4)}/1k tokens)`);
        }
      }

      // Latency sensitivity adjustment
      if (latencySensitivity === 'high' && metric) {
        if (metric.p95LatencyMs < 1000) {
          score += 10;
        } else if (metric.p95LatencyMs > 3000) {
          score -= 20;
        }
      }

      // Model compatibility bonus
      if (model && this.isModelAvailable(provider, model)) {
        score += 5;
        reasons.push(`Supports requested model`);
      }

      return {
        provider,
        score,
        reasons,
        metric,
        cost,
      };
    });

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    const winner = scores[0];
    const metric = winner.metric;

    return {
      provider: winner.provider,
      model: model || this.getDefaultModel(winner.provider),
      reason: winner.reasons.join('; ') || 'Best overall score',
      estimatedLatencyMs: metric?.p95LatencyMs || 2000,
      costPer1kTokens: winner.cost,
    };
  }

  /**
   * Record request result for latency tracking
   */
  recordRequest(
    provider: LLMProviderType,
    latencyMs: number,
    success: boolean
  ): void {
    this.latencyTracker.record(provider, latencyMs, success);
  }

  /**
   * Get provider metrics
   */
  getProviderMetrics(provider: LLMProviderType): ProviderLatencyMetrics | null {
    return this.latencyTracker.getMetrics(provider);
  }

  /**
   * Get all provider metrics
   */
  getAllProviderMetrics(): ProviderLatencyMetrics[] {
    return Array.from(this.latencyTracker.getAllMetrics());
  }

  /**
   * Get fastest provider
   */
  getFastestProvider(minSuccessRate: number = 0.9): LLMProviderType | null {
    return this.latencyTracker.getFastestProvider(minSuccessRate);
  }

  private isModelAvailable(provider: LLMProviderType, model: string): boolean {
    // Simple check - in production, query actual model availability
    const modelLower = model.toLowerCase();
    
    if (provider === 'openai' && modelLower.includes('gpt')) return true;
    if (provider === 'anthropic' && modelLower.includes('claude')) return true;
    if (provider === 'google' && modelLower.includes('gemini')) return true;
    if (provider === 'mistral' && modelLower.includes('mistral')) return true;
    if (provider === 'openrouter') return true; // OpenRouter has many models
    if (provider === 'deepseek' && modelLower.includes('deepseek')) return true;
    
    return false;
  }

  private getDefaultModel(provider: LLMProviderType): string {
    const defaults: Record<LLMProviderType, string> = {
      'openai': 'gpt-4o-mini',
      'openrouter': 'deepseek/deepseek-r1-0528:free',
      'anthropic': 'claude-3-haiku-20240307',
      'google': 'gemini-2.0-flash',
      'mistral': 'mistral-small-2402',
      'cohere': 'command-r-plus',
      'together': 'meta-llama/Llama-3-8b-chat-hf',
      'chutes': 'meta-llama/Llama-3-8b-chat-hf',
      'groq': 'llama3-8b-8192',
      'deepseek': 'deepseek-chat',
    };
    return defaults[provider] || 'gpt-4o-mini';
  }
}

// Singleton instance
export const llmProviderRouter = new LLMProviderRouter();
