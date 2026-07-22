/**
 * Zombie-Stream Reaper — process-scoped backstop for per-stream setTimeout-TIMEOUT escapes.
 *
 * Ticket: /opt/bing/.tickets/BUG2-ZOMBIE-STREAM-REAPER.md (closes "Zombie streams —
 * 19+ min silence" gap from COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT.md).
 *
 * The per-stream `setTimeout`-TIMEOUT site at vercel-ai-streaming.ts:L2005 already
 * emits a `stallWatchdogEnvelope`, but it DID NOT fire for the 19+ min orphan
 * batches detected in run.log (root cause: per-stream timer attachment bug, separate
 * investigation). This reaper is the empirical backstop — it catches per-stream
 * escapes at the MODULE level by sweeping a global Map every 60s.
 *
 * Why this approach (reaper-only) over (a) snapshot-on-hibernate or (c) hybrid:
 *   - After 19+ min silence, the model's server-side context is long-gone.
 *     The stream is dead; resumability is infeasible.
 *   - (a) snapshot-on-hibernate adds complexity for a non-recoverable symptom.
 *   - (c) hybrid defers snapshot to a separate ticket; this reaper is sufficient.
 *
 * Hot-reload safety: mirrors the FC-GATE pattern at vercel-ai-streaming.ts:L155.
 * The Map and the setInterval handle are stored on globalThis so Next.js dev
 * hot-reload doesn't leak timers.
 *
 * @see /opt/bing/.tickets/BUG2-ZOMBIE-STREAM-REAPER.md
 * @see /opt/bing/.tickets/COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT.md (Round 2 Bug 3, Behavioral 6)
 */

import { stallWatchdogEnvelope } from '@/lib/api/response-router';
import { recordDegradation } from '@/lib/observability/degradation-tracker';
import { chatLogger } from './chat-logger';

export interface ActiveStream {
  streamId: string;
  /** Conversation/session fingerprint. Optional — callers without a real
   *  sessionId (e.g., orphaned re-permissions) pass undefined and the reaper
   *  derives `orphan-${streamId}` so manualRepromptCounter doesn't fragment
   *  across streams from the same session. Threading the real sessionId
   *  through is preferred. */
  sessionId?: string;
  /** AbortController scoped to the per-stream request; aborting here propagates
   *  to all awaiting consumers (Vercel AI SDK iterator, fallback race, etc.). */
  abortController: AbortController;
  /** Epoch ms of the last registered "I just did something" event. */
  lastActivityTime: number;
  /** Coarse type of the last activity — used in diagnostic logs. */
  lastActivityType: 'init' | 'text' | 'tool-call' | 'tool-result';
  provider: string;
  modelName: string;
  /** Epoch ms of the registration — used for registry-cap eviction tiebreak. */
  registeredAt: number;
}

// ============================================================================
// Thresholds (env-driven with safe defaults)
// ============================================================================

let REAP_THRESHOLD_MS =
  Number(process.env.ZOMBIE_STREAM_THRESHOLD_MS) || 5 * 60 * 1000; // 5 min
let SWEEP_INTERVAL_MS =
  Number(process.env.ZOMBIE_STREAM_SWEEP_INTERVAL_MS) || 60 * 1000; // 1 min
const MAX_ACTIVE_STREAMS = 1000; // Defensive cap; if reached, evict oldest

// ============================================================================
// Hot-reload-safe singletons (mirrors FC-GATE pattern)
// ============================================================================

declare global {
  // eslint-disable-next-line no-var
  var __activeStreams__: Map<string, ActiveStream> | undefined;
  // eslint-disable-next-line no-var
  var __zombieReaperIntervalId__: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __zombieReaperCleanupListenerRegistered__: boolean | undefined;
}

const activeStreams: Map<string, ActiveStream> =
  globalThis.__activeStreams__ ?? (globalThis.__activeStreams__ = new Map());

// Defensive guard (2026-07-22 SUGGEST #4): refuse to start if a previous
// module-load corrupted globalThis.__activeStreams__. Future refactors that
// replace it (e.g., WeakRef, plain object) would silently misbehave on
// the next registerStream. The explicit crash surfaces the regression at
// boot, not on the first zombie reap.
if (!(activeStreams instanceof Map)) {
  throw new Error(
    'zombie-stream-reaper: globalThis.__activeStreams__ is corrupt (not a Map) — refusing to start',
  );
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Lazy-start the sweep interval (only after the first registerStream call). */
function ensureReaperInterval(): void {
  if (globalThis.__zombieReaperIntervalId__) return;
  globalThis.__zombieReaperIntervalId__ = setInterval(() => {
    try {
      sweepOnce();
    } catch (err) {
      chatLogger.warn('[ZOMBIE-REAPER] sweepOnce threw — keeping interval alive', {
        error: (err as Error).message,
      });
    }
  }, SWEEP_INTERVAL_MS);
}

function clearReaperInterval(): void {
  if (globalThis.__zombieReaperIntervalId__) {
    clearInterval(globalThis.__zombieReaperIntervalId__);
    globalThis.__zombieReaperIntervalId__ = undefined;
  }
}

/** Cap-eviction helper: find and force-reap the oldest entry. */
function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestActivity = Infinity;
  for (const [key, val] of activeStreams) {
    if (val.lastActivityTime < oldestActivity) {
      oldestActivity = val.lastActivityTime;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) {
    forceReap(oldestKey, 'registry-cap-eviction');
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Register an active stream for reaper supervision.
 *
 * Auto-starts the reaper interval (lazy init — no wasted timer if no streams
 * are ever registered) and enforces the MAX_ACTIVE_STREAMS cap by force-reaping
 * the oldest entry. Idempotent: re-registering an existing streamId updates
 * in place without eviction.
 */
export function registerStream(meta: Omit<ActiveStream, 'registeredAt'>): void {
  if (activeStreams.has(meta.streamId)) {
    const existing = activeStreams.get(meta.streamId)!;
    existing.lastActivityTime = Date.now();
    existing.lastActivityType = meta.lastActivityType;
    existing.provider = meta.provider;
    existing.modelName = meta.modelName;
    existing.abortController = meta.abortController;
    return;
  }
  if (activeStreams.size >= MAX_ACTIVE_STREAMS) {
    evictOldest();
  }
  activeStreams.set(meta.streamId, { ...meta, registeredAt: Date.now() });
  ensureReaperInterval();
}

/**
 * Update lastActivityTime + lastActivityType for an active stream. No-op if the
 * stream isn't registered (e.g., already reaped + unregistered, or never registered).
 */
export function updateStreamActivity(
  streamId: string,
  activityType: ActiveStream['lastActivityType'],
): void {
  const stream = activeStreams.get(streamId);
  if (!stream) return;
  stream.lastActivityTime = Date.now();
  stream.lastActivityType = activityType;
}

/**
 * Remove a stream from reaper supervision. Idempotent.
 */
export function unregisterStream(streamId: string): void {
  activeStreams.delete(streamId);
}

/**
 * Force-reap a stream by ID. Emits stallWatchdogEnvelope via chatLogger,
 * records a degradation event, and force-aborts the stream's AbortController.
 * Idempotent: a second call on the same streamId is a no-op.
 */
export function forceReap(streamId: string, reason: string): void {
  const stream = activeStreams.get(streamId);
  if (!stream) return;

  const silenceMs = Date.now() - stream.lastActivityTime;

  const envelope = stallWatchdogEnvelope({
    msSinceLastChunk: silenceMs,
    reason: `zombie-reaper: ${reason}`,
    streamId,
    message: `Stream ${streamId} (${stream.provider}/${stream.modelName}) reaped after ${silenceMs}ms silence (reaper threshold: ${REAP_THRESHOLD_MS}ms)`,
  });

  chatLogger.error('[ZOMBIE-REAPER] Reaped inactive stream', {
    streamId,
    provider: stream.provider,
    modelName: stream.modelName,
    silenceMs,
    lastActivityType: stream.lastActivityType,
    registeredAt: stream.registeredAt,
    envelope,
  });

  // Degradation kind choice (2026-07-22): 'mid_stream_stall' matches the
  // existing per-stream timeout taxonomy — the reaper IS the backstop for
  // the same symptom (the abort signal did not reach the per-stream timer).
  // The `source` arg distinguishes the two: 'per-stream-timeout' vs
  // 'zombie-reaper' so /api/health can split them.
  // sessionId: prefer the caller's real fingerprint (so manualRepromptCounter
  // aggregates per-session); fall back to `orphan-${streamId}` to flag
  // orphans explicitly. Either way, the streamId is also present in the
  // detail Record for operators who need per-stream granularity.
  recordDegradation(
    stream.sessionId ?? `orphan-${streamId}`,
    'mid_stream_stall',
    'zombie-reaper',
    {
      streamId,
      silenceMs,
      lastActivityType: stream.lastActivityType,
      provider: stream.provider,
      modelName: stream.modelName,
      // failureReason (NOT reapReason) — distinguishes from `source` arg.
      // source='zombie-reaper' says WHERE this fired; failureReason says
      // WHAT failed (e.g., 'silence-720s', 'registry-cap-eviction').
      failureReason: reason,
    },
  );

  // Force-abort so any awaiting Vercel-AI-SDK iterator / fallback race exits.
  try {
    stream.abortController.abort(new Error(`Zombie reaper: ${reason}`));
  } catch (err) {
    chatLogger.warn('[ZOMBIE-REAPER] abortController.abort threw (consumer already gone)', {
      streamId,
      error: (err as Error).message,
    });
  }

  activeStreams.delete(streamId);
}

/**
 * Single sweep pass: reap all streams whose lastActivityTime is older than
 * REAP_THRESHOLD_MS. Returns the number of streams reaped (for tests + metrics).
 */
export function sweepOnce(): number {
  const now = Date.now();
  let reapCount = 0;
  // Iterate over a snapshot to avoid mutation during iteration
  for (const [streamId, stream] of [...activeStreams]) {
    if (now - stream.lastActivityTime > REAP_THRESHOLD_MS) {
      const silenceSec = Math.floor((now - stream.lastActivityTime) / 1000);
      forceReap(streamId, `silence-${silenceSec}s`);
      reapCount++;
    }
  }
  return reapCount;
}

/**
 * Diagnostic helper: how many streams are currently registered.
 * Useful for /api/health + tests + operator debugging.
 */
export function getActiveStreamCount(): number {
  return activeStreams.size;
}

/**
 * Diagnostic helper: snapshot of currently-registered streams (read-only).
 * Returns a shallow-cloned array for safe iteration.
 */
export function getActiveStreams(): ActiveStream[] {
  return [...activeStreams.values()].map((s) => ({ ...s }));
}

// ============================================================================
// Test helpers (not part of the public API)
// ============================================================================

/** @internal Reset module state for vitest (clears Map + clears interval + aborts any active consumers). */
export function _resetForTests(): void {
  for (const [streamId, stream] of [...activeStreams]) {
    if (!stream.abortController.signal.aborted) {
      try {
        stream.abortController.abort(new Error('test reset'));
      } catch {
        // ignore — best-effort cleanup
      }
    }
  }
  activeStreams.clear();
  clearReaperInterval();
}

/** @internal Override the sweep interval for vitest (use 0 to disable interval). */
export function _setReaperIntervalForTests(intervalMs: number): void {
  clearReaperInterval();
  if (intervalMs <= 0) return;
  globalThis.__zombieReaperIntervalId__ = setInterval(() => {
    try {
      sweepOnce();
    } catch (err) {
      chatLogger.warn('[ZOMBIE-REAPER] test sweep threw', { error: (err as Error).message });
    }
  }, intervalMs);
}

/** @internal Override the reap threshold for vitest. */
export function _setReapThresholdForTests(thresholdMs: number): void {
  REAP_THRESHOLD_MS = thresholdMs;
}

// ============================================================================
// Process-exit cleanup (registered once per process via globalThis sentinel)
// ============================================================================

if (!globalThis.__zombieReaperCleanupListenerRegistered__) {
  globalThis.__zombieReaperCleanupListenerRegistered__ = true;
  process.on('beforeExit', () => {
    clearReaperInterval();
  });
}
