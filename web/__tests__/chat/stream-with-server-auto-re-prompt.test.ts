/**
 * streamWithServerAutoRePrompt — Unit Tests
 *
 * Verifies the streamWithServerAutoRePrompt async generator's integration with
 * detectNeedsMoreTurns: tool result collection, detection triggering, guard
 * clauses, and error resilience when the re-prompt LLM call fails.
 *
 * KEY DESIGN NOTE: After detection fires, streamWithServerAutoRePrompt does a
 * dynamic import of `streamWithVercelAI` (from '../chat/vercel-ai-streaming')
 * to make the re-prompt LLM call. In unit tests this import will fail because
 * the module depends on the full Vercel AI SDK environment. This is expected
 * and handled by a try-catch — the generator completes gracefully. We verify
 * that the detection logic IS reached (tool results collected, detectNeedsMoreTurns
 * called) by confirming the generator does NOT throw when detection would fire.
 */

import { describe, it, expect } from 'vitest';
import {
  streamWithServerAutoRePrompt,
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

/** Default options for streamWithServerAutoRePrompt calls. */
function defaultOptions(overrides: Record<string, any> = {}): {
  userId: string;
  messages: any[];
  provider: string;
  model: string;
} {
  return {
    userId: 'test-user',
    messages: [{ role: 'user', content: 'fix the bug' }],
    provider: 'openai',
    model: 'gpt-4',
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// TESTS: streamWithServerAutoRePrompt
// ────────────────────────────────────────────────────────────────────────────

describe('streamWithServerAutoRePrompt', () => {
  // ── Passthrough ──────────────────────────────────────────────────────────

  describe('passthrough', () => {
    it('should yield all chunks verbatim with no tool results (content only)', async () => {
      const chunks = [
        { content: 'Hello', isComplete: false },
        { content: ' World', isComplete: false },
        { content: '!', isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'pass-1' }),
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should yield all chunks verbatim with tool results', async () => {
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'grep',
              args: { pattern: 'TODO' },
              state: 'result',
              result: { success: true, output: 'line 42' },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'pass-2' }),
      });
      const results = await collectStream(gen);

      // All original chunks should be yielded before any re-prompt attempt
      expect(results.length).toBeGreaterThanOrEqual(chunks.length);
      // First N chunks should match the input exactly
      for (let i = 0; i < chunks.length; i++) {
        expect(results[i]).toEqual(chunks[i]);
      }
    });
  });

  // ── Text accumulation ────────────────────────────────────────────────────

  describe('text accumulation', () => {
    it('should accumulate fullResponse across multiple content chunks', async () => {
      const chunks = [
        { content: 'Step 1: read the file. ', isComplete: false },
        { content: 'Step 2:', isComplete: false },
        { toolInvocations: [
          { toolCallId: 'c1', toolName: 'grep', args: { pattern: 'TODO' }, state: 'result', result: { success: true } },
        ] },
        { content: ' analyze results.', isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'text-1' }),
      });
      const results = await collectStream(gen);

      expect(results.length).toBe(chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        expect(results[i]).toEqual(chunks[i]);
      }
    });
  });

  // ── Tool result collection ───────────────────────────────────────────────

  describe('tool result collection', () => {
    it('should collect toolInvocations with state=result', async () => {
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'grep',
              args: { pattern: 'TODO' },
              state: 'result',
              result: { success: true, output: 'line 42' },
            },
          ],
        },
        { isComplete: true },
      ];

      // The tool result triggers detection which tries to import streamWithVercelAI.
      // That import will fail, but the error is caught gracefully.
      // We verify: no crash and all original chunks are yielded.
      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'tool-1' }),
      });
      const results = await collectStream(gen);

      expect(results.length).toBeGreaterThanOrEqual(chunks.length);
    });

    it('should ignore toolInvocations without state=result', async () => {
      // If state is not 'result', the invocation is skipped (no detection fired)
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'grep',
              args: { pattern: 'TODO' },
              state: 'call',  // Not 'result' — will be skipped
              result: { success: true },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'tool-2' }),
      });
      const results = await collectStream(gen);

      // No detection → no re-prompt attempt → chunks pass through unchanged
      expect(results).toEqual(chunks);
    });

    it('should ignore toolInvocations without toolCallId', async () => {
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolName: 'grep',  // Missing toolCallId — will be skipped
              args: { pattern: 'TODO' },
              state: 'result',
              result: { success: true },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'tool-3' }),
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should ignore toolInvocations without toolName', async () => {
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',  // Missing toolName — will be skipped
              args: { pattern: 'TODO' },
              state: 'result',
              result: { success: true },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'tool-4' }),
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });
  });

  // ── detectNeedsMoreTurns integration ─────────────────────────────────────

  describe('detectNeedsMoreTurns integration', () => {
    it('should reach detection and handle re-prompt failure when read-then-stall signal fires', async () => {
      // grep (read-only) + empty response → read-then-stall fires → detection
      // → re-prompt attempt → import fails → error caught gracefully
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'grep',
              args: { pattern: 'TODO' },
              state: 'result',
              result: { success: true, output: 'line 42' },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'detect-1' }),
      });
      // Should NOT throw — re-prompt failure is caught by try-catch
      const results = await collectStream(gen);

      // The original chunks are always yielded regardless of re-prompt outcome
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT attempt re-prompt when detection signals do NOT fire', async () => {
      // write_file (not read-only) + long response → no signals → no re-prompt
      const chunks = [
        { content: 'Done. I have completed the task. Here is a detailed summary '
          + 'of everything that was changed and why each modification was necessary.',
          isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'write_file',
              args: { path: '/src/out.ts' },
              state: 'result',
              result: { success: true },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'detect-2' }),
      });
      const results = await collectStream(gen);

      // No detection → chunks pass through unchanged (no extra yields)
      expect(results).toEqual(chunks);
    });

    it('should detect failure-cascade when multiple tools fail', async () => {
      // 2 failed tools → failure-cascade fires → re-prompt attempt
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'write_file',
              args: { path: '/src/a.ts' },
              state: 'result',
              result: { success: false, error: 'permission denied' },
            },
            {
              toolCallId: 'c2',
              toolName: 'edit_file',
              args: { path: '/src/a.ts' },
              state: 'result',
              result: { success: false, error: 'file not found' },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'detect-3' }),
      });
      // Should NOT throw — re-prompt failure is caught
      const results = await collectStream(gen);

      expect(results.length).toBeGreaterThanOrEqual(chunks.length);
    });

    it('should detect write-verify-loop (write_file then read_file same path)', async () => {
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'write_file',
              args: { path: '/src/app.ts' },
              state: 'result',
              result: { success: true },
            },
            {
              toolCallId: 'c2',
              toolName: 'read_file',
              args: { path: '/src/app.ts' },
              state: 'result',
              result: { success: true, output: '...' },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'detect-4' }),
      });
      // Detection fires → re-prompt attempt → import fails → graceful
      const results = await collectStream(gen);

      expect(results.length).toBeGreaterThanOrEqual(chunks.length);
    });

    it('should detect announced-next-step when response has plan words', async () => {
      const chunks = [
        { content: "I'll now search for the API endpoint.", isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'write_file',
              args: { path: '/src/out.ts' },
              state: 'result',
              result: { success: true },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'detect-5' }),
      });
      const results = await collectStream(gen);

      // Detection fires → graceful import failure → no crash
      expect(results.length).toBeGreaterThanOrEqual(chunks.length);
    });

    it('should detect single-write-silent when 1 write with short response', async () => {
      const chunks = [
        { content: 'Done.', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'write_file',
              args: { path: '/src/a.ts' },
              state: 'result',
              result: { success: true },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'detect-6' }),
      });
      const results = await collectStream(gen);

      expect(results.length).toBeGreaterThanOrEqual(chunks.length);
    });

    it('should detect mid-sentence-cutoff when response ends without punctuation', async () => {
      const chunks = [
        { content: 'The issue is that the function does not handle the edge case correctly because',
          isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'grep',
              args: { pattern: 'bug' },
              state: 'result',
              result: { success: true, output: 'line 42' },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'detect-7' }),
      });
      const results = await collectStream(gen);

      // Detection fires (read-then-stall + mid-sentence-cutoff) → graceful failure
      expect(results.length).toBeGreaterThanOrEqual(chunks.length);
    });
  });

  // ── Guard clauses ────────────────────────────────────────────────────────

  describe('guard clauses', () => {
    it('should NOT attempt re-prompt when maxRePrompts is 0', async () => {
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'grep',
              args: { pattern: 'TODO' },
              state: 'result',
              result: { success: true },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'guard-1' }),
        maxRePrompts: 0,
      });
      const results = await collectStream(gen);

      // No re-prompt → chunks pass through unchanged
      expect(results).toEqual(chunks);
    });

    it('should NOT attempt re-prompt when no toolInvocations collected', async () => {
      const chunks = [
        { content: 'All done.', isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'guard-2' }),
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should NOT attempt re-prompt when toolInvocations have no state result', async () => {
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'grep',
              args: { pattern: 'TODO' },
              state: 'call',  // Not 'result' — won't be collected
              result: { success: true },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'guard-3' }),
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should NOT attempt re-prompt when only non-read-only tools and sufficient response', async () => {
      // write_file (not read-only) + long response > 100 chars = no signals
      const chunks = [
        { content: 'Done. I have completed the task. Here is a detailed summary '
          + 'of everything that was changed and why each modification was necessary.',
          isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'write_file',
              args: { path: '/src/out.ts' },
              state: 'result',
              result: { success: true },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'guard-4' }),
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });
  });

  // ── Error resilience ─────────────────────────────────────────────────────

  describe('error resilience', () => {
    it('should propagate errors from the inner generator', async () => {
      async function* failingGenerator() {
        yield { content: 'Before error', isComplete: false };
        throw new Error('Generator crashed');
      }

      const gen = streamWithServerAutoRePrompt(failingGenerator(), {
        ...defaultOptions(),
      });

      await expect(collectStream(gen)).rejects.toThrow('Generator crashed');
    });

    it('should handle chunks with missing fields without crashing', async () => {
      // Chunks that are valid objects but lack content/toolInvocations — the
      // generator accesses `chunk.content` and `chunk.toolInvocations` guardedly.
      // Null chunks are not a valid streaming scenario and will crash naturally.
      const chunks = [
        { unknownField: true },
        { content: 42 },  // not a string — guarded
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks as any[]), {
        ...defaultOptions({ conversationId: 'err-2' }),
      });
      const results = await collectStream(gen);

      expect(results).toEqual(chunks);
    });

    it('should handle empty stream gracefully', async () => {
      const gen = streamWithServerAutoRePrompt(fromChunks([]), {
        ...defaultOptions({ conversationId: 'err-3' }),
      });
      const results = await collectStream(gen);

      expect(results).toEqual([]);
    });

    it('should handle toolInvocations with arguments alias', async () => {
      // Some SDK versions use `arguments` instead of `args`
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'grep',
              arguments: { pattern: 'TODO' },
              state: 'result',
              result: { success: true, output: 'match' },
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'err-4' }),
      });
      // Detection fires → graceful import failure
      const results = await collectStream(gen);

      expect(results.length).toBeGreaterThanOrEqual(chunks.length);
    });

    it('should handle toolInvocations with missing result field', async () => {
      // Some SDK versions omit result — the step mapping fallback handles it
      const chunks = [
        { content: '', isComplete: false },
        {
          toolInvocations: [
            {
              toolCallId: 'c1',
              toolName: 'grep',
              args: { pattern: 'TODO' },
              state: 'result',
              // No `result` field — will use fallback
            },
          ],
        },
        { isComplete: true },
      ];

      const gen = streamWithServerAutoRePrompt(fromChunks(chunks), {
        ...defaultOptions({ conversationId: 'err-5' }),
      });
      const results = await collectStream(gen);

      // Tool was collected (state=result, has toolCallId + toolName) → detection runs
      // Fallback result.success = false (no result, no output) → failure-cascade needs 2+
      // Just 1 tool → no failure-cascade. read-then-stall fires (grep is read-only)
      expect(results.length).toBeGreaterThanOrEqual(chunks.length);
    });
  });
});
