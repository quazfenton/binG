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
  private isAbsolute(path: string): boolean {
    return path.startsWith('/') || /^[a-zA-Z]:\\/.test(path);
  }

  private getBaseDir(path: string, BaseDirectory: any) {
    return this.isAbsolute(path) ? undefined : BaseDirectory.Home;
  }

  async readFile(pathOrFile: string | File): Promise<string> {
    if (typeof pathOrFile === 'string') {
      try {
        const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
        return await readTextFile(pathOrFile, { baseDir: this.getBaseDir(pathOrFile, BaseDirectory) });
      } catch (err) {
        throw new Error(`Failed to read file ${pathOrFile}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      return await pathOrFile.text();
    } catch (err) {
      throw new Error(`Failed to read File object: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    try {
      const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      // Handle absolute paths
      const isAbsolute = path.startsWith('/') || /^[a-zA-Z]:\\/.test(path);
      return await readFile(path, { baseDir: isAbsolute ? undefined : BaseDirectory.Home });
    } catch (err) {
      throw new Error(`Failed to read binary file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(path, content, { baseDir: this.getBaseDir(path, BaseDirectory) });
    } catch (err) {
      throw new Error(`Failed to write file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    try {
      const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      // Handle absolute paths
      const isAbsolute = path.startsWith('/') || /^[a-zA-Z]:\\/.test(path);
      await writeFile(path, data, { baseDir: isAbsolute ? undefined : BaseDirectory.Home });
    } catch (err) {
      throw new Error(`Failed to write binary file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async readDir(path: string): Promise<{ name: string; isDirectory: boolean; size?: number }[]> {
    try {
      const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(path, { baseDir: this.getBaseDir(path, BaseDirectory) });
      return entries.map(e => {
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

  async createDir(path: string, recursive = false): Promise<void> {
    try {
      const { mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await mkdir(path, { baseDir: this.getBaseDir(path, BaseDirectory), recursive });
    } catch (err) {
      throw new Error(`Failed to create directory ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async removeDir(path: string, recursive = false): Promise<void> {
    try {
      const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await remove(path, { baseDir: this.getBaseDir(path, BaseDirectory), recursive });
    } catch (err) {
      throw new Error(`Failed to remove directory ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async removeFile(path: string): Promise<void> {
    try {
      const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await remove(path, { baseDir: this.getBaseDir(path, BaseDirectory) });
    } catch (err) {
      throw new Error(`Failed to remove file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      return await exists(path, { baseDir: this.getBaseDir(path, BaseDirectory) });
    } catch (err) {
      throw new Error(`Failed to check if file exists ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    try {
      const { copyFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      
      // Determine base directories for source and destination
      const srcBaseDir = this.getBaseDir(src, BaseDirectory);
      const destBaseDir = this.getBaseDir(dest, BaseDirectory);
      
      // Validate that both paths are either absolute or relative
      // Tauri requires consistent base directory handling
      const srcIsAbsolute = this.isAbsolute(src);
      const destIsAbsolute = this.isAbsolute(dest);
      
      if (srcIsAbsolute !== destIsAbsolute) {
        throw new Error(
          `Cannot copy between absolute and relative paths: src="${src}" (${srcIsAbsolute ? 'absolute' : 'relative'}), dest="${dest}" (${destIsAbsolute ? 'absolute' : 'relative'})`
        );
      }
      
      // Tauri v2 uses fromPathBaseDir and toPathBaseDir
      await copyFile(src, dest, { fromPathBaseDir: srcBaseDir, toPathBaseDir: destBaseDir });
    } catch (err) {
      throw new Error(`Failed to copy file from ${src} to ${dest}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async openFileDialog(options?: { accept?: string; multiple?: boolean }): Promise<File[] | string[]> {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      
      // Parse accept string to support multiple extensions and MIME types
      // Examples: '.png,.jpg', 'image/*', '.txt,.md,.json'
      let filters = undefined;
      if (options?.accept) {
        const extensions: string[] = [];
        const acceptParts = options.accept.split(',').map(part => part.trim());
        
        for (const part of acceptParts) {
          if (part.startsWith('.')) {
            // Extension: .png, .jpg
            extensions.push(part.replace(/^\./, ''));
          } else if (part.includes('/')) {
            // MIME type: image/*, application/json
            // Map common MIME types to extensions
            const mimeToExt: Record<string, string[]> = {
              'image/*': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'],
              'image/png': ['png'],
              'image/jpeg': ['jpg', 'jpeg'],
              'image/gif': ['gif'],
              'image/svg+xml': ['svg'],
              'image/webp': ['webp'],
              'text/*': ['txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts'],
              'text/plain': ['txt'],
              'text/markdown': ['md'],
              'application/json': ['json'],
              'application/xml': ['xml'],
              'text/html': ['html', 'htm'],
              'text/css': ['css'],
              'application/pdf': ['pdf'],
              'application/zip': ['zip'],
            };
            
          const exts = mimeToExt[part.toLowerCase()];
            if (exts) {
              extensions.push(...exts);
            }
          }
        }
        
        if (extensions.length > 0) {
          // Remove duplicates
          const uniqueExtensions = [...new Set(extensions)];
          filters = [{ name: 'Files', extensions: uniqueExtensions }];
        }
      }
      
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
