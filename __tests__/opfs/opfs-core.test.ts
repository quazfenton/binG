/**
 * OPFS Core Unit Tests
 * 
 * Tests for the OPFS Core service
 * Note: These tests require a browser environment with OPFS support
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OPFSCore, OPFSError, opfsCore } from '@/lib/virtual-filesystem/opfs/opfs-core';

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
        persist: vi.fn().mockResolvedValue(true),
        getDirectory: vi.fn().mockResolvedValue({}),
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

describe('OPFSCore', () => {
  describe('isSupported', () => {
    it('should return true when storage API is available', () => {
      expect(OPFSCore.isSupported()).toBe(true);
    });

    it('should return false when storage API is not available', () => {
      // Temporarily remove storage API from navigator
      const originalStorage = (global.navigator as any).storage;
      (global.navigator as any).storage = undefined;

      expect(OPFSCore.isSupported()).toBe(false);

      // Restore
      (global.navigator as any).storage = originalStorage;
    });

    it('should return false in server-side environment', () => {
      // Temporarily remove window
      const originalWindow = global.window;
      (global as any).window = undefined;
      
      expect(OPFSCore.isSupported()).toBe(false);
      
      // Restore
      global.window = originalWindow;
    });
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const core = new OPFSCore();
      expect(core).toBeDefined();
      expect(core.isInitialized()).toBe(false);
    });

    it('should create instance with custom options', () => {
      const core = new OPFSCore({
        rootName: 'custom-root',
        maxCacheSize: 500,
        enableHandleCaching: false,
      });
      expect(core).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize successfully with valid workspace ID', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      expect(core.isInitialized()).toBe(true);
      expect(core.getWorkspaceId()).toBe('test-workspace');
      expect(mockStorage.getDirectory).toHaveBeenCalledWith('vfs-workspace/test-workspace');
    });

    it('should throw error when storage API is not available', async () => {
      const originalStorage = (global.window as any).storage;
      (global.window as any).storage = undefined;
      
      const core = new OPFSCore();
      await expect(core.initialize('test')).rejects.toThrow('OPFS not supported');
      
      (global.window as any).storage = originalStorage;
    });

    it('should emit initialized event', async () => {
      const core = new OPFSCore();
      const eventHandler = vi.fn();
      core.on('initialized', eventHandler);
      
      await core.initialize('test-workspace');
      
      expect(eventHandler).toHaveBeenCalledWith({ workspaceId: 'test-workspace' });
    });

    it('should not reinitialize with same workspace ID', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      // Reset mock to verify it's not called again
      mockStorage.getDirectory.mockClear();
      
      await core.initialize('test-workspace');
      
      expect(mockStorage.getDirectory).not.toHaveBeenCalled();
    });
  });

  describe('readFile', () => {
    it('should read file content successfully', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const result = await core.readFile('test.txt');
      
      expect(result.content).toBe('test content');
      expect(result.size).toBe(12);
      expect(typeof result.lastModified).toBe('number');
    });

    it('should throw error when not initialized', async () => {
      const core = new OPFSCore();
      
      await expect(core.readFile('test.txt')).rejects.toThrow('OPFS not initialized');
    });

    it('should emit read event', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const eventHandler = vi.fn();
      core.on('read', eventHandler);
      
      await core.readFile('test.txt');
      
      expect(eventHandler).toHaveBeenCalledWith({ path: 'test.txt', size: 12 });
    });
  });

  describe('writeFile', () => {
    it('should write file content successfully', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const result = await core.writeFile('test.txt', 'new content');
      
      expect(result.path).toBe('test.txt');
      expect(typeof result.size).toBe('number');
      expect(typeof result.lastModified).toBe('number');
    });

    it('should throw error when not initialized', async () => {
      const core = new OPFSCore();
      
      await expect(core.writeFile('test.txt', 'content')).rejects.toThrow('OPFS not initialized');
    });

    it('should emit write event', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const eventHandler = vi.fn();
      core.on('write', eventHandler);
      
      await core.writeFile('test.txt', 'content');
      
      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe('deleteFile', () => {
    it('should delete file successfully', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      await core.deleteFile('test.txt');
      
      expect(mockDirHandle.removeEntry).toHaveBeenCalledWith('test.txt');
    });

    it('should not throw when file does not exist', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      // Mock NotFoundError
      mockDirHandle.removeEntry.mockRejectedValueOnce({ name: 'NotFoundError' });
      
      await expect(core.deleteFile('nonexistent.txt')).resolves.toBeUndefined();
    });

    it('should emit delete event', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const eventHandler = vi.fn();
      core.on('delete', eventHandler);
      
      await core.deleteFile('test.txt');
      
      expect(eventHandler).toHaveBeenCalledWith({ path: 'test.txt' });
    });
  });

  describe('createDirectory', () => {
    it('should create directory successfully', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      await core.createDirectory('test-dir');
      
      expect(mockDirHandle.getDirectoryHandle).toHaveBeenCalledWith('test-dir', { create: true });
    });

    it('should create directories recursively', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      await core.createDirectory('parent/child', { recursive: true });
      
      expect(mockDirHandle.getDirectoryHandle).toHaveBeenCalled();
    });

    it('should emit mkdir event', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const eventHandler = vi.fn();
      core.on('mkdir', eventHandler);
      
      await core.createDirectory('test-dir');
      
      expect(eventHandler).toHaveBeenCalledWith({ path: 'test-dir' });
    });
  });

  describe('listDirectory', () => {
    it('should list directory contents successfully', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const entries = await core.listDirectory('');
      
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('test.txt');
      expect(entries[0].type).toBe('file');
    });

    it('should return empty array for empty directory', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      // Mock empty directory
      mockDirHandle.entries.mockImplementation(async function* () {});
      
      const entries = await core.listDirectory('');
      
      expect(entries).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return storage statistics', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const stats = await core.getStats();
      
      expect(stats.totalFiles).toBeGreaterThanOrEqual(0);
      expect(stats.totalDirectories).toBeGreaterThanOrEqual(0);
      expect(stats.totalSize).toBeGreaterThanOrEqual(0);
      expect(stats.availableSpace).toBeGreaterThan(0);
      expect(stats.quotaUsage).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clear', () => {
    it('should clear all workspace data', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      // Mock directory with entries
      mockDirHandle.entries.mockImplementation(async function* () {
        yield ['test.txt', mockFileHandle];
      });
      
      await core.clear();
      
      expect(mockDirHandle.removeEntry).toHaveBeenCalledWith('test.txt', { recursive: true });
    });

    it('should emit clear event', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const eventHandler = vi.fn();
      core.on('clear', eventHandler);
      
      await core.clear();
      
      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should close connection and clear resources', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      await core.close();
      
      expect(core.isInitialized()).toBe(false);
      expect(core.getWorkspaceId()).toBeNull();
    });

    it('should emit close event', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const eventHandler = vi.fn();
      core.on('close', eventHandler);
      
      await core.close();
      
      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const exists = await core.fileExists('test.txt');
      
      expect(exists).toBe(true);
    });

    it('should return false for non-existing file', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      mockDirHandle.getFileHandle.mockRejectedValueOnce(new Error('Not found'));
      
      const exists = await core.fileExists('nonexistent.txt');
      
      expect(exists).toBe(false);
    });
  });

  describe('directoryExists', () => {
    it('should return true for existing directory', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      const exists = await core.directoryExists('test-dir');
      
      expect(exists).toBe(true);
    });

    it('should return false for non-existing directory', async () => {
      const core = new OPFSCore();
      await core.initialize('test-workspace');
      
      mockDirHandle.getDirectoryHandle.mockRejectedValueOnce(new Error('Not found'));
      
      const exists = await core.directoryExists('nonexistent-dir');
      
      expect(exists).toBe(false);
    });
  });
});

describe('OPFSError', () => {
  it('should create error with message', () => {
    const error = new OPFSError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('OPFSError');
  });

  it('should create error with cause', () => {
    const cause = new Error('Cause');
    const error = new OPFSError('Test error', cause);
    expect(error.message).toContain('Cause');
    expect(error.cause).toBe(cause);
  });
});

describe('opfsCore singleton', () => {
  it('should export singleton instance', () => {
    expect(opfsCore).toBeDefined();
    expect(opfsCore).toBeInstanceOf(OPFSCore);
  });
});
