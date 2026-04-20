/**
 * Agent Filesystem — Unit Tests
 *
 * Tests for lib/agent-bins/agent-filesystem.ts
 * Covers: mode detection, factory, all 4 filesystem implementations (local, vfs, mcp, remote)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createAgentFilesystem,
  detectDefaultFsMode,
  getDefaultAgentCwd,
  type AgentFilesystem,
  type AgentFsMode,
  type DirEntry,
} from '@/lib/agent-bins/agent-filesystem';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

// ────────────────────────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────────────────────────

// Mock @bing/platform/env so we can toggle desktop/web mode deterministically
vi.mock('@bing/platform/env', () => ({
  isDesktopMode: vi.fn(() => false),
  isLocalExecution: vi.fn(() => false),
  getDefaultWorkspaceRoot: vi.fn(() => null),
}));

import { isDesktopMode, isLocalExecution, getDefaultWorkspaceRoot } from '@bing/platform/env';

// Mock VFS module (used by VfsAgentFs)
vi.mock('@/lib/virtual-filesystem', () => ({
  virtualFilesystem: {
    readFile: vi.fn(async (_userId: string, filePath: string) => ({
      content: `vfs-content:${filePath}`,
      path: filePath,
    })),
    writeFile: vi.fn(async () => {}),
    listDirectory: vi.fn(async (_userId: string, dirPath: string) => ({
      path: dirPath,
      nodes: [
        { name: 'file.txt', path: `${dirPath}/file.txt`, type: 'file', size: 10 },
        { name: 'subdir', path: `${dirPath}/subdir`, type: 'directory' },
      ],
    })),
    search: vi.fn(async (_userId: string, query: string) => ({
      files: [
        { name: `${query}-result.ts`, path: `/workspace/${query}-result.ts` },
      ],
    })),
  },
}));

// Mock MCP architecture-integration (used by McpAgentFs)
vi.mock('@/lib/mcp/architecture-integration', () => ({
  callMCPToolFromAI_SDK: vi.fn(async (toolName: string, args: Record<string, unknown>) => {
    if (toolName === 'read_file') {
      return { success: true, output: `mcp-content:${args.path}` };
    }
    if (toolName === 'write_file') {
      return { success: true };
    }
    if (toolName === 'list_files') {
      return {
        success: true,
        output: JSON.stringify({
          files: [
            { name: 'a.ts', path: '/workspace/a.ts', type: 'file', size: 20 },
            { name: 'b_dir', path: '/workspace/b_dir', type: 'directory' },
          ],
        }),
      };
    }
    if (toolName === 'search_files') {
      return {
        success: true,
        output: JSON.stringify({
          matches: [{ file: `/workspace/${args.query}.ts`, path: `/workspace/${args.query}.ts` }],
        }),
      };
    }
    return { success: false, error: 'Unknown tool' };
  }),
}));

// Mock global fetch (used by RemoteAgentFs)
const mockFetch = vi.fn(async (_url: string, _opts?: RequestInit) => ({
  ok: true,
  status: 200,
  json: async () => ({}),
}));
vi.stubGlobal('fetch', mockFetch);

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function toggleDesktopMode(value: boolean) {
  vi.mocked(isDesktopMode).mockReturnValue(value);
  vi.mocked(isLocalExecution).mockReturnValue(value);
}

function setWorkspaceRoot(root: string | null) {
  vi.mocked(getDefaultWorkspaceRoot).mockReturnValue(root);
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('agent-filesystem', () => {
  afterEach(() => {
    vi.clearAllMocks();
    toggleDesktopMode(false);
    setWorkspaceRoot(null);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Mode detection
  // ──────────────────────────────────────────────────────────────────────

  describe('detectDefaultFsMode', () => {
    it('returns "local" in desktop mode', () => {
      toggleDesktopMode(true);
      expect(detectDefaultFsMode()).toBe('local');
    });

    it('returns "local" when local execution is enabled', () => {
      vi.mocked(isLocalExecution).mockReturnValue(true);
      expect(detectDefaultFsMode()).toBe('local');
    });

    it('returns "vfs" in web mode (neither desktop nor local)', () => {
      toggleDesktopMode(false);
      expect(detectDefaultFsMode()).toBe('vfs');
    });
  });

  describe('getDefaultAgentCwd', () => {
    it('returns workspace root in desktop mode when available', () => {
      toggleDesktopMode(true);
      setWorkspaceRoot('/home/user/project');
      expect(getDefaultAgentCwd()).toBe('/home/user/project');
    });

    it('falls back to process.cwd() in desktop mode without workspace root', () => {
      toggleDesktopMode(true);
      setWorkspaceRoot(null);
      expect(getDefaultAgentCwd()).toBe(process.cwd());
    });

    it('returns "/workspace" in web mode', () => {
      toggleDesktopMode(false);
      expect(getDefaultAgentCwd()).toBe('/workspace');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Factory
  // ──────────────────────────────────────────────────────────────────────

  describe('createAgentFilesystem', () => {
    it('auto-detects local mode in desktop', () => {
      toggleDesktopMode(true);
      const fs = createAgentFilesystem();
      expect(fs.mode).toBe('local');
    });

    it('auto-detects vfs mode in web', () => {
      toggleDesktopMode(false);
      const fs = createAgentFilesystem();
      expect(fs.mode).toBe('vfs');
    });

    it('creates local fs with explicit mode', () => {
      const fs = createAgentFilesystem({ mode: 'local', cwd: '/tmp' });
      expect(fs.mode).toBe('local');
      expect(fs.cwd).toBe('/tmp');
    });

    it('creates vfs fs with userId', () => {
      const fs = createAgentFilesystem({ mode: 'vfs', userId: 'user1' });
      expect(fs.mode).toBe('vfs');
    });

    it('creates mcp fs with userId', () => {
      const fs = createAgentFilesystem({ mode: 'mcp', userId: 'user2' });
      expect(fs.mode).toBe('mcp');
    });

    it('creates remote fs with remoteUrl', () => {
      const fs = createAgentFilesystem({ mode: 'remote', remoteUrl: 'http://agent:8080' });
      expect(fs.mode).toBe('remote');
    });

    it('throws if remote mode without remoteUrl', () => {
      expect(() => createAgentFilesystem({ mode: 'remote' })).toThrow('remoteUrl is required');
    });

    it('throws for unknown mode', () => {
      expect(() => createAgentFilesystem({ mode: 'unknown' as AgentFsMode })).toThrow('Unknown filesystem mode');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // LocalAgentFs (uses real filesystem in temp dir)
  // ──────────────────────────────────────────────────────────────────────

  describe('LocalAgentFs', () => {
    let tmpDir: string;
    let localFs: AgentFilesystem;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-fs-test-'));
      localFs = createAgentFilesystem({ mode: 'local', cwd: tmpDir });
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('has mode "local" and correct cwd', () => {
      expect(localFs.mode).toBe('local');
      expect(localFs.cwd).toBe(tmpDir);
    });

    it('writes and reads a file', async () => {
      await localFs.writeFile('test.txt', 'hello world');
      const content = await localFs.readFile('test.txt');
      expect(content).toBe('hello world');
    });

    it('reads absolute paths', async () => {
      const absPath = path.join(tmpDir, 'abs-test.txt');
      await fs.writeFile(absPath, 'absolute content', 'utf-8');
      const content = await localFs.readFile(absPath);
      expect(content).toBe('absolute content');
    });

    it('creates parent directories on write', async () => {
      await localFs.writeFile('nested/deep/file.txt', 'nested content');
      const content = await localFs.readFile('nested/deep/file.txt');
      expect(content).toBe('nested content');
    });

    it('reports exists=true for existing files', async () => {
      await localFs.writeFile('exists.txt', 'yes');
      expect(await localFs.exists('exists.txt')).toBe(true);
    });

    it('reports exists=false for missing files', async () => {
      expect(await localFs.exists('no-such-file.txt')).toBe(false);
    });

    it('lists directory entries', async () => {
      await localFs.writeFile('dir-a/x.txt', 'x');
      await localFs.writeFile('dir-a/y.txt', 'y');
      const entries = await localFs.listDirectory('dir-a');
      const names = entries.map(e => e.name).sort();
      expect(names).toEqual(['x.txt', 'y.txt']);
      expect(entries[0].type).toBe('file');
      expect(entries[0].path).toContain('dir-a/');
    });

    it('returns empty array for nonexistent directory', async () => {
      const entries = await localFs.listDirectory('nonexistent-dir');
      expect(entries).toEqual([]);
    });

    it('searches for files by name', async () => {
      await localFs.writeFile('search-test/find-me.ts', 'content');
      await localFs.writeFile('search-test/other.ts', 'content');
      const results = await localFs.search('find-me', { path: 'search-test' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.name.includes('find-me'))).toBe(true);
    });

    it('respects search limit', async () => {
      // Create many files matching "item"
      for (let i = 0; i < 10; i++) {
        await localFs.writeFile(`search-limit/item-${i}.ts`, 'content');
      }
      const results = await localFs.search('item', { path: 'search-limit', limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // VfsAgentFs
  // ──────────────────────────────────────────────────────────────────────

  describe('VfsAgentFs', () => {
    let vfsFs: AgentFilesystem;

    beforeEach(() => {
      vfsFs = createAgentFilesystem({ mode: 'vfs', userId: 'test-user', cwd: '/workspace' });
    });

    it('has mode "vfs" and correct cwd', () => {
      expect(vfsFs.mode).toBe('vfs');
      expect(vfsFs.cwd).toBe('/workspace');
    });

    it('reads file via VFS', async () => {
      const content = await vfsFs.readFile('/src/main.ts');
      expect(content).toBe('vfs-content:/src/main.ts');
    });

    it('writes file via VFS', async () => {
      const { virtualFilesystem } = await import('@/lib/virtual-filesystem');
      await vfsFs.writeFile('/src/new.ts', 'new content');
      expect(virtualFilesystem.writeFile).toHaveBeenCalledWith('test-user', '/src/new.ts', 'new content');
    });

    it('lists directory via VFS', async () => {
      const entries = await vfsFs.listDirectory('/src');
      expect(entries).toHaveLength(2);
      expect(entries[0].name).toBe('file.txt');
      expect(entries[0].type).toBe('file');
      expect(entries[1].name).toBe('subdir');
      expect(entries[1].type).toBe('directory');
    });

    it('reports exists=true when VFS readFile succeeds', async () => {
      expect(await vfsFs.exists('/src/main.ts')).toBe(true);
    });

    it('reports exists=false when VFS readFile throws', async () => {
      const { virtualFilesystem } = await import('@/lib/virtual-filesystem');
      vi.mocked(virtualFilesystem.readFile).mockRejectedValueOnce(new Error('not found'));
      expect(await vfsFs.exists('/missing.ts')).toBe(false);
    });

    it('searches via VFS', async () => {
      const results = await vfsFs.search('query-term');
      expect(results).toHaveLength(1);
      expect(results[0].name).toContain('query-term');
      expect(results[0].type).toBe('file');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // McpAgentFs
  // ──────────────────────────────────────────────────────────────────────

  describe('McpAgentFs', () => {
    let mcpFs: AgentFilesystem;

    beforeEach(() => {
      mcpFs = createAgentFilesystem({ mode: 'mcp', userId: 'mcp-user', cwd: '/workspace' });
    });

    it('has mode "mcp"', () => {
      expect(mcpFs.mode).toBe('mcp');
      expect(mcpFs.cwd).toBe('/workspace');
    });

    it('reads file via MCP tool', async () => {
      const content = await mcpFs.readFile('/config.json');
      expect(content).toBe('mcp-content:/config.json');
    });

    it('writes file via MCP tool', async () => {
      const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
      await mcpFs.writeFile('/config.json', '{"key":"val"}');
      expect(callMCPToolFromAI_SDK).toHaveBeenCalledWith(
        'write_file',
        { path: '/config.json', content: '{"key":"val"}' },
        'mcp-user',
      );
    });

    it('lists directory via MCP tool', async () => {
      const entries = await mcpFs.listDirectory('/workspace');
      expect(entries).toHaveLength(2);
      expect(entries.find(e => e.name === 'a.ts')).toBeDefined();
      expect(entries.find(e => e.name === 'b_dir')).toBeDefined();
    });

    it('reports exists=true when MCP read succeeds', async () => {
      expect(await mcpFs.exists('/a.ts')).toBe(true);
    });

    it('reports exists=false when MCP read fails', async () => {
      const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
      vi.mocked(callMCPToolFromAI_SDK).mockResolvedValueOnce({
        success: false,
        error: 'File not found',
      });
      expect(await mcpFs.exists('/missing.ts')).toBe(false);
    });

    it('searches via MCP tool', async () => {
      const results = await mcpFs.search('pattern');
      expect(results).toHaveLength(1);
      expect(results[0].name).toContain('pattern');
    });

    it('returns empty array when MCP list fails', async () => {
      const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
      vi.mocked(callMCPToolFromAI_SDK).mockResolvedValueOnce({
        success: false,
        error: 'Denied',
      });
      const entries = await mcpFs.listDirectory('/denied');
      expect(entries).toEqual([]);
    });

    it('throws on read when MCP tool fails', async () => {
      const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
      vi.mocked(callMCPToolFromAI_SDK).mockResolvedValueOnce({
        success: false,
        error: 'Permission denied',
      });
      await expect(mcpFs.readFile('/forbidden')).rejects.toThrow('Permission denied');
    });

    it('throws on write when MCP tool fails', async () => {
      const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
      vi.mocked(callMCPToolFromAI_SDK).mockResolvedValueOnce({
        success: false,
        error: 'Disk full',
      });
      await expect(mcpFs.writeFile('/full.txt', 'data')).rejects.toThrow('Disk full');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // RemoteAgentFs
  // ──────────────────────────────────────────────────────────────────────

  describe('RemoteAgentFs', () => {
    let remoteFs: AgentFilesystem;

    beforeEach(() => {
      remoteFs = createAgentFilesystem({
        mode: 'remote',
        remoteUrl: 'http://agent-server:8080',
        cwd: '/remote-workspace',
      });
      mockFetch.mockReset();
    });

    it('has mode "remote" and correct cwd', () => {
      expect(remoteFs.mode).toBe('remote');
      expect(remoteFs.cwd).toBe('/remote-workspace');
    });

    it('reads file from remote server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: 'remote-file-content' }),
      });
      const content = await remoteFs.readFile('/src/app.ts');
      expect(content).toBe('remote-file-content');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://agent-server:8080/fs/read',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: '/src/app.ts' }),
        }),
      );
    });

    it('writes file to remote server', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      await remoteFs.writeFile('/src/new.ts', 'new content');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://agent-server:8080/fs/write',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: '/src/new.ts', content: 'new content' }),
        }),
      );
    });

    it('lists directory from remote server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          entries: [
            { name: 'file.ts', path: '/src/file.ts', type: 'file' },
            { name: 'dir', path: '/src/dir', type: 'directory' },
          ],
        }),
      });
      const entries = await remoteFs.listDirectory('/src');
      expect(entries).toHaveLength(2);
      expect(entries[0].name).toBe('file.ts');
      expect(entries[1].type).toBe('directory');
    });

    it('reports exists from remote server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ exists: true }),
      });
      expect(await remoteFs.exists('/src/app.ts')).toBe(true);
    });

    it('reports exists=false when remote says so', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ exists: false }),
      });
      expect(await remoteFs.exists('/missing.ts')).toBe(false);
    });

    it('searches remote server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          entries: [{ name: 'match.ts', path: '/src/match.ts', type: 'file' }],
        }),
      });
      const results = await remoteFs.search('pattern', { path: '/src', limit: 10 });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('match.ts');
      // Verify options are forwarded
      const callBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(callBody).toEqual({ query: 'pattern', path: '/src', limit: 10 });
    });

    it('throws on HTTP error from remote server', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
      await expect(remoteFs.readFile('/fail.ts')).rejects.toThrow('Remote FS error: HTTP 500');
    });

    it('returns empty entries when remote list returns no entries field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      const entries = await remoteFs.listDirectory('/empty');
      expect(entries).toEqual([]);
    });

    it('returns empty string when remote read returns no content field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      const content = await remoteFs.readFile('/no-content');
      expect(content).toBe('');
    });

    it('strips trailing slashes from remoteUrl', async () => {
      const fs = createAgentFilesystem({
        mode: 'remote',
        remoteUrl: 'http://agent:3000///',
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: 'ok' }),
      });
      await fs.readFile('/test');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://agent:3000/fs/read',
        expect.anything(),
      );
    });

    it('defaults cwd to /workspace when not specified', () => {
      const fs = createAgentFilesystem({ mode: 'remote', remoteUrl: 'http://host:80' });
      expect(fs.cwd).toBe('/workspace');
    });
  });
});
