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
import { opfsAdapter } from '@/lib/virtual-filesystem/opfs/opfs-adapter';
import { opfsCore } from '@/lib/virtual-filesystem/opfs/opfs-core';

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

  const { log, error: logError, warn: logWarn } = createDebugLogger('useVFS', 'DEBUG_VFS');

  // Initialize OPFS on mount if enabled
  useEffect(() => {
    if (useOPFS && typeof window !== 'undefined') {
      const sessionId = getOrCreateAnonymousSessionId();
      opfsAdapter.enable(sessionId).catch(err => {
        logWarn('OPFS initialization failed, falling back to server-only:', err);
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

  const request = useCallback(async <TData>(
    url: string,
    options: RequestInit & { includeJsonContentType?: boolean } = {},
  ): Promise<TData> => {
    const { includeJsonContentType = true, ...rest } = options;
    log(`request: ${options.method || 'GET'} ${url}`);
    
    const response = await fetch(url, {
      ...rest,
      headers: {
        ...buildApiHeaders({ json: includeJsonContentType }),
        ...(rest.headers || {}),
      },
    });

    log(`request: response status=${response.status}`);
    
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
    log(`listDirectory: loading "${pathToLoad || currentPathRef.current}"`);
    setIsLoading(true);
    setError(null);
    try {
      const targetPath = pathToLoad || currentPathRef.current;
      const data = await request<{ path: string; nodes: VirtualFilesystemNode[] }>(
        `/api/filesystem/list?path=${encodeURIComponent(targetPath)}`,
        { method: 'GET', includeJsonContentType: false },
      );
      log(`listDirectory: loaded "${data.path}", ${data.nodes.length} entries`);
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
    
    // OPFS-first strategy
    if (useOPFS && !offlineMode) {
      // Write to OPFS instantly
      const opfsFile = await opfsAdapter.writeFile('current-user', filePath, content);
      log(`writeFile: OPFS write complete for "${filePath}", version=${opfsFile.version}`);
      
      // Update local state immediately
      await listDirectory(currentPathRef.current);
      
      return opfsFile;
    }
    
    // Server-only or offline mode
    const data = await request<{
      path: string;
      version: number;
      language: string;
      size: number;
      lastModified: string;
    }>('/api/filesystem/write', {
      method: 'POST',
      body: JSON.stringify({ path: filePath, content }),
    });
    log(`writeFile: server write complete for "${data.path}", version=${data.version}`);
    await listDirectory(currentPathRef.current);
    return data;
  }, [listDirectory, request, useOPFS, offlineMode, log]);

  const deletePath = useCallback(async (targetPath: string) => {
    const data = await request<{ deletedCount: number }>('/api/filesystem/delete', {
      method: 'POST',
      body: JSON.stringify({ path: targetPath }),
    });
    await listDirectory(currentPathRef.current);
    return data;
  }, [listDirectory, request]);

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
    return data;
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
  useEffect(() => {
    if (!autoLoad) return;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      void listDirectory(initialPath);
    } else if (initialPathRef.current !== initialPath) {
      initialPathRef.current = initialPath;
      void listDirectory(initialPath);
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
    syncStatus,  // NEW: OPFS sync status
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
    syncWithServer,  // NEW: Manual sync trigger
  };
}
