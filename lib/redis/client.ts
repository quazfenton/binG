/**
 * Shared Redis Client
 *
 * Provides a singleton Redis client for use across the application.
 */

import Redis from 'ioredis';
import { createLogger } from '../utils/logger';

const logger = createLogger('Redis:Client');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
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
  }
  return redisClient;
}

export async function closeRedisClient(): Promise<'OK' | void> {
  if (redisClient) {
    return redisClient.quit();
  }
  return;
}
