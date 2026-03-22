'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getOrCreateAnonymousSessionId, buildApiHeaders } from '@/lib/utils';
import { createDebugLogger } from '@/config/features';
import type {
  VirtualFile,
  VirtualFilesystemNode,
  VirtualFilesystemSearchResult,
  VirtualWorkspaceSnapshot,
} from '@/lib/virtual-filesystem/filesystem-types';
import { opfsAdapter, OPFSAdapter } from '@/lib/virtual-filesystem/opfs/opfs-adapter';
import { opfsCore } from '@/lib/virtual-filesystem/opfs/opfs-core';
import { onFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';

export interface AttachedVirtualFile {
  path: string;
  content: string;
  version: number;
  language: string;
  lastModified: string;
}

export interface UseVirtualFilesystemOptions {
  autoLoad?: boolean;
  useOPFS?: boolean;       // Enable OPFS caching for instant reads/writes
  offlineMode?: boolean;   // Force offline operation
}

export interface SyncStatus {
  isSyncing: boolean;
  pendingChanges: number;
  lastSyncTime: number | null;
  isOnline: boolean;
  hasConflicts: boolean;
}

interface ApiResponse<T> {
  success: boolean;
  error?: string;
  data: T;
}

const vfsLogger = createDebugLogger('useVFS', 'DEBUG_VFS');

// =============================================================================
// SHARED IN-MEMORY SNAPSHOT CACHE
// =============================================================================
// Single shared cache for VFS snapshots to prevent redundant API calls
// between CodePreviewPanel and TerminalPanel
// =============================================================================
interface SnapshotCacheEntry {
  snapshot: {
    root: string;
    version: number;
    updatedAt: string;
    path: string;
    files: Array<{
      path: string;
      content: string;
      language: string;
      version: number;
      size: number;
      lastModified: string;
    }>;
  };
  timestamp: number;
}

const snapshotCache = new Map<string, SnapshotCacheEntry>();
const listCache = new Map<string, { nodes: VirtualFilesystemNode[]; timestamp: number }>();
const inFlightRequests = new Map<string, Promise<any>>();
const SNAPSHOT_CACHE_TTL_MS = 60000; // 60 seconds for snapshots
const LIST_CACHE_TTL_MS = 30000;     // 30 seconds for directory listings
const SNAPSHOT_CACHE_MAX_ENTRIES = 100;

// Debounce map to prevent duplicate API calls within short time windows
const lastApiCallTime = new Map<string, number>();
const API_CALL_DEBOUNCE_MS = 100; // Reduced for faster response - mainly for GET requests
const REQUEST_COOLDOWN_MS = 50;  // Minimal cooldown for faster response
let lastGlobalVfsCall = 0;

function getCacheKey(path: string, ownerId: string): string {
  return `${ownerId}:${path}`;
}

function getCachedSnapshot(path: string, ownerId: string): { snapshot: SnapshotCacheEntry['snapshot']; isFresh: boolean } | null {
  const key = getCacheKey(path, ownerId);
  const entry = snapshotCache.get(key);
  
  if (!entry) return null;
  
  const age = Date.now() - entry.timestamp;
  const isFresh = age < SNAPSHOT_CACHE_TTL_MS;
  
  // Clean up stale entries
  if (!isFresh) {
    snapshotCache.delete(key);
    return null;
  }
  
  return { snapshot: entry.snapshot, isFresh };
}

function setCachedSnapshot(path: string, ownerId: string, snapshot: SnapshotCacheEntry['snapshot']): void {
  const key = getCacheKey(path, ownerId);
  
  // Evict oldest entries if cache is full
  if (snapshotCache.size >= SNAPSHOT_CACHE_MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;
    
    for (const [k, v] of snapshotCache.entries()) {
      if (v.timestamp < oldestTimestamp) {
        oldestTimestamp = v.timestamp;
        oldestKey = k;
      }
    }
    
    if (oldestKey) {
      snapshotCache.delete(oldestKey);
    }
  }
  
  snapshotCache.set(key, { snapshot, timestamp: Date.now() });
}

// Get cached directory listing
function getCachedList(path: string, ownerId: string): { nodes: VirtualFilesystemNode[]; isFresh: boolean } | null {
  const key = getCacheKey(path, ownerId);
  const entry = listCache.get(key);
  
  if (!entry) return null;
  
  const age = Date.now() - entry.timestamp;
  const isFresh = age < LIST_CACHE_TTL_MS;
  
  if (!isFresh) {
    listCache.delete(key);
    return null;
  }
  
  return { nodes: entry.nodes, isFresh };
}

// Set cached directory listing
function setCachedList(path: string, ownerId: string, nodes: VirtualFilesystemNode[]): void {
  const key = getCacheKey(path, ownerId);
  
  // Limit cache size
  if (listCache.size >= SNAPSHOT_CACHE_MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;
    for (const [k, v] of listCache.entries()) {
      if (v.timestamp < oldestTimestamp) {
        oldestTimestamp = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey) listCache.delete(oldestKey);
  }
  
  listCache.set(key, { nodes, timestamp: Date.now() });
}

function invalidateSnapshotCache(path?: string, ownerId?: string): void {
  if (!path && !ownerId) {
    // Clear all
    snapshotCache.clear();
    listCache.clear();
    inFlightRequests.clear();
    return;
  }
  
  // Clear specific path or all paths for owner
  for (const key of snapshotCache.keys()) {
    if (ownerId && !key.startsWith(ownerId + ':')) continue;
    if (path && !key.includes(path)) continue;
    snapshotCache.delete(key);
  }
  
  for (const key of listCache.keys()) {
    if (ownerId && !key.startsWith(ownerId + ':')) continue;
    if (path && !key.includes(path)) continue;
    listCache.delete(key);
  }
  
  // Also remove matching keys from inFlightRequests to fence off stale in-flight promises
  for (const key of inFlightRequests.keys()) {
    if (ownerId && !key.startsWith(ownerId + ':')) continue;
    if (path && !key.includes(path)) continue;
    inFlightRequests.delete(key);
  }
}

export function useVirtualFilesystem(
  initialPath: string = 'project',
  options: UseVirtualFilesystemOptions = {}
) {
  const autoLoad = options?.autoLoad !== false; // default true
  const useOPFS = options?.useOPFS ?? false;
  const offlineMode = options?.offlineMode ?? false;

  const [currentPath, setCurrentPath] = useState(initialPath);
  const currentPathRef = useRef(currentPath);
  const initialPathRef = useRef(initialPath);
  const [nodes, setNodes] = useState<VirtualFilesystemNode[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<Record<string, AttachedVirtualFile>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // OPFS sync status
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSyncing: false,
    pendingChanges: 0,
    lastSyncTime: null,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    hasConflicts: false,
  });

  const { log, error: logError, warn: logWarn } = vfsLogger;

  // Initialize OPFS on mount if enabled
  useEffect(() => {
    if (useOPFS && typeof window !== 'undefined') {
      const sessionId = getOrCreateAnonymousSessionId();
      
      // Check if OPFS is supported
      if (!OPFSAdapter.isSupported()) {
        logWarn('OPFS not supported in this browser - using server-only mode');
        return;
      }
      
      opfsAdapter.enable(sessionId).then(() => {
        log('OPFS enabled successfully for session:', sessionId);
      }).catch(err => {
        logWarn('OPFS initialization failed, falling back to server-only:', err?.message || err);
      });
    }

    return () => {
      if (useOPFS) {
        opfsAdapter.disable().catch(console.error);
      }
    };
  }, [useOPFS, logWarn]);

  // Track online status
  useEffect(() => {
    const handleOnline = () => {
      setSyncStatus(prev => ({ ...prev, isOnline: true }));
      // Trigger sync when coming back online
      if (useOPFS && !offlineMode) {
        syncWithServer().catch(console.error);
      }
    };
    const handleOffline = () => {
      setSyncStatus(prev => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [useOPFS, offlineMode]);

  // Update sync status periodically
  useEffect(() => {
    if (!useOPFS) return;

    const interval = setInterval(() => {
      const status = opfsAdapter.getSyncStatus();
      setSyncStatus(prev => ({
        ...prev,
        isSyncing: status.isSyncing,
        pendingChanges: status.pendingChanges,
        lastSyncTime: status.lastSyncTime,
        isOnline: status.isOnline,
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, [useOPFS]);

  // Listen for filesystem-updated events from other panels (code-preview-panel, conversation-interface, etc.)
  // and invalidate the snapshot cache to ensure fresh data
  useEffect(() => {
    const unsubscribe = onFilesystemUpdated((event) => {
      const detail = event.detail;
      
      // Get current session ID when event fires (not at effect creation time)
      const ownerId = getOrCreateAnonymousSessionId();
      
      // Invalidate cache when files are updated from anywhere in the app
      // This fixes Bug #4: Stale snapshot cache never invalidated during edit flow
      if (detail.path || detail.paths || detail.scopePath) {
        // Invalidate all provided paths
        if (detail.scopePath) {
          invalidateSnapshotCache(detail.scopePath, ownerId);
        }
        if (detail.path) {
          invalidateSnapshotCache(detail.path, ownerId);
        }
        if (detail.paths && detail.paths.length > 0) {
          for (const path of detail.paths) {
            invalidateSnapshotCache(path, ownerId);
          }
        }
      } else {
        // No path info - invalidate all caches to be safe
        log(`[filesystem-updated] Invalidating all snapshot caches (no path info)`);
        invalidateSnapshotCache(undefined, ownerId);
      }
    });

    return unsubscribe;
  }, [log]);

  const request = useCallback(async <TData>(
    url: string,
    options: RequestInit & { includeJsonContentType?: boolean } = {},
  ): Promise<TData> => {
    const { includeJsonContentType = true, ...rest } = options;
    
    // Global VFS cooldown - but don't delay write operations excessively
    const now = Date.now();
    const timeSinceLastCall = now - lastGlobalVfsCall;
    
    // Allow writes to proceed with shorter delay, GET requests have longer debounce
    const method = (options.method || 'GET').toUpperCase();
    const isWriteOperation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    
    // Write operations have much shorter cooldown
    const effectiveCooldown = isWriteOperation ? 100 : REQUEST_COOLDOWN_MS;
    
    if (timeSinceLastCall < effectiveCooldown) {
      const waitTime = effectiveCooldown - timeSinceLastCall;
      log(`request: cooldown active for ${method}, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastGlobalVfsCall = Date.now();
    
    // Debounce duplicate GET requests only - POST/PUT/DELETE should not be debounced
    if (method === 'GET') {
      const requestKey = `${method}:${url}`;
      const lastCall = lastApiCallTime.get(requestKey);
      if (lastCall && (now - lastCall) < API_CALL_DEBOUNCE_MS) {
        const waitTime = API_CALL_DEBOUNCE_MS - (now - lastCall);
        log(`request: debouncing duplicate call to ${url} (waiting ${waitTime}ms)`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      const callTime = Date.now();
      lastApiCallTime.set(requestKey, callTime);
      setTimeout(() => {
        if (lastApiCallTime.get(requestKey) === callTime) {
          lastApiCallTime.delete(requestKey);
        }
      }, API_CALL_DEBOUNCE_MS);
    }
    
    log(`request: ${method} ${url}`);

    const fetchStartTime = Date.now();
    const response = await fetch(url, {
      ...rest,
      headers: {
        ...buildApiHeaders({ json: includeJsonContentType }),
        ...(rest.headers || {}),
      },
      credentials: 'include',
    });

    log(`request: response status=${response.status} (${Date.now() - fetchStartTime}ms)`);

    let payload: ApiResponse<TData> | null = null;
    try {
      payload = await response.json();
    } catch {
      // Response body was not valid JSON – surface the HTTP error directly
      if (!response.ok) {
        throw new Error(`Request failed (${response.status} ${response.statusText})`);
      }
      payload = null;
    }

    if (!response.ok || !payload?.success) {
      const message = payload?.error || `Request failed (${response.status})`;
      logError(`request: failed - ${message}`);
      throw new Error(message);
    }

    return payload.data;
  }, []);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const listDirectory = useCallback(async (pathToLoad?: string) => {
    const targetPath = pathToLoad || currentPathRef.current;
    const ownerId = getOrCreateAnonymousSessionId();
    
    // Check list cache first
    const cachedList = getCachedList(targetPath, ownerId);
    if (cachedList) {
      log(`listDirectory: cache hit for "${targetPath}" (fresh: ${cachedList.isFresh})`);
      setCurrentPath(targetPath);
      setNodes(cachedList.nodes);
      return cachedList.nodes;
    }
    
    // Invalidate snapshot cache when directory changes (not list cache since we're fetching new data)
    invalidateSnapshotCache(targetPath, ownerId);
    
    log(`listDirectory: cache miss for "${targetPath}", fetching from API`);
    setIsLoading(true);
    setError(null);
    try {
      const data = await request<{ path: string; nodes: VirtualFilesystemNode[] }>(
        `/api/filesystem/list?path=${encodeURIComponent(targetPath)}`,
        { method: 'GET', includeJsonContentType: false },
      );
      log(`listDirectory: loaded "${data.path}", ${data.nodes.length} entries`);
      
      // Cache the result
      setCachedList(targetPath, ownerId, data.nodes);
      
      setCurrentPath(data.path);
      setNodes(data.nodes);
      return data.nodes;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list files';
      logError(`listDirectory: failed - ${message}`);
      setError(message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [request]);

  const readFile = useCallback(async (filePath: string): Promise<VirtualFile> => {
    // OPFS-first strategy
    if (useOPFS) {
      try {
        const opfsFile = await opfsAdapter.readFile('current-user', filePath);
        log(`readFile: OPFS cache hit for "${filePath}"`);
        return opfsFile;
      } catch (err) {
        logWarn(`readFile: OPFS cache miss for "${filePath}", fetching from server`);
      }
    }
    
    // Server fetch
    return request<VirtualFile>('/api/filesystem/read', {
      method: 'POST',
      body: JSON.stringify({ path: filePath }),
    });
  }, [request, useOPFS, logWarn]);

  const writeFile = useCallback(async (filePath: string, content: string) => {
    log(`writeFile: writing "${filePath}" (contentLength=${content.length})`);
    
    // Invalidate snapshot cache on write
    invalidateSnapshotCache(filePath, getOrCreateAnonymousSessionId());
    
    // OPFS write-through strategy: write to OPFS for instant local reads,
    // then also write to server so listDirectory (server-backed) stays in sync
    if (useOPFS && !offlineMode) {
      // Write to OPFS instantly for local cache
      const opfsFile = await opfsAdapter.writeFile('current-user', filePath, content);
      log(`writeFile: OPFS write complete for "${filePath}", version=${opfsFile.version}`);
      
      // Also write to server so list/snapshot APIs reflect the change
      try {
        await request<any>('/api/filesystem/write', {
          method: 'POST',
          body: JSON.stringify({ path: filePath, content, source: 'use-virtual-filesystem-opfs' }),
        });
        log(`writeFile: server write-through complete for "${filePath}"`);
      } catch (err) {
        logWarn(`writeFile: server write-through failed for "${filePath}", OPFS has the data`, err);
      }
      
      // Update local state immediately
      await listDirectory(currentPathRef.current);
      
      return opfsFile;
    }
    
    // Server-only or offline mode
    const data = await request<{
      path: string;
      version: number;
      previousVersion?: number | null;
      workspaceVersion?: number;
      sessionId?: string | null;
      commitId?: string;
      language: string;
      size: number;
      lastModified: string;
    }>('/api/filesystem/write', {
      method: 'POST',
      body: JSON.stringify({ path: filePath, content, source: 'use-virtual-filesystem' }),
    });
    log(`writeFile: server write complete for "${data.path}", version=${data.version}`);
    await listDirectory(currentPathRef.current);
    return data;
  }, [listDirectory, request, useOPFS, offlineMode, log, logWarn]);

  const deletePath = useCallback(async (targetPath: string) => {
    // Invalidate snapshot cache on delete
    invalidateSnapshotCache(targetPath, getOrCreateAnonymousSessionId());
    
    try {
      const data = await request<{ deletedCount: number }>('/api/filesystem/delete', {
        method: 'POST',
        body: JSON.stringify({ path: targetPath }),
      });
      await listDirectory(currentPathRef.current);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete path';
      log(`deletePath: failed - ${message}`);
      setError(message);
      return null;
    }
  }, [listDirectory, request, log, setError]);

  const search = useCallback(async (
    query: string,
    pathForSearch?: string,
    limit: number = 25,
  ): Promise<VirtualFilesystemSearchResult[]> => {
    if (!query.trim()) {
      return [];
    }
    const targetPath = pathForSearch || currentPathRef.current;
    const data = await request<{
      query: string;
      path: string;
      results: VirtualFilesystemSearchResult[];
    }>(
      `/api/filesystem/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(targetPath)}&limit=${limit}`,
      { method: 'GET', includeJsonContentType: false },
    );
    return data.results;
  }, [request]);

  const getSnapshot = useCallback(async (pathForSnapshot?: string) => {
    const targetPath = pathForSnapshot || currentPathRef.current;
    const ownerId = getOrCreateAnonymousSessionId();
    const cacheKey = `${ownerId}:${targetPath}`;

    // Check shared cache first
    const cached = getCachedSnapshot(targetPath, ownerId);
    if (cached) {
      vfsLogger.log(`getSnapshot: cache hit for "${targetPath}" (fresh: ${cached.isFresh})`);
      return cached.snapshot;
    }

    // Check if request is already in-flight (prevent duplicate concurrent calls)
    const existingRequest = inFlightRequests.get(cacheKey);
    if (existingRequest) {
      log(`getSnapshot: joining in-flight request for "${targetPath}"`);
      return existingRequest;
    }

    log(`getSnapshot: cache miss for "${targetPath}", fetching from API`);

    const requestPromise = (async () => {
      try {
        const data = await request<{
          root: string;
          version: number;
          updatedAt: string;
          path: string;
          files: VirtualWorkspaceSnapshot['files'];
        }>(
          `/api/filesystem/snapshot?path=${encodeURIComponent(targetPath)}`,
          { method: 'GET', includeJsonContentType: false },
        );
        // Only write to cache if the promise stored is still the same one
        const currentPromise = inFlightRequests.get(cacheKey);
        if (currentPromise === requestPromise) {
          setCachedSnapshot(targetPath, ownerId, data);
          inFlightRequests.delete(cacheKey);
        }
        return data;
      } catch (error) {
        logError(`getSnapshot: failed for "${targetPath}"`, error);
        // Remove promise entry on error to avoid repopulating with stale data
        const currentPromise = inFlightRequests.get(cacheKey);
        if (currentPromise === requestPromise) {
          inFlightRequests.delete(cacheKey);
        }
        throw error;
      }
    })();

    inFlightRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }, [request]);

  /**
   * Sync with server (OPFS only)
   */
  const syncWithServer = useCallback(async () => {
    if (!useOPFS) return;

    setSyncStatus(prev => ({ ...prev, isSyncing: true }));

    try {
      const ownerId = getOrCreateAnonymousSessionId();
      const result = await opfsAdapter.syncToServer(ownerId);
      
      setSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        pendingChanges: result.filesSynced,
        lastSyncTime: Date.now(),
        hasConflicts: result.conflicts.length > 0,
      }));

      // Invalidate snapshot cache after OPFS sync (files may have changed)
      invalidateSnapshotCache(undefined, ownerId);

      if (result.conflicts.length > 0) {
        logWarn('Sync completed with conflicts:', result.conflicts);
      }
    } catch (err) {
      logError('Sync failed:', err);
      setSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
      }));
    }
  }, [useOPFS, logWarn, logError]);

  const attachFile = useCallback(async (filePath: string): Promise<AttachedVirtualFile> => {
    const file = await readFile(filePath);
    const attachedFile: AttachedVirtualFile = {
      path: file.path,
      content: file.content,
      version: file.version,
      language: file.language,
      lastModified: file.lastModified,
    };
    setAttachedFiles((previous) => ({
      ...previous,
      [file.path]: attachedFile,
    }));
    return attachedFile;
  }, [readFile]);

  const detachFile = useCallback((filePath: string) => {
    setAttachedFiles((previous) => {
      const next = { ...previous };
      delete next[filePath];
      return next;
    });
  }, []);

  const clearAttachedFiles = useCallback(() => {
    setAttachedFiles({});
  }, []);

  const uploadBrowserFile = useCallback(async (
    file: File,
    options: { targetDirectory?: string } = {},
  ): Promise<string> => {
    const targetDirectory = options.targetDirectory || currentPathRef.current;
    const content = await file.text();
    const targetPath = `${targetDirectory.replace(/\/+$/, '')}/${file.name}`;
    const result = await writeFile(targetPath, content);
    return result.path;
  }, [writeFile]);

  // Load directory on first mount and when initialPath changes
  const hasMountedRef = useRef(false);
  const isLoadingRef = useRef(false); // Track if a load is in progress
  useEffect(() => {
    if (!autoLoad) return;
    // Skip if already loading to prevent race conditions
    if (isLoadingRef.current) {
      log('listDirectory: skipping auto-load, already in progress');
      return;
    }
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      isLoadingRef.current = true;
      void listDirectory(initialPath).finally(() => {
        isLoadingRef.current = false;
      });
    } else if (initialPathRef.current !== initialPath) {
      initialPathRef.current = initialPath;
      isLoadingRef.current = true;
      void listDirectory(initialPath).finally(() => {
        isLoadingRef.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath, autoLoad]);

  const attachedFileList = useMemo(
    () => Object.values(attachedFiles).sort((a, b) => a.path.localeCompare(b.path)),
    [attachedFiles],
  );

  return {
    currentPath,
    nodes,
    attachedFiles,
    attachedFileList,
    isLoading,
    error,
    syncStatus,
    setCurrentPath,
    listDirectory,
    readFile,
    writeFile,
    deletePath,
    search,
    getSnapshot,
    attachFile,
    detachFile,
    clearAttachedFiles,
    uploadBrowserFile,
    syncWithServer,
  };
}
