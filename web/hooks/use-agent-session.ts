'use client';

/**
 * useAgentSession — React Hook for Agent Session Lifecycle
 *
 * Creates, monitors, and destroys agent sessions via the REST API.
 * Uses fetch() to call the existing /api/agent/v2/session endpoints.
 *
 * @example
 * ```tsx
 * function AgentPanel({ userId, conversationId }) {
 *   const { session, loading, ensureSession } = useAgentSession({
 *     userId, conversationId, autoCreate: true,
 *   });
 *   if (loading) return <Spinner />;
 *   return <div>Session: {session?.id}</div>;
 * }
 * ```
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Hooks:useAgentSession');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSessionInfo {
  id: string;
  sessionId: string;
  sessionKey: string;
  userId: string;
  conversationId: string;
  status: string;
  workspacePath: string;
  v2SessionId?: string;
  mcpServerUrl?: string;
  nullclawAvailable?: boolean;
  createdAt: number;
}

export interface UseAgentSessionOptions {
  /** User identifier (required) */
  userId: string | null;
  /** Conversation/session identifier (required) */
  conversationId: string | null;
  /** Optional session creation parameters */
  config?: {
    mode?: 'opencode' | 'nullclaw' | 'hybrid';
    enableNullclaw?: boolean;
    enableCloudOffload?: boolean;
    enableMCP?: boolean;
    timeout?: number;
  };
  /** Auto-create session on mount (default: false) */
  autoCreate?: boolean;
  /** Called when the session is successfully created or retrieved */
  onSessionReady?: (session: AgentSessionInfo) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
  /** Called when the session is destroyed */
  onDestroyed?: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentSession(options: UseAgentSessionOptions) {
  const {
    userId,
    conversationId,
    config,
    autoCreate = false,
    onSessionReady,
    onError,
    onDestroyed,
  } = options;

  const [session, setSession] = useState<AgentSessionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for stable callbacks across renders
  const optionsRef = useRef({ onSessionReady, onError, onDestroyed });
  optionsRef.current = { onSessionReady, onError, onDestroyed };

  // Deduplicate in-flight session creation
  const createPromiseRef = useRef<Promise<AgentSessionInfo | null> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // -----------------------------------------------------------------------
  // ensureSession — create or retrieve session via POST /api/agent/v2/session
  // -----------------------------------------------------------------------
  const ensureSession = useCallback(async (): Promise<AgentSessionInfo | null> => {
    if (!userId || !conversationId) {
      const msg = 'userId and conversationId are required';
      setError(msg);
      optionsRef.current.onError?.(msg);
      return null;
    }

    if (createPromiseRef.current) {
      return await createPromiseRef.current;
    }

    setLoading(true);
    setError(null);

    createPromiseRef.current = (async () => {
      try {
        const res = await fetch('/api/agent/v2/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            mode: config?.mode ?? 'opencode',
            enableNullclaw: config?.enableNullclaw ?? false,
            enableCloudOffload: config?.enableCloudOffload ?? false,
            enableMCP: config?.enableMCP ?? true,
            timeout: config?.timeout ?? 3600,
          }),
        });

        const body = await res.json();

        if (!res.ok || !body.success) {
          throw new Error(body.error || `HTTP ${res.status}: Failed to create session`);
        }

        const d = body.data;
        const info: AgentSessionInfo = {
          id: d.sessionId,
          sessionId: d.sessionId,
          sessionKey: d.sessionKey,
          userId: d.userId,
          conversationId: d.conversationId,
          status: d.status,
          workspacePath: d.workspacePath,
          v2SessionId: d.v2SessionId,
          mcpServerUrl: d.mcpServerUrl,
          nullclawAvailable: d.nullclawAvailable,
          createdAt: d.createdAt,
        };

        if (mountedRef.current) {
          setSession(info);
          setLoading(false);
        }
        optionsRef.current.onSessionReady?.(info);
        return info;
      } catch (err: any) {
        const msg = err?.message || 'Failed to create agent session';
        logger.error('[useAgentSession] ensureSession failed:', msg);
        if (mountedRef.current) {
          setError(msg);
          setLoading(false);
        }
        optionsRef.current.onError?.(msg);
        return null;
      } finally {
        createPromiseRef.current = null;
      }
    })();

    return await createPromiseRef.current;
  }, [userId, conversationId, config?.mode, config?.enableNullclaw, config?.enableCloudOffload, config?.enableMCP, config?.timeout]);

  // -----------------------------------------------------------------------
  // destroySession — DELETE /api/agent/v2/session?conversationId=...
  // -----------------------------------------------------------------------
  const destroySession = useCallback(async (): Promise<void> => {
    if (!userId || !conversationId) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/agent/v2/session?conversationId=${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      if (mountedRef.current) {
        setSession(null);
        setLoading(false);
      }
      optionsRef.current.onDestroyed?.();
    } catch (err: any) {
      const msg = err?.message || 'Failed to destroy agent session';
      logger.error('[useAgentSession] destroySession failed:', msg);
      if (mountedRef.current) {
        setError(msg);
        setLoading(false);
      }
    }
  }, [userId, conversationId]);

  // -----------------------------------------------------------------------
  // Auto-create on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (autoCreate) {
      ensureSession();
    }
  }, [autoCreate, ensureSession]);

  return {
    /** Current session info, or null if not yet created */
    session,
    /** True while an operation is in-flight */
    loading,
    /** Last error message, or null if none */
    error,
    /** Create or retrieve the session (idempotent) */
    ensureSession,
    /** Destroy the session and reset state */
    destroySession,
    /** True when a session exists */
    hasSession: session !== null,
    /** Shortcut: true when session status is active/ready */
    isReady: session?.status === 'active' || session?.status === 'ready',
  };
}
