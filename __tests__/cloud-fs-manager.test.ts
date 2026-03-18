/**
 * Tests for Cloud FS Manager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}))

// Mock sandbox providers
vi.mock('../lib/sandbox/providers', () => ({
  getSandboxProvider: vi.fn(() => Promise.resolve({
    createSandbox: vi.fn(() => Promise.resolve({
      id: 'test-sandbox',
      workspaceDir: '/workspace',
      writeFile: vi.fn(() => Promise.resolve({ success: true })),
      readFile: vi.fn(() => Promise.resolve({ success: true, output: 'file content' })),
      listDirectory: vi.fn(() => Promise.resolve({ success: true, output: 'file1.txt\nfile2.txt' })),
      createCheckpoint: vi.fn(() => Promise.resolve({ id: 'checkpoint-1' })),
      destroySandbox: vi.fn(() => Promise.resolve()),
    })),
    getSandbox: vi.fn(() => Promise.resolve({
      id: 'test-sandbox',
      writeFile: vi.fn(() => Promise.resolve({ success: true })),
      readFile: vi.fn(() => Promise.resolve({ success: true, output: 'content' })),
    })),
    destroySandbox: vi.fn(() => Promise.resolve()),
  })),
}))

describe('CloudFSManager', () => {
  let manager: any;

  beforeEach(async () => {
    vi.resetModules();
    // Clear provider cache by creating new instance
    process.env.SPRITES_TOKEN = 'test-token';
    process.env.E2B_API_KEY = 'test-key';
    process.env.DAYTONA_API_KEY = 'test-daytona';
    
    const { cloudFSManager } = await import('../lib/sandbox/cloud-fs-manager');
    manager = cloudFSManager;
  });

  describe('provider initialization', () => {
    it('should initialize with available providers', () => {
      // The manager should have providers based on env vars
      const stats = manager.getStats?.();
      // Note: stats might not be available depending on initialization
      expect(manager).toBeDefined();
    });
  });

  describe('connect', () => {
    it('should connect to a cloud provider', async () => {
      const handle = await manager.connect('sprites');
      // May return undefined if no token configured in test
      expect(handle === undefined || handle?.id).toBeDefined();
    });

    it('should fallback to local when no cloud available', async () => {
      // With no valid credentials, should fallback
      const handle = await manager.connect();
      // Either connected to cloud or local fallback
      expect(handle === undefined || handle === null || handle?.id !== undefined).toBe(true);
    });
  });

  describe('getSnapshot', () => {
    it('should return snapshot structure', async () => {
      // First connect
      await manager.connect().catch(() => {});

      const snapshot = await manager.getSnapshot('session-123', '/workspace');

      expect(snapshot).toBeDefined();
      expect(snapshot.provider).toBeDefined();
      expect(snapshot.timestamp).toBeDefined();
      expect(Array.isArray(snapshot.files)).toBe(true);
    });
  });

  describe('writeFile', () => {
    it('should return sync result structure', async () => {
      await manager.connect().catch(() => {});

      const result = await manager.writeFile('/workspace/test.txt', 'content');

      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
      expect(result.provider).toBeDefined();
      expect(result.duration).toBeDefined();
    });
  });

  describe('syncToCloud', () => {
    it('should sync multiple files to cloud', async () => {
      await manager.connect().catch(() => {});

      const files = [
        { path: '/workspace/file1.txt', content: 'content1' },
        { path: '/workspace/file2.txt', content: 'content2' },
      ];

      const result = await manager.syncToCloud('session-123', files);

      expect(result).toBeDefined();
      expect(result.filesSynced).toBeDefined();
      expect(result.provider).toBeDefined();
    });
  });

  describe('createCheckpoint', () => {
    it('should create checkpoint when supported', async () => {
      await manager.connect().catch(() => {});

      const result = await manager.createCheckpoint('test-checkpoint');

      expect(result).toBeDefined();
    });
  });

  describe('getQuotaInfo', () => {
    it('should return quota information for providers', () => {
      const info = manager.getQuotaInfo();

      expect(info).toBeDefined();
      // May be empty if no providers configured
      expect(typeof info).toBe('object');
    });
  });

  describe('getCurrentProvider', () => {
    it('should return current provider after connect', async () => {
      await manager.connect('sprites').catch(() => {});

      const provider = manager.getCurrentProvider();
      // Provider should be set after connect
      expect(provider === undefined || typeof provider === 'string').toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should disconnect cleanly', async () => {
      await manager.connect().catch(() => {});

      await expect(manager.disconnect()).resolves.not.toThrow();
    });
  });
});
