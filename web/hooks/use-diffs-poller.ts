"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

export interface DiffsResponse {
  success: boolean;
  ownerId?: string;
  count?: number;
  files?: Array<{
    path: string;
    diff: string;
    changeType: 'create' | 'update' | 'delete';
  }>;
  error?: string;
}

export interface PolledDiff {
  id: string;
  path: string;
  diff: string;
  changeType: 'create' | 'update' | 'delete';
  timestamp: number;
  source: 'poll';
}

export interface UseDiffsPollerOptions {
  /** Polling interval in milliseconds (default: 5000) */
  pollInterval?: number;
  /** Maximum files to fetch per poll (default: 50) */
  maxFiles?: number;
  /** Callback when new diffs are fetched */
  onDiffsFetched?: (diffs: PolledDiff[]) => void;
  /** Enable auto-notification when diffs arrive (default: true) */
  autoShowNotification?: boolean;
  /** Custom API endpoint (default: /api/filesystem/diffs) */
  endpoint?: string;
}

export interface UseDiffsPollerReturn {
  /** Current polled diffs */
  diffs: PolledDiff[];
  /** Whether polling is active */
  isPolling: boolean;
  /** Error from last poll (if any) */
  error: Error | null;
  /** Last successful poll timestamp */
  lastPolledAt: number | null;
  /** Number of polls attempted */
  pollCount: number;
  /** Start polling */
  startPolling: () => void;
  /** Stop polling */
  stopPolling: () => void;
  /** Manually trigger a single poll */
  pollNow: () => Promise<void>;
  /** Clear all diffs */
  clearDiffs: () => void;
  /** Reset polling state */
  reset: () => void;
}

/**
 * Hook that polls /api/filesystem/diffs endpoint as an alternative to SSE.
 * Useful when SSE is not available or as a fallback mechanism.
 */
export function useDiffsPoller(options: UseDiffsPollerOptions = {}): UseDiffsPollerReturn {
  const {
    pollInterval = 10000, // Increased from 5000 to 10000 to prevent rate limiting
    maxFiles = 50,
    onDiffsFetched,
    autoShowNotification = true,
    endpoint = '/api/filesystem/diffs',
  } = options;

  const [diffs, setDiffs] = useState<PolledDiff[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const [pollCount, setPollCount] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isPollingRef = useRef(false);
  const isMountedRef = useRef(true);
  const lastFetchedCountRef = useRef<number>(0);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Single poll function
  const pollNow = useCallback(async () => {
    // Prevent concurrent polls
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    // Create new abort controller for this request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const url = `${endpoint}?maxFiles=${maxFiles}`;
      const response = await fetch(url, {
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        // Handle rate limiting - don't treat as error, just skip this poll
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          console.debug('[DiffsPoller] Rate limited, will retry after', retryAfter, 'seconds');
          // Don't set error state for rate limiting - it's expected behavior
          return;
        }
        throw new Error(`Poll failed: ${response.status} ${response.statusText}`);
      }

      const data: DiffsResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch diffs');
      }

      // Check if there are new diffs
      if (data.count > 0 && data.count !== lastFetchedCountRef.current) {
        lastFetchedCountRef.current = data.count;

        const newDiffs: PolledDiff[] = data.files.map((file, index) => ({
          id: `poll-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          path: file.path,
          diff: file.diff,
          changeType: file.changeType,
          timestamp: Date.now(),
          source: 'poll' as const,
        }));

        if (isMountedRef.current) {
          setDiffs(prev => {
            // Avoid duplicates by path
            const existingPaths = new Set(prev.map(d => d.path));
            const uniqueNew = newDiffs.filter(d => !existingPaths.has(d.path));
            return [...prev, ...uniqueNew];
          });

          // Call the callback
          if (onDiffsFetched) {
            onDiffsFetched(newDiffs);
          }

          // Show notification
          if (autoShowNotification && newDiffs.length > 0) {
            toast.info(`${newDiffs.length} new file${newDiffs.length === 1 ? '' : 's'} changed`, {
              duration: 4000,
            });
          }
        }
      }

      if (isMountedRef.current) {
        setError(null);
        setLastPolledAt(Date.now());
        setPollCount(prev => prev + 1);
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return;

      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Poll failed'));
        setPollCount(prev => prev + 1);
      }
    } finally {
      isPollingRef.current = false;
    }
  }, [endpoint, maxFiles, onDiffsFetched, autoShowNotification]);

  // Start polling
  const startPolling = useCallback(() => {
    if (intervalRef.current) return; // Already polling

    setIsPolling(true);
    
    // Immediate first poll
    pollNow();

    // Set up interval
    intervalRef.current = setInterval(() => {
      pollNow();
    }, pollInterval);
  }, [pollInterval, pollNow]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isPollingRef.current = false;
    setIsPolling(false);
  }, []);

  // Clear all diffs
  const clearDiffs = useCallback(() => {
    setDiffs([]);
    lastFetchedCountRef.current = 0;
  }, []);

  // Reset everything
  const reset = useCallback(() => {
    stopPolling();
    setDiffs([]);
    setError(null);
    setLastPolledAt(null);
    setPollCount(0);
    lastFetchedCountRef.current = 0;
  }, [stopPolling]);

  return {
    diffs,
    isPolling,
    error,
    lastPolledAt,
    pollCount,
    startPolling,
    stopPolling,
    pollNow,
    clearDiffs,
    reset,
  };
}