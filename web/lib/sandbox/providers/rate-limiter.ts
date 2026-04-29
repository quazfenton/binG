/**
 * Rate Limiter for Sandbox Providers
 * 
 * Provides rate limiting for sandbox operations to prevent abuse and manage
 * resource usage. Supports per-user, per-IP, and global rate limits.
 * 
 * Features:
 * - Sliding window rate limiting
 * - Per-user and per-IP limits
 * - Configurable limits per operation type
 * - Automatic cleanup of expired entries
 * - Promise-based API
 * 
 * @example
 * ```typescript
 * const rateLimiter = new SandboxRateLimiter({
 *   commands: { max: 100, windowMs: 60000 }, // 100 per minute
 *   fileOps: { max: 50, windowMs: 60000 },   // 50 per minute
 *   batchJobs: { max: 10, windowMs: 60000 }, // 10 per minute
 * })
 * 
 * // Check rate limit before operation
 * await rateLimiter.check('user-123', 'commands')
 * 
 * // Record operation
 * await rateLimiter.record('user-123', 'commands')
 * ```
 */

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  max: number
  /** Time window in milliseconds */
  windowMs: number
  /** Message to return when rate limit exceeded */
  message?: string
  /** Status code to return (default: 429) */
  statusCode?: number
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in current window */
  remaining: number
  /** Time until window resets (ms) */
  resetIn: number
  /** Retry-After header value (seconds) */
  retryAfter?: number
  /** Error message if rate limited */
  message?: string
  /** Status code if rate limited */
  statusCode?: number
}

export interface RateLimitStatus {
  /** Current request count in window */
  count: number
  /** Maximum allowed requests */
  max: number
  /** Window size in ms */
  windowMs: number
  /** Time until reset */
  resetIn: number
  /** Whether currently rate limited */
  limited: boolean
}

interface RateLimitEntry {
  timestamps: number[]
  lastCleanup: number
}

export class SandboxRateLimiter {
  private limits: Map<string, RateLimitConfig>
  private entries: Map<string, RateLimitEntry>
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(configs: Record<string, RateLimitConfig>) {
    this.limits = new Map(Object.entries(configs))
    this.entries = new Map<string, RateLimitEntry>()

    // Start cleanup interval (every minute)
    this.startCleanup()
  }

  /**
   * Check if operation is allowed for identifier
   * 
   * @param identifier - User ID, IP address, or other identifier
   * @param operation - Operation type (e.g., 'commands', 'fileOps')
   * @returns Rate limit result
   * 
   * @example
   * ```typescript
   * const result = await rateLimiter.check('user-123', 'commands')
   * if (!result.allowed) {
   *   throw new Error(result.message!)
   * }
   * ```
   */
  async check(identifier: string, operation: string): Promise<RateLimitResult> {
    const config = this.limits.get(operation)
    if (!config) {
      // No limit configured, allow
      return {
        allowed: true,
        remaining: Infinity,
        resetIn: 0,
      }
    }

    const key = `${operation}:${identifier}`
    const now = Date.now()
    const entry = this.entries.get(key) || { timestamps: [], lastCleanup: now }

    // Remove timestamps outside window
    const windowStart = now - config.windowMs
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart)
    entry.lastCleanup = now
    this.entries.set(key, entry)

    const count = entry.timestamps.length
    const remaining = Math.max(0, config.max - count)
    const resetIn = entry.timestamps.length > 0
      ? entry.timestamps[0] + config.windowMs - now
      : 0

    if (count >= config.max) {
      return {
        allowed: false,
        remaining: 0,
        resetIn,
        retryAfter: Math.ceil(resetIn / 1000),
        message: config.message || `Rate limit exceeded for ${operation}. Max ${config.max} requests per ${config.windowMs / 1000}s.`,
        statusCode: config.statusCode || 429,
      }
    }

    return {
      allowed: true,
      remaining,
      resetIn,
    }
  }

  /**
   * Record an operation for identifier
   * 
   * @param identifier - User ID, IP address, or other identifier
   * @param operation - Operation type
   * 
   * @example
   * ```typescript
   * await rateLimiter.record('user-123', 'commands')
   * ```
   */
  async record(identifier: string, operation: string): Promise<void> {
    const config = this.limits.get(operation)
    if (!config) return

    const key = `${operation}:${identifier}`
    const now = Date.now()
    const entry = this.entries.get(key) || { timestamps: [], lastCleanup: now }

    entry.timestamps.push(now)
    this.entries.set(key, entry)
  }

  /**
   * Check and record in one operation (atomic)
   * 
   * @param identifier - User ID, IP address, or other identifier
   * @param operation - Operation type
   * @returns Rate limit result
   * 
   * @example
   * ```typescript
   * const result = await rateLimiter.checkAndRecord('user-123', 'commands')
   * if (!result.allowed) {
   *   throw new Error(result.message!)
   * }
   * // Operation is already recorded
   * ```
   */
  async checkAndRecord(identifier: string, operation: string): Promise<RateLimitResult> {
    const config = this.limits.get(operation)
    if (!config) {
      return {
        allowed: true,
        remaining: Infinity,
        resetIn: 0,
      }
    }

    const key = `${operation}:${identifier}`
    const now = Date.now()
    const entry = this.entries.get(key) || { timestamps: [], lastCleanup: now }

    // Remove timestamps outside window
    const windowStart = now - config.windowMs
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart)

    const count = entry.timestamps.length
    const remaining = Math.max(0, config.max - count)
    const resetIn = count > 0 ? entry.timestamps[0] + config.windowMs - now : 0

    if (count >= config.max) {
      this.entries.set(key, entry)
      return {
        allowed: false,
        remaining: 0,
        resetIn,
        retryAfter: Math.ceil(resetIn / 1000),
        message: config.message || `Rate limit exceeded for ${operation}.`,
        statusCode: config.statusCode || 429,
      }
    }

    // Record the operation
    entry.timestamps.push(now)
    this.entries.set(key, entry)

    return {
      allowed: true,
      remaining: remaining - 1,
      resetIn,
    }
  }

  /**
   * Get current rate limit status
   */
  getStatus(identifier: string, operation: string): RateLimitStatus {
    const config = this.limits.get(operation)
    if (!config) {
      return {
        count: 0,
        max: Infinity,
        windowMs: 0,
        resetIn: 0,
        limited: false,
      }
    }

    const key = `${operation}:${identifier}`
    const entry = this.entries.get(key)
    const now = Date.now()

    if (!entry) {
      return {
        count: 0,
        max: config.max,
        windowMs: config.windowMs,
        resetIn: 0,
        limited: false,
      }
    }

    // Count valid timestamps
    const windowStart = now - config.windowMs
    const count = entry.timestamps.filter(ts => ts > windowStart).length
    const resetIn = count > 0 ? entry.timestamps[0] + config.windowMs - now : 0

    return {
      count,
      max: config.max,
      windowMs: config.windowMs,
      resetIn,
      limited: count >= config.max,
    }
  }

  /**
   * Reset rate limit for identifier
   */
  reset(identifier: string, operation?: string): void {
    if (operation) {
      const key = `${operation}:${identifier}`
      this.entries.delete(key)
    } else {
      // Reset all operations for identifier
      for (const [key] of this.entries.entries()) {
        if (key.endsWith(`:${identifier}`)) {
          this.entries.delete(key)
        }
      }
    }
  }

  /**
   * Add or update rate limit configuration
   */
  setConfig(operation: string, config: RateLimitConfig): void {
    this.limits.set(operation, config)
  }

  /**
   * Get rate limit configuration
   */
  getConfig(operation: string): RateLimitConfig | undefined {
    return this.limits.get(operation)
  }

  /**
   * Get all rate limit configurations
   */
  getAllConfigs(): Record<string, RateLimitConfig> {
    return Object.fromEntries(this.limits)
  }

  /**
   * Start cleanup interval
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now()
      const maxWindowMs = Math.max(...Array.from(this.limits.values()).map(c => c.windowMs), 60000)

      for (const [key, entry] of this.entries.entries()) {
        // Cleanup if no activity in 2x max window
        if (now - entry.lastCleanup > maxWindowMs * 2) {
          this.entries.delete(key)
        }
      }
    }, 60000) // Run every minute

    // Cleanup on process exit
    process.on('exit', () => this.stopCleanup())
    process.on('SIGTERM', () => this.stopCleanup())
    process.on('SIGINT', () => this.stopCleanup())
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Clear all rate limit entries
   */
  clear(): void {
    this.entries.clear()
  }

  /**
   * Get total number of tracked identifiers
   */
  size(): number {
    return this.entries.size
  }
}

/**
 * Default rate limit configurations for sandbox operations
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  commands: {
    max: 100,
    windowMs: 60000, // 100 per minute
    message: 'Too many commands. Please slow down.',
  },
  fileOps: {
    max: 50,
    windowMs: 60000, // 50 per minute
    message: 'Too many file operations. Please slow down.',
  },
  batchJobs: {
    max: 10,
    windowMs: 60000, // 10 per minute
    message: 'Too many batch jobs. Please slow down.',
  },
  asyncExec: {
    max: 20,
    windowMs: 60000, // 20 per minute
    message: 'Too many async executions. Please slow down.',
  },
  checkpoints: {
    max: 30,
    windowMs: 60000, // 30 per minute
    message: 'Too many checkpoint operations. Please slow down.',
  },
  proxy: {
    max: 5,
    windowMs: 60000, // 5 per minute
    message: 'Too many proxy tunnels. Please slow down.',
  },
}

/**
 * Create rate limiter with default sandbox configurations
 */
export function createSandboxRateLimiter(
  overrides?: Partial<Record<keyof typeof DEFAULT_RATE_LIMITS, Partial<RateLimitConfig>>>
): SandboxRateLimiter {
  const configs = { ...DEFAULT_RATE_LIMITS }

  if (overrides) {
    for (const [key, override] of Object.entries(overrides)) {
      if (configs[key]) {
        configs[key] = { ...configs[key], ...override }
      }
    }
  }

  return new SandboxRateLimiter(configs)
}

/**
 * Rate limit middleware for Express/Fastify
 */
export function rateLimitMiddleware(
  rateLimiter: SandboxRateLimiter,
  operation: string,
  identifierFn: (req: any) => string = (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown'
) {
  return async (req: any, res: any, next: () => void) => {
    const identifier = identifierFn(req)
    const result = await rateLimiter.checkAndRecord(identifier, operation)

    if (!result.allowed) {
      res.status(result.statusCode || 429)
      res.setHeader('Retry-After', result.retryAfter || 60)
      res.setHeader('X-RateLimit-Limit', rateLimiter.getConfig(operation)?.max || 0)
      res.setHeader('X-RateLimit-Remaining', result.remaining)
      res.setHeader('X-RateLimit-Reset', Date.now() + result.resetIn)
      return res.json({
        error: result.message || 'Rate limit exceeded',
        retryAfter: result.retryAfter,
      })
    }

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', rateLimiter.getConfig(operation)?.max || 0)
    res.setHeader('X-RateLimit-Remaining', result.remaining)
    res.setHeader('X-RateLimit-Reset', Date.now() + result.resetIn)

    next()
  }
}
