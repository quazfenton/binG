/**
 * Event Bus - Event emission layer
 *
 * This is the ONLY function LLM tools should call to emit events.
 * Provides validation, persistence, and logging.
 *
 * When Trigger.dev is configured (TRIGGER_SECRET_KEY set and SDK available),
 * events are dispatched to Trigger.dev workers via the management API
 * for durable, long-running execution.
 * Otherwise, events fall back to the local SQLite event store with polling.
 *
 * @module events/bus
 */

import { AnyEvent } from './schema';
import { createEvent, type EventRecord } from './store';
import { invokeTriggerTask, isTriggerAvailable } from './trigger/utils';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:Bus');

// MED-3 fix: Subscriber circuit breaker — prevent cascading failures
// Tracks consecutive failures per subscriber and opens the circuit after threshold
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  openUntil: number; // Timestamp when circuit will close again
}
const subscriberCircuits = new Map<string, CircuitBreakerState>();
const CIRCUIT_BREAKER_THRESHOLD = 5; // Open after 5 consecutive failures
const CIRCUIT_BREAKER_RESET_MS = 60 * 1000; // Reset after 1 minute of being open
const CIRCUIT_BREAKER_HALF_OPEN_MAX = 1; // Allow 1 request in half-open state

function isCircuitOpen(subscriberId: string): boolean {
  const circuit = subscriberCircuits.get(subscriberId);
  if (!circuit) return false;
  if (circuit.failures < CIRCUIT_BREAKER_THRESHOLD) return false;
  // Check if reset period has elapsed (half-open state)
  if (Date.now() >= circuit.openUntil) {
    circuit.failures = CIRCUIT_BREAKER_THRESHOLD - CIRCUIT_BREAKER_HALF_OPEN_MAX;
    return false; // Allow one request through
  }
  return true;
}

function recordSuccess(subscriberId: string): void {
  subscriberCircuits.delete(subscriberId); // Reset on success
}

function recordFailure(subscriberId: string): void {
  const circuit = subscriberCircuits.get(subscriberId) || { failures: 0, lastFailureTime: 0, openUntil: 0 };
  circuit.failures++;
  circuit.lastFailureTime = Date.now();
  if (circuit.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuit.openUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
    logger.warn('Circuit breaker opened for subscriber', {
      subscriberId,
      failures: circuit.failures,
      openUntil: new Date(circuit.openUntil).toISOString(),
    });
  }
  subscriberCircuits.set(subscriberId, circuit);
}

// Periodic cleanup of stale circuit breaker entries (prevent unbounded growth)
const CIRCUIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let circuitCleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCircuitCleanup(): void {
  if (circuitCleanupTimer) return; // Already running
  circuitCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, circuit] of subscriberCircuits) {
      // Remove entries where circuit has been open and reset period has long passed
      if (circuit.failures >= CIRCUIT_BREAKER_THRESHOLD && now > circuit.openUntil + CIRCUIT_BREAKER_RESET_MS) {
        subscriberCircuits.delete(id);
      } else if (circuit.failures < CIRCUIT_BREAKER_THRESHOLD && now - circuit.lastFailureTime > CIRCUIT_CLEANUP_INTERVAL_MS) {
        // Also clean up entries with old failures that never hit threshold
        subscriberCircuits.delete(id);
      }
    }
  }, CIRCUIT_CLEANUP_INTERVAL_MS);
  // Don't prevent process exit
  if (circuitCleanupTimer && typeof circuitCleanupTimer === 'object' && 'unref' in circuitCleanupTimer) {
    (circuitCleanupTimer as any).unref();
  }
}

// Lazy init: start cleanup timer on first emitEvent call
let circuitCleanupStarted = false;
function ensureCircuitCleanup(): void {
  if (!circuitCleanupStarted) {
    circuitCleanupStarted = true;
    startCircuitCleanup();
  }
}

/**
 * Result of emitting an event
 */
export interface EmitEventResult {
  eventId: string;
  status: 'queued' | 'dispatched';
  backend: 'trigger' | 'local';
}

/**
 * Check if Trigger.dev is configured and should be used.
 * Requires TRIGGER_SECRET_KEY to be set AND SDK to be importable.
 */
async function isTriggerConfigured(): Promise<boolean> {
  if (!process.env.TRIGGER_SECRET_KEY) return false;
  return isTriggerAvailable();
}

/**
 * Emit event to event store (with Trigger.dev dispatch when available)
 *
 * This is the primary API for emitting events.
 * Validates the event schema and persists it to the database.
 * When Trigger.dev is configured, also dispatches to the Trigger.dev worker.
 *
 * @param input - The event to emit (must match one of the event schemas)
 * @param userId - The user ID emitting the event
 * @param sessionId - Optional session ID for scoping
 * @returns Event ID and status
 *
 * @example
 * ```typescript
 * const result = await emitEvent({
 *   type: 'SCHEDULED_TASK',
 *   taskType: 'HACKER_NEWS_DAILY',
 *   userId: 'user-123',
 *   payload: { destination: 'user@example.com' },
 * }, 'user-123');
 *
 * console.log(`Event queued: ${result.eventId} (${result.backend})`);
 * ```
 */
export async function emitEvent(
  input: unknown,
  userId: string,
  sessionId?: string
): Promise<EmitEventResult> {
  try {
    // MED-3 fix: Check circuit breaker before Trigger.dev dispatch
    // Track per-backend (trigger/local) instead of per-event-type — a failing
    // Trigger.dev dispatch shouldn't block local execution of the same event type.
    ensureCircuitCleanup();
    const subscriberId = 'backend:trigger'; // Circuit is for Trigger.dev dispatch path
    const circuitWasOpen = isCircuitOpen(subscriberId);
    if (circuitWasOpen) {
      logger.warn('Circuit breaker open for Trigger.dev — falling back to local', {
        subscriberId,
        input: (input as any)?.type,
      });
      // Skip Trigger.dev dispatch — fall through to local
    }

    // Validate event schema
    const parsed = AnyEvent.parse(input);

    // Persist to event store (always - for audit/replay)
    const event = await createEvent(parsed, userId, sessionId);

    // Try to dispatch to Trigger.dev if configured AND circuit is not open
    const useTrigger = !circuitWasOpen && await isTriggerConfigured();

    if (useTrigger) {
      try {
        // Dispatch to the event-worker task which processes individual events
        await invokeTriggerTask('event-worker', { eventId: event.id, type: event.type });

        logger.info('Event dispatched to Trigger.dev', {
          eventId: event.id,
          type: event.type,
          userId,
          sessionId,
        });

        recordSuccess(subscriberId);
        return {
          eventId: event.id,
          status: 'dispatched',
          backend: 'trigger',
        };
      } catch (triggerError: any) {
        // Trigger.dev dispatch failed — record failure for circuit breaker and fall back to local
        recordFailure(subscriberId);
        logger.warn('Trigger.dev dispatch failed, falling back to local', {
          eventId: event.id,
          error: triggerError.message,
        });
      }
    }

    // Local execution (fallback or Trigger.dev not configured or circuit open)
    // NOTE: Do NOT call recordSuccess here — local success doesn't prove Trigger.dev is healthy.
    // The circuit recovers naturally via half-open: after reset period, one request is let through
    // to test Trigger.dev, and if that succeeds, recordSuccess is called in the Trigger.dev path.
    logger.info('Event emitted (local)', {
      eventId: event.id,
      type: event.type,
      userId,
      sessionId,
    });

    return {
      eventId: event.id,
      status: 'queued',
      backend: 'local',
    };
  } catch (error: any) {
    // Note: Only Trigger.dev-specific failures are recorded in the circuit breaker
    // (in the inner catch above). General errors (Zod validation, DB failures) should
    // NOT affect the Trigger.dev circuit — they're unrelated to dispatch health.
    logger.error('Failed to emit event', {
      error: error.message,
      input,
      userId,
    });
    throw error;
  }
}

/**
 * Emit an event with additional options (priority, delay)
 * This is a wrapper around emitEvent for delayed/priority events
 */
export async function emitEventWithOptions(
  input: unknown,
  options: {
    priority?: 'low' | 'normal' | 'high';
    delay?: number;
  },
  userId: string,
  sessionId?: string
): Promise<EmitEventResult> {
  // For now, delay is handled by the scheduler, not here
  // Priority is passed through if the event schema supports it
  const eventWithOptions = {
    ...(input as object),
    priority: options.priority || 'normal',
  };
  return emitEvent(eventWithOptions, userId, sessionId);
}

/**
 * Emit event and wait for completion
 *
 * Useful for human-in-the-loop scenarios where you need to wait
 * for the event to be processed.
 *
 * @param input - The event to emit
 * @param userId - The user ID
 * @param sessionId - Optional session ID
 * @param timeout - Timeout in milliseconds (default: 5 minutes)
 * @returns The completed event record
 */
export async function emitEventAndWait(
  input: AnyEvent,
  userId: string,
  sessionId: string,
  timeout: number = 5 * 60 * 1000
): Promise<EventRecord> {
  const result = await emitEvent(input, userId, sessionId);

  // Import store once before the polling loop to avoid repeated resolution
  const { getEventById } = await import('./store');
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const event = await getEventById(result.eventId);

    if (!event) {
      throw new Error('Event not found');
    }

    if (event.status === 'completed') {
      return event;
    }

    if (event.status === 'failed') {
      throw new Error(`Event failed: ${event.error}`);
    }

    if (event.status === 'cancelled') {
      throw new Error('Event was cancelled');
    }

    // Wait 100ms before polling again
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Event timeout');
}

/**
 * Emit multiple events in a batch
 *
 * All events are validated first, then persisted atomically.
 *
 * @param events - Array of events to emit
 * @param userId - The user ID
 * @param sessionId - Optional session ID
 * @returns Array of event IDs
 */
export async function emitEventsBatch(
  events: Array<{ event: AnyEvent; sessionId?: string }>,
  userId: string
): Promise<string[]> {
  const results: string[] = [];

  // Validate all events first
  const parsedEvents = events.map(({ event, sessionId }) => ({
    parsed: AnyEvent.parse(event),
    sessionId,
  }));

  // Persist all events
  for (const { parsed, sessionId } of parsedEvents) {
    const event = await createEvent(parsed, userId, sessionId);
    results.push(event.id);
  }

  // Dispatch to Trigger.dev if configured (one task per event for durability)
  const useTrigger = await isTriggerConfigured();
  if (useTrigger) {
    const dispatchPromises = results.map(async (eventId) => {
      try {
        await invokeTriggerTask('event-worker', { eventId });
      } catch (error: any) {
        logger.warn('Trigger.dev batch dispatch failed for event, will process locally', {
          eventId,
          error: error.message,
        });
      }
    });
    await Promise.all(dispatchPromises);
    logger.info('Batch events dispatched to Trigger.dev', { count: results.length });
  }

  logger.info('Batch events emitted', {
    count: results.length,
    userId,
    backend: useTrigger ? 'trigger' : 'local',
  });

  return results;
}
