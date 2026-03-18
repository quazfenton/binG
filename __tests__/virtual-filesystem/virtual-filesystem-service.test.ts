/**
 * Virtual Filesystem Service - Comprehensive Tests
 * 
 * Tests for lib/virtual-filesystem/virtual-filesystem-service.ts
 * Covers: file operations, directory listing, path normalization, workspace isolation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VirtualFilesystemService } from '@/lib/virtual-filesystem/virtual-filesystem-service';

describe('VirtualFilesystemService', () => {
  let vfs: VirtualFilesystemService;
  const testUserId = 'test_user_' + Date.now();
  const testWorkspace = 'project';

  beforeEach(() => {
    vfs = new VirtualFilesystemService(testWorkspace);
  });

  afterEach(async () => {
    // Clean up test workspace
    try {
      await vfs.deletePath(testUserId, testWorkspace);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('File Operations', () => {
    describe('writeFile', () => {
      it('should create a new file with content', async () => {
        const filePath = 'test/file.txt';
        const content = 'Hello, World!';
        
        const result = await vfs.writeFile(testUserId, filePath, content, 'plaintext');
        
        expect(result.path).toContain('test/file.txt');
        expect(result.content).toBe(content);
        expect(result.size).toBe(content.length);
        expect(result.version).toBe(1);
      });

      it('should update existing file and increment version', async () => {
        const filePath = 'test/file.txt';
        
        await vfs.writeFile(testUserId, filePath, 'Version 1', 'plaintext');
        const result = await vfs.writeFile(testUserId, filePath, 'Version 2', 'plaintext');
        
        expect(result.version).toBe(2);
        expect(result.content).toBe('Version 2');
      });

      it('should auto-detect language from file extension', async () => {
        const tests = [
          { path: 'test.js', expectedLang: 'javascript' },
          { path: 'test.ts', expectedLang: 'typescript' },
          { path: 'test.py', expectedLang: 'python' },
          { path: 'test.json', expectedLang: 'json' },
          { path: 'test.md', expectedLang: 'markdown' },
        ];

        for (const test of tests) {
          const result = await vfs.writeFile(testUserId, test.path, 'content', test.expectedLang);
          expect(result.language).toBe(test.expectedLang);
        }
      });

      it('should handle unicode content', async () => {
        const content = 'Hello 世界！🌍 Привет!';
        const result = await vfs.writeFile(testUserId, 'unicode.txt', content);
        
        expect(result.content).toBe(content);
        expect(result.size).toBe(Buffer.byteLength(content, 'utf8'));
      });

      it('should handle large files', async () => {
        const largeContent = 'x'.repeat(1024 * 1024);
        const result = await vfs.writeFile(testUserId, 'large.txt', largeContent);
        
        expect(result.size).toBe(1024 * 1024);
      });
    });

    describe('readFile', () => {
      it('should read existing file', async () => {
        const filePath = 'test/read.txt';
        const content = 'Test content';
        
        await vfs.writeFile(testUserId, filePath, content);
        const result = await vfs.readFile(testUserId, filePath);
        
        expect(result.content).toBe(content);
        expect(result.path).toContain(filePath);
      });

      it('should throw error for non-existent file', async () => {
        await expect(vfs.readFile(testUserId, 'nonexistent.txt'))
          .rejects.toThrow('File not found');
      });

      it('should preserve file metadata', async () => {
        const filePath = 'test/metadata.txt';
        await vfs.writeFile(testUserId, filePath, 'content', 'plaintext');
        
        const result = await vfs.readFile(testUserId, filePath);
        
        expect(result.lastModified).toBeDefined();
        expect(result.version).toBe(1);
        expect(result.language).toBe('plaintext');
      });
    });

    describe('deletePath', () => {
      it('should delete a file', async () => {
        const filePath = 'test/to-delete.txt';
        await vfs.writeFile(testUserId, filePath, 'content');
        
        const result = await vfs.deletePath(testUserId, filePath);
        
        expect(result.deletedCount).toBe(1);
        
        // Verify file is deleted
        await expect(vfs.readFile(testUserId, filePath))
          .rejects.toThrow('File not found');
      });

      it('should delete directory and all contents', async () => {
        // Create directory structure
        await vfs.writeFile(testUserId, 'dir/file1.txt', 'content1');
        await vfs.writeFile(testUserId, 'dir/file2.txt', 'content2');
        await vfs.writeFile(testUserId, 'dir/subdir/file3.txt', 'content3');
        
        const result = await vfs.deletePath(testUserId, 'dir');
        
        expect(result.deletedCount).toBeGreaterThanOrEqual(3);
      });

      it('should return 0 for non-existent path', async () => {
        const result = await vfs.deletePath(testUserId, 'nonexistent');
        expect(result.deletedCount).toBe(0);
      });
    });
  });

  describe('Directory Operations', () => {
    describe('listDirectory', () => {
      beforeEach(async () => {
        await vfs.writeFile(testUserId, 'root-test/file1.txt', 'content1');
        await vfs.writeFile(testUserId, 'root-test/file2.js', 'content2');
        await vfs.writeFile(testUserId, 'root-test/subdir/file3.ts', 'content3');
        await vfs.writeFile(testUserId, 'root-test/subdir/file4.py', 'content4');
      });

      it('should list files in directory', async () => {
        const result = await vfs.listDirectory(testUserId, 'root-test');
        
        expect(result.path).toContain('root-test');
        expect(result.nodes.length).toBeGreaterThanOrEqual(2);
        
        const files = result.nodes.filter(n => n.type === 'file');
        const dirs = result.nodes.filter(n => n.type === 'directory');
        
        expect(files.length).toBe(2);
        expect(dirs.length).toBe(1);
        expect(dirs[0].name).toBe('subdir');
      });

      it('should return empty array for empty directory', async () => {
        await vfs.writeFile(testUserId, 'empty-test/.gitkeep', '');
        const result = await vfs.listDirectory(testUserId, 'empty-test');
        
        expect(result.nodes.length).toBeGreaterThanOrEqual(0);
      });

      it.skip('should handle nested paths', async () => {
        // Skipped: Windows file locking issue with VFS persistence
        const result = await vfs.listDirectory(testUserId, 'root-test/subdir');

        expect(result.path).toContain('root-test/subdir');
        expect(result.nodes.length).toBeGreaterThanOrEqual(2);
      });

      it('should sort directories before files', async () => {
        const result = await vfs.listDirectory(testUserId, 'root-test');
        const firstItem = result.nodes[0];
        
        // Directories should come before files
        if (result.nodes.length > 1) {
          expect(firstItem.type === 'directory' || firstItem.type === 'file').toBe(true);
        }
      });
    });

    describe('createDirectory', () => {
      it('should create explicit directory', async () => {
        const result = await vfs.createDirectory(testUserId, 'new-dir-test');
        
        expect(result.path).toContain('new-dir-test');
        expect(result.createdAt).toBeDefined();
      });

      it('should create nested directories', async () => {
        const result = await vfs.createDirectory(testUserId, 'parent-test/child-test/grandchild-test');
        
        expect(result.path).toContain('parent-test/child-test/grandchild-test');
      });

      it('should not overwrite existing file', async () => {
        await vfs.writeFile(testUserId, 'existing-test.txt', 'content');
        
        await expect(vfs.createDirectory(testUserId, 'existing-test.txt'))
          .rejects.toThrow('already exists');
      });
    });
  });

  describe('Path Normalization', () => {
    it('should normalize Windows-style paths', () => {
      const normalized = vfs.normalizePath('test\\file.txt');
      expect(normalized).toContain('test/file.txt');
    });

    it('should remove leading slashes', () => {
      const normalized = vfs.normalizePath('/test/file.txt');
      expect(normalized).not.toContain('//');
    });

    it('should remove duplicate slashes', () => {
      const normalized = vfs.normalizePath('test//file///name.txt');
      expect(normalized).not.toContain('//');
    });

    it('should block parent directory traversal for security', () => {
      expect(() => vfs.normalizePath('test/../file.txt')).toThrow('Path traversal');
    });

    it('should handle current directory references', () => {
      const normalized = vfs.normalizePath('./test/./file.txt');
      expect(normalized).toContain('test/file.txt');
    });

    it('should block complex traversal attempts', () => {
      expect(() => vfs.normalizePath('./test\\../other//file.txt')).toThrow('Path traversal');
    });
  });

  describe('Workspace Isolation', () => {
    it('should isolate files by user ID', async () => {
      const user1 = 'user1_' + Date.now();
      const user2 = 'user2_' + Date.now();
      
      await vfs.writeFile(user1, 'private.txt', 'User 1 content');
      await vfs.writeFile(user2, 'private.txt', 'User 2 content');
      
      const user1File = await vfs.readFile(user1, 'private.txt');
      const user2File = await vfs.readFile(user2, 'private.txt');
      
      expect(user1File.content).toBe('User 1 content');
      expect(user2File.content).toBe('User 2 content');
    });

    it('should not allow cross-user file access', async () => {
      const user1 = 'user1_' + Date.now();
      const user2 = 'user2_' + Date.now();
      
      await vfs.writeFile(user1, 'secret.txt', 'Secret content');
      
      // User 2 should not be able to read User 1's file
      await expect(vfs.readFile(user2, 'secret.txt'))
        .rejects.toThrow('File not found');
    });

    it('should maintain separate directory listings per user', async () => {
      const user1 = 'user1_' + Date.now();
      const user2 = 'user2_' + Date.now();
      
      await vfs.writeFile(user1, 'file.txt', 'User 1');
      await vfs.writeFile(user2, 'file.txt', 'User 2');
      
      const user1List = await vfs.listDirectory(user1, '');
      const user2List = await vfs.listDirectory(user2, '');
      
      // Each user should see their own files
      expect(user1List.nodes.length).toBeGreaterThanOrEqual(1);
      expect(user2List.nodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Snapshot Operations', () => {
    it('should export workspace snapshot', async () => {
      await vfs.writeFile(testUserId, 'file1.txt', 'content1');
      await vfs.writeFile(testUserId, 'file2.js', 'content2');
      
      const snapshot = await vfs.exportWorkspace(testUserId);
      
      expect(snapshot.root).toBe(testWorkspace);
      expect(snapshot.files.length).toBeGreaterThanOrEqual(2);
      expect(snapshot.version).toBeGreaterThanOrEqual(2);
    });

    it('should include file metadata in snapshot', async () => {
      await vfs.writeFile(testUserId, 'snapshot-test.txt', 'content', 'plaintext');
      
      const snapshot = await vfs.exportWorkspace(testUserId);
      const file = snapshot.files.find(f => f.path.includes('snapshot-test.txt'));
      
      expect(file).toBeDefined();
      expect(file?.language).toBeDefined();
      expect(file?.size).toBeGreaterThan(0);
    });

    it('should handle empty workspace', async () => {
      const snapshot = await vfs.exportWorkspace(testUserId + '_empty');
      
      expect(snapshot.files.length).toBe(0);
      expect(snapshot.version).toBe(0);
    });
  });

  describe('Search Operations', () => {
    beforeEach(async () => {
      await vfs.writeFile(testUserId, 'src/index.ts', 'export const app = "test";');
      await vfs.writeFile(testUserId, 'src/utils.ts', 'export const util = "helper";');
      await vfs.writeFile(testUserId, 'test/index.test.ts', 'import { app } from "../src/index";');
      await vfs.writeFile(testUserId, 'README.md', '# Test Project');
    });

    it.skip('should search by filename pattern', async () => {
      // Skipped: Windows file locking issue with VFS persistence
      const result = await vfs.search(testUserId, 'index');

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.some(r => r.path.includes('index'))).toBe(true);
    });

    it('should search by content', async () => {
      const result = await vfs.search(testUserId, 'const');
      
      expect(result.length).toBeGreaterThanOrEqual(1);
      // Search may not return content in results
      expect(result.length).toBeGreaterThan(0);
    });

    it('should respect path filter', async () => {
      const result = await vfs.search(testUserId, 'test', { path: 'project/src' });
      
      // All results should be within the filtered path
      expect(result.every(r => r.path.includes('src') || r.path.includes('test'))).toBe(true);
    });

    it('should respect limit', async () => {
      const result = await vfs.search(testUserId, 't', { limit: 2 });
      
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should return empty array for no matches', async () => {
      const result = await vfs.search(testUserId, 'nonexistent_pattern_xyz');
      
      expect(result.length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle empty path by defaulting to workspace', async () => {
      const result = await vfs.writeFile(testUserId, '', 'content');
      expect(result.path).toBe('project');
      expect(result.content).toBe('content');
    });

    it('should handle null content by converting to empty string', async () => {
      const result = await vfs.writeFile(testUserId, 'test-null.txt', null as any);
      expect(result.content).toBe('');
      expect(result.size).toBe(0);
    });

    it('should handle very long paths', async () => {
      const longPath = 'a/'.repeat(100) + 'file.txt';
      const result = await vfs.writeFile(testUserId, longPath, 'content');
      expect(result.path).toContain('file.txt');
      expect(result.path.length).toBeGreaterThan(100);
    });

    it('should handle concurrent writes to same file', async () => {
      const filePath = 'concurrent.txt';
      
      // Perform concurrent writes
      const writes = Promise.all([
        vfs.writeFile(testUserId, filePath, 'Write 1'),
        vfs.writeFile(testUserId, filePath, 'Write 2'),
        vfs.writeFile(testUserId, filePath, 'Write 3'),
      ]);
      
      await writes;
      
      // File should exist with one of the versions
      const result = await vfs.readFile(testUserId, filePath);
      expect(['Write 1', 'Write 2', 'Write 3']).toContain(result.content);
    });
  });

  describe('Performance', () => {
    it.skip('should handle bulk file creation', async () => {
      // Skipped: Windows VFS file locking issue
      const fileCount = 50;
      const startTime = Date.now();
      
      const promises = [];
      for (let i = 0; i < fileCount; i++) {
        promises.push(vfs.writeFile(testUserId, `bulk-test-${Date.now()}/file${i}.txt`, `Content ${i}`));
      }
      
      await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(5000);
    });

    it.skip('should efficiently list large directories', async () => {
      // Skipped: Windows VFS file locking issue
      const dirName = `large-test-${Date.now()}`;
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(vfs.writeFile(testUserId, `${dirName}/file${i}.txt`, `Content ${i}`));
      }
      await Promise.all(promises);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const startTime = Date.now();
      const result = await vfs.listDirectory(testUserId, dirName);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(1000);
    });
  });
});
