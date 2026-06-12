/**
 * Shared Redis Client
 *
 * Provides a singleton Redis client for use across the application.
 *
 * Dev-friendly defaults: Redis is OPT-IN. The client is only created when
 * `REDIS_ENABLED=true` is set in the environment (or the production env
 * has REDIS_URL set AND NODE_ENV=production). In dev, `getRedisClient()`
 * throws a typed error that callers (snapshot-broadcaster, etc.) check
 * for and treat as "Redis is disabled, fall back to local-only mode".
 *
 * This closes the dev-server log spam where ioredis kept trying to
 * connect to whatever REDIS_URL was set in .env (often an external
 * Upstash cluster) and printing 20+ lines of "auth / setinfo /
 * connect / close / reconnect in 502ms" on every startup.
 */

import Redis from 'ioredis';
// Bug: suppress ioredis's default debug logger. Without this, the dev
// server prints 20+ lines of "ioredis:redis write command[...] /
// setinfo / connect -> close / reconnect in 502ms" on every startup,
// even when Redis is disabled (because the debug logger fires at the
// module level, not per-connection). `setDebug(false)` is the only
// reliable way to silence it; `showFriendlyErrorStack` only changes
// error stack formatting, NOT debug output.
//
// Default is OFF. Set IOREDIS_DEBUG=true to opt in to verbose
// per-command logging (useful for local debugging of pub/sub).
// ioredis's TS types don't expose setDebug, so we cast through `any`.
const __RedisCtor = Redis as unknown as { setDebug: (enabled: boolean) => void };
if (process.env.IOREDIS_DEBUG === 'true' || process.env.IOREDIS_DEBUG === '1') {
  __RedisCtor.setDebug(true);
} else {
  __RedisCtor.setDebug(false);
}
import { createLogger } from '../utils/logger';

const logger = createLogger('Redis:Client');

/**
 * Whether Redis is enabled. Defaults to `false` in non-production
 * environments. Set `REDIS_ENABLED=true` to force-enable, or set
 * `REDIS_DISABLED=true` to force-disable even in production.
 */
export function isRedisEnabled(): boolean {
  if (process.env.REDIS_DISABLED === 'true' || process.env.REDIS_DISABLED === '1') {
    return false;
  }
  if (process.env.REDIS_ENABLED === 'true' || process.env.REDIS_ENABLED === '1') {
    return true;
  }
  // Default: enabled in production, disabled in dev/test.
  return process.env.NODE_ENV === 'production' && !!process.env.REDIS_URL;
}

/**
 * Thrown by `getRedisClient()` when Redis is disabled. Callers can
 * `instanceof` check this and silently degrade.
 */
export class RedisDisabledError extends Error {
  constructor(message: string = 'Redis is disabled (set REDIS_ENABLED=true to enable)') {
    super(message);
    this.name = 'RedisDisabledError';
  }
}

// One-time log so operators can see at a glance whether Redis is on/off.
let _loggedRedisState = false;
function logRedisStateOnce(): void {
  if (_loggedRedisState) return;
  _loggedRedisState = true;
  if (isRedisEnabled()) {
    logger.info('Redis enabled (REDIS_ENABLED=true or NODE_ENV=production + REDIS_URL set)');
  } else {
    logger.debug('Redis disabled in this environment (set REDIS_ENABLED=true to enable)');
  }
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (redisClient) return redisClient;
  if (!isRedisEnabled()) {
    logRedisStateOnce();
    throw new RedisDisabledError();
  }
  logRedisStateOnce();
  redisClient = new Redis(REDIS_URL, {
    retryStrategy: (times) => {
      if (times > 3) {
        logger.warn('Redis retry limit reached');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });

  redisClient.on('error', (err) => {
    logger.error('Redis connection error:', err.message);
  });

  redisClient.on('connect', () => {
    logger.info('Redis connected');
  });
  return redisClient;
}

export async function closeRedisClient(): Promise<'OK' | void> {
  if (redisClient) {
    const client = redisClient;
    redisClient = null;
    return client.quit();
  }
  return;
}

/**
 * Test-only: reset the singleton so a fresh `getRedisClient()` call rebuilds it.
 */
export function _resetRedisClientForTests(): void {
  if (redisClient) {
    try { redisClient.disconnect(); } catch { /* best-effort */ }
  }
  redisClient = null;
  _loggedRedisState = false;
}
