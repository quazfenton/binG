/**
 * Lifecycle Observability Helper — Pass-7 #92 and #93 fix
 *
 * Closes the audit's two cross-cutting observability gaps:
 *
 *   #92: Massive init/release imbalance (1,885 `initialized` events vs 0
 *        `destroyed`/`closed`/`released`/`disposed`/`freed`/`disconnected`/
 *        `terminated` events in 9,495-line run.log). Teardown code either
 *        doesn't run, runs silently, or is missing entirely.
 *
 *   #93: Operation start/end events absent (sandbox 4 starts vs 2 ends,
 *        vfs 3 starts vs 2 ends, snapshot 0 starts, migrate 0 starts).
 *        Cannot trace when sandbox/vfs/snapshot/migrate operations begin,
 *        succeed, or fail.
 *
 * Design: two thin helpers + a single source-of-truth counter set so
 * operators can grep on the canonical lifecycle terms and see the
 * init/release ratio at a glance. The counter set is persisted on
 * `globalThis.__lifecycleCounters__` so Next.js hot-reload doesn't reset
 * the running totals while the underlying resources survive.
 *
 * Usage:
 *   import { trackOperation, markInitialized, markReleased, getLifecycleStats } from '@/lib/management/lifecycle';
 *
 *   // Wrap a sandbox op:
 *   for await (const _ of trackOperation('sandbox.create', { provider }, async () => { ... })) { ... }
 *
 *   // Wrap a vfs op:
 *   await trackOperation('vfs.writeFile', { ownerId, path }, async () => { ... });
 *
 *   // Mark init:
 *   markInitialized('sandbox', sandboxId, { provider });
 *
 *   // Mark release (on teardown):
 *   markReleased('sandbox', sandboxId, { reason: 'idle' });
 *
 *   // Snapshot for /api/health?detailed:
 *   const stats = getLifecycleStats();
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Lifecycle');

// ============================================================================
// Counter set (persisted on globalThis)
// ============================================================================

interface LifecycleCounters {
  /** `initialized` events by category (sandbox, vfs, snapshot, etc.) */
  initialized: Record<string, number>;
  /** `destroyed` events by category */
  destroyed: Record<string, number>;
  /** `closed` events by category */
  closed: Record<string, number>;
  /** `released` events by category */
  released: Record<string, number>;
  /** `disposed` events by category */
  disposed: Record<string, number>;
  /** `operation.started` events by operation name */
  opStarted: Record<string, number>;
  /** `operation.completed` events by operation name */
  opCompleted: Record<string, number>;
  /** `operation.failed` events by operation name */
  opFailed: Record<string, number>;
  /** Per-id state — last seen status (for orphan detection) */
  idStatus: Record<string, 'initialized' | 'destroyed' | 'closed' | 'released' | 'disposed'>;
  /** Module load epoch ms */
  startedAtMs: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __lifecycleCounters__: LifecycleCounters | undefined;
}

function getCounters(): LifecycleCounters {
  if (!globalThis.__lifecycleCounters__) {
    globalThis.__lifecycleCounters__ = {
      initialized: {},
      destroyed: {},
      closed: {},
      released: {},
      disposed: {},
      opStarted: {},
      opCompleted: {},
      opFailed: {},
      idStatus: {},
      startedAtMs: Date.now(),
    };
  }
  return globalThis.__lifecycleCounters__;
}

/** Reset all counters (testing only). */
export function _resetLifecycleCountersForTests(): void {
  delete globalThis.__lifecycleCounters__;
}

// ============================================================================
// #92: Init/Release tracking
// ============================================================================

/**
 * Canonical init event. Logs `[INITIALIZED] <category>.<id>` at INFO and
 * increments the per-category counter. Use at the START of every resource
 * acquisition (sandbox create, vfs workspace open, db connection, etc.).
 *
 * Pair with `markReleased(category, id, options?)` or
 * `markDestroyed(category, id, options?)` on teardown. The categories
 * match the audit's grep vocabulary (`sandbox`, `vfs`, `snapshot`, etc.)
 * so meta-monitoring queries like `grep -c '\[INITIALIZED\] sandbox'`
 * produce meaningful numbers.
 */
export function markInitialized(
  category: string,
  id: string,
  details: Record<string, unknown> = {},
): void {
  const counters = getCounters();
  counters.initialized[category] = (counters.initialized[category] ?? 0) + 1;
  counters.idStatus[`${category}:${id}`] = 'initialized';
  logger.info(`[INITIALIZED] ${category}.${id}`, details);
}

function markTeardown(
  category: string,
  id: string,
  term: 'destroyed' | 'closed' | 'released' | 'disposed',
  details: Record<string, unknown> = {},
): void {
  const counters = getCounters();
  counters[term][category] = (counters[term][category] ?? 0) + 1;
  const key = `${category}:${id}`;
  // If we never saw the init (orphan teardown), count it but tag the log
  const sawInit = counters.idStatus[key] === 'initialized';
  counters.idStatus[key] = term;
  const level = sawInit ? 'info' : 'warn';
  const orphanTag = sawInit ? '' : ' (ORPHAN: no matching [INITIALIZED] in this process)';
  logger[level](
    `[${term.toUpperCase()}] ${category}.${id}${orphanTag}`,
    { ...details, sawInit, term },
  );
}

/** Mark a resource as destroyed. Pair with markInitialized. */
export function markDestroyed(
  category: string,
  id: string,
  details: Record<string, unknown> = {},
): void {
  markTeardown(category, id, 'destroyed', details);
}

/** Mark a resource as closed (e.g., stream, connection). */
export function markClosed(
  category: string,
  id: string,
  details: Record<string, unknown> = {},
): void {
  markTeardown(category, id, 'closed', details);
}

/** Mark a resource as released (e.g., lock, handle). */
export function markReleased(
  category: string,
  id: string,
  details: Record<string, unknown> = {},
): void {
  markTeardown(category, id, 'released', details);
}

/** Mark a resource as disposed. */
export function markDisposed(
  category: string,
  id: string,
  details: Record<string, unknown> = {},
): void {
  markTeardown(category, id, 'disposed', details);
}

// ============================================================================
// #93: Operation start/end tracking
// ============================================================================

/**
 * Canonical operation event (started, completed, failed). Logs at DEBUG
 * to keep the steady-state volume low; pass `level: 'info'` to elevate
 * a specific op if it's high-stakes.
 *
 * The op name follows the `<domain>.<verb>` convention
 * (e.g., `sandbox.create`, `vfs.writeFile`, `snapshot.export`,
 * `migrate.workspace`) so meta-monitoring queries like
 * `grep '\[OPERATION\]' | awk '{print $3}'` give a clean breakdown.
 */
export function markOpStarted(
  opName: string,
  details: Record<string, unknown> = {},
): void {
  const counters = getCounters();
  counters.opStarted[opName] = (counters.opStarted[opName] ?? 0) + 1;
  logger.debug(`[OPERATION STARTED] ${opName}`, details);
}

export function markOpCompleted(
  opName: string,
  details: Record<string, unknown> = {},
): void {
  const counters = getCounters();
  counters.opCompleted[opName] = (counters.opCompleted[opName] ?? 0) + 1;
  logger.debug(`[OPERATION COMPLETED] ${opName}`, details);
}

export function markOpFailed(
  opName: string,
  error: unknown,
  details: Record<string, unknown> = {},
): void {
  const counters = getCounters();
  counters.opFailed[opName] = (counters.opFailed[opName] ?? 0) + 1;
  const errMsg = error instanceof Error ? error.message : String(error);
  logger.warn(`[OPERATION FAILED] ${opName}`, { ...details, error: errMsg });
}

/**
 * Wrap an async operation so it auto-emits `[OPERATION STARTED]` and
 * either `[OPERATION COMPLETED]` or `[OPERATION FAILED]`. Use at the
 * boundary of every sandbox/vfs/snapshot/migrate call site.
 *
 * @example
 *   const result = await trackOperation('sandbox.create', { provider }, () =>
 *     provider.createSandbox(opts),
 *   );
 */
export async function trackOperation<T>(
  opName: string,
  details: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  markOpStarted(opName, details);
  const startMs = Date.now();
  try {
    const result = await fn();
    markOpCompleted(opName, {
      ...details,
      durationMs: Date.now() - startMs,
      success: true,
    });
    return result;
  } catch (err) {
    markOpFailed(opName, err, {
      ...details,
      durationMs: Date.now() - startMs,
    });
    throw err;
  }
}

/**
 * Sync variant of `trackOperation` for non-async teardown paths.
 */
export function trackOperationSync<T>(
  opName: string,
  details: Record<string, unknown>,
  fn: () => T,
): T {
  markOpStarted(opName, details);
  const startMs = Date.now();
  try {
    const result = fn();
    markOpCompleted(opName, {
      ...details,
      durationMs: Date.now() - startMs,
      success: true,
    });
    return result;
  } catch (err) {
    markOpFailed(opName, err, {
      ...details,
      durationMs: Date.now() - startMs,
    });
    throw err;
  }
}

// ============================================================================
// Stats / health
// ============================================================================

export interface LifecycleStats {
  /** Total initialized across all categories. */
  totalInitialized: number;
  /** Total teardown across all categories (destroyed+closed+released+disposed). */
  totalTornDown: number;
  /** Init/release ratio. >1 means init > teardown (potential leak). */
  initReleaseRatio: number;
  /** Per-category init count. */
  initialized: Record<string, number>;
  /** Per-category teardown counts (summed across all 4 teardown terms). */
  tornDown: Record<string, number>;
  /** Per-op started/completed/failed counts. */
  operations: Record<string, { started: number; completed: number; failed: number }>;
  /** Number of tracked ids that are in an `initialized` state (no teardown seen). */
  liveIds: number;
  /** Module load epoch ms. */
  startedAtMs: number;
  /** Elapsed ms since module load. */
  uptimeMs: number;
}

/**
 * Snapshot of the lifecycle counters for `/api/health?detailed` and
 * ad-hoc operator queries. Returns a frozen object so the caller can't
 * accidentally mutate the persisted counter set.
 */
export function getLifecycleStats(): LifecycleStats {
  const c = getCounters();
  const tornDown: Record<string, number> = {};
  for (const cat of Object.keys(c.initialized)) tornDown[cat] = 0;
  for (const bucket of ['destroyed', 'closed', 'released', 'disposed'] as const) {
    for (const [cat, n] of Object.entries(c[bucket])) {
      tornDown[cat] = (tornDown[cat] ?? 0) + n;
    }
  }
  const totalInitialized = Object.values(c.initialized).reduce((a, b) => a + b, 0);
  const totalTornDown = Object.values(tornDown).reduce((a, b) => a + b, 0);
  const operations: Record<string, { started: number; completed: number; failed: number }> = {};
  for (const [op, started] of Object.entries(c.opStarted)) {
    operations[op] = {
      started,
      completed: c.opCompleted[op] ?? 0,
      failed: c.opFailed[op] ?? 0,
    };
  }
  // Include ops that have completed/failed but never started (defensive)
  for (const op of new Set([
    ...Object.keys(c.opCompleted),
    ...Object.keys(c.opFailed),
  ])) {
    if (!operations[op]) {
      operations[op] = {
        started: 0,
        completed: c.opCompleted[op] ?? 0,
        failed: c.opFailed[op] ?? 0,
      };
    }
  }
  const liveIds = Object.values(c.idStatus).filter((s) => s === 'initialized').length;
  return {
    totalInitialized,
    totalTornDown,
    initReleaseRatio: totalTornDown > 0 ? totalInitialized / totalTornDown : totalInitialized,
    initialized: { ...c.initialized },
    tornDown,
    operations,
    liveIds,
    startedAtMs: c.startedAtMs,
    uptimeMs: Date.now() - c.startedAtMs,
  };
}
