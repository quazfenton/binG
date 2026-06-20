/**
 * Per-operation concurrency cap for VFS batch operations.
 *
 * AUDIT: /opt/bing/docs/async-parallelization-opportunities.md "Meta #2" warned
 * that unbounded `Promise.all` over user-controlled input sets can exhaust
 * Node file descriptors (default `ulimit -n=1024`) and flood the event loop.
 *
 * Decision (thinker pass 2026-06-20): use **per-operation** Semaphore (NOT a
 * global singleton). A singleton would cause cross-request / cross-tenant
 * contention — e.g., User A's background cloud sync would block User B's
 * real-time chat read. Per-operation caps horizontally scale across
 * independent requests while still bounding fd pressure inside each op.
 *
 * `async-mutex` is `Semaphore`‑class based; `runExclusive(callback)` awaits
 * a free slot, runs the callback, releases on resolve/reject (errors
 * propagate as normal — wrap calls in `Promise.allSettled` for partial-failure
 * tolerance when desired).
 *
 * Cap value 10 is chosen empirically:
 *   - Node default `ulimit -n=1024` → leaves ~1014 fds for other subsystems.
 *   - 10 concurrent file ops ≪ fd ceiling; ample headroom for bursty traffic.
 *   - Loops with N < 10 are auto-sized down (no over-allocation cost).
 *
 * Usage (typical, accept all-or-nothing failure semantics):
 *
 *   import { getVfsLimiter } from '@/lib/vfs/concurrency-cap';
 *   const limiter = getVfsLimiter();
 *   await Promise.all(
 *     files.map(f => limiter.runExclusive(async () => { await readFile(f); })),
 *   );
 *
 * Usage (partial-failure tolerance — e.g., batchCopy where some files may fail):
 *
 *   await Promise.allSettled(
 *     files.map(f => limiter.runExclusive(async () => { await readFile(f); })),
 *   );
 */
import { Semaphore } from 'async-mutex';

export const VFS_CAP_DEFAULT = 10;

/**
 * Build a per-operation Semaphore. Cap auto-tunes: `min(inputSize, VFS_CAP_DEFAULT)`.
 * Callers that pass an explicit `permits` value override auto-tune.
 */
export function getVfsLimiter(opts: { permits?: number; inputSize?: number } = {}): Semaphore {
  // Floor at 1 to avoid the `new Semaphore(0)` silent-deadlock trap
  // (code-reviewer nit: caller passing `permits: 0` would otherwise deadlock
  // every queued runExclusive callback forever).
  const defaultCap = Math.min(VFS_CAP_DEFAULT, opts.inputSize ?? VFS_CAP_DEFAULT);
  const wants = Math.max(1, opts.permits ?? defaultCap);
  return new Semaphore(wants);
}
