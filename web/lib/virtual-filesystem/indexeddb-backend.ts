/**
 * IndexedDB fallback backend.
 *
 * Provides file system operations when OPFS is unavailable.
 */

'use client';

import type { VirtualFile } from './filesystem-types';

const DB_NAME = 'vfs-indexeddb';
const DB_VERSION = 1;
const STORE_NAME = 'files';

export interface IndexedDBFile {
  key: string;
  path: string;
  content: string;
  version: number;
  size: number;
  language?: string;
  lastModified: number;
  createdAt: number;
  ownerId: string;
}

export class IndexedDBError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'IndexedDBError';
  }
}

function toVirtualFile(file: IndexedDBFile, includeContent: boolean): VirtualFile {
  return {
    path: file.path,
    content: includeContent ? file.content : '',
    version: file.version,
    size: file.size,
    language: file.language || '',
    lastModified: new Date(file.lastModified).toISOString(),
    createdAt: new Date(file.createdAt).toISOString(),
  };
}

export class IndexedDBBackend {
  private db: IDBDatabase | null = null;
  private ownerId: string | null = null;
  private initPromise: Promise<void> | null = null;

  name = 'indexeddb';

  static isSupported(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  async initialize(ownerId: string): Promise<void> {
    if (!ownerId || typeof ownerId !== 'string') {
      throw new IndexedDBError('Invalid owner ID: must be a non-empty string');
    }

    if (this.db) {
      if (this.ownerId === ownerId) {
        return;
      }
      this.db.close();
      this.db = null;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise<void>((resolve, reject) => {
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
          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
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

    return this.initPromise;
  }

  isInitialized(): boolean {
    return this.db !== null;
  }

  async readFile(ownerId: string, filePath: string): Promise<VirtualFile> {
    await this.ensureInitialized();

    if (!filePath || typeof filePath !== 'string') {
      throw new IndexedDBError('Invalid path: must be a non-empty string');
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const key = this.getKey(ownerId, filePath);
        const request = store.get(key);

        request.onsuccess = () => {
          const result = request.result as IndexedDBFile | undefined;
          if (!result) {
            reject(new IndexedDBError(`File not found: ${filePath}`));
            return;
          }

          resolve(toVirtualFile(result, true));
        };

        request.onerror = () => {
          reject(new IndexedDBError('Failed to read file', request.error));
        };
        transaction.onerror = () => {
          reject(new IndexedDBError('Transaction failed while reading file', transaction.error));
        };
      } catch (error) {
        reject(new IndexedDBError('Read operation failed', error));
      }
    });
  }

  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    options?: { version?: number; language?: string }
  ): Promise<VirtualFile> {
    await this.ensureInitialized();

    if (!filePath || typeof filePath !== 'string') {
      throw new IndexedDBError('Invalid path: must be a non-empty string');
    }
    if (content === undefined) {
      throw new IndexedDBError('Invalid content: cannot write undefined');
    }

    const stringContent = typeof content === 'string' ? content : JSON.stringify(content);
    const key = this.getKey(ownerId, filePath);

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const existingRequest = store.get(key);

        existingRequest.onsuccess = () => {
          const existing = existingRequest.result as IndexedDBFile | undefined;
          const now = Date.now();
          const fileData: IndexedDBFile = {
            key,
            path: filePath,
            content: stringContent,
            version: options?.version ?? existing?.version ?? 1,
            size: stringContent.length,
            language: options?.language ?? existing?.language,
            lastModified: now,
            createdAt: existing?.createdAt ?? now,
            ownerId,
          };

          const writeRequest = store.put(fileData);
          writeRequest.onsuccess = () => resolve(toVirtualFile(fileData, true));
          writeRequest.onerror = () => reject(new IndexedDBError('Failed to write file', writeRequest.error));
        };

        existingRequest.onerror = () => {
          reject(new IndexedDBError('Failed to read existing file metadata', existingRequest.error));
        };
      } catch (error) {
        reject(new IndexedDBError('Write operation failed', error));
      }
    });
  }

  async listDirectory(ownerId: string, dirPath: string): Promise<VirtualFile[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('ownerId');
      const request = index.getAll(IDBKeyRange.only(ownerId));

      request.onsuccess = () => {
        const normalizedDirPath = dirPath.replace(/\/+$/, '');
        const results = request.result as IndexedDBFile[];
        const files = results
          .filter((file) => {
            const fileDir = file.path.includes('/')
              ? file.path.substring(0, file.path.lastIndexOf('/'))
              : '';
            return fileDir === normalizedDirPath || fileDir.startsWith(`${normalizedDirPath}/`);
          })
          .map((file) => toVirtualFile(file, false));

        resolve(files);
      };

      request.onerror = () => reject(new IndexedDBError('Failed to list directory', request.error));
      transaction.onerror = () => reject(new IndexedDBError('Transaction failed while listing', transaction.error));
    });
  }

  async deleteFile(ownerId: string, filePath: string): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(this.getKey(ownerId, filePath));

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new IndexedDBError('Failed to delete file', request.error));
      transaction.onerror = () => reject(new IndexedDBError('Transaction failed while deleting', transaction.error));
    });
  }

  async getWorkspaceVersion(ownerId: string): Promise<number> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('ownerId');
      const request = index.getAll(IDBKeyRange.only(ownerId));

      request.onsuccess = () => {
        const results = request.result as IndexedDBFile[];
        resolve(results.reduce((max, file) => Math.max(max, file.version), 0));
      };

      request.onerror = () => {
        reject(new IndexedDBError('Failed to get workspace version', request.error));
      };
    });
  }

  async exportWorkspace(ownerId: string): Promise<{ files: VirtualFile[] }> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('ownerId');
      const request = index.getAll(IDBKeyRange.only(ownerId));

      request.onsuccess = () => {
        const results = request.result as IndexedDBFile[];
        resolve({ files: results.map((file) => toVirtualFile(file, true)) });
      };

      request.onerror = () => {
        reject(new IndexedDBError('Failed to export workspace', request.error));
      };
    });
  }

  async clear(ownerId: string): Promise<void> {
    // If the IndexedDB hasn't been opened yet, there's nothing to clear — this
    // is a benign no-op (e.g. user-changed handler firing before init()).
    // Throwing here used to spam "[useVFS WARN] OPFS: Failed to clear IndexedDB"
    // on every fresh anonymous session.
    if (!this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('ownerId');
      const request = index.getAllKeys(IDBKeyRange.only(ownerId));

      request.onsuccess = () => {
        const keys = request.result as string[];
        // Delete all keys in the SAME transaction (atomic)
        for (const key of keys) {
          store.delete(key);
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new IndexedDBError('Failed to clear workspace', tx.error));
      request.onerror = () => reject(new IndexedDBError('Failed to get keys for clearing', request.error));
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.ownerId = null;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      throw new IndexedDBError('IndexedDB not initialized');
    }
  }

  private getKey(ownerId: string, filePath: string): string {
    return `${ownerId}:${filePath}`;
  }
}

export const indexedDBBackend = new IndexedDBBackend();
