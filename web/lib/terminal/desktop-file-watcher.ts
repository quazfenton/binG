/**
 * Desktop File Watcher
 *
 * Replaces the regex-based file change detection in desktop-pty-provider.ts
 * with a real filesystem watcher that detects actual file events via fs.watch.
 *
 * Architecture:
 *   Before: Parse PTY stdout with 20+ regex patterns → guess file changes
 *   After:  fs.watch(workspaceDir, { recursive: true }) → real events → emitFilesystemUpdated
 *
 * Features:
 *   - Recursive watching of the workspace directory
 *   - Debouncing (coalesce rapid edits into a single sync)
 *   - Batch processing (read files in parallel, limit concurrency)
 *   - Skip patterns (.git, node_modules, etc.)
 *   - Size limits (skip files > 5MB)
 *   - Proper cleanup via stop()
 *   - Tauri native watcher fallback (via start_file_watcher for desktop mode)
 */

import type { FSWatcher, constants } from 'fs';
import * as path from 'path';
import { createLogger } from '@/lib/utils/logger';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';

// Dynamic imports for Node.js modules to avoid client-side bundling errors
const getFs = async () => {
  if (typeof window === 'undefined') {
    return await import('fs');
  }
  return null;
};

const logger = createLogger('DesktopFileWatcher');

// === Configuration ===

const DEBOUNCE_MS = 300;           // Coalesce events within this window
const MAX_CONCURRENT_READS = 3;    // Parallel file reads during sync
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB skip threshold
const BATCH_SIZE = 20;             // Max files per batch sync cycle
const POLL_FALLBACK_INTERVAL_MS = 1500; // Fallback polling if fs.watch unavailable

/** Paths/patterns to exclude from watching */
const EXCLUDE_PATTERNS = [
  /[\\/]\.git[\\/]/,
  /[\\/]node_modules[\\/]/,
  /[\\/]\.binG-temp[\\/]/,
  /[\\/]\.next[\\/]/,
  /[\\/]__pycache__[\\/]/,
  /\.lock$/,
  /\.log$/,
  /\.pyc$/,
  /~$/,
];

// === Types ===

export type FileChangeType = 'create' | 'update' | 'delete';

interface PendingChange {
  filePath: string;
  type: FileChangeType;
  timestamp: number;
}

export interface FileWatcherHandle {
  /** Stop watching and clean up */
  stop: () => Promise<void>;
  /** Whether the watcher is still active */
  isActive: boolean;
}

// === Public API ===

/**
 * Start watching a workspace directory for file changes.
 * Detects creates, modifications, and deletes via fs.watch.
 * Debounces rapid events and syncs file content to VFS via emitFilesystemUpdated.
 *
 * @param workspaceRoot - Absolute path to the workspace directory
 * @param userId - User identifier for VFS sync
 * @param onFileChange - Optional callback for raw file change events
 * @returns A handle to stop the watcher
 */
export function startFileWatcher(
  workspaceRoot: string,
  userId: string,
  onFileChange?: (filePath: string, type: FileChangeType) => void
): FileWatcherHandle {
  const normalizedRoot = path.resolve(workspaceRoot);
  let stopped = false;

  // Pending changes map: fullPath → PendingChange
  const pendingChanges = new Map<string, PendingChange>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isProcessing = false;

  // Known file set for create-vs-update detection
  const knownFiles = new Set<string>();

  logger.info('Starting file watcher', { workspaceRoot: normalizedRoot, userId });

  /**
   * Check if a file path should be excluded from watching.
   */
  function shouldExclude(filePath: string): boolean {
    // Skip the workspace root itself
    if (filePath === normalizedRoot) return true;
    return EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
  }

  /**
   * Queue a file change for debounced processing.
   */
  function queueChange(filePath: string, changeType: FileChangeType): void {
    if (stopped) return;
    if (shouldExclude(filePath)) return;

    const absPath = path.resolve(filePath);

    // Normalize: if a file is being deleted, remove any pending create/update
    if (changeType === 'delete') {
      knownFiles.delete(absPath);
    } else {
      knownFiles.add(absPath);
    }

    // Upsert the pending change (latest type wins for same file)
    pendingChanges.set(absPath, { filePath: absPath, type: changeType, timestamp: Date.now() });

    // Reset debounce timer
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => processBatch(), DEBOUNCE_MS);
  }

  /**
   * Scan a directory recursively to build initial known-files snapshot.
   */
  async function scanDirectory(dir: string): Promise<void> {
    if (stopped) return;
    const fs = await getFs();
    if (!fs) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (shouldExclude(fullPath)) continue;
        try {
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (entry.isFile()) {
            const stat = fs.statSync(fullPath);
            if (stat.size <= MAX_FILE_SIZE) {
              knownFiles.add(fullPath);
            }
          }
        } catch { /* stat may fail — skip */ }
      }
    } catch { /* directory may not exist yet */ }
  }

  /**
   * Process a batch of pending changes and sync to VFS.
   */
  async function processBatch(): Promise<void> {
    if (stopped || isProcessing || pendingChanges.size === 0) return;

    isProcessing = true;

    try {
      // Take up to BATCH_SIZE pending changes
      const changes = Array.from(pendingChanges.values())
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, BATCH_SIZE);

      // Remove processed changes from queue
      for (const change of changes) {
        pendingChanges.delete(change.filePath);
      }

      logger.debug('Processing file sync batch', { count: changes.length, remaining: pendingChanges.size });

      // Process deletions first (no file read needed)
      const deletions = changes.filter((c) => c.type === 'delete');
      const createsOrUpdates = changes.filter((c) => c.type !== 'delete');

      for (const { filePath } of deletions) {
        emitFilesystemUpdated({
          path: filePath,
          paths: [filePath],
          type: 'delete',
          source: 'desktop-file-watcher',
          sessionId: userId,
          workspaceVersion: Date.now(),
        });
        onFileChange?.(filePath, 'delete');
      }

      // Process creates/updates with truly async parallel file reads
      for (let i = 0; i < createsOrUpdates.length; i += MAX_CONCURRENT_READS) {
        const batch = createsOrUpdates.slice(i, i + MAX_CONCURRENT_READS);
        await Promise.all(
          batch.map((change) => syncFileToVfs(change, normalizedRoot, userId, onFileChange))
        );
      }

      // If more pending, schedule another batch
      if (pendingChanges.size > 0) {
        debounceTimer = setTimeout(() => processBatch(), DEBOUNCE_MS);
      }
    } catch (err: any) {
      logger.error('Error processing file sync batch', { error: err.message });
    } finally {
      if (pendingChanges.size === 0) {
        isProcessing = false;
      }
    }
  }

  /**
   * Read a file from disk and sync its content to VFS.
   * Uses the change type from the PendingChange object (not re-derived from knownFiles)
   * to correctly distinguish creates from updates.
   */
  async function syncFileToVfs(
    change: PendingChange,
    root: string,
    uid: string,
    onFileChangeCb?: (filePath: string, type: FileChangeType) => void
  ): Promise<void> {
    const { filePath, type: changeType } = change;
    const fs = await getFs();
    if (!fs) return;

    try {
      // Check if file still exists and is within size limit
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) return;
      if (stat.size > MAX_FILE_SIZE) {
        logger.debug('Skipping large file in watcher sync', { path: filePath, size: stat.size });
        return;
      }

      // Read file content (truly async)
      const content = await fs.promises.readFile(filePath, 'utf-8');

      // Compute relative path
      let relativePath = filePath;
      if (filePath.startsWith(root + path.sep)) {
        relativePath = filePath.slice(root.length + 1);
      }

      emitFilesystemUpdated({
        path: filePath,
        paths: [filePath],
        type: changeType,
        source: 'desktop-file-watcher',
        sessionId: uid,
        workspaceVersion: Date.now(),
        applied: { content, relativePath },
      });

      // Fire callback only once here (not duplicated in processBatch for creates/updates)
      onFileChangeCb?.(filePath, changeType);
      logger.debug('Synced file to VFS via watcher', { path: relativePath, type: changeType, size: stat.size });
    } catch (err: any) {
      // File may have been deleted between detection and read — that's OK
      if (err.code !== 'ENOENT') {
        logger.debug('Failed to sync file via watcher', { path: filePath, error: err.message });
      }
    }
  }

  // === Start watching ===

  // Declare handle first so async IIFE can reference it
  const handle: FileWatcherHandle = {
    get isActive() { return !stopped; },
    stop: async () => {
      if (stopped) return;
      stopped = true;

      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      logger.info('File watcher stopped', { workspaceRoot: normalizedRoot });
    },
  };

  // Use an async IIFE to handle watcher initialization since startFileWatcher is synchronous
  (async () => {
    // Build initial snapshot
    try {
      await scanDirectory(normalizedRoot);
    } catch { /* workspace may not exist yet */ }

    const fs = await getFs();
    if (!fs) return;

    let watcher: FSWatcher | null = null;

    try {
      watcher = fs.watch(normalizedRoot, { recursive: true }, (eventType, filename) => {
        if (!filename || stopped) return;
        const fullPath = path.join(normalizedRoot, filename);

        if (eventType === 'rename') {
          // On Linux, 'rename' means either created or deleted
          // Check if the file exists to disambiguate
          try {
            fs.accessSync(fullPath, (fs.constants as any).F_OK);
            queueChange(fullPath, 'create');
          } catch {
            queueChange(fullPath, 'delete');
          }
        } else {
          // 'change' event — file was modified
          queueChange(fullPath, 'update');
        }
      });

      watcher.on('error', (err) => {
        logger.error('fs.watch error', { error: err.message, workspaceRoot: normalizedRoot });
        // Close the broken watcher to prevent repeated errors
        try { watcher?.close(); } catch { /* ignore */ }
        watcher = null;
        // Fall back to polling
        if (!stopped) startPollingFallback();
      });

      logger.info('fs.watch started', { workspaceRoot: normalizedRoot });
      
      // Update the handle's stop function to close this specific watcher
      const originalStop = handle.stop;
      handle.stop = async () => {
        await originalStop();
        if (watcher) {
          try { watcher.close(); } catch { /* ignore */ }
          watcher = null;
        }
      };
    } catch (err: any) {
      logger.warn('fs.watch unavailable, falling back to polling', { error: err.message });
      startPollingFallback();
    }
  })();

  // === Polling fallback ===

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function startPollingFallback(): Promise<void> {
    if (stopped || pollInterval) return;
    const fs = await getFs();
    if (!fs) return;

    logger.info('Starting polling fallback for file watcher', { workspaceRoot: normalizedRoot });

    // Track file state for diff-based detection
    const fileStates = new Map<string, { mtime: number; size: number }>();

    pollInterval = setInterval(() => {
      if (stopped) return;
      try {
        const currentFiles = new Map<string, { mtime: number; size: number }>();

        function walkPoll(dir: string): void {
          try {
            const entries = fs!.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (shouldExclude(fullPath)) continue;
              try {
                if (entry.isSymbolicLink()) continue;
                if (entry.isDirectory()) {
                  walkPoll(fullPath);
                } else if (entry.isFile()) {
                  const stat = fs!.statSync(fullPath);
                  if (stat.size <= MAX_FILE_SIZE) {
                    currentFiles.set(fullPath, { mtime: stat.mtimeMs, size: stat.size });
                  }

                  const prev = fileStates.get(fullPath);
                  if (!prev) {
                    queueChange(fullPath, 'create');
                  } else if (stat.mtimeMs > prev.mtime || stat.size !== prev.size) {
                    queueChange(fullPath, 'update');
                  }
                }
              } catch { /* stat may fail */ }
            }
          } catch { /* directory may disappear */ }
        }

        walkPoll(normalizedRoot);

        // Detect deletions
        for (const [filePath] of fileStates) {
          if (!currentFiles.has(filePath)) {
            queueChange(filePath, 'delete');
          }
        }

        // Update state
        fileStates.clear();
        for (const [k, v] of currentFiles) fileStates.set(k, v);
      } catch (err: any) {
        logger.debug('Poll watcher error', { error: err.message });
      }
    }, POLL_FALLBACK_INTERVAL_MS);
  }

  return handle;
}