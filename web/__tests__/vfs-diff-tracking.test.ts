/**
 * VFS Diff Tracking Tests
 * 
 * Tests for filesystem diff tracking, rollback, and LLM context integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { diffTracker } from '@/lib/virtual-filesystem/filesystem-diffs';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

describe('FilesystemDiffTracker', () => {
  const testOwner = 'default';

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

      // Don't pass ownerId explicitly - uses default 'default'
      const diff = diffTracker.trackChange(file);

      expect(diff.path).toBe('/test/file.ts');
      expect(diff.changeType).toBe('create');
      expect(diff.newContent).toBe('export const hello = "world";');
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
      // trackDeletion signature: (path, previousContent, ownerId)
      const diff = diffTracker.trackDeletion('/test/file.ts', file.content);

      expect(diff.changeType).toBe('delete');
      expect(diff.oldContent).toBe('export const hello = "world";');
    });
  });

  describe('getDiffSummary', () => {
    it('should return summary object when no changes', () => {
      const summary = diffTracker.getDiffSummary(testOwner);
      // getDiffSummary returns a structured object, not a formatted string
      expect(summary).toEqual({
        changedFiles: [],
        totalChanges: 0,
        creates: 0,
        updates: 0,
        deletes: 0,
      });
    });

    it('should return structured summary with changes', () => {
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
        content: 'original content',
        language: 'typescript',
        lastModified: new Date().toISOString(),
        version: 1,
        size: 16,
      };

      const file2Update = {
        ...file2,
        content: 'modified content',
        version: 2,
      };

      // Don't pass ownerId - uses default
      diffTracker.trackChange(file1);
      diffTracker.trackChange(file2);
      diffTracker.trackChange(file2Update);

      const summary = diffTracker.getDiffSummary();

      // getDiffSummary returns a structured object
      expect(summary.totalChanges).toBe(2);
      expect(summary.creates).toBe(1);
      expect(summary.updates).toBe(1);
      expect(summary.changedFiles).toContain('/test/created.ts');
      expect(summary.changedFiles).toContain('/test/modified.ts');
    });
  });
});

describe('VirtualFilesystemService - Diff Integration', () => {
  const testOwnerId = 'test-user-diff';
  const root = 'project'; // Default workspace root

  beforeEach(async () => {
    await virtualFilesystem.clearWorkspace(testOwnerId);
    diffTracker.clear();
  });

  describe('getDiffSummary', () => {
    it('should return diff summary for owner', async () => {
      await virtualFilesystem.writeFile(testOwnerId, 'file1.ts', 'content 1');
      await virtualFilesystem.writeFile(testOwnerId, 'file2.ts', 'content 2');

      const summary = virtualFilesystem.getDiffSummary(testOwnerId);

      // virtualFilesystem.getDiffSummary() returns JSON.stringify(structured object)
      expect(summary).not.toBe(JSON.stringify({ changedFiles: [], totalChanges: 0, creates: 0, updates: 0, deletes: 0 }));
      expect(summary).toContain(`${root}/file1.ts`);
      expect(summary).toContain(`${root}/file2.ts`);
    });
  });

  describe('rollbackToVersion', () => {
    it('should rollback files to target version', async () => {
      await virtualFilesystem.writeFile(testOwnerId, 'rollback.ts', 'version 1');
      await virtualFilesystem.writeFile(testOwnerId, 'rollback.ts', 'version 2');
      await virtualFilesystem.writeFile(testOwnerId, 'rollback.ts', 'version 3');

      const result = await virtualFilesystem.rollbackToVersion(testOwnerId, 1);

      expect(result.success).toBe(true);
      expect(result.restoredFiles).toBe(1);
      
      const file = await virtualFilesystem.readFile(testOwnerId, 'rollback.ts');
      expect(file.content).toBe('version 1');
    });
  });

  describe('getFilesAtVersion', () => {
    it('should return files at specific version', async () => {
      await virtualFilesystem.writeFile(testOwnerId, 'v1.ts', 'content v1');
      await virtualFilesystem.writeFile(testOwnerId, 'v1.ts', 'content v2');

      const files = virtualFilesystem.getFilesAtVersion(testOwnerId, 1);

      // Path should include workspace root
      const expectedPath = `${root}/v1.ts`;
      expect(files.has(expectedPath)).toBe(true);
      expect(files.get(expectedPath)).toBe('content v1');
    });
  });
});
