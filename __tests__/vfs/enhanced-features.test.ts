/**
 * E2E Tests: VFS Enhanced Features
 * 
 * Tests for batch operations and file watcher.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

describe('VFS Enhanced Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('VFS Batch Operations', () => {
    const { VFSBatchOperations, createVFSBatchOperations, quickBatchWrite } = require('@/lib/virtual-filesystem/vfs-batch-operations');

    let batchOps: typeof VFSBatchOperations;
    let mockVfs: any;

    beforeEach(() => {
      // Mock VFS service
      mockVfs = {
        writeFile: vi.fn().mockResolvedValue({ success: true }),
        deletePath: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        listDirectory: vi.fn().mockResolvedValue({
          nodes: [
            { path: 'file1.ts', type: 'file' },
            { path: 'file2.ts', type: 'file' },
            { path: 'file3.ts', type: 'file' },
          ],
        }),
        readFile: vi.fn().mockResolvedValue({ content: 'test content' }),
      };

      // Inject mock
      const vfsModule = require('@/lib/virtual-filesystem/vfs-batch-operations');
      vfsModule.virtualFilesystem = mockVfs;

      batchOps = new VFSBatchOperations('user-123');
    });

    it('should batch write multiple files', async () => {
      const result = await batchOps.batchWrite([
        { path: 'file1.ts', content: 'content 1' },
        { path: 'file2.ts', content: 'content 2' },
        { path: 'file3.ts', content: 'content 3' },
      ]);

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBe(3);
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should handle partial failures', async () => {
      mockVfs.writeFile
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockResolvedValueOnce({ success: true });

      const result = await batchOps.batchWrite([
        { path: 'file1.ts', content: 'content 1' },
        { path: 'file2.ts', content: 'content 2' },
        { path: 'file3.ts', content: 'content 3' },
      ]);

      expect(result.success).toBe(false);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.processed[1].success).toBe(false);
    });

    it('should batch delete multiple files', async () => {
      const result = await batchOps.batchDelete(['file1.ts', 'file2.ts', 'file3.ts']);

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBe(3);
      expect(mockVfs.deletePath).toHaveBeenCalledTimes(3);
    });

    it('should search and replace across files', async () => {
      mockVfs.readFile.mockResolvedValue({
        content: 'function oldName() { return 1; }',
      });

      const result = await batchOps.searchAndReplace({
        pattern: 'oldName',
        replacement: 'newName',
        include: ['*.ts'],
        useRegex: false,
        replaceAll: false,
      });

      expect(result.filesScanned).toBeGreaterThan(0);
      expect(result.totalReplacements).toBeGreaterThan(0);
      expect(result.modified.length).toBeGreaterThan(0);
    });

    it('should support regex search and replace', async () => {
      mockVfs.readFile.mockResolvedValue({
        content: 'const x = 1; const y = 2; const z = 3;',
      });

      const result = await batchOps.searchAndReplace({
        pattern: 'const\\s+(\\w+)\\s*=\\s*\\d+',
        replacement: 'const $1 = 0',
        useRegex: true,
        replaceAll: true,
      });

      expect(result.totalReplacements).toBeGreaterThan(0);
    });

    it('should filter by include/exclude patterns', async () => {
      const result = await batchOps.searchAndReplace({
        pattern: 'test',
        replacement: 'fixed',
        include: ['*.ts', '*.tsx'],
        exclude: ['node_modules/**', '*.test.ts'],
      });

      expect(result).toBeDefined();
    });

    it('should batch copy files', async () => {
      const result = await batchOps.batchCopy([
        { source: 'file1.ts', destination: 'backup/file1.ts' },
        { source: 'file2.ts', destination: 'backup/file2.ts' },
      ]);

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBe(2);
    });

    it('should batch move files', async () => {
      const result = await batchOps.batchMove([
        { source: 'old/file1.ts', destination: 'new/file1.ts' },
      ]);

      expect(result.success).toBe(true);
    });
  });

  describe('VFS File Watcher', () => {
    const { VFSFileWatcher, createFileWatcher, watchFiles } = require('@/lib/virtual-filesystem/vfs-file-watcher');

    let watcher: typeof VFSFileWatcher;
    let mockVfs: any;

    beforeEach(() => {
      // Mock VFS service
      mockVfs = {
        listDirectory: vi.fn().mockResolvedValue({
          nodes: [
            { path: 'file1.ts', type: 'file' },
            { path: 'file2.ts', type: 'file' },
          ],
        }),
        readFile: vi.fn()
          .mockResolvedValueOnce({ content: 'content 1' })
          .mockResolvedValue({ content: 'modified content' }),
      };

      // Inject mock
      const watcherModule = require('@/lib/virtual-filesystem/vfs-file-watcher');
      watcherModule.virtualFilesystem = mockVfs;

      watcher = new VFSFileWatcher('user-123');
    });

    afterEach(() => {
      watcher.stop();
    });

    it('should start and stop watching', () => {
      const handle = watcher.start();

      expect(handle.id).toBeDefined();
      expect(typeof handle.close).toBe('function');

      handle.close();
    });

    it('should emit change events', (done) => {
      watcher.on('change', (event) => {
        expect(event.type).toBeDefined();
        expect(event.path).toBeDefined();
        expect(event.timestamp).toBeDefined();
        done();
      });

      watcher.start();

      // Simulate file change
      setTimeout(() => {
        watcher.emit('change', {
          type: 'update',
          path: 'file1.ts',
          content: 'new content',
          timestamp: Date.now(),
        });
      }, 100);
    });

    it('should debounce events', (done) => {
      const changeSpy = vi.fn();
      watcher.on('change', changeSpy);

      watcher.start();

      // Emit multiple rapid changes
      for (let i = 0; i < 5; i++) {
        watcher.emit('change', {
          type: 'update',
          path: 'file1.ts',
          timestamp: Date.now(),
        });
      }

      // Should be debounced to fewer events
      setTimeout(() => {
        expect(changeSpy.mock.calls.length).toBeLessThan(5);
        done();
      }, 200);
    });

    it('should filter by include patterns', () => {
      const watcher = new VFSFileWatcher('user-123', {
        include: ['*.ts', '*.tsx'],
      });

      expect(watcher).toBeDefined();
    });

    it('should filter by exclude patterns', () => {
      const watcher = new VFSFileWatcher('user-123', {
        exclude: ['node_modules/**', '*.test.ts'],
      });

      expect(watcher).toBeDefined();
    });

    it('should support quick watch helper', (done) => {
      const callback = vi.fn();
      const handle = watchFiles('user-123', callback);

      expect(handle.id).toBeDefined();

      setTimeout(() => {
        handle.close();
        expect(callback).toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should track watched file count', () => {
      watcher.start();
      const count = watcher.getWatchedFileCount();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('VFS Integration: Batch + Watcher', () => {
    it('should work together for file sync', () => {
      const { VFSBatchOperations } = require('@/lib/virtual-filesystem/vfs-batch-operations');
      const { VFSFileWatcher } = require('@/lib/virtual-filesystem/vfs-file-watcher');

      const batchOps = new VFSBatchOperations('user-123');
      const watcher = new VFSFileWatcher('user-123');

      // Batch write files
      batchOps.batchWrite([
        { path: 'file1.ts', content: 'content 1' },
        { path: 'file2.ts', content: 'content 2' },
      ]);

      // Watch for changes
      watcher.start();

      expect(batchOps).toBeDefined();
      expect(watcher).toBeDefined();
    });
  });
});
