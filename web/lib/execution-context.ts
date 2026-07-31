/**
 * Canonical execution context for a single request turn.
 *
 * Every VFS, Bash, sandbox, context-retrieval, reviewer, and SSE path
 * should receive this object rather than reconstructing scope from
 * whichever identifier happens to be locally available.
 *
 * This prevents cross-session reads/writes when one path derives
 * `workspace/sessions/${conversationId}` while another uses a
 * different scope or owner ID.
 */
export interface ExecutionContext {
  /** Resolved owner ID (jwt/session user ID, or `anon:...`) */
  ownerId: string;
  /** Resolved conversation ID (e.g. '018') */
  conversationId: string;
  /** Active VFS scope path (e.g. 'workspace/sessions/agency-...') */
  scopePath: string;
  /** Sandbox session ID, if one is active */
  sandboxSessionId?: string;
  /** Unique request ID for tracing */
  requestId: string;
  /** Whether the owner is authenticated (vs anonymous) */
  isAuthenticated: boolean;
  /** Auth source */
  authSource: 'jwt' | 'session' | 'anonymous';
}
