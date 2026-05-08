import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@bing/platform/env', () => ({
  isDesktopMode: vi.fn(() => false),
}));

vi.mock('@bing/shared/FS/fs-bridge', () => ({
  isUsingLocalFS: vi.fn(() => false),
}));

vi.mock('../../virtual-filesystem/virtual-filesystem-service', () => ({
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
    toolContextStore.set('ownerId', 'test-user');
    
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
      expect(match.path).toMatch(/^project\//);
    }
  });

  it('should return results with context lines when requested', async () => {
    const { grepCodeTool } = await import('../vfs-mcp-tools');
    const { toolContextStore } = await import('../vfs-mcp-tools');
    toolContextStore.set('ownerId', 'test-user');
    
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
    toolContextStore.set('ownerId', 'test-user');
    
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
    toolContextStore.set('ownerId', 'test-user');
    
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
    toolContextStore.set('ownerId', 'test-user');
    
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
    toolContextStore.set('ownerId', 'test-user');
    
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
    toolContextStore.set('ownerId', 'test-user');
    
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
    toolContextStore.set('ownerId', 'test-user');
    
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
    toolContextStore.set('ownerId', 'test-user');
    
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
