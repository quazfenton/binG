/**
 * AgentFS Mount Service
 *
 * Mounts AgentFS (Turso/libSQL) databases as isolated filesystems
 * that can sync bidirectionally with the project VFS.
 *
 * Use cases:
 * - Isolated agent filesystems separate from server VFS
 * - Persistent state across sandbox destroy/recreate cycles
 * - Cloud sync via Turso for distributed agent deployments
 * - NFS-exposed filesystems for container/VM access
 * - MCP server integration for AI assistants
 *
 * @see https://docs.turso.tech/agentfs
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AgentFS:Mount');

// Lazy-loaded modules
let AgentFSModule: any = null;
let TursoSyncModule: any = null;

async function getAgentFS() {
  if (!AgentFSModule) {
    AgentFSModule = await import('agentfs-sdk');
  }
  return AgentFSModule.AgentFS;
}

async function getTursoSync() {
  if (!TursoSyncModule) {
    TursoSyncModule = await import('@tursodatabase/sync');
  }
  return TursoSyncModule.connect;
}

/**
 * Configuration for an AgentFS mount
 */
export interface AgentFSMountConfig {
  /** Unique mount identifier (maps to .agentfs/{id}.db) */
  id: string;
  /** Turso cloud URL for remote sync (optional) */
  syncRemoteUrl?: string;
  /** Turso auth token (required if syncRemoteUrl is set) */
  authToken?: string;
  /** Auto-sync interval in ms (0 = disabled, default: 0) */
  autoSyncIntervalMs?: number;
  /** Mount as read-only */
  readOnly?: boolean;
}

/**
 * Status of a mounted AgentFS instance
 */
export interface MountStatus {
  id: string;
  mounted: boolean;
  cloudSync: boolean;
  readOnly: boolean;
  autoSyncIntervalMs: number;
  lastPullAt?: number;
  lastPushAt?: number;
  lastError?: string;
  fileCount?: number;
  dbPath?: string;
}

/**
 * Represents a single mounted AgentFS filesystem
 */
export class AgentFSMount {
  readonly id: string;
  private agent: any;
  private config: AgentFSMountConfig;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private lastPullAt: number = 0;
  private lastPushAt: number = 0;
  private lastError: string | null = null;

  constructor(agent: any, config: AgentFSMountConfig) {
    this.agent = agent;
    this.config = config;
    this.id = config.id;
  }

  /**
   * Initialize the mount, start auto-sync if configured
   */
  async initialize(): Promise<void> {
    if (this.config.autoSyncIntervalMs && this.config.autoSyncIntervalMs > 0) {
      this.syncTimer = setInterval(
        () => this.sync().catch(e => {
          this.lastError = e.message;
          logger.warn(`Auto-sync failed for mount ${this.id}`, { error: e.message });
        }),
        this.config.autoSyncIntervalMs
      );
      logger.info(`Auto-sync enabled for mount ${this.id}`, {
        intervalMs: this.config.autoSyncIntervalMs,
      });
    }

    // Initial pull if cloud sync is configured
    if (this.config.syncRemoteUrl && this.config.authToken) {
      await this.pull();
    }
  }

  // ---- Filesystem operations ----

  async readFile(path: string): Promise<string> {
    return this.agent.fs.readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.config.readOnly) {
      throw new Error(`Mount ${this.id} is read-only`);
    }
    await this.agent.fs.writeFile(path, content);
  }

  async readdir(path: string): Promise<string[]> {
    return this.agent.fs.readdir(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.agent.fs.exists(path);
  }

  async stat(path: string): Promise<{ size: number; isFile: boolean; isDirectory: boolean; mtime: number }> {
    const stats = await this.agent.fs.stat(path);
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      mtime: stats.mtime,
    };
  }

  async deleteFile(path: string): Promise<void> {
    if (this.config.readOnly) {
      throw new Error(`Mount ${this.id} is read-only`);
    }
    await this.agent.fs.deleteFile(path);
  }

  // ---- Key-value operations ----

  async kvGet<T = any>(key: string): Promise<T | undefined> {
    return (this.agent.kv as any).get(key) as T | undefined;
  }

  async kvSet(key: string, value: any): Promise<void> {
    if (this.config.readOnly) {
      throw new Error(`Mount ${this.id} is read-only`);
    }
    await this.agent.kv.set(key, value);
  }

  async kvDelete(key: string): Promise<void> {
    if (this.config.readOnly) {
      throw new Error(`Mount ${this.id} is read-only`);
    }
    await this.agent.kv.delete(key);
  }

  async kvList(prefix: string): Promise<Array<{ key: string; value: any }>> {
    return this.agent.kv.list(prefix);
  }

  // ---- Tool tracking ----

  async recordToolCall(
    name: string,
    startedAt: number,
    completedAt: number,
    parameters?: any,
    result?: any,
    error?: string,
  ): Promise<number> {
    return this.agent.tools.record(name, startedAt, completedAt, parameters, result, error);
  }

  // ---- Cloud sync (Turso) ----

  /**
   * Pull changes from Turso cloud
   */
  async pull(): Promise<void> {
    if (!this.config.syncRemoteUrl || !this.config.authToken) {
      throw new Error(`Cloud sync not configured for mount ${this.id}`);
    }

    const connect = await getTursoSync();
    const db = await connect({
      path: `.agentfs/${this.id}.db`,
      authToken: this.config.authToken,
      url: this.config.syncRemoteUrl,
    });

    try {
      await db.pull();
      this.lastPullAt = Date.now();
      this.lastError = null;
      logger.info(`Pulled changes for mount ${this.id}`);
    } catch (e: any) {
      this.lastError = e.message;
      logger.error(`Pull failed for mount ${this.id}`, { error: e.message });
      throw e;
    }
  }

  /**
   * Push changes to Turso cloud
   */
  async push(): Promise<void> {
    if (this.config.readOnly) {
      throw new Error(`Mount ${this.id} is read-only — cannot push`);
    }
    if (!this.config.syncRemoteUrl || !this.config.authToken) {
      throw new Error(`Cloud sync not configured for mount ${this.id}`);
    }

    const connect = await getTursoSync();
    const db = await connect({
      path: `.agentfs/${this.id}.db`,
      authToken: this.config.authToken,
      url: this.config.syncRemoteUrl,
    });

    try {
      await db.push();
      this.lastPushAt = Date.now();
      this.lastError = null;
      logger.info(`Pushed changes for mount ${this.id}`);
    } catch (e: any) {
      this.lastError = e.message;
      logger.error(`Push failed for mount ${this.id}`, { error: e.message });
      throw e;
    }
  }

  /**
   * Bidirectional sync: pull then push
   */
  async sync(): Promise<{ pulled: boolean; pushed: boolean; error?: string }> {
    const result = { pulled: false, pushed: false, error: undefined as string | undefined };

    if (!this.config.syncRemoteUrl || !this.config.authToken) {
      result.error = 'Cloud sync not configured';
      return result;
    }

    try {
      await this.pull();
      result.pulled = true;
    } catch (e: any) {
      result.error = `Pull failed: ${e.message}`;
      return result;
    }

    if (!this.config.readOnly) {
      try {
        await this.push();
        result.pushed = true;
      } catch (e: any) {
        result.error = `Push failed: ${e.message}`;
      }
    }

    return result;
  }

  // ---- VFS ↔ AgentFS sync ----

  /**
   * Import files from the project VFS into this AgentFS mount.
   * Uses the VFS API to read files and writes them to AgentFS.
   */
  async importFromVfs(
    vfsReader: { readFile(ownerId: string, path: string): Promise<{ content: string }> },
    ownerId: string,
    paths: string[],
  ): Promise<{ imported: number; failed: number }> {
    let imported = 0;
    let failed = 0;

    for (const path of paths) {
      try {
        const file = await vfsReader.readFile(ownerId, path);
        await this.agent.fs.writeFile(path, file.content);
        imported++;
      } catch (e: any) {
        logger.warn(`Failed to import ${path}`, { error: e.message });
        failed++;
      }
    }

    logger.info(`Imported ${imported} files from VFS into mount ${this.id}`, { failed });
    return { imported, failed };
  }

  /**
   * Export files from this AgentFS mount to the project VFS.
   * Recursively snapshots the AgentFS filesystem and writes to VFS.
   */
  async exportToVfs(
    vfsWriter: { writeFile(ownerId: string, path: string, content: string): Promise<any> },
    ownerId: string,
  ): Promise<{ exported: number; failed: number }> {
    let exported = 0;
    let failed = 0;

    const snapshot = await this._snapshotAll('/');
    for (const [path, content] of snapshot) {
      try {
        await vfsWriter.writeFile(ownerId, path, content);
        exported++;
      } catch (e: any) {
        logger.warn(`Failed to export ${path}`, { error: e.message });
        failed++;
      }
    }

    logger.info(`Exported ${exported} files from mount ${this.id} to VFS`, { failed });
    return { exported, failed };
  }

  // ---- Status ----

  async getStatus(): Promise<MountStatus> {
    let fileCount = 0;
    try {
      const entries = await this.agent.fs.readdir('/');
      fileCount = entries.length;
    } catch {
      // Empty or unreadable
    }

    return {
      id: this.id,
      mounted: true,
      cloudSync: !!(this.config.syncRemoteUrl && this.config.authToken),
      readOnly: !!this.config.readOnly,
      autoSyncIntervalMs: this.config.autoSyncIntervalMs || 0,
      lastPullAt: this.lastPullAt || undefined,
      lastPushAt: this.lastPushAt || undefined,
      lastError: this.lastError || undefined,
      fileCount,
      dbPath: `.agentfs/${this.id}.db`,
    };
  }

  /**
   * Destroy the mount, stop auto-sync
   */
  async destroy(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    logger.info(`Mount ${this.id} destroyed`);
  }

  // ---- Internal ----

  private async _snapshotAll(dir: string): Promise<Map<string, string>> {
    const snapshot = new Map<string, string>();
    try {
      const entries = await this.agent.fs.readdir(dir);
      for (const entry of entries) {
        const fullPath = `${dir === '/' ? '' : dir}/${entry}`;
        try {
          const stats = await this.agent.fs.stat(fullPath);
          if (stats.isDirectory()) {
            const sub = await this._snapshotAll(fullPath);
            for (const [p, c] of sub) snapshot.set(p, c);
          } else {
            const content = await this.agent.fs.readFile(fullPath, 'utf-8');
            snapshot.set(fullPath, content);
          }
        } catch {
          // Skip unreadable entries
        }
      }
    } catch {
      // Empty directory
    }
    return snapshot;
  }
}

/**
 * AgentFS Mount Manager
 *
 * Manages multiple AgentFS mounts, provides CRUD operations
 * and handles lifecycle (create, get, list, destroy).
 */
export class AgentFSMountManager {
  private mounts: Map<string, AgentFSMount> = new Map();

  /**
   * Create or open an AgentFS mount
   */
  async mount(config: AgentFSMountConfig): Promise<AgentFSMount> {
    const existing = this.mounts.get(config.id);
    if (existing) return existing;

    const AgentFS = await getAgentFS();
    const agentConfig: any = { id: config.id };

    // Use Turso cloud if configured
    if (config.syncRemoteUrl && config.authToken) {
      agentConfig.databaseUrl = config.syncRemoteUrl;
      agentConfig.authToken = config.authToken;
    }

    const agent = await AgentFS.open(agentConfig);
    const mount = new AgentFSMount(agent, config);
    await mount.initialize();

    this.mounts.set(config.id, mount);
    logger.info(`Mounted AgentFS: ${config.id}`, {
      cloudSync: !!config.syncRemoteUrl,
      readOnly: config.readOnly,
    });

    return mount;
  }

  /**
   * Get an existing mount by ID
   */
  get(id: string): AgentFSMount | undefined {
    return this.mounts.get(id);
  }

  /**
   * List all active mounts
   */
  async list(): Promise<MountStatus[]> {
    const statuses: MountStatus[] = [];
    for (const mount of this.mounts.values()) {
      statuses.push(await mount.getStatus());
    }
    return statuses;
  }

  /**
   * Unmount and destroy a mount
   */
  async unmount(id: string): Promise<void> {
    const mount = this.mounts.get(id);
    if (mount) {
      await mount.destroy();
      this.mounts.delete(id);
      logger.info(`Unmounted AgentFS: ${id}`);
    }
  }

  /**
   * Destroy all mounts
   */
  async unmountAll(): Promise<void> {
    for (const [id] of this.mounts) {
      await this.unmount(id);
    }
  }
}

// Singleton instance
export const agentFSMountManager = new AgentFSMountManager();
