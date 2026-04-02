/**
 * Event System - Bug Fixes and Improvements
 *
 * This file contains fixes and improvements for the event system:
 * - Better error handling
 * - Edge case handling
 * - Input validation
 * - Performance optimizations
 * - Memory leak prevention
 *
 * @module events/fixes
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:Fixes');

/**
 * Fix 1: Prevent duplicate event emission
 * Adds idempotency key support
 */
const emittedEvents = new Map<string, number>();
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function checkIdempotency(key: string): boolean {
  const now = Date.now();
  const lastEmission = emittedEvents.get(key);

  if (lastEmission && now - lastEmission < IDEMPOTENCY_WINDOW_MS) {
    logger.warn('Duplicate event emission prevented', { key, lastEmission });
    return false; // Duplicate
  }

  emittedEvents.set(key, now);

  // Clean up old entries
  if (emittedEvents.size > 1000) {
    for (const [k, v] of emittedEvents.entries()) {
      if (now - v > IDEMPOTENCY_WINDOW_MS) {
        emittedEvents.delete(k);
      }
    }
  }

  return true; // Not duplicate
}

/**
 * Fix 2: Validate event payload size
 * Prevents memory issues from large payloads
 */
const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB

export function validatePayloadSize(payload: any): { valid: boolean; error?: string } {
  try {
    const size = JSON.stringify(payload).length;
    if (size > MAX_PAYLOAD_SIZE) {
      return {
        valid: false,
        error: `Payload size (${size} bytes) exceeds limit (${MAX_PAYLOAD_SIZE} bytes)`,
      };
    }
    return { valid: true };
  } catch (error: any) {
    return {
      valid: false,
      error: `Failed to serialize payload: ${error.message}`,
    };
  }
}

/**
 * Fix 3: Rate limiting per user
 * Prevents event spam
 */
const userEventCounts = new Map<string, { count: number; resetTime: number }>();

export function checkUserRateLimit(userId: string, limit: number = 100): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = userEventCounts.get(userId);

  if (!record || now > record.resetTime) {
    userEventCounts.set(userId, { count: 1, resetTime: now + 60000 });
    return { allowed: true, remaining: limit - 1 };
  }

  if (record.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: limit - record.count };
}

/**
 * Fix 4: Event type validation
 * Ensures event type is registered
 */
const registeredEventTypes = new Set<string>();

export function registerEventType(type: string): void {
  registeredEventTypes.add(type);
}

export function validateEventType(type: string): { valid: boolean; error?: string } {
  if (!type || typeof type !== 'string') {
    return { valid: false, error: 'Event type must be a non-empty string' };
  }

  if (!registeredEventTypes.has(type)) {
    logger.warn('Unregistered event type', { type });
    // Don't reject - allow dynamic types but log warning
  }

  return { valid: true };
}

// Register known event types
registerEventType('SCHEDULED_TASK');
registerEventType('BACKGROUND_JOB');
registerEventType('ORCHESTRATION_STEP');
registerEventType('WORKFLOW');
registerEventType('BASH_EXECUTION');
registerEventType('DAG_EXECUTION');
registerEventType('HUMAN_APPROVAL');
registerEventType('SELF_HEALING');
registerEventType('NOTIFICATION');
registerEventType('INTEGRATION');

/**
 * Fix 5: Timeout for event processing
 * Prevents hung events
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
  );

  return Promise.race([promise, timeout]);
}

/**
 * Fix 6: Circuit breaker for event processing
 * Prevents cascade failures
 */
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

export function getCircuitBreaker(key: string): CircuitBreakerState {
  return circuitBreakers.get(key) || {
    failures: 0,
    lastFailureTime: 0,
    state: 'closed',
  };
}

export function recordSuccess(key: string): void {
  const state = getCircuitBreaker(key);
  state.failures = 0;
  state.state = 'closed';
  circuitBreakers.set(key, state);
}

export function recordFailure(key: string): void {
  const state = getCircuitBreaker(key);
  state.failures++;
  state.lastFailureTime = Date.now();

  if (state.failures >= 5) {
    state.state = 'open';
    logger.warn('Circuit breaker opened', { key, failures: state.failures });
  }

  circuitBreakers.set(key, state);
}

export function canProcess(key: string): boolean {
  const state = getCircuitBreaker(key);

  if (state.state === 'closed') {
    return true;
  }

  if (state.state === 'open') {
    // Check if we should try half-open
    if (Date.now() - state.lastFailureTime > 60000) {
      state.state = 'half-open';
      circuitBreakers.set(key, state);
      return true;
    }
    return false;
  }

  // half-open - allow one through
  return true;
}

/**
 * Fix 7: Memory cleanup for old events
 * Prevents memory leaks
 */
export function scheduleMemoryCleanup(intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    try {
      // Clean up old idempotency keys
      const now = Date.now();
      for (const [key, timestamp] of emittedEvents.entries()) {
        if (now - timestamp > IDEMPOTENCY_WINDOW_MS) {
          emittedEvents.delete(key);
        }
      }

      // Clean up old rate limit records
      for (const [userId, record] of userEventCounts.entries()) {
        if (now > record.resetTime) {
          userEventCounts.delete(userId);
        }
      }

      logger.debug('Memory cleanup completed');
    } catch (error: any) {
      logger.error('Memory cleanup failed', { error: error.message });
    }
  }, intervalMs);
}

/**
 * Fix 8: Event correlation ID
 * Adds tracing across related events
 */
export function generateCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function getCorrelationId(headers?: Record<string, string>): string {
  return headers?.['x-correlation-id'] || generateCorrelationId();
}

/**
 * Fix 9: Event priority queue
 * Ensures high-priority events are processed first
 */
export enum EventPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  URGENT = 3,
}

export function getEventPriority(eventType: string, payload?: any): EventPriority {
  // Check payload for explicit priority
  if (payload?.priority) {
    return EventPriority[payload.priority as keyof typeof EventPriority] || EventPriority.NORMAL;
  }

  // Default priorities by type
  switch (eventType) {
    case 'HUMAN_APPROVAL':
      return EventPriority.HIGH;
    case 'SELF_HEALING':
      return EventPriority.HIGH;
    case 'NOTIFICATION':
      return payload?.priority === 'urgent' ? EventPriority.URGENT : EventPriority.NORMAL;
    default:
      return EventPriority.NORMAL;
  }
}

/**
 * Fix 10: Event deduplication by content hash
 */
export function generateEventContentHash(event: any): string {
  const hash = {
    type: event.type,
    userId: event.userId,
    payload: JSON.stringify(event.payload),
  };
  return JSON.stringify(hash);
}

const recentEventHashes = new Set<string>();
const HASH_WINDOW_MS = 60 * 1000; // 1 minute

export function isDuplicateEvent(event: any): boolean {
  const hash = generateEventContentHash(event);

  if (recentEventHashes.has(hash)) {
    logger.warn('Duplicate event content detected', { hash });
    return true;
  }

  recentEventHashes.add(hash);

  // Clean up old hashes
  setTimeout(() => {
    recentEventHashes.delete(hash);
  }, HASH_WINDOW_MS);

  return false;
}

/**
 * Apply all fixes to event emission
 */
export function applyEventFixes(event: any, userId: string, headers?: Record<string, string>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  correlationId: string;
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check idempotency
  const idempotencyKey = `${userId}:${event.type}:${Date.now()}`;
  if (!checkIdempotency(idempotencyKey)) {
    warnings.push('Duplicate event emission detected');
  }

  // Validate payload size
  const payloadValidation = validatePayloadSize(event.payload);
  if (!payloadValidation.valid) {
    errors.push(payloadValidation.error!);
  }

  // Check rate limit
  const rateLimit = checkUserRateLimit(userId);
  if (!rateLimit.allowed) {
    errors.push(`Rate limit exceeded (${rateLimit.remaining} remaining)`);
  }

  // Validate event type
  const typeValidation = validateEventType(event.type);
  if (!typeValidation.valid) {
    errors.push(typeValidation.error!);
  }

  // Check for duplicate content
  if (isDuplicateEvent(event)) {
    warnings.push('Duplicate event content detected');
  }

  // Generate correlation ID
  const correlationId = getCorrelationId(headers);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    correlationId,
  };
}

/**
 * Initialize all fixes
 */
export function initializeEventFixes(): void {
  // Start memory cleanup
  scheduleMemoryCleanup();

  logger.info('Event fixes initialized');
}
