/**
 * Token & Memory Caching for Vercel AI SDK
 *
 * Provides intelligent caching for:
 * - Token usage tracking per model/provider
 * - Response caching with automatic invalidation
 * - "Too many tokens" error prevention with cached breakdowns
 * - Memory-efficient LRU cache for conversation history
 *
 * @see https://sdk.vercel.ai/docs/ai-sdk-core/caching
 */

import { chatLogger } from './chat-logger';

/**
 * Token usage statistics per model
 */
export interface TokenUsageStats {
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  lastUsed: number;
  averageTokensPerRequest: number;
}

/**
 * Cached token breakdown for error prevention
 */
export interface CachedTokenBreakdown {
  hash: string;
  promptTokens: number;
  estimatedTokens: number;
  model: string;
  timestamp: number;
  expiresAt: number;
}

/**
 * LRU Cache implementation for memory-efficient caching
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  get entries(): Array<[K, V]> {
    return Array.from(this.cache.entries());
  }
}

/**
 * Token usage tracker - tracks token consumption per model/provider
 */
class TokenUsageTracker {
  private usageStats: Map<string, TokenUsageStats> = new Map();
  private tokenBreakdownCache: LRUCache<string, CachedTokenBreakdown>;
  private readonly MAX_CACHE_SIZE = 5000;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.tokenBreakdownCache = new LRUCache(this.MAX_CACHE_SIZE);
  }

  /**
   * Record token usage for a request
   */
  recordUsage(
    model: string,
    provider: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number
  ): void {
    const key = `${provider}:${model}`;
    const existing = this.usageStats.get(key);

    if (existing) {
      existing.promptTokens += promptTokens;
      existing.completionTokens += completionTokens;
      existing.totalTokens += totalTokens;
      existing.requestCount++;
      existing.lastUsed = Date.now();
      existing.averageTokensPerRequest = existing.totalTokens / existing.requestCount;
    } else {
      this.usageStats.set(key, {
        model,
        provider,
        promptTokens,
        completionTokens,
        totalTokens,
        requestCount: 1,
        lastUsed: Date.now(),
        averageTokensPerRequest: totalTokens,
      });
    }

    chatLogger.debug('Token usage recorded', {
      model,
      provider,
      totalTokens,
      requestCount: existing?.requestCount || 1,
    });
  }

  /**
   * Get usage statistics for a model
   */
  getUsage(provider: string, model: string): TokenUsageStats | undefined {
    return this.usageStats.get(`${provider}:${model}`);
  }

  /**
   * Get all usage statistics
   */
  getAllUsage(): TokenUsageStats[] {
    return Array.from(this.usageStats.values());
  }

  /**
   * Cache a token breakdown for error prevention
   */
  cacheTokenBreakdown(
    promptHash: string,
    promptTokens: number,
    estimatedTokens: number,
    model: string
  ): void {
    const now = Date.now();
    this.tokenBreakdownCache.set(promptHash, {
      hash: promptHash,
      promptTokens,
      estimatedTokens,
      model,
      timestamp: now,
      expiresAt: now + this.CACHE_TTL_MS,
    });
  }

  /**
   * Get cached token breakdown
   */
  getCachedBreakdown(promptHash: string): CachedTokenBreakdown | undefined {
    const cached = this.tokenBreakdownCache.get(promptHash);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
    // Remove expired entry
    if (cached) {
      this.tokenBreakdownCache.delete(promptHash);
    }
    return undefined;
  }

  /**
   * Estimate tokens for a prompt using cached data
   */
  estimateTokens(promptHash: string, fallbackEstimate: number): number {
    const cached = this.getCachedBreakdown(promptHash);
    if (cached) {
      return cached.estimatedTokens;
    }
    return fallbackEstimate;
  }

  /**
   * Check if request might exceed token limits
   */
  mightExceedLimit(
    provider: string,
    model: string,
    estimatedTokens: number,
    safetyMargin: number = 0.9
  ): { wouldExceed: boolean; recommendedAction?: string } {
    const limits: Record<string, number> = {
      // OpenAI models
      'openai:gpt-4': 128000,
      'openai:gpt-4o': 128000,
      'openai:gpt-4o-mini': 128000,
      'openai:gpt-3.5-turbo': 16385,
      // Anthropic models
      'anthropic:claude-3-5-sonnet-latest': 200000,
      'anthropic:claude-3-opus-latest': 200000,
      // Google models
      'google:gemini-2.5-pro': 2000000,
      'google:gemini-2.5-flash': 1000000,
      // Default fallback
      'default': 128000,
    };

    const key = `${provider}:${model}`;
    const limit = limits[key] || limits['default'];
    const threshold = limit * safetyMargin;

    if (estimatedTokens > threshold) {
      return {
        wouldExceed: true,
        recommendedAction: `Request estimated at ${estimatedTokens.toLocaleString()} tokens (limit: ${limit.toLocaleString()}). Consider splitting the request or using a model with higher context window.`,
      };
    }

    return { wouldExceed: false };
  }

  /**
   * Clear expired cache entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.tokenBreakdownCache.entries) {
      if (value.expiresAt < now) {
        this.tokenBreakdownCache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    cacheSize: number;
    cacheHits: number;
    cacheMisses: number;
    totalTrackedModels: number;
  } {
    return {
      cacheSize: this.tokenBreakdownCache.size,
      cacheHits: 0, // Would need to track separately
      cacheMisses: 0,
      totalTrackedModels: this.usageStats.size,
    };
  }
}

/**
 * Global token usage tracker instance
 */
export const tokenTracker = new TokenUsageTracker();

/**
 * In-memory cache storage (can be replaced with Redis in production)
 */
declare global {
  var __cache: Map<string, { value: any; expiresAt: number }> | undefined;
}

/**
 * Get or create in-memory cache storage
 */
function getCacheStorage(): Map<string, { value: any; expiresAt: number }> {
  if (!globalThis.__cache) {
    globalThis.__cache = new Map();
  }
  return globalThis.__cache;
}

/**
 * Set a value in cache with TTL
 */
export function setCache<T>(key: string, value: T, ttlMs: number = 60 * 60 * 1000): void {
  const cache = getCacheStorage();
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Get a value from cache
 */
export function getCache<T>(key: string): T | null {
  const cache = getCacheStorage();
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  
  return entry.value as T;
}

/**
 * Delete a value from cache
 */
export function deleteCache(key: string): boolean {
  const cache = getCacheStorage();
  return cache.delete(key);
}

/**
 * Clear all cache entries
 */
export function clearCache(): void {
  const cache = getCacheStorage();
  cache.clear();
}
