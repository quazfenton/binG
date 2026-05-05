import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ripgrepVFS } from '../ripgrep-vfs-adapter';

// Mock dependencies
vi.mock('@bing/platform/env', () => ({
  isDesktopMode: vi.fn(() => false),
}));

vi.mock('@bing/shared/FS/fs-bridge', () => ({
  isUsingLocalFS: vi.fn(() => false),
}));

vi.mock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
  virtualFilesystem: {
    vfs: {
      ensureWorkspace: vi.fn(async () => ({
        files: new Map([
          ['project/src/index.ts', {
            path: 'project/src/index.ts',
            content: 'import React from "react";\n\nfunction App() {\n  return <div>Hello World</div>;\n}\n\nexport default App;',
            language: 'typescript',
            lastModified: new Date().toISOString(),
          }],
          ['project/src/utils.ts', {
            path: 'project/src/utils.ts',
            content: 'export function hello() {\n  console.log("Hello");\n}\n\nexport function world() {\n  console.log("World");\n}',
            language: 'typescript',
            lastModified: new Date().toISOString(),
          }],
          ['project/README.md', {
            path: 'project/README.md',
            content: '# My Project\n\nThis is a test project.\n\nHello world!',
            language: 'markdown',
            lastModified: new Date().toISOString(),
          }],
        ]),
        version: 1,
        updatedAt: new Date().toISOString(),
        loaded: true,
      })),
    },
  },
}));

describe('ripgrepVFS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should search VFS and find matches', async () => {
    const result = await ripgrepVFS({
      query: 'Hello',
      ownerId: 'test-user',
      caseInsensitive: false,
    });

    expect(result.usedVFS).toBe(true);
    expect(result.usedRipgrep).toBe(false);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.stats.filesSearched).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });

  it('should perform case-insensitive search', async () => {
    const result = await ripgrepVFS({
      query: 'hello',
      ownerId: 'test-user',
      caseInsensitive: true,
    });

    expect(result.matches.length).toBeGreaterThan(0);
    const hasMatch = result.matches.some(m => 
      m.content.toLowerCase().includes('hello')
    );
    expect(hasMatch).toBe(true);
  });

  it('should respect maxResults limit', async () => {
    const result = await ripgrepVFS({
      query: 'e', // Common letter, should match many lines
      ownerId: 'test-user',
      maxResults: 2,
    });

    expect(result.matches.length).toBeLessThanOrEqual(2);
  });

  it('should filter by glob pattern', async () => {
    const result = await ripgrepVFS({
      query: 'Hello',
      ownerId: 'test-user',
      glob: '*.ts',
    });

    expect(result.matches.length).toBeGreaterThan(0);
    result.matches.forEach(match => {
      expect(match.path).toMatch(/\.ts$/);
    });
  });

  it('should support fixed string search', async () => {
    const result = await ripgrepVFS({
      query: 'function App()',
      ownerId: 'test-user',
      fixedString: true,
    });

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].content).toContain('function App()');
  });

  it('should include context lines when requested', async () => {
    const result = await ripgrepVFS({
      query: 'Hello World',
      ownerId: 'test-user',
      contextLines: 2,
    });

    expect(result.matches.length).toBeGreaterThan(0);
    const match = result.matches[0];
    expect(match.contextBefore).toBeDefined();
    expect(match.contextAfter).toBeDefined();
  });

  it('should handle word regexp search', async () => {
    const result = await ripgrepVFS({
      query: 'App',
      ownerId: 'test-user',
      wordRegexp: true,
    });

    expect(result.matches.length).toBeGreaterThan(0);
    // Should match "App" as a whole word, not "Application"
  });

  it('should return empty results for no matches', async () => {
    const result = await ripgrepVFS({
      query: 'NonExistentString12345',
      ownerId: 'test-user',
    });

    expect(result.matches).toEqual([]);
    expect(result.stats.matches).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('should handle invalid regex gracefully', async () => {
    const result = await ripgrepVFS({
      query: '[invalid(regex',
      ownerId: 'test-user',
      fixedString: false, // Treat as regex
    });

    expect(result.matches).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Invalid regex');
  });

  it('should search within specific path', async () => {
    const result = await ripgrepVFS({
      query: 'Hello',
      ownerId: 'test-user',
      path: 'project/src',
    });

    expect(result.matches.length).toBeGreaterThan(0);
    result.matches.forEach(match => {
      expect(match.path).toMatch(/^project\/src\//);
    });
  });

  it('should respect maxCountPerFile limit', async () => {
    const result = await ripgrepVFS({
      query: 'e', // Common letter
      ownerId: 'test-user',
      maxCountPerFile: 1,
    });

    // Group matches by file
    const matchesByFile = new Map<string, number>();
    result.matches.forEach(match => {
      matchesByFile.set(match.path, (matchesByFile.get(match.path) || 0) + 1);
    });

    // Each file should have at most 1 match
    matchesByFile.forEach(count => {
      expect(count).toBeLessThanOrEqual(1);
    });
  });

  it('should return stats with correct counts', async () => {
    const result = await ripgrepVFS({
      query: 'Hello',
      ownerId: 'test-user',
    });

    expect(result.stats.searches).toBe(1);
    expect(result.stats.matches).toBe(result.matches.length);
    expect(result.stats.filesWithMatches).toBeGreaterThan(0);
    expect(result.stats.filesSearched).toBeGreaterThan(0);
    expect(result.stats.elapsedMs).toBeGreaterThan(0);
  });
});
