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

  // @ts-ignore - Tauri API only available in desktop builds
  const { invoke } = await import("@tauri-apps/api/tauri");
  const files: Array<{ path: string; content: string }> = await invoke(
    "read_directory_files",
    { path: rootPath, extensions }
  );

  return files.map((f) => ({
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
  const { appWindow } = await import("@tauri-apps/api/window");
  // @ts-ignore - Tauri API only available in desktop builds
  const { invoke } = await import("@tauri-apps/api/tauri");

  // Start the Rust watcher
  await invoke("watch_directory", { path });

  // Listen for events emitted by Rust
  const unlisten = await appWindow.listen<FileChangeEvent>(
    "file-change",
    (event) => onChange(event.payload)
  );

  return () => unlisten();
}

// ─── Grep (fast file search) ──────────────────────────────────────────────────

export interface GrepMatch {
  filePath: string;
  line: number;
  matchLine: string;
  contextBefore: string[];
  contextAfter: string[];
}

/**
 * Search files for a string query.
 * Desktop: Rust/walkdir (fast).
 * Web: JS in-memory search over provided files.
 */
export async function grepFiles(
  query: string,
  opts: {
    rootPath?: string; // desktop
    files?: Array<{ path: string; content: string }>; // web
    contextLines?: number;
  }
): Promise<GrepMatch[]> {
  const contextLines = opts.contextLines ?? 2;

  if (isDesktop && opts.rootPath) {
    // @ts-ignore - Tauri API only available in desktop builds
    const { invoke } = await import("@tauri-apps/api/tauri");
    // @ts-ignore - Tauri invoke is dynamically typed
    return invoke<GrepMatch[]>("grep_search", {
      root: opts.rootPath,
      query,
      contextLines,
    });
  }

  if (!opts.files) return [];

  const results: GrepMatch[] = [];

  for (const file of opts.files) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(query.toLowerCase())) {
        results.push({
          filePath: file.path,
          line: i + 1,
          matchLine: lines[i],
          contextBefore: lines.slice(Math.max(0, i - contextLines), i),
          contextAfter: lines.slice(i + 1, i + 1 + contextLines),
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
  const { open } = await import("@tauri-apps/api/dialog");
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}
