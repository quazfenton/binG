/**
 * file-watcher-reindex.ts — Auto-reindex when files change
 *
 * Watches a project directory for file changes and triggers incremental
 * reindexing of changed files only (SHA-256 hash check skips unchanged files).
 *
 * On web: no-op (file watching requires desktop).
 * On desktop: uses Tauri file watcher or periodic polling fallback.
 *
 * Debounces rapid changes (e.g. git checkout of 100 files) to avoid
 * overwhelming the indexer.
 */

import { ProjectIndexer } from "./indexer";
import { watchDirectory, isDesktop, type FileChangeEvent } from "./platform";
import { increment, trace } from "../agent/metrics";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("FileWatcherReindex");

export interface WatcherReindexOptions {
  /** Project root path to watch */
  projectPath: string;
  /** Project ID for indexer */
  projectId: string;
  /** File extensions to watch (default: code files) */
  extensions?: string[];
  /** Debounce window in ms — batches rapid changes (default: 2000) */
  debounceMs?: number;
  /** Called when a file is reindexed */
  onReindex?: (path: string, symbolsIndexed: number) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

export interface WatcherHandle {
  /** Stop watching */
  stop: () => void;
}

/**
 * Watch a project directory and auto-reindex changed files.
 * Returns a handle to stop watching.
 */
export function watchAndReindex(
  opts: WatcherReindexOptions
): WatcherHandle {
  const {
    projectPath,
    projectId,
    extensions = ["ts", "tsx", "js", "jsx", "py", "rs", "go", "css", "scss", "vue", "svelte"],
    debounceMs = 2_000,
    onReindex,
    onError,
  } = opts;

  // Create a single indexer for this project
  const indexer = new ProjectIndexer(projectId);

  // Debounce: batch rapid file changes
  let pendingChanges = new Map<string, FileChangeEvent>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function processPendingChanges() {
    if (pendingChanges.size === 0) return;

    const changes = Array.from(pendingChanges.values());
    pendingChanges.clear();
    debounceTimer = null;

    // Group by path — only process latest state per file
    const byPath = new Map<string, FileChangeEvent>();
    for (const change of changes) {
      byPath.set(change.path, change);
    }

    let totalSymbols = 0;

    for (const [path, change] of byPath) {
      // Skip non-code files
      const ext = path.split(".").pop()?.toLowerCase();
      if (ext && !extensions.includes(ext)) continue;

      try {
        if (change.type === "deleted") {
          // Deleted file: remove its symbols from the store
          const { deleteFileSymbols } = await import("./vectorStore");
          await deleteFileSymbols(projectId, path);
          increment("watcher-deleted", 1);
          logger.debug("Deleted file removed from index", { path });
        } else {
          // Modified or created: read content and reindex
          const { readTextFile } = await import("@tauri-apps/api/fs");
          const content = await readTextFile(path);

          const result = await trace("watcher-reindex", () =>
            indexer.indexFile(path, content)
          );

          if (!result.skipped) {
            totalSymbols += result.symbolsIndexed;
            onReindex?.(path, result.symbolsIndexed);
            increment("watcher-reindexed", 1);
          }
        }
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }

    // Recompute PageRank if we indexed anything
    if (totalSymbols > 0) {
      await indexer.recomputePageRank();
    }
  }

  function onChange(event: FileChangeEvent) {
    pendingChanges.set(event.path, event);

    if (!debounceTimer) {
      debounceTimer = setTimeout(processPendingChanges, debounceMs);
    }
  }

  // Start watching
  let stopWatching: () => void = () => {};

  if (isDesktop) {
    watchDirectory(projectPath, onChange)
      .then(stop => { stopWatching = stop; })
      .catch(err => {
        logger.error("Failed to start file watcher, falling back to polling", err);
        startPollingFallback(projectPath, onChange, extensions);
      });
  }

  return {
    stop: () => {
      stopWatching();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}

/**
 * Polling fallback for environments where Tauri file watcher is unavailable.
 * Checks file modification times periodically.
 */
function startPollingFallback(
  projectPath: string,
  onChange: (event: FileChangeEvent) => void,
  extensions: string[],
) {
  // Simple polling: check file mtimes every 10 seconds
  const POLL_INTERVAL = 10_000;
  let knownMtimes = new Map<string, number>();

  async function poll() {
    try {
      // For web-only mode, we can't poll the filesystem.
      // This is a no-op on web.
      if (!isDesktop) return;

      const { invoke } = await import("@tauri-apps/api/tauri");
      const files: Array<{ path: string; mtime: number }> = await invoke(
        "list_file_mtimes",
        { path: projectPath, extensions }
      );

      for (const file of files) {
        const prevMtime = knownMtimes.get(file.path);
        if (prevMtime === undefined) {
          // New file
          onChange({ type: "created", path: file.path });
        } else if (file.mtime > prevMtime) {
          // Modified
          onChange({ type: "modified", path: file.path });
        }
        knownMtimes.set(file.path, file.mtime);
      }

      // Check for deletions
      for (const [path] of knownMtimes) {
        if (!files.some(f => f.path === path)) {
          onChange({ type: "deleted", path });
          knownMtimes.delete(path);
        }
      }
    } catch {
      // Polling failed — try again next interval
    }
  }

  const timer = setInterval(poll, POLL_INTERVAL);

  // Return cleanup
  return () => clearInterval(timer);
}
