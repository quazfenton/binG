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
let importInProgress = false; // Lock to prevent race conditions

function getStorage(): Promise<StorageAdapter> {
  // Always allow retry if the previous attempt failed
  importFailure = null;
  
  // If an import is already in progress, return the existing promise
  if (importInProgress && storagePromise) {
    return storagePromise;
  }
  
  if (!storagePromise) {
    importInProgress = true;
    storagePromise = (isDesktopMode()
      ? import('./desktop').then(m => m.storage)
      : import('./web').then(m => m.storage)
    ).catch(err => {
      importFailure = err;
      storagePromise = null;
      importInProgress = false;
      console.error('[Storage] Storage adapter import failed:', err);
      throw err;
    });
    
    // Reset lock when promise resolves
    storagePromise.finally(() => {
      importInProgress = false;
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
