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

import { sandboxBridge } from '../../sandbox/sandbox-service-bridge';
import { virtualFilesystem } from '../virtual-filesystem-service';
import { emitFilesystemUpdated } from './sync-events';

// Workspace directory varies by provider
// This will be resolved per-sandbox based on the provider
/**
 * Get all possible workspace directories for a sandbox
 * Some sandbox providers may use multiple directories (e.g., user home + project dirs)
 * This returns an array to check all possibilities for delete detection
 */
function getWorkspaceDirsForSandbox(sandboxId: string): string[] {
  // E2B new format: some IDs don't have the 'e2b-' prefix (e.g., 'ii8938a6cyxwggwamxh1k')
  // These are alphanumeric strings, typically 18-20 chars
  const isE2BFormat = /^[a-z0-9]{15,25}$/i.test(sandboxId);
  
  if (isE2BFormat) {
    // E2B can have multiple workspace locations
    return ['/home/user', '/home/user/project', '/home/user/code'];
  }
  
  // Infer provider from sandbox ID prefix
  if (sandboxId.startsWith('mistral-')) {
    return ['/workspace', '/workspace/project', '/app'];
  }
  if (sandboxId.startsWith('blaxel-')) {
    return ['/workspace', '/workspace/app'];
  }
  if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) {
    return ['/home/sprite/workspace', '/home/sprite/projects'];
  }
  if (sandboxId.startsWith('csb-') || sandboxId.length === 6) {
    return ['/workspace', '/workspace/src'];
  }
  if (sandboxId.startsWith('e2b-')) {
    return ['/home/user', '/home/user/project'];
  }

  // Default to Daytona (most common)
  return ['/home/daytona/workspace', '/home/daytona/projects'];
}

/**
 * Get the primary workspace directory for a sandbox (backwards compatible)
 */
function getWorkspaceDirForSandbox(sandboxId: string): string {
  return getWorkspaceDirsForSandbox(sandboxId)[0];
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
    return { enabled: true, intervalMs: 15000 }; // 15 seconds (was 10s)
  }
  if (sandboxId.startsWith('microsandbox-') || sandboxId.startsWith('micro-')) {
    return { enabled: true, intervalMs: 15000 }; // 15 seconds (was 10s)
  }

  // API-based providers - slower polling to prevent rate limiting
  // External services need rate limiting to avoid "Too many requests" errors
  return { enabled: true, intervalMs: 10000 }; // 10 seconds (was 5s default)
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
  
  // === IMPROVEMENT 1: Per-session debounce queues ===
  // Each PTY session gets its own debounce queue instead of global
  private sessionDebounceQueues: Map<string, NodeJS.Timeout> = new Map();
  private pendingSessionSyncs: Map<string, Set<string>> = new Map();  // sessionId -> set of paths to sync
  private readonly DEBOUNCE_DELAY_MS = 300;  // Debounce delay per session
  
  // === IMPROVEMENT 2: Dedup deletes ===
  // Track recently deleted files to prevent duplicate delete events
  private recentlyDeletedFiles: Map<string, number> = new Map();  // path -> timestamp
  private readonly DELETE_DEDUP_WINDOW_MS = 2000;  // Window to dedup delete events
  private knownFiles: Map<string, Set<string>> = new Map();  // Track known files per sandbox for delete detection
  
  // === IMPROVEMENT 3: File sync coalescing ===
  // Merge multiple changes to same file within coalescing window
  private pendingFileChanges: Map<string, { content: string; timestamp: number }> = new Map();  // path -> {content, timestamp}
  private coalescingTimer: NodeJS.Timeout | null = null;
  private readonly COALESCING_WINDOW_MS = 500;  // Window to coalesce changes

  // === LARGE FILE CHECK ===
  // Skip syncing files larger than threshold to sandbox containers for performance.
  // This is a SYNC bandwidth optimization, NOT a VFS write limit.
  // VFS can store files up to MAX_FILE_SIZE (100MB); sandboxes get incremental sync.
  // Override via SANDBOX_SYNC_MAX_FILE_BYTES env var (default: 5MB).
  private readonly MAX_FILE_SIZE_BYTES = parseInt(
    process.env.SANDBOX_SYNC_MAX_FILE_BYTES || String(5 * 1024 * 1024),
    10
  );

  constructor() {
    this.enabled = process.env.SANDBOX_SYNC_ENABLED !== 'false';
    this.syncIntervalMs = parseInt(process.env.SANDBOX_SYNC_INTERVAL_MS || '5000', 10) || 5000;
    
    // Start coalescing timer
    this.startCoalescingTimer();
  }

  /**
   * Check if file should be skipped due to size limit
   * Uses byte count for accurate size (handles UTF-16 vs actual bytes)
   */
  private shouldSkipLargeFile(content: string): boolean {
    // Use byte count for accurate size (TextEncoder gives actual bytes, not UTF-16 chars)
    const byteSize = new TextEncoder().encode(content).length;
    if (byteSize > this.MAX_FILE_SIZE_BYTES) {
      console.log(`[SandboxSync] Skipped large file (>5MB): ${byteSize} bytes`);
      return true;
    }
    return false;
  }
  
  /**
   * Start the coalescing timer that flushes pending changes periodically
   */
  private startCoalescingTimer(): void {
    this.coalescingTimer = setInterval(() => {
      (this as any).flushCoalescedChanges();
    }, this.COALESCING_WINDOW_MS);
    this.coalescingTimer.unref?.();
  }
  
  /**
   * Flush all coalesced file changes to VFS (IMPROVEMENT 3)
   */
  private async flushCoalescedChanges(userId: string): Promise<void> {
    if (this.pendingFileChanges.size === 0) return;
    
    const changes = new Map(this.pendingFileChanges);
    this.pendingFileChanges.clear();
    
    for (const [path, { content }] of changes) {
      try {
        await virtualFilesystem.writeFile(userId, path, content);
        console.log(`[SandboxSync] Coalesced write: ${path}`);
      } catch (err) {
        console.warn(`[SandboxSync] Failed to flush coalesced change for ${path}:`, err instanceof Error ? err.message : err);
      }
    }
    
    console.log(`[SandboxSync] Flushed ${changes.size} coalesced file changes to VFS`);
  }
  
  /**
   * Queue a file change for coalescing (IMPROVEMENT 3)
   * Multiple changes to same file within coalescing window are merged
   */
  private queueFileChange(path: string, content: string): void {
    this.pendingFileChanges.set(path, { content, timestamp: Date.now() });
  }
  
  /**
   * Check and track deleted files for dedup (IMPROVEMENT 2)
   * Returns true if this delete should be skipped (duplicate)
   */
  private shouldSkipDuplicateDelete(path: string): boolean {
    // Cleanup old entries periodically to prevent memory leak
    const now = Date.now();
    for (const [p, time] of this.recentlyDeletedFiles) {
      if (now - time > this.DELETE_DEDUP_WINDOW_MS) {
        this.recentlyDeletedFiles.delete(p);
      }
    }
    
    const lastDelete = this.recentlyDeletedFiles.get(path);
    if (lastDelete && now - lastDelete < this.DELETE_DEDUP_WINDOW_MS) {
      console.log(`[SandboxSync] Dedup: Skipping duplicate delete for ${path}`);
      return true;
    }
    this.recentlyDeletedFiles.set(path, now);
    return false;
  }
  
  /**
   * Track a file deletion from sandbox (IMPROVEMENT 2)
   * Call this when a file is no longer present in sandbox listing
   */
  trackFileDeleted(path: string): void {
    this.recentlyDeletedFiles.set(path, Date.now());
  }
  
  /**
   * Queue a sync for a specific session with per-session debouncing (IMPROVEMENT 1)
   */
  private queueSessionSync(sessionId: string, paths: string[]): void {
    // Add paths to pending set
    if (!this.pendingSessionSyncs.has(sessionId)) {
      this.pendingSessionSyncs.set(sessionId, new Set());
    }
    const pending = this.pendingSessionSyncs.get(sessionId)!;
    paths.forEach(p => pending.add(p));
    
    // Clear existing debounce timer for this session
    const existingTimer = this.sessionDebounceQueues.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set new debounce timer
    const timer = setTimeout(async () => {
      const sessionPaths = this.pendingSessionSyncs.get(sessionId);
      if (sessionPaths && sessionPaths.size > 0) {
        console.log(`[SandboxSync] Session ${sessionId} debounce fired for ${sessionPaths.size} paths`);
        // Process the queued paths
        this.pendingSessionSyncs.delete(sessionId);
      }
      this.sessionDebounceQueues.delete(sessionId);
    }, this.DEBOUNCE_DELAY_MS);
    
    this.sessionDebounceQueues.set(sessionId, timer);
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
    
    // Clean up knownFiles for this sandbox (memory leak fix)
    for (const wsDir of getWorkspaceDirsForSandbox(sandboxId)) {
      this.knownFiles.delete(`files:${sandboxId}:${wsDir}`);
    }
    this.knownFiles.delete(`all:${sandboxId}`);
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

    // === IMPROVEMENT 2: Track deletes (extended for multiple workspace paths) ===
    // Check ALL possible workspace directories for this sandbox
    const allWorkspaceDirs = getWorkspaceDirsForSandbox(sandboxId);
    const deletedFiles: string[] = [];
    
    for (const wsDir of allWorkspaceDirs) {
      const knownFilesKey = `files:${sandboxId}:${wsDir}`;
      const previouslyKnown = this.knownFiles.get(knownFilesKey) || new Set<string>();
      
      // Only check this workspace dir if it's the one we're currently syncing
      if (wsDir === workspaceDir) {
        const currentFiles = new Set(files.map(f => f.name));
        
        // Find deleted files (in previously known but not in current)
        for (const known of previouslyKnown) {
          if (!currentFiles.has(known)) {
            deletedFiles.push(known);
            this.trackFileDeleted(known);  // Track for dedup
          }
        }
        
        // Update known files for current workspace
        this.knownFiles.set(knownFilesKey, currentFiles);
      } else {
        // For other workspace dirs, check if they've been abandoned (all files gone)
        // This handles case where sandbox switches primary workspace
        if (previouslyKnown.size > 0) {
          // Mark all previously known files as potentially deleted
          for (const known of previouslyKnown) {
            this.trackFileDeleted(known);
          }
          this.knownFiles.delete(knownFilesKey);
        }
      }
    }
    
    // Also track files across ALL workspace dirs for comprehensive delete detection
    // Use Set for O(1) duplicate checking instead of array.includes()
    const deletedFilesSet = new Set(deletedFiles);
    const allKnownFilesKey = `all:${sandboxId}`;
    const allPreviouslyKnown = this.knownFiles.get(allKnownFilesKey) || new Set<string>();
    const allCurrentFiles = new Set(files.map(f => `${workspaceDir}/${f.name}`));
    
    for (const known of allPreviouslyKnown) {
      if (!allCurrentFiles.has(known)) {
        // This is a cross-workspace delete - add to set (automatically dedups)
        const relativePath = known.split('/').pop() || known;
        deletedFilesSet.add(relativePath);
      }
    }
    this.knownFiles.set(allKnownFilesKey, allCurrentFiles);
    
    // Convert Set back to array for downstream processing
    const finalDeletedFiles = Array.from(deletedFilesSet);
    
    if (finalDeletedFiles.length > 0) {
      console.log(`[SandboxSync] Detected ${finalDeletedFiles.length} deleted files in sandbox ${sandboxId}:`, finalDeletedFiles);
      // Emit delete events (deduped)
      if (typeof window !== 'undefined') {
        const deduplicatedDeletes = finalDeletedFiles.filter(f => !this.shouldSkipDuplicateDelete(f));
        if (deduplicatedDeletes.length > 0) {
          emitFilesystemUpdated({
            scopePath: 'project',
            source: 'sandbox',
            paths: [],  // Empty paths signals deletes
            workspaceVersion: undefined,
            sessionId: sandboxId,
          } as any);
        }
      }
    }

    // Track synced files for event emission (with coalescing - IMPROVEMENT 3)
    const syncedFiles: Array<{ path: string; workspaceVersion?: number }> = [];

    for (const file of files) {
      const sandboxPath = `${workspaceDir}/${file.name}`;
      try {
        const sandboxContent = await sandboxBridge.readFile(sandboxId, sandboxPath);
        if (typeof sandboxContent !== 'string') continue;

        // === LARGE FILE CHECK: Skip files > 5MB for performance ===
        if (this.shouldSkipLargeFile(sandboxContent)) {
          continue;
        }

        const vfsPath = file.name;
        let vfsContent: string | undefined;
        try {
          const vfsFile = await virtualFilesystem.readFile(userId, vfsPath);
          vfsContent = vfsFile.content;
        } catch {
          // File doesn't exist in VFS yet
        }

        if (vfsContent !== sandboxContent) {
          // === IMPROVEMENT 3: Use coalescing ===
          // Queue the change instead of writing immediately
          this.queueFileChange(vfsPath, sandboxContent);
          
          // Track for event emission (we'll emit after coalescing flushes)
          syncedFiles.push({
            path: vfsPath,
            workspaceVersion: undefined,  // Will be set after coalescing
          });
        }
      } catch (err) {
        console.warn(
          `[SandboxSync] Failed to sync file ${file.name} from sandbox ${sandboxId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }    // Flush coalesced changes now (end of sync cycle)
    await this.flushCoalescedChanges(userId);
    
    // Emit event for synced files after coalescing
    if (syncedFiles.length > 0 && typeof window !== 'undefined') {
      const deduplicatedPaths = syncedFiles.filter(f => !this.shouldSkipDuplicateDelete(f.path));
      
      if (deduplicatedPaths.length > 0) {
        emitFilesystemUpdated({
          scopePath: 'project',
          source: 'sandbox',
          paths: deduplicatedPaths.map(f => f.path),
          workspaceVersion: undefined,
          sessionId: sandboxId,
        });
        console.log(`[SandboxSync] Emitted filesystem-updated event for ${deduplicatedPaths.length} files (coalesced)`);
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
    
    // Clear all session debounce queues (IMPROVEMENT 1)
    for (const [sessionId, timer] of this.sessionDebounceQueues) {
      clearTimeout(timer);
    }
    this.sessionDebounceQueues.clear();
    this.pendingSessionSyncs.clear();
    
    // Clear coalescing timer (IMPROVEMENT 3)
    if (this.coalescingTimer) {
      clearInterval(this.coalescingTimer);
      this.coalescingTimer = null;
    }
    
    // Clear delete dedup tracking
    this.recentlyDeletedFiles.clear();
    this.pendingFileChanges.clear();
    
    console.log('[SandboxSync] All sync intervals stopped');
  }
}

// Use global singleton pattern to prevent HMR interval leaks
export const sandboxFilesystemSync = globalThis.__sandboxFilesystemSync ??= new SandboxFilesystemSync();
