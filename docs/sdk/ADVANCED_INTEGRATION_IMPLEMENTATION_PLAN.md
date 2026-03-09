# Advanced Integration Implementation Plan

**Date:** February 27, 2026  
**Priority:** CRITICAL → HIGH → MEDIUM  
**Status:** Ready for Implementation  

---

## Phase 1: Critical Security & Core Features (Week 1)

### 1.1 Fix Composio Session Isolation

**File:** `lib/composio-client.ts`

```typescript
/**
 * Composio Client - Session-Based Architecture
 * 
 * CRITICAL: Each user gets isolated session for security
 * No global state sharing between users
 */

import { Composio } from '@composio/core';

// User session storage - NEVER share between users
const userSessions = new Map<string, any>();

export interface ComposioSession {
  userId: string;
  composio: any;
  tools?: any[];
  createdAt: Date;
  lastActive: Date;
}

/**
 * Get or create Composio session for specific user
 * 
 * @param userId - Unique user identifier (REQUIRED for isolation)
 * @param opts - Optional configuration
 */
export async function getComposioSession(
  userId: string,
  opts: { apiKey?: string; host?: string } = {}
): Promise<ComposioSession> {
  if (!userId) {
    throw new Error('userId is REQUIRED for session isolation');
  }

  // Return existing session if available
  if (userSessions.has(userId)) {
    const session = userSessions.get(userId);
    session.lastActive = new Date();
    return session;
  }

  // Create new session for user
  const composio = new Composio({
    apiKey: opts.apiKey || process.env.COMPOSIO_API_KEY,
    host: opts.host || process.env.COMPOSIO_HOST,
  });

  const session = await composio.create(userId);
  
  const sessionData: ComposioSession = {
    userId,
    composio: session,
    createdAt: new Date(),
    lastActive: new Date(),
  };

  userSessions.set(userId, sessionData);

  // Auto-cleanup old sessions (24 hours)
  setTimeout(() => {
    if (userSessions.has(userId)) {
      userSessions.delete(userId);
    }
  }, 24 * 60 * 60 * 1000);

  return sessionData;
}

/**
 * Get tools for specific user
 */
export async function getUserComposioTools(
  userId: string,
  options?: { toolkits?: string[]; limit?: number }
) {
  const session = await getComposioSession(userId);
  
  return session.composio.tools.get(userId, {
    toolkits: options?.toolkits,
    limit: options?.limit || 300,
  });
}

/**
 * Search tools for user
 */
export async function searchComposioTools(
  userId: string,
  query: string,
  options?: { toolkit?: string; limit?: number }
) {
  const session = await getComposioSession(userId);
  
  return session.composio.tools.search({
    query,
    toolkit: options?.toolkit,
    limit: options?.limit || 10,
  });
}

/**
 * Cleanup - remove user session
 */
export function cleanupComposioSession(userId: string) {
  userSessions.delete(userId);
}
```

---

### 1.2 Add Composio MCP Integration

**File:** `lib/composio/mcp-integration.ts` (NEW)

```typescript
/**
 * Composio MCP Integration
 * 
 * MCP (Model Context Protocol) is the RECOMMENDED way to integrate Composio
 * - Works with ANY LLM provider (Claude, GPT, Gemini, etc.)
 * - No provider-specific SDK dependencies
 * - Standardized protocol
 * - Better for multi-tenant deployments
 */

import { Composio } from '@composio/core';
import { hostedMcpTool } from '@mastra/core';

export interface ComposioMCPIntegration {
  mcpTool: any;
  session: any;
  userId: string;
}

/**
 * Create Composio MCP integration for user
 */
export async function createComposioMCPIntegration(
  userId: string,
  opts: {
    apiKey?: string;
    requireApproval?: 'always' | 'never' | 'selective';
  } = {}
): Promise<ComposioMCPIntegration> {
  const composio = new Composio({
    apiKey: opts.apiKey || process.env.COMPOSIO_API_KEY,
  });

  const session = await composio.create(userId);

  // Create MCP tool with session credentials
  const mcpTool = hostedMcpTool({
    serverLabel: 'composio',
    serverUrl: session.mcp.url,
    serverDescription: 'Composio Tools - 1000+ integrations (GitHub, Slack, Notion, etc.)',
    headers: session.mcp.headers,
    requireApproval: opts.requireApproval || 'never',
  });

  return {
    mcpTool,
    session,
    userId,
  };
}

/**
 * Get MCP server info
 */
export async function getComposioMCPServerInfo(userId: string) {
  const composio = new Composio();
  const session = await composio.create(userId);

  return {
    url: session.mcp.url,
    headers: session.mcp.headers,
    toolsCount: session.mcp.tools?.length || 0,
  };
}
```

---

### 1.3 Add E2B Desktop Support

**File:** `lib/sandbox/providers/e2b-desktop-provider.ts` (EXPAND)

```typescript
/**
 * E2B Desktop Provider
 * 
 * Enables AI agents to interact with graphical desktop environments
 * Use cases:
 * - Claude Computer Use
 * - GUI automation
 * - Visual testing
 * - Browser automation
 */

import type { SandboxHandle } from './sandbox-provider';
import type { ToolResult } from '../types';

// Import E2B Desktop SDK
// @ts-ignore - Optional package, may not be installed
import { Desktop } from '@e2b/desktop';

export interface DesktopHandle {
  screen: {
    capture: () => Promise<Buffer>;
    resolution: () => Promise<{ width: number; height: number }>;
  };
  mouse: {
    click: (opts: { x: number; y: number; button?: 'left' | 'right' | 'middle' }) => Promise<void>;
    move: (opts: { x: number; y: number }) => Promise<void>;
    drag: (opts: { from: { x: number; y: number }; to: { x: number; y: number } }) => Promise<void>;
  };
  keyboard: {
    type: (text: string) => Promise<void>;
    press: (key: string) => Promise<void>;
    hotkey: (keys: string[]) => Promise<void>;
  };
  clipboard: {
    read: () => Promise<string>;
    write: (text: string) => Promise<void>;
  };
}

export interface E2BDesktopConfig {
  template?: string;
  screenResolution?: { width: number; height: number };
  timeout?: number;
}

export class E2BDesktopProvider {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.E2B_API_KEY;
  }

  async createDesktop(config: E2BDesktopConfig = {}): Promise<DesktopHandle> {
    if (!this.apiKey) {
      throw new Error('E2B_API_KEY not configured');
    }

    try {
      const desktop = await Desktop.create({
        template: config.template || 'desktop',
        screenResolution: config.screenResolution || { width: 1920, height: 1080 },
      });

      return {
        screen: {
          capture: async () => {
            const img = await desktop.screen.capture();
            return img.toBuffer();
          },
          resolution: async () => {
            return { width: 1920, height: 1080 };
          },
        },
        mouse: {
          click: async ({ x, y, button = 'left' }) => desktop.mouse.click({ x, y, button }),
          move: async ({ x, y }) => desktop.mouse.move({ x, y }),
          drag: async ({ from, to }) => desktop.mouse.drag({ from, to }),
        },
        keyboard: {
          type: async (text) => desktop.keyboard.type(text),
          press: async (key) => desktop.keyboard.press(key),
          hotkey: async (keys) => desktop.keyboard.hotkey(keys),
        },
        clipboard: {
          read: async () => desktop.clipboard.read(),
          write: async (text) => desktop.clipboard.write(text),
        },
      };
    } catch (error: any) {
      throw new Error(`Failed to create E2B Desktop: ${error.message}`);
    }
  }
}

/**
 * Desktop session manager for tracking active desktops
 */
export const desktopSessionManager = {
  sessions: new Map<string, DesktopHandle>(),

  async createSession(sessionId: string, config?: E2BDesktopConfig): Promise<DesktopHandle> {
    const provider = new E2BDesktopProvider();
    const desktop = await provider.createDesktop(config);
    this.sessions.set(sessionId, desktop);
    return desktop;
  },

  getSession(sessionId: string): DesktopHandle | undefined {
    return this.sessions.get(sessionId);
  },

  async destroySession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  },

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  },
};

/**
 * Execute desktop command via API route helper
 */
export async function executeDesktopCommand(
  sessionId: string,
  action: 'screenshot' | 'click' | 'type' | 'keypress',
  params: Record<string, any>
): Promise<ToolResult> {
  const desktop = desktopSessionManager.getSession(sessionId);

  if (!desktop) {
    return {
      success: false,
      output: `Desktop session not found: ${sessionId}`,
    };
  }

  try {
    let result: any;

    switch (action) {
      case 'screenshot':
        const screenshot = await desktop.screen.capture();
        return {
          success: true,
          output: `Screenshot captured (${screenshot.length} bytes)`,
          binary: screenshot,
        };

      case 'click':
        await desktop.mouse.click(params);
        return { success: true, output: `Clicked at (${params.x}, ${params.y})` };

      case 'type':
        await desktop.keyboard.type(params.text);
        return { success: true, output: `Typed: ${params.text}` };

      case 'keypress':
        await desktop.keyboard.press(params.key);
        return { success: true, output: `Pressed: ${params.key}` };

      default:
        return { success: false, output: `Unknown action: ${action}` };
    }
  } catch (error: any) {
    return {
      success: false,
      output: `Desktop command failed: ${error.message}`,
    };
  }
}
```

---

## Phase 2: High Priority Features (Week 2-3)

### 2.1 Add Nango Syncs

**File:** `lib/nango/sync-manager.ts` (NEW)

```typescript
/**
 * Nango Sync Manager
 * 
 * Continuous data synchronization with external APIs
 * Use cases:
 * - CRM sync (HubSpot, Salesforce)
 * - File sync (Google Drive, Dropbox)
 * - Code sync (GitHub, GitLab)
 */

import { Nango } from '@nangohq/node';

const nango = new Nango({
  secretKey: process.env.NANGO_SECRET_KEY || '',
});

export interface SyncConfig {
  providerConfigKey: string;
  connectionId: string;
  syncName: string;
  fullResync?: boolean;
}

export interface SyncStatus {
  status: 'RUNNING' | 'SUCCESS' | 'ERROR' | 'PAUSED';
  recordsCount?: number;
  lastSyncDate?: Date;
  nextSyncDate?: Date;
  error?: string;
}

/**
 * Trigger sync for specific connection
 */
export async function triggerSync(config: SyncConfig): Promise<{
  success: boolean;
  syncId?: string;
  error?: string;
}> {
  try {
    const result = await nango.triggerSync({
      providerConfigKey: config.providerConfigKey,
      connectionId: config.connectionId,
      syncName: config.syncName,
      fullResync: config.fullResync || false,
    });

    return {
      success: true,
      syncId: result.sync_id,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get sync status
 */
export async function getSyncStatus(config: SyncConfig): Promise<SyncStatus> {
  try {
    const status = await nango.getSyncStatus({
      providerConfigKey: config.providerConfigKey,
      connectionId: config.connectionId,
      syncName: config.syncName,
    });

    return {
      status: status.status,
      recordsCount: status.records_count,
      lastSyncDate: status.last_sync_date ? new Date(status.last_sync_date) : undefined,
      nextSyncDate: status.next_sync_date ? new Date(status.next_sync_date) : undefined,
      error: status.error,
    };
  } catch (error: any) {
    return {
      status: 'ERROR',
      error: error.message,
    };
  }
}

/**
 * Get synced records
 */
export async function getSyncRecords(
  config: SyncConfig & { model: string; limit?: number }
): Promise<{
  success: boolean;
  records?: any[];
  error?: string;
}> {
  try {
    const records = await nango.getRecords({
      providerConfigKey: config.providerConfigKey,
      connectionId: config.connectionId,
      model: config.model,
      limit: config.limit || 100,
    });

    return {
      success: true,
      records: records,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * List all syncs for connection
 */
export async function listSyncs(connectionId: string): Promise<{
  success: boolean;
  syncs?: Array<{
    name: string;
    status: string;
    lastSyncDate?: Date;
  }>;
  error?: string;
}> {
  try {
    const syncs = await nango.listSyncs({ connectionId });
    
    return {
      success: true,
      syncs: syncs.map(s => ({
        name: s.name,
        status: s.status,
        lastSyncDate: s.last_sync_date ? new Date(s.last_sync_date) : undefined,
      })),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}
```

---

### 2.2 Add Nango Webhooks

**File:** `lib/nango/webhook-manager.ts` (NEW)

```typescript
/**
 * Nango Webhook Manager
 * 
 * Real-time event subscriptions from external APIs
 * Use cases:
 * - GitHub issue notifications
 * - Slack message alerts
 * - Salesforce lead updates
 */

import { Nango } from '@nangohq/node';
import { createHmac } from 'crypto';

const nango = new Nango({
  secretKey: process.env.NANGO_SECRET_KEY || '',
});

export interface WebhookSubscription {
  providerConfigKey: string;
  connectionId: string;
  types: string[];
  webhookUrl?: string;
}

/**
 * Subscribe to webhook events
 */
export async function subscribeToWebhooks(
  config: WebhookSubscription
): Promise<{
  success: boolean;
  subscriptionId?: string;
  error?: string;
}> {
  try {
    const result = await nango.webhooks.subscribe({
      providerConfigKey: config.providerConfigKey,
      connectionId: config.connectionId,
      types: config.types,
      webhookUrl: config.webhookUrl,
    });

    return {
      success: true,
      subscriptionId: result.subscription_id,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return signature === expectedSignature;
  } catch {
    return false;
  }
}

/**
 * Process incoming webhook
 */
export async function processWebhook(
  payload: any,
  signature: string
): Promise<{
  success: boolean;
  event?: {
    type: string;
    provider: string;
    connectionId: string;
    data: any;
  };
  error?: string;
}> {
  try {
    // Verify signature
    const isValid = verifyWebhookSignature(
      JSON.stringify(payload),
      signature,
      process.env.NANGO_WEBHOOK_SECRET || ''
    );

    if (!isValid) {
      return {
        success: false,
        error: 'Invalid webhook signature',
      };
    }

    // Parse webhook event
    const event = {
      type: payload.type,
      provider: payload.provider_config_key,
      connectionId: payload.connection_id,
      data: payload.data,
    };

    return {
      success: true,
      event,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}
```

---

## Phase 3: Medium Priority (Week 4)

### 3.1 Add Sprites Checkpoint Manager

**File:** `lib/sandbox/providers/sprites-checkpoint-manager.ts` (EXPAND)

```typescript
/**
 * Sprites Checkpoint Manager with Retention Policies
 */

import { SpritesClient } from '@flyio/sprites';

export interface CheckpointRetention {
  maxCount?: number;      // Keep last N checkpoints
  maxAgeDays?: number;    // Delete checkpoints older than N days
  minKeep?: number;       // Always keep at least N checkpoints
}

export class SpritesCheckpointManager {
  private client: SpritesClient;
  private spriteName: string;

  constructor(token: string, spriteName: string) {
    this.client = new SpritesClient(token);
    this.spriteName = spriteName;
  }

  async createCheckpoint(
    name: string,
    options: {
      comment?: string;
      retention?: CheckpointRetention;
    } = {}
  ): Promise<{
    success: boolean;
    checkpointId?: string;
    error?: string;
  }> {
    try {
      const sprite = this.client.getSprite(this.spriteName);
      const checkpoint = await sprite.checkpoints.create({
        name,
        comment: options.comment,
      });

      // Apply retention policy
      if (options.retention) {
        await this.enforceRetentionPolicy(options.retention);
      }

      return {
        success: true,
        checkpointId: checkpoint.id,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async listCheckpoints(): Promise<{
    success: boolean;
    checkpoints?: Array<{
      id: string;
      name: string;
      createdAt: Date;
      comment?: string;
    }>;
    error?: string;
  }> {
    try {
      const sprite = this.client.getSprite(this.spriteName);
      const checkpoints = await sprite.checkpoints.list();

      return {
        success: true,
        checkpoints: checkpoints.map(c => ({
          id: c.id,
          name: c.name,
          createdAt: new Date(c.created_at),
          comment: c.comment,
        })),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async restoreCheckpoint(checkpointId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const sprite = this.client.getSprite(this.spriteName);
      await sprite.checkpoints.restore(checkpointId);

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async enforceRetentionPolicy(retention: CheckpointRetention): Promise<void> {
    const checkpoints = await this.listCheckpoints();
    
    if (!checkpoints.success || !checkpoints.checkpoints) return;

    let toDelete: string[] = [];

    // Sort by creation date (newest first)
    const sorted = checkpoints.checkpoints.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    // Apply maxCount
    if (retention.maxCount && sorted.length > retention.maxCount) {
      const keepCount = Math.max(
        retention.minKeep || 0,
        retention.maxCount
      );
      toDelete.push(...sorted.slice(keepCount).map(c => c.id));
    }

    // Apply maxAgeDays
    if (retention.maxAgeDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retention.maxAgeDays);

      for (const checkpoint of sorted) {
        if (checkpoint.createdAt < cutoff) {
          // Don't delete if it would violate minKeep
          if (sorted.filter(c => c.id !== checkpoint.id).length >= (retention.minKeep || 0)) {
            toDelete.push(checkpoint.id);
          }
        }
      }
    }

    // Delete old checkpoints
    const sprite = this.client.getSprite(this.spriteName);
    for (const checkpointId of toDelete) {
      await sprite.checkpoints.delete(checkpointId);
    }
  }
}
```

---

## Summary

This plan provides **specific, actionable code** for implementing the most critical missing features identified in the deep review. Each implementation includes:

- **Type safety** with proper TypeScript interfaces
- **Error handling** with graceful fallbacks
- **Security considerations** (session isolation, signature verification)
- **Documentation** with usage examples
- **Integration points** with existing codebase

**Total Lines of Code:** ~800 lines across 5 new/expanded files

**Implementation Order:**
1. Week 1: Security fixes (Composio isolation, E2B Desktop)
2. Week 2-3: High priority (Nango Syncs/Webhooks)
3. Week 4: Medium priority (Sprites Checkpoints)
