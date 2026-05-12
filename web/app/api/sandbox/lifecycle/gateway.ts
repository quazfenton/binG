/**
 * Sandbox Lifecycle API
 *
 * POST /api/sandbox/lifecycle - Cleanup, suspend, or resume a sandbox session
 *
 * Body actions:
 * - { action: 'cleanup', sessionId, sandboxId } - Destroy sandbox and clear session (disconnect cleanup)
 * - { action: 'suspend', sandboxId, reason? } - Suspend sandbox with state preservation
 * - { action: 'resume', sandboxId } - Resume suspended sandbox
 * - { action: 'verify', sandboxId } - Check if sandbox is still alive
 *
 * This endpoint is called by the frontend when:
 * - User disconnects from terminal/WebSocket
 * - User navigates away from sandbox page
 * - Idle timeout is reached
 */

import { NextRequest, NextResponse } from 'next/server'
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge'
import { verifyAuth } from '@/lib/auth/jwt'
import { checkUserRateLimit } from '@/lib/middleware/rate-limiter'
import { z } from 'zod'

export const runtime = 'nodejs'

const lifecycleSchema = z.object({
  action: z.enum(['cleanup', 'suspend', 'resume', 'verify']),
  sessionId: z.string().optional(),
  sandboxId: z.string().optional(),
  reason: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
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
    const parseResult = lifecycleSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.errors[0].message },
        { status: 400 }
      );
    }

    const { action, sessionId, sandboxId, reason } = parseResult.data;

    // Verify ownership for all actions
    if (sandboxId) {
      const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
      if (!userSession || userSession.sandboxId !== sandboxId) {
        return NextResponse.json(
          { error: 'Unauthorized: sandbox does not belong to this user' },
          { status: 403 }
        );
      }
    }

    switch (action) {
      case 'cleanup':
        if (!sessionId || !sandboxId) {
          return NextResponse.json(
            { error: 'sessionId and sandboxId are required for cleanup' },
            { status: 400 }
          );
        }
        await sandboxBridge.cleanupSession(sessionId, sandboxId);
        return NextResponse.json({ success: true, action: 'cleanup' });

      case 'suspend':
        if (!sandboxId) {
          return NextResponse.json(
            { error: 'sandboxId is required for suspend' },
            { status: 400 }
          );
        }
        const suspended = await sandboxBridge.suspendSession(sandboxId, reason || 'idle');
        return NextResponse.json({ success: suspended, action: 'suspend', sandboxId });

      case 'resume':
        if (!sandboxId) {
          return NextResponse.json(
            { error: 'sandboxId is required for resume' },
            { status: 400 }
          );
        }
        const resumed = await sandboxBridge.resumeSession(sandboxId);
        return NextResponse.json({ success: resumed, action: 'resume', sandboxId });

      case 'verify':
        if (!sandboxId) {
          return NextResponse.json(
            { error: 'sandboxId is required for verify' },
            { status: 400 }
          );
        }
        const alive = await sandboxBridge.verifySandboxAlive(sandboxId);
        return NextResponse.json({ alive, sandboxId });

      default:
        return NextResponse.json(
          { error: 'Unknown action' },
          { status: 400 }
        );
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Lifecycle action failed' },
      { status: 500 }
    );
  }
}
