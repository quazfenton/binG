/**
 * Redis Sandbox Binding Service
 *
 * Phase 1 of the connection-state-in-Redis rollout (see code review thread for
 * the multi-phase plan). Stores user→sandbox mapping in Redis so any pod in a
 * horizontally-scaled deployment can resolve a request to the correct
 * sandbox/connection without a database round-trip.
 *
 * Keyspace:
 *   - sandbox:binding:{sessionId}  -> JSON SandboxBinding (TTL: 24h default)
 *   - sandbox:user:{userId}:bindings -> SET of sessionIds (TTL: refreshed on insert)
 *
 * Source of truth: SQLite (lib/database/session-store.ts). Redis is a fast-path
 * cache + cross-pod coordination layer. If Redis is disabled (REDIS_DISABLED=true)
 * or unavailable, the service degrades gracefully — all methods become no-ops
 * or return null/[] and the caller falls back to SQLite.
 *
 * Failure mode: NEVER throw on Redis hiccups. Reads return null/[]; writes are
 * fire-and-forget. Rationale: SQLite already has the binding; a transient Redis
 * failure must not surface to the user as a 500 — the cross-pod lookup will
 * simply rehydrate the cache on next access.
 */

import { createLogger } from '../utils/logger';
import { getRedisClient, isRedisEnabled } from './client';

const logger = createLogger('Redis:SandboxBinding');

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const BINDING_PREFIX = 'sandbox:binding';
const USER_BINDINGS_PREFIX = 'sandbox:user';

/**
 * Mirrored from sandboxBridge.inferProviderFromSandboxId() output; kept
 * as a loose union so caller-derived values (env fallback, etc.) compile.
 */
export type SandboxProvider =
  | 'e2b'
  | 'daytona'
  | 'sprites'
  | 'codesandbox'
  | 'vercel-sandbox'
  | 'docker'
  | 'local'
  | string;

export interface SandboxBinding {
  sessionId: string;
  userId: string;
  sandboxId: string;
  /**
   * Relative URL the client uses to open the connection (typically the
   * SSE endpoint). We deliberately do NOT store the absolute ws://wss://
   * URL here — the protocol scheme is resolved by the runtime based on
   * NEXT_PUBLIC_WEBSOCKET_URL / window.location. Storing the relative path
   * keeps bindings portable across deployments.
   */
  wsUrl: string;
  provider: SandboxProvider;
  createdAt: number;
  expiresAt: number;
  status: 'active' | 'inactive' | 'expired';
}

export interface RedisSandboxBindingConfig {
  redisUrl?: string;
  bindingPrefix?: string;
  userBindingsPrefix?: string;
  defaultTTLSeconds?: number;
}

export class RedisSandboxBindingService {
  private config: Required<RedisSandboxBindingConfig>;

  constructor(config: RedisSandboxBindingConfig = {}) {
    this.config = {
      redisUrl: config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379',
      bindingPrefix: config.bindingPrefix || BINDING_PREFIX,
      userBindingsPrefix: config.userBindingsPrefix || USER_BINDINGS_PREFIX,
      defaultTTLSeconds: config.defaultTTLSeconds || DEFAULT_TTL_SECONDS,
    };
  }

  /**
   * Read-only feature check. Returns true when the service is allowed to
   * call Redis. Use this to gate side-effects when callers want to skip
   * the work entirely (e.g. dev / test paths that don't even build a
   * binding object).
   */
  isAvailable(): boolean {
    return isRedisEnabled();
  }

  /**
   * Upsert a binding into Redis (fail-open).
   *
   * Writes the JSON payload to `sandbox:binding:{sessionId}` with TTL and
   * adds the sessionId to the user's secondary index SET. The user SET
   * also gets the same TTL so a forgotten-inactive user doesn't keep
   * growing the SET forever.
   *
   * NEVER throws — Redis errors are logged and swallowed. The caller
   * already succeeded at the SQLite write; this is a cache write.
   */
  async upsertBinding(binding: SandboxBinding, ttlSeconds?: number): Promise<void> {
    if (!isRedisEnabled()) {
      logger.debug('Redis disabled — skipping binding upsert', { sessionId: binding.sessionId });
      return;
    }

    const ttl = ttlSeconds ?? this.config.defaultTTLSeconds;
    const bindingKey = `${this.config.bindingPrefix}:${binding.sessionId}`;
    const userKey = `${this.config.userBindingsPrefix}:${binding.userId}:bindings`;
    const payload = JSON.stringify(binding);

    try {
      const redis = getRedisClient();
      // SET with TTL — atomic key+TTL on Redis.
      await redis.set(bindingKey, payload, 'EX', ttl);
      // SADD to user's binding set.
      await redis.sadd(userKey, binding.sessionId);
      // Refresh the user SET's TTL in lockstep with the binding TTL so
      // a user's SET doesn't outlive its members forever.
      await redis.expire(userKey, ttl);

      logger.debug('Binding upserted', {
        sessionId: binding.sessionId,
        userId: binding.userId,
        ttl,
      });
    } catch (err: any) {
      // Fail-open: log + swallow. SQLite already has the binding; a
      // missing Redis write just means cross-pod lookups will rehydrate
      // the cache on next access from the SQLite fallback path.
      logger.warn('Redis binding upsert failed (fail-open)', {
        sessionId: binding.sessionId,
        userId: binding.userId,
        error: err?.message ?? String(err),
      });
    }
  }

  /**
   * Get binding by sessionId. Returns null on cache miss OR on any Redis
   * error so the caller can fall back to SQLite without exception flow.
   *
   * On parse error (corrupt cache entry), the entry is deleted
   * opportunistically and null is returned — prevents a poisoned cache
   * entry from blocking the SQLite fallback on every subsequent read.
   */
  async getBinding(sessionId: string): Promise<SandboxBinding | null> {
    if (!isRedisEnabled()) return null;

    try {
      const redis = getRedisClient();
      const data = await redis.get(`${this.config.bindingPrefix}:${sessionId}`);
      if (!data) return null;
      return JSON.parse(data) as SandboxBinding;
    } catch (err: any) {
      logger.warn('Redis binding read failed', {
        sessionId,
        error: err?.message ?? String(err),
      });
      return null;
    }
  }

  /**
   * Get all bindings for a user via the user's secondary index.
   *
   * Uses a pipelined batch GET so a user with N bindings costs 1
   * round-trip, not N. Returns [] on any failure (graceful degradation).
   */
  async getUserBindings(userId: string): Promise<SandboxBinding[]> {
    if (!isRedisEnabled()) return [];

    try {
      const redis = getRedisClient();
      const sessionIds = await redis.smembers(
        `${this.config.userBindingsPrefix}:${userId}:bindings`,
      );
      if (sessionIds.length === 0) return [];

      const pipeline = redis.pipeline();
      for (const sid of sessionIds) {
        pipeline.get(`${this.config.bindingPrefix}:${sid}`);
      }
      const results = await pipeline.exec();

      const out: SandboxBinding[] = [];
      for (const [err, val] of results ?? []) {
        if (err || !val) continue;
        try {
          out.push(JSON.parse(val as string) as SandboxBinding);
        } catch {
          // Skip malformed entries silently — they'll be cleaned up by
          // the next upsertBinding or by TTL expiry.
        }
      }
      return out;
    } catch (err: any) {
      logger.warn('Redis user bindings read failed', {
        userId,
        error: err?.message ?? String(err),
      });
      return [];
    }
  }

  /**
   * Delete binding by sessionId. Also removes from user's secondary index.
   * No-op when Redis is disabled or any Redis call rejects.
   */
  async deleteBinding(sessionId: string, userId: string): Promise<void> {
    if (!isRedisEnabled()) return;

    try {
      const redis = getRedisClient();
      await Promise.all([
        redis.del(`${this.config.bindingPrefix}:${sessionId}`),
        redis.srem(`${this.config.userBindingsPrefix}:${userId}:bindings`, sessionId),
      ]);
      logger.debug('Binding deleted', { sessionId, userId });
    } catch (err: any) {
      logger.warn('Redis binding delete failed', {
        sessionId,
        userId,
        error: err?.message ?? String(err),
      });
    }
  }
}

// ============================================================================
// Singleton instance — mirrors RedisAgentService convention.
// ============================================================================

let redisSandboxBindingServiceInstance: RedisSandboxBindingService | null = null;

/**
 * Get the sandbox binding service singleton. Constructed lazily on first
 * call; subsequent calls return the same instance.
 */
export function getSandboxBindingService(
  config?: RedisSandboxBindingConfig,
): RedisSandboxBindingService {
  if (!redisSandboxBindingServiceInstance) {
    redisSandboxBindingServiceInstance = new RedisSandboxBindingService(config);
  }
  return redisSandboxBindingServiceInstance;
}

/**
 * Test-only: reset the singleton so a fresh service rebuilds on the
 * next getSandboxBindingService() call. Mirrors the pattern in
 * redis/client.ts (`_resetRedisClientForTests`).
 */
export function _resetSandboxBindingServiceForTests(): void {
  redisSandboxBindingServiceInstance = null;
}

export default RedisSandboxBindingService;
