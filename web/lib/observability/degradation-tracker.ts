/**
 * Unified degradation chain + manualRepromptCounter (Pass-2 cross-cutting theme).
 *
 * Bug: every silent failure mode surfaced in Pass-2 (#38 EPIPE, #39 ENOENT loop,
 * #40 orchestration fallback, #41 loop abort, #45 mid-stream stall, plus the
 * earlier tool-name misnaming and capability-not-found paths) ultimately
 * manifests to the user as "I had to manually reprompt." Without a unified
 * per-request log, operators reading run.log had no way to see WHICH silent
 * failures fired during a request that resulted in a manual reprompt.
 *
 * This module provides two observability surfaces, both stored on
 * `globalThis` so they survive Next.js hot-reload:
 *
 *   1. `recordDegradation(kind, source, detail)` — fire-and-forget. Appends
 *      a `{ts, kind, source, detail}` event to a per-session chain.
 *
 *   2. `formatDegradationChain(chain)` — emits the single-line summary
 *      `[Degradation-Chain] session=X kind1=count kind2=count ...` that the
 *      chat route appends at the end of each request. Operators reading
 *      run.log can grep for `[Degradation-Chain]` to see the silent-failure
 *      footprint of any request.
 *
 *   3. `incrementManualReprompt(sessionId)` — called by the chat route when
 *      a request comes in and the PREVIOUS request's chain was non-empty.
 *      This is the "user had to reprompt because the previous turn degraded"
 *      signal. Cumulative counter; reset is per-session-expiry.
 *
 * The tracker is intentionally lightweight (no persistence, no async I/O) so
 * it never blocks the hot path. All methods are O(1) and never throw.
 *
 * Reset hooks for tests:
 *   - `_resetDegradationTrackerForTests()` clears the singleton state.
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('DegradationTracker');

// ---------------------------------------------------------------------------
// Degradation kinds — the canonical list of "silent failure" events the
// cross-cutting theme calls out. Each kind maps to a single source file:
//   binary_missing           → bash-tool.ts (2nd-ENOENT hard-block + ENOENT steer)
//   tool_name_alias_rewrite  → router.ts (alias rewrite layer from Bug #37)
//   capability_not_found     → router.ts (unknown capability name)
//   broadcaster_epipe        → snapshot-broadcaster.ts (Redis pub/sub error)
//   orchestration_fallback   → unified-agent-service.ts (v1-api fallback after orchestrator crash)
//   mid_stream_stall         → vercel-ai-streaming.ts (TTFT/idle timeout)
//   loop_abort               → successive-tracker (3-consecutive-tool-failures kill)
//   invalid_path             → chat/route.ts (isValidFilePath rejection)
//   success_false            → router.ts (tool returned success:false)
//   custom                   → escape hatch for ad-hoc kinds (with `customKind` in detail)
// ---------------------------------------------------------------------------

export type DegradationKind =
  | 'binary_missing'
  | 'tool_name_alias_rewrite'
  | 'capability_not_found'
  | 'broadcaster_epipe'
  | 'orchestration_fallback'
  | 'mid_stream_stall'
  | 'loop_abort'
  | 'invalid_path'
  | 'success_false'
  | 'custom';

export interface DegradationEvent {
  ts: number;
  kind: DegradationKind;
  source: string;
  detail?: Record<string, unknown>;
}

export interface DegradationChain {
  sessionId: string;
  events: DegradationEvent[];
  /** Counts per kind (for cheap formatting). Recomputed lazily. */
  counts: Map<DegradationKind, number>;
  /** Request start time (Date.now() ms). Used for the request-boundary clear. */
  startedAtMs: number;
  /** True if `clearDegradationChain()` was called. */
  cleared: boolean;
}

export interface DegradationTrackerState {
  /** Per-session chain. Key = sessionId (or 'default'). */
  chains: Map<string, DegradationChain>;
  /** Cumulative manual-reprompt counter per session. */
  manualRepromptCounts: Map<string, number>;
  /** Bug #40: cumulative orchestration-fallback counter per session.
   *  Incremented by the chat route when a request returns degraded:true.
   *  Surfaced via /api/health?detailed so operators can see how often
   *  the orchestrator is degrading to v1-api text-mode. */
  orchestrationFallbackCounts: Map<string, number>;
  /** Last log line for the chain summary (for throttling). */
  lastChainLogAtMs: number;
  /** Last time we logged "manual reprompt detected" (for throttling). */
  lastManualRepromptLogAtMs: number;
}

const STATE_KEY = '__degradationTrackerState__';

function getState(): DegradationTrackerState {
  const g = globalThis as unknown as { [STATE_KEY]?: DegradationTrackerState };
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      chains: new Map(),
      manualRepromptCounts: new Map(),
      orchestrationFallbackCounts: new Map(),
      lastChainLogAtMs: 0,
      lastManualRepromptLogAtMs: 0,
    };
  }
  return g[STATE_KEY]!;
}

export function _resetDegradationTrackerForTests(): void {
  const g = globalThis as unknown as { [STATE_KEY]?: DegradationTrackerState };
  delete g[STATE_KEY];
}

// ---------------------------------------------------------------------------
// Chain management
// ---------------------------------------------------------------------------

const CHAIN_LOG_COOLDOWN_MS = 1_000; // Avoid log flood if recordDegradation is called in a tight loop

/**
 * Start a fresh chain for the session. Called at request entry. Always
 * creates a new chain (overwrites any previous chain for the session).
 *
 * The chat route checks for manual-reprompt from the PREVIOUS request's
 * chain BEFORE calling this function. After this function returns, the
 * previous chain is overwritten and manual-reprompt detection for the
 * next request will see only the events from this request.
 */
export function startDegradationChain(sessionId: string): DegradationChain {
  const state = getState();
  const chain: DegradationChain = {
    sessionId,
    events: [],
    counts: new Map(),
    startedAtMs: Date.now(),
    cleared: false,
  };
  state.chains.set(sessionId, chain);
  return chain;
}

/**
 * Clear the chain for the session. Called at request exit AFTER the chain
 * has been logged. The cleared flag prevents further `recordDegradation()`
 * events from accumulating into a stale chain.
 */
export function clearDegradationChain(sessionId: string): void {
  const state = getState();
  const chain = state.chains.get(sessionId);
  if (chain) {
    chain.cleared = true;
  }
}

/**
 * Atomic "log the chain summary, then clear it" primitive used by the
 * chat route's outer `try/finally` wrapper. Composing these two steps
 * into a single call keeps the call site small and makes it impossible
 * to clear-without-logging or log-without-clearing by accident.
 *
 * The function is best-effort — it never throws. It is safe to call when
 * no chain exists for the session (the log line is emitted at debug level
 * and the clear is a no-op).
 */
export function logAndClearChain(sessionId: string): void {
  try {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      sessionId = 'default';
    }
    const chain = getDegradationChain(sessionId);
    logDegradationChain(chain);
    clearDegradationChain(sessionId);
  } catch {
    // best-effort — chain logging must never break the response
  }
}

/**
 * Record a degradation event. Fire-and-forget. O(1). Never throws.
 *
 * The event is added to the chain (if one exists for this session) and the
 * per-kind count is incremented. The chat route calls `formatDegradationChain`
 * at request exit to emit the single-line summary.
 */
export function recordDegradation(
  sessionId: string,
  kind: DegradationKind,
  source: string,
  detail?: Record<string, unknown>,
): void {
  try {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      sessionId = 'default';
    }
    const state = getState();
    let chain = state.chains.get(sessionId);
    if (!chain || chain.cleared) {
      // No active chain — auto-start one so the event isn't lost. The
      // chain will be logged on the NEXT chain log call.
      chain = startDegradationChain(sessionId);
    }
    const event: DegradationEvent = {
      ts: Date.now(),
      kind,
      source,
      detail: detail || undefined,
    };
    chain.events.push(event);
    chain.counts.set(kind, (chain.counts.get(kind) ?? 0) + 1);
  } catch (err: any) {
    // Never throw on the hot path.
    logger.debug('recordDegradation swallowed error', { error: err?.message });
  }
}

/**
 * Read the chain for a session. Returns null if no chain has been started.
 */
export function getDegradationChain(sessionId: string): DegradationChain | null {
  const state = getState();
  return state.chains.get(sessionId) ?? null;
}

// ---------------------------------------------------------------------------
// Manual reprompt counter
// ---------------------------------------------------------------------------

const MANUAL_REPROMPT_LOG_COOLDOWN_MS = 5_000;

/**
 * Increment the manual-reprompt counter for a session. Called by the chat
 * route when a request comes in and the PREVIOUS request's chain was
 * non-empty (proxy for "user had to reprompt because the previous turn
 * degraded"). Returns the new count.
 *
 * Defensive: a session id of '' or null is treated as 'default'.
 */
export function incrementManualReprompt(sessionId: string): number {
  const state = getState();
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    sessionId = 'default';
  }
  const next = (state.manualRepromptCounts.get(sessionId) ?? 0) + 1;
  state.manualRepromptCounts.set(sessionId, next);
  return next;
}

/**
 * Read the current manual-reprompt count without mutating. Used by tests
 * and the /api/health endpoint.
 */
export function getManualRepromptCount(sessionId: string): number {
  const state = getState();
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    sessionId = 'default';
  }
  return state.manualRepromptCounts.get(sessionId) ?? 0;
}

/**
 * Reset the manual-reprompt counter for a session. Useful for tests and
 * session-expiry paths. Not called from the hot path.
 */
export function resetManualRepromptCount(sessionId: string): void {
  const state = getState();
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    sessionId = 'default';
  }
  state.manualRepromptCounts.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Bug #40: per-session orchestration-fallback counter
// ---------------------------------------------------------------------------

/**
 * Increment the orchestration-fallback counter for a session. Called by the
 * chat route (or the unified-agent-service) when a request returns
 * `metadata.degraded === true` (orchestrator degraded to v1-api). Returns
 * the new count. Counter is cumulative since process start; reset only by
 * `_resetDegradationTrackerForTests()` or session-expiry paths.
 */
export function incrementOrchestrationFallback(sessionId: string): number {
  const state = getState();
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    sessionId = 'default';
  }
  const next = (state.orchestrationFallbackCounts.get(sessionId) ?? 0) + 1;
  state.orchestrationFallbackCounts.set(sessionId, next);
  return next;
}

/**
 * Read the orchestration-fallback count without mutating. Returns 0 when
 * the session has not had any fallbacks. Used by the /api/health endpoint
 * and by tests.
 */
export function getOrchestrationFallbackCount(sessionId: string): number {
  const state = getState();
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    sessionId = 'default';
  }
  return state.orchestrationFallbackCounts.get(sessionId) ?? 0;
}

/**
 * Read the aggregate (sum-across-sessions) orchestration-fallback count.
 * The /api/health?detailed endpoint surfaces this so operators see the
 * fleet-wide degradation rate without needing per-session correlation.
 */
export function getTotalOrchestrationFallbackCount(): number {
  const state = getState();
  let total = 0;
  for (const v of state.orchestrationFallbackCounts.values()) {
    total += v;
  }
  return total;
}

/**
 * Read the per-session fallback counts as a snapshot. The /api/health
 * endpoint returns the top N sessions by count, not every session
 * (sessionId can be PII). Tests can inspect the full map.
 */
export function getOrchestrationFallbackSnapshot(): { sessionId: string; count: number }[] {
  const state = getState();
  return Array.from(state.orchestrationFallbackCounts.entries())
    .map(([sessionId, count]) => ({ sessionId, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Reset the orchestration-fallback counter for a session. Useful for
 * tests and session-expiry paths. Not called from the hot path.
 */
export function resetOrchestrationFallbackCount(sessionId: string): void {
  const state = getState();
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    sessionId = 'default';
  }
  state.orchestrationFallbackCounts.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format the chain as a single-line summary suitable for run.log. The
 * output is the canonical "[Degradation-Chain] session=X kind1=N kind2=N ..."
 * line that operators grep for to identify silent-failure footprints.
 *
 * Examples:
 *   [Degradation-Chain] session=default kinds=binary_missing(3) loop_abort(1)
 *   [Degradation-Chain] session=anon:1780963912001 kinds=tool_name_alias_rewrite(2) success_false(1)
 *   [Degradation-Chain] session=anon:1780963912001 kinds=(none)
 *
 * Kinds are sorted alphabetically for stable, grep-friendly output. The
 * session id is preserved verbatim (no PII stripping) so operators can
 * correlate with other request-boundary logs.
 */
export function formatDegradationChain(chain: DegradationChain | null): string {
  if (!chain) {
    return '[Degradation-Chain] session=unknown kinds=(none)';
  }
  if (chain.events.length === 0) {
    return `[Degradation-Chain] session=${chain.sessionId} kinds=(none)`;
  }
  const sortedKinds = Array.from(chain.counts.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const kindsPart = sortedKinds.map(([kind, count]) => `${kind}(${count})`).join(' ');
  return `[Degradation-Chain] session=${chain.sessionId} kinds=${kindsPart}`;
}

/**
 * Log the chain summary at the end of a request. Called by the chat route
 * once per request. Throttled so a hot request loop doesn't flood the log.
 */
export function logDegradationChain(chain: DegradationChain | null): void {
  try {
    const state = getState();
    const now = Date.now();
    if (now - state.lastChainLogAtMs < CHAIN_LOG_COOLDOWN_MS) {
      return;
    }
    state.lastChainLogAtMs = now;
    const line = formatDegradationChain(chain);
    if (chain && chain.events.length > 0) {
      logger.warn(line, {
        eventCount: chain.events.length,
        kinds: Array.from(chain.counts.keys()),
      });
    } else {
      // Use debug for empty chains — operators don't need a log line per request.
      logger.debug(line);
    }
  } catch {
    // best-effort
  }
}

/**
 * Log a "manual reprompt detected" line when the chat route detects the
 * previous turn was degraded. Throttled so multi-turn sessions don't spam.
 */
export function logManualRepromptDetected(sessionId: string, count: number): void {
  try {
    const state = getState();
    const now = Date.now();
    if (now - state.lastManualRepromptLogAtMs < MANUAL_REPROMPT_LOG_COOLDOWN_MS) {
      return;
    }
    state.lastManualRepromptLogAtMs = now;
    logger.warn('[Manual-Reprompt] session=' + sessionId + ' count=' + count, {
      sessionId,
      count,
    });
  } catch {
    // best-effort
  }
}
