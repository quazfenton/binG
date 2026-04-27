/**
 * Pi Filesystem Adapters — Unit Tests
 *
 * Tests for lib/pi/pi-filesystem.ts
 * Covers: AgentFsAdapter wrapper, convenience subclasses (VfsFilesystemAdapter,
 * LocalFilesystemAdapter, McpToolsFilesystemAdapter, RemoteFilesystemAdapter),
 * factory functions (createFilesystemAdapter, createAutoFilesystemAdapter),
 * and DirEntry → PiDirEntry conversion.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

// ────────────────────────────────────────────────────────────────────────────
// Mocks — must come before imports that reference the mocked modules
// ────────────────────────────────────────────────────────────────────────────

vi.mock('@bing/platform/env', () => ({
  isDesktopMode: vi.fn(() => false),
  isLocalExecution: vi.fn(() => false),
  getDefaultWorkspaceRoot: vi.fn(() => null),
}));

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
        { name: 'alpha.ts', path: `${dirPath}/alpha.ts`, type: 'file', size: 42, lastModified: '2025-01-01' },
        { name: 'bravo', path: `${dirPath}/bravo`, type: 'directory' },
      ],
    })),
    search: vi.fn(async (_userId: string, query: string) => ({
      files: [
        { name: `${query}.ts`, path: `/workspace/${query}.ts` },
      ],
    })),
  },
}));

vi.mock('@/lib/mcp/architecture-integration', () => ({
  callMCPToolFromAI_SDK: vi.fn(async (toolName: string, args: Record<string, unknown>) => {
    if (toolName === 'read_file') return { success: true, output: `mcp:${args.path}` };
    if (toolName === 'write_file') return { success: true };
    if (toolName === 'list_files') {
      return {
        success: true,
        output: JSON.stringify({
          files: [{ name: 'mcp-file.ts', path: '/workspace/mcp-file.ts', type: 'file', size: 10 }],
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

const mockFetch = vi.fn(async (_url: string, _opts?: RequestInit) => ({
  ok: true,
  status: 200,
  json: async () => ({}),
}));
vi.stubGlobal('fetch', mockFetch);

// ────────────────────────────────────────────────────────────────────────────
// Imports (after mocks)
// ────────────────────────────────────────────────────────────────────────────

import {
  VfsFilesystemAdapter,
  LocalFilesystemAdapter,
  McpToolsFilesystemAdapter,
  RemoteFilesystemAdapter,
  createFilesystemAdapter,
  createAutoFilesystemAdapter,
} from '@/lib/pi/pi-filesystem';
import type { PiFilesystemAdapter, PiDirEntry } from '@/lib/pi/pi-types';

import { isDesktopMode, isLocalExecution } from '@bing/platform/env';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function toggleDesktopMode(value: boolean) {
  vi.mocked(isDesktopMode).mockReturnValue(value);
  vi.mocked(isLocalExecution).mockReturnValue(value);
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('pi-filesystem', () => {
  afterEach(() => {
    vi.clearAllMocks();
    toggleDesktopMode(false);
  });

  // ──────────────────────────────────────────────────────────────────────
  // VfsFilesystemAdapter
  // ──────────────────────────────────────────────────────────────────────

  describe('VfsFilesystemAdapter', () => {
    let adapter: PiFilesystemAdapter;

    beforeEach(() => {
      adapter = new VfsFilesystemAdapter('test-user', '/scope');
    });

    it('reads file via VFS', async () => {
      const content = await adapter.readFile('/src/main.ts');
      expect(content).toBe('vfs-content:/src/main.ts');
    });

    it('writes file via VFS', async () => {
      const { virtualFilesystem } = await import('@/lib/virtual-filesystem');
      await adapter.writeFile('/src/new.ts', 'new content');
      expect(virtualFilesystem.writeFile).toHaveBeenCalled();
    });

    it('lists directory and converts DirEntry → PiDirEntry', async () => {
      const entries = await adapter.listDirectory('/src');
      expect(entries).toHaveLength(2);

      const file = entries.find(e => e.name === 'alpha.ts')!;
      expect(file.type).toBe('file');
      expect(file.size).toBe(42);
      expect(file.lastModified).toBe('2025-01-01');
      expect(file.path).toContain('/src/alpha.ts');

      const dir = entries.find(e => e.name === 'bravo')!;
      expect(dir.type).toBe('directory');
    });

    it('checks existence via VFS', async () => {
      expect(await adapter.exists('/src/main.ts')).toBe(true);
    });

    it('searches and returns PiDirEntry[]', async () => {
      const results = await adapter.search('find-me');
      expect(results).toHaveLength(1);
      expect(results[0].name).toContain('find-me');
      expect(results[0].type).toBe('file');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // LocalFilesystemAdapter
  // ──────────────────────────────────────────────────────────────────────

  describe('LocalFilesystemAdapter', () => {
    let tmpDir: string;
    let adapter: PiFilesystemAdapter;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-fs-test-'));
      adapter = new LocalFilesystemAdapter(tmpDir);
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('defaults cwd to process.cwd() when omitted', async () => {
      const defaultAdapter = new LocalFilesystemAdapter();
      // Write to a relative path — should resolve under process.cwd()
      const testFile = `pi-default-cwd-test-${Date.now()}.txt`;
      try {
        await defaultAdapter.writeFile(testFile, 'cwd-test');
        // Verify the file landed at process.cwd()/testFile using direct fs
        const absPath = path.join(process.cwd(), testFile);
        const content = await fs.readFile(absPath, 'utf-8');
        expect(content).toBe('cwd-test');
      } finally {
        await fs.unlink(path.join(process.cwd(), testFile)).catch(() => {});
      }
    });

    it('writes and reads a file', async () => {
      await adapter.writeFile('hello.txt', 'hello from local');
      const content = await adapter.readFile('hello.txt');
      expect(content).toBe('hello from local');
    });

    it('lists directory with PiDirEntry format', async () => {
      await adapter.writeFile('list-dir/a.txt', 'a');
      await adapter.writeFile('list-dir/b.txt', 'b');

      const entries = await adapter.listDirectory('list-dir');
      const names = entries.map(e => e.name).sort();
      expect(names).toEqual(['a.txt', 'b.txt']);

      // Verify PiDirEntry fields
      expect(entries[0].type).toBe('file');
      expect(entries[0].path).toContain('list-dir/');
    });

    it('checks existence', async () => {
      await adapter.writeFile('exists.txt', 'yes');
      expect(await adapter.exists('exists.txt')).toBe(true);
      expect(await adapter.exists('nope.txt')).toBe(false);
    });

    it('searches files', async () => {
      await adapter.writeFile('search-src/target.ts', 'content');
      const results = await adapter.search('target', { path: 'search-src' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.name.includes('target'))).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // McpToolsFilesystemAdapter
  // ──────────────────────────────────────────────────────────────────────

  describe('McpToolsFilesystemAdapter', () => {
    let adapter: PiFilesystemAdapter;

    beforeEach(() => {
      adapter = new McpToolsFilesystemAdapter('mcp-user');
    });

    it('defaults userId to "default" when omitted', () => {
      const defaultAdapter = new McpToolsFilesystemAdapter();
      expect(defaultAdapter).toBeDefined();
    });

    it('reads file via MCP', async () => {
      const content = await adapter.readFile('/config.json');
      expect(content).toBe('mcp:/config.json');
    });

    it('writes file via MCP', async () => {
      const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
      await adapter.writeFile('/config.json', '{}');
      expect(callMCPToolFromAI_SDK).toHaveBeenCalledWith(
        'write_file',
        expect.objectContaining({ path: '/config.json', content: '{}' }),
        'mcp-user',
      );
    });

    it('lists directory and converts to PiDirEntry', async () => {
      const entries = await adapter.listDirectory('/workspace');
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('mcp-file.ts');
      expect(entries[0].type).toBe('file');
    });

    it('checks existence via MCP read', async () => {
      expect(await adapter.exists('/something')).toBe(true);
    });

    it('returns empty on MCP list failure', async () => {
      const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
      vi.mocked(callMCPToolFromAI_SDK).mockResolvedValueOnce({ success: false, error: 'Denied' });
      const entries = await adapter.listDirectory('/denied');
      expect(entries).toEqual([]);
    });

    it('searches via MCP tool and returns PiDirEntry[]', async () => {
      const results = await adapter.search('pattern', { path: '/workspace', limit: 10 });
      expect(results).toHaveLength(1);
      expect(results[0].name).toContain('pattern');
      expect(results[0].type).toBe('file');
    });

    it('returns empty on MCP search failure', async () => {
      const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
      vi.mocked(callMCPToolFromAI_SDK).mockResolvedValueOnce({ success: false, error: 'Search down' });
      const results = await adapter.search('broken');
      expect(results).toEqual([]);
    });

    it('throws on MCP read failure', async () => {
      const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
      vi.mocked(callMCPToolFromAI_SDK).mockResolvedValueOnce({ success: false, error: 'No access' });
      await expect(adapter.readFile('/forbidden')).rejects.toThrow('No access');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // RemoteFilesystemAdapter
  // ──────────────────────────────────────────────────────────────────────

  describe('RemoteFilesystemAdapter', () => {
    let adapter: PiFilesystemAdapter;

    beforeEach(() => {
      adapter = new RemoteFilesystemAdapter('http://remote-agent:9090', '/remote-ws');
      mockFetch.mockReset();
    });

    it('reads file from remote', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: 'remote-content' }),
      });
      const content = await adapter.readFile('/file.ts');
      expect(content).toBe('remote-content');
    });

    it('writes file to remote', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      await adapter.writeFile('/new.ts', 'content');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://remote-agent:9090/fs/write',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('lists directory from remote', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          entries: [
            { name: 'x.ts', path: '/ws/x.ts', type: 'file' },
            { name: 'ydir', path: '/ws/ydir', type: 'directory' },
          ],
        }),
      });
      const entries = await adapter.listDirectory('/ws');
      expect(entries).toHaveLength(2);
      expect(entries.find(e => e.name === 'x.ts')!.type).toBe('file');
      expect(entries.find(e => e.name === 'ydir')!.type).toBe('directory');
    });

    it('checks existence from remote', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ exists: true }),
      });
      expect(await adapter.exists('/file.ts')).toBe(true);
    });

    it('searches from remote', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          entries: [{ name: 'found.ts', path: '/ws/found.ts', type: 'file' }],
        }),
      });
      const results = await adapter.search('found', { limit: 5 });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('found.ts');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
      await expect(adapter.readFile('/down.ts')).rejects.toThrow('Remote FS error: HTTP 503');
    });

    it('defaults cwd to /workspace when not specified', async () => {
      const defaultAdapter = new RemoteFilesystemAdapter('http://host:80');
      // The public cwd getter should return the default
      expect(defaultAdapter.cwd).toBe('/workspace');
      // Also verify it works functionally
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: 'default-cwd-content' }),
      });
      const content = await defaultAdapter.readFile('/test.ts');
      expect(content).toBe('default-cwd-content');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // createFilesystemAdapter factory
  // ──────────────────────────────────────────────────────────────────────

  describe('createFilesystemAdapter', () => {
    it('creates VFS adapter', () => {
      const adapter = createFilesystemAdapter('vfs', { userId: 'u1' });
      expect(adapter).toBeDefined();
    });

    it('creates local adapter', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-factory-'));
      try {
        const adapter = createFilesystemAdapter('local', { cwd: tmpDir });
        expect(adapter).toBeDefined();
        await adapter.writeFile('test.txt', 'factory test');
        const content = await adapter.readFile('test.txt');
        expect(content).toBe('factory test');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('creates MCP adapter', () => {
      const adapter = createFilesystemAdapter('mcp', { userId: 'u2' });
      expect(adapter).toBeDefined();
    });

    it('creates remote adapter', () => {
      const adapter = createFilesystemAdapter('remote', { remoteUrl: 'http://host:1234' });
      expect(adapter).toBeDefined();
    });

    it('throws for remote without remoteUrl', () => {
      expect(() => createFilesystemAdapter('remote', {})).toThrow('remoteUrl is required');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // createAutoFilesystemAdapter factory
  // ──────────────────────────────────────────────────────────────────────

  describe('createAutoFilesystemAdapter', () => {
    it('creates local adapter in desktop mode and can read/write', async () => {
      toggleDesktopMode(true);
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-auto-local-'));
      try {
        const adapter = createAutoFilesystemAdapter({ cwd: tmpDir });
        expect(adapter).toBeDefined();
        // Verify the local backend is wired by doing a write/read round-trip
        await adapter.writeFile('auto-test.txt', 'auto-local-content');
        const content = await adapter.readFile('auto-test.txt');
        expect(content).toBe('auto-local-content');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('creates VFS adapter in web mode', async () => {
      toggleDesktopMode(false);
      const adapter = createAutoFilesystemAdapter({ userId: 'web-user' });
      expect(adapter).toBeDefined();
      // Verify VFS is wired: readFile should go through the mocked VFS
      const content = await adapter.readFile('/some-file.ts');
      expect(content).toBe('vfs-content:/some-file.ts');
    });

    it('passes options through to auto-detected mode', async () => {
      toggleDesktopMode(false);
      const adapter = createAutoFilesystemAdapter({ userId: 'u1', cwd: '/custom-ws', scopePath: '/scope' });
      expect(adapter).toBeDefined();
      // Verify VFS read works with the passed userId
      const content = await adapter.readFile('/opts-test.ts');
      expect(content).toBe('vfs-content:/opts-test.ts');
    });

    it('works with no options', async () => {
      toggleDesktopMode(false);
      const adapter = createAutoFilesystemAdapter();
      expect(adapter).toBeDefined();
      // Verify VFS read works with default userId ('default')
      const content = await adapter.readFile('/no-opts.ts');
      expect(content).toBe('vfs-content:/no-opts.ts');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // DirEntry → PiDirEntry conversion (toPiDirEntry)
  // ──────────────────────────────────────────────────────────────────────

  describe('DirEntry → PiDirEntry conversion', () => {
    it('preserves all fields through the adapter', async () => {
      const adapter = new VfsFilesystemAdapter('conv-user');
      const entries = await adapter.listDirectory('/conv');

      // VFS mock returns alpha.ts with size=42 and lastModified='2025-01-01'
      const fileEntry = entries.find(e => e.name === 'alpha.ts')!;
      expect(fileEntry).toEqual({
        name: 'alpha.ts',
        path: '/conv/alpha.ts',
        type: 'file',
        size: 42,
        lastModified: '2025-01-01',
      });

      // Directory entry (no size/lastModified in mock)
      const dirEntry = entries.find(e => e.name === 'bravo')!;
      expect(dirEntry).toEqual({
        name: 'bravo',
        path: '/conv/bravo',
        type: 'directory',
        size: undefined,
        lastModified: undefined,
      });
    });
  });
});
