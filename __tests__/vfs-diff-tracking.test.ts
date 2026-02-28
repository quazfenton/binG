/**
 * VFS Diff Tracking Tests
 * 
 * Tests for filesystem diff tracking, rollback, and LLM context integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { diffTracker, FilesystemDiffTracker } from '@/lib/virtual-filesystem/filesystem-diffs';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

describe('FilesystemDiffTracker', () => {
  beforeEach(() => {
    diffTracker.clear();
  });

  describe('trackChange', () => {
    it('should track file creation', () => {
      const file = {
        path: '/test/file.ts',
        content: 'export const hello = "world";',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 30,
      };

      const diff = diffTracker.trackChange(file);

      expect(diff.path).toBe('/test/file.ts');
      expect(diff.changeType).toBe('create');
      expect(diff.newContent).toBe('export const hello = "world";');
      expect(diff.oldContent).toBe('');
    });

    it('should track file update', () => {
      const file1 = {
        path: '/test/file.ts',
        content: 'const x = 1;',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 12,
      };

      const file2 = {
        ...file1,
        content: 'const x = 2;',
        version: 2,
        size: 12,
      };

      diffTracker.trackChange(file1);
      const diff = diffTracker.trackChange(file2);

      expect(diff.changeType).toBe('update');
      expect(diff.oldContent).toBe('const x = 1;');
      expect(diff.newContent).toBe('const x = 2;');
    });

    it('should compute hunks for changes', () => {
      const oldFile = {
        path: '/test/file.ts',
        content: 'line 1\nline 2\nline 3\nline 4\nline 5',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 30,
      };

      const newFile = {
        ...oldFile,
        content: 'line 1\nline 2 modified\nline 3\nline 4\nline 5',
        version: 2,
        size: 30,
      };

      diffTracker.trackChange(oldFile);
      const diff = diffTracker.trackChange(newFile);

      expect(diff.hunks).toBeDefined();
      expect(diff.hunks!.length).toBeGreaterThan(0);
      expect(diff.hunks![0].lines.some(l => l.startsWith('-'))).toBe(true);
      expect(diff.hunks![0].lines.some(l => l.startsWith('+'))).toBe(true);
    });
  });

  describe('trackDeletion', () => {
    it('should track file deletion', () => {
      const file = {
        path: '/test/file.ts',
        content: 'export const hello = "world";',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 30,
      };

      diffTracker.trackChange(file);
      const diff = diffTracker.trackDeletion('/test/file.ts', file.content);

      expect(diff.path).toBe('/test/file.ts');
      expect(diff.changeType).toBe('delete');
      expect(diff.oldContent).toBe('export const hello = "world";');
      expect(diff.newContent).toBe('');
    });
  });

  describe('getDiffSummary', () => {
    it('should return summary when no changes', () => {
      const summary = diffTracker.getDiffSummary();
      expect(summary).toBe('No file changes detected.');
    });

    it('should return formatted summary with changes', () => {
      const file1 = {
        path: '/test/created.ts',
        content: 'new file content',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 16,
      };

      const file2 = {
        path: '/test/modified.ts',
        content: 'modified content',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 16,
      };

      diffTracker.trackChange(file1);
      diffTracker.trackChange(file2);

      const summary = diffTracker.getDiffSummary();

      expect(summary).toContain('File Changes Summary');
      expect(summary).toContain('2 files modified');
      expect(summary).toContain('📄 Created: /test/created.ts');
      expect(summary).toContain('✏️ Modified: /test/modified.ts');
    });

    it('should include diff hunks in summary', () => {
      const oldFile = {
        path: '/test/file.ts',
        content: 'line 1\nline 2\nline 3',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 20,
      };

      const newFile = {
        ...oldFile,
        content: 'line 1\nline 2 changed\nline 3',
        version: 2,
        size: 20,
      };

      diffTracker.trackChange(oldFile);
      diffTracker.trackChange(newFile);

      const summary = diffTracker.getDiffSummary();

      expect(summary).toContain('```diff');
      expect(summary).toContain('-line 2');
      expect(summary).toContain('+line 2 changed');
    });
  });

  describe('getFilesAtVersion', () => {
    it('should return files at specific version', () => {
      const file1 = {
        path: '/test/file.ts',
        content: 'version 1',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 9,
      };

      const file2 = {
        ...file1,
        content: 'version 2',
        version: 2,
        size: 9,
      };

      const file3 = {
        ...file1,
        content: 'version 3',
        version: 3,
        size: 9,
      };

      diffTracker.trackChange(file1);
      diffTracker.trackChange(file2);
      diffTracker.trackChange(file3);

      const filesAtV1 = diffTracker.getFilesAtVersion(1);
      expect(filesAtV1.get('/test/file.ts')).toBe('version 1');

      const filesAtV2 = diffTracker.getFilesAtVersion(2);
      expect(filesAtV2.get('/test/file.ts')).toBe('version 2');
    });

    it('should handle deleted files', () => {
      const file = {
        path: '/test/file.ts',
        content: 'content',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 7,
      };

      diffTracker.trackChange(file);
      diffTracker.trackDeletion('/test/file.ts', file.content);

      const filesAtV1 = diffTracker.getFilesAtVersion(1);
      expect(filesAtV1.get('/test/file.ts')).toBe('content');

      const filesAtV2 = diffTracker.getFilesAtVersion(2);
      expect(filesAtV2.has('/test/file.ts')).toBe(false);
    });
  });

  describe('getRollbackOperations', () => {
    it('should return operations to rollback to version', () => {
      const file1 = {
        path: '/test/file.ts',
        content: 'v1',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 2,
      };

      const file2 = {
        ...file1,
        content: 'v2',
        version: 2,
        size: 2,
      };

      const file3 = {
        ...file1,
        content: 'v3',
        version: 3,
        size: 2,
      };

      diffTracker.trackChange(file1);
      diffTracker.trackChange(file2);
      diffTracker.trackChange(file3);

      const operations = diffTracker.getRollbackOperations(1);

      expect(operations.length).toBe(1);
      expect(operations[0].path).toBe('/test/file.ts');
      expect(operations[0].operation).toBe('restore');
      expect(operations[0].content).toBe('v1');
      expect(operations[0].targetVersion).toBe(1);
    });

    it('should return delete operation for deleted file', () => {
      const file = {
        path: '/test/file.ts',
        content: 'content',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 7,
      };

      diffTracker.trackChange(file);
      diffTracker.trackDeletion('/test/file.ts', file.content);

      const operations = diffTracker.getRollbackOperations(1);

      expect(operations.length).toBe(1);
      expect(operations[0].operation).toBe('delete');
    });
  });
});

describe('VirtualFilesystemService - Diff Integration', () => {
  const testOwnerId = 'test-user-diff';

  beforeEach(() => {
    diffTracker.clear();
  });

  describe('getDiffSummary', () => {
    it('should return diff summary for owner', async () => {
      await virtualFilesystem.writeFile(testOwnerId, '/test/file1.ts', 'content 1');
      await virtualFilesystem.writeFile(testOwnerId, '/test/file2.ts', 'content 2');

      const summary = virtualFilesystem.getDiffSummary(testOwnerId);

      expect(summary).not.toBe('No file changes detected.');
      expect(summary).toContain('file1.ts');
      expect(summary).toContain('file2.ts');
    });
  });

  describe('rollbackToVersion', () => {
    it('should rollback files to target version', async () => {
      // Create version 1
      await virtualFilesystem.writeFile(testOwnerId, '/test/rollback.ts', 'version 1');
      
      // Update to version 2
      await virtualFilesystem.writeFile(testOwnerId, '/test/rollback.ts', 'version 2');
      
      // Update to version 3
      await virtualFilesystem.writeFile(testOwnerId, '/test/rollback.ts', 'version 3');

      // Rollback to version 1
      const result = await virtualFilesystem.rollbackToVersion(testOwnerId, 1);

      expect(result.success).toBe(true);
      expect(result.restoredFiles).toBe(1);
      
      // Verify content is rolled back
      const file = await virtualFilesystem.readFile(testOwnerId, '/test/rollback.ts');
      expect(file.content).toBe('version 1');
    });

    it('should handle rollback with errors', async () => {
      // Try to rollback non-existent version
      const result = await virtualFilesystem.rollbackToVersion(testOwnerId, 999);

      // Should not fail, just no operations
      expect(result.success).toBe(true);
    });
  });

  describe('getFilesAtVersion', () => {
    it('should return files at specific version', async () => {
      await virtualFilesystem.writeFile(testOwnerId, '/test/v1.ts', 'content v1');
      await virtualFilesystem.writeFile(testOwnerId, '/test/v1.ts', 'content v2');

      const files = virtualFilesystem.getFilesAtVersion(testOwnerId, 1);
      
      expect(files.has('/test/v1.ts')).toBe(true);
      expect(files.get('/test/v1.ts')).toBe('content v1');
    });
  });
});
