'use client';

/**
 * useFolderSync Hook
 *
 * React hook for managing local folder sync state and operations.
 * Provides easy integration of folder sync functionality into components.
 *
 * Features:
 * - Connect/disconnect folders
 * - Toggle auto-save
 * - Manual sync trigger
 * - Real-time status updates
 * - Error handling
 *
 * @example
 * ```tsx
 * const {
 *   syncedFolders,
 *   connectFolder,
 *   disconnectFolder,
 *   toggleAutoSave,
 *   syncNow,
 *   isSyncing,
 * } = useFolderSync({ sessionId, ownerId });
 * ```
 */

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';

// Lazy load the sync service to avoid bundling server-only modules in client
let localFolderSyncService: any;

async function loadFolderSyncService() {
  if (!localFolderSyncService) {
    const module = await import('@/lib/virtual-filesystem/sync/local-folder-sync');
    localFolderSyncService = module.localFolderSyncService;
  }
  return { localFolderSyncService };
}

export interface UseFolderSyncOptions {
  sessionId?: string;
  ownerId?: string;
  autoConnect?: boolean;
}

// Use inline type definition for client-side - matches server SyncedFolder interface
interface SyncedFolderStatus {
  id: string;
  name: string;
  status: 'connected' | 'syncing' | 'disconnected' | 'error' | 'conflict';
  lastSyncTime: number;
  autoSave: boolean;
  fileCount: number;
}

export interface UseFolderSyncReturn {
  /** All synced folders for current session */
  syncedFolders: any[];
  /** Sync status summary */
  syncStatus: SyncedFolderStatus[];
  /** Connect a new folder */
  connectFolder: (options: { folderName: string; vfsPath: string }) => Promise<any>;
  /** Disconnect a folder */
  disconnectFolder: (folderId: string) => Promise<void>;
  /** Toggle auto-save for a folder */
  toggleAutoSave: (folderId: string) => Promise<void>;
  /** Trigger manual sync */
  syncNow: (folderId: string) => Promise<any>;
  /** Get folder by ID */
  getFolder: (folderId: string) => Promise<any>;
  /** Whether any sync operation is in progress */
  isSyncing: boolean;
  /** Refresh sync status */
  refreshStatus: () => void;
}

export function useFolderSync(options: UseFolderSyncOptions = {}): UseFolderSyncReturn {
  const { sessionId, ownerId } = options;
  const [syncStatus, setSyncStatus] = useState<UseFolderSyncReturn['syncStatus']>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Load the service and refresh status when session changes or on mount
  useEffect(() => {
    async function loadAndUpdateStatus() {
      if (sessionId) {
        const { localFolderSyncService: service } = await loadFolderSyncService();
        const status = service.getSyncStatus(sessionId);
        setSyncStatus(status);
      } else {
        // Clear status when sessionId is undefined to prevent stale data
        setSyncStatus([]);
      }
    }
    loadAndUpdateStatus();
  }, [sessionId, refreshTrigger]);

  const connectFolder = useCallback(async (
    connectOptions: { folderName: string; vfsPath: string }
  ) => {
    if (!sessionId || !ownerId) {
      throw new Error('Session ID and Owner ID are required');
    }

    setIsSyncing(true);
    try {
      const { localFolderSyncService: service } = await loadFolderSyncService();
      const folder = await service.connectFolder({
        ownerId,
        sessionId,
        folderName: connectOptions.folderName,
        vfsDestinationPath: connectOptions.vfsPath,
      });

      toast.success('Folder connected', {
        description: `${folder.name} is now synced with ${folder.vfsPath}`,
      });

      setRefreshTrigger(prev => prev + 1);
      return folder;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect folder';
      toast.error('Failed to connect folder', { description: message });
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [sessionId, ownerId]);

  const disconnectFolder = useCallback(async (folderId: string): Promise<void> => {
    setIsSyncing(true);
    try {
      const { localFolderSyncService: service } = await loadFolderSyncService();
      await service.disconnectFolder(folderId);
      
      toast.success('Folder disconnected', {
        description: 'Sync has been stopped for this folder',
      });

      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disconnect folder';
      toast.error('Failed to disconnect folder', { description: message });
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const toggleAutoSave = useCallback(async (folderId: string): Promise<void> => {
    const { localFolderSyncService: service } = await loadFolderSyncService();
    const folder = service.getFolder(folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    try {
      if (folder.autoSave) {
        service.stopAutoSave(folderId);
        toast.success('Auto-save disabled', {
          description: `${folder.name} will no longer auto-sync`,
        });
      } else {
        service.startAutoSave(folderId);
        toast.success('Auto-save enabled', {
          description: `${folder.name} will sync every 2 seconds`,
        });
      }

      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle auto-save';
      toast.error('Failed to toggle auto-save', { description: message });
      throw error;
    }
  }, []);

  const syncNow = useCallback(async (folderId: string) => {
    setIsSyncing(true);
    try {
      const { localFolderSyncService: service } = await loadFolderSyncService();
      const result = await service.syncNow(folderId);
      
      const totalSynced = result.toVFS.synced + result.fromVFS.synced;
      const totalErrors = result.toVFS.errors.length + result.fromVFS.errors.length;

      if (totalErrors > 0) {
        toast.warning('Sync completed with errors', {
          description: `${totalSynced} files synced, ${totalErrors} errors`,
        });
      } else if (totalSynced > 0) {
        toast.success('Sync completed', {
          description: `${totalSynced} files synchronized`,
        });
      } else {
        toast.info('Sync completed', {
          description: 'No changes detected',
        });
      }

      setRefreshTrigger(prev => prev + 1);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      toast.error('Sync failed', { description: message });
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const getFolder = useCallback(async (folderId: string) => {
    const { localFolderSyncService: service } = await loadFolderSyncService();
    return service.getFolder(folderId);
  }, []);

  const refreshStatus = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  return {
    syncedFolders: [],
    syncStatus,
    connectFolder,
    disconnectFolder,
    toggleAutoSave,
    syncNow,
    getFolder,
    isSyncing,
    refreshStatus,
  };
}
