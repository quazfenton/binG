'use client';

/**
 * Preview Toast — Live dashboard toast notifications for preview events.
 *
 * Connects to the preview event stream (via WebSocket or SSE) and shows toast
 * notifications when workspace previews are registered or become active.
 * Each toast displays the service name, preview URL, and a clickable
 * "Open Preview" action button.
 *
 * Transport modes:
 *   'websocket' — Connects to /ws/previews via usePreviewWebsocket (default)
 *   'sse'       — Connects to /api/terminal/previews/events via usePreviewSSE
 *
 * Selecting the transport:
 *   <PreviewToast transport="sse" workspaceId="..." />
 *   — or set NEXT_PUBLIC_PREVIEW_TRANSPORT=sse in your env (build-time)
 *
 * Integrates with sonner toast system and renders the Toaster itself,
 * so no additional setup is needed beyond adding <PreviewToast /> to the layout.
 *
 * Architecture:
 *   workspacePreviewRegistry.emit('preview:registered')
 *     → WsPreviewBroadcaster (WS) or SSE endpoint broadcasts
 *       → usePreviewWebsocket or usePreviewSSE hook
 *         → PreviewToast renders sonner toast with URL + service name
 */

import { useEffect, useRef, useCallback } from 'react';
import { ExternalLink, Globe, Server, X } from 'lucide-react';
import { toast } from 'sonner';
import { usePreviewWebsocket } from '@/hooks/use-preview-websocket';
import { usePreviewSSE } from '@/hooks/use-preview-sse';
import type { WorkspacePreview } from '@/lib/terminal/workspace-preview-registry';

// ============================================================================
// Props
// ============================================================================

export interface PreviewToastProps {
  /**
   * When provided, the component subscribes to this workspace on mount
   * and only shows toasts for previews in that workspace.
   * When omitted, toasts fire for all workspaces (backward compatible).
   */
  workspaceId?: string;

  /**
   * Transport protocol for receiving preview events.
   *   'websocket' — WebSocket to /ws/previews (default)
   *   'sse'       — Server-Sent Events over HTTP
   *
   * Falls back to the NEXT_PUBLIC_PREVIEW_TRANSPORT env var at build time
   * if the prop is not provided.
   */
  transport?: 'websocket' | 'sse';
}

// ============================================================================
// Constants
// ============================================================================

/** Avoid duplicate toasts for the same preview within this window (ms) */
const DEDUP_WINDOW_MS = 10_000;

/** Maximum number of preview toasts visible at once (prevents spam) */
const MAX_VISIBLE_TOASTS = 5;

/** Auto-dismiss duration for preview toasts (ms) */
const TOAST_DURATION_MS = 15_000;

// ============================================================================
// Inline Toast Content Component
// ============================================================================

interface PreviewToastContentProps {
  preview: WorkspacePreview;
  onDismiss: () => void;
}

function PreviewToastContent({ preview, onDismiss }: PreviewToastContentProps) {
  const handleOpen = useCallback(() => {
    window.open(preview.url, '_blank', 'noopener,noreferrer');
  }, [preview.url]);

  const statusLabel = preview.status === 'active'
    ? 'Live'
    : preview.status === 'starting'
    ? 'Starting'
    : preview.status;

  const statusColor = preview.status === 'active'
    ? 'text-emerald-400'
    : preview.status === 'starting'
    ? 'text-amber-400'
    : 'text-gray-400';

  return (
    <div className="flex flex-col gap-2 min-w-[280px] max-w-[400px]">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative flex-shrink-0">
            <Globe className="w-5 h-5 text-violet-400" />
            {preview.status === 'active' && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            )}
          </div>
          <div>
            <p className="font-semibold text-sm text-white leading-tight">
              {preview.serviceName}
            </p>
            {preview.framework && (
              <p className="text-[11px] text-white/50 leading-tight mt-0.5">
                {preview.framework}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 p-1 rounded-md hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
          aria-label="Dismiss notification"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* URL row */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 group cursor-pointer hover:bg-white/10 transition-colors"
        onClick={handleOpen}
      >
        <Server className="w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition-colors" />
        <p className="text-xs text-white/60 group-hover:text-white/90 transition-colors truncate font-mono">
          {preview.url}
        </p>
        <ExternalLink className="w-3.5 h-3.5 text-white/40 group-hover:text-violet-400 transition-colors flex-shrink-0 ml-auto" />
      </div>

      {/* Metadata footer */}
      <div className="flex items-center justify-between mt-0.5">
        <span className={`text-[11px] font-medium ${statusColor} flex items-center gap-1`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${
            preview.status === 'active' ? 'bg-emerald-400' :
            preview.status === 'starting' ? 'bg-amber-400 animate-pulse' :
            'bg-gray-400'
          }`} />
          {statusLabel} :{preview.port}
        </span>
        {preview.provider && (
          <span className="text-[10px] text-white/30 uppercase tracking-wider">
            {preview.provider}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Shared workspace subscription hook
// ============================================================================

/**
 * Subscribes to a workspace when connected, unsubscribes from the previous
 * workspace before subscribing to a new one (avoids subscription accumulation
 * on the server side).
 *
 * @param connected — Whether the transport is currently connected
 * @param workspaceId — The workspace to subscribe to (undefined = all)
 * @param subscribe — Transport subscribe function
 * @param unsubscribe — Transport unsubscribe function
 */
function useWorkspaceSubscription(
  connected: boolean,
  workspaceId: string | undefined,
  subscribe: (id: string) => void,
  unsubscribe: (id: string) => void,
) {
  const subscribedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!connected || !workspaceId) return;
    if (subscribedRef.current === workspaceId) return;

    // Unsubscribe from the previous workspace before subscribing to the new one
    if (subscribedRef.current) {
      unsubscribe(subscribedRef.current);
    }
    subscribe(workspaceId);
    subscribedRef.current = workspaceId;
  }, [connected, workspaceId, subscribe, unsubscribe]);
}

// ============================================================================
// Transport sub-components
//
// These exist as separate components so that conditional rendering in
// PreviewToast causes React to unmount one and mount the other when the
// transport changes — meaning only ONE hook is ever active at a time.
// ============================================================================

interface TransportProps {
  workspaceId: string | undefined;
  onPreviewRegistered: (preview: WorkspacePreview) => void;
  onPreviewUpdated: (preview: WorkspacePreview) => void;
  onError: (error: string) => void;
}

/** WebSocket transport — uses usePreviewWebsocket */
function WebSocketTransport({
  workspaceId,
  onPreviewRegistered,
  onPreviewUpdated,
  onError,
}: TransportProps) {
  const { connected, subscribe, unsubscribe } = usePreviewWebsocket({
    onPreviewRegistered,
    onPreviewUpdated,
    onError,
  });

  useWorkspaceSubscription(connected, workspaceId, subscribe, unsubscribe);

  return null;
}

/** SSE transport — uses usePreviewSSE */
function SSETransport({
  workspaceId,
  onPreviewRegistered,
  onPreviewUpdated,
  onError,
}: TransportProps) {
  const { connected, subscribe, unsubscribe } = usePreviewSSE({
    onPreviewRegistered,
    onPreviewUpdated,
    onError,
  });

  useWorkspaceSubscription(connected, workspaceId, subscribe, unsubscribe);

  return null;
}

// ============================================================================
// PreviewToast Component
// ============================================================================

/**
 * Renders nothing visually — connects to the preview event stream and dispatches
 * toast notifications via sonner when workspace previews are registered or updated.
 *
 * Transport defaults to WebSocket (/ws/previews) but can be switched to SSE
 * (/api/terminal/previews/events) via the `transport` prop or the
 * NEXT_PUBLIC_PREVIEW_TRANSPORT environment variable.
 *
 * Place this component high in your component tree (e.g., in the main layout or page)
 * alongside the sonner <Toaster />.
 */
export default function PreviewToast({ workspaceId, transport }: PreviewToastProps = {}) {
  // Resolve transport: prop → env var → default (websocket)
  const resolvedTransport: 'websocket' | 'sse' = transport ?? (
    process.env.NEXT_PUBLIC_PREVIEW_TRANSPORT === 'sse' ? 'sse' : 'websocket'
  );

  const recentToastsRef = useRef<Map<string, number>>(new Map());
  const activeToastCountRef = useRef(0);

  // Clean up expired dedup entries periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const ref = recentToastsRef.current;
      for (const [key, time] of ref.entries()) {
        if (now - time > DEDUP_WINDOW_MS) {
          ref.delete(key);
        }
      }
    }, DEDUP_WINDOW_MS);
    return () => clearInterval(interval);
  }, []);

  const showPreviewToast = useCallback((preview: WorkspacePreview, eventType: 'registered' | 'updated') => {
    const now = Date.now();

    // Dedup: same preview ID within dedup window
    const lastToast = recentToastsRef.current.get(preview.id);
    if (lastToast && now - lastToast < DEDUP_WINDOW_MS) return;
    recentToastsRef.current.set(preview.id, now);

    // Throttle: prevent toast spam from rapid events
    if (activeToastCountRef.current >= MAX_VISIBLE_TOASTS) {
      return;
    }

    const isActive = preview.status === 'active';
    const isStarting = preview.status === 'starting';

    // Only toast on registration or when transitioning to active
    if (eventType === 'updated' && !isActive) return;
    // Only toast for active or starting previews
    if (!isActive && !isStarting && eventType === 'registered') return;

    activeToastCountRef.current++;

    const description = isStarting
      ? `${preview.serviceName} is starting on port ${preview.port}...`
      : `${preview.serviceName} is live on port ${preview.port}`;

    toast.custom(
      (t) => (
        <PreviewToastContent
          preview={preview}
          onDismiss={() => {
            activeToastCountRef.current = Math.max(0, activeToastCountRef.current - 1);
            toast.dismiss(t);
          }}
        />
      ),
      {
        duration: TOAST_DURATION_MS,
        dismissible: true,
        onDismiss: () => {
          activeToastCountRef.current = Math.max(0, activeToastCountRef.current - 1);
        },
        onAutoClose: () => {
          activeToastCountRef.current = Math.max(0, activeToastCountRef.current - 1);
        },
        style: {
          background: 'linear-gradient(135deg, rgba(17, 17, 24, 0.98) 0%, rgba(28, 25, 43, 0.98) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(139, 92, 246, 0.15), 0 0 20px rgba(139, 92, 246, 0.08)',
          backdropFilter: 'blur(24px)',
          padding: '14px',
        },
        classNames: {
          toast: 'group',
        },
      }
    );
  }, []);

  // Memoize error handler to avoid re-connection cycles
  const onError = useCallback((error: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[PreviewToast] Event stream error:', error);
    }
  }, []);

  const onPreviewRegistered = useCallback((preview: WorkspacePreview) => {
    showPreviewToast(preview, 'registered');
  }, [showPreviewToast]);

  const onPreviewUpdated = useCallback((preview: WorkspacePreview) => {
    showPreviewToast(preview, 'updated');
  }, [showPreviewToast]);

  // Conditional rendering of transport sub-components.
  // When resolvedTransport changes, React unmounts the old sub-component and
  // mounts the new one — so only one hook is ever active at a time.
  //
  // The refs (recentToastsRef, activeToastCountRef) are owned by this component
  // and survive transport changes, so the dedup/throttle state is preserved.
  return resolvedTransport === 'sse' ? (
    <SSETransport
      workspaceId={workspaceId}
      onPreviewRegistered={onPreviewRegistered}
      onPreviewUpdated={onPreviewUpdated}
      onError={onError}
    />
  ) : (
    <WebSocketTransport
      workspaceId={workspaceId}
      onPreviewRegistered={onPreviewRegistered}
      onPreviewUpdated={onPreviewUpdated}
      onError={onError}
    />
  );
}
