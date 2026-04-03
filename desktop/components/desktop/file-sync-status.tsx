'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, CheckCircle, AlertCircle, Pause, Loader2 } from 'lucide-react';
import { isDesktopMode } from '@/lib/utils/desktop-env';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('FileSyncStatus');

export type SyncStatus = 'synced' | 'syncing' | 'pending' | 'error' | 'paused';

interface FileSyncStatusProps {
  sandboxId?: string;
  onSync?: () => void;
  className?: string;
}

export function FileSyncStatus({
  sandboxId,
  onSync,
  className,
}: FileSyncStatusProps) {
  const [status, setStatus] = useState<SyncStatus>('synced');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // FIX: Use useRef to persist previous status across polling intervals
  const previousStatusRef = useRef<SyncStatus>(status);

  useEffect(() => {
    setIsDesktop(isDesktopMode());
  }, []);

  // Simulate sync status changes - in real implementation, this would
  // listen to events from the VFS sync engine
  useEffect(() => {
    if (!isDesktop) return;

    const interval = setInterval(() => {
      // In real implementation, this would check actual sync state
      // For now, we'll simulate the status - but preserve error state
      if (previousStatusRef.current === 'error') {
        // Don't clear error state automatically - only manual retry should clear it
        return;
      }

      if (isSyncing) {
        setStatus('syncing');
      } else if (pendingCount > 0) {
        setStatus('pending');
      } else {
        setStatus('synced');
      }
      // Compute next status once and store that value to avoid stale ref
      const nextStatus: SyncStatus = isSyncing
        ? 'syncing'
        : pendingCount > 0
        ? 'pending'
        : 'synced';
      previousStatusRef.current = nextStatus;
    }, 5000);

    return () => clearInterval(interval);
  }, [isDesktop, isSyncing, pendingCount, status]);

  const handleSync = async () => {
    if (!isDesktop || isSyncing) return;

    setIsSyncing(true);
    setStatus('syncing');

    try {
      // In real implementation, this would trigger actual sync
      if (onSync) {
        await onSync();
      }

      setLastSyncTime(new Date());
      setPendingCount(0);
      setStatus('synced');
    } catch (error) {
      log.error('Sync failed', error);
      setStatus('error');
    } finally {
      setIsSyncing(false);
    }
  };

  if (!isDesktop) {
    return null;
  }

  const getStatusConfig = () => {
    switch (status) {
      case 'synced':
        return {
          icon: CheckCircle,
          label: 'Synced',
          variant: 'default' as const,
          description: 'All changes synced to local filesystem',
        };
      case 'syncing':
        return {
          icon: Loader2,
          label: 'Syncing',
          variant: 'outline' as const,
          description: 'Syncing changes to local filesystem...',
        };
      case 'pending':
        return {
          icon: Pause,
          label: `${pendingCount} pending`,
          variant: 'secondary' as const,
          description: `${pendingCount} file(s) waiting to sync to local filesystem`,
        };
      case 'error':
        return {
          icon: AlertCircle,
          label: 'Sync Error',
          variant: 'destructive' as const,
          description: 'Failed to sync changes. Click to retry.',
        };
      case 'paused':
        return {
          icon: Pause,
          label: 'Paused',
          variant: 'secondary' as const,
          description: 'Sync is paused',
        };
      default:
        return {
          icon: CheckCircle,
          label: 'Unknown',
          variant: 'default' as const,
          description: 'Unknown sync status',
        };
    }
  };

  const config = getStatusConfig();
  const StatusIcon = config.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={config.variant}
          className={`cursor-pointer hover:opacity-80 transition-opacity ${className}`}
          onClick={status === 'error' ? handleSync : undefined}
        >
          <StatusIcon
            className={`w-3 h-3 mr-1 ${status === 'syncing' ? 'animate-spin' : ''}`}
          />
          {config.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-1">
          <p>{config.description}</p>
          {lastSyncTime && (
            <p className="text-xs text-muted-foreground">
              Last synced: {lastSyncTime.toLocaleTimeString()}
            </p>
          )}
          {status === 'error' && (
            <p className="text-xs text-destructive">Click to retry</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact sync status indicator for toolbar
 */
export function SyncIndicator({
  className,
  status = 'synced',
}: {
  className?: string;
  status?: SyncStatus;
}) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(isDesktopMode());
  }, []);

  if (!isDesktop) return null;

  const getColor = () => {
    switch (status) {
      case 'synced':
        return 'bg-green-500';
      case 'syncing':
        return 'bg-blue-500 animate-pulse';
      case 'pending':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      case 'paused':
        return 'bg-gray-400';
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <div
      className={`w-2 h-2 rounded-full ${getColor()} ${className}`}
      title={`Sync status: ${status}`}
    />
  );
}

export default FileSyncStatus;