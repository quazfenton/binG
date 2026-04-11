/**
 * Sandbox Daemon Management API
 *
 * POST /api/sandbox/daemon - Start a background daemon process
 * DELETE /api/sandbox/daemon - Stop a daemon
 * GET /api/sandbox/daemon - List daemons or get daemon logs
 */

import { NextRequest, NextResponse } from 'next/server'
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge'
import { verifyAuth } from '@/lib/auth/jwt'
import { checkUserRateLimit } from '@/lib/middleware/rate-limiter'
import { z } from 'zod'

export const runtime = 'nodejs'

const startDaemonSchema = z.object({
  sandboxId: z.string().min(1),
  sessionId: z.string().min(1),
  command: z.string().min(1).max(500),
  port: z.number().optional(),
})

const stopDaemonSchema = z.object({
  sandboxId: z.string().min(1),
  sessionId: z.string().min(1),
  daemonId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    const rateLimitResult = checkUserRateLimit(authResult.userId, 'generic');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded.', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: rateLimitResult.headers }
      );
    }

    const body = await req.json();
    const parseResult = startDaemonSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.errors[0].message },
        { status: 400 }
      );
    }

    const { sandboxId, sessionId, command, port } = parseResult.data;

    // Verify ownership
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession || userSession.sandboxId !== sandboxId) {
      return NextResponse.json(
        { error: 'Unauthorized: sandbox does not belong to this user' },
        { status: 403 }
      );
    }

    const daemon = await sandboxBridge.startDaemon(sandboxId, sessionId, command, port ? { port } : undefined);
    return NextResponse.json({ success: true, daemon }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to start daemon' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const sandboxId = url.searchParams.get('sandboxId');
    const sessionId = url.searchParams.get('sessionId');
    const daemonId = url.searchParams.get('daemonId');

    if (!sandboxId || !sessionId || !daemonId) {
      return NextResponse.json(
        { error: 'sandboxId, sessionId, and daemonId query params are required' },
        { status: 400 }
      );
    }

    await sandboxBridge.stopDaemon(sandboxId, sessionId, daemonId);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const sandboxId = url.searchParams.get('sandboxId');
    const sessionId = url.searchParams.get('sessionId');
    const daemonId = url.searchParams.get('daemonId');
    const tailLines = url.searchParams.get('tailLines');

    if (!sandboxId || !sessionId) {
      return NextResponse.json(
        { error: 'sandboxId and sessionId query params are required' },
        { status: 400 }
      );
    }

    // Get logs for a specific daemon
    if (daemonId) {
      const logs = await sandboxBridge.getDaemonLogs(sandboxId, daemonId, tailLines ? parseInt(tailLines, 10) : undefined);
      return NextResponse.json({ success: true, logs });
    }

    // List all daemons for session
    const daemons = await sandboxBridge.listDaemons(sandboxId, sessionId);
    return NextResponse.json({ success: true, daemons });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
