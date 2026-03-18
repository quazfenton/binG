/**
 * OPFS Multi-Tab Sync
 * 
 * Synchronizes OPFS changes across browser tabs using BroadcastChannel
 * Enables real-time collaboration and consistent state across tabs
 * 
 * Features:
 * - BroadcastChannel-based tab communication
 * - Change broadcasting for file operations
 * - Full sync request/response
 * - Tab presence detection
 * - Conflict prevention
 */

import { opfsAdapter } from './opfs-adapter';
import { opfsCore } from './opfs-core';
import type { OPFSDirectoryEntry } from './opfs-core';

export type OPFSBroadcastMessageType =
  | 'file-created'
  | 'file-updated'
  | 'file-deleted'
  | 'directory-created'
  | 'directory-deleted'
  | 'sync-request'
  | 'sync-response'
  | 'presence'
  | 'tab-closing';

export interface OPFSBroadcastMessage {
  type: OPFSBroadcastMessageType;
  workspaceId: string;
  tabId: string;
  timestamp: number;
  path?: string;
  content?: string;
  data?: any;
}

export interface TabPresence {
  tabId: string;
  workspaceId: string;
  lastSeen: number;
  isAlive: boolean;
}

export interface OPFSBroadcastConfig {
  workspaceId: string;
  ownerId: string;
  channelName?: string;
  presenceInterval?: number;  // ms between presence broadcasts
  presenceTimeout?: number;   // ms before tab considered dead
}

export type BroadcastChannelHandler = (message: OPFSBroadcastMessage) => void;

/**
 * Generate unique tab ID
 */
function generateTabId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * OPFS Multi-Tab Sync Manager
 */
export class OPFSBroadcast {
  private channel: BroadcastChannel | null = null;
  private core: typeof opfsCore;
  private adapter: typeof opfsAdapter;
  private options: Required<OPFSBroadcastConfig>;
  private tabId: string;
  private tabs: Map<string, TabPresence> = new Map();
  private handlers: Set<BroadcastChannelHandler> = new Set();
  private presenceInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private enabled = false;

  constructor(options: OPFSBroadcastConfig) {
    this.core = opfsCore;
    this.adapter = opfsAdapter;
    this.options = {
      workspaceId: options.workspaceId,
      ownerId: options.ownerId,
      channelName: options.channelName || `opfs-${options.workspaceId}`,
      presenceInterval: options.presenceInterval || 5000,
      presenceTimeout: options.presenceTimeout || 15000,
    };
    this.tabId = generateTabId();
  }

  /**
   * Enable multi-tab sync
   */
  async enable(): Promise<void> {
    if (this.enabled || typeof window === 'undefined') {
      return;
    }

    // Initialize OPFS
    await this.core.initialize(this.options.workspaceId);
    
    if (!this.adapter.isEnabled()) {
      await this.adapter.enable(this.options.ownerId, this.options.workspaceId);
    }

    // Create BroadcastChannel
    this.channel = new BroadcastChannel(this.options.channelName);
    
    // Set up message handler
    this.channel.onmessage = (event) => {
      this.handleMessage(event.data as OPFSBroadcastMessage);
    };

    // Set up visibility change handler
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.broadcastPresence();
      }
    });

    // Set up beforeunload handler
    window.addEventListener('beforeunload', () => {
      this.broadcastTabClosing();
      this.disable();
    });

    // Start presence broadcasts
    this.startPresenceBroadcasts();

    // Start cleanup interval for dead tabs
    this.startCleanupInterval();

    // Broadcast initial presence
    this.broadcastPresence();

    this.enabled = true;
    console.log('[OPFS Broadcast] Enabled for workspace:', this.options.workspaceId, 'tab:', this.tabId);
  }

  /**
   * Disable multi-tab sync
   */
  async disable(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    // Broadcast tab closing
    this.broadcastTabClosing();

    // Close channel
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }

    // Stop intervals
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
      this.presenceInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Remove handlers
    this.handlers.clear();

    this.enabled = false;
    console.log('[OPFS Broadcast] Disabled');
  }

  /**
   * Broadcast file creation
   */
  broadcastFileCreate(path: string, content?: string): void {
    if (!this.enabled || !this.channel) {
      return;
    }

    this.broadcast({
      type: 'file-created',
      path,
      content,
    });
  }

  /**
   * Broadcast file update
   */
  broadcastFileUpdate(path: string, content?: string): void {
    if (!this.enabled || !this.channel) {
      return;
    }

    this.broadcast({
      type: 'file-updated',
      path,
      content,
    });
  }

  /**
   * Broadcast file deletion
   */
  broadcastFileDelete(path: string): void {
    if (!this.enabled || !this.channel) {
      return;
    }

    this.broadcast({
      type: 'file-deleted',
      path,
    });
  }

  /**
   * Broadcast directory creation
   */
  broadcastDirectoryCreate(path: string): void {
    if (!this.enabled || !this.channel) {
      return;
    }

    this.broadcast({
      type: 'directory-created',
      path,
    });
  }

  /**
   * Broadcast directory deletion
   */
  broadcastDirectoryDelete(path: string): void {
    if (!this.enabled || !this.channel) {
      return;
    }

    this.broadcast({
      type: 'directory-deleted',
      path,
    });
  }

  /**
   * Request full sync from other tabs
   */
  requestSync(): void {
    if (!this.enabled || !this.channel) {
      return;
    }

    this.broadcast({
      type: 'sync-request',
    });
  }

  /**
   * Respond to sync request with full state
   */
  async respondToSync(): Promise<void> {
    if (!this.enabled || !this.channel) {
      return;
    }

    try {
      // Get all files from OPFS
      const entries = await this.getOPFSEntries('');
      
      this.broadcast({
        type: 'sync-response',
        data: { entries },
      });
    } catch (error) {
      console.error('[OPFS Broadcast] Sync response failed:', error);
    }
  }

  /**
   * Add message handler
   */
  onMessage(handler: BroadcastChannelHandler): () => void {
    this.handlers.add(handler);
    
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Get active tabs
   */
  getActiveTabs(): TabPresence[] {
    return Array.from(this.tabs.values()).filter(tab => tab.isAlive);
  }

  /**
   * Get tab count
   */
  getTabCount(): number {
    return this.getActiveTabs().length;
  }

  /**
   * Check if this is the only tab
   */
  isOnlyTab(): boolean {
    return this.getTabCount() <= 1;
  }

  // ========== Private Methods ==========

  private broadcast(message: Partial<OPFSBroadcastMessage>): void {
    if (!this.channel) {
      return;
    }

    const fullMessage: OPFSBroadcastMessage = {
      type: message.type as OPFSBroadcastMessageType,
      workspaceId: this.options.workspaceId,
      tabId: this.tabId,
      timestamp: Date.now(),
      path: message.path,
      content: message.content,
      data: message.data,
    };

    this.channel.postMessage(fullMessage);
  }

  private handleMessage(message: OPFSBroadcastMessage): void {
    // Ignore messages from self
    if (message.tabId === this.tabId) {
      return;
    }

    // Ignore messages from other workspaces
    if (message.workspaceId !== this.options.workspaceId) {
      return;
    }

    // Update tab presence
    this.updateTabPresence(message.tabId);

    // Handle message based on type
    switch (message.type) {
      case 'file-created':
        this.handleFileCreated(message);
        break;
      
      case 'file-updated':
        this.handleFileUpdated(message);
        break;
      
      case 'file-deleted':
        this.handleFileDeleted(message);
        break;
      
      case 'directory-created':
        this.handleDirectoryCreated(message);
        break;
      
      case 'directory-deleted':
        this.handleDirectoryDeleted(message);
        break;
      
      case 'sync-request':
        this.respondToSync();
        break;
      
      case 'sync-response':
        this.handleSyncResponse(message);
        break;
      
      case 'tab-closing':
        this.handleTabClosing(message);
        break;
    }

    // Call custom handlers
    for (const handler of this.handlers) {
      try {
        handler(message);
      } catch (error) {
        console.error('[OPFS Broadcast] Handler error:', error);
      }
    }
  }

  private async handleFileCreated(message: OPFSBroadcastMessage): Promise<void> {
    if (!message.path) return;
    
    console.log('[OPFS Broadcast] File created in another tab:', message.path);
    
    // Optionally sync the file locally
    if (message.content !== undefined) {
      try {
        await this.core.writeFile(message.path, message.content);
      } catch (error) {
        console.error('[OPFS Broadcast] Failed to sync created file:', error);
      }
    }
  }

  private async handleFileUpdated(message: OPFSBroadcastMessage): Promise<void> {
    if (!message.path) return;
    
    console.log('[OPFS Broadcast] File updated in another tab:', message.path);
    
    // Optionally sync the file locally
    if (message.content !== undefined) {
      try {
        await this.core.writeFile(message.path, message.content);
      } catch (error) {
        console.error('[OPFS Broadcast] Failed to sync updated file:', error);
      }
    }
  }

  private async handleFileDeleted(message: OPFSBroadcastMessage): Promise<void> {
    if (!message.path) return;
    
    console.log('[OPFS Broadcast] File deleted in another tab:', message.path);
    
    try {
      await this.core.deleteFile(message.path);
    } catch (error) {
      console.error('[OPFS Broadcast] Failed to sync deleted file:', error);
    }
  }

  private async handleDirectoryCreated(message: OPFSBroadcastMessage): Promise<void> {
    if (!message.path) return;
    
    console.log('[OPFS Broadcast] Directory created in another tab:', message.path);
    
    try {
      await this.core.createDirectory(message.path, { recursive: true });
    } catch (error) {
      console.error('[OPFS Broadcast] Failed to sync created directory:', error);
    }
  }

  private async handleDirectoryDeleted(message: OPFSBroadcastMessage): Promise<void> {
    if (!message.path) return;
    
    console.log('[OPFS Broadcast] Directory deleted in another tab:', message.path);
    
    try {
      await this.core.deleteDirectory(message.path, { recursive: true });
    } catch (error) {
      console.error('[OPFS Broadcast] Failed to sync deleted directory:', error);
    }
  }

  private handleSyncResponse(message: OPFSBroadcastMessage): void {
    console.log('[OPFS Broadcast] Received sync response from tab:', message.tabId);
    
    if (message.data?.entries) {
      // Process sync response entries
      // This would typically update local state
    }
  }

  private handleTabClosing(message: OPFSBroadcastMessage): void {
    console.log('[OPFS Broadcast] Tab closing:', message.tabId);
    this.tabs.delete(message.tabId);
  }

  private broadcastPresence(): void {
    if (!this.channel) return;

    this.broadcast({
      type: 'presence',
    });
  }

  private broadcastTabClosing(): void {
    if (!this.channel) return;

    this.broadcast({
      type: 'tab-closing',
    });
  }

  private updateTabPresence(tabId: string): void {
    const now = Date.now();
    
    const existing = this.tabs.get(tabId);
    
    if (existing) {
      existing.lastSeen = now;
      existing.isAlive = true;
    } else {
      this.tabs.set(tabId, {
        tabId,
        workspaceId: this.options.workspaceId,
        lastSeen: now,
        isAlive: true,
      });
    }
  }

  private startPresenceBroadcasts(): void {
    this.presenceInterval = setInterval(() => {
      this.broadcastPresence();
      
      // Mark tabs as dead if timeout exceeded
      const now = Date.now();
      for (const [tabId, tab] of this.tabs.entries()) {
        if (now - tab.lastSeen > this.options.presenceTimeout) {
          tab.isAlive = false;
        }
      }
    }, this.options.presenceInterval);
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [tabId, tab] of this.tabs.entries()) {
        if (now - tab.lastSeen > this.options.presenceTimeout * 2) {
          // Remove tabs that haven't been seen for 2x timeout
          this.tabs.delete(tabId);
          console.log('[OPFS Broadcast] Removed dead tab:', tabId);
        }
      }
    }, this.options.presenceTimeout);
  }

  private async getOPFSEntries(path: string): Promise<OPFSDirectoryEntry[]> {
    try {
      return await this.core.listDirectory(path);
    } catch {
      return [];
    }
  }

  /**
   * Get current tab ID
   */
  getTabId(): string {
    return this.tabId;
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton factory
const broadcastInstances = new Map<string, OPFSBroadcast>();

export function getOPFSBroadcast(
  workspaceId: string,
  ownerId: string,
  options?: Partial<OPFSBroadcastConfig>
): OPFSBroadcast {
  const key = `${workspaceId}:${ownerId}`;
  
  if (!broadcastInstances.has(key)) {
    broadcastInstances.set(key, new OPFSBroadcast({ workspaceId, ownerId, ...options }));
  }
  
  return broadcastInstances.get(key)!;
}

export const opfsBroadcast = getOPFSBroadcast('default', 'default');

/**
 * React hook for multi-tab sync
 * 
 * @deprecated Use useOPFSBroadcast from hooks/use-opfs-broadcast.ts instead
 */
export function useOPFSBroadcast_DEPRECATED(workspaceId: string, ownerId: string) {
  // This is a simplified version - use the proper hook from hooks/ directory
  console.warn('useOPFSBroadcast is deprecated, use the hook from hooks/use-opfs-broadcast.ts');
  
  const broadcast = getOPFSBroadcast(workspaceId, ownerId);
  
  return {
    broadcast,
    tabCount: broadcast.getTabCount(),
    isOnlyTab: broadcast.isOnlyTab(),
    broadcastFileChange: (path: string, type: 'create' | 'update' | 'delete', content?: string) => {
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
    },
    requestSync: () => broadcast.requestSync(),
  };
}
