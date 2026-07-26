'use client';

/**
 * useSyncStatus — React Hook for Nango Sync Status Polling
 *
 * Monitors Nango sync operations via the existing /api/tools/execute endpoint.
 * Supports start, status polling, and record retrieval.
 *
 * @example
 * ```tsx
 * function SyncMonitor() {
 *   const { status, loading, startSync } = useSyncStatus({
 *     userId: 'user_123',
 *     providerConfigKey: 'github',
 *     syncName: 'issues-sync',
 *     autoPoll: true,
 *   });
 *   return <div>Status: {status.status}</div>;
 * }
 * ```
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Hooks:useSyncStatus');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncStatusInfo {
  status: 'RUNNING' | 'PAUSED' | 'STOPPED' | 'ERROR' | null;
  lastSyncDate?: number;
  lastSyncDateFormatted?: string;
  error?: string;
}

export interface SyncRecord {
  id: string;
  [key: string]: any;
}

export interface UseSyncStatusOptions {
  /** User identifier (connection ID) */
  userId: string | null;
  /** Provider configuration key (e.g. 'github', 'gmail', 'slack') */
  providerConfigKey: string;
  /** Name of the sync to monitor */
  syncName: string;
  /** Polling interval in ms (default: 15000) */
  pollingInterval?: number;
  /** Enable auto-polling (default: false) */
  autoPoll?: boolean;
  /** Called when sync status changes */
  onStatusChange?: (status: SyncStatusInfo) => void;
  /** Called when a sync operation errors */
  onError?: (error: string) => void;
  /** Called when sync completes successfully */
  onSyncComplete?: (records?: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Never';
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 0) return `${seconds}s ago`;
  return 'Just now';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSyncStatus(options: UseSyncStatusOptions) {
  const {
    userId,
    providerConfigKey,
    syncName,
    pollingInterval = 15000,
    autoPoll = false,
    onStatusChange,
    onError,
    onSyncComplete,
  } = options;

  const [status, setStatus] = useState<SyncStatusInfo>({
    status: null,
    error: undefined,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<SyncRecord[]>([]);

  // Refs
  const optionsRef = useRef({ onStatusChange, onError, onSyncComplete });
  optionsRef.current = { onStatusChange, onError, onSyncComplete };
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const syncInProgressRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // -----------------------------------------------------------------------
  // fetchStatus — get sync status via /api/integrations/execute
  // -----------------------------------------------------------------------
  const fetchStatus = useCallback(async (): Promise<SyncStatusInfo | null> => {
    if (!userId) {
      setError('userId is required');
      return null;
    }

    try {
      const res = await fetch('/api/integrations/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'nango',
          action: 'sync_status',
          params: {
            providerConfigKey,
            connectionId: userId,
            syncName,
          },
        }),
      });

      const body = await res.json();

      if (!body.success && body.error) {
        throw new Error(body.error);
      }

      const result = body.data || {};
      const formatted: SyncStatusInfo = {
        status: result.status || null,
        lastSyncDate: result.lastSyncDate ? new Date(result.lastSyncDate).getTime() : undefined,
        lastSyncDateFormatted: formatRelativeTime(
          result.lastSyncDate ? new Date(result.lastSyncDate).getTime() : null
        ),
        error: result.error,
      };

      if (mountedRef.current) {
        setStatus(formatted);
        setError(null);
      }
      optionsRef.current.onStatusChange?.(formatted);
      return formatted;
    } catch (err: any) {
      const msg = err?.message || 'Failed to fetch sync status';
      logger.error('[useSyncStatus] fetchStatus failed:', msg);
      if (mountedRef.current) setError(msg);
      optionsRef.current.onError?.(msg);
      return null;
    }
  }, [userId, providerConfigKey, syncName]);

  // -----------------------------------------------------------------------
  // startSync — trigger sync via /api/integrations/execute
  // -----------------------------------------------------------------------
  const startSync = useCallback(async (): Promise<boolean> => {
    if (!userId || syncInProgressRef.current) return false;

    syncInProgressRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/integrations/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'nango',
          action: 'start_sync',
          params: {
            providerConfigKey,
            connectionId: userId,
            syncName,
          },
        }),
      });

      const body = await res.json();

      if (body.success) {
        // IMPORTANT: Reset syncInProgressRef BEFORE fetchStatus so a
        // thrown error in fetchStatus doesn't permanently lock the ref.
        syncInProgressRef.current = false;
        await fetchStatus();
        if (mountedRef.current) setLoading(false);
        optionsRef.current.onSyncComplete?.();
        return true;
      } else {
        syncInProgressRef.current = false;
        const msg = body.error || 'Sync failed';
        if (mountedRef.current) setError(msg);
        optionsRef.current.onError?.(msg);
        if (mountedRef.current) setLoading(false);
        return false;
      }
    } catch (err: any) {
      const msg = err?.message || 'Failed to start sync';
      logger.error('[useSyncStatus] startSync failed:', msg);
      syncInProgressRef.current = false;
      if (mountedRef.current) {
        setError(msg);
        setLoading(false);
      }
      optionsRef.current.onError?.(msg);
      return false;
    }
  }, [userId, providerConfigKey, syncName, fetchStatus]);

  // -----------------------------------------------------------------------
  // fetchRecords — get synced records via /api/integrations/execute
  // -----------------------------------------------------------------------
  const fetchRecords = useCallback(async (model?: string): Promise<SyncRecord[]> => {
    if (!userId) return [];

    try {
      const res = await fetch('/api/integrations/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'nango',
          action: 'get_records',
          params: {
            providerConfigKey,
            connectionId: userId,
            syncName,
            model,
          },
        }),
      });

      const body = await res.json();
      const result: SyncRecord[] = body.data?.records || body.data || [];
      if (mountedRef.current) setRecords(result);
      return result;
    } catch (err: any) {
      logger.error('[useSyncStatus] fetchRecords failed:', err?.message);
      return [];
    }
  }, [userId, providerConfigKey, syncName]);

  // -----------------------------------------------------------------------
  // refresh — fetch latest status
  // -----------------------------------------------------------------------
  const refresh = useCallback(async (): Promise<void> => {
    await fetchStatus();
  }, [fetchStatus]);

  // -----------------------------------------------------------------------
  // Polling setup
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!autoPoll || !userId) return;

    fetchStatus();

    pollingRef.current = setInterval(() => {
      fetchStatus();
    }, pollingInterval);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [autoPoll, userId, pollingInterval, fetchStatus]);

  return {
    /** Current sync status from Nango */
    status,
    /** True while a sync operation is in-flight */
    loading,
    /** Last error message, or null */
    error,
    /** Synced records (populated after fetchRecords) */
    records,
    /** Trigger a sync operation */
    startSync,
    /** Fetch current status */
    refresh,
    /** Get synced records */
    fetchRecords,
    /** True if the sync is currently running */
    isSyncing: status.status === 'RUNNING',
    /** True if the last sync had an error */
    hasError: status.status === 'ERROR',
  };
}
