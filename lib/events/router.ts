/**
 * Event Router - Switch-based event dispatch
 *
 * Routes events to appropriate handlers based on event type.
 * Provides error handling, retry logic, and self-healing capabilities.
 *
 * @module events/router
 */

import { EventRecord } from './store';
import { markEventRunning, markEventComplete, markEventFailed, markEventCancelled } from './store';
import { createLogger } from '@/lib/utils/logger';
import { EventTypes } from './schema';

const logger = createLogger('Events:Router');

/**
 * Event handler interface
 */
export interface EventHandler {
  (event: EventRecord): Promise<any>;
}

/**
 * Handler registry
 */
const handlers = new Map<string, EventHandler>();

/**
 * Register an event handler
 */
export function registerHandler(eventType: string, handler: EventHandler): void {
  handlers.set(eventType, handler);
  logger.info('Handler registered', { eventType });
}

/**
 * Unregister an event handler
 */
export function unregisterHandler(eventType: string): void {
  handlers.delete(eventType);
  logger.info('Handler unregistered', { eventType });
}

/**
 * Get registered handler for event type
 */
export function getHandler(eventType: string): EventHandler | undefined {
  return handlers.get(eventType);
}

/**
 * Get all registered handlers
 */
export function getRegisteredHandlers(): string[] {
  return Array.from(handlers.keys());
}

/**
 * Route event to appropriate handler
 */
export async function routeEvent(event: EventRecord): Promise<void> {
  const handler = handlers.get(event.type);

  if (!handler) {
    const error = `No handler registered for event type: ${event.type}`;
    logger.error(error, { eventId: event.id, type: event.type });
    await markEventFailed(event.id, error);
    throw new Error(error);
  }

  try {
    await markEventRunning(event.id);

    logger.info('Executing event handler', {
      eventId: event.id,
      type: event.type,
      retryCount: event.retryCount,
    });

    const result = await handler(event);

    await markEventComplete(event.id, result);

    logger.info('Event completed', {
      eventId: event.id,
      type: event.type,
    });
  } catch (error: any) {
    logger.error('Event handler failed', {
      eventId: event.id,
      type: event.type,
      error: error.message,
      stack: error.stack,
    });

    await markEventFailed(event.id, error.message);

    // Attempt self-healing if enabled
    if (event.retryCount < 3) {
      await attemptSelfHealing(event, error);
    }

    throw error;
  }
}

/**
 * Attempt self-healing for failed events
 */
async function attemptSelfHealing(event: EventRecord, error: any): Promise<void> {
  try {
    const { attemptSelfHealing: selfHeal } = await import('./self-healing');
    const healingResult = await selfHeal(event, error);

    if (healingResult.success && healingResult.fix) {
      logger.info('Self-healing successful', {
        eventId: event.id,
        fix: healingResult.fix,
      });

      // Note: healEvent function not yet implemented in store
      // The healing logic here is for future implementation
    }
  } catch (healingError: any) {
    logger.warn('Self-healing failed', {
      eventId: event.id,
      error: healingError.message,
    });
  }
}

/**
 * Process all pending events
 */
export async function processPendingEvents(limit: number = 10): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}> {
  const { getPendingEvents } = await import('./store');
  const events = await getPendingEvents(limit);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const event of events) {
    try {
      await routeEvent(event);
      processed++;
      succeeded++;
    } catch (error: any) {
      processed++;
      failed++;
    }
  }

  return { processed, succeeded, failed, skipped };
}

/**
 * Start event processor loop
 */
export function startEventProcessor(intervalMs: number = 5000): NodeJS.Timeout {
  logger.info('Starting event processor', { intervalMs });

  const timer = setInterval(() => {
    processPendingEvents().catch(console.error);
  }, intervalMs);

  return timer;
}

/**
 * Stop event processor
 */
export function stopEventProcessor(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  logger.info('Event processor stopped');
}

/**
 * Cancel event by ID
 */
export async function cancelEvent(eventId: string, reason?: string): Promise<void> {
  await markEventCancelled(eventId);
  logger.info('Event cancelled', { eventId, reason });
}

/**
 * Retry event by ID
 */
export async function retryEvent(eventId: string): Promise<void> {
  const { getEventById } = await import('./store');
  const event = await getEventById(eventId);

  if (!event) {
    throw new Error(`Event not found: ${eventId}`);
  }

  if (event.status !== 'failed') {
    throw new Error(`Event is not failed: ${event.status}`);
  }

  const db = require('@/lib/database/connection').getDatabase();
  db.prepare(`
    UPDATE events
    SET status = 'pending', error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(eventId);

  logger.info('Event retry initiated', { eventId });
}

/**
 * Get event processing statistics
 */
export async function getProcessingStats(): Promise<{
  registered_handlers: number;
  pending_events: number;
  running_events: number;
  failed_events: number;
}> {
  const { getEventStats } = await import('./store');
  const stats = await getEventStats();

  return {
    registered_handlers: handlers.size,
    pending_events: stats.pending,
    running_events: stats.running,
    failed_events: stats.failed,
  };
}

// Export store functions for convenience
export { replayFailedEvents } from './store';
