/**
 * Events Stream API - Server-Sent Events for real-time updates
 *
 * Provides real-time event streaming to clients via SSE.
 * Clients can subscribe to event updates and receive them instantly.
 *
 * @module api/events/stream
 */

import { NextRequest } from 'next/server';


import { auth0 } from '@/lib/auth0';
import { getDatabase } from '@/lib/database/connection';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:EventsStream');

// Store for SSE connections
const sseConnections = new Map<string, any[]>();

/**
 * GET /api/events/stream - Server-Sent Events stream
 *
 * Query parameters:
 * - types: Comma-separated list of event types to filter (optional)
 * - statuses: Comma-separated list of statuses to filter (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userId = session.user.sub;
    const { searchParams } = new URL(request.url);
    const types = searchParams.get('types')?.split(',') || [];
    const statuses = searchParams.get('statuses')?.split(',') || [];

    // Create SSE stream
    const encoder = new TextEncoder();
    let lastEventTimestamp = '';

    const stream = new ReadableStream({
      async start(controller) {
        // Send connection established message
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`));

        // Store connection for broadcasting
        const connection = { controller, userId, types, statuses, lastEventTimestamp };
        const userConnections = sseConnections.get(userId) || [];
        userConnections.push(connection);
        sseConnections.set(userId, userConnections);

        logger.info('SSE connection established', { userId, types, statuses });

        // Send initial events
        try {
          const db = getDatabase();
          let query = 'SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC LIMIT 50';
          const rows = db.prepare(query).all(userId) as any[];

          for (const row of rows.reverse()) {
            // Safely parse payload with error handling
            let parsedPayload: any;
            try {
              parsedPayload = JSON.parse(row.payload);
            } catch {
              logger.warn('Skipping event with invalid payload', { eventId: row.id });
              continue; // Skip this event but continue with others
            }

            const event = {
              ...row,
              payload: parsedPayload,
            };

            // Apply filters
            if (types.length > 0 && !types.includes(event.type)) continue;
            if (statuses.length > 0 && !statuses.includes(event.status)) continue;

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'event', event })}\n\n`)
            );

            // Update cursor to last event's timestamp
            lastEventTimestamp = row.created_at;
          }
        } catch (error: any) {
          logger.error('Failed to send initial events', { error: error.message });
        }

        // Poll for new events every 2 seconds
        const pollInterval = setInterval(async () => {
          try {
            const db = getDatabase();
            let query = 'SELECT * FROM events WHERE user_id = ? AND created_at > ? ORDER BY created_at ASC';

            const since = lastEventTimestamp || new Date(0).toISOString();
            const rows = db.prepare(query).all(userId, since) as any[];

            for (const row of rows) {
              // Safely parse payload with error handling
              let parsedPayload: any;
              try {
                parsedPayload = JSON.parse(row.payload);
              } catch {
                logger.warn('Skipping event with invalid payload', { eventId: row.id });
                // Still update cursor to avoid re-processing corrupt event
                lastEventTimestamp = row.created_at;
                continue;
              }

              const event = {
                ...row,
                payload: parsedPayload,
              };

              // Apply filters
              if (types.length > 0 && !types.includes(event.type)) continue;
              if (statuses.length > 0 && !statuses.includes(event.status)) continue;

              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'event', event })}\n\n`)
              );

              // Update cursor from actual event timestamp, not wall-clock time
              lastEventTimestamp = row.created_at;
            }
          } catch (error: any) {
            logger.error('Polling error', { error: error.message });
          }
        }, 2000);

        // Cleanup on close
        request.signal.addEventListener('abort', () => {
          clearInterval(pollInterval);
          const userConnections = sseConnections.get(userId) || [];
          const index = userConnections.indexOf(connection);
          if (index > -1) {
            userConnections.splice(index, 1);
          }
          sseConnections.set(userId, userConnections);
          logger.info('SSE connection closed', { userId });
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: any) {
    // Log detailed error server-side, return generic message to client
    logger.error('SSE stream error', { error: error.message });
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * Broadcast event to all SSE connections
 */
function broadcastEvent(userId: string, event: any): void {
  const userConnections = sseConnections.get(userId) || [];
  const encoder = new TextEncoder();
  const deadConnections: typeof userConnections = [];

  for (const connection of userConnections) {
    // Apply filters
    if (connection.types.length > 0 && !connection.types.includes(event.type)) continue;
    if (connection.statuses.length > 0 && !connection.statuses.includes(event.status)) continue;

    try {
      connection.controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'event', event })}\n\n`)
      );
    } catch (error: any) {
      logger.error('Failed to broadcast event, removing dead connection', { error: error.message });
      // Mark connection as dead for cleanup
      deadConnections.push(connection);
    }
  }

  // Remove dead connections to prevent repeated failures
  if (deadConnections.length > 0) {
    const remaining = userConnections.filter(c => !deadConnections.includes(c));
    sseConnections.set(userId, remaining);
    logger.debug('Removed dead SSE connections', { count: deadConnections.length });
  }
}

/**
 * POST /api/events/stream/broadcast - Broadcast event to SSE clients
 *
 * For internal use to broadcast events to connected clients.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await request.json();
    const { event } = body;

    if (!event) {
      return new Response('Event required', { status: 400 });
    }

    broadcastEvent(session.user.sub, event);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    // Log detailed error server-side, return generic message to client
    logger.error('Broadcast error', { error: error.message });
    return new Response('Internal Server Error', { status: 500 });
  }
}
