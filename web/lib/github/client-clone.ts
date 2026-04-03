/**
 * Client-side GitHub repo cloner
 *
 * Uses GitHub API zipball endpoint + JSZip to extract in memory,
 * then writes files to the user's VFS via API calls.
 *
 * Zero server-side git operations, zero temp files.
 */

"use client";

import JSZip from "jszip";
import { buildApiHeaders } from "@/lib/utils";
import { emitFilesystemUpdated } from "@/lib/virtual-filesystem/sync/sync-events";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const SKIP_DIRS = new Set([
  "node_modules", ".next", "dist", "build",
  "__pycache__", ".venv", "venv", ".turbo", ".cache",
  "coverage", ".nyc_output", "target",
]);
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".rar", ".7z", ".bz2",
  ".exe", ".dll", ".so", ".dylib", ".a", ".lib",
  ".pyc", ".pyo", ".class", ".o", ".obj",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".mp3", ".mp4", ".avi", ".mov", ".webm",
  ".wasm", ".bin", ".dat",
]);

const LANG_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp",
  ".c": "c",
  ".h": "c", ".hpp": "cpp", ".hxx": "cpp",
  ".swift": "swift",
  ".kt": "kotlin", ".kts": "kotlin",
  ".html": "html", ".htm": "html",
  ".css": "css",
  ".scss": "scss", ".sass": "sass", ".less": "less",
  ".json": "json",
  ".xml": "xml",
  ".yaml": "yaml", ".yml": "yaml",
  ".md": "markdown", ".mdx": "markdown",
  ".txt": "text",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell", ".fish": "fish",
  ".sql": "sql",
  ".graphql": "graphql", ".gql": "graphql",
  ".toml": "toml",
  ".ini": "ini", ".cfg": "ini", ".conf": "ini",
  ".env": "shell",
  ".lua": "lua",
  ".r": "r", ".R": "r",
  ".dart": "dart",
  ".vue": "vue",
  ".svelte": "svelte",
};

function detectLanguage(filePath: string): string | undefined {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return LANG_MAP[ext];
}

function shouldSkipFile(path: string): boolean {
  const parts = path.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    // Skip known large/irrelevant directories
    if (SKIP_DIRS.has(part)) return true;
    // Skip hidden directories (including .git) but not hidden files at the end
    if (part.startsWith(".") && part !== "." && part !== "..") return true;
  }
  // Check binary extension
  const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  return false;
}

export interface CloneProgress {
  phase: "downloading" | "extracting" | "writing" | "done" | "error";
  filesProcessed: number;
  filesWritten: number;
  filesSkipped: number;
  totalFiles: number;
  currentFile?: string;
  error?: string;
}

export type CloneProgressCallback = (progress: CloneProgress) => void;

export interface CloneOptions {
  branch?: string;
  onProgress?: CloneProgressCallback;
  githubToken?: string;
  signal?: AbortSignal;
}

/**
 * Clone a GitHub repository to the user's VFS entirely client-side.
 *
 * @param owner - GitHub repo owner
 * @param repo - GitHub repo name
 * @param vfsPath - VFS destination path (e.g., "sessions/my-repo")
 * @param options - Optional configuration
 */
export async function cloneRepoToVFS(
  owner: string,
  repo: string,
  vfsPath: string,
  options: CloneOptions = {},
): Promise<{ filesWritten: number; filesSkipped: number; vfsPath: string }> {
  const { branch, onProgress, githubToken, signal } = options;
  const report = (p: CloneProgress) => {
    if (signal?.aborted) throw new DOMException("Clone aborted", "AbortError");
    onProgress?.(p);
  };

  report({ phase: "downloading", filesProcessed: 0, filesWritten: 0, filesSkipped: 0, totalFiles: 0 });

  // Use server-side proxy to bypass CORS restrictions on GitHub's zipball endpoint
  const zipUrl = `/api/github/zipball/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`;

  const response = await fetch(zipUrl, { signal });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Repository ${owner}/${repo} not found`);
    }
    if (response.status === 403) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(
        `GitHub API rate limit exceeded.${retryAfter ? ` Retry after ${retryAfter}s.` : ""} Add a token for higher limits.`,
      );
    }
    throw new Error(`Failed to download repo: ${response.statusText}`);
  }

  report({ phase: "extracting", filesProcessed: 0, filesWritten: 0, filesSkipped: 0, totalFiles: 0 });

  // Download as blob and extract with JSZip
  const blob = await response.blob();
  const zip = await JSZip.loadAsync(blob);
  // Blob reference released after JSZip processes it (GC will reclaim)

  // Find the root folder name (GitHub zipballs wrap everything in owner-repo-sha/)
  const rootFolder = Object.keys(zip.files).find((f) => f.endsWith("/"))?.split("/")[0] || "";

  const fileEntries = Object.entries(zip.files).filter(([_, entry]) => !entry.dir);

  report({
    phase: "writing",
    filesProcessed: 0,
    filesWritten: 0,
    filesSkipped: 0,
    totalFiles: fileEntries.length,
  });

  let filesWritten = 0;
  let filesSkipped = 0;
  let filesProcessed = 0;
  const writtenPaths: string[] = [];

  // Concurrency pool to process files in parallel (limit: 10 concurrent writes)
  const CONCURRENCY_LIMIT = 10;
  const semaphore = { count: CONCURRENCY_LIMIT, queue: [] as Array<() => void> };

  const acquire = (): Promise<void> => {
    if (semaphore.count > 0) {
      semaphore.count--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => semaphore.queue.push(resolve));
  };

  const release = () => {
    if (semaphore.queue.length > 0) {
      const next = semaphore.queue.shift()!;
      next();
    } else {
      semaphore.count++;
    }
  };

  // Process files with concurrency limit
  const fileTasks = fileEntries.map(([zipEntryPath, entry]) => async () => {
    await acquire();
    try {
      // Strip root folder from path
      const relativePath = rootFolder
        ? zipEntryPath.substring(rootFolder.length + 1)
        : zipEntryPath;

      if (!relativePath) return;

      // Skip unwanted files
      if (shouldSkipFile(relativePath)) {
        filesSkipped++;
        return;
      }

      try {
        const content = await entry.async("string");
        if (content.length > MAX_FILE_SIZE) return;

        const language = detectLanguage(relativePath);
        const vfsFilePath = `${vfsPath}/${relativePath}`;

        // Atomic write - backend handles existence check to avoid race conditions
        // The write API returns 409 Conflict if file already exists (safe creation)
        const writeRes = await fetch("/api/filesystem/write", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildApiHeaders(),
          },
          body: JSON.stringify({
            path: vfsFilePath,
            content,
            language,
            // Signal intent: only create if not exists (atomic check-and-write)
            ifNotExists: true,
          }),
          signal,
        });

        if (writeRes.ok) {
          filesWritten++;
          writtenPaths.push(vfsFilePath);
        } else if (writeRes.status === 409) {
          // File already exists - skip (atomic check prevented race condition)
          filesSkipped++;
        } else {
          filesSkipped++;
        }
      } catch (err) {
        if (signal?.aborted) throw err;
        // Skip files that fail to write (binary, encoding issues, rate limits, etc.)
        console.warn(`[Clone] Skipping ${relativePath}:`, err);
        filesSkipped++;
      }
    } finally {
      filesProcessed++;
      // Always release the semaphore slot even if report() throws
      release();
      try {
        report({
          phase: "writing",
          filesProcessed,
          filesWritten,
          filesSkipped,
          totalFiles: fileEntries.length,
          currentFile: zipEntryPath,
        });
      } catch {
        // Ignore report errors
      }
    }
  });

  // Execute all tasks with concurrency limit
  await Promise.allSettled(fileTasks.map(task => task()));

  // Emit filesystem update event for UI refresh
  if (writtenPaths.length > 0) {
    emitFilesystemUpdated({
      path: vfsPath,
      paths: writtenPaths,
      scopePath: vfsPath,
      type: "create",
      workspaceVersion: Date.now(),
      applied: writtenPaths.map(p => ({
        path: p,
        operation: "write" as const,
        timestamp: Date.now(),
      })),
      source: "github-clone",
    });
  }

  report({
    phase: "done",
    filesProcessed,
    filesWritten,
    filesSkipped,
    totalFiles: fileEntries.length,
  });

  return { filesWritten, filesSkipped, vfsPath };
}
