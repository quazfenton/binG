/**
 * Event Worker
 *
 * Background worker that processes pending events.
 * Works in two modes:
 *
 * 1. **Trigger.dev mode** (when TRIGGER_API_KEY is set and @trigger.dev/sdk/v3 is available):
 *    - Exports a `task()` that processes a single event
 *    - Trigger.dev invokes it via `invoke('event-worker', { eventId })`
 *    - Durable execution with automatic retry on failure
 *
 * 2. **Local polling mode** (fallback):
 *    - Polls the SQLite event store for pending events
 *    - Processes them in batches via the local event router
 *    - Started by `startEventProcessing()` in init.ts
 *
 * In production with Trigger.dev configured, the local polling is disabled
 * and events are dispatched directly to the Trigger.dev worker.
 */

import { getPendingEvents, markEventRunning, getEventById } from '../store';
import { routeEvent } from '../router';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:Worker');

const POLL_INTERVAL = 10000; // 10 seconds
const BATCH_SIZE = 5;

/**
 * Process a batch of pending events
 */
async function processBatch(): Promise<void> {
  logger.debug('Checking for pending events...');

  const events = await getPendingEvents(BATCH_SIZE);

  if (events.length === 0) {
    return;
  }

  logger.info(`Processing ${events.length} events`);

  for (const event of events) {
    try {
      // Mark as running
      await markEventRunning(event.id);

      // Route to handler
      await routeEvent(event);

      logger.info(`Event ${event.id} completed`);
    } catch (error: any) {
      logger.error(`Event ${event.id} failed:`, { error: error.message });
      // Error is already logged in routeEvent
    }
  }
}

/**
 * Start the event worker (local polling mode)
 */
export function startEventWorker(): NodeJS.Timeout {
  logger.info('Starting local event worker', { pollIntervalMs: POLL_INTERVAL });

  // Process immediately on start
  processBatch().catch(err => logger.error('Initial batch error:', err));

  const timer = setInterval(async () => {
    try {
      await processBatch();
    } catch (error: any) {
      logger.error('Batch error:', { error: error.message });
    }
  }, POLL_INTERVAL);

  return timer;
}

/**
 * Process a single event by ID (used by Trigger.dev task or manual trigger)
 */
export async function processEvent(eventId: string): Promise<void> {
  const event = await getEventById(eventId);

  if (!event) {
    throw new Error(`Event ${eventId} not found`);
  }

  if (event.status !== 'pending') {
    throw new Error(`Event ${eventId} is not pending (status: ${event.status})`);
  }

  await markEventRunning(event.id);
  await routeEvent(event);

  logger.info(`Event ${eventId} processed successfully`);
}

/**
 * Trigger.dev v3 task definition
 * When Trigger.dev SDK is available, this task is registered and invoked
 * by the event bus for each emitted event.
 *
 * To register this task in your Trigger.dev project, add to trigger.config.ts:
 *
 * ```typescript
 * import { defineConfig } from "@trigger.dev/sdk/v3";
 *
 * export default defineConfig({
 *   project: "your-project-id",
 *   dirs: ["./web/lib/events/trigger"],
 * });
 * ```
 */
export const eventWorker = {
  id: 'event-worker',
  name: 'Event Worker',
  description: 'Process a single pending event with durable execution',

  /**
   * Execute the event worker.
   * Called by Trigger.dev when an event is dispatched, or can be called directly.
   */
  async run(payload: { eventId: string }): Promise<{ eventId: string; status: string }> {
    await processEvent(payload.eventId);
    return { eventId: payload.eventId, status: 'completed' };
  },
};

// Start worker if run directly (local polling mode)
if (require.main === module) {
  const timer = startEventWorker();
  logger.info('Event worker started directly (local polling mode)');

  // Cleanup on process exit
  process.on('SIGINT', () => { clearInterval(timer); process.exit(0); });
  process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });
}

export { processBatch, POLL_INTERVAL, BATCH_SIZE };
