/**
 * useOPFSBroadcast Hook
 * 
 * React hook for OPFS multi-tab synchronization using BroadcastChannel
 * Enables real-time collaboration and consistent state across browser tabs
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getOPFSBroadcast, type OPFSBroadcast } from '@/lib/virtual-filesystem/opfs/opfs-broadcast';
import type { OPFSBroadcastMessage } from '@/lib/virtual-filesystem/opfs/opfs-broadcast';

export interface UseOPFSBroadcastReturn {
  /** BroadcastChannel instance */
  broadcast: OPFSBroadcast | null;
  /** Number of active tabs */
  tabCount: number;
  /** Whether this is the only tab */
  isOnlyTab: boolean;
  /** Whether broadcast is enabled */
  isEnabled: boolean;
  /** Current tab ID */
  tabId: string;
  /** Broadcast file change to other tabs */
  broadcastFileChange: (path: string, type: 'create' | 'update' | 'delete', content?: string) => void;
  /** Request full sync from other tabs */
  requestSync: () => void;
  /** Active tabs list */
  activeTabs: Array<{ tabId: string; lastSeen: number }>;
}

export interface UseOPFSBroadcastOptions {
  /** Auto-enable on mount (default: true) */
  autoEnable?: boolean;
  /** Channel name (default: opfs-{workspaceId}) */
  channelName?: string;
}

/**
 * React hook for OPFS multi-tab sync
 * 
 * @param workspaceId - Workspace identifier
 * @param ownerId - Owner identifier
 * @param options - Hook options
 * @returns Broadcast state and operations
 */
export function useOPFSBroadcast(
  workspaceId: string,
  ownerId: string,
  options: UseOPFSBroadcastOptions = {}
): UseOPFSBroadcastReturn {
  const { autoEnable = true, channelName } = options;
  
  const [broadcast, setBroadcast] = useState<OPFSBroadcast | null>(null);
  const [tabCount, setTabCount] = useState(1);
  const [isOnlyTab, setIsOnlyTab] = useState(true);
  const [isEnabled, setIsEnabled] = useState(false);
  const [tabId, setTabId] = useState('');
  const [activeTabs, setActiveTabs] = useState<Array<{ tabId: string; lastSeen: number }>>([]);
  
  const messageHandlerRef = useRef<(() => void) | null>(null);

  // Initialize broadcast on mount
  useEffect(() => {
    if (!autoEnable || typeof window === 'undefined') {
      return;
    }

    const bc = getOPFSBroadcast(workspaceId, ownerId, { channelName });
    setBroadcast(bc);
    setTabId(bc.getTabId());

    // Enable broadcast
    bc.enable().catch((err) => {
      console.error('[useOPFSBroadcast] Failed to enable:', err);
    });

    // Update tab info
    const updateTabInfo = () => {
      setTabCount(bc.getTabCount());
      setIsOnlyTab(bc.isOnlyTab());
      setActiveTabs(bc.getActiveTabs().map(tab => ({
        tabId: tab.tabId,
        lastSeen: tab.lastSeen,
      })));
    };

    // Initial update
    updateTabInfo();

    // Listen for presence messages to update tab count
    messageHandlerRef.current = bc.onMessage((message: OPFSBroadcastMessage) => {
      if (message.type === 'presence') {
        updateTabInfo();
      }
    });

    setIsEnabled(bc.isEnabled());

    // Cleanup on unmount
    return () => {
      if (messageHandlerRef.current) {
        messageHandlerRef.current();
      }
      // Don't disable on unmount - let other tabs continue
    };
  }, [workspaceId, ownerId, channelName, autoEnable]);

  // Broadcast file change
  const broadcastFileChange = useCallback((
    path: string,
    type: 'create' | 'update' | 'delete',
    content?: string
  ) => {
    if (!broadcast || !isEnabled) return;
    
    switch (type) {
      case 'create':
        broadcast.broadcastFileCreate(path, content);
        break;
      case 'update':
        broadcast.broadcastFileUpdate(path, content);
        break;
      case 'delete':
        broadcast.broadcastFileDelete(path);
        break;
    }
  }, [broadcast, isEnabled]);

  // Request sync
  const requestSync = useCallback(() => {
    if (!broadcast || !isEnabled) return;
    broadcast.requestSync();
  }, [broadcast, isEnabled]);

  return {
    broadcast,
    tabCount,
    isOnlyTab,
    isEnabled,
    tabId,
    broadcastFileChange,
    requestSync,
    activeTabs,
  };
}
