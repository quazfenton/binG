import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { verifyAuth } from '@/lib/auth/jwt';

export async function POST(req: NextRequest) {
  try {
    // CRITICAL: Authenticate user from JWT token - do NOT trust userId from request body
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Use authenticated userId from token, ignore body userId
    const authenticatedUserId = authResult.userId;

    const body = await req.json();

    const existing = sandboxBridge.getSessionByUserId(authenticatedUserId);
    if (existing) {
      return NextResponse.json({ session: existing });
    }

    const session = await sandboxBridge.createWorkspace(authenticatedUserId, body.config);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error: any) {
    console.error('[Sandbox Session] Error:', error);
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    // CRITICAL: Authenticate user from JWT token
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Use authenticated userId from token
    const authenticatedUserId = authResult.userId;

    const session = sandboxBridge.getSessionByUserId(authenticatedUserId);
    if (!session) {
      return NextResponse.json({ error: 'No active session' }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error: any) {
    console.error('[Sandbox Session] Error:', error);
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // CRITICAL: Authenticate user from JWT token
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Use authenticated userId from token
    const authenticatedUserId = authResult.userId;

    const body = await req.json();
    const { sessionId, sandboxId } = body;

    if (!sessionId || !sandboxId) {
      return NextResponse.json({ error: 'sessionId and sandboxId are required' }, { status: 400 });
    }

    // Verify sandbox ownership - ensure the authenticated user owns this sandbox
    const userSession = sandboxBridge.getSessionByUserId(authenticatedUserId);
    if (!userSession || userSession.sandboxId !== sandboxId) {
      return NextResponse.json(
        { error: 'Unauthorized: sandbox does not belong to this user' },
        { status: 403 }
      );
    }

    await sandboxBridge.destroyWorkspace(sessionId, sandboxId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Sandbox Session] Error:', error);
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}
