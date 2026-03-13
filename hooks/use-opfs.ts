/**
 * useOPFS Hook
 * 
 * React hook for OPFS operations with state management
 * Provides easy access to OPFS functionality in React components
 */

'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { opfsAdapter, type SyncStatus, type SyncResult } from '@/lib/virtual-filesystem/opfs/opfs-adapter';
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
    opfsSupported: opfsAdapter.constructor.isSupported(),
  });
  const [supportInfo, setSupportInfo] = useState<ReturnType<typeof getOPFSSupportInfo>>(
    typeof window !== 'undefined' ? getOPFSSupportInfo() : {
      supported: false,
      browser: 'Server-side',
      details: 'OPFS is only available in browser environments',
    }
  );

  const initializedRef = useRef(false);
  const workspaceIdRef = useRef(workspaceId || ownerId);

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

  // Auto-enable on mount
  useEffect(() => {
    if (!autoEnable || initializedRef.current || !supportInfo.supported) {
      return;
    }

    initializedRef.current = true;

    const enableOPFS = async () => {
      try {
        await opfsAdapter.enable(ownerId, workspaceIdRef.current);
        setIsEnabled(true);
        setIsReady(true);
        
        // Initial stats
        await refreshStats();
        
        // Update sync status
        updateSyncStatus();
      } catch (error) {
        console.error('[useOPFS] Failed to enable:', error);
        onError?.(error as Error);
      }
    };

    enableOPFS();
  }, [autoEnable, ownerId, supportInfo.supported, onError]);

  // Periodic sync status update
  useEffect(() => {
    if (!isEnabled) return;

    const interval = setInterval(() => {
      updateSyncStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [isEnabled]);

  // Update sync status
  const updateSyncStatus = useCallback(() => {
    const status = opfsAdapter.getSyncStatus();
    setSyncStatus(status);
    setIsSyncing(status.isSyncing);
  }, []);

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

    try {
      const wsId = customWorkspaceId || ownerId;
      await opfsAdapter.enable(ownerId, wsId);
      setIsEnabled(true);
      setIsReady(true);
      await refreshStats();
    } catch (error) {
      onError?.(error as Error);
      throw error;
    }
  }, [ownerId, supportInfo.supported, onError]);

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
