/**
 * Events API - Extended with observability and approvals
 *
 * Additional endpoints for:
 * - Event statistics and metrics
 * - Approval management
 * - DAG execution
 * - Observability dashboard
 *
 * @module api/events
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { emitEvent } from '@/lib/events/bus';
import {
  getEventsByUser,
  getEventStats,
  replayFailedEvents,
  AnyEvent,
} from '@/lib/events';

/**
 * GET /api/events - List user events (already implemented)
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
      const { getEventsByStatus } = await import('@/lib/events/store');
      events = await getEventsByStatus(status, limit);
    } else if (sessionId) {
      const { getEventsBySession } = await import('@/lib/events/store');
      events = await getEventsBySession(sessionId, limit);
    } else {
      events = await getEventsByUser(session.user.sub, limit);
    }

    return NextResponse.json({
      success: true,
      events,
      count: events.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get events' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/events - Emit new event (already implemented)
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

    const result = await emitEvent(event, session.user.sub, sessionId);

    return NextResponse.json({
      success: true,
      eventId: result.eventId,
      status: result.status,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to emit event' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/events/stats - Get event statistics
 */
export async function GET_STATS(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const stats = await getEventStats();
    const processingStats = await getProcessingStats();

    return NextResponse.json({
      success: true,
      stats: {
        ...stats,
        ...processingStats,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get statistics' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/events/approvals - Get pending approvals
 */
export async function GET_APPROVALS(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { getPendingApprovals } = await import('@/lib/events/human-in-loop');
    const approvals = await getPendingApprovals(session.user.sub);

    return NextResponse.json({
      success: true,
      approvals,
      count: approvals.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get approvals' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/events/approvals/:id/respond - Respond to approval
 */
export async function POST_APPROVAL_RESPOND(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { approved, response } = body;

    const { respondToApproval } = await import('@/lib/events/human-in-loop');
    await respondToApproval(params.id, approved, response, session.user.sub);

    return NextResponse.json({
      success: true,
      message: 'Approval response recorded',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to respond to approval' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/events/dag/execute - Execute DAG workflow
 */
export async function POST_DAG(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { dag, sessionId } = body;

    if (!dag || !dag.nodes) {
      return NextResponse.json({ error: 'DAG with nodes required' }, { status: 400 });
    }

    // Validate DAG
    const { validateDAG } = await import('@/lib/events/handlers/dag-execution');
    const validation = validateDAG(dag);

    if (!validation.valid) {
      return NextResponse.json({
        error: 'Invalid DAG',
        details: validation.errors,
      }, { status: 400 });
    }

    // Emit DAG execution event
    const result = await emitEvent(
      {
        type: 'DAG_EXECUTION',
        dag,
        agentId: session.user.sub,
        sessionId: sessionId || crypto.randomUUID(),
      },
      session.user.sub,
      sessionId
    );

    return NextResponse.json({
      success: true,
      eventId: result.eventId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to execute DAG' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/events/dashboard - Observability dashboard data
 */
export async function GET_DASHBOARD(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const [eventStats, processingStats, approvalStats] = await Promise.all([
      getEventStats(),
      getProcessingStats(),
      (async () => {
        try {
          const { getApprovalStats } = await import('@/lib/events/human-in-loop');
          return await getApprovalStats();
        } catch {
          return { pending: 0, approved: 0, rejected: 0, expired: 0 };
        }
      })(),
    ]);

    // Get recent events
    const recentEvents = await getEventsByUser(session.user.sub, 10);

    // Get registered handlers
    const { getRegisteredHandlers } = await import('@/lib/events/router');
    const registeredHandlers = getRegisteredHandlers();

    return NextResponse.json({
      success: true,
      dashboard: {
        events: eventStats,
        processing: processingStats,
        approvals: approvalStats,
        recentEvents: recentEvents.map((e) => ({
          id: e.id,
          type: e.type,
          status: e.status,
          createdAt: e.createdAt,
        })),
        registeredHandlers,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get dashboard data' },
      { status: 500 }
    );
  }
}

// Helper function for processing stats
async function getProcessingStats(): Promise<any> {
  try {
    const { getProcessingStats } = await import('@/lib/events/router');
    return await getProcessingStats();
  } catch {
    return { registered_handlers: 0, pending_events: 0, running_events: 0, failed_events: 0 };
  }
}
