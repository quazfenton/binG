/**
 * Desktop Recording API — /api/desktop/:id/recording/:subAction
 *
 * Provides REST API for starting, stopping, pausing, and monitoring
 * desktop session recordings using the E2B Desktop Recorder.
 *
 * SECURITY: All endpoints require authentication and enforce ownership verification
 * to prevent IDOR (Insecure Direct Object Reference) attacks.
 *
 * Endpoints:
 *   POST /api/desktop/:id/recording/start   — Start recording on a desktop
 *   POST /api/desktop/:id/recording/stop    — Stop recording and return session
 *   POST /api/desktop/:id/recording/pause   — Pause recording (keeps desktop alive)
 *   POST /api/desktop/:id/recording/resume  — Resume a paused recording
 *   POST /api/desktop/:id/recording/action  — Record an action on the desktop
 *   GET  /api/desktop/:id/recording/status  — Get current recorder state
 *   GET  /api/desktop/:id/recording/session — Get session data (without stopping)
 */

import { NextRequest, NextResponse } from 'next/server';

import { verifyToken } from '@/lib/security/jwt-auth';
import { activeDesktops } from '../../active-desktops';
import { summarizeSession } from '@/lib/computer/e2b-desktop-recorder';
import {
  registerRecorder,
  unregisterRecorder,
  getRecorder,
  getRecorderConstructor,
} from '../../recording-store';

/**
 * Extract userId from request authorization header.
 */
async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  try {
    const result = await verifyToken(match[1]);
    if (result.valid && result.payload) {
      return result.payload.userId;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Verify user owns both the desktop handle and the recorder.
 */
function verifyOwnership(desktopId: string, userId: string): { ok: boolean; error?: string; status?: number } {
  const desktopEntry = activeDesktops.get(desktopId);
  if (!desktopEntry) {
    return { ok: false, error: 'Desktop not found or expired', status: 404 };
  }
  if (desktopEntry.userId !== userId) {
    return { ok: false, error: 'Access denied: You do not own this desktop session', status: 403 };
  }
  return { ok: true };
}

// ─── SUB-ACTION DISPATCH ────────────────────────────────────────────────────

type SubAction = 'start' | 'stop' | 'pause' | 'resume' | 'action' | 'status' | 'session';

async function handleSubAction(
  subAction: SubAction,
  desktopId: string,
  userId: string,
  body: any,
): Promise<NextResponse> {
  const desktopEntry = activeDesktops.get(desktopId);
  if (!desktopEntry) {
    return NextResponse.json(
      { success: false, error: 'Desktop not found or expired' },
      { status: 404 },
    );
  }

  desktopEntry.lastUsed = Date.now();
  const desktop = desktopEntry.desktop;

  switch (subAction) {
    // ── START ─────────────────────────────────────────────────────────────
    case 'start': {
      // Check if already recording
      const existing = getRecorder(desktopId);
      if (existing) {
        return NextResponse.json(
          { success: false, error: 'Recording is already active for this desktop' },
          { status: 409 },
        );
      }

      try {
        const RecorderClass = await getRecorderConstructor();
        const fps = body?.fps ?? 2;
        const recorder = new RecorderClass(desktop, {
          fps,
          captureOnAction: body?.captureOnAction ?? true,
          label: body?.label ?? undefined,
          resolution: body?.resolution ?? undefined,
        });

        const sessionId = await recorder.start();
        registerRecorder(recorder, desktopId, userId);

        return NextResponse.json({
          success: true,
          data: {
            sessionId,
            desktopId,
            startedAt: Date.now(),
            fps,
          },
        });
      } catch (error: any) {
        console.error('[Desktop Recording] Start error:', error);
        return NextResponse.json(
          { success: false, error: error.message || 'Failed to start recording' },
          { status: 500 },
        );
      }
    }

    // ── STOP ──────────────────────────────────────────────────────────────
    case 'stop': {
      const entry = getRecorder(desktopId);
      if (!entry) {
        return NextResponse.json(
          { success: false, error: 'No active recording for this desktop' },
          { status: 404 },
        );
      }

      try {
        const session = await entry.recorder.stop();
        unregisterRecorder(desktopId);

        // Include a human-readable session summary
        const summary = summarizeSession(session);

        return NextResponse.json({
          success: true,
          data: {
            session,
            summary,
          },
        });
      } catch (error: any) {
        console.error('[Desktop Recording] Stop error:', error);
        // Ensure cleanup even on error
        unregisterRecorder(desktopId);
        return NextResponse.json(
          { success: false, error: error.message || 'Failed to stop recording' },
          { status: 500 },
        );
      }
    }

    // ── PAUSE ─────────────────────────────────────────────────────────────
    case 'pause': {
      const entry = getRecorder(desktopId);
      if (!entry) {
        return NextResponse.json(
          { success: false, error: 'No active recording for this desktop' },
          { status: 404 },
        );
      }

      try {
        entry.recorder.pause();
        return NextResponse.json({
          success: true,
          data: { status: 'paused', desktopId },
        });
      } catch (error: any) {
        console.error('[Desktop Recording] Pause error:', error);
        return NextResponse.json(
          { success: false, error: error.message || 'Failed to pause recording' },
          { status: 500 },
        );
      }
    }

    // ── RESUME ────────────────────────────────────────────────────────────
    case 'resume': {
      const entry = getRecorder(desktopId);
      if (!entry) {
        return NextResponse.json(
          { success: false, error: 'No active recording for this desktop' },
          { status: 404 },
        );
      }

      try {
        entry.recorder.resume();
        return NextResponse.json({
          success: true,
          data: { status: 'running', desktopId },
        });
      } catch (error: any) {
        console.error('[Desktop Recording] Resume error:', error);
        return NextResponse.json(
          { success: false, error: error.message || 'Failed to resume recording' },
          { status: 500 },
        );
      }
    }

    // ── RECORD ACTION ─────────────────────────────────────────────────────
    case 'action': {
      const entry = getRecorder(desktopId);
      if (!entry) {
        return NextResponse.json(
          { success: false, error: 'No active recording for this desktop' },
          { status: 404 },
        );
      }

      const desktopAction = body?.action;
      if (!desktopAction) {
        return NextResponse.json(
          { success: false, error: 'Request body must include an "action" field' },
          { status: 400 },
        );
      }

      try {
        const recordedAction = await entry.recorder.recordAction(desktopAction, {
          result: body?.result,
          success: body?.success,
        });
        return NextResponse.json({
          success: true,
          data: recordedAction,
        });
      } catch (error: any) {
        console.error('[Desktop Recording] Record action error:', error);
        return NextResponse.json(
          { success: false, error: error.message || 'Failed to record action' },
          { status: 500 },
        );
      }
    }

    // ── STATUS ────────────────────────────────────────────────────────────
    case 'status': {
      const entry = getRecorder(desktopId);
      if (!entry) {
        return NextResponse.json({
          success: true,
          data: {
            active: false,
            desktopId,
          },
        });
      }

      const state = entry.recorder.getState();
      return NextResponse.json({
        success: true,
        data: {
          active: state.running,
          paused: state.paused,
          startedAt: state.startedAt,
          framesCaptured: state.framesCaptured,
          actionsRecorded: state.actionsRecorded,
          elapsedMs: state.elapsedMs,
          sessionId: entry.recorder.getSessionId(),
          desktopId,
        },
      });
    }

    // ── GET SESSION (without stopping) ────────────────────────────────────
    case 'session': {
      const entry = getRecorder(desktopId);
      if (!entry) {
        return NextResponse.json(
          { success: false, error: 'No active recording for this desktop' },
          { status: 404 },
        );
      }

      try {
        const currentSession = entry.recorder.getCurrentSession();
        return NextResponse.json({
          success: true,
          data: currentSession,
        });
      } catch (error: any) {
        console.error('[Desktop Recording] Get session error:', error);
        return NextResponse.json(
          { success: false, error: error.message || 'Failed to get session' },
          { status: 500 },
        );
      }
    }

    default:
      return NextResponse.json(
        { success: false, error: `Unknown recording sub-action: ${subAction}` },
        { status: 400 },
      );
  }
}

// ─── EXPORTED HANDLERS ──────────────────────────────────────────────────────

/**
 * POST /api/desktop/:id/recording/:subAction
 *
 * Sub-actions: start, stop, pause, resume, action
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subAction: string }> },
) {
  try {
    const { id: desktopId, subAction } = await params;

    // Require authentication
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 },
      );
    }

    // Verify ownership of the desktop
    const ownership = verifyOwnership(desktopId, userId);
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.error },
        { status: ownership.status ?? 403 },
      );
    }

    const body = await request.json().catch(() => ({}));

    // Validate subAction
    const validPostActions: SubAction[] = ['start', 'stop', 'pause', 'resume', 'action'];
    if (!validPostActions.includes(subAction as SubAction)) {
      return NextResponse.json(
        { success: false, error: `Invalid recording sub-action: ${subAction}. Valid: ${validPostActions.join(', ')}` },
        { status: 400 },
      );
    }

    return handleSubAction(subAction as SubAction, desktopId, userId, body);
  } catch (error: any) {
    console.error('[Desktop Recording] POST error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/desktop/:id/recording/:subAction
 *
 * Sub-actions: status, session
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subAction: string }> },
) {
  try {
    const { id: desktopId, subAction } = await params;

    // Require authentication
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 },
      );
    }

    // Verify ownership of the desktop
    const ownership = verifyOwnership(desktopId, userId);
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.error },
        { status: ownership.status ?? 403 },
      );
    }

    // Validate subAction
    const validGetActions: SubAction[] = ['status', 'session'];
    if (!validGetActions.includes(subAction as SubAction)) {
      return NextResponse.json(
        { success: false, error: `Invalid recording sub-action: ${subAction}. Valid: ${validGetActions.join(', ')}` },
        { status: 400 },
      );
    }

    return handleSubAction(subAction as SubAction, desktopId, userId, {});
  } catch (error: any) {
    console.error('[Desktop Recording] GET error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 },
    );
  }
}
