/**
 * File System Abstraction Layer
 *
 * Automatically selects the appropriate file system backend based on the platform:
 * - Web: Browser File API (drag-and-drop, file input)
 * - Desktop: Tauri File System (native file operations)
 *
 * Usage:
 * ```ts
 * import { fs } from '@/lib/platform/fs';
 *
 * // Read a file (works on both platforms)
 * const content = await fs.readFile('/path/to/file.txt');
 *
 * // Open file dialog (platform-specific UI)
 * const files = await fs.openFileDialog({ accept: '.txt', multiple: true });
 * ```
 */

import { isDesktopMode } from '../env';
import type { FsAdapter } from './web';

// Dynamic import to avoid bundling Tauri APIs in web build
let fsPromise: Promise<FsAdapter> | null = null;

function getFs(): Promise<FsAdapter> {
  if (!fsPromise) {
    fsPromise = isDesktopMode()
      ? import('./desktop').then(m => m.fs as unknown as FsAdapter)
      : import('./web').then(m => m.fs);
  }
  return fsPromise;
}

// Export a proxy that forwards calls to the correct implementation
export const fs: FsAdapter = {
  readFile: async (input: string | File) => (await getFs()).readFile(input),
  readBinaryFile: async (path: string) => (await getFs()).readBinaryFile?.(path),
  writeFile: async (path: string, content: string) => (await getFs()).writeFile?.(path, content),
  writeBinaryFile: async (path: string, data: Uint8Array) => (await getFs()).writeBinaryFile?.(path, data),
  readDir: async (path: string) => (await getFs()).readDir?.(path),
  createDir: async (path: string, recursive?: boolean) => (await getFs()).createDir?.(path, recursive),
  removeDir: async (path: string, recursive?: boolean) => (await getFs()).removeDir?.(path, recursive),
  removeFile: async (path: string) => (await getFs()).removeFile?.(path),
  exists: async (path: string) => (await getFs()).exists?.(path),
  copyFile: async (src: string, dest: string) => (await getFs()).copyFile?.(src, dest),
  openFileDialog: async (options?: { accept?: string; multiple?: boolean }) => (await getFs()).openFileDialog(options),
  saveFileDialog: async (options?: { defaultPath?: string }) => (await getFs()).saveFileDialog?.(options),
  // Web-only methods
  readAsDataURL: async (file: File) => (await getFs()).readAsDataURL?.(file),
  readAsArrayBuffer: async (file: File) => (await getFs()).readAsArrayBuffer?.(file),
  downloadFile: async (content: string, filename: string, mimeType?: string) => (await getFs()).downloadFile?.(content, filename, mimeType),
};

export type { FsAdapter };
export default fs;
