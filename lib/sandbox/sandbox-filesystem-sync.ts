/**
 * Sandbox Filesystem Sync
 * Bidirectional sync between sandbox filesystems and the virtual filesystem.
 * Detects changes made via terminal (nano/vim) and syncs them to VFS,
 * and pushes VFS updates back into sandboxes.
 * 
 * FIX: Added global singleton pattern to prevent HMR interval leaks
 * in Next.js dev mode. See: https://nextjs.org/docs/pages/architecture/
 * development-closures
 */

import { sandboxBridge } from './sandbox-service-bridge';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

// Workspace directory varies by provider
// This will be resolved per-sandbox based on the provider
function getWorkspaceDirForSandbox(sandboxId: string): string {
  // Infer provider from sandbox ID prefix
  if (sandboxId.startsWith('mistral-')) return '/workspace';
  if (sandboxId.startsWith('blaxel-')) return '/workspace';
  if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return '/home/sprite/workspace';
  if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return '/workspace'; // CodeSandbox
  if (sandboxId.startsWith('e2b-')) return '/home/user';
  
  // Default to Daytona
  return '/home/daytona/workspace';
}

// Global singleton to prevent HMR interval leaks
declare global {
  var __sandboxFilesystemSync: SandboxFilesystemSync | undefined;
}

class SandboxFilesystemSync {
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastSyncVersions: Map<string, number> = new Map();
  private enabled: boolean;
  private syncIntervalMs: number;

  constructor() {
    this.enabled = process.env.SANDBOX_SYNC_ENABLED !== 'false';
    this.syncIntervalMs = parseInt(process.env.SANDBOX_SYNC_INTERVAL_MS || '5000', 10) || 5000;
  }

  startSync(sandboxId: string, userId: string): void {
    if (!this.enabled) {
      console.warn('[SandboxSync] Sync is disabled via SANDBOX_SYNC_ENABLED');
      return;
    }

    if (this.syncIntervals.has(sandboxId)) {
      console.warn(`[SandboxSync] Sync already running for sandbox ${sandboxId}`);
      return;
    }

    console.log(`[SandboxSync] Starting sync for sandbox ${sandboxId} (interval: ${this.syncIntervalMs}ms)`);

    const interval = setInterval(async () => {
      try {
        await this.syncSandboxToVFS(sandboxId, userId);
        await this.syncVFSToSandbox(sandboxId, userId);
      } catch (err) {
        console.warn(
          `[SandboxSync] Periodic sync error for sandbox ${sandboxId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }, this.syncIntervalMs);

    interval.unref?.();
    this.syncIntervals.set(sandboxId, interval);
  }

  stopSync(sandboxId: string): void {
    const interval = this.syncIntervals.get(sandboxId);
    if (interval) {
      clearInterval(interval);
      this.syncIntervals.delete(sandboxId);
      this.lastSyncVersions.delete(sandboxId);
      console.log(`[SandboxSync] Stopped sync for sandbox ${sandboxId}`);
    }
  }

  async syncSandboxToVFS(sandboxId: string, userId: string): Promise<void> {
    const workspaceDir = getWorkspaceDirForSandbox(sandboxId);
    let entries: { name: string; type: string }[];
    try {
      entries = await sandboxBridge.listDirectory(sandboxId, workspaceDir);
    } catch (err) {
      console.warn(
        `[SandboxSync] Cannot list sandbox ${sandboxId} directory:`,
        err instanceof Error ? err.message : err,
      );
      return;
    }

    if (!Array.isArray(entries)) return;

    const files = entries.filter((e) => e.type === 'file');

    for (const file of files) {
      const sandboxPath = `${workspaceDir}/${file.name}`;
      try {
        const sandboxContent = await sandboxBridge.readFile(sandboxId, sandboxPath);
        if (typeof sandboxContent !== 'string') continue;

        const vfsPath = file.name;
        let vfsContent: string | undefined;
        try {
          const vfsFile = await virtualFilesystem.readFile(userId, vfsPath);
          vfsContent = vfsFile.content;
        } catch {
          // File doesn't exist in VFS yet
        }

        if (vfsContent !== sandboxContent) {
          await virtualFilesystem.writeFile(userId, vfsPath, sandboxContent);
          console.log(`[SandboxSync] Sandbox → VFS: ${vfsPath} (sandbox ${sandboxId})`);
        }
      } catch (err) {
        console.warn(
          `[SandboxSync] Failed to sync file ${file.name} from sandbox ${sandboxId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  async syncVFSToSandbox(sandboxId: string, userId: string): Promise<void> {
    let currentVersion: number;
    try {
      currentVersion = await virtualFilesystem.getWorkspaceVersion(userId);
    } catch (err) {
      console.warn(
        `[SandboxSync] Cannot get VFS version for user ${userId}:`,
        err instanceof Error ? err.message : err,
      );
      return;
    }

    const lastVersion = this.lastSyncVersions.get(sandboxId);
    if (lastVersion === currentVersion) return;

    let snapshot: { files: { path: string; content: string }[] };
    try {
      snapshot = await virtualFilesystem.exportWorkspace(userId);
    } catch (err) {
      console.warn(
        `[SandboxSync] Cannot export VFS workspace for user ${userId}:`,
        err instanceof Error ? err.message : err,
      );
      return;
    }

    for (const file of snapshot.files) {
      const workspaceDir = getWorkspaceDirForSandbox(sandboxId);
      const sandboxPath = `${workspaceDir}/${file.path}`;
      try {
        await sandboxBridge.writeFile(sandboxId, sandboxPath, file.content);
      } catch (err) {
        console.warn(
          `[SandboxSync] Failed to write ${file.path} to sandbox ${sandboxId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    this.lastSyncVersions.set(sandboxId, currentVersion);
    console.log(`[SandboxSync] VFS → Sandbox: synced ${snapshot.files.length} files to sandbox ${sandboxId}`);
  }

  stopAll(): void {
    for (const [sandboxId] of this.syncIntervals) {
      this.stopSync(sandboxId);
    }
    console.log('[SandboxSync] All sync intervals stopped');
  }
}

// Use global singleton pattern to prevent HMR interval leaks
export const sandboxFilesystemSync = globalThis.__sandboxFilesystemSync ??= new SandboxFilesystemSync();
