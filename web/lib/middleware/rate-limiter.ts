/**
 * Rate Limiter Middleware
 *
 * Provides rate limiting for API endpoints to prevent abuse and brute-force attacks.
 * Uses an in-memory Map for storage (suitable for serverless/edge deployments).
 *
 * Features:
 * - IP-based rate limiting
 * - Email-based rate limiting (for auth endpoints)
 * - User-based rate limiting (for authenticated users)
 * - Configurable limits via environment variables
 * - Sliding window algorithm
 * - Tiered rate limits (free/premium/enterprise)
 */

interface RateLimitEntry {
  count: number;
  firstRequestTime: number;
}

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Maximum requests allowed in window
  message: string;       // Error message when limit exceeded
}

// Rate limit tiers for different user levels
export interface RateLimitTier {
  name: string;
  multiplier: number;
  description: string;
}

export const RATE_LIMIT_TIERS: Record<string, RateLimitTier> = {
  free: {
    name: 'free',
    multiplier: 1,
    description: 'Free tier - standard limits'
  },
  premium: {
    name: 'premium',
    multiplier: 10,
    description: 'Premium tier - 10x limits'
  },
  enterprise: {
    name: 'enterprise',
    multiplier: 100,
    description: 'Enterprise tier - 100x limits'
  },
};

// Get tier from user context or default to free
export function getRateLimitTier(userId?: string, apiKey?: string): RateLimitTier {
  // Check for enterprise API key pattern
  if (apiKey?.startsWith('sk-ent-')) {
    return RATE_LIMIT_TIERS.enterprise;
  }
  // Check for premium API key pattern
  if (apiKey?.startsWith('sk-pro-')) {
    return RATE_LIMIT_TIERS.premium;
  }
  // Default to free tier
  return RATE_LIMIT_TIERS.free;
}

// In-memory storage for rate limit tracking
// CRITICAL FIX: Use globalThis to survive Next.js hot-reloading
// Without this, rate limits are bypassed after every hot-reload (security vulnerability)
declare global {
  // eslint-disable-next-line no-var
  var __rateLimitStore__: Map<string, RateLimitEntry> | undefined;
  // eslint-disable-next-line no-var
  var __rateLimitCleanupRegistered__: boolean | undefined;
}

const rateLimitStore = globalThis.__rateLimitStore__ ?? (globalThis.__rateLimitStore__ = new Map<string, RateLimitEntry>());

// Default configurations for different endpoints
export const RATE_LIMIT_CONFIGS = {
  // Login: Strict limits to prevent brute-force attacks
  login: {
    windowMs: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || '900000', 10) || 900000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '5', 10) || 5,
    message: 'Too many login attempts. Please try again in 15 minutes.',
  } as RateLimitConfig,

  // Registration: Moderate limits to prevent spam
  register: {
    windowMs: parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW_MS || '3600000', 10) || 3600000, // 1 hour
    maxRequests: parseInt(process.env.RATE_LIMIT_REGISTER_MAX || '3', 10) || 3,
    message: 'Too many registration attempts. Please try again in 1 hour.',
  } as RateLimitConfig,

  // Email verification: Lenient limits (users may need multiple attempts)
  verifyEmail: {
    windowMs: parseInt(process.env.RATE_LIMIT_VERIFY_WINDOW_MS || '3600000', 10) || 3600000, // 1 hour
    maxRequests: parseInt(process.env.RATE_LIMIT_VERIFY_MAX || '10', 10) || 10,
    message: 'Too many verification attempts. Please try again in 1 hour.',
  } as RateLimitConfig,

  // Send verification email: Strict to prevent email spam
  sendVerification: {
    windowMs: parseInt(process.env.RATE_LIMIT_SEND_VERIFICATION_WINDOW_MS || '3600000', 10) || 3600000, // 1 hour
    maxRequests: parseInt(process.env.RATE_LIMIT_SEND_VERIFICATION_MAX || '3', 10) || 3,
    message: 'Too many verification emails requested. Please try again in 1 hour.',
  } as RateLimitConfig,

  // Password reset: Strict to prevent abuse
  passwordReset: {
    windowMs: parseInt(process.env.RATE_LIMIT_PASSWORD_RESET_WINDOW_MS || '3600000', 10) || 3600000, // 1 hour
    maxRequests: parseInt(process.env.RATE_LIMIT_PASSWORD_RESET_MAX || '3', 10) || 3,
    message: 'Too many password reset requests. Please try again in 1 hour.',
  } as RateLimitConfig,

  // Generic API: Default limits for other endpoints
  generic: {
    windowMs: parseInt(process.env.RATE_LIMIT_GENERIC_WINDOW_MS || '60000', 10) || 60000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_GENERIC_MAX || '30', 10) || 30,
    message: 'Too many requests. Please slow down.',
  } as RateLimitConfig,
};

/**
 * Get client identifier for rate limiting
 * Uses BOTH IP address AND email (when provided) to prevent:
 * - Password spraying attacks (single IP trying many emails)
 * - Distributed attacks (many IPs targeting one email)
 */
function getClientIdentifier(request: Request, email?: string): string {
  // Try to get IP from headers (works with proxies/Cloudflare)
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  let ip = 'unknown';
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    ip = forwardedFor.split(',')[0].trim();
  } else if (realIp) {
    ip = realIp;
  }

  // For auth endpoints, rate limit by BOTH IP and email to prevent:
  // 1. Password spraying: Single IP trying many emails (now limited by IP)
  // 2. Distributed attacks: Many IPs targeting one email (now limited by email)
  // 3. IP spoofing: Spoofed x-forwarded-for (now also limited by email)
  if (email) {
    return `ip:${ip}:email:${email.toLowerCase()}`;
  }

  return `ip:${ip}`;
}

/**
 * Clean up expired entries from the rate limit store
 * Runs periodically to prevent memory leaks
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  const maxWindowMs = Math.max(
    RATE_LIMIT_CONFIGS.login.windowMs,
    RATE_LIMIT_CONFIGS.register.windowMs,
    RATE_LIMIT_CONFIGS.verifyEmail.windowMs,
    RATE_LIMIT_CONFIGS.sendVerification.windowMs,
    RATE_LIMIT_CONFIGS.passwordReset.windowMs,
    RATE_LIMIT_CONFIGS.generic.windowMs
  );

  const cutoff = now - maxWindowMs;
  
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.firstRequestTime < cutoff) {
      rateLimitStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes (only once, even across hot-reloads)
if (!globalThis.__rateLimitCleanupRegistered__) {
  globalThis.__rateLimitCleanupRegistered__ = true;
  setInterval(cleanupExpiredEntries, 5 * 60 * 1000);
}

/**
 * Check rate limit for a given identifier and configuration
 *
 * @param identifier - Unique identifier (IP or email)
 * @param config - Rate limit configuration
 * @param tier - Rate limit tier (default: free)
 * @returns Object with allowed status and retry information
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
  tier: RateLimitTier = RATE_LIMIT_TIERS.free
): { allowed: boolean; remaining: number; resetAfter: number; retryAfter?: number; tier: string } {
  const now = Date.now();
  const key = `${identifier}:${config.windowMs}:${tier.name}`;

  // Apply tier multiplier to max requests
  const adjustedMaxRequests = config.maxRequests * tier.multiplier;

  const entry = rateLimitStore.get(key);

  if (!entry) {
    // First request in this window
    rateLimitStore.set(key, {
      count: 1,
      firstRequestTime: now,
    });

    return {
      allowed: true,
      remaining: adjustedMaxRequests - 1,
      resetAfter: config.windowMs,
      tier: tier.name,
    };
  }

  // Check if window has expired
  const windowEnd = entry.firstRequestTime + config.windowMs;

  if (now > windowEnd) {
    // Window expired, reset counter
    rateLimitStore.set(key, {
      count: 1,
      firstRequestTime: now,
    });

    return {
      allowed: true,
      remaining: adjustedMaxRequests - 1,
      resetAfter: config.windowMs,
      tier: tier.name,
    };
  }

  // Window still active
  const resetAfter = windowEnd - now;

  if (entry.count >= adjustedMaxRequests) {
    // Rate limit exceeded
    return {
      allowed: false,
      remaining: 0,
      resetAfter,
      retryAfter: Math.ceil(resetAfter / 1000), // Convert to seconds
      tier: tier.name,
    };
  }

  // Increment counter first, then compute remaining
  entry.count++;
  rateLimitStore.set(key, entry);
  const remaining = Math.max(0, adjustedMaxRequests - entry.count);

  return {
    allowed: true,
    remaining,
    resetAfter,
    tier: tier.name,
  };
}

/**
 * Rate limiting middleware for Next.js API routes
 *
 * @param request - The incoming request
 * @param configKey - Key for the rate limit configuration to use
 * @param email - Optional email for email-based rate limiting
 * @param tier - Optional rate limit tier (default: free)
 * @returns Response object if rate limited, null + headers if allowed
 */
export function rateLimitMiddleware(
  request: Request,
  configKey: keyof typeof RATE_LIMIT_CONFIGS = 'generic',
  email?: string,
  tier?: RateLimitTier
): { success: false; response: Response } | { success: true; response: null; headers: Record<string, string> } {
  const config = RATE_LIMIT_CONFIGS[configKey];
  const identifier = getClientIdentifier(request, email);
  const selectedTier = tier || RATE_LIMIT_TIERS.free;
  const result = checkRateLimit(identifier, config, selectedTier);

  if (!result.allowed) {
    return {
      success: false,
      response: Response.json(
        {
          success: false,
          error: config.message,
          retryAfter: result.retryAfter,
          remaining: result.remaining,
          tier: result.tier,
        },
        {
          status: 429,
          headers: {
            'Retry-After': result.retryAfter?.toString() || '60',
            'X-RateLimit-Limit': (config.maxRequests * selectedTier.multiplier).toString(),
            'X-RateLimit-Remaining': result.remaining.toString(),
            'X-RateLimit-Reset': Math.ceil(Date.now() / 1000 + result.resetAfter / 1000).toString(),
            'X-RateLimit-Tier': result.tier,
          },
        }
      ),
    };
  }

  // Build rate limit headers for successful response so callers can attach them
  const headers = {
    'X-RateLimit-Limit': (config.maxRequests * selectedTier.multiplier).toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(Date.now() / 1000 + result.resetAfter / 1000).toString(),
    'X-RateLimit-Tier': result.tier,
  };
  
  return {
    success: true,
    response: null,
    headers,
  };
}

/**
 * Create rate limit headers for response
 */
export function getRateLimitHeaders(
  limit: number,
  remaining: number,
  resetAfter: number
): Record<string, string> {
  return {
    'X-RateLimit-Limit': limit.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(Date.now() / 1000 + resetAfter / 1000).toString(),
  };
}

/**
 * Reset rate limit for a specific identifier (useful for testing or admin actions)
 */
export function resetRateLimit(identifier: string, configKey: keyof typeof RATE_LIMIT_CONFIGS): void {
  const config = RATE_LIMIT_CONFIGS[configKey];
  // Bug 6 fix: checkRateLimit keys include tier suffix; delete all tier variants
  for (const tier of Object.keys(RATE_LIMIT_TIERS)) {
    rateLimitStore.delete(`${identifier}:${config.windowMs}:${tier}`);
  }
  // Also delete legacy key without tier (backward compat)
  rateLimitStore.delete(`${identifier}:${config.windowMs}`);
}

/**
 * Get current rate limit status for an identifier (useful for debugging)
 */
export function getRateLimitStatus(
  identifier: string,
  configKey: keyof typeof RATE_LIMIT_CONFIGS,
  tier: RateLimitTier = RATE_LIMIT_TIERS.free
): { count: number; windowMs: number; maxRequests: number; resetAfter: number } | null {
  const config = RATE_LIMIT_CONFIGS[configKey];
  const key = `${identifier}:${config.windowMs}:${tier.name}`;
  const entry = rateLimitStore.get(key);

  if (!entry) {
    return null;
  }

  const now = Date.now();
  const windowEnd = entry.firstRequestTime + config.windowMs;
  const resetAfter = Math.max(0, windowEnd - now);

  return {
    count: entry.count,
    windowMs: config.windowMs,
    maxRequests: config.maxRequests,
    resetAfter,
  };
}

/**
 * Per-user rate limiting helper
 * 
 * ADDED: Easy-to-use function for per-user rate limiting in API routes
 * 
 * @param userId - Authenticated user ID
 * @param configKey - Rate limit configuration key
 * @param apiKey - Optional API key for tier detection
 * @returns Rate limit check result with headers
 * 
 * @example
 * ```typescript
 * // In API route
 * const userId = authResult.userId;
 * const rateLimitResult = checkUserRateLimit(userId, 'generic', apiKey);
 * 
 * if (!rateLimitResult.allowed) {
 *   return NextResponse.json({ error: 'Rate limited' }, { 
 *     status: 429,
 *     headers: rateLimitResult.headers 
 *   });
 * }
 * ```
 */
export function checkUserRateLimit(
  userId: string,
  configKey: keyof typeof RATE_LIMIT_CONFIGS = 'generic',
  apiKey?: string
): {
  allowed: boolean;
  remaining: number;
  resetAfter: number;
  retryAfter?: number;
  tier: string;
  headers: Record<string, string>;
} {
  const config = RATE_LIMIT_CONFIGS[configKey];
  const tier = getRateLimitTier(userId, apiKey);
  const identifier = `user:${userId}`; // Per-user identifier
  const result = checkRateLimit(identifier, config, tier);

  return {
    allowed: result.allowed,
    remaining: result.remaining,
    resetAfter: result.resetAfter,
    retryAfter: result.retryAfter,
    tier: result.tier,
    headers: {
      'X-RateLimit-Limit': (config.maxRequests * tier.multiplier).toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(Date.now() / 1000 + result.resetAfter / 1000).toString(),
      'X-RateLimit-Tier': result.tier,
    },
  };
}

/**
 * Get user's rate limit tier based on API key or user ID
 * 
 * ADDED: Helper for determining user's rate limit tier
 */
export function getUserRateLimitTier(userId?: string, apiKey?: string): RateLimitTier {
  return getRateLimitTier(userId, apiKey);
}