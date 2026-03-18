/**
 * useOPFSStatus Hook
 * 
 * Lightweight hook for OPFS sync status monitoring
 * Can be used independently from the main useOPFS hook
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { opfsAdapter, type SyncStatus } from '@/lib/virtual-filesystem/opfs/opfs-adapter';
import { getOPFSSupportInfo, type OPFSStats, opfsCore } from '@/lib/virtual-filesystem/opfs';

export interface OPFSStatusState {
  // Sync status
  isSyncing: boolean;
  pendingChanges: number;
  lastSyncTime: number | null;
  lastSyncTimeFormatted: string;
  
  // Connection status
  isOnline: boolean;
  hasConflicts: boolean;
  
  // OPFS availability
  opfsSupported: boolean;
  opfsEnabled: boolean;
  opfsReady: boolean;
  
  // Storage stats
  stats: OPFSStats | null;
  quotaUsagePercent: number;
  availableSpace: string;
  
  // Browser info
  browser: string;
  browserVersion: string;
  supportDetails: string;
}

export interface UseOPFSStatusOptions {
  /** Polling interval in ms (default: 5000) */
  pollingInterval?: number;
  /** Enable auto-polling (default: true) */
  autoPoll?: boolean;
  /** Only poll when online (default: true) */
  pollWhenOnline?: boolean;
}

/**
 * Format timestamp to relative time string
 */
function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 0) return `${seconds}s ago`;
  return 'Just now';
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Hook for monitoring OPFS sync status
 * 
 * @param options - Hook configuration options
 * @returns Current OPFS status state
 */
export function useOPFSStatus(options: UseOPFSStatusOptions = {}): OPFSStatusState {
  const {
    pollingInterval = 5000,
    autoPoll = true,
    pollWhenOnline = true,
  } = options;

  const [state, setState] = useState<OPFSStatusState>({
    isSyncing: false,
    pendingChanges: 0,
    lastSyncTime: null,
    lastSyncTimeFormatted: 'Never',
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    hasConflicts: false,
    opfsSupported: false,
    opfsEnabled: false,
    opfsReady: false,
    stats: null,
    quotaUsagePercent: 0,
    availableSpace: 'Unknown',
    browser: 'Unknown',
    browserVersion: '',
    supportDetails: '',
  });

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Update state helper
  const updateState = useCallback((updates: Partial<OPFSStatusState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // Fetch status from adapter
  const fetchStatus = useCallback(async () => {
    if (pollWhenOnline && !stateRef.current.isOnline) {
      return;
    }

    try {
      // Get sync status from adapter
      const syncStatus = opfsAdapter.getSyncStatus();
      
      // Get storage stats if OPFS is ready
      let stats: OPFSStats | null = null;
      try {
        if (opfsCore.isInitialized()) {
          stats = await opfsCore.getStats();
        }
      } catch (error) {
        console.warn('[useOPFSStatus] Failed to get stats:', error);
      }

      // Get support info
      const supportInfo = getOPFSSupportInfo();

      updateState({
        isSyncing: syncStatus.isSyncing,
        pendingChanges: syncStatus.pendingChanges,
        lastSyncTime: syncStatus.lastSyncTime,
        lastSyncTimeFormatted: formatRelativeTime(syncStatus.lastSyncTime),
        isOnline: syncStatus.isOnline,
        hasConflicts: syncStatus.hasConflicts,
        opfsSupported: syncStatus.opfsSupported,
        opfsEnabled: opfsAdapter.isEnabled(),
        opfsReady: opfsCore.isInitialized(),
        stats,
        quotaUsagePercent: stats?.quotaUsage || 0,
        availableSpace: stats ? formatBytes(stats.availableSpace) : 'Unknown',
        browser: supportInfo.browser,
        browserVersion: supportInfo.version || '',
        supportDetails: supportInfo.details,
      });
    } catch (error) {
      console.warn('[useOPFSStatus] Failed to fetch status:', error);
    }
  }, [pollWhenOnline, updateState]);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Set up polling
  useEffect(() => {
    if (!autoPoll) {
      return;
    }

    // Clear existing polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    // Start new polling
    pollingRef.current = setInterval(() => {
      fetchStatus();
    }, pollingInterval);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [autoPoll, pollingInterval, fetchStatus]);

  // Listen to online/offline events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => updateState({ isOnline: true });
    const handleOffline = () => updateState({ isOnline: false });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [updateState]);

  // Manual refresh function
  const refresh = useCallback(() => {
    return fetchStatus();
  }, [fetchStatus]);

  // Expose refresh via custom event for external triggers
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleRefresh = () => fetchStatus();
    window.addEventListener('opfs-status-refresh', handleRefresh);

    return () => {
      window.removeEventListener('opfs-status-refresh', handleRefresh);
    };
  }, [fetchStatus]);

  return state;
}

/**
 * Hook for OPFS sync progress
 * 
 * @returns Sync progress state and controls
 */
export function useOPFSSyncProgress() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [syncedFiles, setSyncedFiles] = useState(0);

  const startSync = useCallback((total: number) => {
    setIsSyncing(true);
    setTotalFiles(total);
    setSyncedFiles(0);
    setProgress(0);
  }, []);

  const updateProgress = useCallback((synced: number) => {
    setSyncedFiles(synced);
    if (totalFiles > 0) {
      setProgress((synced / totalFiles) * 100);
    }
  }, [totalFiles]);

  const completeSync = useCallback(() => {
    setIsSyncing(false);
    setProgress(100);
    
    // Reset after delay
    setTimeout(() => {
      setProgress(0);
      setTotalFiles(0);
      setSyncedFiles(0);
    }, 2000);
  }, []);

  return {
    isSyncing,
    progress,
    totalFiles,
    syncedFiles,
    startSync,
    updateProgress,
    completeSync,
  };
}
