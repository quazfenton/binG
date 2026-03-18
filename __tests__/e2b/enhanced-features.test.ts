/**
 * E2E Tests: E2B Enhanced Features
 * 
 * Tests for analytics, debug mode, network isolation, and git integration.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock implementations
const createMockSandbox = () => ({
  id: 'test-sandbox-123',
  sandboxId: 'test-sandbox-123',
  commands: {
    run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'output', stderr: '' }),
  },
  kill: vi.fn().mockResolvedValue(undefined),
  files: {
    read: vi.fn().mockResolvedValue('file content'),
    write: vi.fn().mockResolvedValue(undefined),
  },
});

describe('E2B Enhanced Features', () => {
  let mockSandbox: ReturnType<typeof createMockSandbox>;

  beforeEach(() => {
    mockSandbox = createMockSandbox();
    vi.clearAllMocks();
  });

  describe('E2B Analytics Manager', () => {
    const { E2BAnalyticsManager, createE2BAnalytics, e2bAnalytics } = require('@/lib/sandbox/providers/e2b-analytics');

    let analytics: typeof E2BAnalyticsManager;

    beforeEach(() => {
      analytics = new E2BAnalyticsManager();
    });

    it('should track execution lifecycle', () => {
      const sandboxId = 'sandbox-1';
      
      // Start execution
      analytics.startExecution(sandboxId);
      
      // Track operations
      analytics.trackCommand(sandboxId);
      analytics.trackCommand(sandboxId);
      analytics.trackFileOp(sandboxId, 'create');
      analytics.trackFileOp(sandboxId, 'write');
      
      // End execution
      const metrics = analytics.endExecution(sandboxId, {
        networkSent: 1000,
        networkReceived: 2000,
      });

      expect(metrics).toBeDefined();
      expect(metrics?.sandboxId).toBe(sandboxId);
      expect(metrics?.commandsExecuted).toBe(2);
      expect(metrics?.filesCreated).toBe(1);
      expect(metrics?.filesWritten).toBe(1);
      expect(metrics?.duration).toBeDefined();
    });

    it('should calculate cost breakdown', () => {
      const metrics = {
        sandboxId: 'sandbox-1',
        startTime: Date.now() - 60000,
        endTime: Date.now(),
        duration: 60000,
        commandsExecuted: 10,
        filesCreated: 2,
        filesRead: 5,
        filesWritten: 3,
        networkSent: 1024 * 1024, // 1MB
        networkReceived: 2 * 1024 * 1024, // 2MB
      };

      const cost = analytics.getCostBreakdown(metrics);

      expect(cost.compute).toBeGreaterThan(0);
      expect(cost.network).toBeGreaterThan(0);
      expect(cost.storage).toBeGreaterThan(0);
      expect(cost.total).toBeGreaterThan(0);
      expect(cost.currency).toBe('USD');
    });

    it('should provide usage statistics', () => {
      const sandboxId = 'sandbox-1';
      
      // Simulate multiple executions
      for (let i = 0; i < 5; i++) {
        analytics.startExecution(sandboxId);
        analytics.trackCommand(sandboxId);
        analytics.endExecution(sandboxId);
      }

      const stats = analytics.getUsageStats(24 * 60 * 60 * 1000);

      expect(stats.totalExecutions).toBe(5);
      expect(stats.successfulExecutions).toBe(5);
      expect(stats.failedExecutions).toBe(0);
      expect(stats.averageDuration).toBeGreaterThan(0);
    });

    it('should identify top sandboxes by usage', () => {
      // Create multiple sandboxes with different usage
      analytics.startExecution('sandbox-1');
      analytics.endExecution('sandbox-1', { duration: 10000 });

      analytics.startExecution('sandbox-2');
      analytics.endExecution('sandbox-2', { duration: 5000 });

      const topSandboxes = analytics.getTopSandboxes(10);

      expect(topSandboxes.length).toBe(2);
      expect(topSandboxes[0].sandboxId).toBe('sandbox-1');
      expect(topSandboxes[0].totalDuration).toBeGreaterThan(
        topSandboxes[1].totalDuration
      );
    });

    it('should export metrics in multiple formats', () => {
      analytics.startExecution('sandbox-1');
      analytics.endExecution('sandbox-1');

      const jsonExport = analytics.exportMetrics('json');
      const csvExport = analytics.exportMetrics('csv');

      expect(jsonExport).toContain('"active"');
      expect(jsonExport).toContain('"completed"');
      expect(csvExport).toContain('sandboxId,startTime,endTime');
    });

    it('should emit events on execution lifecycle', () => {
      const startedSpy = vi.fn();
      const completedSpy = vi.fn();

      analytics.on('execution-started', startedSpy);
      analytics.on('execution-completed', completedSpy);

      analytics.startExecution('sandbox-1');
      analytics.endExecution('sandbox-1');

      expect(startedSpy).toHaveBeenCalled();
      expect(completedSpy).toHaveBeenCalled();
    });
  });

  describe('E2B Debug Manager', () => {
    const { E2BDebugManager, createE2BDebug, e2bDebug } = require('@/lib/sandbox/providers/e2b-debug');

    let debug: typeof E2BDebugManager;

    beforeEach(() => {
      debug = new E2BDebugManager();
      debug.enable();
    });

    afterEach(() => {
      debug.disable();
      debug.clear();
    });

    it('should log debug messages', () => {
      const logSpy = vi.fn();
      debug.on('log', logSpy);

      debug.log('info', 'Test message', { data: 'test' });

      expect(logSpy).toHaveBeenCalled();
      const log = logSpy.mock.calls[0][0];
      expect(log.level).toBe('info');
      expect(log.message).toBe('Test message');
    });

    it('should trace execution', () => {
      const traceStartSpy = vi.fn();
      const traceEndSpy = vi.fn();

      debug.on('trace-start', traceStartSpy);
      debug.on('trace-end', traceEndSpy);

      const traceId = debug.startTrace('sandbox-1', 'test-operation', { input: 'test' });
      
      expect(traceId).toBeDefined();
      expect(traceStartSpy).toHaveBeenCalled();

      debug.endTrace(traceId, { output: 'result' });
      expect(traceEndSpy).toHaveBeenCalled();
    });

    it('should filter logs by level and sandbox', () => {
      debug.log('debug', 'Debug message', undefined, 'sandbox-1');
      debug.log('info', 'Info message', undefined, 'sandbox-1');
      debug.log('warn', 'Warning message', undefined, 'sandbox-2');
      debug.log('error', 'Error message', undefined, 'sandbox-2');

      const sandbox1Logs = debug.getLogs({ sandboxId: 'sandbox-1' });
      expect(sandbox1Logs.length).toBe(2);

      const errorLogs = debug.getLogs({ level: 'error' });
      expect(errorLogs.length).toBe(1);
    });

    it('should provide performance statistics', () => {
      // Simulate operations
      for (let i = 0; i < 10; i++) {
        const traceId = debug.startTrace('sandbox-1', 'test-op');
        setTimeout(() => {
          debug.endTrace(traceId);
        }, 10 + i * 5);
      }

      // Wait for traces to complete
      setTimeout(() => {
        const stats = debug.getPerformanceStats('test-op');

        expect(stats.totalOperations).toBe(10);
        expect(stats.averageDuration).toBeGreaterThan(0);
        expect(stats.p50Duration).toBeDefined();
        expect(stats.p95Duration).toBeDefined();
        expect(stats.p99Duration).toBeDefined();
      }, 100);
    });

    it('should export debug data', () => {
      debug.log('info', 'Test log');
      const traceId = debug.startTrace('sandbox-1', 'test');
      debug.endTrace(traceId);

      const jsonExport = debug.exportData('json');
      const textExport = debug.exportData('text');

      expect(jsonExport).toContain('"logs"');
      expect(jsonExport).toContain('"traces"');
      expect(textExport).toContain('=== E2B Debug Export ===');
    });
  });

  describe('E2B Network Isolation', () => {
    const { E2BNetworkIsolation, createNetworkIsolation, NetworkPresets } = require('@/lib/sandbox/providers/e2b-network-isolation');

    let network: typeof E2BNetworkIsolation;

    beforeEach(() => {
      network = new E2BNetworkIsolation();
    });

    it('should create and manage policies', () => {
      const policy = network.createRestrictivePolicy('test-policy', [
        'api.github.com',
        'registry.npmjs.org',
      ]);

      network.addPolicy(policy);

      const retrieved = network.getPolicy('test-policy');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-policy');
    });

    it('should check host allowances', () => {
      const policy = network.createRestrictivePolicy('test', [
        '*.example.com',
        '192.168.1.0/24',
      ]);

      expect(network.isHostAllowed(policy, 'api.example.com')).toBe(true);
      expect(network.isHostAllowed(policy, 'evil.com')).toBe(false);
      expect(network.isHostAllowed(policy, '192.168.1.100')).toBe(true);
      expect(network.isHostAllowed(policy, '10.0.0.1')).toBe(false);
    });

    it('should log and track traffic', () => {
      const sandboxId = 'sandbox-1';

      network.logTraffic({
        timestamp: Date.now(),
        sandboxId,
        direction: 'outbound',
        host: 'api.github.com',
        port: 443,
        protocol: 'https',
        bytes: 1024,
        allowed: true,
      });

      const logs = network.getTrafficLogs({ sandboxId });
      expect(logs.length).toBe(1);
      expect(logs[0].host).toBe('api.github.com');
    });

    it('should provide blocked traffic statistics', () => {
      // Log some blocked traffic
      network.logTraffic({
        timestamp: Date.now(),
        sandboxId: 'sandbox-1',
        direction: 'outbound',
        host: 'evil.com',
        port: 443,
        protocol: 'https',
        bytes: 0,
        allowed: false,
        blockReason: 'Host blocked',
      });

      const stats = network.getBlockedStats(24 * 60 * 60 * 1000);

      expect(stats.totalBlocked).toBe(1);
      expect(stats.byHost['evil.com']).toBe(1);
    });

    it('should use preset policies', () => {
      const essential = NetworkPresets.essential();
      const cloudServices = NetworkPresets.cloudServices();
      const development = NetworkPresets.development();

      expect(essential.allowedHosts).toBeDefined();
      expect(cloudServices.allowedHosts).toBeDefined();
      expect(development.allowAllOutbound).toBe(true);
    });
  });

  describe('E2B Git Helper', () => {
    const { E2BGitHelper, createGitHelper, quickClone } = require('@/lib/sandbox/providers/e2b-git-helper');

    let git: typeof E2BGitHelper;

    beforeEach(() => {
      git = new E2BGitHelper(mockSandbox);
    });

    it('should clone repository', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        success: true,
        output: 'Cloning into repo...',
      });

      const result = await git.clone({
        url: 'https://github.com/org/repo.git',
        path: '/home/user/repo',
        depth: 1,
      });

      expect(result.success).toBe(true);
      expect(result.path).toBe('/home/user/repo');
    });

    it('should configure git user', async () => {
      mockSandbox.commands.run
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true });

      const result = await git.configureUser('Test User', 'test@example.com');

      expect(result).toBe(true);
      expect(mockSandbox.commands.run).toHaveBeenCalledTimes(2);
    });

    it('should get git status', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        success: true,
        output: '* main\n  feature-branch',
      });

      const status = await git.getStatus();

      expect(status.branch).toBe('main');
    });

    it('should stage and commit files', async () => {
      mockSandbox.commands.run
        .mockResolvedValueOnce({ success: true }) // git add
        .mockResolvedValueOnce({ success: true }) // git config
        .mockResolvedValueOnce({ success: true }) // git commit
        .mockResolvedValueOnce({ success: true, output: 'abc123' }); // git rev-parse

      const stageResult = await git.stage(['file1.ts', 'file2.ts']);
      expect(stageResult).toBe(true);

      const commitResult = await git.commit({
        message: 'Test commit',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
      });

      expect(commitResult.success).toBe(true);
      expect(commitResult.hash).toBe('abc123');
    });

    it('should manage branches', async () => {
      mockSandbox.commands.run
        .mockResolvedValueOnce({ success: true }) // git branch
        .mockResolvedValueOnce({ success: true }); // git checkout

      const createResult = await git.createBranch('feature-branch');
      expect(createResult).toBe(true);

      const checkoutResult = await git.checkout('feature-branch');
      expect(checkoutResult).toBe(true);
    });

    it('should get commit history', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        success: true,
        output: 'abc123|Test User|2024-01-01|Test commit',
      });

      const history = await git.getHistory(10);

      expect(history.length).toBe(1);
      expect(history[0].hash).toBe('abc123');
      expect(history[0].author).toBe('Test User');
    });
  });
});
