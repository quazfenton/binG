export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remaining?: number;
  limit?: number;
}

const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  github: { maxRequests: 100, windowMs: 60000 },    // 100/min (GitHub API limit is higher but be conservative)
  slack: { maxRequests: 50, windowMs: 60000 },      // 50/min
  notion: { maxRequests: 30, windowMs: 60000 },     // 30/min (Notion has 3 req/sec)
  default: { maxRequests: 60, windowMs: 60000 },    // 60/min default
};

export class NangoRateLimiter {
  private requestCounts: Map<
    string,
    { count: number; resetTime: number; timestamps: number[] }
  > = new Map();

  private configs: Record<string, RateLimitConfig>;

  constructor(customConfigs?: Record<string, RateLimitConfig>) {
    this.configs = { ...DEFAULT_RATE_LIMITS, ...customConfigs };
  }

  /**
   * Check if a request is allowed under rate limiting
   */
  async checkLimit(provider: string): Promise<RateLimitResult> {
    const config = this.configs[provider] || this.configs.default;
    const now = Date.now();
    const key = provider;

    const existing = this.requestCounts.get(key);

    // Initialize or reset if window expired
    if (!existing || now > existing.resetTime) {
      this.requestCounts.set(key, {
        count: 1,
        resetTime: now + config.windowMs,
        timestamps: [now],
      });
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        limit: config.maxRequests,
      };
    }

    // Clean old timestamps (sliding window)
    const windowStart = now - config.windowMs;
    existing.timestamps = existing.timestamps.filter(ts => ts > windowStart);
    existing.count = existing.timestamps.length;

    // Check if limit exceeded
    if (existing.count >= config.maxRequests) {
      const retryAfter = Math.ceil((existing.resetTime - now) / 1000);
      return {
        allowed: false,
        retryAfter,
        remaining: 0,
        limit: config.maxRequests,
      };
    }

    // Allow and increment
    existing.count++;
    existing.timestamps.push(now);
    
    return {
      allowed: true,
      remaining: config.maxRequests - existing.count,
      limit: config.maxRequests,
    };
  }

  /**
   * Record a request for rate limiting
   */
  recordRequest(provider: string): void {
    const key = provider;
    const existing = this.requestCounts.get(key);
    
    if (existing) {
      existing.count++;
      existing.timestamps.push(Date.now());
    }
  }

  /**
   * Get current rate limit status for a provider
   */
  getStatus(provider: string): {
    remaining: number;
    limit: number;
    resetIn: number;
    isLimited: boolean;
  } {
    const config = this.configs[provider] || this.configs.default;
    const existing = this.requestCounts.get(provider);
    const now = Date.now();

    if (!existing || now > existing.resetTime) {
      return {
        remaining: config.maxRequests,
        limit: config.maxRequests,
        resetIn: config.windowMs,
        isLimited: false,
      };
    }

    const windowStart = now - config.windowMs;
    const recentCount = existing.timestamps.filter(ts => ts > windowStart).length;
    const resetIn = existing.resetTime - now;

    return {
      remaining: Math.max(0, config.maxRequests - recentCount),
      limit: config.maxRequests,
      resetIn,
      isLimited: recentCount >= config.maxRequests,
    };
  }

  /**
   * Get rate limit status for all providers
   */
  getAllStatus(): Record<string, {
    remaining: number;
    limit: number;
    resetIn: number;
    isLimited: boolean;
  }> {
    const providers = new Set([
      ...Object.keys(this.configs),
      ...Array.from(this.requestCounts.keys()),
    ]);

    const status: Record<string, {
      remaining: number;
      limit: number;
      resetIn: number;
      isLimited: boolean;
    }> = {};

    for (const provider of providers) {
      status[provider] = this.getStatus(provider);
    }

    return status;
  }

  /**
   * Reset rate limits for a provider or all providers
   */
  reset(provider?: string): void {
    if (provider) {
      this.requestCounts.delete(provider);
    } else {
      this.requestCounts.clear();
    }
  }

  /**
   * Wait until rate limit allows
   */
  async waitUntilAllowed(provider: string, maxWaitMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.checkLimit(provider);
      if (result.allowed) {
        return true;
      }
      
      if (result.retryAfter) {
        const waitTime = Math.min(result.retryAfter * 1000 + 100, maxWaitMs - (Date.now() - startTime));
        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return false;
  }
}

export const nangoRateLimiter = new NangoRateLimiter();
