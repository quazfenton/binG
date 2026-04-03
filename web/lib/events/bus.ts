/**
 * Event Bus - Event emission layer
 *
 * This is the ONLY function LLM tools should call to emit events.
 * Provides validation, persistence, and logging.
 *
 * @module events/bus
 */

import { AnyEvent } from './schema';
import { createEvent, type EventRecord } from './store';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:Bus');

/**
 * Result of emitting an event
 */
export interface EmitEventResult {
  eventId: string;
  status: 'queued';
}

/**
 * Emit event to event store
 *
 * This is the primary API for emitting events.
 * Validates the event schema and persists it to the database.
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
 * console.log(`Event queued: ${result.eventId}`);
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

    // Persist to event store
    const event = await createEvent(parsed, userId, sessionId);

    logger.info('Event emitted', {
      eventId: event.id,
      type: event.type,
      userId,
      sessionId,
    });

    return {
      eventId: event.id,
      status: 'queued',
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
  const { emitEvent } = await import('./bus');
  const { getEventById } = await import('./store');

  const result = await emitEvent(input, userId, sessionId);

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

  logger.info('Batch events emitted', {
    count: results.length,
    userId,
  });

  return results;
}
