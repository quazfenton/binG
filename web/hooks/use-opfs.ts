/**
 * useOPFS Hook
 * 
 * React hook for OPFS operations with state management
 * Provides easy access to OPFS functionality in React components
 */

'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { opfsAdapter, OPFSAdapter, type SyncStatus, type SyncResult } from '@/lib/virtual-filesystem/opfs/opfs-adapter';
import { opfsCore, type OPFSStats } from '@/lib/virtual-filesystem/opfs/opfs-core';
import { formatBytes, getOPFSSupportInfo } from '@/lib/virtual-filesystem/opfs/utils';

export interface UseOPFSOptions {
  autoEnable?: boolean;
  workspaceId?: string;
  onSyncComplete?: (result: SyncResult) => void;
  onError?: (error: Error) => void;
}

export interface UseOPFSReturn {
  // State
  isEnabled: boolean;
  isReady: boolean;
  isSyncing: boolean;
  isOnline: boolean;
  opfsSupported: boolean;
  
  // Stats
  stats: OPFSStats | null;
  formattedStats: string;
  
  // Sync status
  syncStatus: SyncStatus;
  pendingChanges: number;
  
  // Operations
  initialize: () => Promise<void>;
  enable: (workspaceId?: string) => Promise<void>;
  disable: () => Promise<void>;
  readFile: (path: string) => Promise<{ content: string; size: number }>;
  writeFile: (path: string, content: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  listDirectory: (path: string) => Promise<Array<{ name: string; type: 'file' | 'directory' }>>;
  syncWithServer: () => Promise<SyncResult>;
  refreshStats: () => Promise<void>;
  
  // Browser support
  supportInfo: ReturnType<typeof getOPFSSupportInfo>;
}

/**
 * React hook for OPFS operations
 * 
 * @param ownerId - Owner/session identifier
 * @param options - Hook options
 * @returns OPFS operations and state
 */
export function useOPFS(
  ownerId: string,
  options: UseOPFSOptions = {}
): UseOPFSReturn {
  const {
    autoEnable = true,
    workspaceId,
    onSyncComplete,
    onError,
  } = options;

  // State
  const [isEnabled, setIsEnabled] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [stats, setStats] = useState<OPFSStats | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSyncing: false,
    pendingChanges: 0,
    lastSyncTime: null,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    hasConflicts: false,
    opfsSupported: OPFSAdapter.isSupported(),
  });
  const [supportInfo, setSupportInfo] = useState<ReturnType<typeof getOPFSSupportInfo>>(
    typeof window !== 'undefined' ? getOPFSSupportInfo() : {
      supported: false,
      browser: 'Server-side',
      details: 'OPFS is only available in browser environments',
    }
  );

  const workspaceIdRef = useRef(workspaceId || ownerId);
  // BUG #2 fix: track which ownerId was last enabled so auto-enable effect
  // can re-run when the ownerId changes (e.g. anonymous session rotation).
  // Previously used a one-shot `initializedRef` gate that blocked re-runs
  // entirely, causing OPFS ref counts to accumulate monotonically without
  // paired disable() calls. Now the effect's cleanup calls
  // `opfsAdapter.disable()` on every deps change (ownerId swap, unmount).
  // The ref prevents spurious re-enables for the same ownerId.
  const enabledOwnerIdRef = useRef<string | null>(null);
  const enablingRef = useRef(false);  // Prevent concurrent enable calls

  // Update online status
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Update support info
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSupportInfo(getOPFSSupportInfo());
    }
  }, []);

  // Update sync status (defined early to avoid hoisting issues)
  // Only setState when values actually change to prevent infinite re-render loops.
  // getSyncStatus() returns a new object literal every call, so naive setState
  // triggers re-renders on every interval tick even when nothing changed.
  const updateSyncStatus = useCallback(() => {
    const status = opfsAdapter.getSyncStatus();
    setSyncStatus(prev => {
      if (
        prev.isSyncing === status.isSyncing &&
        prev.pendingChanges === status.pendingChanges &&
        prev.lastSyncTime === status.lastSyncTime &&
        prev.isOnline === status.isOnline &&
        prev.hasConflicts === status.hasConflicts &&
        prev.opfsSupported === status.opfsSupported
      ) {
        return prev;
      }
      return status;
    });
    setIsSyncing(prev => prev === status.isSyncing ? prev : status.isSyncing);
  }, []);

  // Auto-enable on mount, re-enable when ownerId changes
  // BUG #2 fix: added cleanup that calls opfsAdapter.disable() on ownerId
  // swap or unmount, preventing monotonic ref-count accumulation. The
  // `cancelled` guard prevents setState on unmounted components.
  useEffect(() => {
    if (!autoEnable || !supportInfo.supported) {
      return;
    }

    // If already enabled for this exact ownerId, don't re-enable.
    // The ref replaces the old one-shot `initializedRef` gate which blocked
    // re-runs entirely and allowed enableCount to grow unbounded.
    if (enabledOwnerIdRef.current === ownerId) {
      return;
    }

    let cancelled = false;

    const enableOPFS = async () => {
      try {
        await opfsAdapter.enable(ownerId, workspaceIdRef.current);
        if (cancelled) return;
        enabledOwnerIdRef.current = ownerId;
        setIsEnabled(true);
        setIsReady(true);

        // Initial stats
        await refreshStats();

        // Update sync status
        updateSyncStatus();
      } catch (error) {
        if (cancelled) return;
        console.error('[useOPFS] Failed to enable:', error);
        onError?.(error as Error);
      }
    };

    enableOPFS();

    return () => {
      cancelled = true;
      // BUG #2 fix: decrement ref count when ownerId changes or component
      // unmounts. Previously the effect had no cleanup, so enableCount grew
      // monotonically (console: "incrementing ref count to: 2 → 3 → 4").
      // `opfsAdapter.disable()` decrements the count and only truly disables
      // when ALL callers have released (count reaches zero).
      opfsAdapter.disable().catch((err) => {
        console.warn('[useOPFS] Cleanup disable failed:', err);
      });
    };
  }, [autoEnable, ownerId, supportInfo.supported, onError, updateSyncStatus]);

  // Periodic sync status update
  useEffect(() => {
    if (!isEnabled) return;

    const interval = setInterval(() => {
      updateSyncStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [isEnabled, updateSyncStatus]);

  // Initialize OPFS
  const initialize = useCallback(async () => {
    if (!supportInfo.supported) {
      throw new Error('OPFS not supported in this browser');
    }

    try {
      await opfsCore.initialize(workspaceIdRef.current);
      setIsReady(true);
      await refreshStats();
    } catch (error) {
      onError?.(error as Error);
      throw error;
    }
  }, [supportInfo.supported, onError]);

  // Enable OPFS
  const enable = useCallback(async (customWorkspaceId?: string) => {
    if (!supportInfo.supported) {
      throw new Error('OPFS not supported in this browser');
    }

    // Prevent concurrent enable operations
    if (enablingRef.current || isEnabled) {
      console.log('[useOPFS] Enable already in progress or already enabled, skipping');
      return;
    }

    enablingRef.current = true;
    try {
      const wsId = customWorkspaceId || ownerId;
      await opfsAdapter.enable(ownerId, wsId);
      setIsEnabled(true);
      setIsReady(true);
      await refreshStats();
    } catch (error) {
      onError?.(error as Error);
      throw error;
    } finally {
      enablingRef.current = false;
    }
  }, [ownerId, supportInfo.supported, onError, isEnabled]);

  // Disable OPFS
  const disable = useCallback(async () => {
    try {
      await opfsAdapter.disable();
      setIsEnabled(false);
      setIsReady(false);
      setStats(null);
    } catch (error) {
      onError?.(error as Error);
      throw error;
    }
  }, [onError]);

  // Read file
  const readFile = useCallback(async (path: string): Promise<{ content: string; size: number }> => {
    if (!isEnabled) {
      throw new Error('OPFS not enabled');
    }

    try {
      const file = await opfsAdapter.readFile(ownerId, path);
      return {
        content: file.content,
        size: file.size,
      };
    } catch (error) {
      onError?.(error as Error);
      throw error;
    }
  }, [isEnabled, ownerId, onError]);

  // Write file
  const writeFile = useCallback(async (path: string, content: string): Promise<void> => {
    if (!isEnabled) {
      throw new Error('OPFS not enabled');
    }

    try {
      await opfsAdapter.writeFile(ownerId, path, content);
      // Update stats after write
      await refreshStats();
    } catch (error) {
      onError?.(error as Error);
      throw error;
    }
  }, [isEnabled, ownerId, onError]);

  // Delete file
  const deleteFile = useCallback(async (path: string): Promise<void> => {
    if (!isEnabled) {
      throw new Error('OPFS not enabled');
    }

    try {
      await opfsAdapter.deleteFile(ownerId, path);
      await refreshStats();
    } catch (error) {
      onError?.(error as Error);
      throw error;
    }
  }, [isEnabled, ownerId, onError]);

  // List directory
  const listDirectory = useCallback(async (path: string): Promise<Array<{ name: string; type: 'file' | 'directory' }>> => {
    if (!isEnabled) {
      return [];
    }

    try {
      const entries = await opfsAdapter.listDirectory(path);
      return entries.map(entry => ({
        name: entry.name,
        type: entry.type,
      }));
    } catch (error) {
      console.error('[useOPFS] listDirectory failed for path:', path, error);
      onError?.(error as Error);
      return [];
    }
  }, [isEnabled, onError]);

  // Sync with server
  const syncWithServer = useCallback(async (): Promise<SyncResult> => {
    if (!isEnabled) {
      throw new Error('OPFS not enabled');
    }

    setIsSyncing(true);

    try {
      const result = await opfsAdapter.syncToServer(ownerId);
      
      if (onSyncComplete) {
        onSyncComplete(result);
      }
      
      await refreshStats();
      
      return result;
    } catch (error) {
      onError?.(error as Error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [isEnabled, ownerId, onSyncComplete, onError]);

  // Refresh stats
  const refreshStats = useCallback(async () => {
    if (!opfsCore.isInitialized()) {
      return;
    }

    try {
      const newStats = await opfsCore.getStats();
      setStats(newStats);
    } catch (error) {
      console.warn('[useOPFS] Failed to refresh stats:', error);
    }
  }, []);

  // Formatted stats string
  const formattedStats = stats 
    ? `${stats.totalFiles} files, ${stats.totalDirectories} dirs, ${formatBytes(stats.totalSize)} (${stats.quotaUsage.toFixed(1)}% quota)`
    : 'Not available';

  // Pending changes count
  const pendingChanges = syncStatus.pendingChanges;

  return {
    // State
    isEnabled,
    isReady,
    isSyncing,
    isOnline,
    opfsSupported: supportInfo.supported,
    
    // Stats
    stats,
    formattedStats,
    
    // Sync status
    syncStatus,
    pendingChanges,
    
    // Operations
    initialize,
    enable,
    disable,
    readFile,
    writeFile,
    deleteFile,
    listDirectory,
    syncWithServer,
    refreshStats,
    
    // Browser support
    supportInfo,
  };
}

