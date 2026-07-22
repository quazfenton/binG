/**
 * Regression test for DIFF_MISMATCH augmentation (2026-07-22).
 *
 * Bug 3 in COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT: when a search-and-replace or
 * applyDiff attempt fails (DIFF_MISMATCH), the LLM must issue a follow-up
 * read_file call to see the current file content before retrying. That round-trip
 * adds 1-2s per retry AND — more critically — can race with other tool calls or
 * trigger the cascade failure chain documented in ticket L644-L660.
 *
 * Fix: augment the DIFF_MISMATCH error response with `currentFileContent`,
 * `currentFileVersion`, and an enriched `suggestedNextAction`. The LLM now has
 * the byte-exact current content in the rejection envelope and can re-generate
 * the SEARCH block without an extra read_file call.
 *
 * This test verifies the contract for BOTH emit sites in vfs-mcp-tools.ts:
 *   - SAR-path (emit when appliedCount === 0) — fixture uses `<<<< SEARCH / ==== / >>>> REPLACE` format.
 *     SAR pattern at vfs-mcp-tools.ts:L916 matches this format.
 *   - applyDiff-path (emit when isDiffMismatch matches in catch) — fixture mocks
 *     file-diff-utils.applyDiffToContent to return null, forcing the L1078 throw
 *     "Failed to apply diff - the diff may not match the current file content",
 *     which the outer execute catch (tsc-validated via hoist at L822) routes to
 *     the isDiffMismatch ternary arm.
 *
 * Vitest notes: vi.mock() calls are hoisted to the top of the file BEFORE any
 * const declarations. We must use `vi.hoisted()` for our mock fns, then reference
 * them inside `vi.mock` factories. `version: 1` matches the production readFile
 * return value at virtual-filesystem-service.ts (fixed value).
 *
 * Reference: /opt/bing/.tickets/COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT.md Bug 3.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- vi.hoisted: mock fns declared BEFORE vi.mock factories execute (vitest ESM hoisting) ----
const mocks = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockApplyDiffToContent: vi.fn(),
}));

// ---- Static mocks (these are hoisted but our fn references are via the hoisted object) ----
vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../lib/virtual-filesystem/virtual-filesystem-service', () => ({
  virtualFilesystem: {
    readFile: mocks.mockReadFile,
    writeFile: mocks.mockWriteFile,
  },
}));

vi.mock('../../lib/virtual-filesystem/file-events', () => ({
  emitFileEvent: vi.fn().mockResolvedValue(undefined),
  emitBatchFileEvents: vi.fn().mockResolvedValue(undefined),
  FILE_EVENT_SOURCES: { MCP_TOOL_DIFF_SAR: 'mcp-tool-diff-sar', MCP_TOOL_DIFF: 'mcp-tool-diff' },
}));

vi.mock('../../lib/virtual-filesystem/sandbox-file-sync-bridge', () => ({
  syncFileChangeToSandbox: vi.fn(),
}));

vi.mock('../../lib/sandbox/workspace-image-builder', () => ({
  onDependencyFileChanged: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/workspace/workspace-replay-service', () => ({
  recordReplayEdit: vi.fn(),
}));

vi.mock('../../lib/workspace/workspace-session-graph', () => ({
  workspaceSessionGraph: { registerSession: vi.fn() },
}));

// Mock the dynamically-imported file-diff-utils so applyDiffToContent returns
// null deterministically. This forces the L1078 throw and the isDiffMismatch
// ternary arm in the outer execute-function catch (L1163+).
vi.mock('../../lib/chat/file-diff-utils', () => ({
  applyDiffToContent: mocks.mockApplyDiffToContent,
}));

// ---- Imports AFTER mocks are wired ----
import { applyDiffTool, setToolContext } from '../../lib/mcp/vfs-mcp-tools';

// Current-file fixture matching production readFile output shape
// (version: 1 per virtual-filesystem-service.ts:L288-296).
const CURRENT_FILE_CONTENT = [
  'export function exclaim(s: string): string {',
  '  return s + "!";',
  '}',
  '',
].join('\n');

const MOCK_CURRENT_FILE = {
  path: 'workspace/sessions/001/lib/greet.ts',
  content: CURRENT_FILE_CONTENT,
  language: 'typescript',
  lastModified: 1718937600000,
  createdAt: 1718937600000,
  size: CURRENT_FILE_CONTENT.length,
  version: 1, // PRODUCTION: readFile returns version: 1 (fixed); see ticket Bug 3.
};

beforeEach(() => {
  mocks.mockReadFile.mockReset();
  mocks.mockWriteFile.mockReset();
  mocks.mockApplyDiffToContent.mockReset();
  mocks.mockReadFile.mockResolvedValue(MOCK_CURRENT_FILE);
  // Default: applyDiffToContent returns null (forces isDiffMismatch path).
  mocks.mockApplyDiffToContent.mockReturnValue(null);

  setToolContext({
    userId: 'test-user-id',
    sessionId: '001',
    scopePath: 'workspace/sessions/001',
  });
});

describe('DIFF_MISMATCH augmentation (Bug 3 from COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT)', () => {
  describe('SAR-path emit site (appliedCount === 0 inside SAR fallback)', () => {
    it('includes currentFileContent + currentFileVersion in the error envelope', async () => {
      const diff = [
        '<<<< SEARCH',
        'export function thisDoesNotExist(): void {}',
        '=======',
        'export function thisDoesNotExist(): string { return "v2"; }',
        '>>>> REPLACE',
      ].join('\n');

      const result: any = await applyDiffTool.execute({ path: 'lib/greet.ts', diff });

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('DIFF_MISMATCH');
      // Backward-compat: pre-existing error fields still present
      expect(result.error.retryable).toBe(true);
      expect(result.error.attemptedPath).toBe('lib/greet.ts');
      expect(Array.isArray(result.error.failedSearches)).toBe(true);
      // NEW FIELDS: the augmentation (2026-07-22 Bug 3 fix)
      expect(result.error.currentFileContent).toBe(CURRENT_FILE_CONTENT);
      expect(result.error.currentFileVersion).toBe(1);
      // suggestedNextAction mentions currentFileContent so the LLM knows about it
      expect(result.error.suggestedNextAction).toContain('currentFileContent');
      expect(result.error.suggestedNextAction).toContain('lib/greet.ts');
    });

    it('surfaces byte-exact content so the LLM can recompute the SEARCH block', async () => {
      const diff = [
        '<<<< SEARCH',
        '___NEVER_MATCHES___',
        '=======',
        'replacement',
        '>>>> REPLACE',
      ].join('\n');

      const result: any = await applyDiffTool.execute({ path: 'lib/greet.ts', diff });

      // The LLM should see the actual current file content (not a placeholder
      // or empty). Bug-3 closure: byte-exact bytes now in the rejection envelope.
      const surfaced = result.error.currentFileContent as string;
      expect(surfaced).toContain('export function exclaim');
      expect(surfaced).toContain('return s + "!"');
      expect(surfaced.endsWith('}\n')).toBe(true);
      expect(surfaced.length).toBe(CURRENT_FILE_CONTENT.length);
    });
  });

  describe('applyDiff-path emit site (isDiffMismatch ternary in outer catch)', () => {
    // Force the isDiffMismatch branch by mocking applyDiffToContent to return
    // null. This triggers the L1078 throw "Failed to apply diff - the diff may
    // not match the current file content". The outer execute try-catch routes
    // the throw into the isDiffMismatch ternary arm at L1151+.
    it('includes currentFileContent + currentFileVersion on isDiffMismatch rejection', async () => {
      // Unified diff format (NOT SAR — so sarPattern.test() at L916 returns
      // false; falls through to the applyDiff unified-diff branch).
      // The mock forces applyDiffToContent → null → throw → isDiffMismatch.
      const diff = [
        '--- a/lib/greet.ts',
        '+++ b/lib/greet.ts',
        '@@ -1,3 +1,3 @@',
        '-export function contextThatDoesNotMatch(): void {',
        '+export function contextThatDoesNotMatch(): string { return "v2"; }',
        ' ',
        ' export function exclaim(s: string): string {',
        '   return s + "!";',
        ' }',
      ].join('\n');

      // (mockReadFile resolution provides `currentFile` for the DIFF_MISMATCH
      // augmentation; mockApplyDiffToContent returning null triggers the throw
      // that is caught by the outer execute-function try-catch.)

      const result: any = await applyDiffTool.execute({ path: 'lib/greet.ts', diff });

      // Deterministic: with applyDiffToContent → null, the throw is caught and
      // routed to the isDiffMismatch ternary. Assert DIFF_MISMATCH arm fires.
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('DIFF_MISMATCH');
      expect(result.error.retryable).toBe(true);
      expect(result.error.attemptedPath).toBe('lib/greet.ts');
      // AUGMENTATION: must include byte-exact current content
      expect(result.error.currentFileContent).toBe(CURRENT_FILE_CONTENT);
      expect(result.error.currentFileVersion).toBe(1);
      expect(result.error.suggestedNextAction).toContain('currentFileContent');
    });
  });

  describe('contract preservation + cross-site consistency', () => {
    it('preserves backward-compat: pre-existing error fields still present on rejection', async () => {
      const diff = [
        '<<<< SEARCH',
        '___MISMATCH___',
        '=======',
        'replacement',
        '>>>> REPLACE',
      ].join('\n');

      const result: any = await applyDiffTool.execute({ path: 'lib/greet.ts', diff });

      // Regression guard: augmentation must ADD fields, not REMOVE pre-existing ones.
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('DIFF_MISMATCH');
      expect(typeof result.error.retryable).toBe('boolean');
      expect(typeof result.error.attemptedPath).toBe('string');
      expect(result.error).toHaveProperty('currentFileContent');
      expect(result.error).toHaveProperty('currentFileVersion');
      expect(result.error).toHaveProperty('suggestedNextAction');
    });

    it('suggestedNextAction text reflects the augmented guidance (mentions currentFileContent)', async () => {
      const diff = [
        '<<<< SEARCH',
        '___NEVER___',
        '=======',
        'replacement',
        '>>>> REPLACE',
      ].join('\n');

      const result: any = await applyDiffTool.execute({ path: 'lib/greet.ts', diff });

      // The new suggestedNextAction explicitly tells the LLM the current content
      // is in currentFileContent — without this hint the LLM would still call
      // read_file and waste a round-trip.
      expect(result.error.suggestedNextAction).toMatch(/currentFileContent/);
      expect(result.error.suggestedNextAction).toMatch(/search|block|replace/i);
    });
  });
});
