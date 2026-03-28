"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';

export interface PendingDiff {
  id: string;
  path: string;
  diff: string;
  changeType: 'create' | 'update' | 'delete';
  timestamp: number;
  source: 'sse' | 'manual';
}

/**
 * Hook for managing pending diffs from agent execution with user confirmation.
 * Integrates with the 'diffs' SSE event from useEnhancedChat.
 */
export function useDiffsManager(options?: {
  onApplyDiffs?: (diffs: PendingDiff[]) => Promise<void>;
  autoShowNotification?: boolean;
}) {
  const [pendingDiffs, setPendingDiffs] = useState<PendingDiff[]>([]);
  const [showDiffConfirmation, setShowDiffConfirmation] = useState(false);
  const [selectedDiffs, setSelectedDiffs] = useState<Set<string>>(new Set());
  const pendingDiffsRef = useRef<PendingDiff[]>([]);

  // Keep ref in sync
  useEffect(() => {
    pendingDiffsRef.current = pendingDiffs;
  }, [pendingDiffs]);

  // Listen for 'agent-diffs' events from useEnhancedChat
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleDiffsEvent = (event: CustomEvent<{
      files: Array<{ path: string; diff: string; changeType: string }>;
      count: number;
      requestId?: string;
      timestamp: number;
    }>) => {
      const { files, count, requestId } = event.detail;
      
      if (!files || files.length === 0) return;

      const newDiffs: PendingDiff[] = files.map((file, index) => ({
        id: `${requestId || 'diff'}-${index}-${Date.now()}`,
        path: file.path,
        diff: file.diff,
        changeType: file.changeType as 'create' | 'update' | 'delete',
        timestamp: Date.now(),
        source: 'sse',
      }));

      // Avoid duplicates by path
      const existingPaths = new Set(pendingDiffsRef.current.map(d => d.path));
      const uniqueNew = newDiffs.filter(d => !existingPaths.has(d.path));

      setPendingDiffs(prev => [...prev, ...uniqueNew]);

      // Auto-select all new diffs
      setSelectedDiffs(prev => {
        const next = new Set(prev);
        uniqueNew.forEach(d => next.add(d.id));
        return next;
      });

      // Show notification
      if (options?.autoShowNotification !== false) {
        toast.info(`${count} file${count === 1 ? '' : 's'} changed. Review and apply?`, {
          duration: 5000,
          action: {
            label: 'Review',
            onClick: () => setShowDiffConfirmation(true),
          },
        });
      }
    };

    window.addEventListener('agent-diffs', handleDiffsEvent as EventListener);
    return () => {
      window.removeEventListener('agent-diffs', handleDiffsEvent as EventListener);
    };
  }, [options?.autoShowNotification]);

  // Select/deselect a diff
  const toggleDiffSelection = useCallback((diffId: string) => {
    setSelectedDiffs(prev => {
      const next = new Set(prev);
      if (next.has(diffId)) {
        next.delete(diffId);
      } else {
        next.add(diffId);
      }
      return next;
    });
  }, []);

  // Select/deselect all diffs
  const selectAllDiffs = useCallback(() => {
    setSelectedDiffs(new Set(pendingDiffs.map(d => d.id)));
  }, [pendingDiffs]);

  const deselectAllDiffs = useCallback(() => {
    setSelectedDiffs(new Set());
  }, []);

  // Apply selected diffs
  const applySelectedDiffs = useCallback(async () => {
    const toApply = pendingDiffs.filter(d => selectedDiffs.has(d.id));
    if (toApply.length === 0) {
      toast.error('No diffs selected');
      return;
    }

    try {
      if (options?.onApplyDiffs) {
        await options.onApplyDiffs(toApply);
      } else {
        // Default: call the API
        const response = await fetch('/api/filesystem/diffs/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            diffs: toApply.map(d => ({
              path: d.path,
              diff: d.diff,
              changeType: d.changeType,
            })),
          }),
        });
        
        if (!response.ok) {
          throw new Error(`Failed to apply diffs: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || 'Failed to apply diffs');
        }

        // Notify UI panels of filesystem changes
        emitFilesystemUpdated({
          paths: toApply.map(d => d.path),
          type: 'update',
          source: 'diffs-apply',
          applied: toApply.map(d => ({
            path: d.path,
            operation: d.changeType,
            timestamp: Date.now(),
          })),
        });

        toast.success(`Applied ${toApply.length} diff${toApply.length === 1 ? '' : 's'}`);
      }

      // Remove applied diffs from pending
      setPendingDiffs(prev => prev.filter(d => !selectedDiffs.has(d.id)));
      setSelectedDiffs(new Set());
      setShowDiffConfirmation(false);
    } catch (error) {
      console.error('Failed to apply diffs:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to apply diffs');
    }
  }, [pendingDiffs, selectedDiffs, options?.onApplyDiffs]);

  // Dismiss all pending diffs
  const dismissAllDiffs = useCallback(() => {
    setPendingDiffs([]);
    setSelectedDiffs(new Set());
    setShowDiffConfirmation(false);
    toast.info('Dismissed pending diffs');
  }, []);

  // Remove a specific diff
  const dismissDiff = useCallback((diffId: string) => {
    setPendingDiffs(prev => prev.filter(d => d.id !== diffId));
    setSelectedDiffs(prev => {
      const next = new Set(prev);
      next.delete(diffId);
      return next;
    });
  }, []);

  // Open confirmation dialog
  const openDiffReview = useCallback(() => {
    setShowDiffConfirmation(true);
  }, []);

  // Close confirmation dialog
  const closeDiffReview = useCallback(() => {
    setShowDiffConfirmation(false);
  }, []);

  return {
    // State
    pendingDiffs,
    showDiffConfirmation,
    selectedDiffs,
    hasPendingDiffs: pendingDiffs.length > 0,
    selectedCount: selectedDiffs.size,
    
    // Actions
    toggleDiffSelection,
    selectAllDiffs,
    deselectAllDiffs,
    applySelectedDiffs,
    dismissAllDiffs,
    dismissDiff,
    openDiffReview,
    closeDiffReview,
    
    // Reset
    reset: useCallback(() => {
      setPendingDiffs([]);
      setSelectedDiffs(new Set());
      setShowDiffConfirmation(false);
    }, []),
  };
}