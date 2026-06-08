/**
 * streamWithAutoContinue — Unit Tests
 *
 * Verifies the streamWithAutoContinue async generator's integration with
 * detectNeedsMoreTurns and its guard clauses, edge cases, and passthrough
 * behavior.
 *
 * IMPORTANT: Internal calls to `autoContinueWithFiles` cannot be mocked via
 * vi.mock (same-module calls reference the original function). Therefore
 * tests use tool names that are recognized by detectNeedsMoreTurns but are
 * NOT in FILE_READ_TOOL_VARIANTS / INFO_GATHERING_TOOLS — specifically
 * `grep`, `search_code`, and `code.search` (read-only but not file-read),
 * and `write_file`, `str_replace` (write/patch but not info-gathering).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  streamWithAutoContinue,
  resetContinuationCounters,
  getConversationContinuationCount,
} from '@/lib/virtual-filesystem/smart-context';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Consume an async generator and collect all yielded values. */
async function collectStream(generator: AsyncGenerator<any>): Promise<any[]> {
  const results: any[] = [];
  for await (const chunk of generator) {
    results.push(chunk);
  }
  return results;
}

/** Create an async generator from an array of chunks. */
async function* fromChunks(chunks: any[]): AsyncGenerator<any> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TESTS: streamWithAutoContinue
// ────────────────────────────────────────────────────────────────────────────

describe('streamWithAutoContinue', () => {
  beforeEach(() => {
    resetContinuationCounters();
  });

  // ── Passthrough ──────────────────────────────────────────────────────────

  describe('passthrough', () => {
    it('should yield all chunks verbatim when autoContinue is disabled', async () => {
      const chunks = [
        { content: 'Hello', isComplete: false },
        { content: ' World', isComplete: false },
        { content: '!', isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        enableAutoContinue: false,
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should yield all chunks when enabled but no detection signals fire', async () => {
      const chunks = [
        { content: 'Done. I have completed the task. Here is a summary of '
          + 'everything that was done and why each change was necessary.', isComplete: false },
        { content: ' Everything looks correct.', isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should properly interleave content and isComplete on separate chunks', async () => {
      const chunks = [
        { content: 'Step 1 completed.', isComplete: false },
        { content: ' Step 2 done.', isComplete: false },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });
  });

  // ── CONTINUE_REQUESTED ────────────────────────────────────────────────────

  describe('CONTINUE_REQUESTED detection', () => {
    it('should yield auto-continue event when response ends with [CONTINUE_REQUESTED]', async () => {
      const chunks = [
        { content: 'I need to check the config file.', isComplete: false },
        { content: '[CONTINUE_REQUESTED]', isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-1',
      });
      const results = await collectStream(gen);

      expect(results.length).toBe(chunks.length + 1);
      const event = results[results.length - 1];
      expect(event.type).toBe('auto-continue');
      expect(event.content).toBe('');
      expect(event.isComplete).toBe(true);
      expect(event.metadata.autoContinue).toBe(true);
      expect(event.metadata.continuationRequested).toBe(true);
    });

    it('should include tool summary in auto-continue event', async () => {
      // Note: [CONTINUE_REQUESTED] path returns BEFORE autoContinueWithFiles is
      // called, so FILE_READ_TOOL_VARIANTS tool names are safe here.
      const chunks = [
        { content: 'Let me examine the file.', isComplete: false },
        { toolCalls: [{ name: 'read_file', arguments: { path: '/src/app.ts' } }] },
        { content: '[CONTINUE_REQUESTED]', isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-2',
      });
      const results = await collectStream(gen);
      const event = results[results.length - 1];

      expect(event.toolSummary).toContain('read_file');
      expect(event.metadata.toolCount).toBe(1);
      expect(event.metadata.continuationRequested).toBe(true);
    });

    it('should NOT detect [CONTINUE_REQUESTED] when it appears mid-response', async () => {
      // [CONTINUE_REQUESTED] must be at the VERY END of the trimmed response
      const chunks = [
        { content: 'Here is what I found: [CONTINUE_REQUESTED]', isComplete: false },
        { content: ' More details after the marker.', isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-3',
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });
  });

  // ── detectNeedsMoreTurns integration ──────────────────────────────────────

  describe('detectNeedsMoreTurns integration', () => {
    it('should yield [NEXT] chunk on read-then-stall signal', async () => {
      // Using `grep` instead of `read_file`: grep is in READ_ONLY_TOOL_NAMES
      // but NOT in FILE_READ_TOOL_VARIANTS, so autoContinueWithFiles won't
      // intercept before detectNeedsMoreTurns runs.
      const chunks = [
        { content: '', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-10',
      });
      const results = await collectStream(gen);

      expect(results.length).toBe(chunks.length + 1);
      const lastChunk = results[results.length - 1];
      expect(lastChunk.content).toContain('[NEXT]');
      expect(lastChunk.isComplete).toBe(false);
      expect(lastChunk.metadata.autoContinue).toBe(true);
      expect(lastChunk.metadata.reason).toBe('multi_factor_detection');
      expect(lastChunk.metadata.signals).toContain('read-then-stall');
      expect(lastChunk.metadata.confidence).toBe('high');
    });

    it('should yield [CONTINUE] with context on mid-sentence-cutoff signal', async () => {
      // Response ends mid-sentence. Need at least 1 step (detector returns
      // early when steps.length === 0). Using `grep` — not in FILE_READ_TOOL_VARIANTS.
      const chunks = [
        { content: 'The issue is that the function does not handle the edge case correctly because',
          isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'bug' } }] },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-11',
      });
      const results = await collectStream(gen);

      expect(results.length).toBe(chunks.length + 1);
      const lastChunk = results[results.length - 1];
      expect(lastChunk.content).toContain('[CONTINUE]');
      // Context hint: last 200 chars appended
      expect(lastChunk.content).toContain('Last 200 characters');
      expect(lastChunk.metadata.signals).toContain('mid-sentence-cutoff');
      expect(lastChunk.metadata.confidence).toBe('high');
    });

    it('should yield [CONTINUE] with context on unclosed-code-block signal', async () => {
      const chunks = [
        { content: 'The fix is:\n```typescript\nconst port = 8080;\n', isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/config.ts' } }] },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-12',
      });
      const results = await collectStream(gen);

      expect(results.length).toBe(chunks.length + 1);
      const lastChunk = results[results.length - 1];
      expect(lastChunk.content).toContain('[CONTINUE]');
      expect(lastChunk.content).toContain('Last 200 characters');
      expect(lastChunk.metadata.signals).toContain('unclosed-code-block');
      expect(lastChunk.metadata.confidence).toBe('medium');
    });

    it('should fire multiple signals simultaneously for rich diagnostics', async () => {
      // 3 read-only tools (grep, search_code, code.search) + empty response
      // → read-then-stall + deep-research-loop + read-many-write-none + empty-after-tools
      // None of these tools are in FILE_READ_TOOL_VARIANTS.
      // Note: toolCalls from AI SDK chunks don't carry `result` or `state`, so
      // the step mapping defaults to result.success=false. To avoid failure-cascade
      // (2+ failed tools), we use toolInvocations which carry execution results.
      const chunks = [
        { content: '', isComplete: false },
        { toolInvocations: [
          { toolCallId: 'c1', toolName: 'grep', args: { pattern: 'TODO' }, state: 'result', result: { success: true, output: 'line 1' } },
          { toolCallId: 'c2', toolName: 'search_code', args: { query: 'find' }, state: 'result', result: { success: true, output: 'file.ts:42' } },
          { toolCallId: 'c3', toolName: 'code.search', args: { query: 'api' }, state: 'result', result: { success: true, output: 'route.ts:10' } },
        ] },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-13',
      });
      const results = await collectStream(gen);

      expect(results.length).toBe(chunks.length + 1);
      const lastChunk = results[results.length - 1];
      // Now that result and state are preserved from toolInvocations, each
      // step has result.success=true (no false failures). Two signals fire:
      //   read-many-write-none (grep + search_code are read-only, 0 writes)
      //   empty-after-tools (3 tools, response < 100 chars)
      // code.search is NOT in READ_ONLY_TOOL_NAMES so read-then-stall doesn't fire.
      expect(lastChunk.metadata.signals.length).toBeGreaterThanOrEqual(2);
      expect(lastChunk.metadata.signals).toContain('read-many-write-none');
      expect(lastChunk.metadata.signals).toContain('empty-after-tools');
      expect(lastChunk.metadata.confidence).toBe('high');
    });

    it('should NOT fire when no signals match', async () => {
      const chunks = [
        { content: 'Done. I have completed the task. Here is a detailed summary of '
          + 'everything that was changed and why each modification was necessary.', isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/out.ts' } }] },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-14',
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should NOT fire when hasContinuationMarker is true ([NEXT] in response)', async () => {
      const chunks = [
        { content: 'Here is the next step. [NEXT]', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-15',
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should NOT fire when hasContinuationMarker is true ([AUTO-CONTINUE] in response)', async () => {
      const chunks = [
        { content: 'Attaching files. [AUTO-CONTINUE]', isComplete: false },
        { content: 'More content after marker.', isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });
  });

  // ── Guard clauses ────────────────────────────────────────────────────────

  describe('guard clauses', () => {
    it('should not auto-continue when maxContinuations is 0', async () => {
      const chunks = [
        { content: 'I need more info.', isComplete: false },
        { content: '[CONTINUE_REQUESTED]', isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-20',
        maxContinuations: 0,
        continuationCount: 0,
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should not auto-continue when continuationCount >= maxContinuations', async () => {
      const chunks = [
        { content: 'Still working.', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-21',
        maxContinuations: 2,
        continuationCount: 2,
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should not auto-continue when isComplete is false (stream incomplete)', async () => {
      const chunks = [
        { content: 'The issue is that', isComplete: false },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should not auto-continue with empty response and no tool calls', async () => {
      const chunks = [{ isComplete: true, content: '' }];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should not auto-continue when response is only whitespace and no tool calls', async () => {
      const chunks = [{ isComplete: true, content: '   \n  \t  ' }];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });
  });

  // ── conversationId tracking ──────────────────────────────────────────────

  describe('conversationId tracking', () => {
    it('should increment continuation count on [CONTINUE_REQUESTED]', async () => {
      expect(getConversationContinuationCount('conv-track-1')).toBe(0);

      const gen = streamWithAutoContinue(fromChunks([
        { content: 'Need more info.', isComplete: false },
        { content: '[CONTINUE_REQUESTED]', isComplete: true },
      ]), {
        userId: 'test-user',
        conversationId: 'conv-track-1',
      });
      await collectStream(gen);

      expect(getConversationContinuationCount('conv-track-1')).toBe(1);
    });

    it('should increment continuation count on detectNeedsMoreTurns trigger', async () => {
      const gen = streamWithAutoContinue(fromChunks([
        { content: '', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ]), {
        userId: 'test-user',
        conversationId: 'conv-track-2',
      });
      await collectStream(gen);

      expect(getConversationContinuationCount('conv-track-2')).toBe(1);
    });

    it('should reset count on successful completion (no auto-continue)', async () => {
      const gen = streamWithAutoContinue(fromChunks([
        { content: 'Done. All good.', isComplete: true },
      ]), {
        userId: 'test-user',
        conversationId: 'conv-track-3',
        continuationCount: 2,
      });
      await collectStream(gen);

      expect(getConversationContinuationCount('conv-track-3')).toBe(0);
    });

    it('should NOT reset count when auto-continue fired', async () => {
      const gen = streamWithAutoContinue(fromChunks([
        { content: '', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ]), {
        userId: 'test-user',
        conversationId: 'conv-track-4',
        continuationCount: 0,
      });
      await collectStream(gen);

      expect(getConversationContinuationCount('conv-track-4')).toBe(1);
    });
  });

  // ── Error resilience ─────────────────────────────────────────────────────

  describe('error resilience', () => {
    it('should propagate errors from the inner generator', async () => {
      async function* failingGenerator() {
        yield { content: 'Before error', isComplete: false };
        throw new Error('Generator crashed');
      }

      const gen = streamWithAutoContinue(failingGenerator(), {
        userId: 'test-user',
      });

      await expect(collectStream(gen)).rejects.toThrow('Generator crashed');
    });

    it('should handle unknown tool names gracefully without crashing', async () => {
      // Unknown tools are wrapped in try-catch so they don't crash the stream
      const chunks = [
        { content: '', isComplete: false },
        { toolCalls: [{ name: 'mystery_tool', arguments: {} }] },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should handle toolInvocations chunks alongside toolCalls chunks', async () => {
      // Using `grep` (not in FILE_READ_TOOL_VARIANTS) so autoContinueWithFiles
      // won't intercept before detectNeedsMoreTurns.
      const chunks = [
        { content: '', isComplete: false },
        { toolInvocations: [
          {
            toolCallId: 'call-1',
            toolName: 'grep',
            args: { pattern: 'TODO' },
            state: 'result',
            result: { success: true, output: 'line 42: TODO fix me' },
          },
        ] },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-30',
      });
      const results = await collectStream(gen);

      expect(results.length).toBe(chunks.length + 1);
      const lastChunk = results[results.length - 1];
      expect(lastChunk.metadata.signals).toContain('read-then-stall');
    });
  });

  // ── Edge: mixed chunks ────────────────────────────────────────────────────

  describe('edge: mixed chunks', () => {
    it('should detect read-then-stall when content and tool calls in same chunk', async () => {
      const chunks = [
        {
          content: 'Looking for references in the codebase.',
          toolCalls: [{ name: 'grep', arguments: { pattern: 'function' } }],
          isComplete: true,
        },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-40',
      });
      const results = await collectStream(gen);

      expect(results.length).toBe(2);
      const lastChunk = results[results.length - 1];
      expect(lastChunk.metadata.signals).toContain('read-then-stall');
    });

    it('should handle toolInvocations with arguments alias', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { toolInvocations: [
          {
            toolCallId: 'call-1',
            toolName: 'grep',
            arguments: { pattern: 'TODO' },
            state: 'result',
          },
        ] },
        { isComplete: true },
      ];

      const gen = streamWithAutoContinue(fromChunks(chunks), {
        userId: 'test-user',
        conversationId: 'conv-41',
      });
      const results = await collectStream(gen);

      expect(results.length).toBe(chunks.length + 1);
      const lastChunk = results[results.length - 1];
      expect(lastChunk.metadata.signals).toContain('read-then-stall');
    });
  });
});
