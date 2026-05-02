/**
 * Storage Abstraction Layer
 *
 * Automatically selects the appropriate storage backend based on the platform:
 * - Web: localStorage (synchronous)
 * - Desktop: Tauri File System (asynchronous JSON files)
 *
 * Usage:
 * ```ts
 * import { storage } from '@/lib/platform/storage';
 *
 * await storage.set('user-preferences', { theme: 'dark' });
 * const prefs = await storage.get('user-preferences');
 * ```
 */

import { isDesktopMode } from '../env';
import type { StorageAdapter } from './web';

// Dynamic import to avoid bundling Tauri APIs in web build
let storagePromise: Promise<StorageAdapter> | null = null;
let importFailure: Error | null = null;

function getStorage(): Promise<StorageAdapter> {
  if (importFailure) return Promise.reject(importFailure);
  if (!storagePromise) {
    storagePromise = (isDesktopMode()
      ? import('./desktop').then(m => m.storage)
      : import('./web').then(m => m.storage)
    ).catch(err => {
      importFailure = err;
      storagePromise = null;
      throw err;
    });
  }
  return storagePromise;
}

// Export a proxy that forwards calls to the correct implementation
export const storage: StorageAdapter = {
  get: async <T>(key: string) => (await getStorage()).get<T>(key),
  set: async <T>(key: string, value: T) => (await getStorage()).set<T>(key, value),
  remove: async (key: string) => (await getStorage()).remove(key),
  clear: async () => (await getStorage()).clear(),
  keys: async () => (await getStorage()).keys(),
};

export type { StorageAdapter };
export default storage;
