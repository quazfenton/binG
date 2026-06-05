/**
 * GET /api/terminal/previews/events — Server-Sent Events stream
 *
 * Streams workspacePreviewRegistry events as SSE so the dashboard UI
 * can receive live preview updates without polling or WebSockets.
 *
 * Query params:
 *   workspaceId  — filter events to a specific workspace (optional)
 *
 * Events streamed:
 *   preview:initial   — initial snapshot of all previews
 *   preview:registered — new preview detected
 *   preview:updated    — status change (including stale)
 *   preview:removed    — preview deleted
 *   workspace:cleared  — all previews for a workspace cleared
 *
 * @see lib/terminal/workspace-preview-registry.ts — Event source
 * @see lib/terminal/ws-preview-broadcaster.ts — WebSocket alternative
 */

import { NextRequest } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { workspacePreviewRegistry } from '@/lib/terminal/workspace-preview-registry';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('PreviewEventsSSE');

/** Maximum SSE connection duration before forced reconnection (minutes) */
const MAX_CONNECTION_MINUTES = 30;
/** Heartbeat interval in ms */
const HEARTBEAT_MS = 30_000;

// ============================================================================
// SSE helpers
// ============================================================================

const encoder = new TextEncoder();

function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function heartbeat(): string {
  return ': heartbeat\n\n';
}

// ============================================================================
// GET handler
// ============================================================================

export async function GET(req: NextRequest) {
  // Require authentication
  const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
  if (!authResult.success || !authResult.userId) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const workspaceId = req.nextUrl.searchParams.get('workspaceId') || undefined;

  logger.info('SSE preview stream connected', {
    userId: authResult.userId,
    workspaceId: workspaceId || 'all',
  });

  // Forced close after MAX_CONNECTION_MINUTES to prevent stale connections
  let forcedCloseTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let cleanedUp = false;
  let cleanupFn: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // ── Event handlers ──────────────────────────────────────────────

      const onRegistered = (preview: any) => {
        if (workspaceId && preview.workspaceId !== workspaceId) return;
        try {
          controller.enqueue(encoder.encode(formatSSE('preview:registered', preview)));
        } catch { /* stream closed */ }
      };

      const onUpdated = (preview: any) => {
        if (workspaceId && preview.workspaceId !== workspaceId) return;
        try {
          controller.enqueue(encoder.encode(formatSSE('preview:updated', preview)));
        } catch { /* stream closed */ }
      };

      const onRemoved = (data: any) => {
        if (workspaceId && data.workspaceId !== workspaceId) return;
        try {
          controller.enqueue(encoder.encode(formatSSE('preview:removed', data)));
        } catch { /* stream closed */ }
      };

      const onCleared = (data: any) => {
        if (workspaceId && data.workspaceId !== workspaceId) return;
        try {
          controller.enqueue(encoder.encode(formatSSE('workspace:cleared', data)));
        } catch { /* stream closed */ }
      };

      // ── Subscribe to registry ───────────────────────────────────────

      workspacePreviewRegistry.on('preview:registered', onRegistered);
      workspacePreviewRegistry.on('preview:updated', onUpdated);
      workspacePreviewRegistry.on('preview:removed', onRemoved);
      workspacePreviewRegistry.on('workspace:cleared', onCleared);

      // ── Send initial snapshot ───────────────────────────────────────

      if (workspaceId) {
        const fullPreviews = workspacePreviewRegistry.getWorkspacePreviews(workspaceId);
        try {
          controller.enqueue(encoder.encode(formatSSE('preview:initial', {
            workspaceId,
            previews: fullPreviews,
            activeCount: fullPreviews.filter(p => p.status === 'active').length,
            totalCount: fullPreviews.length,
          })));
        } catch { /* stream closed */ }
      } else {
        const stats = workspacePreviewRegistry.getStats();
        try {
          controller.enqueue(encoder.encode(formatSSE('preview:initial', {
            workspaceId: null,
            previews: [],
            stats,
          })));
        } catch { /* stream closed */ }
      }

      // ── Heartbeat ───────────────────────────────────────────────────

      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(heartbeat()));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, HEARTBEAT_MS);

      // ── Forced close after max duration ─────────────────────────────

      forcedCloseTimer = setTimeout(() => {
        logger.info('SSE preview stream max duration reached, closing', {
          workspaceId: workspaceId || 'all',
        });
        cleanupFn?.();
        try { controller.close(); } catch { /* already closed */ }
      }, MAX_CONNECTION_MINUTES * 60 * 1000);

      // ── Cleanup ─────────────────────────────────────────────────────

      cleanupFn = () => {
        if (cleanedUp) return;
        cleanedUp = true;

        workspacePreviewRegistry.off('preview:registered', onRegistered);
        workspacePreviewRegistry.off('preview:updated', onUpdated);
        workspacePreviewRegistry.off('preview:removed', onRemoved);
        workspacePreviewRegistry.off('workspace:cleared', onCleared);

        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (forcedCloseTimer) {
          clearTimeout(forcedCloseTimer);
          forcedCloseTimer = null;
        }
      };

      const cleanup = () => cleanupFn?.();

      // Cleanup on client disconnect
      req.signal.addEventListener('abort', () => {
        logger.info('SSE preview stream disconnected', {
          workspaceId: workspaceId || 'all',
        });
        cleanupFn?.();
      });
    },

    cancel() {
      cleanupFn?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
