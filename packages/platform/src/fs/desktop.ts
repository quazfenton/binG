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
      try {
        const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
        // Handle absolute paths by setting baseDir to None if the path is absolute
        const isAbsolute = pathOrFile.startsWith('/') || /^[a-zA-Z]:\\/.test(pathOrFile);
        return await readTextFile(pathOrFile, { baseDir: isAbsolute ? undefined : BaseDirectory.Home });
      } catch (err) {
        throw new Error(`Failed to read file ${pathOrFile}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Fallback for File object (drag-and-drop)
    try {
      return await pathOrFile.text();
    } catch (err) {
      throw new Error(`Failed to read File object: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    try {
      const { readBinaryFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      return await readBinaryFile(path, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(`Failed to read binary file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
    }
    // Fallback for File object (drag-and-drop)
    try {
      return await pathOrFile.text();
    } catch (err) {
      throw new Error(`Failed to read File object: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    try {
      const { readBinaryFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      return await readBinaryFile(path, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(`Failed to read binary file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(`Failed to write file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    try {
      const { writeBinaryFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await writeBinaryFile(path, data, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(`Failed to write binary file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    try {
      const { writeBinaryFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await writeBinaryFile(path, data, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(`Failed to write binary file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async readDir(path: string): Promise<{ name: string; isDirectory: boolean; size?: number }[]> {
    try {
      const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(path, { baseDir: BaseDirectory.Home });
      return entries.map(e => {
        // Validate entry structure before accessing properties
        if (!e || typeof e.name !== 'string' || typeof e.isDirectory !== 'boolean') {
          throw new Error(`Invalid directory entry structure: missing required fields`);
        }
        return {
          name: e.name,
          isDirectory: e.isDirectory,
          size: typeof (e as any).size === 'number' ? (e as any).size : undefined,
        };
      });
    } catch (err) {
      throw new Error(`Failed to read directory ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
        return {
          name: e.name,
          isDirectory: e.isDirectory,
          size: typeof (e as any).size === 'number' ? (e as any).size : undefined,
        };
      });
    } catch (err) {
      throw new Error(`Failed to read directory ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createDir(path: string, recursive = false): Promise<void> {
    try {
      const { mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await mkdir(path, { baseDir: BaseDirectory.Home, recursive });
    } catch (err) {
      throw new Error(`Failed to create directory ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async removeDir(path: string, recursive = false): Promise<void> {
    try {
      const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await remove(path, { baseDir: BaseDirectory.Home, recursive });
    } catch (err) {
      throw new Error(`Failed to remove directory ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async removeFile(path: string): Promise<void> {
    try {
      const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await remove(path, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(`Failed to remove file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      return await exists(path, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(`Failed to check if file exists ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    try {
      const { copyFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await copyFile(src, dest, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(`Failed to copy file from ${src} to ${dest}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async openFileDialog(options?: { accept?: string; multiple?: boolean }): Promise<File[] | string[]> {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const filters = options?.accept ? [{ name: 'File', extensions: [options.accept.replace('.', '')] }] : undefined;
      const result = await open({
        multiple: options?.multiple ?? false,
        directory: false,
        filters,
      });

      if (Array.isArray(result)) {
        return result as string[];
      } else if (typeof result === 'string') {
        return [result];
      }
      return [];
    } catch (err) {
      throw new Error(`Failed to open file dialog: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async saveFileDialog(options?: { defaultPath?: string }): Promise<string | null> {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      return await save({
        defaultPath: options?.defaultPath,
      });
    } catch (err) {
      throw new Error(`Failed to save file dialog: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const fs = new DesktopFs();
export default fs;
