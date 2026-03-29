/**
 * Event Store
 * 
 * Database-backed event persistence layer.
 * In production, this would use Prisma/Supabase. For now, uses Redis.
 * Based on trigger.md design.
 */

import { AnyEvent, EventStatus, EventRecord } from './schema';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const EVENTS_HASH = 'events:records';
const EVENTS_BY_USER_PREFIX = 'events:user:';
const EVENTS_BY_STATUS_PREFIX = 'events:status:';

// Lazy Redis connection - only connect when needed
let redis: Redis | null = null;
let redisError: Error | null = null;

function getRedis(): Redis {
  if (redisError) {
    throw new Error(`Redis unavailable: ${redisError.message}`);
  }
  if (!redis) {
    try {
      redis = new Redis(REDIS_URL, {
        lazy: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
      });
      redis.on('error', (err) => {
        redisError = err;
        console.error('[EventStore] Redis error:', err.message);
      });
    } catch (err: any) {
      redisError = err;
      throw err;
    }
  }
  return redis;
}

// Generate unique event ID
function generateEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Create a new event in the store
 */
export async function createEvent(event: AnyEvent): Promise<EventRecord> {
  const r = getRedis();
  const id = generateEventId();
  const record: EventRecord = {
    id,
    type: event.type,
    payload: event,
    status: 'pending',
    createdAt: Date.now(),
    userId: event.userId,
  };

  // Store in Redis hash
  await r.hset(EVENTS_HASH, id, JSON.stringify(record));

  // Index by user
  await r.zadd(`${EVENTS_BY_USER_PREFIX}${event.userId}`, record.createdAt, id);

  // Index by status
  await r.zadd(`${EVENTS_BY_STATUS_PREFIX}pending`, record.createdAt, id);

  console.log(`[EventStore] Created event ${id} of type ${event.type}`);
  return record;
}

/**
 * Get event by ID
 */
export async function getEvent(id: string): Promise<EventRecord | null> {
  const r = getRedis();
  const data = await r.hget(EVENTS_HASH, id);
  if (!data) return null;
  return JSON.parse(data) as EventRecord;
}

/**
 * Get events for a user
 */
export async function getUserEvents(
  userId: string,
  limit = 50,
  status?: EventStatus
): Promise<EventRecord[]> {
  const key = status 
    ? `${EVENTS_BY_STATUS_PREFIX}${status}`
    : `${EVENTS_BY_USER_PREFIX}${userId}`;
  
  const ids = await redis.zrevrange(key, 0, limit - 1);
  const events: EventRecord[] = [];
  
  for (const id of ids) {
    const event = await getEvent(id);
    if (event && (!status || event.status === status)) {
      if (!status || event.userId === userId) {
        events.push(event);
      }
    }
  }
  
  return events;
}

/**
 * Get pending events (for worker processing)
 */
export async function getPendingEvents(limit = 10): Promise<EventRecord[]> {
  const ids = await redis.zrangebyscore(
    `${EVENTS_BY_STATUS_PREFIX}pending`,
    0,
    Date.now()
  );
  
  const events: EventRecord[] = [];
  for (const id of ids.slice(0, limit)) {
    const event = await getEvent(id);
    if (event) events.push(event);
  }
  
  return events;
}

/**
 * Mark event as processing
 */
export async function markEventProcessing(id: string): Promise<void> {
  const r = getRedis();
  const event = await getEvent(id);
  if (!event) return;

  // Remove from pending
  await r.zrem(`${EVENTS_BY_STATUS_PREFIX}pending`, id);
  
  // Add to processing
  await r.zadd(`${EVENTS_BY_STATUS_PREFIX}processing`, Date.now(), id);
  
  // Update status in record
  event.status = 'processing';
  await r.hset(EVENTS_HASH, id, JSON.stringify(event));
}

/**
 * Cancel a pending event
 */
export async function cancelEvent(id: string): Promise<void> {
  const r = getRedis();
  const event = await getEvent(id);
  if (!event) return;

  // Only cancel if still pending
  if (event.status !== 'pending') {
    throw new Error(`Cannot cancel event with status: ${event.status}`);
  }

  // Remove from pending
  await r.zrem(`${EVENTS_BY_STATUS_PREFIX}pending`, id);
  
  // Update status to cancelled
  event.status = 'cancelled';
  await r.hset(EVENTS_HASH, id, JSON.stringify(event));

  console.log(`[EventStore] Cancelled event ${id}`);
}

/**
 * Mark event as completed
 */
export async function markEventComplete(
  id: string, 
  result?: Record<string, any>
): Promise<void> {
  const r = getRedis();
  const event = await getEvent(id);
  if (!event) return;

  // Remove from processing
  await r.zrem(`${EVENTS_BY_STATUS_PREFIX}processing`, id);
  
  // Add to completed
  await r.zadd(`${EVENTS_BY_STATUS_PREFIX}completed`, Date.now(), id);
  
  // Update record
  event.status = 'completed';
  event.processedAt = Date.now();
  event.result = result;
  await r.hset(EVENTS_HASH, id, JSON.stringify(event));
  
  console.log(`[EventStore] Event ${id} completed`);
}

/**
 * Mark event as failed
 */
export async function markEventFailed(id: string, error: string): Promise<void> {
  const r = getRedis();
  const event = await getEvent(id);
  if (!event) return;

  // Remove from processing
  await r.zrem(`${EVENTS_BY_STATUS_PREFIX}processing`, id);
  
  // Add to failed
  await r.zadd(`${EVENTS_BY_STATUS_PREFIX}failed`, Date.now(), id);
  
  // Update record
  event.status = 'failed';
  event.processedAt = Date.now();
  event.error = error;
  await r.hset(EVENTS_HASH, id, JSON.stringify(event));
  
  console.error(`[EventStore] Event ${id} failed:`, error);
}

/**
 * Delete event
 */
export async function deleteEvent(id: string): Promise<void> {
  const r = getRedis();
  const event = await getEvent(id);
  if (!event) return;

  // Remove from all indexes
  await r.zrem(`${EVENTS_BY_STATUS_PREFIX}${event.status}`, id);
  await r.zrem(`${EVENTS_BY_USER_PREFIX}${event.userId}`, id);
  await r.hdel(EVENTS_HASH, id);
}

/**
 * Get event statistics
 */
export async function getEventStats(userId?: string): Promise<{
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const r = getRedis();
  const [pending, processing, completed, failed] = await Promise.all([
    r.zcard(`${EVENTS_BY_STATUS_PREFIX}pending`),
    r.zcard(`${EVENTS_BY_STATUS_PREFIX}processing`),
    r.zcard(`${EVENTS_BY_STATUS_PREFIX}completed`),
    r.zcard(`${EVENTS_BY_STATUS_PREFIX}failed`),
  ]);

  const total = pending + processing + completed + failed;

  return { total, pending, processing, completed, failed };
}