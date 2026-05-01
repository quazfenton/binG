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
    // Note: This caches the adapter based on isDesktopMode() at first call.
    // If the platform environment changes at runtime (e.g., hot module replacement),
    // the cached adapter will NOT reflect the new environment.
    // This is acceptable for most production scenarios where platform is static.
    fsPromise = isDesktopMode()
      ? import('./desktop').then(m => m.fs as unknown as FsAdapter)
      : import('./web').then(m => m.fs);
  }
  return fsPromise;
}
  return fsPromise;
}

// Export a proxy that forwards calls to the correct implementation
export const fs: FsAdapter = {
  readFile: async (input: string | File) => (await getFs()).readFile(input),
  readBinaryFile: async (path: string) => {
    const adapter = await getFs();
    if (!adapter.readBinaryFile) throw new Error('readBinaryFile is not supported on this platform');
    return adapter.readBinaryFile(path);
  },
  writeFile: async (path: string, content: string) => {
    const adapter = await getFs();
    if (!adapter.writeFile) throw new Error('writeFile is not supported on this platform');
    return adapter.writeFile(path, content);
  },
  writeBinaryFile: async (path: string, data: Uint8Array) => {
    const adapter = await getFs();
    if (!adapter.writeBinaryFile) throw new Error('writeBinaryFile is not supported on this platform');
    return adapter.writeBinaryFile(path, data);
  },
  readDir: async (path: string) => {
    const adapter = await getFs();
    if (!adapter.readDir) throw new Error('readDir is not supported on this platform');
    return adapter.readDir(path);
  },
  createDir: async (path: string, recursive?: boolean) => {
    const adapter = await getFs();
    if (!adapter.createDir) throw new Error('createDir is not supported on this platform');
    return adapter.createDir(path, recursive);
  },
  removeDir: async (path: string, recursive?: boolean) => {
    const adapter = await getFs();
    if (!adapter.removeDir) throw new Error('removeDir is not supported on this platform');
    return adapter.removeDir(path, recursive);
  },
  removeFile: async (path: string) => {
    const adapter = await getFs();
    if (!adapter.removeFile) throw new Error('removeFile is not supported on this platform');
    return adapter.removeFile(path);
  },
  exists: async (path: string) => {
    const adapter = await getFs();
    if (!adapter.exists) throw new Error('exists is not supported on this platform');
    return adapter.exists(path);
  },
  copyFile: async (src: string, dest: string) => {
    const adapter = await getFs();
    if (!adapter.copyFile) throw new Error('copyFile is not supported on this platform');
    return adapter.copyFile(src, dest);
  },
  openFileDialog: async (options?: { accept?: string; multiple?: boolean }) => (await getFs()).openFileDialog(options),
  saveFileDialog: async (options?: { defaultPath?: string }) => {
    const adapter = await getFs();
    if (!adapter.saveFileDialog) throw new Error('saveFileDialog is not supported on this platform');
    return adapter.saveFileDialog(options);
  },
  // Web-only methods
  readAsDataURL: async (file: File) => {
    const adapter = await getFs();
    if (!adapter.readAsDataURL) throw new Error('readAsDataURL is not supported on this platform');
    return adapter.readAsDataURL(file);
  },
  readAsArrayBuffer: async (file: File) => {
    const adapter = await getFs();
    if (!adapter.readAsArrayBuffer) throw new Error('readAsArrayBuffer is not supported on this platform');
    return adapter.readAsArrayBuffer(file);
  },
  downloadFile: async (content: string, filename: string, mimeType?: string) => {
    const adapter = await getFs();
    if (!adapter.downloadFile) throw new Error('downloadFile is not supported on this platform');
    return adapter.downloadFile(content, filename, mimeType);
  },
};

export type { FsAdapter };
export default fs;
