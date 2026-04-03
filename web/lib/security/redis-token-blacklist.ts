/**
 * Redis-Backed Token Blacklist for Production Environments
 * 
 * Provides distributed token revocation with:
 * - Atomic operations for revocation checks
 * - Automatic expiration via Redis TTL
 * - Consistent state across all server instances
 * 
 * @see lib/security/jwt-auth.ts - JWT authentication utilities
 */

import { Redis } from 'ioredis';
import type { TokenBlacklistProvider } from './jwt-auth';

const BLACKLIST_PREFIX = 'token:blacklist:';

/**
 * Redis-backed token blacklist implementation
 * 
 * Uses Redis SETEX for atomic set-with-expiry operations,
 * ensuring consistent revocation checks across distributed instances.
 */
export class RedisTokenBlacklist implements TokenBlacklistProvider {
  private redis: Redis;
  private defaultTTLSeconds: number;

  /**
   * Create Redis token blacklist
   * 
   * @param redis - Redis client instance
   * @param defaultTTLSeconds - Default TTL for revoked tokens (default: 24 hours)
   */
  constructor(redis: Redis, defaultTTLSeconds: number = 86400) {
    this.redis = redis;
    this.defaultTTLSeconds = defaultTTLSeconds;
  }

  /**
   * Revoke a token by JTI
   * 
   * Uses Redis SETEX for atomic set-with-expiry operation.
   * Token will automatically expire from the blacklist after TTL.
   * 
   * @param tokenJti - Token JTI identifier
   * @param expiryTimestamp - When the revocation expires (ms)
   */
  async revoke(tokenJti: string, expiryTimestamp: number): Promise<void> {
    const now = Date.now();
    const ttlSeconds = Math.max(
      1,
      Math.floor((expiryTimestamp - now) / 1000)
    );

    // Use SETEX for atomic set-with-expiry
    // Key format: token:blacklist:{jti}
    // Value: "1" (we only care about existence, not value)
    await this.redis.setex(
      `${BLACKLIST_PREFIX}${tokenJti}`,
      ttlSeconds,
      '1'
    );
  }

  /**
   * Check if token is revoked
   * 
   * Uses Redis EXISTS for atomic existence check.
   * Returns false if key doesn't exist or has expired.
   * 
   * @param tokenJti - Token JTI identifier
   * @returns true if revoked, false otherwise
   */
  async isRevoked(tokenJti: string): Promise<boolean> {
    const key = `${BLACKLIST_PREFIX}${tokenJti}`;
    
    // EXISTS returns 1 if key exists, 0 otherwise
    // Redis automatically removes expired keys, so no manual cleanup needed
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Clean up expired entries
   * 
   * Not needed for Redis implementation - Redis handles expiration automatically.
   * This method is a no-op for compatibility with the interface.
   */
  async cleanup(): Promise<void> {
    // Redis handles expiration automatically via TTL
    // No manual cleanup required
  }

  /**
   * Revoke multiple tokens atomically
   * 
   * Uses Redis pipeline for batch revocation.
   * 
   * @param tokens - Array of { jti, expiry } objects
   */
  async revokeMultiple(
    tokens: Array<{ jti: string; expiryTimestamp: number }>
  ): Promise<void> {
    const pipeline = this.redis.pipeline();

    for (const { jti, expiryTimestamp } of tokens) {
      const now = Date.now();
      const ttlSeconds = Math.max(
        1,
        Math.floor((expiryTimestamp - now) / 1000)
      );

      pipeline.setex(`${BLACKLIST_PREFIX}${jti}`, ttlSeconds, '1');
    }

    await pipeline.exec();
  }

  /**
   * Check if multiple tokens are revoked
   * 
   * Uses Redis pipeline for batch existence checks.
   * 
   * @param jtis - Array of token JTIs to check
   * @returns Map of JTI to revocation status
   */
  async isRevokedMultiple(jtis: string[]): Promise<Map<string, boolean>> {
    const pipeline = this.redis.pipeline();
    
    for (const jti of jtis) {
      pipeline.exists(`${BLACKLIST_PREFIX}${jti}`);
    }

    const results = await pipeline.exec();
    const statusMap = new Map<string, boolean>();

    jtis.forEach((jti, index) => {
      const exists = results?.[index]?.[1] as number;
      statusMap.set(jti, exists === 1);
    });

    return statusMap;
  }

  /**
   * Get count of currently revoked tokens
   * 
   * Uses Redis KEYS with pattern matching.
   * Note: This operation can be slow with large blacklists.
   * 
   * @returns Number of revoked tokens
   */
  async getRevokedCount(): Promise<number> {
    const keys = await this.redis.keys(`${BLACKLIST_PREFIX}*`);
    return keys.length;
  }

  /**
   * Clear all revoked tokens from blacklist
   * 
   * ⚠️ WARNING: This will un-revoke ALL tokens!
   * Use with extreme caution.
   */
  async clearAll(): Promise<void> {
    const keys = await this.redis.keys(`${BLACKLIST_PREFIX}*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

/**
 * Create Redis token blacklist from environment
 * 
 * @returns RedisTokenBlacklist instance or null if Redis not configured
 */
export function createRedisBlacklistFromEnv(): RedisTokenBlacklist | null {
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.warn('[RedisTokenBlacklist] REDIS_URL not configured, using in-memory blacklist');
    return null;
  }

  try {
    const redis = new Redis(redisUrl);

    const defaultTTLSeconds = parseInt(process.env.TOKEN_BLACKLIST_TTL || '86400', 10);

    const blacklist = new RedisTokenBlacklist(redis, defaultTTLSeconds);

    // Test connection
    redis.ping((err) => {
      if (err) {
        console.error('[RedisTokenBlacklist] Redis connection failed:', err);
      } else {
        console.log('[RedisTokenBlacklist] Connected to Redis successfully');
      }
    });

    return blacklist;
  } catch (error) {
    console.error('[RedisTokenBlacklist] Failed to create Redis client:', error);
    return null;
  }
}
