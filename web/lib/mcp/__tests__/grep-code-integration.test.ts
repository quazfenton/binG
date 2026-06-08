import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@bing/platform/env', () => ({
  isDesktopMode: vi.fn(() => false),
  isTauriRuntime: vi.fn(() => false),
  isLocalExecution: vi.fn(() => false),
  getPlatform: vi.fn(() => 'linux'),
  getDefaultWorkspaceRoot: vi.fn(() => '/workspace'),
}));

vi.mock('@bing/shared/FS/fs-bridge', () => ({
  isUsingLocalFS: vi.fn(() => false),
}));

// Mock ripgrepVFS adapter — grepCodeTool delegates actual search to it
vi.mock('@/lib/search/ripgrep-vfs-adapter', () => ({
  ripgrepVFS: vi.fn().mockImplementation(async (opts: any) => {
    const query = opts.query || '';
    const lowerQuery = query.toLowerCase();
    const caseSensitive = !opts.caseInsensitive;

    // Simulate search across the mock VFS files
    const mockFiles = [
      { path: 'workspace/src/index.ts', content: 'import React from "react";\n\nfunction App() {\n  return <div>Hello World</div>;\n}\n\nexport default App;' },
      { path: 'workspace/src/utils.ts', content: 'export function hello() {\n  console.log("Hello");\n}\n\nexport function world() {\n  console.log("World");\n}' },
    ];

    // Filter by glob if specified
    let filteredFiles = mockFiles;
    if (opts.glob) {
      const globPattern = Array.isArray(opts.glob) ? opts.glob : [opts.glob];
      filteredFiles = mockFiles.filter(f =>
        globPattern.some(g => {
          const ext = g.replace('*.', '');
          return f.path.endsWith('.' + ext);
        })
      );
    }

    // Determine if we should use ripgrep mode or VFS mode based on context
    const usedRipgrep = false; // Tests simulate web/VFS mode
    const usedVFS = true;

    const matches: any[] = [];
    const startTime = Date.now();

    for (const file of filteredFiles) {
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match = false;

        if (opts.fixedString) {
          match = caseSensitive ? line.includes(query) : line.toLowerCase().includes(lowerQuery);
        } else if (opts.wordRegexp) {
          // Let regex errors propagate so grepCodeTool.execute() returns success: false
          const regex = new RegExp(`\\b${query}\\b`, caseSensitive ? '' : 'i');
          match = regex.test(line);
        } else {
          // Let regex errors propagate — don't catch, so the tool returns success: false
          const regex = new RegExp(query, caseSensitive ? '' : 'i');
          match = regex.test(line);
        }

        if (match) {
          const matchObj: any = {
            path: file.path,
            lineNumber: i + 1,
            content: line,
          };

          // Add context lines if requested
          if (opts.contextLines && opts.contextLines > 0) {
            const ctx = opts.contextLines;
            const start = Math.max(0, i - ctx);
            const end = Math.min(lines.length, i + ctx + 1);
            matchObj.contextBefore = lines.slice(start, i);
            matchObj.contextAfter = lines.slice(i + 1, end);
          }

          matches.push(matchObj);

          // Respect maxCountPerFile
          if (opts.maxCountPerFile) {
            const fileMatches = matches.filter(m => m.path === file.path);
            if (fileMatches.length >= opts.maxCountPerFile) break;
          }

          // Respect maxResults
          if (opts.maxResults && matches.length >= opts.maxResults) break;
        }
      }
      if (opts.maxResults && matches.length >= opts.maxResults) break;
    }

    return {
      matches,
      usedRipgrep,
      usedVFS,
      stats: {
        searches: 1,
        matches: matches.length,
        filesWithMatches: new Set(matches.map((m: any) => m.path)).size,
        filesSearched: filteredFiles.length,
        elapsedMs: Math.max(1, Date.now() - startTime),
      },
    };
  }),
}));

vi.mock('../../../../../virtual-filesystem/virtual-filesystem-service', () => ({
  virtualFilesystem: {
    vfs: {
      ensureWorkspace: vi.fn(async () => ({
        files: new Map([
          ['workspace/src/index.ts', {
            path: 'workspace/src/index.ts',
            content: 'import React from "react";\n\nfunction App() {\n  return <div>Hello World</div>;\n}\n\nexport default App;',
            language: 'typescript',
            lastModified: new Date().toISOString(),
          }],
          ['workspace/src/utils.ts', {
            path: 'workspace/src/utils.ts',
            content: 'export function hello() {\n  console.log("Hello");\n}\n\nexport function world() {\n  console.log("World");\n}',
            language: 'typescript',
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

describe('grep_code tool integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return structured results that LLM can parse', async () => {
    // Import the tool
    const { grepCodeTool } = await import('../vfs-mcp-tools');
    
    // Mock tool context
    const { toolContextStore } = await import('../vfs-mcp-tools');
    toolContextStore.enterWith({ userId: 'test-user', scopePath: 'workspace' });
    
    // Execute the tool
    const result = await grepCodeTool.execute({
      query: 'function',
      caseInsensitive: false,
    });

    // Verify result structure
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('query');
    expect(result).toHaveProperty('matches');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('stats');
    
    // Verify success
    expect(result.success).toBe(true);
    
    // Verify matches have correct structure
    expect(Array.isArray(result.matches)).toBe(true);
    if (result.matches.length > 0) {
      const match = result.matches[0];
      expect(match).toHaveProperty('path');
      expect(match).toHaveProperty('line');
      expect(match).toHaveProperty('content');
      
      // Verify path is VFS-normalized (no leading slash, forward slashes)
      expect(match.path).not.toMatch(/^\//);
      expect(match.path).toMatch(/^workspace\//);
    }
  });

  it('should return results with context lines when requested', async () => {
    const { grepCodeTool } = await import('../vfs-mcp-tools');
    const { toolContextStore } = await import('../vfs-mcp-tools');
    toolContextStore.enterWith({ userId: 'test-user', scopePath: 'workspace' });
    
    const result = await grepCodeTool.execute({
      query: 'function',
      contextLines: 2,
    });

    expect(result.success).toBe(true);
    if (result.matches.length > 0) {
      const match = result.matches[0];
      expect(match).toHaveProperty('contextBefore');
      expect(match).toHaveProperty('contextAfter');
    }
  });

  it('should handle glob patterns correctly', async () => {
    const { grepCodeTool } = await import('../vfs-mcp-tools');
    const { toolContextStore } = await import('../vfs-mcp-tools');
    toolContextStore.enterWith({ userId: 'test-user', scopePath: 'workspace' });
    
    const result = await grepCodeTool.execute({
      query: 'function',
      glob: '*.ts',
    });

    expect(result.success).toBe(true);
    // All matches should be from .ts files
    result.matches.forEach(match => {
      expect(match.path).toMatch(/\.ts$/);
    });
  });

  it('should return metadata about search method used', async () => {
    const { grepCodeTool } = await import('../vfs-mcp-tools');
    const { toolContextStore } = await import('../vfs-mcp-tools');
    toolContextStore.enterWith({ userId: 'test-user', scopePath: 'workspace' });
    
    const result = await grepCodeTool.execute({
      query: 'function',
    });

    expect(result).toHaveProperty('usedRipgrep');
    expect(result).toHaveProperty('usedVFS');
    expect(typeof result.usedRipgrep).toBe('boolean');
    expect(typeof result.usedVFS).toBe('boolean');
  });

  it('should return stats about search performance', async () => {
    const { grepCodeTool } = await import('../vfs-mcp-tools');
    const { toolContextStore } = await import('../vfs-mcp-tools');
    toolContextStore.enterWith({ userId: 'test-user', scopePath: 'workspace' });
    
    const result = await grepCodeTool.execute({
      query: 'function',
    });

    expect(result.stats).toBeDefined();
    expect(result.stats).toHaveProperty('searches');
    expect(result.stats).toHaveProperty('matches');
    expect(result.stats).toHaveProperty('filesWithMatches');
    expect(result.stats).toHaveProperty('filesSearched');
    expect(result.stats).toHaveProperty('elapsedMs');
    
    expect(result.stats.elapsedMs).toBeGreaterThan(0);
  });

  it('should handle errors gracefully and return structured error', async () => {
    const { grepCodeTool } = await import('../vfs-mcp-tools');
    const { toolContextStore } = await import('../vfs-mcp-tools');
    toolContextStore.enterWith({ userId: 'test-user', scopePath: 'workspace' });
    
    // Invalid regex pattern
    const result = await grepCodeTool.execute({
      query: '[invalid(regex',
      fixedString: false,
    });

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('error');
    expect(result.success).toBe(false);
    expect(result.matches).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should respect maxResults limit', async () => {
    const { grepCodeTool } = await import('../vfs-mcp-tools');
    const { toolContextStore } = await import('../vfs-mcp-tools');
    toolContextStore.enterWith({ userId: 'test-user', scopePath: 'workspace' });
    
    const result = await grepCodeTool.execute({
      query: 'e', // Common letter
      maxResults: 2,
    });

    expect(result.success).toBe(true);
    expect(result.matches.length).toBeLessThanOrEqual(2);
  });

  it('should work with case-insensitive search', async () => {
    const { grepCodeTool } = await import('../vfs-mcp-tools');
    const { toolContextStore } = await import('../vfs-mcp-tools');
    toolContextStore.enterWith({ userId: 'test-user', scopePath: 'workspace' });
    
    const result = await grepCodeTool.execute({
      query: 'FUNCTION',
      caseInsensitive: true,
    });

    expect(result.success).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('should work with fixed string search', async () => {
    const { grepCodeTool } = await import('../vfs-mcp-tools');
    const { toolContextStore } = await import('../vfs-mcp-tools');
    toolContextStore.enterWith({ userId: 'test-user', scopePath: 'workspace' });
    
    const result = await grepCodeTool.execute({
      query: 'function App()',
      fixedString: true,
    });

    expect(result.success).toBe(true);
    if (result.matches.length > 0) {
      expect(result.matches[0].content).toContain('function App()');
    }
  });
});
