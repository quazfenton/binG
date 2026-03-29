/**
 * Events API - Event management endpoints
 *
 * Provides REST API for:
 * - Listing events
 * - Emitting new events
 * - Replaying failed events
 * - Getting event statistics
 *
 * @module api/events
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { emitEvent } from '@/lib/events/bus';
import {
  getEventsByUser,
  getEventById,
  getEventStats,
  replayFailedEvents,
  purgeOldEvents,
  AnyEvent,
} from '@/lib/events';

/**
 * GET /api/events - List user events
 *
 * Query parameters:
 * - limit: Maximum number of events to return (default: 50)
 * - status: Filter by status (pending/running/completed/failed/cancelled)
 * - sessionId: Filter by session ID
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status') as any;
    const sessionId = searchParams.get('sessionId');

    let events;

    if (status) {
      // Get events by status (admin only)
      const { getEventsByStatus } = await import('@/lib/events/store');
      events = await getEventsByStatus(status, limit);
    } else if (sessionId) {
      // Get events by session
      const { getEventsBySession } = await import('@/lib/events/store');
      events = await getEventsBySession(sessionId, limit);
    } else {
      // Get events by user
      events = await getEventsByUser(session.user.sub, limit);
    }

    return NextResponse.json({
      success: true,
      events,
      count: events.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || 'Failed to get events',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/events - Emit new event
 *
 * Body:
 * - event: The event to emit (must match event schema)
 * - sessionId: Optional session ID
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { event, sessionId } = body as { event: AnyEvent; sessionId?: string };

    if (!event) {
      return NextResponse.json({ error: 'Event required' }, { status: 400 });
    }

    // Validate event type
    if (!event.type) {
      return NextResponse.json({ error: 'Event type required' }, { status: 400 });
    }

    const result = await emitEvent(event, session.user.sub, sessionId);

    return NextResponse.json({
      success: true,
      eventId: result.eventId,
      status: result.status,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || 'Failed to emit event',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/events - Event management operations
 *
 * Query parameters:
 * - action: The action to perform (replay/purge)
 * - maxRetries: Maximum retries for replay (default: 3)
 * - olderThanDays: Days for purge (default: 7)
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'replay') {
      const maxRetries = parseInt(searchParams.get('maxRetries') || '3');
      const replayed = await replayFailedEvents(maxRetries);

      return NextResponse.json({
        success: true,
        replayed,
      });
    }

    if (action === 'purge') {
      const olderThanDays = parseInt(searchParams.get('olderThanDays') || '7');
      const purged = await purgeOldEvents(olderThanDays);

      return NextResponse.json({
        success: true,
        purged,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use: replay or purge' },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to manage events' },
      { status: 500 }
    );
  }
}
