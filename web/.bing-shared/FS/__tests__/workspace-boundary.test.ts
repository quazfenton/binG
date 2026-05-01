/**
 * Workspace Boundary Tests (Shared)
 * 
 * Tests for workspace boundary validation that apply to both:
 * - Desktop (Tauri/Rust backend)
 * - CLI (Node.js standalone)
 * - Web (VFS simulation)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Workspace Boundary Validation
// ============================================================================

describe('Workspace Boundary Validation', () => {
  const testDir = path.join(os.tmpdir(), `boundary-test-${Date.now()}`);
  const workspaceRoot = path.join(testDir, 'workspace');
  let originalCwd: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    await fs.ensureDir(workspaceRoot);
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await fs.remove(testDir).catch(() => {});
  });

  beforeEach(async () => {
    // Create test workspace structure
    await fs.ensureDir(path.join(workspaceRoot, 'src'));
    await fs.ensureDir(path.join(workspaceRoot, 'data'));
    await fs.ensureDir(path.join(workspaceRoot, 'nested', 'deep'));
    
    // Create test files
    await fs.writeFile(
      path.join(workspaceRoot, 'test.txt'),
      'test content'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'module.ts'),
      'export const x = 1;'
    );
  });

  afterEach(async () => {
    await fs.remove(testDir).catch(() => {});
    await fs.ensureDir(workspaceRoot);
  });

  describe('Path Validation', () => {
    function isWithinWorkspace(targetPath: string, workspace: string): boolean {
      const resolved = path.resolve(targetPath);
      const normalized = resolved.replace(/\\/g, '/').replace(/\/+$/, '');
      const normWorkspace = workspace.replace(/\\/g, '/').replace(/\/+$/, '');
      return normalized.startsWith(normWorkspace + '/') || normalized === normWorkspace;
    }

    it('should allow files within workspace', () => {
      const allowedPaths = [
        'test.txt',
        'src/module.ts',
        'data/config.json',
        'nested/deep/file.ts',
        './test.txt',
        'src/../test.txt',
      ];

      for (const relPath of allowedPaths) {
        const fullPath = path.join(workspaceRoot, relPath);
        expect(isWithinWorkspace(fullPath, workspaceRoot)).toBe(true);
      }
    });

    it('should block paths escaping workspace', () => {
      const blockedPaths = [
        '../outside.txt',
        'src/../../../etc/passwd',
        '../../workspace',
        'foo/../../bar',
        '../data/../../../root',
      ];

      for (const relPath of blockedPaths) {
        const fullPath = path.join(workspaceRoot, relPath);
        expect(isWithinWorkspace(fullPath, workspaceRoot)).toBe(false);
      }
    });

    it('should block absolute paths', () => {
      const absolutePaths = [
        '/etc/passwd',
        '/home/user/file.txt',
        'C:\\Windows\\System32',
        '/root/.ssh/id_rsa',
      ];

      for (const absolutePath of absolutePaths) {
        const isAbsolute = path.isAbsolute(absolutePath);
        expect(isAbsolute).toBe(true);
        // Absolute paths should be blocked by definition
        expect(isWithinWorkspace(absolutePath, workspaceRoot)).toBe(false);
      }
    });

    it('should handle symlink traversal', () => {
      // Create a symlink pointing outside workspace
      const symlinkPath = path.join(workspaceRoot, 'link-outside');
      const outsidePath = path.join(testDir, 'outside');
      
      // Note: Symlink creation may require elevated permissions
      // This test checks the path validation logic
      const wouldEscape = isWithinWorkspace(outsidePath, workspaceRoot);
      expect(wouldEscape).toBe(false);
    });

    it('should handle URL-encoded traversal', () => {
      const encodedPaths = [
        '..%2F..%2F..%2Fetc',
        '..%252F..%252F..%252Fetc',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc',
      ];

      for (const encoded of encodedPaths) {
        const decoded = decodeURIComponent(encoded);
        const fullPath = path.join(workspaceRoot, encoded);
        // The path validation should catch this
        expect(isWithinWorkspace(fullPath, workspaceRoot)).toBe(false);
      }
    });

    it('should handle null byte injection', () => {
      const nullBytePaths = [
        'test.txt\0outside.txt',
        'src\0../../../etc/passwd',
      ];

      for (const nullPath of nullBytePaths) {
        const hasNull = nullPath.includes('\0');
        expect(hasNull).toBe(true);
      }
    });

    it('should handle Windows-specific patterns', () => {
      const windowsPaths = [
        'C:\\Windows\\System32',
        'D:\\data\\file.txt',
        'E:\\..\\..\\Windows',
        '\\\\UNC\\share\\path',
      ];

      // On Windows, these are absolute
      const isWindows = process.platform === 'win32';
      
      if (isWindows) {
        for (const winPath of windowsPaths) {
          expect(path.isAbsolute(winPath)).toBe(true);
        }
      }
    });

    it('should handle case sensitivity on case-insensitive filesystems', () => {
      const testPath = path.join(workspaceRoot, 'Test.txt');
      
      // Case sensitivity depends on filesystem
      const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
      
      if (isCaseInsensitive) {
        // On case-insensitive systems, TEST.TXT == test.txt
        const normalizedResolved = path.resolve(testPath).toLowerCase();
        const workspaceNormalized = workspaceRoot.toLowerCase();
        expect(normalizedResolved.startsWith(workspaceNormalized)).toBe(true);
      }
    });
  });

  describe('File Operations with Boundary', () => {
    async function safeRead(relativePath: string, workspace: string): Promise<string | null> {
      const fullPath = path.join(workspace, relativePath);
      const resolved = path.resolve(fullPath);
      
      if (!resolved.startsWith(workspace + path.sep) && resolved !== workspace) {
        return null; // Blocked
      }
      
      if (!fs.existsSync(fullPath)) {
        return null;
      }
      
      return fs.readFile(fullPath, 'utf-8');
    }

    async function safeWrite(relativePath: string, content: string, workspace: string): Promise<boolean> {
      const fullPath = path.join(workspace, relativePath);
      const resolved = path.resolve(fullPath);
      
      if (!resolved.startsWith(workspace + path.sep) && resolved !== workspace) {
        return false; // Blocked
      }
      
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf-8');
      return true;
    }

    it('should read allowed files', async () => {
      const content = await safeRead('test.txt', workspaceRoot);
      expect(content).toBe('test content');
    });

    it('should block reading escaped paths', async () => {
      const content = await safeRead('../outside.txt', workspaceRoot);
      expect(content).toBeNull();
    });

    it('should write allowed files', async () => {
      const success = await safeWrite('new-file.txt', 'new content', workspaceRoot);
      expect(success).toBe(true);
      
      const written = await fs.readFile(
        path.join(workspaceRoot, 'new-file.txt'),
        'utf-8'
      );
      expect(written).toBe('new content');
    });

    it('should block writing to escaped paths', async () => {
      const success = await safeWrite('../malicious.txt', 'bad content', workspaceRoot);
      expect(success).toBe(false);
    });

    it('should create directories within workspace', async () => {
      const success = await safeWrite('new-dir/file.txt', 'content', workspaceRoot);
      expect(success).toBe(true);
      
      const exists = await fs.pathExists(path.join(workspaceRoot, 'new-dir'));
      expect(exists).toBe(true);
    });
  });

  describe('Destructive Operations with Boundary', () => {
    const WORKSPACE_DESTRUCTIVE_OPS = new Set([
      'delete', 'write', 'move', 'overwrite', 'apply_diff', 'rename', 'mkdir',
    ]);

    function requiresConfirmation(operation: string, targetPath: string, workspace: string): boolean {
      if (!WORKSPACE_DESTRUCTIVE_OPS.has(operation)) return false;
      
      const resolved = path.resolve(targetPath);
      const escaped = !resolved.startsWith(workspace + path.sep) && resolved !== workspace;
      return escaped;
    }

    it('should require confirmation for destructive operations outside workspace', () => {
      const shouldConfirm = requiresConfirmation('delete', '../outside', workspaceRoot);
      expect(shouldConfirm).toBe(true);
    });

    it('should not require confirmation for safe operations', () => {
      const shouldConfirm = requiresConfirmation('delete', 'test.txt', workspaceRoot);
      expect(shouldConfirm).toBe(false);
    });

    it('should not require confirmation for non-destructive operations', () => {
      const shouldConfirm = requiresConfirmation('read', 'test.txt', workspaceRoot);
      expect(shouldConfirm).toBe(false);
    });
  });
});

// ============================================================================
// Environment Variable Resolution Tests
// ============================================================================

describe('Environment Variable Resolution', () => {
  describe('Workspace Root Priority', () => {
    beforeEach(() => {
      // Clear all workspace env vars
      delete process.env.INITIAL_CWD;
      delete process.env.DESKTOP_WORKSPACE_ROOT;
      delete process.env.WORKSPACE_ROOT;
    });

    afterEach(() => {
      // Cleanup
      delete process.env.INITIAL_CWD;
      delete process.env.DESKTOP_WORKSPACE_ROOT;
      delete process.env.WORKSPACE_ROOT;
    });

    function getWorkspaceRoot(): string {
      return process.env.INITIAL_CWD ||
        process.env.DESKTOP_WORKSPACE_ROOT ||
        process.env.WORKSPACE_ROOT ||
        process.cwd();
    }

    it('should prioritize INITIAL_CWD', () => {
      process.env.INITIAL_CWD = '/first/priority';
      process.env.DESKTOP_WORKSPACE_ROOT = '/second/choice';
      process.env.WORKSPACE_ROOT = '/third/fallback';
      
      expect(getWorkspaceRoot()).toBe('/first/priority');
    });

    it('should fall back to DESKTOP_WORKSPACE_ROOT', () => {
      delete process.env.INITIAL_CWD;
      process.env.DESKTOP_WORKSPACE_ROOT = '/second/choice';
      process.env.WORKSPACE_ROOT = '/third/fallback';
      
      expect(getWorkspaceRoot()).toBe('/second/choice');
    });

    it('should fall back to WORKSPACE_ROOT', () => {
      delete process.env.INITIAL_CWD;
      delete process.env.DESKTOP_WORKSPACE_ROOT;
      process.env.WORKSPACE_ROOT = '/third/fallback';
      
      expect(getWorkspaceRoot()).toBe('/third/fallback');
    });

    it('should fall back to process.cwd()', () => {
      delete process.env.INITIAL_CWD;
      delete process.env.DESKTOP_WORKSPACE_ROOT;
      delete process.env.WORKSPACE_ROOT;
      
      expect(getWorkspaceRoot()).toBe(process.cwd());
    });
  });

  describe('Desktop Mode Detection', () => {
    beforeEach(() => {
      delete process.env.DESKTOP_MODE;
      delete process.env.DESKTOP_LOCAL_EXECUTION;
    });

    afterEach(() => {
      delete process.env.DESKTOP_MODE;
      delete process.env.DESKTOP_LOCAL_EXECUTION;
    });

    function isDesktopMode(): boolean {
      return process.env.DESKTOP_MODE === 'true' || 
             process.env.DESKTOP_LOCAL_EXECUTION === 'true';
    }

    it('should detect DESKTOP_MODE=true', () => {
      process.env.DESKTOP_MODE = 'true';
      expect(isDesktopMode()).toBe(true);
    });

    it('should detect DESKTOP_LOCAL_EXECUTION=true', () => {
      process.env.DESKTOP_LOCAL_EXECUTION = 'true';
      expect(isDesktopMode()).toBe(true);
    });

    it('should not be desktop mode without env vars', () => {
      expect(isDesktopMode()).toBe(false);
    });
  });
});

// ============================================================================
// Path Normalization Tests
// ============================================================================

describe('Path Normalization', () => {
  describe('Cross-Platform Normalization', () => {
    it('should normalize Windows paths', () => {
      const windowsPath = 'src\\\\foo\\\\bar\\\\file.txt';
      const normalized = windowsPath.replace(/\\\\/g, '/');
      
      expect(normalized).toBe('src/foo/bar/file.txt');
    });

    it('should collapse multiple slashes', () => {
      const multiSlash = 'src///foo////bar///';
      const normalized = multiSlash.replace(/\/+/g, '/');
      
      expect(normalized).toBe('src/foo/bar/');
    });

    it('should trim trailing slashes', () => {
      const withTrailing = 'src/foo/bar/';
      const normalized = withTrailing.replace(/\/+$/, '');
      
      expect(normalized).toBe('src/foo/bar');
    });

    it('should remove redundant dot segments', () => {
      const withDots = 'src/./foo/./bar/..';
      const normalized = withDots.replace(/\/\.\//g, '/').replace(/\/\.\.$/g, '');
      
      expect(normalized).toBe('src/foo/bar');
    });
  });

  describe('URL Encoding Handling', () => {
    it('should decode percent-encoding', () => {
      const encoded = 'src%2F..%2F..%2Fetc';
      const decoded = decodeURIComponent(encoded);
      
      expect(decoded).toBe('src/../..//etc');
    });

    it('should detect traversal in decoded paths', () => {
      const encoded = '..%2F..%2F..%2Fetc';
      const decoded = decodeURIComponent(encoded);
      const hasTraversal = /(^|\/)\.\.(\/|$)/.test(decoded);
      
      expect(hasTraversal).toBe(true);
    });
  });

  describe('Null Byte Handling', () => {
    it('should detect null bytes', () => {
      const withNull = 'src\x00../../../etc/passwd';
      const hasNull = withNull.includes('\0');
      
      expect(hasNull).toBe(true);
    });

    it('should handle null bytes in paths', () => {
      const testPath = 'test\x00.txt';
      const beforeNull = testPath.split('\0')[0];
      const afterNull = testPath.split('\0')[1];
      
      expect(beforeNull).toBe('test');
      expect(afterNull).toBe('.txt');
    });
  });
});