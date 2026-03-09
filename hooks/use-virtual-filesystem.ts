'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateSecureId } from '@/lib/utils';
import type {
  VirtualFile,
  VirtualFilesystemNode,
  VirtualFilesystemSearchResult,
  VirtualWorkspaceSnapshot,
} from '@/lib/virtual-filesystem/filesystem-types';

export interface AttachedVirtualFile {
  path: string;
  content: string;
  version: number;
  language: string;
  lastModified: string;
}

interface ApiResponse<T> {
  success: boolean;
  error?: string;
  data: T;
}

function getOrCreateAnonymousSessionId(): string {
  if (typeof window === 'undefined') {
    return 'server-session';
  }

  let sessionId = localStorage.getItem('anonymous_session_id');
  if (!sessionId) {
    sessionId = generateSecureId('anon');
    localStorage.setItem('anonymous_session_id', sessionId);
  }
  return sessionId;
}

export function useVirtualFilesystem(initialPath: string = 'project', options?: { autoLoad?: boolean }) {
  const autoLoad = options?.autoLoad !== false; // default true
  const [currentPath, setCurrentPath] = useState(initialPath);
  const currentPathRef = useRef(currentPath);
  const initialPathRef = useRef(initialPath);
  const [nodes, setNodes] = useState<VirtualFilesystemNode[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<Record<string, AttachedVirtualFile>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debug flag
  const DEBUG = typeof window !== 'undefined' && (localStorage.getItem('DEBUG_VFS') === 'true' || process.env.NODE_ENV === 'development');
  const log = (...args: any[]) => DEBUG && console.log('[useVFS]', ...args);
  const logError = (...args: any[]) => console.error('[useVFS ERROR]', ...args);
  const logWarn = (...args: any[]) => console.warn('[useVFS WARN]', ...args);

  const buildHeaders = useCallback((includeJsonContentType: boolean): HeadersInit => {
    const headers: Record<string, string> = {
      'x-anonymous-session-id': getOrCreateAnonymousSessionId(),
    };
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (includeJsonContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }, []);

  const request = useCallback(async <TData>(
    url: string,
    options: RequestInit & { includeJsonContentType?: boolean } = {},
  ): Promise<TData> => {
    const { includeJsonContentType = true, ...rest } = options;
    log(`request: ${options.method || 'GET'} ${url}`);
    
    const response = await fetch(url, {
      ...rest,
      headers: {
        ...buildHeaders(includeJsonContentType),
        ...(rest.headers || {}),
      },
    });

    log(`request: response status=${response.status}`);
    
    let payload: ApiResponse<TData> | null = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.success) {
      const message = payload?.error || `Request failed (${response.status})`;
      logError(`request: failed - ${message}`);
      throw new Error(message);
    }

    return payload.data;
  }, [buildHeaders]);

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
    return request<VirtualFile>('/api/filesystem/read', {
      method: 'POST',
      body: JSON.stringify({ path: filePath }),
    });
  }, [request]);

  const writeFile = useCallback(async (filePath: string, content: string) => {
    log(`writeFile: writing "${filePath}" (contentLength=${content.length})`);
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
    log(`writeFile: written "${data.path}", version=${data.version}`);
    await listDirectory(currentPathRef.current);
    return data;
  }, [listDirectory, request]);

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
  };
}
