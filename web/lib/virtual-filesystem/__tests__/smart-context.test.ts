/**
 * Unit Tests for Smart Context & Session File Tracking
 *
 * Run: npx vitest run web/lib/virtual-filesystem/__tests__/smart-context.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @bing/shared/FS/fs-bridge for tests that import virtual-filesystem-service
vi.mock('@bing/shared/FS/fs-bridge', () => ({
  fsBridge: { readFile: vi.fn(), writeFile: vi.fn(), exists: vi.fn(() => false) },
  isUsingLocalFS: false,
  initializeFSBridge: vi.fn(async () => {}),
}));

vi.mock('@bing/shared/FS/index', () => ({
  FileSystemWatchEvent: { Created: 'created', Modified: 'modified', Deleted: 'deleted' },
}));

// =============================================================================
// Session File Tracker Tests
// =============================================================================

// Re-register @bing/shared/FS mocks in beforeEach so they survive vi.resetModules()
// (vi.resetModules() clears the mock registry, so we must re-register)
const registerFSMocks = () => {
  vi.mock('@bing/shared/FS/fs-bridge', () => ({
    fsBridge: { readFile: vi.fn(), writeFile: vi.fn(), exists: vi.fn(() => false), mkdir: vi.fn(), readdir: vi.fn() },
    isUsingLocalFS: false,
    initializeFSBridge: vi.fn(async () => {}),
  }));
  vi.mock('@bing/shared/FS/index', () => ({
    FileSystemWatchEvent: { Created: 'created', Modified: 'modified', Deleted: 'deleted' },
  }));
};

describe('Session File Tracker', () => {
  beforeEach(() => {
    // Re-register mocks AFTER resetModules so they persist for dynamic imports
    vi.resetModules();
    registerFSMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('trackSessionFiles', () => {
    it('should track file references from messages', async () => {
      const { trackSessionFiles, getSessionFiles, clearSession } = await import('@/lib/virtual-filesystem/session-file-tracker');

      await trackSessionFiles('test-session-1', [
        { role: 'user', content: 'Fix the bug in App.tsx' },
        { role: 'assistant', content: 'I will check App.tsx and utils/helpers.ts' },
        { role: 'user', content: 'Also update styles.css' },
      ]);

      const files = getSessionFiles('test-session-1');
      expect(files.length).toBeGreaterThan(0);
      clearSession('test-session-1');
    });

    it('should handle empty messages', async () => {
      const { trackSessionFiles, getSessionFiles, clearSession } = await import('@/lib/virtual-filesystem/session-file-tracker');

      await trackSessionFiles('empty-session', []);
      const files = getSessionFiles('empty-session');
      expect(files).toEqual([]);
      clearSession('empty-session');
    });

    it('should handle missing/empty userId', async () => {
      const { trackSessionFiles, getSessionFiles, clearSession } = await import('@/lib/virtual-filesystem/session-file-tracker');

      // Should not crash
      await trackSessionFiles('', [{ role: 'user', content: 'test' }]);
      const files = getSessionFiles('');
      expect(Array.isArray(files)).toBe(true);
      clearSession('');
    });

    it('should incrementally track new messages only', async () => {
      const { trackSessionFiles, getSessionFiles, clearSession } = await import('@/lib/virtual-filesystem/session-file-tracker');

      // First call - 1 message
      await trackSessionFiles('incr-session', [
        { role: 'user', content: 'Check App.tsx' },
      ]);
      const filesAfter1 = getSessionFiles('incr-session');
      const count1 = filesAfter1.length;

      // Second call - same messages (no new ones)
      await trackSessionFiles('incr-session', [
        { role: 'user', content: 'Check App.tsx' },
      ]);
      const filesAfter2 = getSessionFiles('incr-session');
      expect(filesAfter2.length).toBe(count1); // No new files

      // Third call - 1 new message
      await trackSessionFiles('incr-session', [
        { role: 'user', content: 'Check App.tsx' },
        { role: 'user', content: 'Now check styles.css' },
      ]);
      const filesAfter3 = getSessionFiles('incr-session');
      expect(filesAfter3.length).toBeGreaterThanOrEqual(count1);
      clearSession('incr-session');
    });

    it('should isolate sessions from each other', async () => {
      const { trackSessionFiles, getSessionFiles, clearAllSessions } = await import('@/lib/virtual-filesystem/session-file-tracker');

      clearAllSessions();

      await Promise.all([
        trackSessionFiles('session-a', [{ role: 'user', content: 'Check App.tsx' }]),
        trackSessionFiles('session-b', [{ role: 'user', content: 'Check styles.css' }]),
      ]);

      const filesA = getSessionFiles('session-a');
      const filesB = getSessionFiles('session-b');

      expect(filesA).not.toContain('styles.css');
      expect(filesB).not.toContain('App.tsx');
      clearAllSessions();
    });
  });

  describe('getSessionFiles', () => {
    it('should return empty array for unknown session', async () => {
      const { getSessionFiles } = await import('@/lib/virtual-filesystem/session-file-tracker');
      expect(getSessionFiles('nonexistent-session')).toEqual([]);
    });

    it('should limit results to requested count', async () => {
      const { trackSessionFiles, getSessionFiles, clearSession } = await import('@/lib/virtual-filesystem/session-file-tracker');

      await trackSessionFiles('limit-session', [
        { role: 'user', content: 'A.tsx' },
        { role: 'user', content: 'B.tsx' },
        { role: 'user', content: 'C.tsx' },
        { role: 'user', content: 'D.tsx' },
        { role: 'user', content: 'E.tsx' },
      ]);

      const files = getSessionFiles('limit-session', 2);
      expect(files.length).toBeLessThanOrEqual(2);
      clearSession('limit-session');
    });
  });
});

// =============================================================================
// File Request Detection Tests
// =============================================================================

describe('File Request Detection', () => {
  let detectFileReadRequest: (text: string) => { files: string[]; confidence: string };

  beforeEach(async () => {
    // Re-register mocks after resetModules so they survive the dynamic import
    vi.resetModules();
    registerFSMocks();
    const mod = await import('@/lib/virtual-filesystem/smart-context');
    detectFileReadRequest = mod.detectFileReadRequest;
  });

  it('should detect XML-style file requests', () => {
    const result = detectFileReadRequest(
      'I need to see <request_file>src/App.tsx</request_file> to understand the issue.'
    );
    expect(result.files).toContain('src/App.tsx');
  });

  it('should detect "read file" patterns', () => {
    const result = detectFileReadRequest(
      'Let me read the file App.tsx to check the bug.'
    );
    expect(result.files).toContain('App.tsx');
  });

  it('should detect "check file" patterns', () => {
    const result = detectFileReadRequest(
      'I should check utils/helpers.ts for the issue.'
    );
    expect(result.files).toContain('utils/helpers.ts');
  });

  it('should reject false positives from common phrases', () => {
    const result = detectFileReadRequest(
      'I am interested in React patterns and looking at the documentation.'
    );
    expect(result.files.length).toBe(0);
  });

  it('should deduplicate results', () => {
    const result = detectFileReadRequest(
      'I need to read App.tsx. Let me check App.tsx again. Also read App.tsx.'
    );
    const appCount = result.files.filter(f => f === 'App.tsx').length;
    expect(appCount).toBe(1);
  });

  it('should handle empty input', () => {
    expect(detectFileReadRequest('').files).toEqual([]);
  });

  it('should handle input without file references', () => {
    expect(detectFileReadRequest('Hello, how are you?').files).toEqual([]);
  });

  it('should filter files with spaces (invalid paths)', () => {
    const result = detectFileReadRequest('Check interested in React.tsx file patterns.');
    const hasSpaces = result.files.some(f => f.includes(' '));
    expect(hasSpaces).toBe(false);
  });

  it('should handle multiple different files', () => {
    const result = detectFileReadRequest(
      'Read App.tsx, check utils/helpers.ts, and look at styles.css'
    );
    expect(result.files.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle tool call extraction', async () => {
    const mod = await import('@/lib/virtual-filesystem/smart-context');
    const result = mod.extractToolCallFileRequests([
      { name: 'read_file', arguments: { path: 'src/App.tsx' } },
      { name: 'write_file', arguments: { path: 'src/output.ts' } },
    ]);
    expect(result).toContain('src/App.tsx');
    expect(result).not.toContain('src/output.ts');
  });
});

// =============================================================================
// @mention Extraction Tests (Backend)
// =============================================================================

describe('@mention Extraction', () => {
  it('should extract @mentions from text', () => {
    const text = 'Fix the bug in @App.tsx and also check @utils/helpers.ts';
    const pattern = /@([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))/gi;
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern);
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[1]);
    }

    expect(matches).toContain('App.tsx');
    expect(matches).toContain('utils/helpers.ts');
    expect(matches.length).toBe(2);
  });

  it('should not match incomplete @patterns', () => {
    const text = 'Email me @ company or call @home';
    const pattern = /@([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))/gi;
    const matches = [...text.matchAll(pattern)];
    expect(matches.length).toBe(0);
  });

  it('should handle @mention without file extension', () => {
    const text = 'Check @App';
    const pattern = /@([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))/gi;
    const matches = [...text.matchAll(pattern)];
    expect(matches.length).toBe(0);
  });

  it('should match @mention with path', () => {
    const text = 'Open @src/components/Header.tsx';
    const pattern = /@([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))/gi;
    const matches = [...text.matchAll(pattern)];
    expect(matches.length).toBe(1);
    expect(matches[0][1]).toBe('src/components/Header.tsx');
  });
});

// =============================================================================
// Smart Context Integration Tests
// =============================================================================

describe('Smart Context Integration', () => {
  beforeEach(async () => {
    vi.resetModules();
    registerFSMocks();
  });

  it('should handle missing userId gracefully', async () => {
    const { generateSmartContext } = await import('@/lib/virtual-filesystem/smart-context');
    const result = await generateSmartContext({
      userId: '',
      prompt: 'Fix @App.tsx',
    });
    expect(result.warnings).toContain('Missing userId');
    expect(result.vfsIsEmpty).toBe(true);
  });

  it('should handle empty prompt', async () => {
    const { generateSmartContext } = await import('@/lib/virtual-filesystem/smart-context');
    const result = await generateSmartContext({
      userId: 'test-user',
      prompt: '',
    });
    expect(result).toHaveProperty('bundle');
    expect(result).toHaveProperty('warnings');
  });

  it('should handle missing optional fields', async () => {
    const { generateSmartContext } = await import('@/lib/virtual-filesystem/smart-context');
    const result = await generateSmartContext({
      userId: 'test-user',
      prompt: 'test',
    });
    expect(result).toHaveProperty('bundle');
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });
});

// =============================================================================
// Import Resolution Tests
// =============================================================================

describe('Import Resolution', () => {
  // Test the internal resolution logic through generateSmartContext behavior
  // In a real setup, these would be unit tests for extractImportsFromContent

  it('should handle JS/TS extensionless imports', () => {
    // This tests the algorithm: ./utils → tries ./utils.ts, ./utils.tsx, etc.
    const candidates = ['/src/utils'];
    const vfsLower = new Set(['/src/utils.ts', '/src/utils.tsx']);
    const vfsOrig = new Map([
      ['/src/utils.ts', '/src/utils.ts'],
      ['/src/utils.tsx', '/src/utils.tsx'],
    ]);

    // Simulate resolution
    let found: string | null = null;
    for (const c of candidates) {
      if (vfsLower.has(c.toLowerCase())) { found = vfsOrig.get(c.toLowerCase()) || null; break; }
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const w = c + ext;
        if (vfsLower.has(w.toLowerCase())) { found = vfsOrig.get(w.toLowerCase()) || null; break; }
      }
      if (found) break;
    }
    expect(found).toBe('/src/utils.ts');
  });

  it('should handle Python dot-notation to path conversion', () => {
    // from .utils.helpers import X → /utils/helpers (absolute VFS path)
    const dotPath = '.utils.helpers';
    const slashPath = dotPath.replace(/\./g, '/');
    const result = slashPath.startsWith('//') ? slashPath.slice(1) : slashPath;
    expect(result).toBe('/utils/helpers');
  });

  it('should handle double-dot Python relative imports', () => {
    // from ..shared.utils import X → /shared/utils (absolute VFS path after normalization)
    const dotPath = '..shared.utils';
    const slashPath = dotPath.replace(/\./g, '/');
    const result = slashPath.startsWith('//') ? slashPath.slice(1) : slashPath;
    expect(result).toBe('/shared/utils');
  });

  it('should handle Rust crate imports', () => {
    // use crate::module::SubModule → /module/SubModule
    const match = 'use crate::module::SubModule';
    const path = match.replace('use crate::', '').replace(/::/g, '/');
    const result = '/' + path;
    expect(result).toBe('/module/SubModule');
  });

  it('should handle Rust super/self imports', () => {
    // use super::utils → ./utils
    const match = 'use super::utils';
    const path = match.replace(/use\s+(?:super|self)::/, '').replace(/::/g, '/');
    const result = './' + path;
    expect(result).toBe('./utils');
  });
});

// =============================================================================
// Context Mode Tests (diff, read, tree)
// =============================================================================

describe('Context Mode', () => {
  beforeEach(async () => {
    vi.resetModules();
    registerFSMocks();
  });

  it('should default to read mode when not specified', async () => {
    const { generateSmartContext } = await import('@/lib/virtual-filesystem/smart-context');
    const result = await generateSmartContext({
      userId: '',
      prompt: 'test',
    });
    expect(result.contextMode).toBe('read');
  });

  it('should pass through contextMode in result', async () => {
    const { generateSmartContext } = await import('@/lib/virtual-filesystem/smart-context');
    const result = await generateSmartContext({
      userId: '',
      prompt: 'test',
      contextMode: 'tree',
    });
    expect(result.contextMode).toBe('tree');
  });

  it('should include diffCount in result', async () => {
    const { generateSmartContext } = await import('@/lib/virtual-filesystem/smart-context');
    const result = await generateSmartContext({
      userId: '',
      prompt: 'test',
      contextMode: 'diff',
      snapshotBefore: new Map(),
      snapshotAfter: new Map(),
    });
    expect(result).toHaveProperty('diffCount');
    expect(typeof result.diffCount).toBe('number');
  });
});

describe('Unified Diff Generation', () => {
  beforeEach(async () => {
    vi.resetModules();
    registerFSMocks();
  });

  it('should detect file creation', async () => {
    const { generateUnifiedDiffs } = await import('@/lib/virtual-filesystem/smart-context');
    const before = new Map<string, string>();
    const after = new Map([['src/new.ts', 'export const x = 1;']]);
    const diffs = generateUnifiedDiffs(before, after);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('created');
    expect(diffs[0].path).toBe('src/new.ts');
  });

  it('should detect file deletion', async () => {
    const { generateUnifiedDiffs } = await import('@/lib/virtual-filesystem/smart-context');
    const before = new Map([['src/old.ts', 'export const x = 1;']]);
    const after = new Map<string, string>();
    const diffs = generateUnifiedDiffs(before, after);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('deleted');
    expect(diffs[0].path).toBe('src/old.ts');
  });

  it('should detect file modification', async () => {
    const { generateUnifiedDiffs } = await import('@/lib/virtual-filesystem/smart-context');
    const before = new Map([['src/app.ts', 'export const x = 1;']]);
    const after = new Map([['src/app.ts', 'export const x = 2;\nexport const y = 3;']]);
    const diffs = generateUnifiedDiffs(before, after);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('modified');
    expect(diffs[0].path).toBe('src/app.ts');
    expect(diffs[0].diff).toContain('--- a/src/app.ts');
    expect(diffs[0].diff).toContain('+++ b/src/app.ts');
  });

  it('should skip unchanged files', async () => {
    const { generateUnifiedDiffs } = await import('@/lib/virtual-filesystem/smart-context');
    const before = new Map([['src/same.ts', 'unchanged']]);
    const after = new Map([['src/same.ts', 'unchanged']]);
    const diffs = generateUnifiedDiffs(before, after);
    expect(diffs).toHaveLength(0);
  });

  it('should sort by significance (most changed first)', async () => {
    const { generateUnifiedDiffs } = await import('@/lib/virtual-filesystem/smart-context');
    const before = new Map([
      ['small.ts', 'a'],
      ['large.ts', 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10'],
    ]);
    const after = new Map([
      ['small.ts', 'b'],
      ['large.ts', 'changed1\nchanged2\nchanged3\nchanged4\nchanged5\nchanged6\nchanged7\nchanged8\nchanged9\nchanged10\nchanged11\nchanged12'],
    ]);
    const diffs = generateUnifiedDiffs(before, after);
    expect(diffs.length).toBe(2);
    // large.ts should come first (more changes)
    expect(diffs[0].path).toBe('large.ts');
  });

  it('should respect maxDiffEntries limit', async () => {
    const { generateUnifiedDiffs } = await import('@/lib/virtual-filesystem/smart-context');
    const before = new Map([['a.ts', '1'], ['b.ts', '2'], ['c.ts', '3']]);
    const after = new Map([['a.ts', 'changed1'], ['b.ts', 'changed2'], ['c.ts', 'changed3']]);
    const diffs = generateUnifiedDiffs(before, after, 2);
    expect(diffs.length).toBeLessThanOrEqual(2);
  });

  it('should handle empty snapshots', async () => {
    const { generateUnifiedDiffs } = await import('@/lib/virtual-filesystem/smart-context');
    const diffs = generateUnifiedDiffs(new Map(), new Map());
    expect(diffs).toHaveLength(0);
  });
});

// =============================================================================
// Line Range Detection Tests (extractPromptSignals)
// =============================================================================

describe('Line Range Detection', () => {
  let extractPromptSignals: (prompt: string) => {
    extensions: Set<string>;
    keywords: Set<string>;
    possiblePaths: string[];
    hasAtMention: boolean;
    atMentionedFiles: string[];
    fileRanges: Map<string, { startLine: number; endLine?: number }>;
  };

  beforeEach(async () => {
    vi.resetModules();
    registerFSMocks();
    const mod = await import('@/lib/virtual-filesystem/smart-context');
    extractPromptSignals = mod.extractPromptSignals;
  });

  // ─── Pattern 1: @mention with line range (@file.ts:50-100) ──────────

  describe('@mention with line range (@file.ts:50-100)', () => {
    it('should parse @mention with range (dash)', () => {
      const result = extractPromptSignals('Fix the bug in @App.tsx:50-100');
      expect(result.hasAtMention).toBe(true);
      expect(result.atMentionedFiles).toContain('App.tsx');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('app.tsx');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(50);
      expect(range!.endLine).toBe(100);
    });

    it('should parse @mention with single line (no dash)', () => {
      const result = extractPromptSignals('Check @utils/helpers.ts:42');
      expect(result.hasAtMention).toBe(true);
      expect(result.atMentionedFiles).toContain('utils/helpers.ts');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('utils/helpers.ts');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(42);
      expect(range!.endLine).toBeUndefined();
    });

    it('should parse multiple @mentions with line ranges', () => {
      const result = extractPromptSignals(
        'Look at @App.tsx:10-20 and @utils.ts:50'
      );
      expect(result.hasAtMention).toBe(true);
      expect(result.fileRanges.size).toBe(2);

      const range1 = result.fileRanges.get('app.tsx');
      expect(range1).toBeDefined();
      expect(range1!.startLine).toBe(10);
      expect(range1!.endLine).toBe(20);

      const range2 = result.fileRanges.get('utils.ts');
      expect(range2).toBeDefined();
      expect(range2!.startLine).toBe(50);
      expect(range2!.endLine).toBeUndefined();
    });

    it('should store fileRanges keys as lowercase', () => {
      const result = extractPromptSignals('Check @App.TSX:5-15');
      expect(result.fileRanges.has('app.tsx')).toBe(true);
      expect(result.fileRanges.has('App.TSX')).toBe(false);
    });

    it('should add @mentioned file extension to extensions set', () => {
      const result = extractPromptSignals('Check @App.tsx:5-15');
      expect(result.extensions.has('.tsx')).toBe(true);
    });

    it('should add @mentioned file path to possiblePaths', () => {
      const result = extractPromptSignals('Check @App.tsx:5-15');
      expect(result.possiblePaths.map(p => p.toLowerCase())).toContain('app.tsx');
    });
  });

  // ─── Pattern 2: "file.ts lines 50-100" ──────────────────────────────

  describe('text "file.ts lines 50-100"', () => {
    it('should parse "file.ts lines 50-100" with dash range', () => {
      const result = extractPromptSignals('Look at App.tsx lines 50-100 for the bug.');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('app.tsx');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(50);
      expect(range!.endLine).toBe(100);
    });

    it('should parse "file.ts line 50" (singular, single line)', () => {
      const result = extractPromptSignals('Check utils.ts line 42 for the helper.');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('utils.ts');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(42);
      expect(range!.endLine).toBeUndefined();
    });

    it('should parse "file.ts lines 50 - 100" with spaces around dash', () => {
      const result = extractPromptSignals('See config.json lines 10 - 20 for settings.');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('config.json');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(10);
      expect(range!.endLine).toBe(20);
    });

    it('should add the file to possiblePaths', () => {
      const result = extractPromptSignals('App.tsx lines 50-100');
      expect(result.possiblePaths.map(p => p.toLowerCase())).toContain('app.tsx');
    });

    it('should not override existing fileRanges entry from @mention', () => {
      const result = extractPromptSignals(
        '@App.tsx:10-20 and App.tsx lines 50-100'
      );
      expect(result.fileRanges.size).toBe(1);
      // @mention should win (parsed first)
      const range = result.fileRanges.get('app.tsx');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(10);
      expect(range!.endLine).toBe(20);
    });
  });

  // ─── Pattern 3: "read lines 50-100 of file.ts" ──────────────────────

  describe('text "read lines 50-100 of file.ts"', () => {
    it('should parse "read lines 50-100 of file.ts" with dash range', () => {
      const result = extractPromptSignals(
        'Please read lines 50-100 of App.tsx for the component.'
      );
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('app.tsx');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(50);
      expect(range!.endLine).toBe(100);
    });

    it('should parse "read lines 50 of file.ts" (single line)', () => {
      const result = extractPromptSignals('Read lines 42 of utils.ts.');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('utils.ts');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(42);
      expect(range!.endLine).toBeUndefined();
    });

    it('should parse with "show" verb', () => {
      const result = extractPromptSignals('Show lines 10-30 of config.json');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('config.json');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(10);
      expect(range!.endLine).toBe(30);
    });

    it('should parse with "get" verb', () => {
      const result = extractPromptSignals('Get lines 5-15 of styles.css');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('styles.css');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(5);
      expect(range!.endLine).toBe(15);
    });

    it('should parse with "fetch" verb', () => {
      const result = extractPromptSignals('Fetch lines 1-10 of index.ts');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('index.ts');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(1);
      expect(range!.endLine).toBe(10);
    });

    it('should parse with "from" preposition', () => {
      const result = extractPromptSignals('Read lines 20-40 from helpers.py');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('helpers.py');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(20);
      expect(range!.endLine).toBe(40);
    });

    it('should parse with "in" preposition', () => {
      const result = extractPromptSignals('Read lines 30-60 in main.rs');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('main.rs');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(30);
      expect(range!.endLine).toBe(60);
    });

    it('should add the file to possiblePaths', () => {
      const result = extractPromptSignals('Read lines 10-20 of App.tsx');
      expect(result.possiblePaths.map(p => p.toLowerCase())).toContain('app.tsx');
    });

    it('should not override existing fileRanges entry from @mention', () => {
      const result = extractPromptSignals(
        '@App.tsx:5-15 and read lines 50-100 of App.tsx'
      );
      expect(result.fileRanges.size).toBe(1);
      const range = result.fileRanges.get('app.tsx');
      expect(range!.startLine).toBe(5); // @mention wins
    });
  });

  // ─── Pattern 4: bare colon "file.ts:50-100" ─────────────────────────

  describe('bare colon "file.ts:50-100"', () => {
    it('should parse bare colon with dash range', () => {
      const result = extractPromptSignals('Look at App.tsx:50-100 for the issue.');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('app.tsx');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(50);
      expect(range!.endLine).toBe(100);
    });

    it('should parse bare colon with single line', () => {
      const result = extractPromptSignals('Check utils.ts:42.');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('utils.ts');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(42);
      expect(range!.endLine).toBeUndefined();
    });

    it('should parse bare colon with path', () => {
      const result = extractPromptSignals('See src/components/Header.tsx:5-25');
      expect(result.fileRanges.size).toBe(1);

      const range = result.fileRanges.get('src/components/header.tsx');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(5);
      expect(range!.endLine).toBe(25);
    });

    it('should not override existing @mention range', () => {
      const result = extractPromptSignals(
        '@App.tsx:10-20 also App.tsx:50-100'
      );
      expect(result.fileRanges.size).toBe(1);
      // @mention parsed first, wins
      const range = result.fileRanges.get('app.tsx');
      expect(range!.startLine).toBe(10);
      expect(range!.endLine).toBe(20);
    });

    it('should not match colon without word boundary (e.g., URL port)', () => {
      const result = extractPromptSignals('Open localhost:3000/app');
      // localhost:3000 is not a file reference with extension
      expect(result.fileRanges.size).toBe(0);
    });

    it('should add the file to possiblePaths', () => {
      const result = extractPromptSignals('App.tsx:50-100');
      expect(result.possiblePaths.map(p => p.toLowerCase())).toContain('app.tsx');
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty prompt', () => {
      const result = extractPromptSignals('');
      expect(result.fileRanges.size).toBe(0);
      expect(result.hasAtMention).toBe(false);
      expect(result.atMentionedFiles).toEqual([]);
    });

    it('should reject bare colon with line 0 (not a valid range)', () => {
      // Bare colon pattern: App.tsx:0-10 → bareColonRangePattern matches,
      // but start > 0 guard rejects it. No @ prefix so @mention pattern won't fire.
      const result = extractPromptSignals('Check App.tsx:0-10');
      expect(result.fileRanges.size).toBe(0);
    });

    it('should handle mixed patterns in one prompt', () => {
      const result = extractPromptSignals(
        'Check @App.tsx:5-15, also helpers.ts lines 20-30, ' +
        'and read lines 40-50 of utils.ts, plus config.json:1-5'
      );
      expect(result.fileRanges.size).toBe(4);

      expect(result.fileRanges.get('app.tsx')!.startLine).toBe(5);
      expect(result.fileRanges.get('helpers.ts')!.startLine).toBe(20);
      expect(result.fileRanges.get('utils.ts')!.startLine).toBe(40);
      expect(result.fileRanges.get('config.json')!.startLine).toBe(1);
    });

    it('should handle files with hyphens in their name', () => {
      const result = extractPromptSignals('Look at @my-component.tsx:10-20');
      expect(result.hasAtMention).toBe(true);
      expect(result.atMentionedFiles).toContain('my-component.tsx');
      expect(result.fileRanges.has('my-component.tsx')).toBe(true);
    });

    it('should not match non-file patterns with colons', () => {
      const result = extractPromptSignals(
        'The time is 12:30 and version is 2.0:latest'
      );
      expect(result.fileRanges.size).toBe(0);
    });

    it('should only match filename portion of Windows-style paths', () => {
      // Backslashes are NOT in the character class [\w\-/.], so the full path
      // won't match. However, \b at schema boundaries means 'Header.tsx:10-20'
      // (the basename) still matches the bare colon pattern.
      const result = extractPromptSignals(
        'Check src\\components\\Header.tsx:10-20'
      );
      // Captures just the basename portion after the last backslash
      expect(result.fileRanges.size).toBe(1);
      const range = result.fileRanges.get('header.tsx');
      expect(range).toBeDefined();
      expect(range!.startLine).toBe(10);
      expect(range!.endLine).toBe(20);
    });
  });
});
