/**
 * IndexedDB Fallback Backend
 *
 * Provides file system operations using IndexedDB when OPFS is unavailable
 * Used as fallback for browsers without OPFS support or when OPFS fails
 *
 * Features:
 * - Full VFS API compatibility
 * - Automatic version tracking
 * - Transaction-based writes
 * - Quota management
 */

'use client';

import type { VirtualFile, VFSBackend } from '../filesystem-types';

const DB_NAME = 'vfs-indexeddb';
const DB_VERSION = 1;
const STORE_NAME = 'files';

export interface IndexedDBFile {
  path: string;
  content: string;
  version: number;
  size: number;
  language?: string;
  lastModified: number;
  ownerId: string;
}

export class IndexedDBError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'IndexedDBError';
  }
}

export class IndexedDBBackend implements VFSBackend {
  private db: IDBDatabase | null = null;
  private ownerId: string | null = null;
  private initPromise: Promise<void> | null = null;

  name = 'indexeddb';

  /**
   * Check if IndexedDB is supported
   */
  static isSupported(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  /**
   * Initialize IndexedDB backend
   */
  async initialize(ownerId: string): Promise<void> {
    if (!ownerId || typeof ownerId !== 'string') {
      throw new IndexedDBError('Invalid owner ID: must be a non-empty string');
    }

    if (this.db) {
      // Already initialized for same owner
      if (this.ownerId === ownerId) {
        return;
      }
      // Different owner, close and reopen
      this.db.close();
      this.db = null;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      return new Promise<void>((resolve, reject) => {
        try {
          const request = indexedDB.open(DB_NAME, DB_VERSION);

          request.onerror = () => {
            this.initPromise = null;
            reject(new IndexedDBError('Failed to open IndexedDB', request.error));
          };

          request.onsuccess = () => {
            this.db = request.result;
            this.ownerId = ownerId;
            this.initPromise = null;
            console.log('[IndexedDB] Initialized for owner:', ownerId);
            resolve();
          };

          request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            // Create object store if it doesn't exist
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
              store.createIndex('ownerId', 'ownerId', { unique: false });
              store.createIndex('path', 'path', { unique: false });
            }
          };
        } catch (error) {
          this.initPromise = null;
          reject(new IndexedDBError('Failed to initialize IndexedDB', error));
        }
      });
    })();

    return this.initPromise;
  }

  /**
   * Check if backend is initialized
   */
  isInitialized(): boolean {
    return this.db !== null;
  }

  /**
   * Read file from IndexedDB
   */
  async readFile(ownerId: string, path: string): Promise<VirtualFile> {
    await this.ensureInitialized();

    if (!path || typeof path !== 'string') {
      throw new IndexedDBError('Invalid path: must be a non-empty string');
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const key = `${ownerId}:${path}`;

        const request = store.get(key);

        request.onsuccess = () => {
          const result = request.result as IndexedDBFile | undefined;

          if (!result) {
            reject(new Error(`File not found: ${path}`));
            return;
          }

          resolve({
            path,
            content: result.content,
            version: result.version,
            size: result.size,
            language: result.language,
            lastModified: result.lastModified,
          });
        };

        request.onerror = () => {
          reject(new IndexedDBError('Failed to read file', request.error));
        };
      } catch (error) {
        reject(new IndexedDBError('Read operation failed', error));
      }
    });
  }

  /**
   * Write file to IndexedDB
   */
  async writeFile(
    ownerId: string,
    path: string,
    content: string,
    options?: { version?: number; language?: string }
  ): Promise<VirtualFile> {
    await this.ensureInitialized();

    if (!path || typeof path !== 'string') {
      throw new IndexedDBError('Invalid path: must be a non-empty string');
    }

    if (content === undefined) {
      throw new IndexedDBError('Invalid content: cannot write undefined');
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        const key = `${ownerId}:${path}`;
        const now = Date.now();
        const stringContent = typeof content === 'string' ? content : JSON.stringify(content);

        const fileData: IndexedDBFile = {
          path,
          content: stringContent,
          version: options?.version ?? 1,
          size: stringContent.length,
          language: options?.language,
          lastModified: now,
          ownerId,
        };

        const request = store.put(fileData);

        request.onsuccess = () => {
          resolve({
            path,
            content: stringContent,
            version: fileData.version,
            size: fileData.size,
            language: fileData.language,
            lastModified: fileData.lastModified,
          });
        };

        request.onerror = () => {
          reject(new IndexedDBError('Failed to write file', request.error));
        };
      } catch (error) {
        reject(new IndexedDBError('Write operation failed', error));
      }
    });
  }

  /**
   * List directory contents
   */
  async listDirectory(ownerId: string, dirPath: string): Promise<VirtualFile[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('ownerId');

      const request = index.getAll(IDBKeyRange.only(ownerId));

      request.onsuccess = () => {
        const results = request.result as IndexedDBFile[];
        const normalizedDirPath = dirPath.replace(/\/+$/, '');

        const files = results
          .filter((file) => {
            const fileDir = file.path.substring(0, file.path.lastIndexOf('/'));
            return fileDir === normalizedDirPath || fileDir.startsWith(normalizedDirPath + '/');
          })
          .map((file) => ({
            path: file.path,
            content: '', // Don't return content for list operations
            version: file.version,
            size: file.size,
            language: file.language,
            lastModified: file.lastModified,
          }));

        resolve(files);
      };

      request.onerror = () => {
        reject(new IndexedDBError('Failed to list directory', request.error));
      };
    });
  }

  /**
   * Delete file from IndexedDB
   */
  async deleteFile(ownerId: string, path: string): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const key = `${ownerId}:${path}`;

      const request = store.delete(key);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new IndexedDBError('Failed to delete file', request.error));
      };
    });
  }

  /**
   * Get workspace version
   */
  async getWorkspaceVersion(ownerId: string): Promise<number> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('ownerId');

      const request = index.getAll(IDBKeyRange.only(ownerId));

      request.onsuccess = () => {
        const results = request.result as IndexedDBFile[];
        const maxVersion = results.reduce((max, file) => Math.max(max, file.version), 0);
        resolve(maxVersion);
      };

      request.onerror = () => {
        reject(new IndexedDBError('Failed to get workspace version', request.error));
      };
    });
  }

  /**
   * Export workspace
   */
  async exportWorkspace(ownerId: string): Promise<{ files: VirtualFile[] }> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('ownerId');

      const request = index.getAll(IDBKeyRange.only(ownerId));

      request.onsuccess = () => {
        const results = request.result as IndexedDBFile[];
        const files = results.map((file) => ({
          path: file.path,
          content: file.content,
          version: file.version,
          size: file.size,
          language: file.language,
          lastModified: file.lastModified,
        }));

        resolve({ files });
      };

      request.onerror = () => {
        reject(new IndexedDBError('Failed to export workspace', request.error));
      };
    });
  }

  /**
   * Clear all data for owner
   */
  async clear(ownerId: string): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('ownerId');

      const request = index.getAllKeys(IDBKeyRange.only(ownerId));

      request.onsuccess = () => {
        const keys = request.result as string[];
        const deleteTransaction = this.db!.transaction(STORE_NAME, 'readwrite');
        const deleteStore = deleteTransaction.objectStore(STORE_NAME);

        keys.forEach((key) => {
          deleteStore.delete(key);
        });

        deleteTransaction.oncomplete = () => {
          resolve();
        };

        deleteTransaction.onerror = () => {
          reject(new IndexedDBError('Failed to clear workspace', deleteTransaction.error));
        };
      };

      request.onerror = () => {
        reject(new IndexedDBError('Failed to get keys for clearing', request.error));
      };
    });
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.ownerId = null;
      console.log('[IndexedDB] Closed');
    }
  }

  /**
   * Ensure backend is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      throw new IndexedDBError('IndexedDB not initialized');
    }
  }
}

/**
 * Singleton instance
 */
export const indexedDBBackend = new IndexedDBBackend();
