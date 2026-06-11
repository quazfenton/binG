/**
 * Shared VFS error classes.
 *
 * Lifted out of `transactional-vfs.ts` so the base `VirtualFilesystemService`
 * can import them via a normal static `import` (no more
 * `require('@/lib/vfs/transactional-vfs')` cycle) and tests can construct
 * deterministic instances without poking the module graph.
 *
 * If you add a new error here, also re-export it from `vfs/index.ts` and
 * from the test helpers in `vfs/__tests__/`.
 */

/**
 * Thrown when a write is rejected because the per-file version token does
 * not match `expectedVersion` after exhausting the retry budget. The caller
 * can inspect `actualVersion` / `attempts` to decide whether to back off,
 * surface to the user, or merge manually.
 */
export class VersionMismatchError extends Error {
  readonly path: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;
  readonly attempts: number;
  constructor(
    path: string,
    expectedVersion: number,
    actualVersion: number,
    attempts: number,
    message?: string,
  ) {
    super(
      message ??
        `Version mismatch for ${path}: expected v${expectedVersion} but found v${actualVersion} after ${attempts} attempts`,
    );
    this.name = 'VersionMismatchError';
    this.path = path;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
    this.attempts = attempts;
  }
}

/**
 * Thrown in strict-concurrency mode when the VFS detects that the file was
 * modified within the concurrent-modification threshold (default 100ms in
 * production, 50ms in tests). This is the "block" half of the user request
 * — the base VFS would otherwise just emit a [WARN] log.
 */
export class ConcurrentModificationError extends Error {
  readonly path: string;
  readonly timeSinceLastWrite: number;
  readonly threshold: number;
  readonly previousVersion: number;
  constructor(
    path: string,
    timeSinceLastWrite: number,
    threshold: number,
    previousVersion: number,
  ) {
    super(
      `Potential concurrent modification blocked for ${path} ` +
        `(${timeSinceLastWrite}ms since last write, threshold ${threshold}ms, v${previousVersion})`,
    );
    this.name = 'ConcurrentModificationError';
    this.path = path;
    this.timeSinceLastWrite = timeSinceLastWrite;
    this.threshold = threshold;
    this.previousVersion = previousVersion;
  }
}
