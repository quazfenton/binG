'use client';

/**
 * Sync Status Bar Component
 *
 * Displays the status of synced folders with controls for:
 * - Auto-save toggle
 * - Manual sync trigger
 * - Folder disconnect
 * - Settings access
 *
 * Visual States:
 * - ✅ Connected & synced
 * - 🔄 Syncing
 * - ⏸️ Auto-save paused
 * - ⚠️ Error/Conflict
 * - ❌ Disconnected
 */

import { useState, useCallback } from 'react';
import { useFolderSync } from '@/hooks/use-folder-sync';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  CheckCircle,
  RefreshCw,
  Pause,
  Play,
  Settings,
  FolderSync,
  AlertCircle,
  X,
  Clock,
  Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SyncStatusBarProps {
  sessionId?: string;
  ownerId?: string;
  className?: string;
}

interface SyncedFolderItem {
  id: string;
  name: string;
  status: 'connected' | 'syncing' | 'disconnected' | 'error' | 'conflict';
  lastSyncTime: number;
  autoSave: boolean;
  fileCount: number;
}

export function SyncStatusBar({
  sessionId,
  ownerId,
  className,
}: SyncStatusBarProps) {
  const {
    syncStatus,
    toggleAutoSave,
    syncNow,
    disconnectFolder,
    isSyncing,
    refreshStatus,
  } = useFolderSync({ sessionId, ownerId });

  const [openFolderId, setOpenFolderId] = useState<string | null>(null);

  const formatLastSync = useCallback((timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 5000) return 'Just now';
    if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    return `${Math.round(diff / 3600000)}h ago`;
  }, []);

  const getStatusIcon = useCallback((status: SyncedFolderItem['status']) => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'syncing':
        return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'conflict':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      default:
        return <FolderSync className="w-4 h-4 text-muted-foreground" />;
    }
  }, []);

  const getStatusText = useCallback((status: SyncedFolderItem['status']) => {
    switch (status) {
      case 'connected':
        return 'Synced';
      case 'syncing':
        return 'Syncing...';
      case 'error':
        return 'Error';
      case 'conflict':
        return 'Conflict';
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  }, []);

  if (syncStatus.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex flex-wrap gap-2 p-2 bg-muted/50 rounded-md', className)}>
      {syncStatus.map((folder) => (
        <div
          key={folder.id}
          className="flex items-center gap-2 px-3 py-1.5 bg-background border rounded-md shadow-sm"
        >
          {/* Status Icon */}
          <div className="flex items-center gap-2">
            {getStatusIcon(folder.status)}
            
            {/* Folder Name */}
            <span className="text-sm font-medium max-w-[150px] truncate">
              {folder.name}
            </span>
          </div>

          {/* File Count */}
          <span className="text-xs text-muted-foreground">
            {folder.fileCount} files
          </span>

          {/* Last Sync */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {formatLastSync(folder.lastSyncTime)}
          </div>

          {/* Auto-save Indicator */}
          {folder.autoSave && (
            <div className="flex items-center gap-1 text-xs text-green-600">
              <Save className="w-3 h-3" />
              Auto-save
            </div>
          )}

          {/* Status Text */}
          <span className={cn(
            'text-xs font-medium',
            folder.status === 'error' && 'text-red-600',
            folder.status === 'conflict' && 'text-yellow-600',
            folder.status === 'connected' && 'text-green-600',
            folder.status === 'syncing' && 'text-blue-600',
          )}>
            {getStatusText(folder.status)}
          </span>

          {/* Actions */}
          <div className="flex items-center gap-1 ml-2">
            {/* Toggle Auto-save */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => toggleAutoSave(folder.id)}
              title={folder.autoSave ? 'Disable auto-save' : 'Enable auto-save'}
            >
              {folder.autoSave ? (
                <Pause className="w-3 h-3" />
              ) : (
                <Play className="w-3 h-3" />
              )}
            </Button>

            {/* Manual Sync */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => syncNow(folder.id)}
              disabled={isSyncing}
              title="Sync now"
            >
              <RefreshCw className={cn('w-3 h-3', isSyncing && 'animate-spin')} />
            </Button>

            {/* Settings */}
            <Popover open={openFolderId === folder.id} onOpenChange={(open) => setOpenFolderId(open ? folder.id : null)}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Settings"
                >
                  <Settings className="w-3 h-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64" align="end">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <h4 className="font-medium text-sm">{folder.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      {folder.fileCount} files • Last synced {formatLastSync(folder.lastSyncTime)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm">Auto-save</span>
                    <Button
                      variant={folder.autoSave ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => toggleAutoSave(folder.id)}
                    >
                      {folder.autoSave ? 'On' : 'Off'}
                    </Button>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      syncNow(folder.id);
                      setOpenFolderId(null);
                    }}
                  >
                    <RefreshCw className="w-3 h-3 mr-2" />
                    Sync Now
                  </Button>

                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      disconnectFolder(folder.id);
                      setOpenFolderId(null);
                    }}
                  >
                    <X className="w-3 h-3 mr-2" />
                    Disconnect
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      ))}
    </div>
  );
}
