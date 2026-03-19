/**
 * OPFS Adapter Integration Tests
 * 
 * Tests for the OPFS Adapter service
 * Note: These tests require a browser environment with OPFS support
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OPFSAdapter, opfsAdapter } from '@/lib/virtual-filesystem/opfs/opfs-adapter';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import type { VirtualFile } from '@/lib/virtual-filesystem/filesystem-types';

// Mock virtualFilesystem
vi.mock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
  virtualFilesystem: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    deletePath: vi.fn(),
    exportWorkspace: vi.fn(),
  },
}));

// Mock browser storage API
const mockFileHandle = {
  getFile: vi.fn().mockResolvedValue({
    text: vi.fn().mockResolvedValue('test content'),
    size: 12,
    lastModified: Date.now(),
  }),
  createWritable: vi.fn().mockResolvedValue({
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }),
};

const mockDirHandle = {
  getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
  getDirectoryHandle: vi.fn().mockResolvedValue({}),
  removeEntry: vi.fn().mockResolvedValue(undefined),
  entries: vi.fn().mockImplementation(async function* () {
    yield ['test.txt', mockFileHandle];
  }),
};

const mockStorage = {
  getDirectory: vi.fn().mockResolvedValue(mockDirHandle),
};

// Set up global mocks
beforeEach(() => {
  vi.clearAllMocks();

  // Mock window.storage (for legacy reference)
  Object.defineProperty(global, 'window', {
    value: {
      storage: mockStorage,
    },
    writable: true,
  });

  // Mock navigator.storage (primary OPFS API)
  Object.defineProperty(global, 'navigator', {
    value: {
      storage: {
        ...mockStorage,
        estimate: vi.fn().mockResolvedValue({
          quota: 1000000000,
          usage: 1000000,
        }),
      },
      userAgent: 'Chrome/120.0.0.0',
      onLine: true,
    },
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OPFSAdapter', () => {
  describe('constructor', () => {
    it('should create instance with default options', () => {
      const adapter = new OPFSAdapter();
      expect(adapter).toBeDefined();
      expect(adapter.isEnabled()).toBe(false);
    });

    it('should create instance with custom options', () => {
      const adapter = new OPFSAdapter({
        autoSync: false,
        autoSyncInterval: 60000,
        maxQueueSize: 50,
      });
      expect(adapter).toBeDefined();
    });
  });

  describe('isSupported', () => {
    it('should return true when OPFS is available', () => {
      expect(OPFSAdapter.isSupported()).toBe(true);
    });

    it('should return false when OPFS is not available', () => {
      const originalStorage = (global.navigator as any).storage;
      (global.navigator as any).storage = undefined;

      expect(OPFSAdapter.isSupported()).toBe(false);

      (global.navigator as any).storage = originalStorage;
    });
  });

  describe('enable', () => {
    it('should enable OPFS successfully', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      
      expect(adapter.isEnabled()).toBe(true);
      expect(mockStorage.getDirectory).toHaveBeenCalledWith('vfs-workspace/test-user');
    });

    it('should throw error when OPFS is not supported', async () => {
      const originalStorage = (global.window as any).storage;
      (global.window as any).storage = undefined;
      
      const adapter = new OPFSAdapter();
      await expect(adapter.enable('test-user')).rejects.toThrow('OPFS not supported');
      
      (global.window as any).storage = originalStorage;
    });

    it('should use custom workspace ID if provided', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user', 'custom-workspace');
      
      expect(mockStorage.getDirectory).toHaveBeenCalledWith('vfs-workspace/custom-workspace');
    });
  });

  describe('disable', () => {
    it('should disable OPFS successfully', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      await adapter.disable();
      
      expect(adapter.isEnabled()).toBe(false);
    });
  });

  describe('readFile', () => {
    it('should read from OPFS when enabled and file exists', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      
      const file = await adapter.readFile('test-user', 'test.txt');
      
      expect(file.content).toBe('test content');
      expect(file.path).toBe('test.txt');
    });

    it('should fallback to server when OPFS is not enabled', async () => {
      vi.mocked(virtualFilesystem.readFile).mockResolvedValue({
        path: 'test.txt',
        content: 'server content',
        language: 'text',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 14,
      });
      
      const adapter = new OPFSAdapter();
      const file = await adapter.readFile('test-user', 'test.txt');
      
      expect(file.content).toBe('server content');
      expect(virtualFilesystem.readFile).toHaveBeenCalledWith('test-user', 'test.txt');
    });

    it('should fallback to server when file not in OPFS', async () => {
      vi.mocked(virtualFilesystem.readFile).mockResolvedValue({
        path: 'test.txt',
        content: 'server content',
        language: 'text',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 14,
      });
      
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      
      // Mock file not found in OPFS
      mockDirHandle.getFileHandle.mockRejectedValueOnce(new Error('Not found'));
      
      const file = await adapter.readFile('test-user', 'test.txt');
      
      expect(file.content).toBe('server content');
    });
  });

  describe('writeFile', () => {
    it('should write to OPFS and queue server sync when enabled', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      
      const file = await adapter.writeFile('test-user', 'test.txt', 'new content');
      
      expect(file.path).toBe('test.txt');
      expect(file.content).toBe('new content');
    });

    it('should write directly to server when not enabled', async () => {
      vi.mocked(virtualFilesystem.writeFile).mockResolvedValue({
        path: 'test.txt',
        content: 'content',
        language: 'text',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 7,
      });
      
      const adapter = new OPFSAdapter();
      const file = await adapter.writeFile('test-user', 'test.txt', 'content');
      
      expect(virtualFilesystem.writeFile).toHaveBeenCalledWith('test-user', 'test.txt', 'content', undefined);
    });
  });

  describe('syncFromServer', () => {
    it('should sync files from server to OPFS', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      
      // Mock server workspace export
      vi.mocked(virtualFilesystem.exportWorkspace).mockResolvedValue({
        root: 'project',
        version: 1,
        updatedAt: new Date().toISOString(),
        files: [
          {
            path: 'file1.txt',
            content: 'content 1',
            language: 'text',
            lastModified: new Date().toISOString(),
            version: 1,
            size: 9,
          },
          {
            path: 'file2.txt',
            content: 'content 2',
            language: 'text',
            lastModified: new Date().toISOString(),
            version: 1,
            size: 9,
          },
        ],
      });
      
      const result = await adapter.syncFromServer('test-user');
      
      expect(result.success).toBe(true);
      expect(result.filesSynced).toBe(2);
    });

    it('should detect conflicts when OPFS has newer version', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      
      // Simulate OPFS having newer version
      (adapter as any).fileVersions.set('file1.txt', { opfs: 3, server: 1 });
      
      vi.mocked(virtualFilesystem.exportWorkspace).mockResolvedValue({
        root: 'project',
        version: 1,
        updatedAt: new Date().toISOString(),
        files: [
          {
            path: 'file1.txt',
            content: 'old content',
            language: 'text',
            lastModified: new Date().toISOString(),
            version: 1,
            size: 9,
          },
        ],
      });
      
      const result = await adapter.syncFromServer('test-user');
      
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].path).toBe('file1.txt');
      expect(result.conflicts[0].resolution).toBe('manual');
    });
  });

  describe('queueWrite', () => {
    it('should queue write operation', async () => {
      const adapter = new OPFSAdapter({ autoSync: false });
      await adapter.enable('test-user');
      
      adapter.queueWrite('test-user', 'test.txt', 'content', 1);
      
      expect(adapter.getPendingChangesCount()).toBe(1);
    });

    it('should respect max queue size', async () => {
      const adapter = new OPFSAdapter({ autoSync: false, maxQueueSize: 3 });
      await adapter.enable('test-user');
      
      // Add more than max queue size
      adapter.queueWrite('test-user', 'file1.txt', 'content', 1);
      adapter.queueWrite('test-user', 'file2.txt', 'content', 1);
      adapter.queueWrite('test-user', 'file3.txt', 'content', 1);
      adapter.queueWrite('test-user', 'file4.txt', 'content', 1);
      
      expect(adapter.getPendingChangesCount()).toBe(3);
    });
  });

  describe('flushWriteQueue', () => {
    it('should flush queued writes to server', async () => {
      vi.mocked(virtualFilesystem.writeFile).mockResolvedValue({
        path: 'test.txt',
        content: 'content',
        language: 'text',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 7,
      });
      
      const adapter = new OPFSAdapter({ autoSync: false });
      await adapter.enable('test-user');
      
      adapter.queueWrite('test-user', 'test.txt', 'content', 1);
      await adapter.flushWriteQueue('test-user');
      
      expect(virtualFilesystem.writeFile).toHaveBeenCalledWith('test-user', 'test.txt', 'content');
      expect(adapter.getPendingChangesCount()).toBe(0);
    });

    it('should not flush when queue is empty', async () => {
      const adapter = new OPFSAdapter({ autoSync: false });
      await adapter.enable('test-user');
      
      await adapter.flushWriteQueue('test-user');
      
      expect(virtualFilesystem.writeFile).not.toHaveBeenCalled();
    });

    it('should not flush when sync is already in progress', async () => {
      const adapter = new OPFSAdapter({ autoSync: false });
      await adapter.enable('test-user');
      
      adapter.queueWrite('test-user', 'test.txt', 'content', 1);
      
      // Start first flush
      const firstFlush = adapter.flushWriteQueue('test-user');
      
      // Try second flush immediately
      await adapter.flushWriteQueue('test-user');
      
      expect(virtualFilesystem.writeFile).toHaveBeenCalledTimes(1);
      
      await firstFlush;
    });
  });

  describe('getSyncStatus', () => {
    it('should return current sync status', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      
      const status = adapter.getSyncStatus();
      
      expect(status).toBeDefined();
      expect(typeof status.isSyncing).toBe('boolean');
      expect(typeof status.pendingChanges).toBe('number');
      expect(typeof status.isOnline).toBe('boolean');
      expect(status.opfsSupported).toBe(true);
    });
  });

  describe('getFileVersions', () => {
    it('should return version info for tracked file', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      
      // Simulate version tracking
      (adapter as any).fileVersions.set('test.txt', { opfs: 3, server: 2 });
      
      const versions = adapter.getFileVersions('test.txt');
      
      expect(versions).toEqual({ opfs: 3, server: 2 });
    });

    it('should return null for untracked file', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      
      const versions = adapter.getFileVersions('nonexistent.txt');
      
      expect(versions).toBeNull();
    });
  });

  describe('clearVersionTracking', () => {
    it('should clear all version tracking data', async () => {
      const adapter = new OPFSAdapter();
      await adapter.enable('test-user');
      
      // Simulate version tracking
      (adapter as any).fileVersions.set('file1.txt', { opfs: 1, server: 1 });
      (adapter as any).fileVersions.set('file2.txt', { opfs: 2, server: 1 });
      
      adapter.clearVersionTracking();
      
      expect(adapter.getFileVersions('file1.txt')).toBeNull();
      expect(adapter.getFileVersions('file2.txt')).toBeNull();
    });
  });
});

describe('opfsAdapter singleton', () => {
  it('should export singleton instance', () => {
    expect(opfsAdapter).toBeDefined();
    expect(opfsAdapter).toBeInstanceOf(OPFSAdapter);
  });
});
