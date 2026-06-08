/**
 * Unit tests for WorkspaceControlPlane
 *
 * Tests the two-layer API:
 * - WorkspaceControlPlane (facade) — init, create, get, list, register, state, destroy
 * - WorkspaceHandleImpl (handle) — runtime, services, graph, affinity, snapshots, execute, migrate
 *
 * All external dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkspaceHandle } from '../workspace-control-plane';

// ============================================================================
// Mock data factories (defined before vi.mock to avoid hoisting issues)
// ============================================================================

const {
  mockGetSandbox,
  mockGetSession,
  mockMigrateSession,
  mockExecuteInSandbox,
  mockGetAffinity,
  mockGetAffinityStats,
  mockGetAffinityConfig,
  mockEvictAffinity,
  mockCreateSnapshot,
  mockHasSnapshot,
  mockRestoreSnapshot,
  mockDeleteSnapshot,
  mockGetSnapshot,
  mockSnapshotGetStats,
  mockSnapshotGetConfig,
  mockCreateService,
  mockListServices,
  mockClearWorkspace,
  mockGetWorkspaceGraph,
  mockNotifyGraphChanged,
  mockCloseWorkspaceSessions,
  mockRegisterSession,
  mockGetWorkspaceRuntime,
  mockHydrate,
  mockGetEnv,
  mockSetEnv,
  mockBuildShellEnv,
  mockGetWorkspaceState,
  mockStartSync,
  mockStopSync,
  mockSyncGetConfig,
  mockGetR2Status,
  mockIsEnabled,
  mockImageGetStats,
} = vi.hoisted(() => ({
  // Sandbox orchestrator
  mockGetSandbox: vi.fn(),
  mockGetSession: vi.fn(),
  mockMigrateSession: vi.fn(),
  mockExecuteInSandbox: vi.fn(),
  mockGetAffinity: vi.fn(),
  mockGetAffinityStats: vi.fn(),
  mockGetAffinityConfig: vi.fn().mockReturnValue({ enabled: true, ttlMs: 300_000 }),
  mockEvictAffinity: vi.fn(),

  // Snapshot service
  mockCreateSnapshot: vi.fn(),
  mockHasSnapshot: vi.fn(),
  mockRestoreSnapshot: vi.fn(),
  mockDeleteSnapshot: vi.fn(),
  mockGetSnapshot: vi.fn(),
  mockSnapshotGetStats: vi.fn(),
  mockSnapshotGetConfig: vi.fn().mockReturnValue({ enabled: true }),

  // Image registry
  mockImageGetStats: vi.fn(),
  mockIsEnabled: vi.fn().mockReturnValue(true),

  // VFS sync service
  mockSyncGetConfig: vi.fn().mockReturnValue({ enabled: true }),
  mockGetR2Status: vi.fn().mockReturnValue({ configured: true }),
  mockStartSync: vi.fn(),
  mockStopSync: vi.fn(),

  // Service manager
  mockCreateService: vi.fn(),
  mockListServices: vi.fn(),
  mockClearWorkspace: vi.fn(),

  // Workspace graph
  mockGetWorkspaceGraph: vi.fn(),
  mockNotifyGraphChanged: vi.fn(),

  // Session graph
  mockCloseWorkspaceSessions: vi.fn(),
  mockRegisterSession: vi.fn(),

  // Runtime service
  mockGetWorkspaceRuntime: vi.fn(),
  mockHydrate: vi.fn().mockResolvedValue(undefined),
  mockGetEnv: vi.fn(),
  mockSetEnv: vi.fn(),
  mockBuildShellEnv: vi.fn(),
  mockGetWorkspaceState: vi.fn(),
}));

function createMockOrchestratorSession(overrides: Record<string, any> = {}) {
  return {
    sessionId: 'sandbox-abc123',
    logicalId: 'ws-1',
    provider: 'daytona' as const,
    handle: {
      workspaceDir: '/workspace/users/test-user/workspaces/ws-1',
    },
    ...overrides,
  };
}

function createMockService(overrides: Record<string, any> = {}) {
  return {
    id: 'svc-1',
    name: 'dev-server',
    command: 'npm run dev',
    status: 'running',
    ...overrides,
  };
}

function createMockSnapshot(overrides: Record<string, any> = {}) {
  return {
    workspaceId: 'ws-1',
    userId: 'test-user',
    sourceProvider: 'daytona',
    sourceSandboxId: 'sandbox-abc123',
    workspaceDir: '/workspace',
    createdAt: Date.now() - 60000,
    checkpointId: 'cp-abc123',
    ...overrides,
  };
}

function createMockMigrationResult(success: boolean, overrides: Record<string, any> = {}) {
  return {
    success,
    fromProvider: 'daytona',
    toProvider: success ? 'sprites' : 'unknown',
    reason: 'policy_change',
    duration: success ? 1500 : 0,
    ...overrides,
  };
}

// ============================================================================
// Mock dependencies (vi.mock is hoisted)
// ============================================================================

vi.mock('@/lib/sandbox/sandbox-orchestrator', () => ({
  sandboxOrchestrator: {
    getSandbox: mockGetSandbox,
    getSession: mockGetSession,
    migrateSession: mockMigrateSession,
    executeInSandbox: mockExecuteInSandbox,
    getAffinity: mockGetAffinity,
    getAffinityStats: mockGetAffinityStats,
    getAffinityConfig: mockGetAffinityConfig,
    evictAffinity: mockEvictAffinity,
  },
}));

vi.mock('@/lib/sandbox/workspacefs-snapshot-service', () => ({
  workspaceFSSnapshotService: {
    createSnapshot: mockCreateSnapshot,
    hasSnapshot: mockHasSnapshot,
    restoreSnapshot: mockRestoreSnapshot,
    deleteSnapshot: mockDeleteSnapshot,
    getSnapshot: mockGetSnapshot,
    getStats: mockSnapshotGetStats,
    getConfig: mockSnapshotGetConfig,
  },
}));

vi.mock('@/lib/sandbox/workspace-image-registry', () => ({
  workspaceImageRegistry: {
    getStats: mockImageGetStats,
    isEnabled: mockIsEnabled,
  },
}));

vi.mock('@/lib/sandbox/workspacefs-sync-service', () => ({
  workspaceFSSyncService: {
    getConfig: mockSyncGetConfig,
    getR2Status: mockGetR2Status,
  },
}));

vi.mock('@/lib/terminal/workspace-service-manager', () => ({
  workspaceServiceManager: {
    createService: mockCreateService,
    listServices: mockListServices,
    clearWorkspace: mockClearWorkspace,
  },
}));

vi.mock('@/lib/terminal/workspace-runtime-service', () => ({
  getWorkspaceRuntime: mockGetWorkspaceRuntime,
  cleanupWorkspaceRuntimeState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../workspace-graph-service', () => ({
  workspaceGraphService: {
    getWorkspaceGraph: mockGetWorkspaceGraph,
    notifyGraphChanged: mockNotifyGraphChanged,
  },
}));

vi.mock('../workspace-session-graph', () => ({
  workspaceSessionGraph: {
    closeWorkspaceSessions: mockCloseWorkspaceSessions,
    registerSession: mockRegisterSession,
  },
}));

vi.mock('@/lib/virtual-filesystem/sync', () => ({
  sandboxFilesystemSync: {
    stopSync: mockStopSync,
    startSync: mockStartSync,
  },
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { WorkspaceControlPlane, workspaceControlPlane } from '../workspace-control-plane';
import { EventEmitter } from 'events';

describe('WorkspaceControlPlane', () => {
  let controlPlane: WorkspaceControlPlane;

  beforeEach(() => {
    vi.clearAllMocks();
    controlPlane = new WorkspaceControlPlane();
    // Default runtime mock (needed by create())
    mockGetWorkspaceRuntime.mockReturnValue({
      hydrate: mockHydrate,
      setEnv: mockSetEnv,
      getEnv: mockGetEnv,
      buildShellEnv: mockBuildShellEnv,
      getWorkspaceState: mockGetWorkspaceState,
    });
  });

  afterEach(async () => {
    // Clean up any handles to avoid leaking the 5-min cleanup timer
    for (const wsId of controlPlane.list()) {
      await controlPlane.destroy(wsId);
    }
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    it('extends EventEmitter', () => {
      expect(controlPlane).toBeInstanceOf(EventEmitter);
    });

    it('starts with empty state', () => {
      expect(controlPlane.list()).toEqual([]);
      expect(controlPlane.get('nonexistent')).toBeNull();
    });
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('singleton', () => {
    it('exports a singleton instance', () => {
      expect(workspaceControlPlane).toBeDefined();
      expect(workspaceControlPlane).toBeInstanceOf(WorkspaceControlPlane);
    });
  });

  // ==========================================================================
  // initialize()
  // ==========================================================================

  describe('initialize', () => {
    it('returns control plane state and marks as initialized', async () => {
      mockImageGetStats.mockReturnValue({ totalImages: 3, enabled: true });
      mockSnapshotGetStats.mockReturnValue({ totalSnapshots: 0, activeSnapshots: 0 });
      mockSyncGetConfig.mockReturnValue({ enabled: true });
      mockGetR2Status.mockReturnValue({ configured: true });
      mockGetAffinityConfig.mockReturnValue({ enabled: true, ttlMs: 300_000 });
      mockGetWorkspaceGraph.mockReturnValue({ nodes: [], edges: [] });

      const state = await controlPlane.initialize();

      expect(state.activeWorkspaces).toBe(0);
      expect(state.workspaceIds).toEqual([]);
    });

    it('is idempotent — returns cached state on second call', async () => {
      mockImageGetStats.mockReturnValue({ totalImages: 3, enabled: true });
      mockSnapshotGetStats.mockReturnValue({ totalSnapshots: 0, activeSnapshots: 0 });
      mockSyncGetConfig.mockReturnValue({ enabled: true });
      mockGetR2Status.mockReturnValue({ configured: true });
      mockGetAffinityConfig.mockReturnValue({ enabled: true, ttlMs: 300_000 });
      mockGetWorkspaceGraph.mockReturnValue({ nodes: [], edges: [] });

      await controlPlane.initialize();

      // Reset call counts — second initialize should only call getState internals
      vi.clearAllMocks();

      const state = await controlPlane.initialize();

      // getState() calls snapshotGetStats and getAffinityStats — those should be called
      expect(mockSnapshotGetStats).toHaveBeenCalledOnce();
      expect(mockGetAffinityStats).toHaveBeenCalledOnce();
      // Phase init calls should NOT be called again
      expect(mockImageGetStats).not.toHaveBeenCalled();
      expect(mockGetWorkspaceGraph).not.toHaveBeenCalled();
      expect(state.activeWorkspaces).toBe(0);
    });

    it('handles phase initialization errors gracefully', async () => {
      // Make Phase 5 (CAS) fail by not mocking it — the dynamic import will fail
      // in the test environment. All other phases should succeed.
      mockImageGetStats.mockReturnValue({ totalImages: 3, enabled: true });
      mockSnapshotGetStats.mockReturnValue({ totalSnapshots: 0, activeSnapshots: 0 });
      mockSyncGetConfig.mockReturnValue({ enabled: true });
      mockGetR2Status.mockReturnValue({ configured: true });
      mockGetAffinityConfig.mockReturnValue({ enabled: true, ttlMs: 300_000 });
      mockGetWorkspaceGraph.mockReturnValue({ nodes: [], edges: [] });

      // Should not throw — errors are caught per-phase
      const state = await controlPlane.initialize();
      expect(state.activeWorkspaces).toBe(0);
    });
  });

  // ==========================================================================
  // create()
  // ==========================================================================

  describe('create', () => {
    const wsId = 'ws-test-1';
    const userId = 'test-user';

    beforeEach(() => {
      mockGetSandbox.mockResolvedValue(createMockOrchestratorSession({ logicalId: wsId }));
      mockHasSnapshot.mockReturnValue(false);
      mockHydrate.mockResolvedValue(undefined);
    });

    it('creates a workspace and returns a WorkspaceHandle', async () => {
      const handle = await controlPlane.create(wsId, userId);

      expect(handle.workspaceId).toBe(wsId);
      expect(handle.userId).toBe(userId);
      expect(handle.phase).toBe('ready');
      expect(handle.provider).toBe('daytona');
      expect(handle.sandboxId).toBe('sandbox-abc123');
      expect(handle.workspaceDir).toBe('/workspace/users/test-user/workspaces/ws-1');
    });

    it('registers the handle internally', async () => {
      const handle = await controlPlane.create(wsId, userId);

      expect(controlPlane.get(wsId)).toBe(handle);
      expect(controlPlane.list()).toEqual([wsId]);
    });

    it('initializes env vars when provided in options', async () => {
      await controlPlane.create(wsId, userId, {
        env: { NODE_ENV: 'development', PORT: '3000' },
      });

      expect(mockSetEnv).toHaveBeenCalledWith('NODE_ENV', 'development');
      expect(mockSetEnv).toHaveBeenCalledWith('PORT', '3000');
    });

    it('restores snapshot if one exists', async () => {
      mockHasSnapshot.mockReturnValue(true);
      mockRestoreSnapshot.mockResolvedValue(undefined);

      await controlPlane.create(wsId, userId);
      expect(mockRestoreSnapshot).toHaveBeenCalled();
    });

    it('handles snapshot restore failure gracefully', async () => {
      mockHasSnapshot.mockReturnValue(true);
      mockRestoreSnapshot.mockRejectedValue(new Error('Snapshot restore failed'));

      const handle = await controlPlane.create(wsId, userId);
      expect(handle.phase).toBe('ready');
    });

    it('emits workspace:created event', async () => {
      const emitSpy = vi.spyOn(controlPlane, 'emit');
      await controlPlane.create(wsId, userId);

      expect(emitSpy).toHaveBeenCalledWith('workspace:created', expect.any(Object));
    });

    it('sets phase to error and throws on sandbox creation failure', async () => {
      mockGetSandbox.mockRejectedValue(new Error('Provider unavailable'));

      await expect(controlPlane.create(wsId, userId)).rejects.toThrow('Provider unavailable');
      expect(controlPlane.get(wsId)).toBeNull();
    });
  });

  // ==========================================================================
  // get() / list()
  // ==========================================================================

  describe('get / list', () => {
    it('returns null for nonexistent workspace', () => {
      expect(controlPlane.get('nonexistent')).toBeNull();
    });

    it('returns handle for created workspace', async () => {
      mockGetSandbox.mockResolvedValue(createMockOrchestratorSession());
      await controlPlane.create('ws-1', 'user-1');

      const handle = controlPlane.get('ws-1');
      expect(handle).not.toBeNull();
      expect(handle!.workspaceId).toBe('ws-1');
    });

    it('lists active workspace IDs', async () => {
      mockGetSandbox.mockResolvedValue(createMockOrchestratorSession());
      await controlPlane.create('ws-1', 'user-1');
      await controlPlane.create('ws-2', 'user-2');

      expect(controlPlane.list()).toEqual(['ws-1', 'ws-2']);
    });
  });

  // ==========================================================================
  // register()
  // ==========================================================================

  describe('register', () => {
    it('registers a lightweight handle without creating sandbox', () => {
      const handle = controlPlane.register('ws-pre-existing', 'test-user', {
        provider: 'sprites',
        sandboxId: 'sb-existing',
        workspaceDir: '/workspace/test',
      });

      expect(handle.workspaceId).toBe('ws-pre-existing');
      expect(handle.provider).toBe('sprites');
      expect(handle.sandboxId).toBe('sb-existing');
      expect(handle.workspaceDir).toBe('/workspace/test');
      expect(handle.phase).toBe('ready');
      expect(mockGetSandbox).not.toHaveBeenCalled();
    });

    it('returns existing handle if already registered', () => {
      const handle1 = controlPlane.register('ws-1', 'test-user', {
        provider: 'sprites',
        sandboxId: 'sb-1',
      });
      const handle2 = controlPlane.register('ws-1', 'test-user', {
        provider: 'daytona',
      });

      expect(handle1).toBe(handle2);
      expect(handle1.provider).toBe('daytona');
    });

    it('emits workspace:registered event', () => {
      const emitSpy = vi.spyOn(controlPlane, 'emit');
      controlPlane.register('ws-event-test', 'test-user', { provider: 'sprites' });
      expect(emitSpy).toHaveBeenCalledWith('workspace:registered', expect.any(Object));
    });
  });

  // ==========================================================================
  // getState()
  // ==========================================================================

  describe('getState', () => {
    it('returns control plane state with active workspace count', async () => {
      mockGetSandbox.mockResolvedValue(createMockOrchestratorSession());
      mockGetAffinityStats.mockReturnValue({ activeBindings: 1, totalMigrations: 2 });
      mockSnapshotGetStats.mockReturnValue({ totalSnapshots: 3, activeSnapshots: 1 });
      mockGetAffinityConfig.mockReturnValue({ enabled: true, ttlMs: 300_000 });

      await controlPlane.create('ws-1', 'user-1');
      await controlPlane.create('ws-2', 'user-2');

      const state = controlPlane.getState();
      expect(state.activeWorkspaces).toBe(2);
      expect(state.workspaceIds).toEqual(['ws-1', 'ws-2']);
      expect(state.phases.affinity).toBe(true);
    });
  });

  // ==========================================================================
  // destroy()
  // ==========================================================================

  describe('destroy', () => {
    it('destroys a workspace handle by ID', async () => {
      mockGetSandbox.mockResolvedValue(createMockOrchestratorSession());
      await controlPlane.create('ws-1', 'user-1');
      expect(controlPlane.get('ws-1')).not.toBeNull();

      await controlPlane.destroy('ws-1');
      expect(controlPlane.get('ws-1')).toBeNull();
    });

    it('is a no-op for nonexistent workspace', async () => {
      await expect(controlPlane.destroy('nonexistent')).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // WorkspaceHandleImpl
  // ==========================================================================

  describe('WorkspaceHandleImpl', () => {
    let handle: WorkspaceHandle;

    beforeEach(async () => {
      vi.clearAllMocks();
      mockGetSandbox.mockResolvedValue(createMockOrchestratorSession({ logicalId: 'ws-handle-test' }));
      mockGetWorkspaceRuntime.mockReturnValue({
        hydrate: mockHydrate,
        setEnv: mockSetEnv,
        getEnv: mockGetEnv,
        buildShellEnv: mockBuildShellEnv,
        getWorkspaceState: mockGetWorkspaceState,
      });
      handle = await controlPlane.create('ws-handle-test', 'test-user');
    });

    // ========================================================================
    // Runtime State (Phase 2)
    // ========================================================================

    describe('runtime state (Phase 2)', () => {
      it('getState delegates to getWorkspaceRuntime', () => {
        const mockState = { processes: [], env: { KEY: 'val' } };
        mockGetWorkspaceState.mockReturnValue(mockState);
        mockGetWorkspaceRuntime.mockReturnValue({ getWorkspaceState: mockGetWorkspaceState });

        const state = handle.getState();
        expect(state).toBe(mockState);
      });

      it('getEnv delegates to getWorkspaceRuntime', () => {
        mockGetEnv.mockReturnValue('some-value');
        mockGetWorkspaceRuntime.mockReturnValue({ getEnv: mockGetEnv });

        expect(handle.getEnv('MY_VAR')).toBe('some-value');
      });

      it('setEnv delegates to getWorkspaceRuntime', () => {
        mockGetWorkspaceRuntime.mockReturnValue({ setEnv: mockSetEnv });
        handle.setEnv('PORT', '8080');
        expect(mockSetEnv).toHaveBeenCalledWith('PORT', '8080');
      });

      it('buildShellEnv delegates to getWorkspaceRuntime', () => {
        mockBuildShellEnv.mockReturnValue(['export PORT=8080']);
        mockGetWorkspaceRuntime.mockReturnValue({ buildShellEnv: mockBuildShellEnv });

        expect(handle.buildShellEnv()).toEqual(['export PORT=8080']);
      });
    });

    // ========================================================================
    // Workspace Graph (Phase 10)
    // ========================================================================

    describe('workspace graph (Phase 10)', () => {
      it('getGraph returns workspace graph', () => {
        const mockGraph = { nodes: [], edges: [] } as any;
        mockGetWorkspaceGraph.mockReturnValue(mockGraph);

        expect(handle.getGraph()).toBe(mockGraph);
        expect(mockGetWorkspaceGraph).toHaveBeenCalledWith('ws-handle-test');
      });
    });

    // ========================================================================
    // Services (Phase 4)
    // ========================================================================

    describe('services (Phase 4)', () => {
      it('startService creates a new service', () => {
        const mockSvc = createMockService();
        mockCreateService.mockReturnValue(mockSvc);

        const svc = handle.startService('npm run dev', '/workspace/app');
        expect(svc).toBe(mockSvc);
        expect(mockCreateService).toHaveBeenCalledWith('ws-handle-test', 'test-user', 'npm run dev', '/workspace/app');
      });

      it('listServices returns workspace services', () => {
        const mockServices = [createMockService()];
        mockListServices.mockReturnValue(mockServices);

        expect(handle.listServices()).toEqual(mockServices);
      });
    });

    // ========================================================================
    // Affinity (Phase 6)
    // ========================================================================

    describe('affinity (Phase 6)', () => {
      it('getAffinity returns null if no binding', () => {
        mockGetAffinity.mockReturnValue(null);
        expect(handle.getAffinity()).toBeNull();
      });

      it('getAffinity returns binding if active', () => {
        const mockBinding = { provider: 'daytona', sessionId: 'sb-1' };
        mockGetAffinity.mockReturnValue(mockBinding);

        expect(handle.getAffinity()).toEqual(mockBinding);
      });
    });

    // ========================================================================
    // Snapshots (Phase 7)
    // ========================================================================

    describe('snapshots (Phase 7)', () => {
      it('snapshot creates a new snapshot', async () => {
        const mockSnap = createMockSnapshot();
        mockCreateSnapshot.mockResolvedValue(mockSnap);

        expect(await handle.snapshot()).toBe(mockSnap);
      });

      it('snapshot returns null on failure', async () => {
        mockCreateSnapshot.mockResolvedValue(null);
        expect(await handle.snapshot()).toBeNull();
      });

      it('hasSnapshot checks if snapshot exists', () => {
        mockHasSnapshot.mockReturnValue(true);
        expect(handle.hasSnapshot()).toBe(true);
        expect(mockHasSnapshot).toHaveBeenCalledWith('ws-handle-test');
      });
    });

    // ========================================================================
    // Execution (Phase 8)
    // ========================================================================

    describe('execution (Phase 8)', () => {
      it('execute runs a command in the sandbox', async () => {
        const mockResult = { output: 'hello', exitCode: 0, duration: 100 };
        mockExecuteInSandbox.mockResolvedValue(mockResult);

        expect(await handle.execute('echo hello')).toEqual(mockResult);
      });
    });

    // ========================================================================
    // Migration
    // ========================================================================

    describe('migrate', () => {
      it('migrates successfully and updates handle state', async () => {
        mockMigrateSession.mockResolvedValue(createMockMigrationResult(true));
        mockGetSession.mockResolvedValue(createMockOrchestratorSession({
          provider: 'sprites',
          sessionId: 'sb-new',
          handle: { workspaceDir: '/workspace/new' },
        }));

        const result = await handle.migrate();
        expect(result.success).toBe(true);
        expect(handle.provider).toBe('sprites');
        expect(handle.sandboxId).toBe('sb-new');
        expect(handle.phase).toBe('ready');
      });

      it('handles migration failure gracefully', async () => {
        mockMigrateSession.mockRejectedValue(new Error('Migration failed'));

        const result = await handle.migrate();
        expect(result.success).toBe(false);
        expect(typeof result.error).toBe('string');
        expect(handle.phase).toBe('error');
      });
    });

    // ========================================================================
    // Destroy (Lifecycle)
    // ========================================================================

    describe('destroy', () => {
      it('cleans up all phases and removes from registry', async () => {
        await handle.destroy();

        expect(mockEvictAffinity).toHaveBeenCalledWith('ws-handle-test');
        expect(mockStopSync).toHaveBeenCalledWith('sandbox-abc123');
        expect(mockClearWorkspace).toHaveBeenCalledWith('ws-handle-test');
        expect(mockDeleteSnapshot).toHaveBeenCalledWith('ws-handle-test');
        expect(mockCloseWorkspaceSessions).toHaveBeenCalledWith('ws-handle-test');
        expect(handle.phase).toBe('destroyed');
      });

      it('handles partial cleanup errors without throwing', async () => {
        mockEvictAffinity.mockImplementation(() => { throw new Error('Affinity error'); });

        await handle.destroy();
        expect(handle.phase).toBe('destroyed');
        // Still removed from registry
        expect(controlPlane.get('ws-handle-test')).toBeNull();
      });
    });
  });
});
