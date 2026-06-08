/**
 * Unit tests for SessionManager
 *
 * Tests the core SessionManager class:
 * - Session lifecycle (getOrCreateSession, getSession, destroySession)
 * - State management (updateActivity, updateState, setSandbox)
 * - Metrics & quota (recordMetrics, checkQuota)
 * - Checkpointing (createCheckpoint, restoreFromCheckpoint)
 * - Background jobs
 * - Statistics (getStats, getSessionStatus)
 * - Backward compat exports (agentSessionManager, openCodeV2SessionManager)
 *
 * All external dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock factories — only what is actually used in vi.mock() calls
// ============================================================================

const mockUuidV4 = vi.hoisted(() => vi.fn());

// ============================================================================
// Mock dependencies
// ============================================================================

vi.mock('uuid', () => ({
  v4: mockUuidV4,
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@/lib/sandbox/predictive-prewarmer', () => ({
  predictivePrewarmer: {
    prewarmFromVFS: vi.fn().mockResolvedValue({
      imageBuilt: false,
      attempted: true,
      error: 'no-op',
    }),
  },
}));

vi.mock('@/lib/session/session-naming', () => ({
  registerActiveSession: vi.fn(),
  unregisterActiveSession: vi.fn(),
}));

vi.mock('@/lib/workspace/workspace-session-graph', () => ({
  workspaceSessionGraph: {
    registerSession: vi.fn().mockReturnValue('graph-session-1'),
    unregisterSession: vi.fn(),
  },
}));

vi.mock('@/lib/sandbox/types', () => ({
  getExecutionPolicyConfig: vi.fn().mockReturnValue({
    requiresSandbox: false,
    allowsLocalFallback: true,
    resources: { cpu: 2, memory: 4 },
    maxWaitTime: 30,
  }),
  requiresCloudSandbox: vi.fn().mockReturnValue(false),
  allowsLocalFallback: vi.fn().mockReturnValue(true),
  getPreferredProviders: vi.fn().mockReturnValue(['daytona']),
}));

vi.mock('@/lib/sandbox/providers', () => ({
  getSandboxProvider: vi.fn(),
  getSandboxProviderWithFallback: vi.fn(),
}));

vi.mock('@/lib/virtual-filesystem/scope-utils', () => ({
  normalizeSessionId: vi.fn().mockImplementation((id: string) => id),
}));

vi.mock('@/lib/drivers/opencode', () => ({
  createOpencodeSessionManager: vi.fn(),
}));

vi.mock('@bing/shared/agent/enhanced-background-jobs', () => ({
  enhancedBackgroundJobsManager: {
    startJob: vi.fn(),
    stopJob: vi.fn().mockResolvedValue(true),
    getJob: vi.fn(),
    listJobs: vi.fn(),
    getStats: vi.fn().mockReturnValue({
      total: 0, running: 0, paused: 0, stopped: 0, completed: 0, totalExecutions: 0,
    }),
    setSessionManager: vi.fn(),
    setExecutionGraphEngine: vi.fn(),
  },
}));

vi.mock('@bing/shared/agent/execution-graph', () => ({
  executionGraphEngine: {
    createGraph: vi.fn().mockReturnValue({ id: 'graph-1' }),
    getGraph: vi.fn(),
  },
}));

vi.mock('@/lib/storage/session-store', () => ({
  saveCheckpoint: vi.fn().mockResolvedValue(undefined),
  getCheckpoint: vi.fn(),
  getLatestCheckpoint: vi.fn(),
  getCheckpointsBySession: vi.fn().mockReturnValue([]),
  deleteCheckpoint: vi.fn(),
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { SessionManager, sessionManager } from '../session-manager';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUuidV4.mockReturnValue('mock-uuid-123');
    manager = new SessionManager();
  });

  afterEach(async () => {
    // Shutdown to clear the cleanup timer (setInterval in constructor)
    // and remove process listeners added by startCleanupTimer()
    await manager.shutdown();
  });

  // ==========================================================================
  // Constructor & Singleton
  // ==========================================================================

  describe('constructor', () => {
    it('initializes with no sessions', () => {
      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(0);
      expect(stats.totalUsers).toBe(0);
    });

    it('starts with empty sessionMetrics map', () => {
      expect(manager.sessionMetrics.size).toBe(0);
    });
  });

  describe('singleton', () => {
    it('exports a singleton', () => {
      expect(sessionManager).toBeDefined();
      expect(sessionManager).toBeInstanceOf(SessionManager);
    });
  });

  // ==========================================================================
  // getOrCreateSession
  // ==========================================================================

  describe('getOrCreateSession', () => {
    const userId = 'user-1';
    const conversationId = 'conv-1';

    it('creates a new session', async () => {
      const session = await manager.getOrCreateSession(userId, conversationId);

      expect(session.userId).toBe(userId);
      expect(session.conversationId).toBe(conversationId);
      expect(session.id).toBe('mock-uuid-123');
      expect(session.status).toBe('starting');
      expect(session.state).toBe('ready');
      expect(session.workspaceDir).toBe(`/workspace/users/${userId}/sessions/${conversationId}`);
      expect(session.workspacePath).toBe(`/workspace/users/${userId}/sessions/${conversationId}`);
    });

    it('returns existing session if already created and healthy', async () => {
      const session1 = await manager.getOrCreateSession(userId, conversationId);
      const beforeCallCount = mockUuidV4.mock.calls.length;

      const session2 = await manager.getOrCreateSession(userId, conversationId);

      expect(session2).toBe(session1);
      // uuid should not have been called again
      expect(mockUuidV4.mock.calls.length).toBe(beforeCallCount);
    });

    it('creates a new session if existing one is in error state', async () => {
      const session1 = await manager.getOrCreateSession(userId, conversationId);
      session1.state = 'error';
      mockUuidV4.mockReturnValue('mock-uuid-456');

      const session2 = await manager.getOrCreateSession(userId, conversationId);
      expect(session2).not.toBe(session1);
      expect(session2.id).toBe('mock-uuid-456');
    });

    it('creates a new session if existing one is initializing', async () => {
      const session1 = await manager.getOrCreateSession(userId, conversationId);
      session1.state = 'initializing';
      mockUuidV4.mockReturnValue('mock-uuid-789');

      const session2 = await manager.getOrCreateSession(userId, conversationId);
      expect(session2).not.toBe(session1);
      expect(session2.id).toBe('mock-uuid-789');
    });

    it('uses custom workspace directory when provided', async () => {
      const session = await manager.getOrCreateSession(userId, conversationId, {
        workspaceDir: '/custom/path',
      });
      expect(session.workspaceDir).toBe('/custom/path');
      expect(session.workspacePath).toBe('/custom/path');
    });

    it('applies execution policy from config', async () => {
      const session = await manager.getOrCreateSession(userId, conversationId, {
        executionPolicy: 'sandbox-required',
      });
      expect(session.executionPolicy).toBe('sandbox-required');
    });

    it('maps noSandbox=true to local-safe execution policy', async () => {
      const session = await manager.getOrCreateSession(userId, conversationId, {
        noSandbox: true,
      });
      expect(session.executionPolicy).toBe('local-safe');
    });

    it('maps noSandbox=false to sandbox-required execution policy', async () => {
      const session = await manager.getOrCreateSession(userId, conversationId, {
        noSandbox: false,
      });
      expect(session.executionPolicy).toBe('sandbox-required');
    });

    it('sets default mode via config', async () => {
      const session = await manager.getOrCreateSession(userId, conversationId, {
        mode: 'nullclaw',
      });
      expect(session.metadata?.mode).toBe('nullclaw');
    });
  });

  // ==========================================================================
  // getSession / getSessionById
  // ==========================================================================

  describe('getSession', () => {
    it('returns session by userId + conversationId', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');

      const session = manager.getSession('user-1', 'conv-1');
      expect(session).toBeDefined();
      expect(session!.conversationId).toBe('conv-1');
    });

    it('returns undefined for nonexistent session', () => {
      expect(manager.getSession('user-1', 'conv-nonexistent')).toBeUndefined();
    });
  });

  describe('getSessionById', () => {
    it('returns session by ID', async () => {
      mockUuidV4.mockReturnValue('session-id-123');
      await manager.getOrCreateSession('user-1', 'conv-1');

      const session = manager.getSessionById('session-id-123');
      expect(session).toBeDefined();
      expect(session!.id).toBe('session-id-123');
    });

    it('returns undefined for nonexistent session ID', () => {
      expect(manager.getSessionById('nonexistent')).toBeUndefined();
    });
  });

  // ==========================================================================
  // getUserSessions / listSessions
  // ==========================================================================

  describe('getUserSessions', () => {
    it('returns empty array for user with no sessions', () => {
      expect(manager.getUserSessions('user-none')).toEqual([]);
    });

    it('returns all sessions for a user', async () => {
      mockUuidV4
        .mockReturnValueOnce('session-1')
        .mockReturnValueOnce('session-2');

      await manager.getOrCreateSession('user-1', 'conv-1');
      await manager.getOrCreateSession('user-1', 'conv-2');

      const sessions = manager.getUserSessions('user-1');
      expect(sessions).toHaveLength(2);
      const convIds = sessions.map(s => s.conversationId);
      expect(convIds).toContain('conv-1');
      expect(convIds).toContain('conv-2');
    });

    it('does not return other users sessions', async () => {
      mockUuidV4
        .mockReturnValueOnce('session-user1')
        .mockReturnValueOnce('session-user2');

      await manager.getOrCreateSession('user-1', 'conv-1');
      await manager.getOrCreateSession('user-2', 'conv-1');

      const user1Sessions = manager.getUserSessions('user-1');
      expect(user1Sessions).toHaveLength(1);
      expect(user1Sessions[0].userId).toBe('user-1');
    });
  });

  describe('listSessions', () => {
    it('is an alias for getUserSessions', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      expect(manager.listSessions('user-1')).toEqual(manager.getUserSessions('user-1'));
    });
  });

  // ==========================================================================
  // destroySession
  // ==========================================================================

  describe('destroySession', () => {
    it('removes session from tracking maps', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      expect(manager.getSession('user-1', 'conv-1')).toBeDefined();

      await manager.destroySession('user-1', 'conv-1');
      expect(manager.getSession('user-1', 'conv-1')).toBeUndefined();
    });

    it('is a no-op for nonexistent sessions', async () => {
      await expect(manager.destroySession('user-1', 'conv-nonexistent')).resolves.toBeUndefined();
    });

    it('decrements user session count', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      expect(manager.getUserSessions('user-1')).toHaveLength(1);

      await manager.destroySession('user-1', 'conv-1');
      expect(manager.getUserSessions('user-1')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // updateActivity
  // ==========================================================================

  describe('updateActivity', () => {
    it('updates lastActivity timestamp', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;
      const before = session.lastActivity;

      // Advance time by a small amount
      await new Promise(r => setTimeout(r, 5));
      manager.updateActivity(session.id);

      expect(session.lastActivity).toBeGreaterThan(before);
    });

    it('promotes status from idle to active', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;
      session.status = 'idle';

      manager.updateActivity(session.id);
      expect(session.status).toBe('active');
    });

    it('promotes state from idle to ready', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;
      session.state = 'idle';

      manager.updateActivity(session.id);
      expect(session.state).toBe('ready');
    });
  });

  // ==========================================================================
  // updateState
  // ==========================================================================

  describe('updateState', () => {
    it('updates V2 status field', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      manager.updateState(session.id, 'stopped');
      expect(session.status).toBe('stopped');
    });

    it('updates agent state field', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      manager.updateState(session.id, 'busy');
      expect(session.state).toBe('busy');
    });

    it('ignores unrecognized state values', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      manager.updateState(session.id, 'unknown_state' as any);
      expect(session.state).toBe('ready'); // unchanged from default
    });

    it('updates lastActivity on active/ready states', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;
      const before = session.lastActivity;

      // Advance time slightly
      await new Promise(r => setTimeout(r, 10));
      manager.updateState(session.id, 'active');

      expect(session.lastActivity).toBeGreaterThan(before);
    });
  });

  // ==========================================================================
  // setSandbox
  // ==========================================================================

  describe('setSandbox', () => {
    it('sets sandbox info on session', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      manager.setSandbox(session.id, 'sb-123', 'sprites');

      expect(session.sandboxId).toBe('sb-123');
      expect(session.sandboxProvider).toBe('sprites');
      expect(session.status).toBe('active');
      expect(session.state).toBe('ready');
    });

    it('accepts optional SandboxHandle', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;
      const handle = { id: 'sb-456' } as any;

      manager.setSandbox(session.id, 'sb-456', 'daytona', handle);
      expect(session.sandboxHandle).toBe(handle);
    });
  });

  // ==========================================================================
  // Nullclaw & MCP
  // ==========================================================================

  describe('Nullclaw / MCP configuration', () => {
    it('setNullclawAvailable enables nullclaw', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      manager.setNullclawAvailable(session.id, true);
      expect(session.nullclawEnabled).toBe(true);
    });

    it('setNullclawEndpoint sets endpoint and enables', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      manager.setNullclawEndpoint(session.id, 'https://nullclaw.example.com');
      expect(session.nullclawEndpoint).toBe('https://nullclaw.example.com');
      expect(session.nullclawEnabled).toBe(true);
    });

    it('setMcpServerUrl sets MCP server URL', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      manager.setMcpServerUrl(session.id, 'https://mcp.example.com');
      expect(session.mcpServerUrl).toBe('https://mcp.example.com');
    });
  });

  // ==========================================================================
  // recordMetrics
  // ==========================================================================

  describe('recordMetrics', () => {
    it('tracks cumulative metrics on session', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      manager.recordMetrics(session.id, 10, 5, 3, 60000, 1024, 2);
      manager.recordMetrics(session.id, 5, 2, 1, 30000, 512, 1);

      expect(session.totalSteps).toBe(15);
      expect(session.totalBashCommands).toBe(7);
      expect(session.totalFileChanges).toBe(4);
      expect(session.quota.computeUsed).toBeCloseTo(1.5, 1);
      expect(session.quota.storageUsed).toBe(1536);
      expect(session.quota.apiCallsUsed).toBe(3);
    });

    it('updates global quota', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      manager.recordMetrics(session.id, 0, 0, 0, 60000, 0, 10);

      const stats = manager.getStats();
      expect(stats.globalQuota.computeUsed).toBeCloseTo(1.0, 1);
      expect(stats.globalQuota.apiCallsUsed).toBe(10);
    });

    it('is a no-op for nonexistent session', () => {
      expect(() => manager.recordMetrics('nonexistent', 10, 5, 3)).not.toThrow();
    });
  });

  // ==========================================================================
  // checkQuota
  // ==========================================================================

  describe('checkQuota', () => {
    it('returns allowed=true when quota enforcement is disabled', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      const result = manager.checkQuota(session.id, 10, 0);
      expect(result.allowed).toBe(true);
    });
  });

  // ==========================================================================
  // Checkpointing
  // ==========================================================================

  describe('checkpointing', () => {
    it('createCheckpoint creates a checkpoint', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      const result = await manager.createCheckpoint(session.id, 'test-checkpoint');

      expect(result.checkpointId).toContain('cp-');
      expect(result.timestamp).toBeGreaterThan(0);
      expect(session.lastCheckpoint).toBe(result.timestamp);
      expect(session.checkpointCount).toBe(1);
    });

    it('createCheckpoint throws for nonexistent session', async () => {
      await expect(manager.createCheckpoint('nonexistent')).rejects.toThrow('Session not found');
    });

    it('getCheckpoints returns array from storage', async () => {
      // The session-store mock returns [] by default
      const checkpoints = await manager.getCheckpoints('session-1', 5);
      expect(Array.isArray(checkpoints)).toBe(true);
    });

    it('getLatestCheckpoint returns undefined when none', async () => {
      const cp = await manager.getLatestCheckpoint('session-1');
      expect(cp).toBeUndefined();
    });

    it('deleteCheckpoint does not throw', () => {
      expect(() => manager.deleteCheckpoint('cp-1')).not.toThrow();
    });
  });

  // ==========================================================================
  // Background Jobs
  // ==========================================================================

  describe('background jobs', () => {
    it('startBackgroundJob throws for nonexistent session', async () => {
      await expect(
        manager.startBackgroundJob('nonexistent', { command: 'echo hello', interval: 5000 } as any)
      ).rejects.toThrow('Session not found');
    });

    it('listBackgroundJobs returns empty array for nonexistent session', () => {
      expect(manager.listBackgroundJobs('nonexistent')).toEqual([]);
    });

    it('getBackgroundJobStatus returns null for nonexistent session', () => {
      expect(manager.getBackgroundJobStatus('nonexistent', 'job-1')).toBeNull();
    });

    it('getBackgroundJobsStats returns default stats for nonexistent session', () => {
      const stats = manager.getBackgroundJobsStats('nonexistent');
      expect(stats.total).toBe(0);
    });
  });

  // ==========================================================================
  // getStats
  // ==========================================================================

  describe('getStats', () => {
    it('returns global statistics', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      await manager.getOrCreateSession('user-2', 'conv-2');

      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.totalUsers).toBe(2);
    });

    it('includes global quota', () => {
      const stats = manager.getStats();
      expect(stats.globalQuota).toBeDefined();
      expect(stats.globalQuota.computeMinutes).toBe(60);
      expect(stats.globalQuota.storageBytes).toBe(500 * 1024 * 1024);
      expect(stats.globalQuota.apiCalls).toBe(1000);
    });
  });

  // ==========================================================================
  // getSessionStatus
  // ==========================================================================

  describe('getSessionStatus', () => {
    it('returns session status info', async () => {
      await manager.getOrCreateSession('user-1', 'conv-1');
      const session = manager.getSession('user-1', 'conv-1')!;

      const status = manager.getSessionStatus(session.id);
      expect(status).toBeDefined();
      expect(status!.status).toBe('starting');
      expect(status!.state).toBe('ready');
      expect(status!.quota).toBeDefined();
      expect(status!.workspacePath).toBeDefined();
    });

    it('returns undefined for nonexistent session', () => {
      expect(manager.getSessionStatus('nonexistent')).toBeUndefined();
    });
  });

  // ==========================================================================
  // Backward Compatibility Exports
  // ==========================================================================

  describe('backward compatibility exports', () => {
    it('agentSessionManager wraps sessionManager', async () => {
      const { agentSessionManager, sessionManager: singleton } = await import('../session-manager');
      // Use the singleton (not fresh manager) — agentSessionManager delegates to it
      await singleton.getOrCreateSession('user-1', 'conv-1');

      const session = agentSessionManager.getSession('user-1', 'conv-1');
      expect(session).toBeDefined();
      expect(session!.userId).toBe('user-1');
    });

    it('agentSessionManager.getStats returns simplified stats', async () => {
      const { agentSessionManager } = await import('../session-manager');

      const stats = agentSessionManager.getStats();
      expect(stats).toHaveProperty('totalSessions');
      expect(stats).toHaveProperty('activeSessions');
      expect(stats).toHaveProperty('idleSessions');
      expect(stats).toHaveProperty('users');
    });

    it('openCodeV2SessionManager wraps sessionManager', async () => {
      const { openCodeV2SessionManager } = await import('../session-manager');

      const session = await openCodeV2SessionManager.createSession({
        userId: 'user-1',
        conversationId: 'conv-2',
      });
      expect(session).toBeDefined();
      expect(session.userId).toBe('user-1');
    });

    it('openCodeV2SessionManager.getStats returns full stats', async () => {
      const { openCodeV2SessionManager } = await import('../session-manager');

      const stats = openCodeV2SessionManager.getStats();
      expect(stats).toHaveProperty('totalSessions');
      expect(stats).toHaveProperty('activeSessions');
      expect(stats).toHaveProperty('idleSessions');
      expect(stats).toHaveProperty('totalUsers');
      expect(stats).toHaveProperty('globalQuota');
    });
  });
});
