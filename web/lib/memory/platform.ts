/**
 * platform.ts — Platform abstraction layer
 *
 * Detects if running in Tauri (desktop) or browser (web)
 * and exports the right implementations.
 *
 * Use these everywhere instead of calling Tauri/browser APIs directly.
 */

// ─── Detection ────────────────────────────────────────────────────────────────

export const isDesktop = typeof window !== "undefined" &&
  "__TAURI__" in window;

// ─── File System ──────────────────────────────────────────────────────────────

export interface FileEntry {
  path: string;
  content: string;
  size: number;
}

/** Read a file by path */
export async function readFile(path: string): Promise<string> {
  if (isDesktop) {
    // @ts-ignore - Tauri API only available in desktop builds
    const { readTextFile } = await import("@tauri-apps/api/fs");
    return readTextFile(path);
  }
  throw new Error("Direct file reading not supported in web — use file upload");
}

/** Write a file by path */
export async function writeFile(path: string, content: string): Promise<void> {
  if (isDesktop) {
    // @ts-ignore - Tauri API only available in desktop builds
    const { writeTextFile } = await import("@tauri-apps/api/fs");
    return writeTextFile(path, content);
  }
  // Web: trigger download
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() ?? "file.txt";
  a.click();
  URL.revokeObjectURL(url);
}

/** Read all code files under a directory (desktop only) */
export async function readDirectory(
  rootPath: string,
  extensions = ["ts", "tsx", "js", "jsx", "py", "rs"]
): Promise<FileEntry[]> {
  if (!isDesktop) {
    throw new Error("readDirectory is only available on desktop");
  }

  // @ts-ignore - Tauri only available in desktop builds
  const invoke = (await import(/* webpackIgnore: true */ "@tauri-apps/api/tauri")).invoke;
  const files: Array<{ path: string; content: string }> = await invoke(
    "read_directory_files",
    { path: rootPath, extensions }
  );

  return files.map((f: { path: string; content: string }) => ({
    path: f.path,
    content: f.content,
    size: f.content.length,
  }));
}

// ─── File Watcher ─────────────────────────────────────────────────────────────

export type FileChangeEvent = {
  type: "created" | "modified" | "deleted";
  path: string;
};

/**
 * Watch a directory for file changes.
 * Desktop only — web returns a no-op cleanup.
 */
export async function watchDirectory(
  path: string,
  onChange: (event: FileChangeEvent) => void
): Promise<() => void> {
  if (!isDesktop) {
    // Web: no-op — simulate with manual re-index on upload
    return () => {};
  }

  // @ts-ignore - Tauri API only available in desktop builds
  const { invoke } = await import(/* webpackIgnore: true */ "@tauri-apps/api/tauri");
  // @ts-ignore - Tauri API only available in desktop builds
  const { listen } = await import(/* webpackIgnore: true */ "@tauri-apps/api/event");

  const watchId = `watch-${Math.random().toString(36).substring(7)}`;

  // Start the Rust watcher
  await invoke("start_file_watcher", { watchId, watchPath: path });

  // Listen for events emitted by Rust
  const unlisten = await listen<any>("fs-watch-event", (event) => {
    if (event.payload.watchId === watchId) {
      const type: FileChangeEvent["type"] =
        event.payload.changeType === "delete" ? "deleted" :
        event.payload.changeType === "create" ? "created" :
        "modified";
      onChange({ type, path: event.payload.path });
    }
  });

  return async () => {
    unlisten();
    await invoke("stop_file_watcher", { watchId });
  };
}

// ─── Grep Search ──────────────────────────────────────────────────────────────

export interface GrepMatch {
  filePath: string;
  line: number;
  matchLine: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface GrepOptions {
  files: FileEntry[];
  rootPath?: string;
}

/**
 * Search file contents for a query string (case-insensitive).
 * Works on both desktop and web.
 */
export function grepFiles(
  query: string,
  opts: GrepOptions,
  contextLines = 2
): GrepMatch[] {
  if (!opts.files) return [];

  const results: GrepMatch[] = [];

  for (const file of opts.files) {
    const lines = file.content.split("\n");
    const lowerQuery = query.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lowerQuery)) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length - 1, i + contextLines);
        results.push({
          filePath: file.path,
          line: i + 1,
          matchLine: lines[i],
          contextBefore: lines.slice(start, i),
          contextAfter: lines.slice(i + 1, end + 1),
        });
      }
    }
  }

  return results;
}

// ─── Dialog / Picker ──────────────────────────────────────────────────────────

/** Open a folder picker (desktop only) */
export async function pickFolder(): Promise<string | null> {
  if (!isDesktop) return null;

  // @ts-ignore - Tauri API only available in desktop builds
  const { open } = await import(/* webpackIgnore: true */ "@tauri-apps/api/dialog");
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}
