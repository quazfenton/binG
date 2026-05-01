/**
 * Desktop Storage Implementation (Tauri File System)
 *
 * Used when running in a Tauri desktop shell.
 * Stores data as JSON files in the app data directory.
 *
 * @see https://tauri.app/v1/api/js/fs
 */

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

const APP_DATA_DIR = 'storage';

function pathForKey(key: string): string {
  // Use base64url encoding to ensure unique, filesystem-safe keys
  const safeKey = Buffer.from(key).toString('base64url');
  return `${APP_DATA_DIR}/${safeKey}.json`;
}

class DesktopStorage implements StorageAdapter {
  private async ensureDir(): Promise<void> {
    try {
      const { mkdir, BaseDirectory, exists } = await import('@tauri-apps/plugin-fs');
      const dirExists = await exists(APP_DATA_DIR, { baseDir: BaseDirectory.AppData });
      if (!dirExists) {
        await mkdir(APP_DATA_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
      }
    } catch (error: unknown) {
      // MED-5 fix: Re-throw after logging so callers get a clear error
      // instead of a confusing Tauri write failure later
      console.error('[DesktopStorage] Failed to ensure directory:', error);
      throw new Error(`Failed to create storage directory: ${
        error instanceof Error ? error.message : String(error)
      }`, { cause: error });
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const { readTextFile, BaseDirectory, exists } = await import('@tauri-apps/plugin-fs');
      const path = pathForKey(key);

      const fileExists = await exists(path, { baseDir: BaseDirectory.AppData });
      if (!fileExists) return null;

      const content = await readTextFile(path, { baseDir: BaseDirectory.AppData });
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureDir();
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    const path = pathForKey(key);

    await writeTextFile(path, JSON.stringify(value), {
      baseDir: BaseDirectory.AppData,
    });
  }

  async remove(key: string): Promise<void> {
    try {
      const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const path = pathForKey(key);
      await remove(path, { baseDir: BaseDirectory.AppData });
    } catch {
      // File may not exist - ignore
    }
  }

  async clear(): Promise<void> {
    try {
      const { readDir, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(APP_DATA_DIR, { baseDir: BaseDirectory.AppData });

      for (const entry of entries) {
        if (entry.name?.endsWith('.json')) {
          await remove(`${APP_DATA_DIR}/${entry.name}`, { baseDir: BaseDirectory.AppData });
        }
      }
    } catch (error) {
      console.error('[DesktopStorage] Failed to clear storage:', error);
    }
  }

  async keys(): Promise<string[]> {
    try {
      const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(APP_DATA_DIR, { baseDir: BaseDirectory.AppData });

      return entries
        .filter(e => e.name?.endsWith('.json'))
        .map(e => e.name!.replace('.json', ''));
    } catch {
      return [];
    }
  }
}

export const storage = new DesktopStorage();
export default storage;
