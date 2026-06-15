/**
 * Transactional VFS Layer
 *
 * Adds optimistic-concurrency-control (OCC) primitives on top of the base
 * VirtualFilesystemService and GitBackedVFS. Three guarantees:
 *
 * 1. Per-file version tokens — `readWithVersion` returns `{ content, version }`
 *    and `writeWithVersion` accepts an `expectedVersion`; on mismatch the diff
 *    function is re-run up to N times (the classic CAS retry loop).
 *
 * 2. Concurrent-modification block — when the base VFS detects a recent write
 *    ("Potential concurrent modification" in the original code) and the
 *    transactional layer is in strict mode, the call throws
 *    `ConcurrentModificationError` instead of silently logging a warning. This
 *    prevents the "two writes race, last one wins" data loss that
 *    `onConflict` listeners were meant to catch but rarely did in practice.
 *
 * 3. Multi-file transactions — `beginTransaction` / `commit` / `rollback`
 *    wrap GitBackedVFS so a batch of N file edits either lands atomically
 *    (single shadow commit, single workspace-version bump) or all roll back
 *    to the pre-transaction snapshot. Pre-existing `batchWrite` already
 *    ships this for happy-path; the new wrapper additionally tracks a
 *    `Transaction` object that can be inspected, rolled back, and aborted
 *    on the first error.
 *
 * Closes bugs #10, #25, #18.
 */
import { createLogger } from '@/lib/utils/logger';
import { virtualFilesystem } from '@/lib/virtual-filesystem/index.server';
import type { VirtualFile } from '@/lib/virtual-filesystem/filesystem-types';
import { VersionMismatchError, ConcurrentModificationError } from './errors';
// Pass-7 #107: tag CAS-retry-exhaustion log with canonical detection terms
// (mismatch + drift) so the meta-monitor can grep on a single token. The
// file version drifted between read and write (the underlying cause) AND
// the version token didn't match (the symptom).
import { DETECTION_TERMS, withDetectionTerms } from '@/lib/virtual-filesystem/session-path-guard';

const logger = createLogger('VFS:TX');

// Re-export the shared error classes so existing imports of
// `transactional-vfs` (e.g. `import { VersionMismatchError } from
// '@/lib/vfs/transactional-vfs'`) keep working. New code should prefer
// importing directly from `@/lib/vfs` or `@/lib/vfs/errors`.
export { VersionMismatchError, ConcurrentModificationError };

// ============================================================================
// Read API
// ============================================================================

/**
 * Result of a versioned read.
 */
export interface VersionedFile {
  /** File content */
  content: string;
  /** Per-file monotonic version. Compare against `expectedVersion` on write. */
  version: number;
  /** Path (normalized). */
  path: string;
  /** Last-modified ISO timestamp. */
  lastModified: string;
}

/**
 * Read a file and return its content plus per-file version token.
 *
 * @param ownerId VFS owner (composite session ID recommended)
 * @param filePath Path relative to the session workspace root
 */
export async function readWithVersion(
  ownerId: string,
  filePath: string,
): Promise<VersionedFile> {
  const file = await virtualFilesystem.readFile(ownerId, filePath);
  return {
    content: file.content,
    version: file.version,
    path: file.path,
    lastModified: file.lastModified,
  };
}

// ============================================================================
// Write API with optimistic concurrency
// ============================================================================

/**
 * Options for `writeWithVersion`.
 */
export interface WriteWithVersionOptions {
  /**
   * Per-file version returned by a prior `readWithVersion`. When omitted, the
   * write is unconditional (last-writer-wins, no OCC).
   */
  expectedVersion?: number;
  /**
   * Maximum CAS attempts. The first attempt counts; subsequent attempts
   * re-read the file and call `diffFn` again with the new content.
   * Defaults to 3.
   */
  maxRetries?: number;
  /**
   * Function that maps `(currentContent)` to the new content to write.
   * Required when `expectedVersion` is set — this is the "diff" that gets
   * re-run on every retry against the freshly-read content.
   *
   * Example: `(cur) => cur.replace(/foo/g, 'bar')`.
   */
  diffFn?: (currentContent: string) => string;
  /**
   * Language hint, forwarded to the base VFS.
   */
  language?: string;
  /**
   * VFS options forwarded to the base write (e.g. `append: true`).
   */
  vfsOptions?: { failIfExists?: boolean; append?: boolean };
  /**
   * When true, throw `ConcurrentModificationError` if the base VFS detects a
   * recent write within the conflict window. When false (default), the base
   * VFS still emits a [WARN] but the write succeeds.
   */
  strictConcurrency?: boolean;
}

/**
 * Write a file with optional per-file version check and automatic retry.
 *
 * Two modes:
 *   - **Unconditional** (no `expectedVersion`): plain write, no retry.
 *   - **CAS** (`expectedVersion` set, `diffFn` provided): classic optimistic
 *     concurrency. If the file's version changed since we read it, re-read,
 *     re-run `diffFn` against the new content, and try again — up to
 *     `maxRetries` total attempts. On final mismatch, throws
 *     `VersionMismatchError` with the actual version and attempt count.
 *
 * Returns the freshly-written VirtualFile (with the new version) so the
 * caller can chain further reads/writes without re-reading.
 */
export async function writeWithVersion(
  ownerId: string,
  filePath: string,
  initialContent: string,
  options: WriteWithVersionOptions = {},
): Promise<VirtualFile> {
  const {
    expectedVersion,
    maxRetries = 3,
    diffFn,
    language,
    vfsOptions,
    strictConcurrency = false,
  } = options;

  // CAS path
  if (typeof expectedVersion === 'number') {
    if (typeof diffFn !== 'function') {
      throw new Error(
        `writeWithVersion: diffFn is required when expectedVersion is set (path=${filePath})`,
      );
    }

    // `baselineVersion` is the version we believe the file is at RIGHT NOW.
    // It starts at `expectedVersion` (what the caller read) and is updated
    // to `fresh.version` after every retry. Passing it on every attempt
    // closes the TOCTOU window where another writer could slip in between
    // our re-read and our retry write.
    let currentContent = initialContent;
    let baselineVersion = expectedVersion;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await virtualFilesystem.writeFile(
          ownerId,
          filePath,
          currentContent,
          language,
          {
            ...(vfsOptions ?? {}),
            expectedVersion: baselineVersion,
            ...(strictConcurrency ? { strictConcurrency: true } : {}),
          } as any,
        );
      } catch (err: any) {
        // Surface strict-concurrency blocks immediately — no retry.
        if (err?.name === 'ConcurrentModificationError') throw err;

        // Non-OCC failure (disk full, quota, etc.) — don't loop forever.
        if (err?.name !== 'VersionMismatchError') throw err;

        lastError = err;
        let fresh: VersionedFile;
        try {
          fresh = await readWithVersion(ownerId, filePath);
        } catch (readErr: any) {
          // File disappeared between our write and re-read. Treat as a
          // genuine version mismatch with version 0 so the caller can decide.
          throw new VersionMismatchError(
            filePath,
            expectedVersion,
            0,
            attempt,
            `writeWithVersion: file ${filePath} disappeared during CAS retry`,
          );
        }
        if (fresh.version === baselineVersion) {
          // Version unchanged but write still threw VersionMismatchError —
          // shouldn't normally happen, but bail out safely rather than loop.
          throw err;
        }
        baselineVersion = fresh.version;
        currentContent = diffFn(fresh.content);
        // Small jittered backoff to reduce contention on a hot file when
        // many writers are racing. Skipped on the last attempt.
        if (attempt < maxRetries) {
          await sleep(2 + Math.floor(Math.random() * 8));
        }
      }
    }

    // Pass-7 #107: log the retry exhaustion with canonical detection
    // terms before throwing. The meta-monitor can grep on a single token
    // (`mismatch` or `drift`) to find every CAS-exhaustion in run.log.
    logger.warn(
      withDetectionTerms(
        `writeWithVersion: exhausted ${maxRetries} CAS attempts for ${filePath} ` +
          `(last error: ${(lastError as Error)?.message ?? 'unknown'})`,
        DETECTION_TERMS.mismatch,
        DETECTION_TERMS.drift,
      ),
      {
        filePath,
        expectedVersion,
        baselineVersion,
        maxRetries,
      },
    );
    throw new VersionMismatchError(
      filePath,
      expectedVersion,
      baselineVersion,
      maxRetries,
      `writeWithVersion: exhausted ${maxRetries} CAS attempts for ${filePath} (last error: ${
        (lastError as Error)?.message ?? 'unknown'
      })`,
    );
  }

  // Unconditional path
  return virtualFilesystem.writeFile(
    ownerId,
    filePath,
    initialContent,
    language,
    {
      ...(vfsOptions ?? {}),
      ...(strictConcurrency ? { strictConcurrency: true } : {}),
    } as any,
  );
}

// ============================================================================
// Multi-file transactions
// ============================================================================

/**
 * A buffered multi-file edit. `pending` becomes a real write on commit.
 */
export interface TransactionalEdit {
  path: string;
  content: string;
  expectedVersion?: number;
  diffFn?: (currentContent: string) => string;
  language?: string;
}

/**
 * Result of a committed transaction.
 */
export interface TransactionResult {
  success: boolean;
  committed: number;
  failed: number;
  /** Per-file outcome, in commit order. */
  results: Array<{
    path: string;
    success: boolean;
    version?: number;
    error?: string;
  }>;
  /** Total duration in ms. */
  duration: number;
}

/**
 * Snapshot taken at `beginTransaction` so `rollback` can restore state.
 * Stored on the Transaction object; not exposed to callers.
 *
 * `created: true` means the file did NOT exist at transaction start, so
 * rollback should `deletePath` it (not write empty content) to leave the
 * workspace in its pre-transaction state.
 */
interface TransactionSnapshot {
  /** Workspace version at transaction start. */
  workspaceVersion: number;
  /** Per-path content + version at transaction start. */
  files: Array<{ path: string; content: string; version: number; created: boolean }>;
}

/**
 * Multi-file transaction backed by GitBackedVFS batch mode.
 *
 * Lifecycle:
 *   const tx = beginTransaction(ownerId);
 *   tx.write('a.ts', newA);
 *   tx.write('b.ts', newB, { expectedVersion: 4, diffFn: (cur) => cur + newB });
 *   const result = await tx.commit();   // single shadow commit, atomic
 *   // or, on error:
 *   await tx.rollback();                // restore all files to pre-tx state
 *
 * `commit` runs all queued edits through `writeWithVersion` (so each edit
 * gets its own CAS loop), then flushes GitBackedVFS batch mode. `rollback`
 * writes the snapshot back through the base VFS and aborts the transaction.
 */
export class Transaction {
  readonly id: string;
  private readonly ownerId: string;
  private readonly edits: TransactionalEdit[] = [];
  private snapshot: TransactionSnapshot | null = null;
  // `committing` and `rolling-back` are transient states used during work so
  // we don't flip to 'committed' before the writes actually succeed (which
  // used to make rollback() log a spurious "already committed" warning when
  // an edit failed mid-commit). Only the final terminal state is 'committed'
  // or 'rolled-back'.
  private state: 'open' | 'committing' | 'committed' | 'rolling-back' | 'rolled-back' = 'open';

  constructor(ownerId: string, id?: string) {
    this.ownerId = ownerId;
    this.id = id ?? `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Queue a write. `expectedVersion` and `diffFn` enable per-file CAS.
   * Returns the Transaction for chaining.
   */
  write(
    filePath: string,
    content: string,
    options: { expectedVersion?: number; diffFn?: (cur: string) => string; language?: string } = {},
  ): this {
    if (this.state !== 'open') {
      throw new Error(`Transaction ${this.id} is ${this.state}; cannot queue more writes`);
    }
    this.edits.push({
      path: filePath,
      content,
      ...(options.expectedVersion !== undefined ? { expectedVersion: options.expectedVersion } : {}),
      ...(options.diffFn ? { diffFn: options.diffFn } : {}),
      ...(options.language ? { language: options.language } : {}),
    });
    return this;
  }

  /** Number of queued edits. */
  get size(): number {
    return this.edits.length;
  }

  /** True if the transaction can still accept writes / commit / rollback. */
  get isOpen(): boolean {
    return this.state === 'open';
  }

  /**
   * Commit all queued edits. Each edit goes through `writeWithVersion`
   * (with its own retry loop). On any per-file failure the whole transaction
   * is rolled back and a failed result is returned. GitBackedVFS batch mode
   * ensures the workspace ships a single shadow commit.
   */
  async commit(): Promise<TransactionResult> {
    if (this.state !== 'open') {
      throw new Error(`Transaction ${this.id} is ${this.state}; cannot commit`);
    }
    // Flip to the transient 'committing' state (not 'committed') so that if
    // an edit fails mid-commit and we call rollback(), rollback() sees
    // 'committing' (not 'committed') and does the actual restore work
    // instead of logging a spurious "already committed" warning.
    this.state = 'committing';
    const startTime = Date.now();

    if (this.edits.length === 0) {
      this.state = 'committed';
      return { success: true, committed: 0, failed: 0, results: [], duration: 0 };
    }

    // Take a snapshot of pre-transaction file state for rollback.
    this.snapshot = await takeSnapshot(this.ownerId, this.edits.map((e) => e.path));

    // Open GitBackedVFS batch mode so all writes coalesce into a single commit.
    const gitVFS = virtualFilesystem.forOwner(this.ownerId);
    gitVFS.enableBatchMode(this.ownerId);

    const results: TransactionResult['results'] = [];
    let committed = 0;
    let failed = 0;

    try {
      for (const edit of this.edits) {
        try {
          const written = await writeWithVersion(this.ownerId, edit.path, edit.content, {
            ...(edit.expectedVersion !== undefined ? { expectedVersion: edit.expectedVersion } : {}),
            ...(edit.diffFn ? { diffFn: edit.diffFn } : {}),
            ...(edit.language ? { language: edit.language } : {}),
            maxRetries: 3,
            strictConcurrency: true,
          });
          results.push({ path: edit.path, success: true, version: written.version });
          committed++;
        } catch (err: any) {
          const errName = err?.name ?? 'Error';
          const errMsg = err?.message ?? String(err);
          results.push({ path: edit.path, success: false, error: `${errName}: ${errMsg}` });
          failed++;
          // First failure → roll back the whole transaction. State is
          // currently 'committing' so rollback() will do the real work.
          logger.warn(
            withDetectionTerms(
              `[VFS:TX ${this.id}] Edit failed for ${edit.path}; rolling back`,
              DETECTION_TERMS.mismatch,
              DETECTION_TERMS.drift,
            ),
            {
              error: errMsg,
              errorName: errName,
              txId: this.id,
              path: edit.path,
            },
          );
          await this.rollback();
          return {
            success: false,
            committed,
            failed,
            results,
            duration: Date.now() - startTime,
          };
        }
      }
      // Flush batch — single shadow commit for the whole transaction.
      const flushResult = await gitVFS.flushBatch();
      if (!flushResult.success) {
        await this.rollback();
        return {
          success: false,
          committed,
          failed: failed + 1,
          results: [
            ...results,
            { path: '<flush>', success: false, error: flushResult.error ?? 'flush failed' },
          ],
          duration: Date.now() - startTime,
        };
      }
    } finally {
      // Safety: ensure batch mode is exited even on unexpected throws.
      try {
        gitVFS.disableBatchMode();
      } catch {
        /* no-op — disableBatchMode is idempotent */
      }
    }

    // Only NOW flip to the terminal 'committed' state — all writes flushed.
    this.state = 'committed';
    return {
      success: failed === 0,
      committed,
      failed,
      results,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Roll back the transaction: restore all snapshot files, exit batch mode,
   * and discard queued edits. Safe to call multiple times — second call is
   * a no-op.
   *
   * For files that did not exist at transaction start (snapshot.created
   * is true), rollback calls `deletePath` to leave the workspace in its
   * pre-transaction state instead of writing empty content.
   */
  async rollback(): Promise<void> {
    if (this.state === 'rolled-back') return;
    if (this.state === 'committed') {
      // Best-effort: log but don't throw — caller may have already moved on.
      logger.warn(`[VFS:TX ${this.id}] rollback() called on already-committed transaction`);
      this.state = 'rolled-back';
      return;
    }
    // 'open' or 'committing' or 'rolling-back' — do the actual restore.
    this.state = 'rolling-back';

    // Exit batch mode first so the rollback writes don't get coalesced.
    try {
      const gitVFS = virtualFilesystem.forOwner(this.ownerId);
      gitVFS.disableBatchMode();
    } catch (err: any) {
      logger.warn(`[VFS:TX ${this.id}] disableBatchMode failed during rollback`, {
        error: err?.message,
      });
    }

    if (!this.snapshot) {
      // No edits were attempted yet; nothing to restore.
      this.state = 'rolled-back';
      return;
    }

    for (const file of this.snapshot.files) {
      try {
        if (file.created) {
          // File was created by this transaction — remove it on rollback.
          // deletePath is tolerant: a missing file is not an error.
          await virtualFilesystem.deletePath(this.ownerId, file.path);
        } else {
          await virtualFilesystem.writeFile(this.ownerId, file.path, file.content);
        }
      } catch (err: any) {
        logger.error(`[VFS:TX ${this.id}] Rollback failed for ${file.path}`, {
          error: err?.message,
          created: file.created,
        });
      }
    }

    this.state = 'rolled-back';
  }
}

/**
 * Begin a new multi-file transaction. Returns a Transaction object the
 * caller can `.write()` on and then `.commit()` or `.rollback()`.
 */
export function beginTransaction(ownerId: string, id?: string): Transaction {
  return new Transaction(ownerId, id);
}

// ============================================================================
// Internals
// ============================================================================

async function takeSnapshot(
  ownerId: string,
  paths: string[],
): Promise<TransactionSnapshot> {
  const workspaceVersion = await virtualFilesystem.getWorkspaceVersion(ownerId);
  const files: TransactionSnapshot['files'] = [];
  for (const p of paths) {
    try {
      const f = await virtualFilesystem.readFile(ownerId, p);
      files.push({ path: f.path, content: f.content, version: f.version, created: false });
    } catch {
      // File doesn't exist yet — mark as `created: true` so rollback
      // will deletePath it instead of writing empty content.
      files.push({ path: p, content: '', version: 0, created: true });
    }
  }
  return { workspaceVersion, files };
}

/**
 * Tiny sleep helper used by the CAS retry loop to add a jittered backoff
 * between attempts. Kept local to avoid pulling in a util dependency.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
