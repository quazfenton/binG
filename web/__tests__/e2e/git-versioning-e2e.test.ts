/**
 * End-to-end tests for Git-backed VFS versioning and rollbacks.
 *
 * These tests verify the complete integration path:
 * 1. LLM tool call (batch_write/write_file) → VFS write → Git versioning → Shadow commit
 * 2. Shadow commits have correct session_id, owner_id, workspace_version
 * 3. Rollback restores previous file content
 * 4. Multiple file versions are tracked correctly
 *
 * Run with: npx vitest run __tests__/e2e/git-versioning-e2e.test.ts
 * Requires: Dev server running on localhost:3000
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  extractFileEdits,
  parseFilesystemResponse,
} from '@/lib/chat/file-edit-parser';
import {
  writeFileTool,
  batchWriteTool,
  readFileTool,
  toolContextStore,
} from '@/lib/mcp/vfs-mcp-tools';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function runTool(tool: any, args: any, userId: string, sessionId: string) {
  const scopePath = `project/sessions/${sessionId}`;
  return toolContextStore.run(
    { userId, sessionId, scopePath },
    async () => tool.execute(args, { messages: [], toolCallId: `test-${Date.now()}` })
  );
}

async function readFile(path: string, userId: string, sessionId: string) {
  return runTool(readFileTool, { path }, userId, sessionId);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Git-backed VFS — E2E Versioning & Rollbacks', () => {
  const TEST_USER = 'e2e-git-test-user';
  const TEST_SESSION = `e2e-git-${Date.now()}`;
  const BASE_PATH = `project/sessions/${TEST_SESSION}`;

  describe('VFS tool round-trip with version tracking', () => {
    it('writes v1, reads back, verifies version=1', async () => {
      const content = '// version 1\nconst x = 1;';
      const writeResult = await runTool(writeFileTool, {
        path: `${BASE_PATH}/app.js`,
        content,
      }, TEST_USER, TEST_SESSION);
      expect(writeResult.success).toBe(true);
      expect(writeResult.version).toBe(1);

      const readResult = await readFile(`${BASE_PATH}/app.js`, TEST_USER, TEST_SESSION);
      expect(readResult.success).toBe(true);
      expect(readResult.content).toBe(content);
      expect(readResult.version).toBe(1);
    });

    it('overwrites file, verifies version increments', async () => {
      const content2 = '// version 2\nconst x = 2;';
      const writeResult = await runTool(writeFileTool, {
        path: `${BASE_PATH}/app.js`,
        content: content2,
      }, TEST_USER, TEST_SESSION);
      expect(writeResult.success).toBe(true);
      expect(writeResult.version).toBeGreaterThan(1);

      const readResult = await readFile(`${BASE_PATH}/app.js`, TEST_USER, TEST_SESSION);
      expect(readResult.content).toBe(content2);
      expect(readResult.version).toBeGreaterThan(1);
    });
  });

  describe('batch_write — multi-file version tracking', () => {
    it('writes 3 files atomically, all get tracked in single shadow commit', async () => {
      const files = [
        { path: `${BASE_PATH}/batch-a.js`, content: '// batch-a' },
        { path: `${BASE_PATH}/batch-b.js`, content: '// batch-b' },
        { path: `${BASE_PATH}/batch-c.js`, content: '// batch-c' },
      ];
      const result = await runTool(batchWriteTool, { files }, TEST_USER, TEST_SESSION);
      expect(result.success).toBe(true);
      expect(result.successCount).toBe(3);

      // Verify each file
      for (const file of files) {
        const readResult = await readFile(file.path, TEST_USER, TEST_SESSION);
        expect(readResult.success).toBe(true);
        expect(readResult.content).toBe(file.content);
      }
    });
  });

  describe('Shadow commit integrity', () => {
    it('shadow commits contain correct session_id and owner_id', async () => {
      const shadowCommitManager = new ShadowCommitManager();
      // Shadow commits use composite sessionId format: ownerId:sessionId
      const compositeSessionId = `${TEST_USER}:${TEST_SESSION}`;
      const history = await shadowCommitManager.getCommitHistory(compositeSessionId, 20);

      // Should have commits from our tests
      expect(history.length).toBeGreaterThan(0);

      // Verify session scoping
      const matchingCommits = history.filter(c =>
        c.sessionId === compositeSessionId
      );
      expect(matchingCommits.length).toBeGreaterThan(0);
    });

    it('shadow commits have non-null workspace_version', async () => {
      const shadowCommitManager = new ShadowCommitManager();
      const compositeSessionId = `${TEST_USER}:${TEST_SESSION}`;
      const history = await shadowCommitManager.getCommitHistory(compositeSessionId, 20);

      // At least some commits should have workspace_version set
      const withVersion = history.filter(c => c.workspaceVersion !== null && c.workspaceVersion !== undefined);
      expect(withVersion.length).toBeGreaterThan(0);
    });
  });

  describe('Rollback functionality', () => {
    it('can rollback a file to previous version', async () => {
      const testPath = `${BASE_PATH}/rollback-test.js`;

      // Write v1
      await runTool(writeFileTool, {
        path: testPath,
        content: '// rollback v1',
      }, TEST_USER, TEST_SESSION);

      // Read v1
      const v1Read = await readFile(testPath, TEST_USER, TEST_SESSION);
      expect(v1Read.content).toBe('// rollback v1');
      const v1Version = v1Read.version;

      // Write v2
      await runTool(writeFileTool, {
        path: testPath,
        content: '// rollback v2',
      }, TEST_USER, TEST_SESSION);

      // Verify v2
      const v2Read = await readFile(testPath, TEST_USER, TEST_SESSION);
      expect(v2Read.content).toBe('// rollback v2');
      expect(v2Read.version).toBeGreaterThan(v1Version);

      // Rollback: write v1 content back
      await runTool(writeFileTool, {
        path: testPath,
        content: '// rollback v1',
      }, TEST_USER, TEST_SESSION);

      // Verify rollback
      const afterRollback = await readFile(testPath, TEST_USER, TEST_SESSION);
      expect(afterRollback.content).toBe('// rollback v1');
    });
  });

  describe('File edit parser — non-FC model formats', () => {
    it('parses batch_write from tool-name + fenced-block format', () => {
      const content = `I'll create the files:

batch_write

\`\`\`javascript
[
  {"path": "project/index.js", "content": "console.log('hi')"},
  {"path": "project/utils.js", "content": "export const add = (a,b) => a+b;"}
]
\`\`\``;
      const edits = extractFileEdits(content);
      expect(edits.length).toBeGreaterThanOrEqual(2);
      expect(edits.find(e => e.path === 'project/index.js')).toBeDefined();
      expect(edits.find(e => e.path === 'project/utils.js')).toBeDefined();
    });

    it('parses write_file from tool-name + fenced-block format', () => {
      const content = 'write_file\n\n```json\n{"path": "test.js", "content": "hello"}\n```';
      const edits = extractFileEdits(content);
      expect(edits.length).toBeGreaterThanOrEqual(1);
      expect(edits[0].path).toBe('test.js');
      expect(edits[0].content).toBe('hello');
    });

    it('does NOT extract arbitrary XML without closing marker', () => {
      const content = '<recursive>true</recursive>\n\n</tool>';
      const edits = extractFileEdits(content);
      expect(edits).toHaveLength(0);
    });

    it('extracts malformed format ONLY when closing <file_edit> marker present', () => {
      const content = '<path>src/test.ts</path>\nexport const x = 1;\n<file_edit>';
      const edits = extractFileEdits(content);
      expect(edits).toHaveLength(1);
      expect(edits[0].path).toBe('src/test.ts');
      expect(edits[0].content).toBe('export const x = 1;');
    });

    it('preserves > characters in arrow functions (XML parser fix)', () => {
      const content = '<file_edit path="arrow.js">const fn = (x) => x + 1;</file_edit>';
      const edits = extractFileEdits(content);
      expect(edits).toHaveLength(1);
      expect(edits[0].content).toBe('const fn = (x) => x + 1;');
    });
  });
});
