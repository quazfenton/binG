'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getOrCreateAnonymousSessionId, buildApiHeaders, syncAnonymousSessionId } from '@/lib/utils';
import { createDebugLogger } from '../../infra/config/config/features';
import type {
  VirtualFile,
  VirtualFilesystemNode,
  VirtualFilesystemSearchResult,
  VirtualWorkspaceSnapshot,
} from '@/lib/virtual-filesystem/filesystem-types';
import { opfsAdapter, OPFSAdapter } from '@/lib/virtual-filesystem/opfs/opfs-adapter';
import { opfsCore } from '@/lib/virtual-filesystem/opfs/opfs-core';
import { onFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { sanitizeExtractedPath } from '@/lib/chat/file-edit-parser';

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
  /**
   * Composite session ID — format is `userId$sessionNum` (e.g., "1$004")
   * for authenticated users, or `anon$sessionNum` (e.g., "anon$004")
   * for anonymous users. This is used as the ownerId for VFS database partitioning.
   */
  compositeSessionId?: string;
  /**
   * Authenticated user ID — when provided, becomes the ownerId for VFS
   * operations. When omitted, falls back to anonymous session ID.
   */
  userId?: string;
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
const SNAPSHOT_CACHE_TTL_MS = 10000;  // 10 seconds for snapshots (was 5s) - reduced polling
const LIST_CACHE_TTL_MS = 8000;      // 8 seconds for directory listings (was 3s) - reduced polling
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
  initialPath?: string,
  options: UseVirtualFilesystemOptions = {}
) {
  const autoLoad = options?.autoLoad !== false; // default true
  const useOPFS = options?.useOPFS ?? false;
  const offlineMode = options?.offlineMode ?? false;

  // Derive session ID from initialPath if it's a scoped path (e.g., "project/sessions/004")
  const deriveSessionIdFromPath = (path: string): string | null => {
    const match = path.match(/^project\/sessions\/([^/]+)/);
    return match ? match[1] : null;
  };

  // FIX: Derive the session folder name from compositeSessionId.
  // Format: "userId$sessionNum" (e.g., "1$004") → extract "004"
  // Format: "anon$sessionNum" (e.g., "anon$001") → extract "001"
  // This ensures the VFS always starts in the correct session subdirectory.
  // SECURITY: Use indexOf (FIRST $) not split().pop(), because:
  // - userId is system-controlled and NEVER contains $
  // - sessionId MAY contain user-provided $ (e.g., folder named "my$project")
  const deriveSessionFolderFromComposite = (): string | null => {
    const composite = options?.compositeSessionId;
    if (!composite) return null;
    if (composite.includes('$')) {
      const dollarIndex = composite.indexOf('$');
      return composite.slice(dollarIndex + 1); // Return session number part
    }
    // If no $ separator, check if it's already a simple session number
    if (/^\d{2,4}$/.test(composite) || /^[a-z]+(-\d+)?$/.test(composite)) {
      return composite;
    }
    return null;
  };

  // Compute the resolved session-scoped path for initialization
  const resolveInitialSessionPath = (): string => {
    // Priority 1: If initialPath is already a scoped path (e.g., "project/sessions/..."), use it
    if (initialPath && initialPath.includes('sessions/')) {
      return initialPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    }
    // Priority 2: Derive session folder from compositeSessionId
    const sessionFolder = deriveSessionFolderFromComposite();
    if (sessionFolder) {
      return `project/sessions/${sessionFolder}`;
    }
    // Priority 3: Derive from initialPath
    const derived = deriveSessionIdFromPath(initialPath || '');
    if (derived) {
      return `project/sessions/${derived}`;
    }
    // Priority 4: Fall back to 'project' root (for legacy/test scenarios)
    return 'project';
  };

  const resolvedInitialPath = resolveInitialSessionPath();
  
  // Allow passing compositeSessionId from parent, or derive from path, or fall back to anonymous
  const getSessionId = useCallback(() => {
    if (options?.compositeSessionId) return options.compositeSessionId;
    const derived = deriveSessionIdFromPath(initialPath);
    if (derived) return derived;
    return getOrCreateAnonymousSessionId();
  }, [options?.compositeSessionId, initialPath]);

  // FIX: Derive ownerId for server-side VFS operations.
  // Priority order:
  // 1. Explicit options.userId (authenticated user) — ensures logged-in users see their own workspace
  // 2. Composite sessionId in "userId$sessionNum" format (e.g., "1$004") — extract userId part
  // 3. Derive from scoped path (e.g., "project/sessions/004")
  // 4. Fall back to anonymous session ID
  // SECURITY: Use indexOf (FIRST $) not split()[0], because:
  // - userId is system-controlled and NEVER contains $
  // - sessionId MAY contain user-provided $ (e.g., folder named "my$project")
  const getOwnerId = useCallback(() => {
    // Priority 1: Explicit authenticated userId
    if (options?.userId) return options.userId;

    // Priority 2: Composite sessionId format "userId$sessionNum"
    if (options?.compositeSessionId && options.compositeSessionId.includes('$')) {
      const dollarIndex = options.compositeSessionId.indexOf('$');
      const userIdPart = options.compositeSessionId.slice(0, dollarIndex);
      if (userIdPart && userIdPart !== 'anon') return userIdPart;
    }

    // Priority 3: Derive from scoped path
    const derived = deriveSessionIdFromPath(initialPath);
    if (derived) return derived;

    // Priority 4: Fall back to anonymous session ID
    return getOrCreateAnonymousSessionId();
  }, [options?.userId, options?.compositeSessionId, initialPath]);

  const [currentPath, setCurrentPath] = useState(resolvedInitialPath);
  const currentPathRef = useRef(currentPath);
  const initialPathRef = useRef(resolvedInitialPath);
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
      // Use authenticated userId for OPFS workspace when available
      const opfsOwnerId = options?.userId || getSessionId();

      // Check if OPFS is supported
      if (!OPFSAdapter.isSupported()) {
        logWarn('OPFS not supported in this browser - using server-only mode');
        return;
      }

      opfsAdapter.enable(opfsOwnerId).then(() => {
        log('OPFS enabled successfully for owner:', opfsOwnerId);
      }).catch(err => {
        logWarn('OPFS initialization failed, falling back to server-only:', err?.message || err);
      });
    }

    return () => {
      if (useOPFS) {
        opfsAdapter.disable().catch(console.error);
      }
    };
  }, [useOPFS, logWarn, options?.userId, options?.compositeSessionId, getSessionId]);

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

  // Update sync status periodically (reduced frequency — local in-memory read only)
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
    }, 15000);

    return () => clearInterval(interval);
  }, [useOPFS]);

  // Rate limit backoff state - persists across debounce cycles
  const rateLimitBackoffRef = useRef<{ path: string; retryAfter: number; retryCount: number }>({
    path: '',
    retryAfter: 0,
    retryCount: 0,
  });

  // Listen for filesystem-updated events from other panels (code-preview-panel, conversation-interface, etc.)
  // and invalidate the snapshot cache AND trigger immediate re-fetch to ensure fresh data
  // Note: We define a local fetch function here since 'request' is defined after this useEffect
  useEffect(() => {
    // Debounce rapid filesystem events to prevent excessive re-fetching
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const DEBOUNCE_MS = 150; // Wait 150ms after last event before fetching
    
    // CRITICAL: Keep one shared set across all events to accumulate paths
    // This prevents losing paths when rapid events clear the timer
    const pendingPathsToRefresh = new Set<string>();
    
    // Helper function to actually fetch and update directory listing
    const fetchAndUpdateDirectory = (path: string, ownerId: string) => {
      fetch(`/api/filesystem/list?path=${encodeURIComponent(path)}`, {
        method: 'GET',
        headers: buildApiHeaders({ json: false }),
        credentials: 'include',
      })
      .then(res => {
        // Handle rate limiting (429) with exponential backoff
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get('Retry-After') || res.headers.get('X-RateLimit-Reset');
          let retryAfterMs = 2000; // default 2s
          
          if (retryAfterHeader) {
            const parsed = parseInt(retryAfterHeader, 10);
            if (!isNaN(parsed)) {
              retryAfterMs = parsed > Date.now() ? parsed - Date.now() : parsed * 1000;
            }
          }
          
          // Check response body for retryAfter
          return res.json().then(body => {
            if (body?.retryAfter) {
              retryAfterMs = body.retryAfter * 1000;
            }
            
            logWarn(`[filesystem-updated] Rate limited on "${path}", backing off for ${retryAfterMs}ms`);
            
            // Set backoff state using ref
            rateLimitBackoffRef.current = {
              path,
              retryAfter: Date.now() + retryAfterMs,
              retryCount: rateLimitBackoffRef.current.retryCount + 1,
            };
            
            // Schedule retry with backoff
            if (rateLimitBackoffRef.current.retryCount <= 3) {
              setTimeout(() => {
                log(`[filesystem-updated] Retrying rate-limited path "${path}" (attempt ${rateLimitBackoffRef.current.retryCount})`);
                fetchAndUpdateDirectory(path, ownerId);
              }, retryAfterMs);
            }
            
            return { success: false, rateLimited: true };
          }).catch(() => ({ success: false, rateLimited: true }));
        }
        
        // Sync session ID with server to prevent fragmentation
        syncAnonymousSessionId(res);
        return res.json();
      })
      .then((payload: any) => {
        if (payload?.success && payload?.data) {
          const data = payload.data;
          log(`[filesystem-updated] Refreshed directory: "${data.path}", ${data.nodes.length} entries`);
          setCachedList(path, ownerId, data.nodes);
          // Update UI state if this is the current path
          if (path === currentPathRef.current) {
            setNodes(data.nodes);
          }
        } else if (payload?.rateLimited) {
          logWarn(`[filesystem-updated] Rate limited response for "${path}"`);
        }
      })
      .catch(err => {
        logWarn(`[filesystem-updated] Failed to refresh "${path}":`, err);
      });
    };

    const unsubscribe = onFilesystemUpdated((event) => {
      const detail = event.detail;

      // Get current session ID when event fires (not at effect creation time)
      const ownerId = getOwnerId();
      const currentPath = currentPathRef.current;

      // Determine which paths need refresh (deduplicate)
      // Add to the SHARED pending set, not a local one
      const addRefreshPath = (rawPath?: string) => {
        if (!rawPath) return;
        const path = sanitizeExtractedPath(rawPath, { isFolder: true });
        if (!path) {
          logWarn(`[filesystem-updated] Ignoring invalid refresh path: "${rawPath}"`);
          return;
        }
        pendingPathsToRefresh.add(path);
      };

      if (detail.scopePath) {
        addRefreshPath(detail.scopePath);
      }
      if (detail.path) {
        addRefreshPath(detail.path);
      }
      if (detail.paths && detail.paths.length > 0) {
        detail.paths.forEach(addRefreshPath);
      }

      // CRITICAL FIX: Sync session ID from event detail to prevent fragmentation
      // When files are written, the server may have used a different session ID than
      // what the client currently has in localStorage. This causes reads to return
      // empty results while writes went to a different workspace.

      // CRITICAL FIX: Extract simple session ID from potentially composite IDs
      // This handles formats like "1$004" -> "004" (composite) or "1" -> "1" (just userId)
      // Returns empty string for invalid input - caller should handle this case
      // SECURITY: Use indexOf (FIRST $) not split().pop(), because:
      // - userId is system-controlled and NEVER contains $
      // - sessionId MAY contain user-provided $ (e.g., folder named "my$project")
      const extractSessionPart = (id: string): string => {
        if (!id || typeof id !== 'string') return '';
        const trimmed = id.trim();
        if (!trimmed) return '';
        // Extract segment after FIRST $ (handles composite IDs like "1$004")
        if (trimmed.includes('$')) {
          const dollarIndex = trimmed.indexOf('$');
          return trimmed.slice(dollarIndex + 1).trim();
        }
        return trimmed;
      };
      
      // If event has a sessionId, sync with local session to prevent reading from wrong workspace
      if (detail.sessionId) {
        const eventSessionId = detail.sessionId;
        const currentOwnerId = getOwnerId();
        const currentSessionPart = extractSessionPart(currentOwnerId);
        
        // If the session parts differ, sync to the server's session to ensure reads
        // hit the same workspace where the writes occurred
        if (eventSessionId !== currentSessionPart) {
          log(`[filesystem-updated] Session mismatch - syncing to server session: event=${eventSessionId}, current=${currentSessionPart}`);
          
          // Update localStorage to match the server's session ID format
          if (typeof window !== 'undefined') {
            try {
              // Store the full session ID (with anon_ prefix for consistency with getOrCreateAnonymousSessionId)
              const fullSessionId = eventSessionId.startsWith('anon_') ? eventSessionId : `anon_${eventSessionId}`;
              localStorage.setItem('anonymous_session_id', fullSessionId);
            } catch {}
          }
          
          // Clear ALL caches to force fresh reads with the correct session
          invalidateSnapshotCache(undefined, undefined);
        }
      }

      // Invalidate cache immediately (don't debounce this)
      for (const path of pendingPathsToRefresh) {
        invalidateSnapshotCache(path, ownerId);
      }

      if (pendingPathsToRefresh.size === 0) {
        // No path info - invalidate all caches to be safe
        log(`[filesystem-updated] Invalidating all snapshot caches (no path info)`);
        invalidateSnapshotCache(undefined, ownerId);
        pendingPathsToRefresh.add(currentPath);
      }

      // DEBOUNCE: Batch rapid filesystem events to prevent excessive API calls
      // This fixes the polling issue where 4+ events fire in 66ms
      // IMPORTANT: We clear the timer but NOT the pendingPathsToRefresh set
      // This ensures all accumulated paths are processed when the timer fires
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        log(`[filesystem-updated] Debounced refresh for ${pendingPathsToRefresh.size} paths`);

        // Fetch fresh data for all affected paths
        for (const path of pendingPathsToRefresh) {
          // CRITICAL FIX: Skip file paths - only directories should call listDirectory
          // File paths (contain extension, no trailing slash) should use readFile instead
          const isFilePath = path.includes('.') && !path.endsWith('/') && !path.endsWith('/.directory');
          if (isFilePath) {
            log(`[filesystem-updated] Skipping listDirectory for file path: "${path}" - invalidating cache only`);
            invalidateSnapshotCache(path, ownerId);
            continue;
          }
          
          // Check if this path is currently rate limited using the ref
          if (rateLimitBackoffRef.current.path === path && rateLimitBackoffRef.current.retryCount > 0) {
            if (Date.now() < rateLimitBackoffRef.current.retryAfter) {
              log(`[filesystem-updated] Skipping rate-limited path "${path}", retry after ${rateLimitBackoffRef.current.retryAfter - Date.now()}ms`);
              continue;
            } else {
              // Backoff expired, reset retry count for this path
              rateLimitBackoffRef.current.retryCount = 0;
            }
          }
          
          // Use the helper function to fetch and update directory
          fetchAndUpdateDirectory(path, ownerId);
        }

        // Clear the pending set AFTER all fetches are scheduled
        pendingPathsToRefresh.clear();
        debounceTimer = null;
      }, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      // Clear pending paths on cleanup
      pendingPathsToRefresh.clear();
    };
  }, [log, logWarn, getOwnerId, invalidateSnapshotCache, setCachedList, buildApiHeaders]);

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

    // Sync session ID with server to prevent fragmentation
    syncAnonymousSessionId(response);

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
      const ownerId = getOwnerId();
    
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
    // Normalize path: strip leading slash since VFS uses relative paths (e.g., "project/..." not "/project/...")
    const normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;

    // OPFS-first strategy — use authenticated userId for OPFS when available
    if (useOPFS) {
      try {
        const opfsOwnerId = options?.userId || getSessionId();
        const opfsFile = await opfsAdapter.readFile(opfsOwnerId, normalizedPath);
        log(`readFile: OPFS cache hit for "${normalizedPath}"`);
        return opfsFile;
      } catch (err) {
        logWarn(`readFile: OPFS cache miss for "${normalizedPath}", fetching from server`);
      }
    }

    // Server fetch
    return request<VirtualFile>('/api/filesystem/read', {
      method: 'POST',
      body: JSON.stringify({ path: normalizedPath }),
    });
  }, [request, useOPFS, logWarn, options?.userId, getSessionId]);

  const writeFile = useCallback(async (filePath: string, content: string) => {
    // Normalize path: strip leading slash since VFS uses relative paths
    const normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    log(`writeFile: writing "${normalizedPath}" (contentLength=${content.length})`);

    // Invalidate snapshot cache on write — use authenticated userId
    invalidateSnapshotCache(normalizedPath, getOwnerId());

    // OPFS write-through strategy: write to OPFS for instant local reads,
    // then also write to server so listDirectory (server-backed) stays in sync
    if (useOPFS && !offlineMode) {
      // Write to OPFS instantly for local cache — use authenticated userId
      const opfsOwnerId = options?.userId || getSessionId();
      const opfsFile = await opfsAdapter.writeFile(opfsOwnerId, normalizedPath, content);
      log(`writeFile: OPFS write complete for "${normalizedPath}", version=${opfsFile.version}`);

      // Also write to server so list/snapshot APIs reflect the change
      try {
        await request<any>('/api/filesystem/write', {
          method: 'POST',
          body: JSON.stringify({ path: normalizedPath, content, source: 'use-virtual-filesystem-opfs' }),
        });
        log(`writeFile: server write-through complete for "${normalizedPath}"`);
      } catch (err) {
        logWarn(`writeFile: server write-through failed for "${normalizedPath}", OPFS has the data`, err);
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
      body: JSON.stringify({ path: normalizedPath, content, source: 'use-virtual-filesystem' }),
    });
    log(`writeFile: server write complete for "${data.path}", version=${data.version}`);
    await listDirectory(currentPathRef.current);
    return data;
  }, [listDirectory, request, useOPFS, offlineMode, log, logWarn, getOwnerId, options?.userId, getSessionId]);

  const deletePath = useCallback(async (targetPath: string) => {
    // Invalidate snapshot cache on delete — use authenticated userId
    invalidateSnapshotCache(targetPath, getOwnerId());
    
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
      const ownerId = getOwnerId();
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
      const ownerId = getOwnerId();
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

  // Load directory on first mount and when resolvedInitialPath changes
  const hasMountedRef = useRef(false);
  const isLoadingRef = useRef(false); // Track if a load is in progress
  const pendingPathRef = useRef<string | null>(null); // Queue pending path changes
  const loadedPathRef = useRef<string | null>(null); // Track what path was last loaded
  useEffect(() => {
    if (!autoLoad) return;

    const loadPath = (path: string) => {
      isLoadingRef.current = true;
      void listDirectory(path).finally(() => {
        isLoadingRef.current = false;
        loadedPathRef.current = path;
        // Check if there's a pending path to load
        if (pendingPathRef.current !== null) {
          const nextPath = pendingPathRef.current;
          pendingPathRef.current = null;
          initialPathRef.current = nextPath;
          loadPath(nextPath);
        }
      });
    };

    // If already loading, queue this path for later instead of skipping
    if (isLoadingRef.current) {
      log('listDirectory: queuing path change for after current load completes:', resolvedInitialPath);
      pendingPathRef.current = resolvedInitialPath;
      return;
    }

    // CRITICAL: If compositeSessionId just became available and we loaded 'project' root,
    // re-navigate to the correct session-scoped path
    const sessionFolder = deriveSessionFolderFromComposite();
    if (sessionFolder && loadedPathRef.current === 'project') {
      log('listDirectory: compositeSessionId now available, navigating to session folder:', resolvedInitialPath);
      hasMountedRef.current = false; // Reset to force reload
    }

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      loadPath(resolvedInitialPath);
    } else if (initialPathRef.current !== resolvedInitialPath && resolvedInitialPath !== 'project') {
      initialPathRef.current = resolvedInitialPath;
      loadPath(resolvedInitialPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedInitialPath, autoLoad, options?.compositeSessionId]);

  const attachedFileList = useMemo(
    () => Object.values(attachedFiles).sort((a, b) => a.path.localeCompare(b.path)),
    [attachedFiles],
  );

  // Derive session folder name from composite ID for external use
  const sessionFolder = deriveSessionFolderFromComposite() || deriveSessionIdFromPath(resolvedInitialPath);

  return {
    currentPath,
    nodes,
    attachedFiles,
    attachedFileList,
    isLoading,
    error,
    syncStatus,
    compositeSessionId: options?.compositeSessionId || null,
    sessionFolder,
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
