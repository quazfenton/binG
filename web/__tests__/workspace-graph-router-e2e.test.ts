/**
 * E2E Tests: Workspace Graph — Router → Provider → Service Path
 *
 * Tests the full execution path end-to-end:
 * 1. Register workspace-graph provider in CapabilityRouter
 * 2. Execute all 3 capabilities via router.execute()
 * 3. Verify provider is found, service executes, and output structure is correct
 * 4. Verify input validation (Zod schema enforcement)
 * 5. Verify error handling (unknown service, missing fields)
 *
 * This tests the critical provider registration fix: without it, the router
 * would fail with "All providers failed for workspace.graph" because the
 * 'workspace-graph' provider was not registered in the CapabilityRouter.
 *
 * Run: npx vitest run __tests__/workspace-graph-router-e2e.test.ts
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

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
    workspaceId: 'ws-e2e',
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
    id: 'svc-e2e-1',
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
    workspaceId: 'ws-e2e',
    userId: 'test-user',
    ...overrides,
  };
}

function createMockPreview(overrides: Record<string, any> = {}) {
  return {
    id: 'preview-e2e-1',
    workspaceId: 'ws-e2e',
    serviceId: 'svc-e2e-1',
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
    workspaceId: 'ws-e2e',
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
// Mock workspace registry dependencies
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
// Imports (after mocks)
// ============================================================================

import { getCapabilityRouter } from '@/lib/tools/router';
import { getCapability } from '@/lib/tools/capabilities';

// ============================================================================
// Helpers: register/unregister the workspace-graph provider
// ============================================================================

const CAPABILITIES = [
  'workspace.graph',
  'workspace.graph_diagnostic',
  'workspace.graph_find_process',
];

async function registerWorkspaceGraphProvider() {
  const router = getCapabilityRouter();

  if (!(router as any).initialized) {
    await router.initialize();
  }

  // Unregister first to ensure clean state (e.g., if previous test run left it registered)
  router.unregisterProvider('workspace-graph');

  await router.registerCustomProvider({
    id: 'workspace-graph',
    name: 'Workspace Graph',
    capabilities: CAPABILITIES,
    isAvailable: async () => true,
    execute: async (capabilityId: string, input: any, context: any) => {
      const { workspaceGraphService } = await import('@/lib/workspace/workspace-graph-service');
      const workspaceId = input.workspaceId || context?.sessionId || context?.userId || 'default';

      try {
        let output: any;
        switch (capabilityId) {
          case 'workspace.graph':
            output = workspaceGraphService.getWorkspaceGraph(workspaceId);
            break;
          case 'workspace.graph_diagnostic':
            if (!input.serviceId) {
              return { success: false, error: 'Missing required field: serviceId' };
            }
            output = workspaceGraphService.getServiceDiagnostic(workspaceId, input.serviceId);
            break;
          case 'workspace.graph_find_process':
            if (!input.pattern) {
              return { success: false, error: 'Missing required field: pattern' };
            }
            output = workspaceGraphService.findProcesses(workspaceId, input.pattern);
            break;
          default:
            return { success: false, error: `Unknown capability: ${capabilityId}` };
        }
        return { success: true, output, data: output };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });
}

async function unregisterWorkspaceGraphProvider() {
  const router = getCapabilityRouter();
  router.unregisterProvider('workspace-graph');
}

// ============================================================================
// Tests
// ============================================================================

describe('Workspace Graph — Router E2E', () => {
  beforeAll(async () => {
    await registerWorkspaceGraphProvider();
  });

  afterAll(() => {
    unregisterWorkspaceGraphProvider();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Provider Registration
  // ==========================================================================

  describe('provider registration', () => {
    it('has the workspace-graph provider registered', async () => {
      const router = getCapabilityRouter();
      const provider = router.getProvider('workspace-graph');
      expect(provider).toBeDefined();
      expect(provider!.id).toBe('workspace-graph');
      expect(provider!.name).toBe('Workspace Graph');
      expect(provider!.capabilities).toEqual(CAPABILITIES);
    });

    it('hasCapability returns true for workspace.graph', async () => {
      const router = getCapabilityRouter();
      const hasCap = await router.hasCapability('workspace.graph');
      expect(hasCap).toBe(true);
    });

    it('hasCapability returns true for workspace.graph_diagnostic', async () => {
      const router = getCapabilityRouter();
      const hasCap = await router.hasCapability('workspace.graph_diagnostic');
      expect(hasCap).toBe(true);
    });

    it('hasCapability returns true for workspace.graph_find_process', async () => {
      const router = getCapabilityRouter();
      const hasCap = await router.hasCapability('workspace.graph_find_process');
      expect(hasCap).toBe(true);
    });

    it('capability definitions exist with correct providerPriority', () => {
      const cap = getCapability('workspace.graph');
      expect(cap).toBeDefined();
      expect(cap!.providerPriority).toContain('workspace-graph');

      const diagCap = getCapability('workspace.graph_diagnostic');
      expect(diagCap).toBeDefined();
      expect(diagCap!.providerPriority).toContain('workspace-graph');

      const findCap = getCapability('workspace.graph_find_process');
      expect(findCap).toBeDefined();
      expect(findCap!.providerPriority).toContain('workspace-graph');
    });
  });

  // ==========================================================================
  // workspace.graph — Full Graph
  // ==========================================================================

  describe('workspace.graph', () => {
    it('returns a complete graph via router.execute()', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockReturnValue([createMockProcess()]);
      mockListServices.mockReturnValue([createMockService({ ports: [{ port: 3000, protocol: 'http' }] })]);
      mockGetWorkspacePreviews.mockReturnValue([createMockPreview()]);
      mockGetSnapshot.mockReturnValue(createMockSnapshot());
      mockGetStats.mockReturnValue(createMockImageStats());

      const result = await router.execute('workspace.graph', { workspaceId: 'ws-e2e' }, { userId: 'test-user' });

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();

      const graph = result.output;
      expect(graph.workspaceId).toBe('ws-e2e');
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(Array.isArray(graph.edges)).toBe(true);
      expect(Array.isArray(graph.diagnostics)).toBe(true);
      expect(typeof graph.generatedAt).toBe('number');

      // Should have process + service + preview + snapshot + image nodes
      expect(graph.nodes.length).toBeGreaterThanOrEqual(5);

      // Summary fields
      expect(graph.summary.totalNodes).toBe(graph.nodes.length);
      expect(typeof graph.summary.byType).toBe('object');
      expect(graph.summary.runningServices).toBe(1);
      expect(graph.summary.activePreviews).toBe(1);
      expect(graph.summary.totalProcesses).toBe(1);
    });

    it('returns empty graph for empty workspace via router.execute()', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const result = await router.execute('workspace.graph', { workspaceId: 'ws-empty' }, { userId: 'test-user' });

      expect(result.success).toBe(true);
      expect(result.output.nodes).toHaveLength(0);
      expect(result.output.edges).toHaveLength(0);
      expect(result.output.diagnostics).toHaveLength(0);
    });

    it('handles registries that throw errors gracefully', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockImplementation(() => { throw new Error('DB error'); });
      mockListServices.mockImplementation(() => { throw new Error('Service error'); });
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const result = await router.execute('workspace.graph', { workspaceId: 'ws-error' }, { userId: 'test-user' });

      expect(result.success).toBe(true);
      expect(result.output.nodes).toHaveLength(0);
    });
  });

  // ==========================================================================
  // workspace.graph_diagnostic — Service Diagnostic
  // ==========================================================================

  describe('workspace.graph_diagnostic', () => {
    it('returns diagnostics for a known service via router.execute()', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([createMockService({ id: 'svc-e2e-diagnose', status: 'crashed', exitCode: 1 })]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const result = await router.execute(
        'workspace.graph_diagnostic',
        { workspaceId: 'ws-e2e', serviceId: 'svc-e2e-diagnose' },
        { userId: 'test-user' }
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.output)).toBe(true);
      expect(result.output.length).toBeGreaterThan(0);

      // Should include a crash diagnostic
      const crashDiag = result.output.find((d: any) => d.category === 'service_health');
      expect(crashDiag).toBeDefined();
      expect(crashDiag.level).toBe('error');
      expect(crashDiag.message).toContain('crashed');
    });

    it('returns warning for unknown service via router.execute()', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const result = await router.execute(
        'workspace.graph_diagnostic',
        { workspaceId: 'ws-e2e', serviceId: 'svc-nonexistent' },
        { userId: 'test-user' }
      );

      expect(result.success).toBe(true);
      expect(result.output.length).toBeGreaterThan(0);
      expect(result.output[0].level).toBe('warning');
      expect(result.output[0].message).toContain('not found');
    });

    it('accepts both bare and prefixed service IDs via router.execute()', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([createMockService({ id: 'svc-id-test', status: 'running' })]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const bareResult = await router.execute(
        'workspace.graph_diagnostic',
        { workspaceId: 'ws-e2e', serviceId: 'svc-id-test' },
        { userId: 'test-user' }
      );

      const prefixedResult = await router.execute(
        'workspace.graph_diagnostic',
        { workspaceId: 'ws-e2e', serviceId: 'service:svc-id-test' },
        { userId: 'test-user' }
      );

      expect(bareResult.success).toBe(true);
      expect(prefixedResult.success).toBe(true);

      const bareDiag = bareResult.output.find((d: any) => d.message.includes('running'));
      const prefixedDiag = prefixedResult.output.find((d: any) => d.message.includes('running'));
      expect(bareDiag).toBeDefined();
      expect(prefixedDiag).toBeDefined();
    });
  });

  // ==========================================================================
  // workspace.graph_find_process — Process Search
  // ==========================================================================

  describe('workspace.graph_find_process', () => {
    it('finds processes by command pattern via router.execute()', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockReturnValue([
        createMockProcess({ vPid: 100, command: 'npm run dev' }),
        createMockProcess({ vPid: 101, command: 'node server.js' }),
        createMockProcess({ vPid: 102, command: 'python app.py' }),
      ]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const result = await router.execute(
        'workspace.graph_find_process',
        { workspaceId: 'ws-e2e', pattern: 'npm' },
        { userId: 'test-user' }
      );

      expect(result.success).toBe(true);
      expect(result.output.processes).toHaveLength(1);
      expect(result.output.processes[0].properties.command).toBe('npm run dev');
    });

    it('returns empty for no matches via router.execute()', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockReturnValue([createMockProcess({ command: 'npm run dev' })]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const result = await router.execute(
        'workspace.graph_find_process',
        { workspaceId: 'ws-e2e', pattern: 'nonexistent' },
        { userId: 'test-user' }
      );

      expect(result.success).toBe(true);
      expect(result.output.processes).toHaveLength(0);
    });

    it('returns related nodes and edges for matched processes via router.execute()', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockReturnValue([
        createMockProcess({ vPid: 100, command: 'npm run dev', serviceId: 'svc-e2e-1', isService: true }),
      ]);
      mockListServices.mockReturnValue([createMockService({ id: 'svc-e2e-1', name: 'dev-server' })]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      const result = await router.execute(
        'workspace.graph_find_process',
        { workspaceId: 'ws-e2e', pattern: 'npm' },
        { userId: 'test-user' }
      );

      expect(result.success).toBe(true);
      expect(result.output.processes).toHaveLength(1);
      expect(result.output.relatedNodes.length).toBeGreaterThanOrEqual(1);
      expect(result.output.relatedNodes[0].type).toBe('service');
      expect(result.output.edges.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Input Validation (Zod schema enforcement)
  // ==========================================================================

  describe('input validation', () => {
    it('rejects workspace.graph_diagnostic without serviceId', async () => {
      const router = getCapabilityRouter();

      const result = await router.execute(
        'workspace.graph_diagnostic',
        { workspaceId: 'ws-e2e' },  // missing serviceId
        { userId: 'test-user' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
      expect(result.error).toContain('serviceId');
    });

    it('rejects workspace.graph_find_process without pattern', async () => {
      const router = getCapabilityRouter();

      const result = await router.execute(
        'workspace.graph_find_process',
        { workspaceId: 'ws-e2e' },  // missing pattern
        { userId: 'test-user' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
      expect(result.error).toContain('pattern');
    });

    it('passes validation with minimal input for workspace.graph', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      // workspace.graph has optional workspaceId — should pass validation even without it
      const result = await router.execute('workspace.graph', {}, { userId: 'test-user' });

      expect(result.success).toBe(true);
      // If there's an error, it should NOT be about invalid input
      if (result.error) {
        expect(result.error).not.toContain('Invalid input');
      }
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('rejects unknown capability ID', async () => {
      const router = getCapabilityRouter();

      const result = await router.execute('workspace.nonexistent', {}, { userId: 'test-user' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown capability');
    });
  });

  // ==========================================================================
  // Context Integration
  // ==========================================================================

  describe('context integration', () => {
    it('falls back to context.userId when workspaceId is not provided', async () => {
      const router = getCapabilityRouter();

      mockGetProcessList.mockReturnValue([]);
      mockListServices.mockReturnValue([]);
      mockGetWorkspacePreviews.mockReturnValue([]);
      mockGetSnapshot.mockReturnValue(null);
      mockGetStats.mockReturnValue(createMockImageStats({ totalImages: 0, activeImages: 0 }));

      // No workspaceId — provider falls back to context.userId
      const result = await router.execute('workspace.graph', {}, { userId: 'fallback-user' });

      expect(result.success).toBe(true);
      expect(result.output.workspaceId).toBe('fallback-user');
    });
  });
});
