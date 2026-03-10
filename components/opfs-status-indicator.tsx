/**
 * OPFS Status Indicator Component
 * 
 * Displays OPFS sync status, online/offline state, and pending changes
 * Provides visual feedback for OPFS operations
 */

'use client';

import React from 'react';
import { useOPFSStatus } from '@/hooks/use-opfs-status';
import { formatBytes } from '@/lib/virtual-filesystem/opfs/utils';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  HardDrive,
  Wifi,
  WifiOff,
  Clock,
  FileSync,
} from 'lucide-react';

export interface OPFSStatusIndicatorProps {
  /** Show detailed stats (default: false) */
  showDetails?: boolean;
  /** Show browser support info (default: false) */
  showSupportInfo?: boolean;
  /** Custom className */
  className?: string;
  /** Enable manual sync button (default: true) */
  enableSync?: boolean;
  /** On manual sync trigger */
  onSync?: () => Promise<void>;
}

/**
 * OPFS Status Indicator Component
 */
export function OPFSStatusIndicator({
  showDetails = false,
  showSupportInfo = false,
  className = '',
  enableSync = true,
  onSync,
}: OPFSStatusIndicatorProps) {
  const status = useOPFSStatus({
    pollingInterval: 5000,
    autoPoll: true,
  });

  const handleSync = async () => {
    if (onSync) {
      await onSync();
    }
  };

  // Determine status color
  const getStatusColor = () => {
    if (!status.opfsSupported) return 'text-gray-400';
    if (!status.isOnline) return 'text-yellow-500';
    if (status.isSyncing) return 'text-blue-500';
    if (status.hasConflicts) return 'text-red-500';
    if (status.pendingChanges > 0) return 'text-orange-500';
    return 'text-green-500';
  };

  // Determine status icon
  const getStatusIcon = () => {
    if (!status.opfsSupported) return <CloudOff className="w-4 h-4" />;
    if (!status.isOnline) return <WifiOff className="w-4 h-4" />;
    if (status.isSyncing) return <RefreshCw className="w-4 h-4 animate-spin" />;
    if (status.hasConflicts) return <AlertCircle className="w-4 h-4" />;
    if (status.pendingChanges > 0) return <FileSync className="w-4 h-4" />;
    return <CheckCircle className="w-4 h-4" />;
  };

  // Determine status text
  const getStatusText = () => {
    if (!status.opfsSupported) return 'OPFS Not Supported';
    if (!status.isOnline) return 'Offline';
    if (status.isSyncing) return 'Syncing...';
    if (status.hasConflicts) return 'Conflicts Detected';
    if (status.pendingChanges > 0) return `${status.pendingChanges} Pending`;
    return 'Synced';
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Status indicator */}
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${getStatusColor()} bg-current/10`}
        title={status.supportDetails}
      >
        {getStatusIcon()}
        <span>{getStatusText()}</span>
      </div>

      {/* Online/Offline indicator */}
      <div
        className={`flex items-center gap-1 ${status.isOnline ? 'text-green-600' : 'text-yellow-600'}`}
        title={status.isOnline ? 'Online' : 'Offline'}
      >
        {status.isOnline ? (
          <Wifi className="w-3.5 h-3.5" />
        ) : (
          <WifiOff className="w-3.5 h-3.5" />
        )}
      </div>

      {/* Sync button */}
      {enableSync && status.opfsSupported && status.isOnline && (
        <button
          onClick={handleSync}
          disabled={status.isSyncing}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Sync with server"
        >
          <RefreshCw className={`w-4 h-4 ${status.isSyncing ? 'animate-spin' : ''}`} />
        </button>
      )}

      {/* Detailed info */}
      {showDetails && (
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {/* Last sync time */}
          <div className="flex items-center gap-1" title="Last sync">
            <Clock className="w-3.5 h-3.5" />
            <span>{status.lastSyncTimeFormatted}</span>
          </div>

          {/* Storage stats */}
          {status.stats && (
            <div className="flex items-center gap-1" title="Storage usage">
              <HardDrive className="w-3.5 h-3.5" />
              <span>{formatBytes(status.stats.totalSize)}</span>
            </div>
          )}

          {/* Pending changes */}
          {status.pendingChanges > 0 && (
            <div className="flex items-center gap-1" title="Pending changes">
              <FileSync className="w-3.5 h-3.5" />
              <span>{status.pendingChanges} files</span>
            </div>
          )}
        </div>
      )}

      {/* Browser support info */}
      {showSupportInfo && (
        <div
          className="text-xs text-gray-500"
          title={status.supportDetails}
        >
          {status.browser} {status.browserVersion}
        </div>
      )}
    </div>
  );
}

/**
 * OPFS Storage Stats Component
 * 
 * Displays detailed storage statistics
 */
export function OPFSStorageStats() {
  const status = useOPFSStatus();

  if (!status.stats || !status.opfsReady) {
    return (
      <div className="text-sm text-gray-500">
        Storage stats not available
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {/* Total files */}
      <div className="flex justify-between">
        <span className="text-gray-500">Files</span>
        <span className="font-medium">{status.stats.totalFiles}</span>
      </div>

      {/* Total directories */}
      <div className="flex justify-between">
        <span className="text-gray-500">Directories</span>
        <span className="font-medium">{status.stats.totalDirectories}</span>
      </div>

      {/* Total size */}
      <div className="flex justify-between">
        <span className="text-gray-500">Total Size</span>
        <span className="font-medium">{formatBytes(status.stats.totalSize)}</span>
      </div>

      {/* Available space */}
      <div className="flex justify-between">
        <span className="text-gray-500">Available</span>
        <span className="font-medium">{formatBytes(status.stats.availableSpace)}</span>
      </div>

      {/* Quota usage */}
      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-500">Quota Usage</span>
          <span className="font-medium">{status.stats.quotaUsage.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              status.stats.quotaUsage > 90
                ? 'bg-red-500'
                : status.stats.quotaUsage > 70
                ? 'bg-orange-500'
                : 'bg-green-500'
            }`}
            style={{ width: `${Math.min(status.stats.quotaUsage, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * OPFS Sync Progress Component
 * 
 * Shows sync progress bar during synchronization
 */
export function OPFSSyncProgress({ isSyncing, progress }: { isSyncing: boolean; progress: number }) {
  if (!isSyncing) {
    return null;
  }

  return (
    <div className="w-full space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">Syncing...</span>
        <span className="font-medium">{progress.toFixed(0)}%</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
        <div
          className="h-1.5 rounded-full bg-blue-500 transition-all"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * OPFS Not Supported Banner
 * 
 * Shows when OPFS is not available in the current browser
 */
export function OPFSNotSupportedBanner() {
  const status = useOPFSStatus();

  if (status.opfsSupported) {
    return null;
  }

  return (
    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-400">
            OPFS Not Available
          </h4>
          <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
            {status.supportDetails}
          </p>
          <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-2">
            For the best experience, use Chrome 119+ or Edge 119+.
          </p>
        </div>
      </div>
    </div>
  );
}

export default OPFSStatusIndicator;
