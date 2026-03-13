/**
 * Sandbox Filesystem Sync
 * Bidirectional sync between sandbox filesystems and the virtual filesystem.
 * Detects changes made via terminal (nano/vim) and syncs them to VFS,
 * and pushes VFS updates back into sandboxes.
 *
 * FIX: Added global singleton pattern to prevent HMR interval leaks
 * in Next.js dev mode. See: https://nextjs.org/docs/pages/architecture/
 * development-closures
 * 
 * FIX: Added emitFilesystemUpdated to notify UI panels of sandbox changes
 * 
 * FIX: Polling only runs for API-based sandbox providers (E2B, Daytona, etc.)
 *      Self-hosted containers (OpenSandbox, MicroSandbox) use direct event emission
 */

import { sandboxBridge } from './sandbox-service-bridge';
import { virtualFilesystem } from '../virtual-filesystem/virtual-filesystem-service';
import { emitFilesystemUpdated } from '../virtual-filesystem/sync-events';

// Workspace directory varies by provider
// This will be resolved per-sandbox based on the provider
function getWorkspaceDirForSandbox(sandboxId: string): string {
  // E2B new format: some IDs don't have the 'e2b-' prefix (e.g., 'ii8938a6cyxwggwamxh1k')
  // These are alphanumeric strings, typically 18-20 chars
  const isE2BFormat = /^[a-z0-9]{15,25}$/i.test(sandboxId);
  
  if (isE2BFormat) return '/home/user';
  
  // Infer provider from sandbox ID prefix
  if (sandboxId.startsWith('mistral-')) return '/workspace';
  if (sandboxId.startsWith('blaxel-')) return '/workspace';
  if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return '/home/sprite/workspace';
  if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return '/workspace'; // CodeSandbox
  if (sandboxId.startsWith('e2b-')) return '/home/user';

  // Default to Daytona
  return '/home/daytona/workspace';
}

/**
 * Check if sandbox requires polling (API-based providers)
 * Self-hosted containers (OpenSandbox, MicroSandbox) use OPTIMIZED polling
 * with longer intervals since they're on the same network
 */
function getPollingConfig(sandboxId: string): { enabled: boolean; intervalMs?: number } {
  // Self-hosted containers - use optimized (slower) polling
  // They're on same network so changes are less frequent and latency is lower
  if (sandboxId.startsWith('opensandbox-') || sandboxId.startsWith('osb-')) {
    return { enabled: true, intervalMs: 10000 }; // 10 seconds
  }
  if (sandboxId.startsWith('microsandbox-') || sandboxId.startsWith('micro-')) {
    return { enabled: true, intervalMs: 10000 }; // 10 seconds
  }
  
  // API-based providers - standard polling
  // External services need more frequent checks for real-time feel
  return { enabled: true }; // Use default interval
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

    // Get polling config for this sandbox type
    const pollingConfig = getPollingConfig(sandboxId);
    
    if (!pollingConfig.enabled) {
      console.log(`[SandboxSync] Polling disabled for sandbox: ${sandboxId}`);
      return;
    }

    if (this.syncIntervals.has(sandboxId)) {
      console.warn(`[SandboxSync] Sync already running for sandbox ${sandboxId}`);
      return;
    }

    // Use sandbox-specific interval or default
    const intervalMs = pollingConfig.intervalMs ?? this.syncIntervalMs;
    console.log(`[SandboxSync] Starting sync for ${sandboxId} (interval: ${intervalMs}ms, type: ${pollingConfig.intervalMs ? 'optimized' : 'standard'})`);

    // ✅ FIX: Perform initial sync immediately so files are available when terminal connects
    (async () => {
      try {
        await this.syncVFSToSandbox(sandboxId, userId);
        console.log(`[SandboxSync] Initial sync completed for sandbox ${sandboxId}`);
      } catch (err) {
        console.warn(
          `[SandboxSync] Initial sync error for sandbox ${sandboxId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    })();

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
    }, intervalMs);

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

    // Track synced files for event emission
    const syncedFiles: Array<{ path: string; workspaceVersion?: number }> = [];

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
          const result = await virtualFilesystem.writeFile(userId, vfsPath, sandboxContent);
          console.log(`[SandboxSync] Sandbox → VFS: ${vfsPath} (sandbox ${sandboxId})`);
          
          // Track for event emission
          syncedFiles.push({
            path: vfsPath,
            workspaceVersion: result?.version,
          });
        }
      } catch (err) {
        console.warn(
          `[SandboxSync] Failed to sync file ${file.name} from sandbox ${sandboxId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Emit event if files were synced (client-side only)
    if (syncedFiles.length > 0 && typeof window !== 'undefined') {
      emitFilesystemUpdated({
        scopePath: 'project',
        source: 'sandbox',
        paths: syncedFiles.map(f => f.path),
        workspaceVersion: syncedFiles[0]?.workspaceVersion,
        sessionId: sandboxId,
      });
      console.log(`[SandboxSync] Emitted filesystem-updated event for ${syncedFiles.length} files from sandbox ${sandboxId}`);
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

    // Get VFS workspace root to strip from paths when syncing to sandbox
    // This ensures files appear directly in /workspace instead of /workspace/project/
    const vfsRoot = 'project';

    for (const file of snapshot.files) {
      const workspaceDir = getWorkspaceDirForSandbox(sandboxId);
      // Strip VFS workspace root prefix so files go directly to sandbox workspace
      const relativePath = file.path.startsWith(vfsRoot + '/')
        ? file.path.slice(vfsRoot.length + 1)
        : file.path;
      const sandboxPath = `${workspaceDir}/${relativePath}`;
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
