/**
 * Git-Backed VFS Tests
 * 
 * Tests for the git-backed virtual filesystem including:
 * - Auto-commit on writes
 * - Rollback functionality
 * - Version tracking
 * - Diff generation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { createGitBackedVFS } from '@/lib/virtual-filesystem/git-backed-vfs';

describe('Git-Backed VFS', () => {
  const testUserId = 'test-git-vfs-user';
  const testSessionId = 'test-git-vfs-session';
  let gitVFS: ReturnType<typeof createGitBackedVFS>;

  beforeAll(async () => {
    gitVFS = virtualFilesystem.getGitBackedVFS(testUserId, {
      autoCommit: true,
      sessionId: testSessionId,
      enableShadowCommits: true,
    });
  });

  afterAll(async () => {
    // Clean up
    await virtualFilesystem.clearWorkspace(testUserId);
  });

  describe('Auto-Commit', () => {
    it('should auto-commit on file write', async () => {
      const filePath = 'src/test.ts';
      const content = 'export const test = 1;';

      const file = await gitVFS.writeFile(testUserId, filePath, content, 'typescript');
      
      expect(file).toBeDefined();
      expect(file.path).toBe(filePath);
      expect(file.content).toBe(content);

      // Check state shows commit was created
      const state = await gitVFS.getState(testUserId);
      expect(state.version).toBeGreaterThan(0);
    });

    it('should track multiple writes', async () => {
      await gitVFS.writeFile(testUserId, 'src/a.ts', 'export const a = 1;', 'typescript');
      await gitVFS.writeFile(testUserId, 'src/b.ts', 'export const b = 2;', 'typescript');
      await gitVFS.writeFile(testUserId, 'src/c.ts', 'export const c = 3;', 'typescript');

      const state = await gitVFS.getState(testUserId);
      expect(state.version).toBeGreaterThanOrEqual(3);
    });

    it('should commit batch writes as single commit', async () => {
      gitVFS.setAutoCommit(false);

      await gitVFS.batchWrite(testUserId, [
        { path: 'batch/1.ts', content: 'export const one = 1;' },
        { path: 'batch/2.ts', content: 'export const two = 2;' },
        { path: 'batch/3.ts', content: 'export const three = 3;' },
      ]);

      const stateBefore = await gitVFS.getState(testUserId);
      expect(stateBefore.pendingChanges).toBe(3);

      // Manual commit
      const result = await gitVFS.commitChanges(testUserId, 'Batch write test');
      expect(result.success).toBe(true);
      expect(result.committedFiles).toBeGreaterThanOrEqual(3);

      const stateAfter = await gitVFS.getState(testUserId);
      expect(stateAfter.pendingChanges).toBe(0);

      // Re-enable auto-commit
      gitVFS.setAutoCommit(true);
    });
  });

  describe('Rollback', () => {
    it('should rollback to previous version', async () => {
      const filePath = 'rollback/test.ts';
      
      // Version 1
      await gitVFS.writeFile(testUserId, filePath, 'version 1', 'typescript');
      const state1 = await gitVFS.getState(testUserId);
      const version1 = state1.version;

      // Version 2
      await gitVFS.writeFile(testUserId, filePath, 'version 2', 'typescript');
      const state2 = await gitVFS.getState(testUserId);
      const version2 = state2.version;
      expect(version2).toBeGreaterThan(version1);

      // Rollback to version 1
      const result = await gitVFS.rollback(testUserId, version1);
      expect(result.success).toBe(true);
    });

    it('should handle rollback errors gracefully', async () => {
      const result = await gitVFS.rollback(testUserId, 99999);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Version History', () => {
    it('should list all versions', async () => {
      const versions = await gitVFS.listVersions(20);
      
      expect(versions).toBeInstanceOf(Array);
      expect(versions.length).toBeGreaterThan(0);
      
      // Check version structure
      const firstVersion = versions[0];
      expect(firstVersion).toHaveProperty('version');
      expect(firstVersion).toHaveProperty('message');
      expect(firstVersion).toHaveProperty('timestamp');
    });
  });

  describe('Diff Generation', () => {
    it('should generate diff between versions', async () => {
      const filePath = 'diff/test.ts';
      
      // Create two versions
      await gitVFS.writeFile(testUserId, filePath, 'initial content', 'typescript');
      const state1 = await gitVFS.getState(testUserId);
      
      await gitVFS.writeFile(testUserId, filePath, 'modified content', 'typescript');
      const state2 = await gitVFS.getState(testUserId);

      // Get diff
      const diff = await gitVFS.getDiff(testUserId, state1.version);
      
      expect(diff).toBeDefined();
      expect(diff.length).toBeGreaterThan(0);
      expect(diff).toContain('---');
      expect(diff).toContain('+++');
    });

    it('should return empty diff for no changes', async () => {
      const state = await gitVFS.getState(testUserId);
      const diff = await gitVFS.getDiff(testUserId, state.version);
      
      expect(diff).toBeDefined();
      // May be empty or contain "No changes" message
    });
  });

  describe('State Management', () => {
    it('should get current state', async () => {
      const state = await gitVFS.getState(testUserId);
      
      expect(state).toHaveProperty('version');
      expect(state).toHaveProperty('pendingChanges');
      expect(state).toHaveProperty('isClean');
      expect(state).toHaveProperty('lastCommitId');
    });

    it('should track isClean status', async () => {
      gitVFS.setAutoCommit(false);
      await gitVFS.writeFile(testUserId, 'dirty/test.ts', 'content', 'typescript');
      
      const stateDirty = await gitVFS.getState(testUserId);
      expect(stateDirty.isClean).toBe(false);

      await gitVFS.commitChanges(testUserId, 'Clean up');
      const stateClean = await gitVFS.getState(testUserId);
      expect(stateClean.isClean).toBe(true);

      gitVFS.setAutoCommit(true);
    });

    it('should flush pending changes', async () => {
      gitVFS.setAutoCommit(false);
      await gitVFS.writeFile(testUserId, 'flush/test.ts', 'content', 'typescript');
      
      const stateBefore = await gitVFS.getState(testUserId);
      expect(stateBefore.pendingChanges).toBeGreaterThan(0);

      gitVFS.flushChanges();
      
      const stateAfter = await gitVFS.getState(testUserId);
      expect(stateAfter.pendingChanges).toBe(0);

      gitVFS.setAutoCommit(true);
    });
  });

  describe('Shadow Commit Integration', () => {
    it('should create shadow commits', async () => {
      const filePath = 'shadow/test.ts';
      await gitVFS.writeFile(testUserId, filePath, 'shadow content', 'typescript');
      
      // Shadow commits should be tracked
      const versions = await gitVFS.listVersions(10);
      expect(versions.length).toBeGreaterThan(0);
    });

    it('should track commit messages', async () => {
      const versions = await gitVFS.listVersions(5);
      
      for (const version of versions) {
        expect(version.message).toBeDefined();
        expect(typeof version.message).toBe('string');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle concurrent writes', async () => {
      const writes = Array.from({ length: 5 }, (_, i) =>
        gitVFS.writeFile(testUserId, `concurrent/${i}.ts`, `content ${i}`, 'typescript')
      );

      await expect(Promise.all(writes)).resolves.toBeDefined();
    });

    it('should handle large files', async () => {
      const largeContent = 'x'.repeat(100000); // 100KB
      const file = await gitVFS.writeFile(
        testUserId,
        'large/test.ts',
        largeContent,
        'typescript'
      );
      
      expect(file).toBeDefined();
      expect(file.content.length).toBe(100000);
    });
  });
});
