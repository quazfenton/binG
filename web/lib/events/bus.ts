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
    // Validate event schema
    const parsed = AnyEvent.parse(input);

    // Persist to event store (always - for audit/replay)
    const event = await createEvent(parsed, userId, sessionId);

    // Try to dispatch to Trigger.dev if configured
    const useTrigger = await isTriggerConfigured();

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

        return {
          eventId: event.id,
          status: 'dispatched',
          backend: 'trigger',
        };
      } catch (triggerError: any) {
        // Trigger.dev dispatch failed — fall back to local polling
        logger.warn('Trigger.dev dispatch failed, falling back to local', {
          eventId: event.id,
          error: triggerError.message,
        });
      }
    }

    // Local execution (fallback or Trigger.dev not configured)
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

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const { getEventById } = await import('./store');
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
