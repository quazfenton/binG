/**
 * Shared heap-snapshot helper.
 *
 * Deduplicates the v8/fs/path dance that was previously copy-pasted in
 *   - process-memory-monitor.ts (critical-threshold snapshots)
 *   - session-manager.ts     (shutdown snapshots)
 *
 * See BUGS_AUDIT.md #43 for the leak investigation.  The two call sites
 * had ~identical mkdirSync + filename-build + writeHeapSnapshot + log
 * blocks; one bug fix or filename-format change previously required
 * editing both files in lockstep.
 *
 * Design:
 *   - Sync: `v8.writeHeapSnapshot()` is sync, so the helper is too.  This
 *     matches the shutdown call site (which must complete before the
 *     process exits) and the critical call site (which already has a
 *     dynamic-import wrapper around it for the lazy module load).
 *   - Best-effort: never throws.  Returns null on any failure (mkdir,
 *     write, disk full, permission denied) so the caller can log at
 *     its preferred level and decide whether to retry.
 *   - Filename format: `heap-${prefix}-${Date.now()}-${label}.heapsnapshot`.
 *     `prefix` distinguishes snapshot sources (e.g. `critical`, `shutdown`).
 *     `label` is `${heapUsedMb}MB` when numeric, or `unknown` when the
 *     caller passes `null` (e.g. process.memoryUsage() threw).
 *   - Cooldown / rate-limiting is the caller's responsibility — different
 *     callers have different policies (critical uses MEMORY_SNAPSHOT_COOLDOWN_MS,
 *     shutdown uses the session-manager's own lastShutdownSnapshotAtMs).
 */

import { writeHeapSnapshot as v8WriteHeapSnapshot } from 'node:v8';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export interface HeapSnapshotResult {
  /** Absolute path of the written snapshot file. */
  path: string;
  /** The heapUsedMb the caller passed in (preserved for logging). */
  heapUsedMb: number | null;
}

/**
 * Write a V8 heap snapshot to disk.  See module doc for design notes.
 *
 * @param prefix Filename prefix identifying the snapshot source (e.g.
 *               `critical`, `shutdown`).
 * @param dir Directory to write the file into.  Created if missing.
 * @param heapUsedMb Heap usage label for the filename.  Pass `null` if
 *                   the memory API threw or you don't have a fresh sample;
 *                   the filename will use `unknown` and the snapshot will
 *                   still fire.
 * @returns `{ path, heapUsedMb }` on success, or `null` on any failure.
 */
export function writeHeapSnapshot(
  prefix: string,
  dir: string,
  heapUsedMb: number | null,
): HeapSnapshotResult | null {
  try {
    // Ensure directory exists.  mkdirSync(recursive:true) is idempotent
    // and tolerant of races; swallow any error (best effort — caller's
    // logger will report).
    try { mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }

    const heapLabel = heapUsedMb === null ? 'unknown' : `${heapUsedMb}MB`;
    // Include process.pid so concurrent workers in a cluster don't overwrite
    // each other's snapshots when they trip at the same millisecond.
    const filename = `heap-${prefix}-${Date.now()}-pid${process.pid}-${heapLabel}.heapsnapshot`;
    const fullPath = resolve(dir, filename);
    v8WriteHeapSnapshot(fullPath);
    return { path: fullPath, heapUsedMb };
  } catch {
    // Swallow — callers log at their preferred level.  Returning null
    // (not throwing) is the contract.
    return null;
  }
}
