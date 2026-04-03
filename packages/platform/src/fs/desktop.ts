/**
 * Desktop File System Implementation (Tauri FS)
 *
 * Native file system operations using Tauri's file system plugin.
 * Provides full access to the user's file system with proper permissions.
 *
 * @see https://tauri.app/v1/api/js/fs
 */

import type { FsAdapter } from './web';

class DesktopFs implements FsAdapter {
  // Desktop uses path strings, web uses File objects
  async readFile(pathOrFile: string | File): Promise<string> {
    if (typeof pathOrFile === 'string') {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      return await readTextFile(pathOrFile, { baseDir: BaseDirectory.Home });
    }
    // Fallback for File object (drag-and-drop)
    return await pathOrFile.text();
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const { readBinaryFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    return await readBinaryFile(path, { baseDir: BaseDirectory.Home });
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    const { writeBinaryFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await writeBinaryFile(path, data, { baseDir: BaseDirectory.Home });
  }

  async readDir(path: string): Promise<{ name: string; isDirectory: boolean; size?: number }[]> {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    const entries = await readDir(path, { baseDir: BaseDirectory.Home });
    return entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory,
      size: (e as any).size,
    }));
  }

  async createDir(path: string, recursive = false): Promise<void> {
    const { mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await mkdir(path, { baseDir: BaseDirectory.Home, recursive });
  }

  async removeDir(path: string, recursive = false): Promise<void> {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await remove(path, { baseDir: BaseDirectory.Home, recursive });
  }

  async removeFile(path: string): Promise<void> {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await remove(path, { baseDir: BaseDirectory.Home });
  }

  async exists(path: string): Promise<boolean> {
    const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    return await exists(path, { baseDir: BaseDirectory.Home });
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const { copyFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await copyFile(src, dest, { baseDir: BaseDirectory.Home });
  }

  async openFileDialog(options?: { accept?: string; multiple?: boolean }): Promise<File[] | string[]> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: options?.multiple ?? false,
      directory: false,
    });

    if (Array.isArray(result)) {
      return result as string[];
    } else if (typeof result === 'string') {
      return [result];
    }
    return [];
  }

  async saveFileDialog(options?: { defaultPath?: string }): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return await save({
      defaultPath: options?.defaultPath,
    });
  }
}

export const fs = new DesktopFs();
export default fs;
