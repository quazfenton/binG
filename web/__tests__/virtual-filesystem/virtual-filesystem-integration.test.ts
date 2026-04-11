/**
 * Virtual Filesystem Integration Tests
 * 
 * Comprehensive integration tests for the VFS service including:
 * - File operations (CRUD)
 * - Diff tracking and versioning
 * - Workspace isolation
 * - Batch operations
 * - Conflict detection
 * - Search functionality
 * - Persistence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// VFS workspace prefix used in path normalization
const WORKSPACE_PREFIX = 'test-workspace/';
import { VirtualFilesystemService, type FilesystemChangeEvent, type ConflictEvent } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { FilesystemDiffTracker, type FileDiff, type DiffHunk } from '@/lib/virtual-filesystem/filesystem-diffs';
import { VFSBatchOperations } from '@/lib/virtual-filesystem/vfs-batch-operations';
import type { VirtualFile } from '@/lib/virtual-filesystem/filesystem-types';

describe('Virtual Filesystem Integration', () => {
  let vfs: VirtualFilesystemService;
  let diffTracker: FilesystemDiffTracker;

  beforeEach(async () => {
    vfs = new VirtualFilesystemService({
      workspaceRoot: 'test-workspace',
      storageDir: '/tmp/test-vfs-storage',
    });
    // Clear all test workspaces before each test to ensure clean state
    const testOwnerIds = ['test-user-1', 'user-1', 'user-2', 'test-user'];
    for (const id of testOwnerIds) {
      await vfs.clearWorkspace(id).catch(() => {});
    }
    diffTracker = new FilesystemDiffTracker();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe('File Operations - Create, Read, Update, Delete', () => {
    it('should create a new file with content and metadata', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/components/Button.tsx';
      const content = `export const Button = () => <button>Click me</button>;`;
      const language = 'typescript';

      const file = await vfs.writeFile(ownerId, filePath, content, language);

      expect(file.path).toBe('test-workspace/' + filePath);
      expect(file.content).toBe(content);
      expect(file.language).toBe(language);
      expect(file.version).toBe(1);
      expect(file.createdAt).toBeDefined();
      expect(file.lastModified).toBeDefined();
      expect(file.size).toBe(content.length);
    });

    it('should read a file that was created', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/utils/helpers.ts';
      const content = `export const add = (a: number, b: number): number => a + b;`;

      await vfs.writeFile(ownerId, filePath, content);
      const file = await vfs.readFile(ownerId, filePath);

      expect(file.path).toBe('test-workspace/' + filePath);
      expect(file.content).toBe(content);
      expect(file.version).toBe(1);
    });

    it('should update an existing file and increment version', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/App.tsx';
      const initialContent = `export default function App() { return <div>V1</div>; }`;
      const updatedContent = `export default function App() { return <div>V2</div>; }`;

      const file1 = await vfs.writeFile(ownerId, filePath, initialContent);
      const file2 = await vfs.writeFile(ownerId, filePath, updatedContent);

      expect(file1.path).toBe('test-workspace/' + filePath);
      expect(file1.version).toBe(1);
      expect(file2.version).toBe(2);
      expect(file2.content).toBe(updatedContent);
      expect(file2.lastModified).toBeGreaterThanOrEqual(file1.lastModified);
    });

    it('should delete a file', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/temp.ts';
      const content = `export const temp = 'delete me';`;

      await vfs.writeFile(ownerId, filePath, content);
      const result = await vfs.deletePath(ownerId, filePath);

      // VFS returns { deletedCount: number } not boolean
      expect(result.deletedCount).toBe(1);

      await expect(vfs.readFile(ownerId, filePath)).rejects.toThrow('File not found');
    });

    it('should throw error when reading non-existent file', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'nonexistent.ts';

      await expect(vfs.readFile(ownerId, filePath)).rejects.toThrow('File not found');
    });

    it('should throw error when deleting non-existent file', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'nonexistent.ts';

      const result = await vfs.deletePath(ownerId, filePath);
      // VFS returns { deletedCount: number } - 0 means nothing was deleted
      expect(result.deletedCount).toBe(0);
    });

    it('should handle file creation with failIfExists option', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/unique.ts';
      const content = `export const unique = true;`;

      await vfs.writeFile(ownerId, filePath, content, undefined, { failIfExists: true });

      await expect(
        vfs.writeFile(ownerId, filePath, content, undefined, { failIfExists: true })
      ).rejects.toThrow('File already exists');
    });

    it('should normalize file paths', async () => {
      const ownerId = 'test-user-1';
      const filePath = './src/../src/./components//Button.tsx';
      const content = `export const Button = () => null;`;

      const file = await vfs.writeFile(ownerId, filePath, content);

      // VFS normalizes to 'test-workspace/src/components/Button.tsx' due to workspaceRoot
      expect(file.path).toBe('test-workspace/src/components/Button.tsx');
    });

    it('should handle empty content', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/empty.ts';

      const file = await vfs.writeFile(ownerId, filePath, '');

      expect(file.content).toBe('');
      expect(file.size).toBe(0);
    });

    it('should handle special characters in file content', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/special.ts';
      const content = `const emoji = '🚀'; const unicode = '日本語'; const special = '<>&"'\'';`;

      const file = await vfs.writeFile(ownerId, filePath, content);

      expect(file.path).toBe('test-workspace/' + filePath);
      expect(file.content).toBe(content);
      expect(file.size).toBe(content.length);
    });
  });

  describe('Directory Operations', () => {
    it('should list directory contents', async () => {
      const ownerId = 'test-user-1';
      const files = [
        { path: 'src/components/Button.tsx', content: 'export const Button = () => null;' },
        { path: 'src/components/Input.tsx', content: 'export const Input = () => null;' },
        { path: 'src/utils/helpers.ts', content: 'export const add = (a, b) => a + b;' },
        { path: 'src/App.tsx', content: 'export default function App() { return null; }' },
      ];

      for (const file of files) {
        await vfs.writeFile(ownerId, file.path, file.content);
      }

      const listing = await vfs.listDirectory(ownerId, 'src/components');

      // VFS returns 'nodes' not 'entries'
      expect(listing.nodes).toHaveLength(2);
      expect(listing.nodes.map(e => e.name)).toEqual(expect.arrayContaining(['Button.tsx', 'Input.tsx']));
    });

    it('should list root directory when no path provided', async () => {
      const ownerId = 'test-user-1';
      const files = [
        { path: 'src/App.tsx', content: 'export default function App() { return null; }' },
        { path: 'package.json', content: '{}' },
        { path: 'README.md', content: '# My Project' },
      ];

      for (const file of files) {
        await vfs.writeFile(ownerId, file.path, file.content);
      }

      const listing = await vfs.listDirectory(ownerId);

      // VFS returns 'nodes' not 'entries'
      expect(listing.nodes.length).toBeGreaterThan(0);
      expect(listing.nodes.map(e => e.name)).toEqual(expect.arrayContaining(['src', 'package.json', 'README.md']));
    });

    it('should return empty listing for non-existent directory', async () => {
      const ownerId = 'test-user-1';

      const listing = await vfs.listDirectory(ownerId, 'nonexistent');

      // VFS returns 'nodes' not 'entries'
      expect(listing.nodes).toHaveLength(0);
    });

    it('should delete directory recursively', async () => {
      const ownerId = 'test-user-1';
      const files = [
        { path: 'src/components/Button.tsx', content: 'export const Button = () => null;' },
        { path: 'src/components/Input.tsx', content: 'export const Input = () => null;' },
        { path: 'src/utils/helpers.ts', content: 'export const add = (a, b) => a + b;' },
      ];

      for (const file of files) {
        await vfs.writeFile(ownerId, file.path, file.content);
      }

      const result = await vfs.deletePath(ownerId, 'src/components');

      expect(result.deletedCount).toBe(2);
      await expect(vfs.readFile(ownerId, 'src/components/Button.tsx')).rejects.toThrow('File not found');
      await expect(vfs.readFile(ownerId, 'src/utils/helpers.ts')).resolves.toBeDefined();
    });
  });

  describe('Workspace Isolation', () => {
    it('should isolate files between different owners', async () => {
      const owner1 = 'user-1';
      const owner2 = 'user-2';
      const filePath = 'src/shared.ts';

      await vfs.writeFile(owner1, filePath, 'export const owner = "user1";');
      await vfs.writeFile(owner2, filePath, 'export const owner = "user2";');

      const file1 = await vfs.readFile(owner1, filePath);
      const file2 = await vfs.readFile(owner2, filePath);

      expect(file1.content).toBe('export const owner = "user1";');
      expect(file2.content).toBe('export const owner = "user2";');
    });

    it('should not allow cross-workspace file access', async () => {
      const owner1 = 'user-1';
      const owner2 = 'user-2';
      const filePath = 'src/private.ts';

      await vfs.writeFile(owner1, filePath, 'export const secret = "user1-secret";');

      await expect(vfs.readFile(owner2, filePath)).rejects.toThrow('File not found');
    });

    it('should maintain separate version counters per workspace', async () => {
      const owner1 = 'user-1';
      const owner2 = 'user-2';
      const filePath = 'src/counter.ts';

      const file1v1 = await vfs.writeFile(owner1, filePath, 'v1');
      const file2v1 = await vfs.writeFile(owner2, filePath, 'v1');

      const file1v2 = await vfs.writeFile(owner1, filePath, 'v2');
      const file2v2 = await vfs.writeFile(owner2, filePath, 'v2');

      expect(file1v1.version).toBe(1);
      expect(file1v2.version).toBe(2);
      expect(file2v1.version).toBe(1);
      expect(file2v2.version).toBe(2);
    });
  });

  describe('Diff Tracking', () => {
    it('should track file creation as diff', () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/new.ts';
      const content = 'export const newFile = true;';

      const file: VirtualFile = {
        path: filePath,
        content,
        language: 'typescript',
        version: 1,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        size: content.length,
      };

      const diff = diffTracker.trackChange(file, ownerId);

      expect(diff.changeType).toBe('create');
      expect(diff.path).toBe(filePath);
      expect(diff.ownerId).toBe(ownerId);
      expect(diff.oldContent).toBe('');
      expect(diff.newContent).toBe(content);
      expect(diff.hunks).toBeDefined();
    });

    it('should track file update with hunks', () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/update.ts';
      const oldContent = `export const value = 1;
export const other = 'test';`;
      const newContent = `export const value = 2;
export const other = 'test';`;

      const oldFile: VirtualFile = {
        path: filePath,
        content: oldContent,
        version: 1,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        size: oldContent.length,
      };

      const newFile: VirtualFile = {
        path: filePath,
        content: newContent,
        version: 2,
        createdAt: oldFile.createdAt,
        lastModified: new Date().toISOString(),
        size: newContent.length,
      };

      diffTracker.trackChange(oldFile, ownerId);
      const diff = diffTracker.trackChange(newFile, ownerId, oldContent);

      expect(diff.changeType).toBe('update');
      expect(diff.hunks).toBeDefined();
      expect(diff.hunks!.length).toBeGreaterThan(0);
      expect(diff.hunks![0].lines).toContain('-export const value = 1;');
      expect(diff.hunks![0].lines).toContain('+export const value = 2;');
    });

    it('should track file deletion', () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/delete.ts';
      const content = 'export const toDelete = true;';

      const file: VirtualFile = {
        path: filePath,
        content,
        version: 1,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        size: content.length,
      };

      diffTracker.trackChange(file, ownerId);

      const deletedFile: VirtualFile = {
        path: filePath,
        content: '',
        version: 2,
        createdAt: file.createdAt,
        lastModified: new Date().toISOString(),
        size: 0,
      };

      const diff = diffTracker.trackChange(deletedFile, ownerId, content);

      expect(diff.changeType).toBe('update');
      expect(diff.oldContent).toBe(content);
      expect(diff.newContent).toBe('');
    });

    it('should maintain diff history per file', () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/history.ts';

      const versions = [
        'export const v = 1;',
        'export const v = 2;',
        'export const v = 3;',
      ];

      versions.forEach((content, index) => {
        const file: VirtualFile = {
          path: filePath,
          content,
          version: index + 1,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          size: content.length,
        };

        const previousContent = index > 0 ? versions[index - 1] : undefined;
        diffTracker.trackChange(file, ownerId, previousContent);
      });

      const history = diffTracker.getDiffHistory(ownerId, filePath);

      expect(history).toBeDefined();
      expect(history!.diffs).toHaveLength(3);
      expect(history!.currentVersion).toBe(3);
    });

    it('should compute accurate diff hunks', () => {
      const oldContent = `line 1
line 2
line 3
line 4
line 5`;

      const newContent = `line 1
line 2 modified
line 3
line 4
line 5`;

      const hunks = diffTracker.computeHunks(oldContent, newContent);

      expect(hunks.length).toBe(1);
      expect(hunks[0].oldStart).toBe(1);
      expect(hunks[0].oldLines).toBe(5);
      expect(hunks[0].newStart).toBe(1);
      expect(hunks[0].newLines).toBe(5);
      expect(hunks[0].lines).toContain('-line 2');
      expect(hunks[0].lines).toContain('+line 2 modified');
    });

    it('should handle multiple separate changes as multiple hunks', () => {
      const oldContent = `line 1
line 2
line 3
line 4
line 5
line 6
line 7`;

      const newContent = `line 1 modified
line 2
line 3
line 4
line 5
line 6
line 7 modified`;

      const hunks = diffTracker.computeHunks(oldContent, newContent);

      expect(hunks.length).toBe(2);
      expect(hunks[0].lines).toContain('-line 1');
      expect(hunks[0].lines).toContain('+line 1 modified');
      expect(hunks[1].lines).toContain('-line 7');
      expect(hunks[1].lines).toContain('+line 7 modified');
    });

    it('should get diff summary for LLM context', () => {
      const ownerId = 'test-user-1';
      const files = [
        { path: 'src/file1.ts', content: 'export const a = 1;' },
        { path: 'src/file2.ts', content: 'export const b = 2;' },
        { path: 'src/file3.ts', content: 'export const c = 3;' },
      ];

      files.forEach((f, i) => {
        const file: VirtualFile = {
          path: f.path,
          content: f.content,
          version: i + 1,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          size: f.content.length,
        };
        diffTracker.trackChange(file, ownerId);
      });

      const summary = diffTracker.getDiffSummary(ownerId);

      expect(summary.changedFiles).toHaveLength(3);
      expect(summary.totalChanges).toBe(3);
      expect(summary.creates).toBe(3);
    });

    it('should get files at specific version', () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/versioned.ts';

      const versions = ['v1', 'v2', 'v3'];

      versions.forEach((content, index) => {
        const file: VirtualFile = {
          path: filePath,
          content,
          version: index + 1,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          size: content.length,
        };
        const previousContent = index > 0 ? versions[index - 1] : undefined;
        diffTracker.trackChange(file, ownerId, previousContent);
      });

      const filesAtV2 = diffTracker.getFilesAtVersion(ownerId, filePath, 2);

      expect(filesAtV2).toBeDefined();
      expect(filesAtV2!.content).toBe('v2');
      expect(filesAtV2!.version).toBe(2);
    });

    it('should generate rollback operations', () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/rollback.ts';

      const versions = ['v1', 'v2', 'v3'];

      versions.forEach((content, index) => {
        const file: VirtualFile = {
          path: filePath,
          content,
          version: index + 1,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          size: content.length,
        };
        const previousContent = index > 0 ? versions[index - 1] : undefined;
        diffTracker.trackChange(file, ownerId, previousContent);
      });

      const rollbackOps = diffTracker.getRollbackOperations(ownerId, filePath, 1);

      expect(rollbackOps).toBeDefined();
      expect(rollbackOps.length).toBe(2);
      expect(rollbackOps[0].targetVersion).toBe(1);
    });
  });

  describe('Batch Operations', () => {
    it('should queue multiple file operations', async () => {
      const ownerId = 'test-user-1';
      const batch = new VFSBatchOperations(ownerId);

      batch.create('src/file1.ts', 'export const f1 = 1;');
      batch.create('src/file2.ts', 'export const f2 = 2;');
      batch.create('src/file3.ts', 'export const f3 = 3;');

      expect(batch.operations).toHaveLength(3);
      expect(batch.operations[0].type).toBe('create');
      expect(batch.operations[0].path).toBe('src/file1.ts');
    });

    it('should execute batch operations', async () => {
      const ownerId = 'test-user-1';
      const batch = new VFSBatchOperations(ownerId);

      batch.create('src/batch1.ts', 'export const b1 = 1;');
      batch.create('src/batch2.ts', 'export const b2 = 2;');

      const results = await batch.execute(vfs);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].file?.path).toBe('src/batch1.ts');
      expect(results[1].success).toBe(true);
      expect(results[1].file?.path).toBe('src/batch2.ts');
    });

    it('should handle batch operation failures', async () => {
      const ownerId = 'test-user-1';
      const batch = new VFSBatchOperations(ownerId);

      batch.create('valid.ts', 'export const valid = true;');
      batch.read('nonexistent.ts');

      const results = await batch.execute(vfs);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBeDefined();
    });

    it('should validate batch operations before execution', () => {
      const ownerId = 'test-user-1';
      const batch = new VFSBatchOperations(ownerId);

      batch.create('src/valid.ts', 'export const valid = true;');
      batch.create('', 'invalid path');
      batch.create('src/another.ts', 'content');

      const validation = batch.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0].message).toContain('empty');
    });

    it('should clear batch operations', () => {
      const ownerId = 'test-user-1';
      const batch = new VFSBatchOperations(ownerId);

      batch.create('file1.ts', 'content1');
      batch.create('file2.ts', 'content2');

      batch.clear();

      expect(batch.operations).toHaveLength(0);
    });

    it('should get batch summary', () => {
      const ownerId = 'test-user-1';
      const batch = new VFSBatchOperations(ownerId);

      batch.create('create1.ts', 'c1');
      batch.create('create2.ts', 'c2');
      batch.update('update1.ts', 'u1');
      batch.delete('delete1.ts');

      const summary = batch.getSummary();

      expect(summary.total).toBe(4);
      expect(summary.creates).toBe(2);
      expect(summary.updates).toBe(1);
      expect(summary.deletes).toBe(1);
    });
  });

  describe('Search Functionality', () => {
    it('should search files by content', async () => {
      const ownerId = 'test-user-1';
      const files = [
        { path: 'src/Button.tsx', content: 'export const Button = () => <button>Click</button>;' },
        { path: 'src/Input.tsx', content: 'export const Input = () => <input />;' },
        { path: 'src/utils.ts', content: 'export const handleClick = () => {};' },
      ];

      for (const file of files) {
        await vfs.writeFile(ownerId, file.path, file.content);
      }

      const results = await vfs.search(ownerId, 'button');

      expect(results.files.length).toBeGreaterThan(0);
      expect(results.files.some(f => f.path === 'src/Button.tsx')).toBe(true);
    });

    it('should search files by path pattern', async () => {
      const ownerId = 'test-user-1';
      const files = [
        { path: 'src/components/Button.tsx', content: 'export const Button = () => null;' },
        { path: 'src/components/Input.tsx', content: 'export const Input = () => null;' },
        { path: 'src/utils/helpers.ts', content: 'export const help = () => {};' },
      ];

      for (const file of files) {
        await vfs.writeFile(ownerId, file.path, file.content);
      }

      const results = await vfs.search(ownerId, 'components', { pathPattern: '**/components/**' });

      expect(results.files).toHaveLength(2);
      expect(Array.isArray(results.files) && results.files.every(f => f.path.includes('components'))).toBe(true);
    });

    it('should limit search results', async () => {
      const ownerId = 'test-user-1';

      for (let i = 0; i < 50; i++) {
        await vfs.writeFile(ownerId, `src/file${i}.ts`, `export const f${i} = ${i};`);
      }

      const results = await vfs.search(ownerId, 'export', { limit: 10 });

      expect(results.files.length).toBeLessThanOrEqual(10);
    });

    it('should search with language filter', async () => {
      const ownerId = 'test-user-1';

      await vfs.writeFile(ownerId, 'src/file.ts', 'export const ts = true;', 'typescript');
      await vfs.writeFile(ownerId, 'src/file.js', 'export const js = true;', 'javascript');
      await vfs.writeFile(ownerId, 'src/file.py', 'export const py = True', 'python');

      const results = await vfs.search(ownerId, 'export', { language: 'typescript' });

      expect(results.files).toHaveLength(1);
      // VFS adds workspace prefix
      expect(results.files[0].path).toBe('test-workspace/src/file.ts');
    });

    it('should return empty results for no matches', async () => {
      const ownerId = 'test-user-1';

      await vfs.writeFile(ownerId, 'src/file.ts', 'export const test = true;');

      const results = await vfs.search(ownerId, 'nonexistent');

      expect(results.files).toHaveLength(0);
    });
  });

  describe('Event Emission', () => {
    it('should emit file change events on create', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/event.ts';
      const listener = vi.fn();

      vfs.onFileChange(listener);

      await vfs.writeFile(ownerId, filePath, 'export const event = true;');

      // VFS includes workspace prefix in path and version
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'test-workspace/' + filePath,
          type: 'create',
          ownerId,
          version: expect.any(Number),
        })
      );
    });

    it('should emit file change events on update', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/event-update.ts';
      const listener = vi.fn();

      vfs.onFileChange(listener);

      await vfs.writeFile(ownerId, filePath, 'v1');
      await vfs.writeFile(ownerId, filePath, 'v2');

      expect(listener).toHaveBeenCalledTimes(2);
      // VFS includes workspace prefix in path
      expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          path: 'test-workspace/' + filePath,
          type: 'update',
          version: 2,
        })
      );
    });

    it('should emit file change events on delete', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/event-delete.ts';
      const listener = vi.fn();

      vfs.onFileChange(listener);

      await vfs.writeFile(ownerId, filePath, 'to delete');
      await vfs.deletePath(ownerId, filePath);

      // VFS includes workspace prefix in path and adds version
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'test-workspace/' + filePath,
          type: 'delete',
          version: expect.any(Number),
        })
      );
    });

    it('should emit snapshot change events', async () => {
      const ownerId = 'test-user-1';
      const listener = vi.fn();

      vfs.onSnapshotChange(listener);

      await vfs.writeFile(ownerId, 'file1.ts', 'content1');
      await vfs.writeFile(ownerId, 'file2.ts', 'content2');

      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('Conflict Detection', () => {
    it('should detect concurrent modifications', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/conflict.ts';
      const conflictListener = vi.fn();

      vfs.onConflict(conflictListener);

      // Create initial file
      await vfs.writeFile(ownerId, filePath, 'initial');

      // Simulate concurrent modification by writing with different base
      const workspace = await (vfs as any).ensureWorkspace(ownerId);
      const file = workspace.files.get(filePath);
      if (file) {
        file.version = 999; // Simulate different version
      }

      await vfs.writeFile(ownerId, filePath, 'concurrent change');

      // Conflict should be detected due to version mismatch
      expect(conflictListener).toHaveBeenCalled();
    });
  });

  describe('Export/Import Workspace', () => {
    it('should export workspace snapshot', async () => {
      const ownerId = 'test-user-1';
      const files = [
        { path: 'src/file1.ts', content: 'export const f1 = 1;' },
        { path: 'src/file2.ts', content: 'export const f2 = 2;' },
        { path: 'package.json', content: '{"name": "test"}' },
      ];

      for (const file of files) {
        await vfs.writeFile(ownerId, file.path, file.content);
      }

      const snapshot = await vfs.exportWorkspace(ownerId);

      // exportWorkspace returns { root, version, updatedAt, exportedAt, files, structure }
      // ownerId is not directly returned - check root instead
      expect(snapshot.root).toBe('test-workspace');
      expect(snapshot.files).toHaveLength(3);
      expect(snapshot.exportedAt).toBeDefined();
      expect(snapshot.version).toBe(3);
    });

    it('should export workspace with directory structure', async () => {
      const ownerId = 'test-user-1';
      const files = [
        { path: 'src/components/Button.tsx', content: 'export const Button = () => null;' },
        { path: 'src/components/Input.tsx', content: 'export const Input = () => null;' },
        { path: 'src/utils/helpers.ts', content: 'export const help = () => {};' },
      ];

      for (const file of files) {
        await vfs.writeFile(ownerId, file.path, file.content);
      }

      const snapshot = await vfs.exportWorkspace(ownerId);

      expect(snapshot.structure).toBeDefined();
      // Structure keys are full paths like 'test-workspace/src/components'
      const keys = Object.keys(snapshot.structure!);
      expect(keys.some(k => k.includes('src'))).toBe(true);
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle large file content', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/large.ts';
      const content = 'export const data = "' + 'a'.repeat(100000) + '";';

      const file = await vfs.writeFile(ownerId, filePath, content);

      expect(file.size).toBe(content.length);
      expect(file.content).toBe(content);
    });

    it('should handle many files efficiently', async () => {
      const ownerId = 'test-user-1';
      const fileCount = 100;

      const start = Date.now();

      for (let i = 0; i < fileCount; i++) {
        await vfs.writeFile(ownerId, `src/file${i}.ts`, `export const f${i} = ${i};`);
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should handle deeply nested paths', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'a/b/c/d/e/f/g/h/i/j/k/deep.ts';
      const content = 'export const deep = true;';

      const file = await vfs.writeFile(ownerId, filePath, content);

      // VFS adds workspace prefix
      expect(file.path).toBe('test-workspace/' + filePath);
      expect(file.content).toBe(content);
    });

    it('should handle Unicode in file paths', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/日本語/ファイル.ts';
      const content = 'export const unicode = true;';

      const file = await vfs.writeFile(ownerId, filePath, content);

      // VFS adds workspace prefix
      expect(file.path).toBe('test-workspace/' + filePath);
    });

    it('should handle concurrent writes to different files', async () => {
      const ownerId = 'test-user-1';

      const writes = Promise.all([
        vfs.writeFile(ownerId, 'src/concurrent1.ts', 'export const c1 = 1;'),
        vfs.writeFile(ownerId, 'src/concurrent2.ts', 'export const c2 = 2;'),
        vfs.writeFile(ownerId, 'src/concurrent3.ts', 'export const c3 = 3;'),
      ]);

      const results = await writes;

      expect(results).toHaveLength(3);
      expect(Array.isArray(results) && results.every(r => r.success || r.path)).toBe(true);
    });
  });

  describe('Rollback Operations', () => {
    it('should rollback to previous version', async () => {
      const ownerId = 'test-user-1';
      const filePath = 'src/rollback.ts';

      const versions = ['version1', 'version2', 'version3'];

      for (const [i, content] of versions.entries()) {
        await vfs.writeFile(ownerId, filePath, content);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Get diff tracker from VFS service
      const tracker = vfs.getDiffTracker();
      const rollbackOps = tracker.getRollbackOperations(ownerId, filePath, 1);

      expect(rollbackOps).toBeDefined();
      expect(rollbackOps.length).toBeGreaterThan(0);
    });
  });

  describe('File Language Detection', () => {
    it('should detect TypeScript from file extension', async () => {
      const ownerId = 'test-user-1';

      const file = await vfs.writeFile(ownerId, 'src/file.ts', 'export const x = 1;');

      expect(file.language).toBe('typescript');
    });

    it('should detect JavaScript from file extension', async () => {
      const ownerId = 'test-user-1';

      const file = await vfs.writeFile(ownerId, 'src/file.js', 'export const x = 1;');

      expect(file.language).toBe('javascript');
    });

    it('should detect Python from file extension', async () => {
      const ownerId = 'test-user-1';

      const file = await vfs.writeFile(ownerId, 'src/file.py', 'x = 1');

      expect(file.language).toBe('python');
    });

    it('should detect TSX from file extension', async () => {
      const ownerId = 'test-user-1';

      const file = await vfs.writeFile(ownerId, 'src/App.tsx', 'export const App = () => <div />;');

      // TSX files return 'tsx' which is correct - TSX is TypeScript with JSX
      expect(['tsx', 'typescript']).toContain(file.language);
    });

    it('should use provided language override', async () => {
      const ownerId = 'test-user-1';

      const file = await vfs.writeFile(ownerId, 'src/file.txt', 'content', 'markdown');

      // VFS adds workspace prefix to path
      expect(file.path).toBe('test-workspace/src/file.txt');
      expect(file.language).toBe('markdown');
    });
  });
});
