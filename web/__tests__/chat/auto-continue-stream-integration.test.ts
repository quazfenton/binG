/**
 * streamWithAutoContinue × detectNeedsMoreTurns — Integration Tests
 *
 * Verifies the data flow contract between streamWithAutoContinue and
 * detectNeedsMoreTurns:
 *   raw chunks → accumulated state → DetectableResult → signals → yield
 *
 * These tests cross-reference results from both functions to verify the
 * intermediate data mapping is correct, which pure unit tests (testing
 * either function in isolation) cannot validate.
 *
 * IMPORTANT INDEXING NOTE: The auto-continue yield is ALWAYS the LAST
 * element (results[results.length - 1]), NOT a fixed index like results[1].
 * Tests use `lastChunk` returned from runThroughStream for clarity.
 *
 * TOOL SELECTION RULES (to bypass autoContinueWithFiles):
 *   - Read-only tools NOT in FILE_READ_TOOL_VARIANTS: grep, search_code
 *   - Write tools NOT in FILE_READ_TOOL_VARIANTS: write_file
 *
 * RESPONSE LENGTH RULES (to avoid unexpected signals):
 *   - >= 100 chars to avoid: empty-after-tools, edits-mismatch
 *   - >= 80 chars to avoid: single-write-silent
 *   - Ends with terminal punctuation to avoid: mid-sentence-cutoff
 *   - No plan words to avoid: announced-next-step, planned-multi-step
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectNeedsMoreTurns,
  type DetectableResult,
} from '@/lib/chat/auto-continue-detector';
import {
  streamWithAutoContinue,
  resetContinuationCounters,
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

/**
 * Emulate the exact DetectableResult construction that streamWithAutoContinue
 * performs internally. This is the "contract" — if this helper diverges from
 * the actual code, the round-trip tests will catch it.
 */
function buildExpectedDetectableResult(chunks: any[]): DetectableResult {
  let fullResponse = '';
  const allToolCalls: any[] = [];
  let isComplete = false;
  const seenToolCallIds = new Set<string>();

  for (const chunk of chunks) {
    if (chunk.isComplete === true) isComplete = true;
    if (chunk.content && typeof chunk.content === 'string') {
      fullResponse += chunk.content;
    }
    if (chunk.toolCalls && Array.isArray(chunk.toolCalls)) {
      for (const tc of chunk.toolCalls) {
        const callId = tc.id || tc.toolCallId;
        if (callId) {
          if (seenToolCallIds.has(callId)) continue;
          seenToolCallIds.add(callId);
        }
        allToolCalls.push(tc);
      }
    }
    if (chunk.toolInvocations && Array.isArray(chunk.toolInvocations)) {
      for (const invocation of chunk.toolInvocations) {
        if (invocation.toolCallId && invocation.toolName) {
          if (seenToolCallIds.has(invocation.toolCallId)) {
            const existingIdx = allToolCalls.findIndex(
              tc => tc.id === invocation.toolCallId || tc.toolCallId === invocation.toolCallId
            );
            if (existingIdx >= 0) {
              allToolCalls[existingIdx] = {
                ...allToolCalls[existingIdx],
                result: invocation.result,
                state: invocation.state,
              };
            }
            continue;
          }
          seenToolCallIds.add(invocation.toolCallId);
          allToolCalls.push({
            id: invocation.toolCallId,
            name: invocation.toolName,
            arguments: invocation.args || invocation.arguments || {},
            result: invocation.result,
            state: invocation.state,
          });
        }
      }
    }
  }

  return {
    success: isComplete,
    response: fullResponse,
    steps: allToolCalls.map((tc: any) => ({
      toolName: tc.name || tc.toolName || 'unknown',
      args: tc.arguments || tc.args || {},
      result: tc.result || { success: tc.state === 'result' },
    })),
  };
}

/**
 * Feed chunks through streamWithAutoContinue and return:
 *   - results:    all yielded values (original chunks + optional auto-continue)
 *   - lastChunk:  the auto-continue yield, or null if none was emitted
 *   - hadAutoContinue: whether an auto-continue was emitted
 */
async function runThroughStream(
  chunks: any[],
  conversationId = 'int-conv',
): Promise<{ results: any[]; lastChunk: any; hadAutoContinue: boolean }> {
  const gen = streamWithAutoContinue(fromChunks(chunks), {
    userId: 'test-user',
    conversationId,
  });
  const results = await collectStream(gen);
  const hadAutoContinue = results.length > chunks.length;
  return {
    results,
    lastChunk: hadAutoContinue ? results[results.length - 1] : null,
    hadAutoContinue,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// TESTS
// ────────────────────────────────────────────────────────────────────────────

describe('streamWithAutoContinue × detectNeedsMoreTurns integration', () => {
  beforeEach(() => {
    resetContinuationCounters();
  });

  // ── Round-trip consistency ───────────────────────────────────────────────

  describe('round-trip consistency', () => {
    it('should produce the same signals as direct detectNeedsMoreTurns for read-then-stall', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'rt-1');
      expect(results.length).toBe(chunks.length + 1);
      const streamSignals = lastChunk.metadata.signals as string[];

      const expectedResult = buildExpectedDetectableResult(chunks);
      const direct = detectNeedsMoreTurns(expectedResult);

      expect(streamSignals.sort()).toEqual(direct.signals.sort());
      expect(direct.signals).toContain('read-then-stall');
    });

    it('should produce the same signals for mid-sentence-cutoff', async () => {
      const chunks = [
        { content: 'The bug is on line 42 and it breaks the connection pool because',
          isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'bug' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'rt-2');
      expect(results.length).toBe(chunks.length + 1);
      const streamSignals = lastChunk.metadata.signals as string[];

      const expectedResult = buildExpectedDetectableResult(chunks);
      const direct = detectNeedsMoreTurns(expectedResult);

      expect(streamSignals.sort()).toEqual(direct.signals.sort());
      expect(direct.signals).toContain('mid-sentence-cutoff');
    });

    it('should produce the same signals for unclosed-code-block', async () => {
      const chunks = [
        { content: 'The fix:\n```typescript\nconst x = 1;\n', isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/a.ts' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'rt-3');
      expect(results.length).toBe(chunks.length + 1);
      const streamSignals = lastChunk.metadata.signals as string[];

      const expectedResult = buildExpectedDetectableResult(chunks);
      const direct = detectNeedsMoreTurns(expectedResult);

      expect(streamSignals.sort()).toEqual(direct.signals.sort());
      expect(direct.signals).toContain('unclosed-code-block');
    });

    it('should produce same result (no signals) for no-signal case', async () => {
      const chunks = [
        { content: 'Done. The implementation is complete and all tests pass. '
          + 'All edge cases are handled correctly.', isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/out.ts' } }] },
        { isComplete: true },
      ];

      const { results, hadAutoContinue } = await runThroughStream(chunks, 'rt-4');
      expect(hadAutoContinue).toBe(false);
      expect(results.length).toBe(chunks.length);

      const expectedResult = buildExpectedDetectableResult(chunks);
      const direct = detectNeedsMoreTurns(expectedResult);
      expect(direct.needsMoreTurns).toBe(false);
    });
  });

  // ── Step mapping correctness ────────────────────────────────────────────

  describe('step mapping correctness', () => {
    it('should map toolCalls toolName via tc.name → step.toolName', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'map-1');
      expect(results.length).toBe(chunks.length + 1);
      expect(lastChunk.metadata.signals).toContain('read-then-stall');
    });

    it('should map toolInvocations via inv.toolName → tc.name → step.toolName', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { toolInvocations: [
          { toolCallId: 'c1', toolName: 'grep', args: { pattern: 'TODO' }, state: 'result', result: { success: true } },
        ] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'map-2');
      expect(results.length).toBe(chunks.length + 1);
      expect(lastChunk.metadata.signals).toContain('read-then-stall');
    });

    it('should fall back to tc.toolName when tc.name is absent', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { toolCalls: [{ toolName: 'grep', name: undefined, arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'map-3');
      expect(results.length).toBe(chunks.length + 1);
      expect(lastChunk.metadata.signals).toContain('read-then-stall');
    });

    it('should use "unknown" when both tc.name and tc.toolName are missing', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { toolCalls: [{ arguments: { path: '/x' } }] },
        { isComplete: true },
      ];

      const { results, hadAutoContinue } = await runThroughStream(chunks, 'map-4');
      expect(hadAutoContinue).toBe(false);
      expect(results.length).toBe(chunks.length);
    });

    it('should accumulate tools from multiple chunks', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'foo' } }] },
        { toolCalls: [{ name: 'search_code', arguments: { query: 'bar' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'map-5');
      expect(results.length).toBe(chunks.length + 1);
      const signals = lastChunk.metadata.signals as string[];
      expect(signals).toContain('read-many-write-none');
      expect(signals).toContain('read-then-stall');
    });

    it('should handle mixed toolCalls and toolInvocations in the same chunk', async () => {
      const chunks = [
        { content: '', isComplete: false },
        {
          toolCalls: [{ name: 'grep', arguments: { pattern: 'foo' } }],
          toolInvocations: [
            { toolCallId: 'c2', toolName: 'search_code', args: { query: 'bar' }, state: 'result', result: {} },
          ],
        },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'map-6');
      expect(results.length).toBe(chunks.length + 1);
      const signals = lastChunk.metadata.signals as string[];
      expect(signals).toContain('read-many-write-none');
    });
  });

  // ── Prefix selection ─────────────────────────────────────────────────────

  describe('prefix selection', () => {
    it('should use [CONTINUE] prefix for mid-sentence-cutoff signal', async () => {
      const chunks = [
        { content: 'The function does not handle the edge case correctly because',
          isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'bug' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'pref-1');
      expect(results.length).toBe(chunks.length + 1);
      expect(lastChunk.content).toContain('[CONTINUE]');
      expect(lastChunk.metadata.confidence).toBe('high');
    });

    it('should use [CONTINUE] prefix for unclosed-code-block signal', async () => {
      const chunks = [
        { content: 'The fix:\n```typescript\nconst x = 1;\n', isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/a.ts' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'pref-2');
      expect(results.length).toBe(chunks.length + 1);
      expect(lastChunk.content).toContain('[CONTINUE]');
      // single-write-silent fires first (1 write, response < 80 chars) → 'medium'
      expect(lastChunk.metadata.confidence).toBe('medium');
    });

    it('should use [CONTINUE] prefix when ALL three incomplete signals fire together', async () => {
      const chunks = [
        { content: 'I found the bug in the config file\n```\nconst port = 8080',
          isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'config' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'pref-3');
      expect(results.length).toBe(chunks.length + 1);
      expect(lastChunk.content).toContain('[CONTINUE]');
      expect(lastChunk.content).toContain('Last 200 characters');
      // read-then-stall (grep is read-only) → 'high'
      expect(lastChunk.metadata.confidence).toBe('high');
    });

    it('should use [NEXT] prefix for read-then-stall signal', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'pref-4');
      expect(results.length).toBe(chunks.length + 1);
      expect(lastChunk.content).toContain('[NEXT]');
      // read-then-stall (grep is read-only) → 'high'
      expect(lastChunk.metadata.confidence).toBe('high');
    });

    it('should use [NEXT] prefix for announced-next-step signal', async () => {
      const chunks = [
        { content: "I'll now search for the API endpoint.", isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/out.ts' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'pref-5');
      expect(results.length).toBe(chunks.length + 1);
      expect(lastChunk.content).toContain('[NEXT]');
      // announced-next-step (write_file, no read-then-stall) → 'medium'
      expect(lastChunk.metadata.confidence).toBe('medium');
    });

    it('should use [NEXT] prefix for single-write-silent signal', async () => {
      const chunks = [
        { content: 'Done.', isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/a.ts' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'pref-6');
      expect(results.length).toBe(chunks.length + 1);
      expect(lastChunk.content).toContain('[NEXT]');
      // single-write-silent (1 write, response < 80 chars) → 'medium'
      expect(lastChunk.metadata.confidence).toBe('medium');
    });
  });

  // ── Yield structure ─────────────────────────────────────────────────────

  describe('yield structure', () => {
    it('should include all required metadata fields in the auto-continue yield', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ];

      const { lastChunk } = await runThroughStream(chunks, 'meta-1');

      expect(lastChunk).toHaveProperty('content');
      expect(typeof lastChunk.content).toBe('string');
      expect(lastChunk).toHaveProperty('isComplete');
      expect(lastChunk.isComplete).toBe(false);
      expect(lastChunk).toHaveProperty('timestamp');
      expect(lastChunk).toHaveProperty('metadata');

      expect(lastChunk.metadata).toHaveProperty('autoContinue');
      expect(lastChunk.metadata.autoContinue).toBe(true);
      expect(lastChunk.metadata).toHaveProperty('reason');
      expect(lastChunk.metadata.reason).toBe('multi_factor_detection');
      expect(lastChunk.metadata).toHaveProperty('signals');
      expect(Array.isArray(lastChunk.metadata.signals)).toBe(true);
      expect(lastChunk.metadata.signals.length).toBeGreaterThanOrEqual(1);
      expect(lastChunk.metadata).toHaveProperty('confidence');
      // read-then-stall (read-only tool) → 'high'
      expect(lastChunk.metadata.confidence).toBe('high');
      expect(lastChunk.metadata).toHaveProperty('detectorReprompt');
      expect(typeof lastChunk.metadata.detectorReprompt).toBe('string');
      expect(lastChunk.metadata.detectorReprompt.length).toBeGreaterThan(0);
      expect(lastChunk.metadata).toHaveProperty('continuationCount');
      expect(typeof lastChunk.metadata.continuationCount).toBe('number');
      expect(lastChunk.metadata).toHaveProperty('maxContinuations');
      expect(typeof lastChunk.metadata.maxContinuations).toBe('number');
    });

    it('should include context snippet in [CONTINUE] yield for mid-sentence-cutoff', async () => {
      const chunks = [
        { content: 'The function does not handle the edge case correctly because',
          isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'bug' } }] },
        { isComplete: true },
      ];

      const { lastChunk } = await runThroughStream(chunks, 'ctx-1');
      expect(lastChunk.content).toContain('[CONTINUE]');
      expect(lastChunk.content).toContain('Last 200 characters');
      expect(lastChunk.content).toContain('handle the edge case');
    });

    it('should NOT include context snippet in [NEXT] yield for read-then-stall', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ];

      const { lastChunk } = await runThroughStream(chunks, 'ctx-2');
      expect(lastChunk.content).toContain('[NEXT]');
      expect(lastChunk.content).not.toContain('Last 200 characters');
    });

    it('should NOT include context snippet in [NEXT] yield for announced-next-step', async () => {
      const chunks = [
        { content: "I'll now search for the API endpoint.", isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/out.ts' } }] },
        { isComplete: true },
      ];

      const { lastChunk } = await runThroughStream(chunks, 'ctx-3');
      expect(lastChunk.content).toContain('[NEXT]');
      expect(lastChunk.content).not.toContain('Last 200 characters');
    });
  });

  // ── Reprompt content ─────────────────────────────────────────────────────

  describe('reprompt content', () => {
    it('should use the detector suggestedReprompt when available', async () => {
      const chunks = [
        { content: "I'll now update the file and commit the changes.", isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/out.ts' } }] },
        { isComplete: true },
      ];

      const { lastChunk } = await runThroughStream(chunks, 'rp-1');

      const expectedResult = buildExpectedDetectableResult(chunks);
      const direct = detectNeedsMoreTurns(expectedResult);

      expect(lastChunk.metadata.detectorReprompt).toBe(direct.suggestedReprompt);
      expect(lastChunk.content).toContain(direct.suggestedReprompt);
    });

    it('should fall back to generic reprompt when no specific suggestion exists', async () => {
      const chunks = [
        { content: 'Done.', isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/a.ts' } }] },
        { isComplete: true },
      ];

      const { lastChunk } = await runThroughStream(chunks, 'rp-2');

      const expectedResult = buildExpectedDetectableResult(chunks);
      const direct = detectNeedsMoreTurns(expectedResult);

      if (direct.suggestedReprompt) {
        expect(lastChunk.metadata.detectorReprompt).toBe(direct.suggestedReprompt);
      } else {
        expect(lastChunk.content).toMatch(/(\[CONTINUE\]|\[NEXT\])/);
      }
    });
  });

  // ── Multi-chunk streaming scenarios ──────────────────────────────────────

  describe('multi-chunk streaming scenarios', () => {
    it('should accumulate response text across multiple content chunks', async () => {
      const chunks = [
        { content: 'Step 1: grep for the issue. ', isComplete: false },
        { content: "I'll now fix the bug.", isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'multi-1');
      expect(results.length).toBe(chunks.length + 1);
      const signals = lastChunk.metadata.signals as string[];
      expect(signals).toContain('announced-next-step');
    });

    it('should handle toolCalls in non-final chunks before isComplete', async () => {
      const chunks = [
        { content: 'Searching... Found a match. Continuing with analysis...', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'find' } }] },
        { content: ' The result looks good.', isComplete: false },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'multi-2');
      expect(results.length).toBe(chunks.length + 1);
      const signals = lastChunk.metadata.signals as string[];
      expect(signals).toContain('read-then-stall');
    });

    it('should handle empty content chunks between meaningful ones', async () => {
      const chunks = [
        { content: '', isComplete: false },
        { content: '   ', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'TODO' } }] },
        { content: '' },
        { isComplete: true },
      ];

      const { results, lastChunk } = await runThroughStream(chunks, 'multi-3');
      expect(results.length).toBe(chunks.length + 1);
      const signals = lastChunk.metadata.signals as string[];
      expect(signals).toContain('read-then-stall');
    });
  });

  // ── Edge: signal-to-prefix mapping ───────────────────────────────────────

  describe('signal-to-prefix mapping', () => {
    it('should correctly identify all [CONTINUE] signals via direct call', async () => {
      const continueSignals = ['incomplete-thought', 'mid-sentence-cutoff', 'unclosed-code-block'];

      const chunks = [
        { content: 'The function does not handle the edge case correctly because',
          isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'bug' } }] },
        { isComplete: true },
      ];
      const expectedResult = buildExpectedDetectableResult(chunks);
      const direct = detectNeedsMoreTurns(expectedResult);

      const firedContinueSignals = direct.signals.filter(s => continueSignals.includes(s));
      expect(firedContinueSignals.length).toBeGreaterThanOrEqual(1);
      expect(firedContinueSignals).toContain('mid-sentence-cutoff');
    });

    it('should produce [CONTINUE] prefix for unclosed-code-block via stream', async () => {
      const chunksA = [
        { content: 'Here is the fix:\n```typescript\nconst x = 1;\n', isComplete: false },
        { toolCalls: [{ name: 'write_file', arguments: { path: '/src/a.ts' } }] },
        { isComplete: true },
      ];
      const { lastChunk: lastA } = await runThroughStream(chunksA, 'exh-1');
      expect(lastA.content).toContain('[CONTINUE]');

      const chunksB = [
        { content: 'The bug is on line 42 of the config file which', isComplete: false },
        { toolCalls: [{ name: 'grep', arguments: { pattern: 'bug' } }] },
        { isComplete: true },
      ];
      const { lastChunk: lastB } = await runThroughStream(chunksB, 'exh-2');
      expect(lastB.content).toContain('[CONTINUE]');
    });
  });
});
