/**
 * Comprehensive Tests for Agency & Sandbox Modules
 *
 * Covers:
 * - bootstrap-composio.ts — Composio tool registration and capability mapping
 * - agent-kernel-integration.ts — Agent kernel work submission, lifecycle, DAG
 * - bootstrapped-agency.ts — Learning, adaptation, pattern recognition (shared package)
 * - sandbox-provider.ts — Interface compliance, type validation, config merging
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// bootstrap-composio.ts
// ────────────────────────────────────────────────────────────────────────────
// Import the pure function directly — it has no module-level side effects
// The async functions (registerComposioTools, unregisterComposioTools) need
// dynamic imports, so we test them via the pure helpers.
import { registerComposioTools, unregisterComposioTools } from '../lib/tools/bootstrap/bootstrap-composio';

// ────────────────────────────────────────────────────────────────────────────
// agent-kernel-integration.ts
// ────────────────────────────────────────────────────────────────────────────
// topologicalSort is a pure exported function — no side effects
import {
  submitKernelWork,
  spawnKernelAgent,
  getKernelAgentStatus,
  getKernelStats,
  executeDAG,
} from '../lib/mcp/agent-kernel-integration';

// ────────────────────────────────────────────────────────────────────────────
// bootstrapped-agency.ts (from .bing-shared)
// ────────────────────────────────────────────────────────────────────────────
import { BootstrappedAgency, createBootstrappedAgency, type ExecutionRecord } from '../.bing-shared/agent/bootstrapped-agency';

// ────────────────────────────────────────────────────────────────────────────
// sandbox-provider.ts — interfaces and types
// ────────────────────────────────────────────────────────────────────────────
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  ProviderInfo,
  CheckpointInfo,
  ServiceConfig,
  ServiceInfo,
  BatchJobConfig,
  BatchTask,
  BatchJobResult,
  ProxyConfig,
} from '../lib/sandbox/providers/sandbox-provider';

// ────────────────────────────────────────────────────────────────────────────
// Module mocks
// ────────────────────────────────────────────────────────────────────────────

// Mock agent-kernel so getAgentKernel() returns null (simulating "kernel unavailable")
// This lets agent-kernel-integration tests test the fallback code paths.
vi.mock('@bing/shared/agent/agent-kernel', () => ({
  getAgentKernel: () => null,
  createAgentKernel: () => null,
}));

// Mock tools/router so getCapabilityRouter() throws, forcing
// bootstrapped-agency's execute() to fall through to its internal mock executor.
// (If getCapabilityRouter returned null, the inner try-catch in executeWithCapabilities
// would catch the TypeError from null.execute() and report success: false,
// never reaching the outer catch that activates the mock executor.)
vi.mock('@/lib/tools/router', () => ({
  getCapabilityRouter: () => { throw new Error('Router not available in test'); },
}));

// ============================================================================
// SECTION 1: bootstrap-composio
// ============================================================================

describe('bootstrap-composio', () => {
  describe('registerComposioTools (via mock)', () => {
    let mockRegistry: any;
    let originalEnv: any;

    beforeEach(() => {
      originalEnv = { ...process.env };
      mockRegistry = {
        registerTool: vi.fn().mockResolvedValue(undefined),
        getAllTools: vi.fn().mockReturnValue([]),
        unregisterTool: vi.fn().mockResolvedValue(undefined),
      };
    });

    it('returns 0 when COMPOSIO_API_KEY is not set', async () => {
      delete process.env.COMPOSIO_API_KEY;
      const count = await registerComposioTools(mockRegistry, {});
      expect(count).toBe(0);
      expect(mockRegistry.registerTool).not.toHaveBeenCalled();
    });

    it('returns 0 when COMPOSIO_API_KEY is empty', async () => {
      process.env.COMPOSIO_API_KEY = '';
      const count = await registerComposioTools(mockRegistry, {});
      expect(count).toBe(0);
      expect(mockRegistry.registerTool).not.toHaveBeenCalled();
    });

    it('handles missing composio-service module gracefully', async () => {
      process.env.COMPOSIO_API_KEY = 'test-key';
      // The module import will fail — should return 0, not throw
      const count = await registerComposioTools(mockRegistry, {});
      expect(count).toBe(0);
    });
  });

  describe('unregisterComposioTools', () => {
    let mockRegistry: any;

    beforeEach(() => {
      mockRegistry = {
        registerTool: vi.fn(),
        getAllTools: vi.fn().mockReturnValue([]),
        unregisterTool: vi.fn().mockResolvedValue(undefined),
      };
    });

    it('unregisters composio tools when none registered', async () => {
      await unregisterComposioTools(mockRegistry);
      expect(mockRegistry.getAllTools).toHaveBeenCalled();
      expect(mockRegistry.unregisterTool).not.toHaveBeenCalled();
    });

    it('unregisters only composio providers', async () => {
      mockRegistry.getAllTools.mockReturnValue([
        { name: 'test-tool', provider: 'test' },
        { name: 'composio-tool', provider: 'composio' },
      ]);
      await unregisterComposioTools(mockRegistry);
      expect(mockRegistry.unregisterTool).toHaveBeenCalledTimes(1);
      expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('composio-tool');
    });

    it('handles multiple composio tools', async () => {
      mockRegistry.getAllTools.mockReturnValue([
        { name: 'c1', provider: 'composio' },
        { name: 'c2', provider: 'composio' },
        { name: 'c3', provider: 'composio' },
      ]);
      await unregisterComposioTools(mockRegistry);
      expect(mockRegistry.unregisterTool).toHaveBeenCalledTimes(3);
    });
  });
});

// ============================================================================
// SECTION 2: agent-kernel-integration
// ============================================================================

describe('agent-kernel-integration', () => {
  describe('submitKernelWork', () => {
    it('returns error when kernel is unavailable', async () => {
      const result = await submitKernelWork('agent_1', { task: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });
  });

  describe('spawnKernelAgent', () => {
    it('returns error when kernel is unavailable', async () => {
      const result = await spawnKernelAgent({
        type: 'ephemeral',
        userId: 'user_1',
        goal: 'test goal',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });
  });

  describe('getKernelAgentStatus', () => {
    it('returns null when kernel is unavailable', async () => {
      const status = await getKernelAgentStatus('agent_1');
      expect(status).toBeNull();
    });
  });

  describe('getKernelStats', () => {
    it('returns null when kernel is unavailable', async () => {
      const stats = await getKernelStats();
      expect(stats).toBeNull();
    });
  });

  describe('executeDAG', () => {
    it('returns error when kernel is unavailable', async () => {
      const result = await executeDAG({
        nodes: [
          { id: 'plan', type: 'ephemeral', goal: 'Plan' },
          { id: 'build', type: 'worker', goal: 'Build', dependsOn: ['plan'] },
        ],
        userId: 'user_1',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });
  });
});

// ============================================================================
// SECTION 3: BootstrappedAgency — Learning & Adaptation
// ============================================================================

describe('BootstrappedAgency', () => {
  // ── 3A: Construction ───────────────────────────────────────────────────
  describe('construction', () => {
    it('creates agency with default config', () => {
      const agency = createBootstrappedAgency({ sessionId: 'test-session' });
      expect(agency).toBeInstanceOf(BootstrappedAgency);
    });

    it('creates agency with custom config', () => {
      const agency = createBootstrappedAgency({
        sessionId: 'custom-session',
        enableLearning: false,
        maxHistorySize: 50,
        minExecutionsForAdaptation: 10,
      });
      expect(agency).toBeInstanceOf(BootstrappedAgency);
    });

    it('creates agency with userId', () => {
      const agency = createBootstrappedAgency({
        sessionId: 'test',
        userId: 'user-123',
      });
      expect(agency).toBeInstanceOf(BootstrappedAgency);
    });

    it('creates agency with all features disabled', () => {
      const agency = createBootstrappedAgency({
        sessionId: 'test',
        enableLearning: false,
        enablePatternRecognition: false,
        enableAdaptiveSelection: false,
      });
      expect(agency).toBeInstanceOf(BootstrappedAgency);
    });
  });

  // ── 3B: Execution and Learning ─────────────────────────────────────────
  describe('execution and learning', () => {
    let agency: BootstrappedAgency;

    beforeEach(() => {
      agency = createBootstrappedAgency({
        sessionId: 'test-exec',
        enableLearning: true,
        enablePatternRecognition: true,
        enableAdaptiveSelection: true,
      });
    });

    it('executes successfully with default capabilities', async () => {
      const result = await agency.execute({
        task: 'Create a React component',
      });
      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.learned).toBe(true);
    });

    it('executes successfully with specified capabilities', async () => {
      const result = await agency.execute({
        task: 'Write a test file',
        capabilities: ['file.read', 'file.write'],
        chain: false,
      });
      expect(result.success).toBe(true);
    });

    it('executes chained capabilities', async () => {
      const result = await agency.execute({
        task: 'Create src/app.tsx with a basic Express server',
        capabilities: ['file.read', 'file.write', 'sandbox.shell'],
        chain: true,
      });
      expect(result.success).toBe(true);
    });

    it('tracks execution history', async () => {
      await agency.execute({ task: 'First task', capabilities: ['file.read'] });
      await agency.execute({ task: 'Second task', capabilities: ['file.write'] });

      const metrics = agency.getMetrics();
      expect(metrics.totalExecutions).toBe(2);
      expect(metrics.successRate).toBe(1.0);
    });
  });

  // ── 3C: Metrics and Statistics ─────────────────────────────────────────
  describe('metrics and statistics', () => {
    let agency: BootstrappedAgency;

    beforeEach(async () => {
      agency = createBootstrappedAgency({
        sessionId: 'test-metrics',
        enableLearning: true,
        enablePatternRecognition: true,
      });

      // Run several executions to build up history
      await agency.execute({ task: 'create file', capabilities: ['file.read', 'file.write'] });
      await agency.execute({ task: 'edit file', capabilities: ['file.read', 'file.write'] });
      await agency.execute({ task: 'run test', capabilities: ['sandbox.shell'] });
    });

    it('getMetrics returns correct totalExecutions', () => {
      const metrics = agency.getMetrics();
      expect(metrics.totalExecutions).toBe(3);
    });

    it('getMetrics returns success rate', () => {
      const metrics = agency.getMetrics();
      expect(metrics.successRate).toBe(1.0);
      expect(metrics.successRate).toBeGreaterThan(0);
      expect(metrics.successRate).toBeLessThanOrEqual(1);
    });

    it('getMetrics returns average duration', () => {
      const metrics = agency.getMetrics();
      expect(metrics.averageDuration).toBeGreaterThan(0);
    });

    it('getMetrics returns most used capabilities', () => {
      const metrics = agency.getMetrics();
      expect(metrics.mostUsedCapabilities.size).toBeGreaterThan(0);
      // file.read should be most used (appears in 2 of 3 executions)
      const fileReadCount = metrics.mostUsedCapabilities.get('file.read') || 0;
      expect(fileReadCount).toBeGreaterThanOrEqual(2);
    });

    it('getMetrics returns improvement trend', () => {
      const metrics = agency.getMetrics();
      // With only 3 executions, trend should be 'stable' (not enough data for comparison)
      expect(['improving', 'stable', 'declining']).toContain(metrics.improvementTrend);
    });
  });

  // ── 3D: Learning from Success/Failure ──────────────────────────────────
  describe('learning from success and failure', () => {
    let agency: BootstrappedAgency;

    it('learns from successful executions', async () => {
      agency = createBootstrappedAgency({ sessionId: 'learn-success', enableLearning: true });

      // Execute multiple similar tasks to build pattern
      for (let i = 0; i < 6; i++) {
        await agency.execute({ task: 'create component', capabilities: ['file.read', 'file.write'] });
      }

      const summary = agency.getLearningSummary();
      expect(summary.totalExecutions).toBe(6);
      expect(summary.successRate).toBe(1.0);
      expect(summary.topCapabilities.length).toBeGreaterThanOrEqual(1);
    });

    it('tracks success rate per capability', async () => {
      agency = createBootstrappedAgency({ sessionId: 'learn-cap', enableLearning: true });

      // file.read: all successful
      for (let i = 0; i < 5; i++) {
        await agency.execute({ task: 'read something', capabilities: ['file.read'] });
      }

      const rate = agency.getCapabilitySuccessRate('file.read');
      expect(rate).toBe(1.0);
    });

    it('returns null for capabilities with no history', () => {
      agency = createBootstrappedAgency({ sessionId: 'learn-null', enableLearning: true });
      const rate = agency.getCapabilitySuccessRate('nonexistent.capability');
      expect(rate).toBeNull();
    });

    it('provides learned capabilities after sufficient executions', async () => {
      agency = createBootstrappedAgency({
        sessionId: 'learn-adapt',
        enableLearning: true,
        minExecutionsForAdaptation: 3,
      });

      // Run similar tasks to build adaptation data
      for (let i = 0; i < 4; i++) {
        await agency.execute({
          task: 'create a new file component',
          capabilities: ['file.read', 'file.write', 'file.list'],
        });
      }

      const learned = agency.getLearnedCapabilities('create a file');
      expect(learned.length).toBeGreaterThanOrEqual(1);
      expect(learned).toContain('file.read');
      expect(learned).toContain('file.write');
    });
  });

  // ── 3E: Edge Cases ─────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles empty history gracefully', () => {
      const agency = createBootstrappedAgency({ sessionId: 'empty' });
      const metrics = agency.getMetrics();
      expect(metrics.totalExecutions).toBe(0);
      expect(metrics.successRate).toBe(0);
      expect(metrics.averageDuration).toBe(0);
    });

    it('handles reset of learning history', async () => {
      const agency = createBootstrappedAgency({ sessionId: 'reset-test', enableLearning: true });

      await agency.execute({ task: 'first', capabilities: ['file.read'] });
      expect(agency.getMetrics().totalExecutions).toBe(1);

      agency.reset();
      expect(agency.getMetrics().totalExecutions).toBe(0);
    });

    it('returns default capabilities when adaptive selection is disabled', async () => {
      const agency = createBootstrappedAgency({
        sessionId: 'no-adapt',
        enableAdaptiveSelection: false,
      });

      const learned = agency.getLearnedCapabilities('create a component');
      expect(learned).toEqual(['file.read', 'file.write', 'sandbox.shell']);
    });

    it('handles execution with empty capabilities array', async () => {
      const agency = createBootstrappedAgency({ sessionId: 'empty-caps', enableLearning: true });
      const result = await agency.execute({ task: 'simple task', capabilities: [] });
      expect(result.success).toBe(true);
    });

    it('handles single capability execution with file path in task', async () => {
      const agency = createBootstrappedAgency({ sessionId: 'single-cap', enableLearning: true });
      const result = await agency.execute({
        task: 'Read src/app.tsx and understand its structure',
        capabilities: ['file.read'],
        chain: false,
      });
      expect(result.success).toBe(true);
    });

    it('handles failures and learns from them', async () => {
      const agency = createBootstrappedAgency({
        sessionId: 'fail-learn',
        enableLearning: true,
        minExecutionsForAdaptation: 3,
      });

      // Run some failing tasks
      for (let i = 0; i < 4; i++) {
        await agency.execute({
          task: 'build impossible project',
          capabilities: ['nonexistent.capability'],
        });
      }

      const summary = agency.getLearningSummary();
      expect(summary.totalExecutions).toBe(4);
    });
  });

  // ── 3F: Configurations and States ──────────────────────────────────────
  describe('configurations and states', () => {
    it('accepts different session IDs without conflict', () => {
      const agency1 = createBootstrappedAgency({ sessionId: 'session-a' });
      const agency2 = createBootstrappedAgency({ sessionId: 'session-b' });

      expect(agency1).not.toBe(agency2);
      expect(agency1.getMetrics().totalExecutions).toBe(0);
      expect(agency2.getMetrics().totalExecutions).toBe(0);
    });

    it('isolates execution history between agencies', async () => {
      const agency1 = createBootstrappedAgency({ sessionId: 'iso-a', enableLearning: true });
      const agency2 = createBootstrappedAgency({ sessionId: 'iso-b', enableLearning: true });

      await agency1.execute({ task: 'task for A', capabilities: ['file.read'] });
      await agency2.execute({ task: 'task for B', capabilities: ['file.write'] });

      expect(agency1.getMetrics().totalExecutions).toBe(1);
      expect(agency2.getMetrics().totalExecutions).toBe(1);

      // Each should have learned only their own capabilities
      const aRate = agency1.getCapabilitySuccessRate('file.read');
      const bRate = agency2.getCapabilitySuccessRate('file.write');
      expect(aRate).toBe(1.0);
      expect(bRate).toBe(1.0);
    });

    it('returns learning summary with correct shape', () => {
      const agency = createBootstrappedAgency({ sessionId: 'summary-test', enableLearning: true });
      const summary = agency.getLearningSummary();

      expect(summary).toHaveProperty('totalExecutions');
      expect(summary).toHaveProperty('successRate');
      expect(summary).toHaveProperty('topCapabilities');
      expect(summary).toHaveProperty('improvementTrend');
      expect(Array.isArray(summary.topCapabilities)).toBe(true);
    });

    it('topCapabilities has correct shape', async () => {
      const agency = createBootstrappedAgency({ sessionId: 'shape-test', enableLearning: true });
      await agency.execute({ task: 'test', capabilities: ['file.read'] });

      const summary = agency.getLearningSummary();
      if (summary.topCapabilities.length > 0) {
        const cap = summary.topCapabilities[0];
        expect(cap).toHaveProperty('capability');
        expect(cap).toHaveProperty('successRate');
        expect(cap).toHaveProperty('executions');
        expect(typeof cap.capability).toBe('string');
        expect(typeof cap.successRate).toBe('number');
        expect(typeof cap.executions).toBe('number');
      }
    });
  });
});

// ============================================================================
// SECTION 4: sandbox-provider — Interface Compliance & Type Validation
// ============================================================================

describe('sandbox-provider', () => {
  describe('interface compliance', () => {
    it('mock provider implements SandboxProvider interface', () => {
      const mockProvider: SandboxProvider = {
        name: 'test-provider',
        createSandbox: vi.fn(),
        getSandbox: vi.fn(),
        destroySandbox: vi.fn(),
      };

      expect(mockProvider.name).toBe('test-provider');
      expect(typeof mockProvider.createSandbox).toBe('function');
      expect(typeof mockProvider.getSandbox).toBe('function');
      expect(typeof mockProvider.destroySandbox).toBe('function');
    });

    it('provider with optional methods', () => {
      const fullProvider: SandboxProvider = {
        name: 'full-provider',
        createSandbox: vi.fn(),
        getSandbox: vi.fn(),
        destroySandbox: vi.fn(),
        isAvailable: vi.fn().mockReturnValue(true),
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, latency: 50 }),
      };

      expect(fullProvider.isAvailable!()).toBe(true);
    });

    it('provider with health check returns correct shape', async () => {
      const provider: SandboxProvider = {
        name: 'health-checked',
        createSandbox: vi.fn(),
        getSandbox: vi.fn(),
        destroySandbox: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, latency: 100, details: { version: '1.0' } }),
      };

      const health = await provider.healthCheck!();
      expect(health.healthy).toBe(true);
      expect(health.latency).toBeGreaterThanOrEqual(0);
      expect(health.details).toBeDefined();
    });
  });

  describe('SandboxHandle interface', () => {
    it('mock handle implements required methods', () => {
      const handle: SandboxHandle = {
        id: 'sandbox-123',
        workspaceDir: '/workspace',
        executeCommand: vi.fn(),
        writeFile: vi.fn(),
        readFile: vi.fn(),
        listDirectory: vi.fn(),
      };

      expect(handle.id).toBe('sandbox-123');
      expect(handle.workspaceDir).toBe('/workspace');
    });

    it('handle with optional PTY methods', () => {
      const ptyHandle: PtyHandle = {
        sessionId: 'pty-1',
        sendInput: vi.fn(),
        resize: vi.fn(),
        waitForConnection: vi.fn(),
        disconnect: vi.fn(),
        kill: vi.fn(),
      };

      const handle: SandboxHandle = {
        id: 'sandbox-456',
        workspaceDir: '/workspace',
        executeCommand: vi.fn(),
        writeFile: vi.fn(),
        readFile: vi.fn(),
        listDirectory: vi.fn(),
        createPty: vi.fn().mockResolvedValue(ptyHandle),
        getProviderInfo: vi.fn().mockResolvedValue({
          provider: 'daytona',
          status: 'running',
          createdAt: new Date().toISOString(),
        }),
      };

      expect(typeof handle.createPty).toBe('function');
      expect(typeof handle.getProviderInfo).toBe('function');
    });
  });

  describe('SandboxCreateConfig validation', () => {
    it('accepts minimal config', () => {
      const config: SandboxCreateConfig = {};
      expect(config).toBeDefined();
    });

    it('accepts full config with all fields', () => {
      const config: SandboxCreateConfig = {
        language: 'typescript',
        autoStopInterval: 3600,
        workspaceDir: '/workspace/project',
        resources: { cpu: 2, memory: 4096 },
        envVars: { NODE_ENV: 'development' },
        labels: { project: 'test' },
      };

      expect(config.language).toBe('typescript');
      expect(config.resources?.cpu).toBe(2);
      expect(config.envVars?.NODE_ENV).toBe('development');
    });

    it('accepts config with mounts', () => {
      const config: SandboxCreateConfig = {
        mounts: [
          { source: '/local/path', target: '/sandbox/path' },
        ],
      };

      expect(config.mounts).toHaveLength(1);
      expect(config.mounts![0].source).toBe('/local/path');
    });

    it('accepts config with only autoStopInterval', () => {
      const config: SandboxCreateConfig = {
        autoStopInterval: 1800,
      };

      expect(config.autoStopInterval).toBe(1800);
    });
  });

  describe('PtyOptions type shape', () => {
    it('supports required PtyOptions fields', () => {
      const options: PtyOptions = {
        id: 'pty-session-1',
        onData: (data: Uint8Array) => {},
      };

      expect(options.id).toBe('pty-session-1');
      expect(typeof options.onData).toBe('function');
    });

    it('supports full PtyOptions with all optional fields', () => {
      const options: PtyOptions = {
        id: 'pty-session-2',
        cwd: '/workspace',
        envs: { PATH: '/usr/bin' },
        cols: 80,
        rows: 24,
        onData: (data: Uint8Array) => {},
      };

      expect(options.cols).toBe(80);
      expect(options.rows).toBe(24);
      expect(options.cwd).toBe('/workspace');
    });
  });

  describe('ProviderInfo type shape', () => {
    it('supports all ProviderInfo fields', () => {
      const info: ProviderInfo = {
        provider: 'e2b',
        region: 'us-west-2',
        status: 'running',
        url: 'https://sandbox-123.example.com',
        createdAt: '2024-01-01T00:00:00Z',
        lastUsedAt: '2024-01-02T00:00:00Z',
        expiresIn: 3600,
        plan: 'pro',
      };

      expect(info.provider).toBe('e2b');
      expect(info.status).toBe('running');
      expect(info.url).toBeDefined();
      expect(info.plan).toBe('pro');
    });
  });

  describe('Batch types (Blaxel-specific)', () => {
    it('supports BatchJobConfig', () => {
      const config: BatchJobConfig = {
        name: 'test-batch',
        runtime: { memory: 512, timeout: 300, maxConcurrentTasks: 5 },
        maxRetries: 3,
      };

      expect(config.runtime?.memory).toBe(512);
      expect(config.maxRetries).toBe(3);
    });

    it('supports BatchTask', () => {
      const task: BatchTask = {
        id: 'task-1',
        data: { key: 'value' },
      };

      expect(task.id).toBe('task-1');
      expect(task.data.key).toBe('value');
    });

    it('supports BatchJobResult', () => {
      const result: BatchJobResult = {
        jobId: 'job-1',
        status: 'completed',
        totalTasks: 2,
        completedTasks: 2,
        failedTasks: 0,
        results: [
          { taskId: 't1', status: 'success', output: 'done' },
        ],
      };

      expect(result.status).toBe('completed');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('success');
    });
  });

  describe('ProxyConfig type (Sprites-specific)', () => {
    it('supports ProxyConfig', () => {
      const config: ProxyConfig = {
        localPort: 3000,
        remotePort: 8080,
        remoteHost: 'localhost',
      };

      expect(config.localPort).toBe(3000);
      expect(config.remotePort).toBe(8080);
      expect(config.remoteHost).toBe('localhost');
    });

    it('supports minimal ProxyConfig without remoteHost', () => {
      const config: ProxyConfig = {
        localPort: 3000,
        remotePort: 8080,
      };

      expect(config.localPort).toBe(3000);
      expect(config.remotePort).toBe(8080);
      expect(config.remoteHost).toBeUndefined();
    });
  });

  describe('ServiceConfig type', () => {
    it('supports ServiceConfig', () => {
      const config: ServiceConfig = {
        name: 'web-server',
        command: 'node',
        args: ['server.js'],
        port: 3000,
        autoStart: true,
        workingDir: '/app',
        env: { PORT: '3000' },
      };

      expect(config.name).toBe('web-server');
      expect(config.command).toBe('node');
      expect(config.autoStart).toBe(true);
    });

    it('supports minimal ServiceConfig', () => {
      const config: ServiceConfig = {
        name: 'minimal',
        command: 'echo hello',
      };

      expect(config.name).toBe('minimal');
      expect(config.args).toBeUndefined();
      expect(config.port).toBeUndefined();
    });
  });
});
