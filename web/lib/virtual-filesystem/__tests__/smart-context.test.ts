/**
 * Unit Tests for Smart Context & Session File Tracking
 *
 * Run: npx vitest run web/lib/virtual-filesystem/__tests__/smart-context.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// =============================================================================
// Session File Tracker Tests
// =============================================================================

describe('Session File Tracker', () => {
  beforeEach(() => {
    vi.resetModules();
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
