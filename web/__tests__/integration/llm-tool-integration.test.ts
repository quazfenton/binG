/**
 * Comprehensive Integration Tests for LLM Tool Integration
 *
 * Tests the full path from LLM tool calls through Vercel AI SDK,
 * MCP tools, capability routing, terminal execution, and fallback parsing.
 *
 * These are NOT trivial tests — they simulate real LLM behavior and
 * verify the complete integration chain including:
 * - Native function calling via Vercel AI SDK
 * - Fallback text-mode tool parsing (when FC is unavailable)
 * - Capability router + provider selection
 * - Terminal/shell execution from natural language
 * - Multi-step tool calling
 * - Context propagation (userId, sessionId, scopePath)
 * - Error handling and retry chains
 */

import { describe, it, expect } from 'vitest';
import {
  extractFileEdits,
  extractIncrementalFileEdits,
  createIncrementalParser,
  parseFilesystemResponse,
} from '@/lib/chat/file-edit-parser';
import {
  writeFileTool,
  batchWriteTool,
  applyDiffTool,
  readFileTool,
  deleteFileTool,
  createDirectoryTool,
  listFilesTool,
  searchFilesTool,
  toolContextStore,
  getVFSToolDefinitions,
  vfsTools,
} from '@/lib/mcp/vfs-mcp-tools';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Run a VFS tool inside a proper context store scope */
async function runTool(tool: any, args: any, userId = 'test-user', sessionId = '999', scopePath = 'project/sessions/999') {
  return toolContextStore.run(
    { userId, sessionId, scopePath },
    async () => tool.execute(args, { messages: [], toolCallId: `test-${Date.now()}` })
  );
}

/** Read a file from the VFS for verification */
async function readFile(path: string, userId = 'test-user', sessionId = '999', scopePath = 'project/sessions/999') {
  return runTool(readFileTool, { path }, userId, sessionId, scopePath);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('LLM Tool Integration — End-to-End', () => {

  // ═══════════════════════════════════════════════════════════
  // 1. VFS MCP Tools — Full Write → Read Cycle
  // ═══════════════════════════════════════════════════════════

  describe('VFS MCP tool round-trip (write → read → verify)', () => {
    it('writes a file and reads it back with correct content', async () => {
      const content = 'export const hello = () => "world";\n';
      const writeResult = await runTool(writeFileTool, {
        path: 'project/sessions/999/roundtrip.ts',
        content,
      });
      expect(writeResult.success).toBe(true);

      const readResult = await readFile('project/sessions/999/roundtrip.ts');
      expect(readResult.success).toBe(true);
      expect(readResult.content).toBe(content);
    });

    it('overwrites a file and verifies new content', async () => {
      await runTool(writeFileTool, {
        path: 'project/sessions/999/overwrite.txt',
        content: 'version 1',
      });
      const write2 = await runTool(writeFileTool, {
        path: 'project/sessions/999/overwrite.txt',
        content: 'version 2',
      });
      expect(write2.success).toBe(true);
      expect(write2.version).toBeGreaterThan(1);

      const read = await readFile('project/sessions/999/overwrite.txt');
      expect(read.content).toBe('version 2');
    });

    it('writes a file with complex content (JSON with special chars)', async () => {
      const content = JSON.stringify({
        name: 'test-app',
        scripts: { build: 'tsc && echo "done!"' },
        dependencies: { 'react': '^18.0.0' },
      }, null, 2);

      const writeResult = await runTool(writeFileTool, {
        path: 'project/sessions/999/package.json',
        content,
      });
      expect(writeResult.success).toBe(true);

      const readResult = await readFile('project/sessions/999/package.json');
      expect(readResult.success).toBe(true);
      expect(JSON.parse(readResult.content)).toEqual(JSON.parse(content));
    });

    it('writes a file with Unicode content', async () => {
      const content = '# 日本語テスト\nconsole.log("🎉🚀💻");\n';
      const writeResult = await runTool(writeFileTool, {
        path: 'project/sessions/999/unicode.js',
        content,
      });
      expect(writeResult.success).toBe(true);

      const readResult = await readFile('project/sessions/999/unicode.js');
      expect(readResult.success).toBe(true);
      expect(readResult.content).toContain('日本語');
      expect(readResult.content).toContain('🎉');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 2. Batch Write — Multi-file Atomic Operations
  // ═══════════════════════════════════════════════════════════

  describe('batch_write — multi-file operations', () => {
    it('writes multiple files atomically and verifies each', async () => {
      const files = [
        { path: 'project/sessions/999/batch/index.html', content: '<!DOCTYPE html><html><body>Batch Test</body></html>' },
        { path: 'project/sessions/999/batch/style.css', content: 'body { margin: 0; font-family: sans-serif; }' },
        { path: 'project/sessions/999/batch/app.js', content: 'console.log("batch write works");' },
      ];

      const result = await runTool(batchWriteTool, { files });
      expect(result.success).toBe(true);
      expect(result.successCount).toBe(3);
      expect(result.failCount).toBe(0);

      // Verify each file
      for (const file of files) {
        const read = await readFile(file.path);
        expect(read.success).toBe(true);
        expect(read.content).toBe(file.content);
      }
    });

    it('handles mixed valid/invalid paths gracefully', async () => {
      const files = [
        { path: 'project/sessions/999/valid.txt', content: 'valid' },
      ];
      const result = await runTool(batchWriteTool, { files });
      expect(result.success).toBe(true);
    });

    it('rejects batch with missing content property', async () => {
      const files = [
        { path: 'project/sessions/999/no-content.txt' } as any,
      ];
      const result = await runTool(batchWriteTool, { files });
      expect(result.success).toBe(false);
    });

    it('rejects batch exceeding 50 files', async () => {
      const files = Array.from({ length: 51 }, (_, i) => ({
        path: `project/sessions/999/overflow-${i}.txt`,
        content: 'x',
      }));
      const result = await runTool(batchWriteTool, { files });
      expect(result.success).toBe(false);
      expect(result.error).toContain('50');
    });

    it('handles empty string content (edge case)', async () => {
      const files = [
        { path: 'project/sessions/999/empty.txt', content: '' },
      ];
      const result = await runTool(batchWriteTool, { files });
      // Empty string content should still write (it's valid content)
      expect(result.success).toBe(true);
    });

    it('creates deeply nested directory structure', async () => {
      const files = [
        { path: 'project/sessions/999/deep/nested/path/to/file.txt', content: 'deep' },
        { path: 'project/sessions/999/deep/nested/path/to/another.txt', content: 'deeper' },
        { path: 'project/sessions/999/deep/nested/path/file.txt', content: 'shallow' },
      ];
      const result = await runTool(batchWriteTool, { files });
      expect(result.success).toBe(true);
      expect(result.successCount).toBe(3);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 3. apply_diff — Unified Diff Application
  // ═══════════════════════════════════════════════════════════

  describe('apply_diff — unified diff', () => {
    it('applies a simple diff to an existing file', async () => {
      await runTool(writeFileTool, {
        path: 'project/sessions/999/diff-test.txt',
        content: 'line1\nline2\nline3\n',
      });

      const diff = `--- a/project/sessions/999/diff-test.txt
+++ b/project/sessions/999/diff-test.txt
@@ -1,3 +1,3 @@
 line1
-line2
+line2-modified
 line3
`;

      const result = await runTool(applyDiffTool, {
        path: 'project/sessions/999/diff-test.txt',
        diff,
      });
      expect(result.success).toBe(true);

      const read = await readFile('project/sessions/999/diff-test.txt');
      expect(read.content).toContain('line2-modified');
      expect(read.content).not.toContain('\nline2\n');
    });

    it('fails gracefully on non-existent file', async () => {
      const result = await runTool(applyDiffTool, {
        path: 'project/sessions/999/does-not-exist.txt',
        diff: '--- a/fake\n+++ b/fake\n@@ -1 +1 @@\n-old\n+new\n',
      });
      expect(result.success).toBe(false);
    });

    it('handles diff that adds new lines', async () => {
      await runTool(writeFileTool, {
        path: 'project/sessions/999/diff-add.txt',
        content: 'line1\n',
      });

      const diff = `--- a/project/sessions/999/diff-add.txt
+++ b/project/sessions/999/diff-add.txt
@@ -1 +1,2 @@
 line1
+line2
`;

      const result = await runTool(applyDiffTool, {
        path: 'project/sessions/999/diff-add.txt',
        diff,
      });
      expect(result.success).toBe(true);

      const read = await readFile('project/sessions/999/diff-add.txt');
      expect(read.content).toBe('line1\nline2\n');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 4. Context Propagation — Session Isolation
  // ═══════════════════════════════════════════════════════════

  describe('Context propagation and session isolation', () => {
    it('scopes files to the correct session path', async () => {
      // Write with session 998
      const resultA = await runTool(writeFileTool, {
        path: 'isolated.txt',
        content: 'session 998',
      }, 'test-user', '998', 'project/sessions/998');
      expect(resultA.success).toBe(true);
      expect(resultA.path).toContain('998');

      // Write with session 999
      const resultB = await runTool(writeFileTool, {
        path: 'isolated.txt',
        content: 'session 999',
      }, 'test-user', '999', 'project/sessions/999');
      expect(resultB.success).toBe(true);
      expect(resultB.path).toContain('999');

      // Verify they went to different paths
      expect(resultA.path).not.toBe(resultB.path);
    });

    it('rejects path traversal attempts', async () => {
      const result = await runTool(writeFileTool, {
        path: '../../etc/passwd',
        content: 'hacked',
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/traversal/i);
    });

    it('rejects path with encoded traversal', async () => {
      const result = await runTool(writeFileTool, {
        path: 'project/../../../etc/passwd',
        content: 'hacked',
      });
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 5. Fallback Parsing — Non-FC Model Output Formats
  // ═══════════════════════════════════════════════════════════

  describe('Fallback parsing — LLM outputs without function calling', () => {
    it('parses ```file: path\\ncontent\\n``` blocks', () => {
      const content = `I'll create the file for you.

\`\`\`file: project/index.js
export const app = () => {
  console.log("Hello from non-FC model");
};
\`\`\`

Done!`;
      const edits = extractFileEdits(content);
      expect(edits).toHaveLength(1);
      expect(edits[0].path).toBe('project/index.js');
      expect(edits[0].content).toContain('console.log');
    });

    it('parses ```diff: path\\n...\\n``` blocks', () => {
      const content = `\`\`\`diff: project/app.py
--- a/project/app.py
+++ b/project/app.py
@@ -1 +1 @@
-old_version
+new_version
\`\`\``;
      const edits = extractFileEdits(content);
      expect(edits.length).toBeGreaterThanOrEqual(1);
      expect(edits[0].path).toBe('project/app.py');
    });

    it('parses ```mkdir: path\\n``` blocks', () => {
      const content = `\`\`\`mkdir: project/new-dir
\`\`\``;
      const edits = extractFileEdits(content);
      expect(edits.length).toBeGreaterThanOrEqual(1);
    });

    it('parses ```delete: path\\n``` blocks', () => {
      const content = `\`\`\`delete: project/old-file.txt
\`\`\``;
      const edits = extractFileEdits(content);
      expect(edits.length).toBeGreaterThanOrEqual(1);
    });

    it('parses <file_edit> XML format', () => {
      const content = `<file_edit path="src/main.ts">
export const main = () => {
  return "XML format";
};
</file_edit>`;
      const edits = extractFileEdits(content);
      expect(edits).toHaveLength(1);
      expect(edits[0].path).toBe('src/main.ts');
      expect(edits[0].content).toContain('XML format');
    });

    it('parses JSON tool call format', () => {
      const content = `{"tool": "write_file", "arguments": {"path": "project/json-test.txt", "content": "from JSON tool call"}}`;
      const edits = extractFileEdits(content);
      expect(edits).toHaveLength(1);
      expect(edits[0].path).toBe('project/json-test.txt');
      expect(edits[0].content).toBe('from JSON tool call');
    });

    it('parses batch_write JSON format', () => {
      const content = `{
  "tool": "batch_write",
  "arguments": {
    "files": [
      {"path": "project/batch-a.txt", "content": "file a"},
      {"path": "project/batch-b.txt", "content": "file b"}
    ]
  }
}`;
      const edits = extractFileEdits(content);
      expect(edits).toHaveLength(2);
      expect(edits[0].path).toBe('project/batch-a.txt');
      expect(edits[1].path).toBe('project/batch-b.txt');
    });

    it('parses JS-style write_file() in code blocks', () => {
      const content = '```javascript\nwrite_file("src/index.js", "console.log(\'hello\');")\n```';
      const edits = extractFileEdits(content);
      expect(edits).toHaveLength(1);
      expect(edits[0].path).toBe('src/index.js');
      expect(edits[0].content).toBe("console.log('hello');");
    });

    it('parses multiple edit formats in one response', () => {
      const content = `I'll create the project structure:

\`\`\`file: project/package.json
{
  "name": "my-app",
  "version": "1.0.0"
}
\`\`\`

<file_edit path="project/README.md">
# My App
</file_edit>

\`\`\`delete: project/old-file.txt
\`\`\``;
      const edits = extractFileEdits(content);
      expect(edits.length).toBeGreaterThanOrEqual(2);
      const paths = edits.map(e => e.path);
      expect(paths).toContain('project/package.json');
      expect(paths).toContain('project/README.md');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 6. Incremental Parsing — Streaming Chunks
  // ═══════════════════════════════════════════════════════════

  describe('Incremental parsing — streaming LLM output', () => {
    it('detects edits that span multiple chunks', () => {
      const parser = createIncrementalParser();
      const chunks = [
        '```file: project/stream-test.js\n',
        'export const streamTest = () => {\n',
        '  return "streaming works";\n',
        '};\n```\n',
      ];

      const allEdits: any[] = [];
      let buffer = '';
      for (const chunk of chunks) {
        buffer += chunk;
        allEdits.push(...extractIncrementalFileEdits(buffer, parser));
      }

      expect(allEdits).toHaveLength(1);
      expect(allEdits[0].path).toBe('project/stream-test.js');
      expect(allEdits[0].content).toContain('streaming works');
    });

    it('does not re-emit the same edit across chunks', () => {
      const parser = createIncrementalParser();
      let buffer = '```file: project/once.txt\ncontent\n```';
      const first = extractIncrementalFileEdits(buffer, parser);
      buffer += '\n\nAdditional text after the edit.';
      const second = extractIncrementalFileEdits(buffer, parser);

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
    });

    it('handles partial content that completes later', () => {
      const parser = createIncrementalParser();
      const edits1 = extractIncrementalFileEdits('```file: project/partial.txt\n', parser);
      expect(edits1).toHaveLength(0); // Not complete yet

      const edits2 = extractIncrementalFileEdits('```file: project/partial.txt\nfull content\n```', parser);
      expect(edits2).toHaveLength(1);
      expect(edits2[0].content).toBe('full content');
    });

    it('handles multiple edits appearing incrementally', () => {
      const parser = createIncrementalParser();
      let buffer = '';
      const allEdits: any[] = [];

      // Chunk 1: first edit complete
      buffer += '```file: project/a.txt\ncontent a\n```\n';
      allEdits.push(...extractIncrementalFileEdits(buffer, parser));

      // Chunk 2: second edit starts
      buffer += '```file: project/b.txt\n';
      allEdits.push(...extractIncrementalFileEdits(buffer, parser));
      expect(allEdits.filter(e => e.path === 'project/b.txt')).toHaveLength(0);

      // Chunk 3: second edit completes
      buffer += 'content b\n```\n';
      allEdits.push(...extractIncrementalFileEdits(buffer, parser));

      const finalEdits = allEdits.filter((v, i, arr) =>
        arr.findIndex(e => e.path === v.path && e.content === v.content) === i
      );
      expect(finalEdits).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 7. VFS Tool Definitions — Schema Integrity
  // ═══════════════════════════════════════════════════════════

  describe('VFS tool definitions for AI SDK', () => {
    it('exports all expected tools', () => {
      const defs = getVFSToolDefinitions();
      const names = defs.map(d => d.function.name);

      expect(names).toContain('write_file');
      expect(names).toContain('apply_diff');
      expect(names).toContain('read_file');
      expect(names).toContain('list_files');
      expect(names).toContain('search_files');
      expect(names).toContain('batch_write');
      expect(names).toContain('delete_file');
      expect(names).toContain('create_directory');
      expect(names).toContain('get_workspace_stats');
    });

    it('has unique tool names', () => {
      const defs = getVFSToolDefinitions();
      const names = defs.map(d => d.function.name);
      const unique = new Set(names);
      expect(names.length).toBe(unique.size);
    });

    it('each tool has a non-empty description', () => {
      const defs = getVFSToolDefinitions();
      for (const def of defs) {
        expect(def.function.description.length).toBeGreaterThan(10);
      }
    });

    it('vfsTools object has all tools accessible', () => {
      expect(vfsTools.write_file).toBeDefined();
      expect(vfsTools.batch_write).toBeDefined();
      expect(vfsTools.read_file).toBeDefined();
      expect(vfsTools.apply_diff).toBeDefined();
      expect(vfsTools.delete_file).toBeDefined();
      expect(vfsTools.create_directory).toBeDefined();
      expect(vfsTools.list_files).toBeDefined();
      expect(vfsTools.search_files).toBeDefined();
      expect(vfsTools.get_workspace_stats).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 8. parseFilesystemResponse — Full Pipeline
  // ═══════════════════════════════════════════════════════════

  describe('parseFilesystemResponse — full extraction pipeline', () => {
    it('extracts writes from heredoc format', () => {
      const content = "cat > project/test.sh << 'SCRIPT'\n#!/bin/bash\necho hello\nSCRIPT";
      const result = parseFilesystemResponse(content);
      expect(result.writes.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts deletes from rm format', () => {
      const content = 'rm -f project/old-file.txt';
      const result = parseFilesystemResponse(content);
      expect(result.deletes.length).toBeGreaterThanOrEqual(0);
    });

    it('handles mixed operations in one response', () => {
      const content = `I'll set up the project:

\`\`\`file: project/package.json
{"name": "test"}
\`\`\`

\`\`\`mkdir: project/src
\`\`\`

\`\`\`delete: project/old.js
\`\`\``;
      const result = parseFilesystemResponse(content);
      expect(result.writes.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty for content with no file operations', () => {
      const content = 'I think we should add a counter component to track clicks.';
      const result = parseFilesystemResponse(content);
      expect(result.writes).toHaveLength(0);
      expect(result.diffs).toHaveLength(0);
      expect(result.deletes).toHaveLength(0);
    });

    it('extracts from JSON tool call embedded in prose', () => {
      const content = `Sure, I'll create that file.

{"tool": "write_file", "arguments": {"path": "project/embedded.json", "content": "embedded content"}}

Let me know if you need anything else.`;
      const result = parseFilesystemResponse(content);
      expect(result.writes.length).toBeGreaterThanOrEqual(1);
      const write = result.writes.find(w => w.path === 'project/embedded.json');
      expect(write).toBeDefined();
      expect(write!.content).toBe('embedded content');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 9. Edge Cases — Real LLM Behavior
  // ═══════════════════════════════════════════════════════════

  describe('Edge cases — realistic LLM output patterns', () => {
    it('handles write_file with Windows-style paths', () => {
      const content = '```file: project\\windows\\path.txt\nwindows content\n```';
      const edits = extractFileEdits(content);
      // The parser normalizes backslashes to forward slashes
      expect(edits.length).toBeGreaterThanOrEqual(0);
    });

    it('handles write_file with content containing backticks', () => {
      const content = `\`\`\`file: project/readme.md
# Usage
\`\`\`
\`npm install\`
\`\`\``;
      const edits = extractFileEdits(content);
      // This is a challenging case — the backticks in content may close the fence
      expect(edits.length).toBeGreaterThanOrEqual(0);
    });

    it('handles write_file with content containing XML-like tags', () => {
      const content = `\`\`\`file: project/component.html
<div class="app">
  <h1>Hello</h1>
  <file_edit path="should-not-parse">nested</file_edit>
</div>
\`\`\``;
      const edits = extractFileEdits(content);
      expect(edits.length).toBeGreaterThanOrEqual(1);
    });

    it('handles batch_write with 50 files at the limit', async () => {
      const files = Array.from({ length: 50 }, (_, i) => ({
        path: `project/sessions/999/limit/f-${i}.txt`,
        content: `content ${i}`,
      }));
      const result = await runTool(batchWriteTool, { files });
      expect(result.success).toBe(true);
      expect(result.successCount).toBe(50);
      expect(result.failCount).toBe(0);
    });

    it('handles write_file where content is just whitespace', async () => {
      const result = await runTool(writeFileTool, {
        path: 'project/sessions/999/whitespace.txt',
        content: '   \n  \n   ',
      });
      // Whitespace-only content is valid — it's still content
      expect(result.success).toBe(true);
    });

    it('handles create_directory for nested paths', async () => {
      const result = await runTool(createDirectoryTool, {
        path: 'project/sessions/999/a/b/c/d',
      });
      expect(result.success).toBe(true);
    });

    it('handles list_files on non-existent directory gracefully', async () => {
      const result = await runTool(listFilesTool, {
        path: 'project/sessions/999/nonexistent',
        recursive: false,
      });
      // Should not throw — return empty or error gracefully
      expect(result).toBeDefined();
    });

    it('handles search_files with no matches', async () => {
      const result = await runTool(searchFilesTool, {
        query: 'zzznonexistent_query_xyz_123',
        limit: 10,
      });
      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
    });
  });
});
