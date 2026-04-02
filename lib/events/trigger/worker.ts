/**
 * Event Worker
 * 
 * Background worker that processes pending events.
 * Based on trigger.md design - polls for pending events and routes them to handlers.
 * 
 * In production, this would run as a separate service or be integrated with trigger.dev.
 */

import { getPendingEvents, markEventRunning } from '../store';
import { routeEvent } from '../router';

const POLL_INTERVAL = 10000; // 10 seconds
const BATCH_SIZE = 5;

/**
 * Process a batch of pending events
 */
async function processBatch(): Promise<void> {
  console.log('[EventWorker] Checking for pending events...');
  
  const events = await getPendingEvents(BATCH_SIZE);
  
  if (events.length === 0) {
    console.log('[EventWorker] No pending events');
    return;
  }
  
  console.log(`[EventWorker] Processing ${events.length} events`);
  
  for (const event of events) {
    try {
      // Mark as processing
      await markEventRunning(event.id);
      
      // Route to handler
      await routeEvent(event);
      
      console.log(`[EventWorker] Event ${event.id} completed`);
    } catch (error: any) {
      console.error(`[EventWorker] Event ${event.id} failed:`, error.message);
      // Error is already logged in routeEvent
    }
  }
}

/**
 * Start the event worker
 */
export function startEventWorker(): void {
  console.log('[EventWorker] Starting event worker...');
  
  setInterval(async () => {
    try {
      await processBatch();
    } catch (error: any) {
      console.error('[EventWorker] Batch error:', error.message);
    }
  }, POLL_INTERVAL);
  
  console.log(`[EventWorker] Worker started, polling every ${POLL_INTERVAL / 1000}s`);
}

/**
 * Process a single event (for testing/manual trigger)
 */
export async function processEvent(eventId: string): Promise<void> {
  const events = await getPendingEvents(100);
  const event = events.find(e => e.id === eventId);
  
  if (!event) {
    throw new Error(`Event ${eventId} not found or not pending`);
  }
  
  await markEventRunning(event.id);
  await routeEvent(event);
}

// Start worker if run directly
if (require.main === module) {
  startEventWorker();
}

export { processBatch, POLL_INTERVAL, BATCH_SIZE };