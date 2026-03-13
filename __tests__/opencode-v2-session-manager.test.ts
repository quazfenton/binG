/**
 * Tests for OpenCode V2 Session Manager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${Math.random().toString(36).substr(2, 9)}`
}));

// Mock logger
vi.mock('../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}))

describe('OpenCodeV2SessionManager', () => {
  // Import after mocks
  let manager: any;
  
  beforeEach(async () => {
    vi.resetModules();
    const { openCodeV2SessionManager } = await import('../lib/api/opencode-v2-session-manager');
    manager = openCodeV2SessionManager;
  });

  describe('createSession', () => {
    it('should create a new session with correct config', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      expect(session).toBeDefined();
      expect(session.userId).toBe('user123');
      expect(session.conversationId).toBe('conv456');
      expect(session.status).toBe('starting');
      expect(session.workspaceDir).toContain('user123');
      expect(session.workspaceDir).toContain('conv456');
    });

    it('should enable nullclaw when specified', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
        enableNullclaw: true,
      });

      expect(session.nullclawEnabled).toBe(true);
    });

    it('should enable MCP when specified', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
        enableMcp: true,
      });

      expect(session.mcpEnabled).toBe(true);
    });

    it('should set custom quota when provided', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
        quota: {
          computeMinutes: 100,
          storageBytes: 1000 * 1000 * 1000, // 1GB
        },
      });

      expect(session.quota.computeMinutes).toBe(100);
      expect(session.quota.storageBytes).toBe(1000 * 1000 * 1000);
    });

    it('should reuse existing session for same user+conversation', async () => {
      const session1 = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      const session2 = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      expect(session1.id).toBe(session2.id);
    });
  });

  describe('getSession', () => {
    it('should return session by ID', async () => {
      const created = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      const retrieved = manager.getSession(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return undefined for non-existent session', () => {
      const session = manager.getSession('non-existent-id');
      expect(session).toBeUndefined();
    });
  });

  describe('findSessionByConversation', () => {
    it('should find session by user and conversation', async () => {
      await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      const found = manager.findSessionByConversation('user123', 'conv456');
      expect(found).toBeDefined();
      expect(found?.conversationId).toBe('conv456');
    });

    it('should return undefined for non-existent combination', () => {
      const found = manager.findSessionByConversation('nonuser', 'nonconv');
      expect(found).toBeUndefined();
    });
  });

  describe('getUserSessions', () => {
    it('should return all sessions for a user', async () => {
      await manager.createSession({
        userId: 'user1',
        conversationId: 'conv1',
      });
      await manager.createSession({
        userId: 'user1',
        conversationId: 'conv2',
      });

      const sessions = manager.getUserSessions('user1');
      expect(sessions).toHaveLength(2);
    });
  });

  describe('setSandbox', () => {
    it('should update sandbox info and set status to active', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      manager.setSandbox(session.id, 'sandbox-123', 'sprites');

      const updated = manager.getSession(session.id);
      expect(updated?.sandboxId).toBe('sandbox-123');
      expect(updated?.sandboxProvider).toBe('sprites');
      expect(updated?.status).toBe('active');
    });
  });

  describe('setNullclawEndpoint', () => {
    it('should update Nullclaw endpoint', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
        enableNullclaw: true,
      });

      manager.setNullclawEndpoint(session.id, 'http://nullclaw:3000');

      const updated = manager.getSession(session.id);
      expect(updated?.nullclawEndpoint).toBe('http://nullclaw:3000');
    });
  });

  describe('setMcpServerUrl', () => {
    it('should update MCP server URL', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
        enableMcp: true,
      });

      manager.setMcpServerUrl(session.id, 'http://localhost:8888');

      const updated = manager.getSession(session.id);
      expect(updated?.mcpServerUrl).toBe('http://localhost:8888');
    });
  });

  describe('updateActivity', () => {
    it('should update lastActivity timestamp', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      const before = session.lastActivity;
      await new Promise(r => setTimeout(r, 10));
      manager.updateActivity(session.id);

      const updated = manager.getSession(session.id);
      expect(updated?.lastActivity).toBeGreaterThanOrEqual(before);
    });

    it('should change status from idle to active', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      // Manually set to idle for testing
      session.status = 'idle';
      
      manager.updateActivity(session.id);
      
      const updated = manager.getSession(session.id);
      expect(updated?.status).toBe('active');
    });
  });

  describe('recordMetrics', () => {
    it('should record steps, commands, and file changes', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      manager.recordMetrics(session.id, 5, 10, 20, 30000, 1000);

      const metrics = manager['sessionMetrics'].get(session.id);
      expect(metrics?.steps).toBe(5);
      expect(metrics?.bashCommands).toBe(10);
      expect(metrics?.fileChanges).toBe(20);
      expect(metrics?.computeTimeMs).toBe(30000);
      expect(metrics?.storageBytes).toBe(1000);
    });
  });

  describe('checkQuota', () => {
    it('should allow when quota is available (enforcement disabled)', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
        quota: { computeMinutes: 60 },
      });

      // With enforcement disabled, always returns true
      const result = manager.checkQuota(session.id, 10, 1000);
      expect(result.allowed).toBe(true);
    });

    it('should allow regardless of usage when enforcement disabled', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
        quota: { computeMinutes: 10 },
      });

      // First request uses some quota
      manager.recordMetrics(session.id, 0, 0, 0, 8 * 60000); // 8 minutes

      // Second request - with enforcement off, still allowed
      const result = manager.checkQuota(session.id, 5, 0);
      expect(result.allowed).toBe(true);
    });

    it('should return true for non-existent when enforcement disabled', () => {
      const result = manager.checkQuota('non-existent', 10);
      expect(result.allowed).toBe(true); // Returns true when enforcement disabled
    });
  });

  describe('createCheckpoint', () => {
    it('should create checkpoint with ID and timestamp', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      const checkpoint = await manager.createCheckpoint(session.id, 'test-checkpoint');

      expect(checkpoint.checkpointId).toBeDefined();
      expect(checkpoint.timestamp).toBeDefined();
      expect(session.checkpointCount).toBe(1);
      expect(session.lastCheckpoint).toBe(checkpoint.timestamp);
    });

    it('should throw for non-existent session', async () => {
      await expect(manager.createCheckpoint('non-existent')).rejects.toThrow('Session not found');
    });
  });

  describe('stopSession', () => {
    it('should update session status to stopped', async () => {
      const session = await manager.createSession({
        userId: 'user123',
        conversationId: 'conv456',
      });

      await manager.stopSession(session.id);

      const updated = manager.getSession(session.id);
      expect(updated?.status).toBe('stopped');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await manager.createSession({ userId: 'user1', conversationId: 'conv1' });
      await manager.createSession({ userId: 'user1', conversationId: 'conv2' });
      await manager.createSession({ userId: 'user2', conversationId: 'conv3' });

      const stats = manager.getStats();

      expect(stats.totalSessions).toBe(3);
      expect(stats.totalUsers).toBe(2);
      expect(stats.globalQuota).toBeDefined();
    });
  });
});
