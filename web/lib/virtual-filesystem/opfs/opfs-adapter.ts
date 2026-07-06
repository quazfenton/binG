/**
 * OPFS Adapter
 *
 * OPFS backend for client-side file operations
 * Provides instant file operations using Origin Private File System
 * Server sync via API endpoints with proper authentication
 *
 * Features:
 * - OPFS-first read/write for instant operations
 * - Queue management for pending operations
 * - Conflict detection and resolution
 * - Offline mode support
 * - Version tracking
 */

'use client';

import { OPFSCore, OPFSError, opfsCore } from './opfs-core';
import { IndexedDBBackend, indexedDBBackend } from '../indexeddb-backend';
import type { VirtualFile } from '../filesystem-types';
import {
  fetchFileFromServer,
  writeFileToServer,
  getWorkspaceSnapshot,
} from './opfs-api-client';

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('VFS:OPFSAdapter');

export interface SyncOptions {
  direction?: 'to-opfs' | 'to-server' | 'bidirectional';
  includePatterns?: string[];
  excludePatterns?: string[];
  force?: boolean;
}

export interface SyncResult {
  success: boolean;
  filesSynced: number;
  bytesTransferred: number;
  conflicts: ConflictInfo[];
  errors: string[];
  duration: number;
  /** Whether the sync was cancelled by the abort signal */
  cancelled?: boolean;
  /**
   * Step 6: set to true when a manual syncToServer() call short-circuited
   * because another flush was already in progress. Distinct from the
   * "no work to do" case (where `success: true` + `filesSynced: 0`).
   * The caller can either retry the sync, show a "syncing..." spinner,
   * or fall back to the 30s background poll.
   *
   * Handling example:
   * ```ts
   * const result = await opfsAdapter.syncToServer(ownerId);
   * if (result.syncInProgress) {
   *   // Another flush is mid-flight; show a spinner and poll later
   *   setTimeout(() => syncToServer(ownerId), 2000);
   *   return;
   * }
   * if (!result.success) { // real error
   *   toast.error(result.errors.join('; '));
   *   return;
   * }
   * toast.success(`Synced ${result.filesSynced} files`);
   * ```
   */
  syncInProgress?: boolean;
}

export interface ConflictInfo {
  path: string;
  opfsVersion: number;
  serverVersion: number;
  resolution: 'opfs' | 'server' | 'manual';
}

export interface QueuedWrite {
  id: string;
  path: string;
  content: string;
  timestamp: number;
  synced: boolean;
  ownerId: string;
  version: number;
}

export interface SyncStatus {
  isSyncing: boolean;
  pendingChanges: number;
  lastSyncTime: number | null;
  isOnline: boolean;
  hasConflicts: boolean;
  opfsSupported: boolean;
}

export interface OPFSAdapterOptions {
  autoSync?: boolean;
  autoSyncInterval?: number;
  maxQueueSize?: number;
}

/**
 * OPFS Adapter Class
 * 
 * Provides a seamless bridge between the server-side VFS and client-side OPFS.
 * Uses an OPFS-first strategy for instant read/write operations with 
 * background synchronization to the server.
 */
export class OPFSAdapter {
  private core: OPFSCore;
  private fallbackBackend: IndexedDBBackend | null = null;
  private usingFallback = false;
  private writeQueue: QueuedWrite[] = [];
  private syncInProgress = false;
  private lastSyncTime: Map<string, number> = new Map<string, number>();
  // Bug #1 fix: debounce timer for persisting fileVersions + writeQueue to IDB
  // (avoids a sync IDB write on every keystroke; coalesces burst writes)
  private persistTimeout: ReturnType<typeof setTimeout> | null = null;
  private fileVersions: Map<string, { opfs: number; server: number }> = new Map<string, { opfs: number; server: number }>();
  private syncInterval: NodeJS.Timeout | null = null;
  private enabled = false;
  private ownerId: string | null = null;
  private options: Required<OPFSAdapterOptions>;
  // Bug #1 v3 fix (Step 4) v2: a Promise that tracks the in-flight
  // `hydrateState` call during `performEnable`. `writeFile` and `deleteFile`
  // check this and await it (with bounded latency, ~5–20ms for an IDB read)
  // before mutating `fileVersions` or `writeQueue`. Without this guard, a
  // `writeFile`/`deleteFile` that lands between `this.enabled = true` and
  // the hydration's `this.fileVersions = hydrated` overwrite would be
  // CLOBBERED — a silent data-loss bug.
  //
  // The Step 4 v2 fix moves the assignment to the very TOP of `performEnable`
  // (BEFORE any code path that sets `enabled = true`). The v1 fix assigned
  // it after the listener setup, which left a bug window: any writeFile
  // landing between the OPFS init's `enabled = true` and the v1
  // hydrationPromise assignment would see `enabled === true` AND
  // `hydrationPromise === null`, proceed without blocking, and then be
  // CLOBBERED by the hydration that ran immediately after.
  private hydrationPromise: Promise<void> | null = null;
  private onlineHandler: (() => void) | null = null;
  // Bug #1 v2 fix (Step 3): tab-close / pagehide handler that synchronously
  // flushes the debounced 500ms `schedulePersist` so offline edits don't get
  // lost when the user closes the tab faster than the debounce window. The
  // `visibilityHandler` is an iOS Safari fallback (iOS doesn't fire
  // `pagehide` reliably when the tab is backgrounded).
  private tabCloseHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  // Reference count to track multiple enable/disable calls from different components
  private enableCount = 0;
  private currentWorkspaceId: string | null = null;

  constructor(options: OPFSAdapterOptions = {}) {
    this.core = opfsCore;
    this.fallbackBackend = indexedDBBackend;
    this.options = {
      autoSync: true,
      autoSyncInterval: 30000, // 30 seconds
      maxQueueSize: 100,
      ...options,
    };
  }

  /**
   * Check if OPFS is supported in current environment
   */
  static isSupported(): boolean {
    return OPFSCore.isSupported();
  }

  /**
   * Enable OPFS for a workspace (with IndexedDB fallback)
   *
   * @param ownerId - Owner/session identifier
   * @param workspaceId - Workspace identifier (defaults to ownerId)
   */
  private pendingEnablePromise: Promise<void> | null = null;

  async enable(ownerId: string, workspaceId?: string): Promise<void> {
    const wsId = workspaceId || ownerId;

    // If already enabled for the same workspace, just increment reference count
    if (this.enabled && this.currentWorkspaceId === wsId) {
      this.enableCount++;
      logger.info('[OPFS] Already enabled for workspace, incrementing ref count to:', this.enableCount);
      return Promise.resolve();
    }

    // If another enable() is in progress, wait for it to complete
    if (this.pendingEnablePromise) {
      return this.pendingEnablePromise.then(() => {
        // After waiting, check again in case it completed for the same workspace
        if (this.enabled && this.currentWorkspaceId === wsId) {
          this.enableCount++;
          logger.info('[OPFS] Concurrent enable completed, incrementing ref count to:', this.enableCount);
          return;
        }
        // Otherwise, start a new enable for this workspace
        return this.enable(ownerId, wsId);
      });
    }

    // Mark that we're in the process of enabling
    this.enableCount = 1;
    this.pendingEnablePromise = this.performEnable(ownerId, wsId).finally(() => {
      this.pendingEnablePromise = null;
    });
    
    return this.pendingEnablePromise;
  }

  /**
   * Internal enable implementation
   */
  /**
   * Internal enable implementation.
   *
   * Bug #1 v3 fix (Step 4) v2: `hydrationPromise` is set SYNCHRONOUSLY at
   * the very top of `performEnable`, BEFORE the OPFS init / enableFallback
   * path sets `enabled = true`. This guarantees that any `writeFile` or
   * `deleteFile` that observes `enabled === true` (set later in this
   * function by either the OPFS init or enableFallback) ALSO observes a
   * non-null `hydrationPromise` and awaits it. Without this, a writeFile
   * landing in the window between the OPFS init's `enabled = true` and
   * the v1 hydrationPromise assignment (after listener setup) would not
   * be blocked, and would be CLOBBERED by the hydration that runs
   * immediately after — silently losing the user's offline edit.
   */
  /**
   * Bug #1 fix: serialize fileVersions + writeQueue to JSON and write to
   * the provided backend under a reserved hidden path
   * (`.vfs-adapter-state.json`). No schema change needed — we reuse the
   * existing writeFile API with a special key.
   *
   * Renamed from `persistState` (Step 5) to `serialize` to disambiguate
   * from the instance wrapper of the same name (the instance wrapper
   * does the full read-from-state + serialize + write cycle; this static
   * method is the pure "object → JSON" step). The prefix-less name
   * `serialize` makes the role obvious in test code.
   *
   * Exposed as a STATIC method so tests can inject a mock backend and
   * verify the serialization round-trip without instantiating the full
   * OPFSAdapter (which requires browser globals like OPFS and IndexedDB).
   * The instance method below is a thin wrapper that reads from
   * `this.fallbackBackend` and `this.*` state.
   */
  static async serializeAdapterState(
    backend: StateStorageBackend,
    ownerId: string,
    fileVersions: Map<string, { opfs: number; server: number }>,
    writeQueue: QueuedWrite[],
  ): Promise<void> {
    const payload = JSON.stringify({
      fileVersions: Array.from(fileVersions.entries()),
      writeQueue,
    });
    await backend.writeFile(ownerId, '.vfs-adapter-state.json', payload);
  }

  /**
   * Bug #1 fix: read the persisted state from the provided backend and
   * return a fresh `{ fileVersions, writeQueue }` pair. Returns empty
   * Maps/arrays on FILE_NOT_FOUND (first run, or different ownerId).
   * Throws on JSON parse errors so the caller can decide whether to log
   * a warning or fall back to defaults.
   *
   * Renamed from `hydrateState` (Step 5) to `deserializeAdapterState` to
   * disambiguate from the instance wrapper of the same name (the instance
   * wrapper does the full read-from-backend + parse + write-into-state
   * cycle; this static method is the pure "JSON → object" step). The
   * longer name makes the role obvious in test code.
   *
   * Exposed as a STATIC method for the same reason as serialize above.
   */
  static async deserializeAdapterState(
    backend: StateStorageBackend,
    ownerId: string,
  ): Promise<{
    fileVersions: Map<string, { opfs: number; server: number }>;
    writeQueue: QueuedWrite[];
  }> {
    let content: string | undefined;
    try {
      const result = await backend.readFile(ownerId, '.vfs-adapter-state.json');
      content = result?.content;
    } catch (err: any) {
      // FILE_NOT_FOUND is expected for first runs / different ownerId —
      // return empty defaults so the caller can proceed with a fresh
      // adapter. Any other error is re-thrown so the instance wrapper
      // can log it as a [WARN] (it indicates a real IDB corruption).
      if (err?.code !== 'FILE_NOT_FOUND' && !String(err?.message || '').includes('not found')) {
        throw err;
      }
    }
    if (!content) {
      return { fileVersions: new Map(), writeQueue: [] };
    }
    const parsed = JSON.parse(content);
    const fileVersions =
      parsed.fileVersions && Array.isArray(parsed.fileVersions)
        ? new Map<string, { opfs: number; server: number }>(parsed.fileVersions)
        : new Map<string, { opfs: number; server: number }>();
    const writeQueue =
      parsed.writeQueue && Array.isArray(parsed.writeQueue) ? parsed.writeQueue : [];
    return { fileVersions, writeQueue };
  }

  /**
   * Bug #1 fix: schedule a debounced persist of fileVersions + writeQueue to
   * IndexedDB. Coalesces burst writes into a single IDB write 500ms after
   * the last change. The state survives a tab close — the next enable() calls
   * hydrateState() to restore it BEFORE syncFromServer() runs.
   *
   * Called from `queueWrite()`, `deleteFile()`, and `flushWriteQueue()` —
   * NOT from `writeFile()` (since `writeFile()` immediately calls
   * `queueWrite()` which calls `schedulePersist()`). Single source of
   * truth for "a write was queued, persist state".
   */
  private schedulePersist(): void {
    if (this.persistTimeout) clearTimeout(this.persistTimeout);
    const ownerId = this.ownerId;
    if (!ownerId) return;
    this.persistTimeout = setTimeout(() => {
      this.persistTimeout = null;
      this.persistState(ownerId).catch((err) =>
        logger.warn('[OPFS] Failed to persist adapter state to IDB:', err),
      );
    }, 500);
  }

  /**
   * Bug #1 v2 fix (Step 3): factory for the pagehide / visibilitychange
   * handler that synchronously flushes the 500ms debounced `schedulePersist`
   * so offline edits don't get lost on fast tab-close.
   *
   * Why a factory (and not an arrow-class-field): a class field like
   * `private handler = () => this.doFlush()` would bind `this` at
   * construction time. We want a fresh closure per `performEnable` call so
   * that `performDisable` (which nulls out `this.ownerId`) doesn't leave a
   * stale closure referencing dead state. The factory returns a closure
   * that captures `this` at call time (via the arrow function inside), so
   * it always sees the current `this.persistTimeout` and `this.ownerId`.
   *
   * The persist is fire-and-forget — `pagehide` listeners don't get to
   * await promises, but modern browsers (Chrome, Firefox, Safari) give
   * ~100ms of post-pagehide grace period for pending microtasks/Promise
   * continuations to complete, which is enough for a small IDB write.
   * Worst case (a write that starts right at pagehide): the write may
   * not complete, but the user has already lost focus on the tab, so
   * the next open's `hydrateState` will pick up the last successful
   * persist (which is fine — we trade "always sync" for "best effort").
   *
   * Exposed as a private method (not inline) so the persistence test
   * suite can invoke the handler directly to verify the side effects
   * (timer cleared, persistState called) without needing to mock the
   * `window` global.
   */
  private createTabCloseHandler(): () => void {
    return () => {
      // Cancel any pending debounced persist so we don't double-write
      // (the timer would fire on a destroyed adapter).
      if (this.persistTimeout) {
        clearTimeout(this.persistTimeout);
        this.persistTimeout = null;
      }
      // Synchronously kick off a persist against the current ownerId.
      // If `ownerId` was nulled (e.g. by a concurrent `performDisable`),
      // this is a no-op — we have nothing to save.
      if (this.ownerId) {
        this.persistState(this.ownerId).catch((err) =>
          logger.warn('[OPFS] Failed to persist on tab close:', err),
        );
      }
    };
  }

  /**
   * Instance wrapper for the static `OPFSAdapter.serialize` (renamed from
   * `persistState` in Step 5). Reads `this.fallbackBackend` + `this.*`
   * state and delegates to the static method. The static method does the
   * pure "object → JSON" serialization; the wrapper adds the side effects
   * (reading the adapter's in-memory state, calling the backend).
   */
  private async persistState(ownerId: string): Promise<void> {
    if (!this.fallbackBackend) return;
    await OPFSAdapter.serializeAdapterState(
      this.fallbackBackend,
      ownerId,
      this.fileVersions,
      this.writeQueue,
    );
  }

  /**
   * Instance wrapper for the static `OPFSAdapter.deserializeAdapterState`
   * (renamed from `hydrateState` in Step 5). Reads `this.fallbackBackend`
   * and writes the result into `this.*` state. Called from performEnable()
   * BEFORE syncFromServer() so the version-tracking map is non-empty when
   * the server snapshot arrives — otherwise syncFromServer() would see no
   * pending changes and overwrite the user's offline edits with the older
   * server version.
   */
  private async hydrateState(ownerId: string): Promise<void> {
    if (!this.fallbackBackend) return;
    try {
      const { fileVersions, writeQueue } = await OPFSAdapter.deserializeAdapterState(
        this.fallbackBackend,
        ownerId,
      );
      this.fileVersions = fileVersions;
      this.writeQueue = writeQueue;
      logger.info('[OPFS] Hydrated adapter state from IDB', {
        fileVersions: this.fileVersions.size,
        writeQueue: this.writeQueue.length,
      });
    } catch (err: any) {
      // Non-FILE_NOT_FOUND errors are real IDB issues — log a warning so
      // operators can see the corruption. FILE_NOT_FOUND is already handled
      // inside deserializeAdapterState (returns empty defaults).
      logger.warn('[OPFS] Failed to hydrate adapter state from IDB:', err);
    }
  }

  private async performEnable(ownerId: string, workspaceId: string): Promise<void> {
    // Bug #1 v3 fix (Step 4) v2: set the hydrationPromise SYNCHRONOUSLY at
    // the very top of performEnable, BEFORE any code path that sets
    // `enabled = true` (the OPFS init or `enableFallback`). This closes
    // the bug window where a writeFile landing between the OPFS init's
    // `enabled = true` (early in the function) and the v1
    // hydrationPromise assignment (late in the function, after listener
    // setup) would not be blocked by the guard, and would be CLOBBERED
    // by the hydration that runs immediately after. By setting the
    // promise first, we guarantee that any writeFile that observes
    // `enabled === true` also observes a non-null `hydrationPromise`
    // and awaits it.
    //
    // The promise is stored in a local const to ensure the await below
    // references the same promise that writeFile/deleteFile observe (a
    // future re-enable that re-assigns the field won't break the await).
    //
    // `.catch(() => undefined)` is the canonical pattern (matches the
    // style of `schedulePersist` and `createTabCloseHandler`); the
    // instance `hydrateState` already catches and logs internally, so
    // this only guards against an unexpected throw.
    this.hydrationPromise = this.hydrateState(ownerId).catch(() => undefined);
    const hydrationPromise = this.hydrationPromise;

    try {
      // Try OPFS first
      if (OPFSCore.isSupported()) {
        try {
          // If enabled for a different workspace, we need to reinitialize
          if (this.enabled && this.currentWorkspaceId !== workspaceId) {
            logger.info('[OPFS] Switching workspace', { from: this.currentWorkspaceId, to: workspaceId });
            await this.core.close();
          }

          await this.core.initialize(workspaceId);
          this.enabled = true;
          this.usingFallback = false;
          this.ownerId = ownerId;
          this.currentWorkspaceId = workspaceId;
          logger.info('[OPFS] Enabled with OPFS backend for workspace:', workspaceId);
        } catch (opfsError) {
          // OPFS failed, fall back to IndexedDB
          logger.warn('[OPFS] Initialization failed, falling back to IndexedDB:', opfsError);
          await this.enableFallback(ownerId, workspaceId);
        }
      } else {
        // OPFS not supported, use IndexedDB
        logger.info('[OPFS] Not supported, using IndexedDB fallback');
        await this.enableFallback(ownerId, workspaceId);
      }
    } catch (enableError) {
      this.enableCount = 0;
      this.enabled = false;
      this.pendingEnablePromise = null;
      throw enableError;
    }

    // Set up online/offline handler
    if (typeof window !== 'undefined') {
      this.onlineHandler = () => {
        if (navigator.onLine && this.options.autoSync) {
          this.flushWriteQueue(this.ownerId!).catch(console.error);
        }
      };

      window.addEventListener('online', this.onlineHandler);

      // Bug #1 v2 fix (Step 3): register a pagehide handler that synchronously
      // flushes the 500ms debounced `schedulePersist` so offline edits don't
      // get lost when the user closes the tab faster than the debounce window.
      // Without this, a user who types offline and immediately closes the tab
      // (within 500ms of the last keystroke) would have their `writeQueue` +
      // `fileVersions` map never persisted to IDB — `hydrateState` on the
      // next open would return empty defaults, and `syncFromServer` would
      // overwrite the user's offline edits with the older server version,
      // completely undoing the Bug #1 fix.
      //
      // Cross-browser: also listen to `visibilitychange` because iOS Safari
      // doesn't fire `pagehide` reliably when the tab is backgrounded or
      // the app is sent to the home screen. The `visibilityState === 'hidden'`
      // check matches the "going away" semantic on mobile.
      this.tabCloseHandler = this.createTabCloseHandler();
      window.addEventListener('pagehide', this.tabCloseHandler);

      this.visibilityHandler = () => {
        if (document.visibilityState === 'hidden' && this.tabCloseHandler) {
          this.tabCloseHandler();
        }
      };
      window.addEventListener('visibilitychange', this.visibilityHandler);
    }

    // Start background sync if enabled
    this.startBackgroundSyncLoop();

    // Bug #1 fix: hydrate persisted fileVersions + writeQueue from IDB BEFORE
    // syncFromServer runs. Without this, a tab reopen loses the version map
    // and the next syncFromServer sees no pending changes, then overwrites
    // the user's offline edits with the older server version.
    //
    // Bug #1 v3 fix (Step 4) v2: the `hydrationPromise` was set at the very
    // top of performEnable (BEFORE the OPFS init / enableFallback) so any
    // writeFile/deleteFile that observed `enabled = true` (set inside the
    // OPFS init or enableFallback above) also observed a non-null
    // `hydrationPromise` and awaited it. We just await the local const
    // reference here.
    await hydrationPromise;
    // Clear the field AFTER the await so any writeFile that raced past
    // the `if (this.hydrationPromise)` check while we were awaiting still
    // has a reference to the resolved promise (Promise semantics — a
    // resolved promise stays resolved for all awaiters, even after the
    // field is reassigned).
    this.hydrationPromise = null;

    // Initial sync from server (non-blocking)
    this.syncFromServer(this.ownerId!).catch(err => {
      logger.warn('[OPFS] Initial sync failed:', err);
    });

    logger.info('[OPFS] Enabled for owner', { ownerId, fallback: this.usingFallback });
  }

  /**
   * Enable IndexedDB fallback backend
   */
  private async enableFallback(ownerId: string, workspaceId: string): Promise<void> {
    try {
      if (!IndexedDBBackend.isSupported()) {
        throw new Error('IndexedDB not supported');
      }

      await this.fallbackBackend!.initialize(ownerId);
      this.enabled = true;
      this.usingFallback = true;
      this.ownerId = ownerId;
      this.currentWorkspaceId = workspaceId;
      logger.info('[OPFS] Enabled with IndexedDB fallback for workspace:', workspaceId);
    } catch (fallbackError) {
      logger.error('[OPFS] Fallback to IndexedDB failed:', fallbackError);
      throw new Error(
        `Failed to enable storage backend: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if using fallback backend
   */
  isUsingFallback(): boolean {
    return this.usingFallback;
  }

  /**
   * Start background sync if enabled
   */
  private startBackgroundSyncLoop(): void {
    if (this.options.autoSync && !this.syncInterval) {
      this.syncInterval = setInterval(() => {
        if (this.enabled && this.ownerId) {
          this.syncFromServer(this.ownerId).catch(console.warn);
        }
      }, this.options.autoSyncInterval);
    }
  }

  /**
   * Stop background sync
   */
  private stopBackgroundSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Disable OPFS for current workspace
   * Uses reference counting - only truly disables when all components have called disable()
   */
  async disable(): Promise<void> {
    // If enable() is still in progress, wait for it to complete before disabling
    if (this.pendingEnablePromise) {
      await this.pendingEnablePromise;
    }

    // Guard against negative reference count
    if (this.enableCount <= 0) {
      if (this.enabled) {
        logger.info('[OPFS] disable() called with ref count but still enabled - forcing disable', { refCount: this.enableCount });
        // Force disable since we're in inconsistent state
        this.performDisable();
      } else {
        logger.info('[OPFS] disable() called with non-positive ref count, ignoring');
      }
      return;
    }

    this.enableCount--;

    // Only disable if all components have called disable
    if (this.enableCount > 0) {
      logger.info('[OPFS] Postponing disable, ref count now:', this.enableCount);
      return;
    }

    this.performDisable();
  }

  /**
   * Internal disable implementation
   */
  private performDisable(): void {
    this.enabled = false;
    this.ownerId = null;
    this.currentWorkspaceId = null;
    this.enableCount = 0; // Reset to 0
    this.stopBackgroundSync();

    // Remove event listeners
    if (this.onlineHandler && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
    // Bug #1 v2 fix (Step 3): tear down the pagehide / visibilitychange
    // handlers so a disabled adapter doesn't keep reacting to browser
    // lifecycle events. Without this, a stale closure would still try
    // to persist against a nulled `this.ownerId` (it's a no-op, but
    // wastes a write attempt and clutters logs).
    if (this.tabCloseHandler && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.tabCloseHandler);
      this.tabCloseHandler = null;
    }
    if (this.visibilityHandler && typeof window !== 'undefined') {
      window.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }

    // Close OPFS core (non-blocking)
    this.core.close().catch(err => {
      logger.warn('[OPFS] Failed to close core:', err);
    });
    
    logger.info('[OPFS] Disabled');
  }

  /**
   * Check if OPFS is currently enabled (OPFS or IndexedDB fallback)
   */
  isEnabled(): boolean {
    // When using IndexedDB fallback, the OPFS core won't be initialized,
    // but the adapter IS enabled and functional via the fallback backend.
    if (this.usingFallback) {
      return this.enabled && this.fallbackBackend?.isInitialized() === true;
    }
    return this.enabled && this.core.isInitialized();
  }

  /**
   * Read file with OPFS cache
   * 
   * Strategy:
   * 1. Try OPFS first (instant)
   * 2. Fallback to server if not in OPFS
   * 3. Cache server response in OPFS
   *
   * @param ownerId - Owner identifier
   * @param path - File path
   * @returns VirtualFile with content
   */
  async readFile(ownerId: string, path: string): Promise<VirtualFile> {
    if (!this.enabled) {
      // Fallback to server via API
      const file = await fetchFileFromServer(path);
      if (!file) throw new OPFSError('Failed to read file from server');
      return file;
    }

    // Use IndexedDB fallback when OPFS is unavailable
    if (this.usingFallback && this.fallbackBackend) {
      logger.info('[OPFS] Read from IndexedDB fallback:', path);
      return this.fallbackBackend.readFile(ownerId, path);
    }

    try {
      // Try OPFS first (instant read)
      const opfsFile = await this.core.readFile(path);

      // Get version from tracking
      const versions = this.fileVersions.get(path);

      logger.info('[OPFS] Read cache hit:', path);

      return {
        path,
        content: opfsFile.content,
        language: this.detectLanguage(path),
        lastModified: new Date(opfsFile.lastModified).toISOString(),
        createdAt: new Date(opfsFile.lastModified).toISOString(),
        version: versions?.opfs || 1,
        size: opfsFile.size,
      };
    } catch (error) {
      // Fallback to server via API
      logger.info('[OPFS] Read cache miss, fetching from server:', path);
      const serverFile = await fetchFileFromServer(path);
      
      if (!serverFile) {
        throw new OPFSError('File not found in OPFS or server');
      }

      // Cache in OPFS for next time (non-blocking)
      this.cacheInOPFS(path, serverFile.content).catch(err => {
        logger.warn('[OPFS] Failed to cache file', { path, error: err });
      });

      return serverFile;
    }
  }

  /**
   * Write file with OPFS-first strategy
   * 
   * Strategy:
   * 1. Write to OPFS instantly (1-10ms)
   * 2. Queue server sync (background)
   * 3. Update local state immediately
   * 
   * @param ownerId - Owner identifier
   * @param path - File path
   * @param content - File content
   * @param language - Optional language hint
   * @returns VirtualFile with updated metadata
   */
  async writeFile(
    ownerId: string,
    path: string,
    content: string,
    language?: string
  ): Promise<VirtualFile> {
    // Bug #1 v3 fix (Step 4) v2: if a `hydrateState` call is in progress
    // (i.e., we're inside `performEnable` between `enabled = true` and
    // the hydration's overwrite of `fileVersions`), wait for it to
    // finish. Without this, a writeFile that lands in this window would
    // update `this.fileVersions` and `this.writeQueue`, then the
    // hydration's `this.fileVersions = hydrated` would CLOBBER the
    // just-written entry, silently losing the user's offline edit.
    //
    // The Step 4 v2 fix ensures that `hydrationPromise` is set at the
    // very top of `performEnable` (BEFORE `enabled = true` is set), so
    // any writeFile that observes `enabled === true` also observes a
    // non-null `hydrationPromise`. The await is bounded (~5–20ms for an
    // IDB read) and only affects the FIRST write after enable();
    // subsequent writes see a null `hydrationPromise` and proceed
    // without blocking.
    if (this.hydrationPromise) {
      await this.hydrationPromise;
    }

    if (!this.enabled) {
      // Write directly to server via API
      const success = await writeFileToServer(path, content, language);
      if (!success) throw new OPFSError('Failed to write file to server');

      return {
        path,
        content,
        language: language || this.detectLanguage(path),
        lastModified: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        version: 1,
        size: content.length,
      };
    }

    // Use IndexedDB fallback when OPFS is unavailable
    if (this.usingFallback && this.fallbackBackend) {
      logger.info('[OPFS] Write to IndexedDB fallback:', path);
      const idbFile = await this.fallbackBackend.writeFile(ownerId, path, content, { language });
      // Still queue for server sync even when using IndexedDB
      this.queueWrite(ownerId, path, content, idbFile.version);
      return idbFile;
    }

    // Write to OPFS instantly
    const opfsResult = await this.core.writeFile(path, content);

    // Update version tracking
    const versions = this.fileVersions.get(path) || { opfs: 0, server: 0 };
    versions.opfs++;
    this.fileVersions.set(path, versions);

    // Queue server sync. `queueWrite()` is the SINGLE SOURCE OF TRUTH for
    // scheduling a state persist — it calls `schedulePersist()` after the
    // write is added to the queue. We do NOT call `schedulePersist()`
    // here directly (that would be a redundant debounced write — the
    // 500ms debounce would coalesce them anyway, but it's clearer to
    // have one call site). Bug #1 fix: this is what makes offline edits
    // survive a tab close (the queue + version map are debounce-persisted
    // to IDB, then hydrated by performEnable() on the next tab).
    this.queueWrite(ownerId, path, content, versions.opfs);

    logger.info('[OPFS] Write complete', { path, version: versions.opfs });

    return {
      path,
      content,
      language: language || this.detectLanguage(path),
      lastModified: new Date(opfsResult.lastModified).toISOString(),
      createdAt: new Date(opfsResult.lastModified).toISOString(),
      version: versions.opfs,
      size: opfsResult.size,
    };
  }

  /**
   * Delete file from OPFS
   *
   * @param ownerId - Owner identifier
   * @param path - File path
   */
  async deleteFile(ownerId: string, path: string): Promise<void> {
    // Bug #1 v3 fix (Step 4) v2: guard against the hydration race.
    // A `deleteFile` that lands in the bug window (between
    // `enabled = true` inside enableFallback/OPFS init and the
    // hydration's overwrite) would mutate `this.fileVersions` via
    // `this.fileVersions.delete(path)`, then the hydration's
    // `this.fileVersions = hydratedFileVersions` would CLOBBER it,
    // silently reviving the file in the version map. Awaiting the same
    // promise writeFile awaits closes this window.
    if (this.hydrationPromise) {
      await this.hydrationPromise;
    }

    if (!this.enabled) {
      throw new OPFSError('Delete requires storage backend to be enabled');
    }

    // Use IndexedDB fallback when OPFS is unavailable
    if (this.usingFallback && this.fallbackBackend) {
      logger.info('[OPFS] Delete from IndexedDB fallback:', path);
      await this.fallbackBackend.deleteFile(ownerId, path);
      this.fileVersions.delete(path);
      return;
    }

    // Delete from OPFS
    await this.core.deleteFile(path);

    // Clear version tracking
    this.fileVersions.delete(path);
    // Bug #1 fix: persist the cleared version map to IDB
    this.schedulePersist();
  }

  /**
   * Create directory in OPFS
   *
   * @param path - Directory path
   * @param options - Directory creation options
   */
  async createDirectory(
    path: string,
    options: { recursive?: boolean } = {}
  ): Promise<void> {
    if (!this.enabled) {
      logger.warn('[OPFS] createDirectory called but OPFS not enabled');
      return;
    }

    try {
      await this.core.createDirectory(path, options);
    } catch (error: any) {
      logger.error('[OPFS] createDirectory failed for path:', path, error);
      throw error;
    }
  }

  /**
   * List directory contents from OPFS
   *
   * @param path - Directory path
   * @returns Array of directory entries
   */
  async listDirectory(path: string): Promise<OPFSDirectoryEntry[]> {
    if (!this.enabled) {
      logger.warn('[OPFS] listDirectory called but storage not enabled - returning empty array');
      return [];
    }

    // Use IndexedDB fallback when OPFS is unavailable
    if (this.usingFallback && this.fallbackBackend) {
      logger.info('[OPFS] List directory from IndexedDB fallback:', path);
      const files = await this.fallbackBackend.listDirectory(this.ownerId!, path);
      return files.map((f): OPFSDirectoryEntry => ({
        name: f.path.split('/').pop() || f.path,
        path: f.path,
        type: 'file',
        size: f.size,
        lastModified: Date.parse(f.lastModified),
      }));
    }

    try {
      return await this.core.listDirectory(path);
    } catch (error: any) {
      logger.error('[OPFS] listDirectory failed for path:', path, error);
      // Re-throw to let caller handle (use-opfs.ts logs and returns empty array)
      throw error;
    }
  }

  /**
   * Sync from server to OPFS
   *
   * Downloads all files from server VFS to OPFS cache.
   * Used for initial sync and refresh operations.
   *
   * @param ownerId - Owner identifier
   * @param options - Sync options
   * @returns Sync result with statistics
   */
  async syncFromServer(ownerId: string, options?: SyncOptions): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const conflicts: ConflictInfo[] = [];
    let filesSynced = 0;
    let bytesTransferred = 0;

    try {
      // FIX: Check if using IndexedDB fallback or if OPFS is not initialized
      if (this.usingFallback) {
        logger.info('[OPFS] Skipping sync - using IndexedDB fallback');
        return {
          success: true,
          filesSynced: 0,
          bytesTransferred: 0,
          conflicts: [],
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      // CRITICAL FIX: Initialize OPFS core if not already initialized (prevents "OPFS not initialized" errors)
      if (!this.core.isInitialized()) {
        logger.info('[OPFS] OPFS core not initialized, initializing before sync...');
        // Use tracked workspaceId to maintain consistency with enable() tracking
        const workspaceId = this.currentWorkspaceId ?? ownerId;
        try {
          await this.core.initialize(workspaceId);
          logger.info('[OPFS] Core initialization successful');
        } catch (initError: any) {
          logger.warn('[OPFS] Core initialization failed, enabling IndexedDB fallback:', initError.message);
          // TRULY enable fallback by calling enableFallback to initialize IndexedDB backend
          try {
            await this.enableFallback(ownerId, workspaceId);
            logger.info('[OPFS] IndexedDB fallback enabled successfully');
            // Return immediately to prevent continuing into OPFS writes
            return {
              success: true,
              filesSynced: 0,
              bytesTransferred: 0,
              conflicts: [],
              errors: [],
              duration: Date.now() - startTime,
            };
          } catch (fallbackError: any) {
            logger.error('[OPFS] Failed to enable IndexedDB fallback:', fallbackError.message);
            return {
              success: false,
              filesSynced: 0,
              bytesTransferred: 0,
              conflicts: [],
              errors: [
                `OPFS initialization failed: ${initError.message}`,
                `Fallback initialization failed: ${fallbackError.message}`,
              ],
              duration: Date.now() - startTime,
            };
          }
        }
      }

      // Get server snapshot via API
      const snapshot = await getWorkspaceSnapshot();

      if (!snapshot) {
        return {
          success: false,
          filesSynced: 0,
          bytesTransferred: 0,
          conflicts: [],
          errors: ['Failed to fetch snapshot from server'],
          duration: Date.now() - startTime,
        };
      }

      logger.info('[OPFS] Syncing from server', { count: snapshot.files.length });

      // Sync files from snapshot to OPFS
      for (const file of snapshot.files) {
        // Bail out if adapter was disabled during sync (e.g., React cleanup)
        if (!this.enabled || !this.core.isInitialized()) {
          logger.info('[OPFS] Sync cancelled: adapter no longer enabled');
          return {
            success: true,
            filesSynced,
            bytesTransferred,
            conflicts,
            errors,
            duration: Date.now() - startTime,
            cancelled: true,
          };
        }

        // Check for version conflicts
        const versions = this.fileVersions.get(file.path);
        if (versions && versions.opfs > (file.version || 1)) {
          conflicts.push({
            path: file.path,
            serverVersion: file.version || 1,
            opfsVersion: versions.opfs,
            resolution: 'manual',
          });
          continue;
        }

        // Write to OPFS
        await this.core.writeFile(file.path, file.content);
        filesSynced++;
        bytesTransferred += file.size || 0;

        // Update version tracking
        this.fileVersions.set(file.path, {
          opfs: file.version || 1,
          server: file.version || 1,
        });
      }

      return {
        success: true,
        filesSynced,
        bytesTransferred,
        conflicts,
        errors,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      errors.push(error.message);
      logger.error('[OPFS] Sync from server failed:', error);

      return {
        success: false,
        filesSynced: 0,
        bytesTransferred: 0,
        conflicts,
        errors,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Sync from OPFS to server
   * 
   * Uploads all pending changes from OPFS to server VFS.
   * Primarily used for manual sync triggers.
   * 
   * @param ownerId - Owner identifier
   * @param options - Sync options
   * @returns Sync result with statistics
   */
  async syncToServer(ownerId: string, options?: SyncOptions): Promise<SyncResult> {
    // Bug #4 fix: when using the IndexedDB fallback, `this.core` (OPFSCore)
    // is never initialized. The manual sync path would call this.core.getStats()
    // and this.core.listDirectory() and throw immediately, wedging the sync
    // status overlay and breaking manual sync chains.
    //
    // Bug #4 v2: still actively flush the writeQueue on manual sync so a
    // user-triggered "sync now" actually drains pending writes to the server
    // on demand, instead of waiting for the 30s background sync loop. The
    // previous no-op made manual sync in IDB-fallback mode a silent nothing,
    // which left users wondering why their offline edits weren't syncing
    // after they explicitly clicked the sync button. Returns the number of
    // writes that were drained as `filesSynced` so the caller can show
    // a meaningful "synced N files" toast in the UI.
    //
    // Step 6 fix: distinguish "no work to do" (writeQueue empty) from
    // "sync already in progress" (a concurrent flush is mid-flight). The
    // previous code conflated both cases by computing
    // `filesSynced = queuedBefore - this.writeQueue.length` AFTER calling
    // `flushWriteQueue` — when `flushWriteQueue` early-returns because
    // `syncInProgress` is true, the queue was unchanged and `filesSynced`
    // was 0, indistinguishable from the "nothing to do" case. The caller
    // would show "synced 0 files" instead of "sync in progress, try
    // again". Now we check `syncInProgress` BEFORE calling flushWriteQueue
    // and return `success: false` + `syncInProgress: true` flag, so the
    // caller can either retry, show a "syncing..." spinner, or fall
    // back to the 30s background poll. The flag is the typed signal
    // (discoverable via TypeScript); the `errors[]` is left empty since
    // it's not a "real" error — the sync will complete shortly.
    if (this.usingFallback) {
      const startTime = Date.now();
      // Check syncInProgress FIRST so we return a clear "in progress"
      // signal instead of a misleading "synced 0 files" result.
      if (this.syncInProgress) {
        return {
          success: false,
          filesSynced: 0,
          bytesTransferred: 0,
          errors: [],
          conflicts: [],
          duration: Date.now() - startTime,
          syncInProgress: true,
        };
      }
      const queuedBefore = this.writeQueue.length;
      await this.flushWriteQueue(ownerId);
      const filesSynced = queuedBefore - this.writeQueue.length;
      return {
        success: true,
        filesSynced,
        bytesTransferred: 0, // IDB writes don't track byte count here
        errors: [],
        conflicts: [],
        duration: Date.now() - startTime,
      };
    }

    const startTime = Date.now();
    const errors: string[] = [];
    const conflicts: ConflictInfo[] = [];
    let filesSynced = 0;
    let bytesTransferred = 0;

    try {
      // Flush write queue first
      await this.flushWriteQueue(ownerId);

      // Get OPFS stats
      const stats = await this.core.getStats();

      logger.info('[OPFS] Syncing to server. Stats:', stats);

      // Walk OPFS tree and sync files that differ from server
      await this.syncOPFSToServerRecursive(
        ownerId,
        '',
        options,
        errors,
        conflicts,
        { filesSynced, bytesTransferred }
      );

      logger.info('[OPFS] Sync to server complete', { count: filesSynced });

      return {
        success: errors.length === 0 && conflicts.length === 0,
        filesSynced,
        bytesTransferred,
        conflicts,
        errors,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      errors.push(error.message);
      logger.error('[OPFS] Sync to server failed:', error);
      
      return {
        success: false,
        filesSynced: 0,
        bytesTransferred: 0,
        conflicts: [],
        errors,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Queue a write for background server sync
   */
  queueWrite(ownerId: string, path: string, content: string, version: number): void {
    // Bug #1 fix: persist after queueing a write
    this.schedulePersist();

    // Check queue size limit
    if (this.writeQueue.length >= this.options.maxQueueSize) {
      // Remove oldest entry
      this.writeQueue.shift();
    }

    this.writeQueue.push({
      id: `write_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      path,
      content,
      timestamp: Date.now(),
      synced: false,
      ownerId,
      version,
    });

    logger.info('[OPFS] Queued write', { path, queueSize: this.writeQueue.length });

    // Trigger immediate sync if queue is small
    if (this.writeQueue.length <= 5) {
      this.flushWriteQueue(ownerId).catch(console.error);
    }
  }

  /**
   * Flush write queue to server
   */
  async flushWriteQueue(ownerId: string): Promise<void> {
    if (this.syncInProgress || this.writeQueue.length === 0) {
      return;
    }

    this.syncInProgress = true;

    try {
      const pendingWrites = this.writeQueue.filter(w => !w.synced);

      logger.info('[OPFS] Flushing pending writes to server', { count: pendingWrites.length });

      for (const write of pendingWrites) {
        try {
          const success = await writeFileToServer(write.path, write.content);

          if (success) {
            // Update version tracking (server caught up)
            const versions = this.fileVersions.get(write.path) || { opfs: 0, server: 0 };
            versions.server = versions.opfs;
            this.fileVersions.set(write.path, versions);

            write.synced = true;

            logger.info('[OPFS] Synced to server:', write.path);
          }
        } catch (error: any) {
          logger.error('[OPFS] Failed to sync to server:', write.path, error);
        }
      }

      // Remove synced writes from queue
      this.writeQueue = this.writeQueue.filter(w => !w.synced);

      // Bug #1 fix: persist the trimmed queue to IDB (synced writes removed)
      this.schedulePersist();

      // Update last sync time
      this.lastSyncTime.set(ownerId, Date.now());
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Get pending changes count
   */
  getPendingChangesCount(): number {
    return this.writeQueue.filter(w => !w.synced).length;
  }

  /**
   * Get sync status
   */
  getSyncStatus(): SyncStatus {
    const lastSync = this.lastSyncTime.values().next().value || null;
    
    return {
      isSyncing: this.syncInProgress,
      pendingChanges: this.getPendingChangesCount(),
      lastSyncTime: lastSync,
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      hasConflicts: false, // Would need to track conflicts separately
      opfsSupported: OPFSCore.isSupported(),
    };
  }

  /**
   * Get file version info
   */
  getFileVersions(path: string): { opfs: number; server: number } | null {
    return this.fileVersions.get(path) || null;
  }

  /**
   * Clear all version tracking
   */
  clearVersionTracking(): void {
    this.fileVersions.clear();
  }

  // ========== Private Methods ==========

  private startBackgroundSync(): void {
    this.stopBackgroundSync(); // Clear any existing interval

    this.syncInterval = setInterval(() => {
      if (navigator.onLine && this.writeQueue.length > 0 && this.ownerId) {
        this.flushWriteQueue(this.ownerId).catch(console.error);
      }
    }, this.options.autoSyncInterval);

    logger.info('[OPFS] Background sync started', { intervalMs: this.options.autoSyncInterval });
  }

  private async cacheInOPFS(path: string, content: string): Promise<void> {
    try {
      await this.core.writeFile(path, content);
    } catch (error) {
      logger.warn('[OPFS] Failed to cache file', { path, error });
    }
  }

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      java: 'java',
      cs: 'csharp',
      cpp: 'cpp',
      c: 'c',
      go: 'go',
      rs: 'rust',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      xml: 'xml',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      sh: 'bash',
      sql: 'sql',
    };
    return languageMap[ext || ''] || 'text';
  }

  private shouldIncludeFile(
    path: string,
    options?: SyncOptions
  ): boolean {
    if (!options) return true;

    // Check exclude patterns first
    if (options.excludePatterns) {
      for (const pattern of options.excludePatterns) {
        if (this.matchesPattern(path, pattern)) {
          return false;
        }
      }
    }

    // Check include patterns
    if (options.includePatterns) {
      for (const pattern of options.includePatterns) {
        if (this.matchesPattern(path, pattern)) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  private matchesPattern(path: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  private async syncOPFSToServerRecursive(
    ownerId: string,
    path: string,
    options: SyncOptions | undefined,
    errors: string[],
    conflicts: ConflictInfo[],
    stats: { filesSynced: number; bytesTransferred: number }
  ): Promise<void> {
    try {
      const entries = await this.core.listDirectory(path || '.');

      for (const entry of entries) {
        if (entry.type === 'file') {
          // Check include/exclude patterns
          if (!this.shouldIncludeFile(entry.path, options)) {
            continue;
          }

          // Check version tracking
          const versions = this.fileVersions.get(entry.path);
          if (versions && versions.opfs <= versions.server) {
            // Already in sync
            continue;
          }

          // Read from OPFS and write to server via API
          const opfsFile = await this.core.readFile(entry.path);

          try {
            const success = await writeFileToServer(entry.path, opfsFile.content);

            if (success) {
              // Update version tracking
              if (versions) {
                versions.server = versions.opfs;
                this.fileVersions.set(entry.path, versions);
              }

              stats.filesSynced++;
              stats.bytesTransferred += opfsFile.size;

              logger.info('[OPFS] Synced to server:', entry.path);
            }
          } catch (error: any) {
            errors.push(`Failed to sync ${entry.path}: ${error.message}`);
          }
        } else if (entry.type === 'directory') {
          // Skip hidden directories
          if (!entry.name.startsWith('.')) {
            await this.syncOPFSToServerRecursive(
              ownerId,
              entry.path,
              options,
              errors,
              conflicts,
              stats
            );
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'NotFoundError') {
        errors.push(`Failed to list directory ${path}: ${error.message}`);
      }
    }
  }
}

// Type export for directory entries
export interface OPFSDirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: number;
}

/**
 * Structural interface for the state-persistence backend. The IndexedDB
 * backend satisfies it natively; tests can inject an in-memory mock
 * without standing up a real IndexedDB or OPFS environment. Minimal
 * subset of the IndexedDBBackend API used by serialize /
 * deserializeAdapterState. Step 7 also added `deleteFile` so production
 * code can clear the `.vfs-adapter-state.json` on workspace switch
 * (the IndexedDBBackend has had this since day one; the interface just
 * wasn't exposing it). Defined at module scope (NOT nested in the class)
 * so the test file can import it directly as `type StateStorageBackend`.
 */
export interface StateStorageBackend {
  writeFile(
    ownerId: string,
    path: string,
    content: string,
    options?: { version?: number; language?: string },
  ): Promise<unknown>;
  readFile(
    ownerId: string,
    path: string,
  ): Promise<{ content?: string }>;
  /**
   * Step 7: delete a file by (ownerId, path) key. Production code uses
   * this to clear the `.vfs-adapter-state.json` when switching workspaces
   * (e.g. user logs out, workspace is deleted). The IndexedDBBackend
   * implements this natively; the mock IDB in the test suite
   * implements it in-memory. The instance `OPFSAdapter.deleteFile`
   * already calls `this.fallbackBackend.deleteFile` directly, but
   * exposing it on the interface makes the mock setup symmetric with
   * the production code (no need for `(mockIDB as any).deleteFile = ...`
   * casts in the tests).
   */
  deleteFile(
    ownerId: string,
    path: string,
  ): Promise<void>;
}

// Singleton instance
export const opfsAdapter = new OPFSAdapter();
