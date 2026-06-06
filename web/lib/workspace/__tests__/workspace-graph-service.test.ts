/**
 * Unit tests for WorkspaceGraphService
 *
 * Tests the three public methods:
 * - getWorkspaceGraph(workspaceId) — full graph aggregation
 * - getServiceDiagnostic(workspaceId, serviceId) — focused diagnostic
 * - findProcesses(workspaceId, pattern) — process search
 *
 * All registry dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock data factories (defined before vi.mock to avoid hoisting issues)
// ============================================================================

const { mockGetProcessList, mockListServices, mockGetWorkspacePreviews, mockGetSnapshot, mockGetStats } = vi.hoisted(() => ({
  mockGetProcessList: vi.fn(),
  mockListServices: vi.fn(),
  mockGetWorkspacePreviews: vi.fn(),
  mockGetSnapshot: vi.fn(),
  mockGetStats: vi.fn(),
}));

function createMockProcess(overrides: Record<string, any> = {}) {
  return {
    vPid: 100,
    realPid: 42,
    provider: 'sandbox-provider',
    sandboxId: 'sandbox-1',
    workspaceId: 'ws-test',
    command: 'npm run dev',
    user: 'test-user',
    registeredAt: Date.now() - 5000,
    lastConfirmedAt: Date.now() - 1000,
    isService: false,
    serviceId: undefined,
    ...overrides,
  };
}

function createMockService(overrides: Record<string, any> = {}) {
  return {
    id: 'svc-test-1',
    name: 'dev-server',
    command: 'npm run dev',
    workingDir: '/workspace',
    status: 'running',
    ports: [],
    pid: 100,
    provider: 'sandbox-provider',
    startedAt: Date.now() - 5000,
    lastActivityAt: Date.now() - 1000,
    exitCode: undefined,
    autoRestart: false,
    sandboxProvider: 'sprites',
    sandboxId: 'sandbox-1',
    logs: [],
    workspaceId: 'ws-test',
    userId: 'test-user',
    ...overrides,
  };
}

function createMockPreview(overrides: Record<string, any> = {}) {
  return {
    id: 'preview-1',
    workspaceId: 'ws-test',
    serviceId: 'svc-test-1',
    serviceName: 'dev-server',
    port: 3000,
    protocol: 'http',
    url: 'http://localhost:3000',
    registeredAt: Date.now() - 5000,
    lastReachableAt: Date.now() - 2000,
    status: 'active',
    provider: 'sprites',
    sandboxId: 'sandbox-1',
    confidence: 'high',
    framework: 'vite',
    ...overrides,
  };
}

function createMockSnapshot(overrides: Record<string, any> = {}) {
  return {
    workspaceId: 'ws-test',
    userId: 'test-user',
    sourceProvider: 'sprites',
    sourceSandboxId: 'sandbox-1',
    workspaceDir: '/workspace',
    createdAt: Date.now() - 60000,
    checkpointId: 'cp-abc123',
    vfsVersion: 5,
    fileCount: 150,
    lockFiles: { node: ['npm'], python: [] },
    estimatedCacheSizeBytes: 50_000_000,
    ...overrides,
  };
}

function createMockImageStats(overrides: Record<string, any> = {}) {
  return {
    totalImages: 3,
    activeImages: 2,
    nodeImages: 2,
    pythonImages: 1,
    totalUseCount: 10,
    totalEstimatedSizeMb: 150,
    enabled: true,
    ...overrides,
  };
}

// ============================================================================
// Mock dependencies (vi.mock is hoisted, but vi.hoisted() values are available)
// ============================================================================

vi.mock('@/lib/terminal/virtual-pid-registry', () => ({
  virtualPidRegistry: {
    getProcessList: mockGetProcessList,
  },
}));

vi.mock('@/lib/terminal/workspace-service-manager', () => ({
  workspaceServiceManager: {
    listServices: mockListServices,
  },
}));

vi.mock('@/lib/terminal/workspace-preview-registry', () => ({
  workspacePreviewRegistry: {
    getWorkspacePreviews: mockGetWorkspacePreviews,
  },
}));

vi.mock('@/lib/sandbox/workspacefs-snapshot-service', () => ({
  workspaceFSSnapshotService: {
    getSnapshot: mockGetSnapshot,
  },
}));

vi.mock('@/lib/sandbox/workspace-image-registry', () => ({
  workspaceImageRegistry: {
    getStats: mockGetStats,
  },
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { workspaceGraphService } from '../workspace-graph-service';

describe('WorkspaceGraphService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // getWorkspaceGraph
  // ==========================================================================

  describe('getWorkspaceGraph', () => {
    it('returns a valid WorkspaceGraph structure for a populated workspace', () => {
      mockGetProcessList.mockReturnValue([createMockProcess()]);
      mockListServices.mockReturnValue([createMockService({ ports: [{ port: 3000, protocol: 'http' }] })]);
      mockGetWorkspacePreviews.mockReturnValue([createMockPreview()]);
      mockGetSnapshot.mockReturnValue(createMockSnapshot());
      mockGetStats.mockReturnValue(createMockImageStats());

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      // Core structure
      expect(graph.workspaceId).toBe('ws-test');
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(Array.isArray(graph.edges)).toBe(true);
      expect(Array.isArray(graph.diagnostics)).toBe(true);
      expect(typeof graph.generatedAt).toBe('number');

      // Node count — process + service + preview + snapshot + image = 5+
      // (Ports are edges only, not separate nodes)
      expect(graph.nodes.length).toBeGreaterThanOrEqual(5);

      // Summary
      expect(graph.summary.totalNodes).toBe(graph.nodes.length);
      expect(graph.summary.runningServices).toBe(1);
      expect(graph.summary.stoppedServices).toBe(0);
      expect(graph.summary.activePreviews).toBe(1);
      expect(graph.summary.totalProcesses).toBe(1);
    });

    it('returns empty graph for workspace with no registries', () => {
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const graph = workspaceGraphService.getWorkspaceGraph('ws-empty');

      expect(graph.workspaceId).toBe('ws-empty');
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
      expect(graph.diagnostics).toHaveLength(0);
      expect(graph.summary.totalNodes).toBe(0);
      expect(graph.summary.runningServices).toBe(0);
      expect(graph.summary.activePreviews).toBe(0);
    });

    it('handles registry errors gracefully', () => {
      mockGetProcessList.mockImplementation(() => { throw new Error('DB error'); });
      mockListServices.mockImplementation(() => { throw new Error('Service error'); });
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      // Should not throw — errors are caught per-registry
      const graph = workspaceGraphService.getWorkspaceGraph('ws-error');
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    });

    it('reports correct byType breakdown', () => {
      mockGetProcessList.mockReturnValue([
        createMockProcess({ vPid: 100 }),
        createMockProcess({ vPid: 101 }),
      ]);
      mockListServices.mockReturnValue([createMockService()]);
      mockGetWorkspacePreviews.mockReturnValue([createMockPreview()]);
      mockGetSnapshot.mockReturnValue(createMockSnapshot());
      mockGetStats.mockReturnValue(createMockImageStats());

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      expect(graph.summary.byType.process).toBe(2);
      expect(graph.summary.byType.service).toBe(1);
      expect(graph.summary.byType.preview).toBe(1);
      expect(graph.summary.byType.snapshot).toBe(1);
    });

    it('detects crashed services in summary', () => {
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([
        createMockService({ id: 'svc-1', status: 'running' }),
        createMockService({ id: 'svc-2', status: 'crashed', exitCode: 1 }),
        createMockService({ id: 'svc-3', status: 'stopped' }),
      ]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      expect(graph.summary.runningServices).toBe(1);
      expect(graph.summary.stoppedServices).toBe(2);
    });
  });

  // ==========================================================================
  // Diagnostics
  // ==========================================================================

  describe('diagnostics', () => {
    it('detects crashed services', () => {
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([
        createMockService({ id: 'svc-crash', status: 'crashed', exitCode: 137 }),
      ]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      const crashDiag = graph.diagnostics.find(d => d.category === 'service_health');
      expect(crashDiag).toBeDefined();
      expect(crashDiag!.level).toBe('error');
      expect(crashDiag!.message).toContain('crashed');
      expect(crashDiag!.message).toContain('exit code 137');
    });

    it('warns on services stuck in starting state', () => {
      const startedLongAgo = Date.now() - 120_000;
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([
        createMockService({ id: 'svc-start', status: 'starting', startedAt: startedLongAgo }),
      ]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      const startDiag = graph.diagnostics.find(d => d.category === 'service_health');
      expect(startDiag).toBeDefined();
      expect(startDiag!.level).toBe('warning');
      expect(startDiag!.message).toContain('starting');
    });

    it('warns on running service with ports but no active preview', () => {
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([
        createMockService({
          id: 'svc-preview',
          status: 'running',
          ports: [{ port: 3000, protocol: 'http' }],
        }),
      ]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      const portDiag = graph.diagnostics.find(d => d.category === 'port_availability');
      expect(portDiag).toBeDefined();
      expect(portDiag!.level).toBe('info');
      expect(portDiag!.message).toContain('no active preview');
    });

    it('does NOT warn on running service with no ports (background worker)', () => {
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([
        createMockService({
          id: 'svc-worker',
          status: 'running',
          ports: [], // No ports — background task
        }),
      ]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      const portDiag = graph.diagnostics.find(d => d.category === 'port_availability');
      expect(portDiag).toBeUndefined();
    });

    it('detects stale processes', () => {
      const veryOld = Date.now() - 300_000; // 5 min — well past 120s stale threshold
      mockGetProcessList.mockReturnValue([
        createMockProcess({ vPid: 100, lastConfirmedAt: veryOld }),
      ]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      const staleDiag = graph.diagnostics.find(d => d.category === 'process_state');
      expect(staleDiag).toBeDefined();
      expect(staleDiag!.level).toBe('warning');
      expect(staleDiag!.message).toContain('not been confirmed alive');
    });

    it('creates edges for service-to-process relationships', () => {
      mockGetProcessList.mockReturnValue([
        createMockProcess({ vPid: 100, serviceId: 'svc-1', isService: true }),
      ]);
      mockListServices.mockReturnValue([
        createMockService({ id: 'svc-1' }),
      ]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      const ownsEdge = graph.edges.find(e => e.type === 'owns');
      expect(ownsEdge).toBeDefined();
      expect(ownsEdge!.sourceId).toBe('service:svc-1');
      expect(ownsEdge!.targetId).toBe('process:100');
    });
  });

  // ==========================================================================
  // getServiceDiagnostic
  // ==========================================================================

  describe('getServiceDiagnostic', () => {
    it('returns warning for unknown service', () => {
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const diagnostics = workspaceGraphService.getServiceDiagnostic('ws-test', 'svc-unknown');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0].level).toBe('warning');
      expect(diagnostics[0].message).toContain('not found');
    });

    it('returns ok diagnostic for running service', () => {
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([
        createMockService({ id: 'svc-running', status: 'running' }),
      ]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      // getServiceDiagnostic accepts both bare service IDs and prefixed IDs
      const diagnostics = workspaceGraphService.getServiceDiagnostic('ws-test', 'svc-running');
      const okDiag = diagnostics.find(d => d.message.includes('running'));
      expect(okDiag).toBeDefined();
      expect(okDiag!.level).toBe('info');
    });

    it('accepts both bare and prefixed service IDs', () => {
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([
        createMockService({ id: 'svc-prefix-test', status: 'running' }),
      ]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const bareResult = workspaceGraphService.getServiceDiagnostic('ws-test', 'svc-prefix-test');
      const prefixedResult = workspaceGraphService.getServiceDiagnostic('ws-test', 'service:svc-prefix-test');

      const bareDiag = bareResult.find(d => d.message.includes('running'));
      const prefixedDiag = prefixedResult.find(d => d.message.includes('running'));
      expect(bareDiag).toBeDefined();
      expect(prefixedDiag).toBeDefined();
      expect(bareDiag!.level).toBe('info');
      expect(prefixedDiag!.level).toBe('info');
    });
  });

  // ==========================================================================
  // Snapshot diagnostics
  // ==========================================================================

  describe('snapshot diagnostics', () => {
    it('warns on old snapshots (> 30 min)', () => {
      const veryOld = Date.now() - 35 * 60 * 1000; // 35 min — past 30 min threshold
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(createMockSnapshot({ createdAt: veryOld }));
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      const snapDiag = graph.diagnostics.find(d => d.category === 'snapshot_status');
      expect(snapDiag).toBeDefined();
      expect(snapDiag!.level).toBe('warning');
      expect(snapDiag!.message).toContain('minutes old');
    });

    it('does NOT warn on recent snapshots', () => {
      const recent = Date.now() - 60_000; // 1 min — well within 30 min threshold
      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(createMockSnapshot({ createdAt: recent }));
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const graph = workspaceGraphService.getWorkspaceGraph('ws-test');

      const snapDiag = graph.diagnostics.find(d => d.category === 'snapshot_status');
      expect(snapDiag).toBeUndefined();
    });
  });

  // ==========================================================================
  // findProcesses
  // ==========================================================================

  describe('findProcesses', () => {
    it('finds processes by command pattern', () => {
      mockGetProcessList.mockReturnValue([
        createMockProcess({ vPid: 100, command: 'npm run dev' }),
        createMockProcess({ vPid: 101, command: 'node server.js' }),
        createMockProcess({ vPid: 102, command: 'python app.py' }),
      ]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const result = workspaceGraphService.findProcesses('ws-test', 'npm');
      expect(result.processes).toHaveLength(1);
      expect(result.processes[0].properties.command).toBe('npm run dev');
    });

    it('returns empty processes array for no matches', () => {
      mockGetProcessList.mockReturnValue([
        createMockProcess({ command: 'npm run dev' }),
      ]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const result = workspaceGraphService.findProcesses('ws-test', 'nonexistent');
      expect(result.processes).toHaveLength(0);
      expect(result.relatedNodes).toHaveLength(0);
    });

    it('returns related nodes and edges for matched processes', () => {
      mockGetProcessList.mockReturnValue([
        createMockProcess({ vPid: 100, command: 'npm run dev', serviceId: 'svc-1', isService: true }),
      ]);
      mockListServices.mockReturnValue([
        createMockService({ id: 'svc-1', name: 'dev-server' }),
      ]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const result = workspaceGraphService.findProcesses('ws-test', 'npm');
      expect(result.processes).toHaveLength(1);
      // relatedNodes should include the service
      expect(result.relatedNodes.length).toBeGreaterThanOrEqual(1);
      expect(result.relatedNodes[0].type).toBe('service');
      expect(result.edges.length).toBeGreaterThanOrEqual(1);
    });
  });
});
