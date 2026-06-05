/**
 * Unit tests for execution-router
 *
 * Verifies the affinity wiring: config.workspaceId is preferred over
 * config.conversationId when passed to sandboxOrchestrator.getSandbox().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the sandbox orchestrator BEFORE importing the module under test
const mockGetSandbox = vi.fn();
const mockExecuteInSandbox = vi.fn();

vi.mock('@/lib/sandbox/sandbox-orchestrator', () => ({
  sandboxOrchestrator: {
    getSandbox: (...args: any[]) => mockGetSandbox(...args),
    executeInSandbox: (...args: any[]) => mockExecuteInSandbox(...args),
  },
}));

// Mock the workspace service manager (used for daemon commands)
vi.mock('@/lib/terminal/workspace-service-manager', () => ({
  workspaceServiceManager: {
    createService: vi.fn().mockReturnValue({
      id: 'svc-test-1',
      name: 'test-service',
      sandboxProvider: undefined,
      sandboxId: undefined,
    }),
    updateStatus: vi.fn(),
    feedOutput: vi.fn(),
  },
}));

describe('executeWithRouting — workspaceId affinity wiring', () => {
  beforeEach(() => {
    // Default mock: sandbox orchestrator returns a valid session and execution result
    mockGetSandbox.mockResolvedValue({
      sessionId: 'sandbox-123',
      logicalId: 'user1-workspaceA',
      userId: 'user1',
      conversationId: 'workspaceA',
      handle: { id: 'sandbox-123', workspaceDir: '/workspace/users/user1/sessions/workspaceA' },
      provider: 'e2b',
      policy: 'sandbox-preferred',
      taskType: 'general',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      riskAssessment: { level: 'low', shouldBlock: false },
      migrationCount: 0,
      isWarm: false,
    });

    mockExecuteInSandbox.mockResolvedValue({
      output: 'Test output',
      exitCode: 0,
      duration: 100,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should prefer config.workspaceId over config.conversationId as the affinity key', async () => {
    const { executeWithRouting } = await import('@/lib/terminal/execution-router');

    await executeWithRouting('npm run dev', {
      userId: 'user1',
      conversationId: 'conv-abc',
      workspaceId: 'workspace-xyz',
      enabled: true,
      workingDir: '/workspace',
      onOutput: () => {},
      onRoute: () => {},
    });

    // Verify getSandbox was called
    expect(mockGetSandbox).toHaveBeenCalledTimes(1);

    // The conversationId passed to getSandbox should be workspaceId, NOT conversationId
    const getSandboxArgs = mockGetSandbox.mock.calls[0][0];
    expect(getSandboxArgs.conversationId).toBe('workspace-xyz');
    expect(getSandboxArgs.conversationId).not.toBe('conv-abc');
    expect(getSandboxArgs.userId).toBe('user1');
  });

  it('should fall back to config.conversationId when workspaceId is undefined', async () => {
    const { executeWithRouting } = await import('@/lib/terminal/execution-router');

    await executeWithRouting('npm install express', {
      userId: 'user1',
      conversationId: 'conv-abc',
      // workspaceId intentionally omitted
      enabled: true,
      workingDir: '/workspace',
      onOutput: () => {},
      onRoute: () => {},
    });

    expect(mockGetSandbox).toHaveBeenCalledTimes(1);

    const getSandboxArgs = mockGetSandbox.mock.calls[0][0];
    expect(getSandboxArgs.conversationId).toBe('conv-abc');
    expect(getSandboxArgs.userId).toBe('user1');
  });

  it('should fall back to config.conversationId when workspaceId is empty string', async () => {
    const { executeWithRouting } = await import('@/lib/terminal/execution-router');

    await executeWithRouting('npm run build', {
      userId: 'user1',
      conversationId: 'conv-abc',
      workspaceId: '',
      enabled: true,
      workingDir: '/workspace',
      onOutput: () => {},
      onRoute: () => {},
    });

    expect(mockGetSandbox).toHaveBeenCalledTimes(1);

    const getSandboxArgs = mockGetSandbox.mock.calls[0][0];
    // Empty string is falsy, so it should fall back to conversationId
    // NOTE: The current implementation uses `config.workspaceId || config.conversationId`
    // which means empty string workspaceId falls back to conversationId
    expect(getSandboxArgs.conversationId).toBe('conv-abc');
  });

  it('should set sandboxProvider and sandboxId on daemon services when workspaceId is provided', async () => {
    const { executeWithRouting } = await import('@/lib/terminal/execution-router');

    // Use `nohup ./start-server` — base command './start-server' doesn't match
    // any earlier tier (not a package manager, not a script executor, etc.)
    // so it falls through to Tier 8 where `nohup` triggers daemon classification.
    const result = await executeWithRouting('nohup ./start-server', {
      userId: 'user1',
      conversationId: 'conv-abc',
      workspaceId: 'workspace-xyz',
      enabled: true,
      workingDir: '/workspace',
      onOutput: () => {},
      onRoute: () => {},
    });

    // Daemon service should be created since 'nohup ...' matches daemon patterns
    expect(result.serviceId).toBeDefined();
    expect(result.serviceId).toBe('svc-test-1');

    // The workspace service manager mock should have been called
    const { workspaceServiceManager } = await import('@/lib/terminal/workspace-service-manager');
    expect(workspaceServiceManager.createService).toHaveBeenCalled();

    // And the service should have sandboxProvider and sandboxId set
    const createdService = (workspaceServiceManager.createService as any).mock.results[0].value;
    expect(createdService.sandboxProvider).toBe('e2b');
    expect(createdService.sandboxId).toBe('sandbox-123');
  });
});
