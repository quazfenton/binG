/**
 * Event Worker Task — Trigger.dev v3
 *
 * Registered task that processes a single pending event from the event store.
 * Uses durable execution so event processing survives server restarts,
 * with automatic retries on failure.
 *
 * This task is invoked by the event bus when Trigger.dev is configured:
 *   emitEvent() → invokeTriggerTask('event-worker', { eventId }) → this task
 *
 * When Trigger.dev is NOT configured, events are processed locally
 * by the polling processor in lib/events/init.ts.
 */
import { task } from "@trigger.dev/sdk/v3";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Trigger:EventWorker");

export const eventWorkerTask = task({
  id: "event-worker",
  // Events should process quickly; if a handler takes longer,
  // the handler itself should use a separate long-running task.
  maxDuration: 300,
  // Retry with exponential backoff for transient failures
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, randomize: true },
  run: async (payload: { eventId: string; type?: string }) => {
    logger.info("[event-worker] Processing event", {
      eventId: payload.eventId,
      type: payload.type,
    });

    const { getEventById } = await import("@/lib/events/store");
    const event = await getEventById(payload.eventId);

    if (!event) {
      throw new Error(`Event ${payload.eventId} not found`);
    }

    if (event.status !== "pending") {
      return {
        eventId: payload.eventId,
        status: event.status,
        message: `Event already ${event.status}`,
      };
    }

    const { routeEvent } = await import("@/lib/events/router");
    await routeEvent(event);

    logger.info("[event-worker] Event processed successfully", {
      eventId: payload.eventId,
      type: event.type,
    });

    return {
      eventId: payload.eventId,
      status: "completed",
      type: event.type,
    };
  },
});
