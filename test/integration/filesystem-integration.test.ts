/**
 * Integration Tests for Virtual Filesystem, Tool Integration, and Filesystem Flow
 *
 * Covers:
 * - VirtualFilesystemService event system (create/update/delete/snapshot events, unsubscribe)
 * - Path normalization (prepend workspace root, no duplication, traversal rejection, empty/root)
 * - CRUD operations (read/write roundtrip, language detection, versioning, delete, list, search, export)
 * - Filesystem tool integration (tambo local tools bridging to VFS)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

import { VirtualFilesystemService } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import type { FilesystemChangeEvent } from '@/lib/virtual-filesystem/virtual-filesystem-service';

const OWNER = 'test-owner';

function createService(): VirtualFilesystemService {
  return new VirtualFilesystemService({
    workspaceRoot: 'project',
    storageDir: '/tmp/vfs-test-' + Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Suite 1: Event system
// ---------------------------------------------------------------------------
describe('VirtualFilesystemService event system', () => {
  let vfs: VirtualFilesystemService;

  beforeEach(() => {
    vfs = createService();
  });

  it('writeFile emits "create" event for a new file', async () => {
    const events: FilesystemChangeEvent[] = [];
    vfs.onFileChange((e) => events.push(e));

    await vfs.writeFile(OWNER, 'hello.ts', 'console.log("hi")');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('create');
    expect(events[0].path).toBe('project/hello.ts');
    expect(events[0].ownerId).toBe(OWNER);
  });

  it('writeFile emits "update" event for an existing file', async () => {
    const events: FilesystemChangeEvent[] = [];
    await vfs.writeFile(OWNER, 'hello.ts', 'v1');

    vfs.onFileChange((e) => events.push(e));
    await vfs.writeFile(OWNER, 'hello.ts', 'v2');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('update');
  });

  it('deletePath emits "delete" event for each deleted file', async () => {
    await vfs.writeFile(OWNER, 'dir/a.ts', 'a');
    await vfs.writeFile(OWNER, 'dir/b.ts', 'b');

    const events: FilesystemChangeEvent[] = [];
    vfs.onFileChange((e) => events.push(e));

    await vfs.deletePath(OWNER, 'dir');

    const deleteEvents = events.filter((e) => e.type === 'delete');
    expect(deleteEvents).toHaveLength(2);
    const deletedPaths = deleteEvents.map((e) => e.path).sort();
    expect(deletedPaths).toEqual(['project/dir/a.ts', 'project/dir/b.ts']);
  });

  it('snapshot change events fire with correct version', async () => {
    const snapshots: { ownerId: string; version: number }[] = [];
    vfs.onSnapshotChange((ownerId, version) => snapshots.push({ ownerId, version }));

    await vfs.writeFile(OWNER, 'a.ts', 'a');
    await vfs.writeFile(OWNER, 'b.ts', 'b');

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].version).toBe(1);
    expect(snapshots[1].version).toBe(2);
    expect(snapshots[0].ownerId).toBe(OWNER);
  });

  it('event unsubscribe works', async () => {
    const events: FilesystemChangeEvent[] = [];
    const unsubscribe = vfs.onFileChange((e) => events.push(e));

    await vfs.writeFile(OWNER, 'a.ts', 'a');
    expect(events).toHaveLength(1);

    unsubscribe();

    await vfs.writeFile(OWNER, 'b.ts', 'b');
    expect(events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Path normalization
// ---------------------------------------------------------------------------
describe('VirtualFilesystemService path normalization', () => {
  let vfs: VirtualFilesystemService;

  beforeEach(() => {
    vfs = createService();
  });

  it('paths without workspace root prefix get it prepended', async () => {
    const file = await vfs.writeFile(OWNER, 'test.js', 'x');
    expect(file.path).toBe('project/test.js');
  });

  it('paths with workspace root do not get duplicated', async () => {
    const file = await vfs.writeFile(OWNER, 'project/test.js', 'x');
    expect(file.path).toBe('project/test.js');
  });

  it('path traversal with ".." throws error', async () => {
    await expect(vfs.writeFile(OWNER, '../etc/passwd', 'x')).rejects.toThrow(
      /path traversal is not allowed/i,
    );
  });

  it('empty/root paths normalize to workspace root', async () => {
    const listing1 = await vfs.listDirectory(OWNER, '');
    expect(listing1.path).toBe('project');

    const listing2 = await vfs.listDirectory(OWNER, '/');
    expect(listing2.path).toBe('project');
  });
});

// ---------------------------------------------------------------------------
// Suite 3: CRUD operations
// ---------------------------------------------------------------------------
describe('VirtualFilesystemService CRUD', () => {
  let vfs: VirtualFilesystemService;

  beforeEach(() => {
    vfs = createService();
  });

  it('writeFile + readFile roundtrip', async () => {
    const content = 'export const x = 42;';
    await vfs.writeFile(OWNER, 'index.ts', content);

    const file = await vfs.readFile(OWNER, 'index.ts');
    expect(file.content).toBe(content);
    expect(file.path).toBe('project/index.ts');
  });

  it('writeFile sets correct language from extension', async () => {
    const cases: [string, string][] = [
      ['app.ts', 'typescript'],
      ['app.js', 'javascript'],
      ['style.css', 'css'],
      ['data.json', 'json'],
      ['readme.md', 'markdown'],
      ['main.py', 'python'],
      ['unknown.xyz', 'text'],
    ];

    for (const [filename, expectedLang] of cases) {
      const file = await vfs.writeFile(OWNER, filename, '');
      expect(file.language).toBe(expectedLang);
    }
  });

  it('writeFile increments version on update', async () => {
    const v1 = await vfs.writeFile(OWNER, 'file.ts', 'v1');
    expect(v1.version).toBe(1);

    const v2 = await vfs.writeFile(OWNER, 'file.ts', 'v2');
    expect(v2.version).toBe(2);

    const v3 = await vfs.writeFile(OWNER, 'file.ts', 'v3');
    expect(v3.version).toBe(3);
  });

  it('deletePath removes files and returns correct count', async () => {
    await vfs.writeFile(OWNER, 'src/a.ts', 'a');
    await vfs.writeFile(OWNER, 'src/b.ts', 'b');
    await vfs.writeFile(OWNER, 'other.ts', 'other');

    const result = await vfs.deletePath(OWNER, 'src');
    expect(result.deletedCount).toBe(2);

    await expect(vfs.readFile(OWNER, 'src/a.ts')).rejects.toThrow(/not found/i);
    const other = await vfs.readFile(OWNER, 'other.ts');
    expect(other.content).toBe('other');
  });

  it('listDirectory returns correct files and subdirectories', async () => {
    await vfs.writeFile(OWNER, 'src/index.ts', '');
    await vfs.writeFile(OWNER, 'src/utils/helpers.ts', '');
    await vfs.writeFile(OWNER, 'readme.md', '');

    const listing = await vfs.listDirectory(OWNER, 'project');
    const names = listing.nodes.map((n) => n.name);

    expect(names).toContain('src');
    expect(names).toContain('readme.md');

    const srcDir = listing.nodes.find((n) => n.name === 'src');
    expect(srcDir?.type).toBe('directory');

    const readmeFile = listing.nodes.find((n) => n.name === 'readme.md');
    expect(readmeFile?.type).toBe('file');
  });

  it('search finds files by name and content', async () => {
    await vfs.writeFile(OWNER, 'utils.ts', 'export function helper() {}');
    await vfs.writeFile(OWNER, 'index.ts', 'import { helper } from "./utils"');

    const byName = await vfs.search(OWNER, 'utils');
    expect(byName.length).toBeGreaterThanOrEqual(1);
    expect(byName[0].path).toBe('project/utils.ts');

    const byContent = await vfs.search(OWNER, 'helper');
    expect(byContent.length).toBe(2);
  });

  it('exportWorkspace returns all files sorted', async () => {
    await vfs.writeFile(OWNER, 'b.ts', 'b');
    await vfs.writeFile(OWNER, 'a.ts', 'a');
    await vfs.writeFile(OWNER, 'c.ts', 'c');

    const snapshot = await vfs.exportWorkspace(OWNER);
    expect(snapshot.root).toBe('project');
    expect(snapshot.files).toHaveLength(3);
    expect(snapshot.files.map((f) => f.path)).toEqual([
      'project/a.ts',
      'project/b.ts',
      'project/c.ts',
    ]);
    expect(snapshot.version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Filesystem tool integration (tambo local tools → VFS)
// ---------------------------------------------------------------------------
describe('Filesystem tool integration', () => {
  let vfs: VirtualFilesystemService;
  let tools: typeof import('@/lib/tool-integration/providers/tambo-local-tools').tamboLocalTools;

  beforeEach(async () => {
    vfs = createService();

    // Build tool wrappers that delegate to our fresh VFS instance
    // mirroring the shapes in tambo-local-tools.ts
    tools = {
      readFile: async ({ path, ownerId }: { path: string; ownerId?: string }) => {
        const owner = ownerId || 'anon:public';
        const file = await vfs.readFile(owner, path);
        return { path: file.path, content: file.content, language: file.language, version: file.version };
      },
      writeFile: async ({ path, content, ownerId }: { path: string; content: string; ownerId?: string }) => {
        const owner = ownerId || 'anon:public';
        const file = await vfs.writeFile(owner, path, content);
        return { path: file.path, version: file.version, language: file.language, size: file.size };
      },
      listDirectory: async ({ path, ownerId }: { path?: string; ownerId?: string }) => {
        const owner = ownerId || 'anon:public';
        const listing = await vfs.listDirectory(owner, path);
        return { path: listing.path, entries: listing.nodes.map((n) => ({ name: n.name, type: n.type, path: n.path })) };
      },
      deletePath: async ({ path, ownerId }: { path: string; ownerId?: string }) => {
        const owner = ownerId || 'anon:public';
        const result = await vfs.deletePath(owner, path);
        return { deletedCount: result.deletedCount };
      },
      searchFiles: async ({ query, path, ownerId }: { query: string; path?: string; ownerId?: string }) => {
        const owner = ownerId || 'anon:public';
        const results = await vfs.search(owner, query, { path });
        return { results: results.map((r) => ({ path: r.path, name: r.name, language: r.language, snippet: r.snippet })) };
      },
    } as any;
  });

  it('readFile tool returns expected shape', async () => {
    await vfs.writeFile('anon:public', 'app.ts', 'const x = 1;');

    const result = await tools.readFile({ path: 'app.ts' });
    expect(result).toEqual({
      path: 'project/app.ts',
      content: 'const x = 1;',
      language: 'typescript',
      version: 1,
    });
  });

  it('writeFile tool returns expected shape', async () => {
    const result = await tools.writeFile({ path: 'app.ts', content: 'hello' });

    expect(result).toHaveProperty('path', 'project/app.ts');
    expect(result).toHaveProperty('version', 1);
    expect(result).toHaveProperty('language', 'typescript');
    expect(result).toHaveProperty('size');
    expect(typeof result.size).toBe('number');
  });

  it('listDirectory tool returns expected shape', async () => {
    await vfs.writeFile('anon:public', 'src/index.ts', '');
    await vfs.writeFile('anon:public', 'src/lib/util.ts', '');

    const result = await tools.listDirectory({ path: 'src' });

    expect(result.path).toBe('project/src');
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'lib', type: 'directory' }),
        expect.objectContaining({ name: 'index.ts', type: 'file' }),
      ]),
    );
  });

  it('deletePath tool returns expected shape', async () => {
    await vfs.writeFile('anon:public', 'tmp/a.ts', 'a');
    await vfs.writeFile('anon:public', 'tmp/b.ts', 'b');

    const result = await tools.deletePath({ path: 'tmp' });
    expect(result).toEqual({ deletedCount: 2 });
  });

  it('searchFiles tool returns expected shape', async () => {
    await vfs.writeFile('anon:public', 'utils.ts', 'export function greet() {}');

    const result = await tools.searchFiles({ query: 'greet' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        path: 'project/utils.ts',
        name: 'utils.ts',
        language: 'typescript',
      }),
    );
    expect(typeof result.results[0].snippet).toBe('string');
  });
});
