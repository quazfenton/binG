/**
 * Auto-Continue Detector — Unit Tests
 *
 * Tests each of the 14 detection signals, edge cases, the reprompt builder,
 * the shouldAutoContinue wrapper, and all exported helper functions.
 */

import { describe, it, expect } from 'vitest';
import {
  detectNeedsMoreTurns,
  shouldAutoContinue,
  buildDetectedReprompt,
  buildAutoContinueReprompt,
  countConsecutiveFailures,
  countTrailingConsecutive,
  fingerprintSteps,
  countIdenticalFingerprints,
  type DetectableResult,
  type TurnDetectionResult,
} from '@/lib/chat/auto-continue-detector';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convenience factory: builds a minimal DetectableResult with the given fields. */
function makeResult(overrides: Partial<DetectableResult> & { steps: DetectableResult['steps'] }): DetectableResult {
  return {
    success: true,
    response: '',
    steps: [],
    fileEdits: [],
    ...overrides,
  };
}

/** Convenience factory: builds a single step with the given tool name, args, and result. */
function step(
  toolName: string,
  args: Record<string, any> = {},
  result: { success?: boolean; error?: string; output?: string } = { success: true },
) {
  return { toolName, args, result };
}

// ──────────────────────────────────────────────────────────────────────────
// FACTOR 1: TOOL-CALL PATTERNS
// ──────────────────────────────────────────────────────────────────────────

describe('detectNeedsMoreTurns — Factor 1: Tool-Call Patterns', () => {
  // ── Signal 1: read-then-stall ──────────────────────────────────────────
  describe('read-then-stall', () => {
    it('should fire when last tool is read-only and no writes occurred', () => {
      const result = makeResult({
        steps: [step('read_file', { path: '/src/index.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.needsMoreTurns).toBe(true);
      expect(detection.signals).toContain('read-then-stall');
      expect(detection.confidence).toBe('high');
    });

    it('should NOT fire when last tool is read-only but writes also occurred', () => {
      const result = makeResult({
        steps: [
          step('read_file', { path: '/src/index.ts' }),
          step('write_file', { path: '/src/index.ts' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('read-then-stall');
    });

    it('should NOT fire when last tool is a write tool', () => {
      const result = makeResult({
        steps: [step('write_file', { path: '/out.txt' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('read-then-stall');
    });

    it('should fire for any read-only tool variant (list_dir, grep, web_search)', () => {
      const result = makeResult({
        steps: [step('web_search', { query: 'latest news' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.needsMoreTurns).toBe(true);
      expect(detection.signals).toContain('read-then-stall');
    });
  });

  // ── Signal 2: deep-research-loop ──────────────────────────────────────
  describe('deep-research-loop', () => {
    it('should fire when 3+ consecutive read tools with no writes', () => {
      const result = makeResult({
        steps: [
          step('read_file', { path: '/src/a.ts' }),
          step('glob', { pattern: '**/*.ts' }),
          step('web_search', { query: 'react patterns' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.needsMoreTurns).toBe(true);
      expect(detection.signals).toContain('deep-research-loop');
      expect(detection.confidence).toBe('high');
    });

    it('should NOT fire for only 2 consecutive reads', () => {
      const result = makeResult({
        steps: [
          step('read_file', { path: '/src/a.ts' }),
          step('grep', { pattern: 'foo' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('deep-research-loop');
    });

    it('should NOT fire when writes occurred among the reads', () => {
      const result = makeResult({
        steps: [
          step('read_file', { path: '/src/a.ts' }),
          step('write_file', { path: '/src/a.ts' }),
          step('glob', { pattern: '**/*.ts' }),
          step('web_search', { query: 'react' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('deep-research-loop');
    });
  });

  // ── Signal 3: failure-cascade ──────────────────────────────────────────
  describe('failure-cascade', () => {
    it('should fire when 2+ tools failed consecutively', () => {
      const result = makeResult({
        steps: [
          step('write_file', {}, { success: false, error: 'permission denied' }),
          step('edit_file', {}, { success: false, error: 'file not found' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.needsMoreTurns).toBe(true);
      expect(detection.signals).toContain('failure-cascade');
      expect(detection.confidence).toBe('medium');
    });

    it('should NOT fire when only 1 tool failed', () => {
      const result = makeResult({
        steps: [
          step('read_file', {}, { success: true }),
          step('write_file', {}, { success: false, error: 'disk full' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('failure-cascade');
    });

    it('should NOT fire when failures are interleaved with successes', () => {
      const result = makeResult({
        steps: [
          step('write_file', {}, { success: false, error: 'failed' }),
          step('read_file', {}, { success: true }),
          step('write_file', {}, { success: false, error: 'failed' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('failure-cascade');
    });
  });

  // ── Signal 4: write-verify-loop ───────────────────────────────────────
  describe('write-verify-loop', () => {
    it('should fire when write_file is immediately followed by read_file on same path', () => {
      const result = makeResult({
        steps: [
          step('write_file', { path: '/src/app.ts' }),
          step('read_file', { path: '/src/app.ts' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.needsMoreTurns).toBe(true);
      expect(detection.signals).toContain('write-verify-loop');
      expect(detection.confidence).toBe('medium');
    });

    it('should NOT fire when the read is on a different path', () => {
      const result = makeResult({
        steps: [
          step('write_file', { path: '/src/app.ts' }),
          step('read_file', { path: '/src/utils.ts' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('write-verify-loop');
    });

    it('should handle filePath key for the written path', () => {
      const result = makeResult({
        steps: [
          step('str_replace', { filePath: 'src/main.ts' }),
          step('read_file', { path: 'src/main.ts' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('write-verify-loop');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// FACTOR 2: EXPLICIT CONTINUATION SIGNALS
// ──────────────────────────────────────────────────────────────────────────

describe('detectNeedsMoreTurns — Factor 2: Explicit Continuation Signals', () => {
  // ── Signal 5: announced-next-step ──────────────────────────────────────
  describe('announced-next-step', () => {
    it('should fire when response contains "I\'ll now" and is < 500 chars', () => {
      const result = makeResult({
        response: "I'll now check the error logs to find the issue.",
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('announced-next-step');
      expect(detection.confidence).toBe('high');
    });

    it('should fire for "Let me" pattern', () => {
      const result = makeResult({
        response: 'Let me search for the configuration file.',
        steps: [step('grep', { pattern: 'config' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('announced-next-step');
      expect(detection.confidence).toBe('high');
    });

    it('should fire for "I need to" pattern', () => {
      const result = makeResult({
        response: 'I need to update the import statements.',
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('announced-next-step');
      expect(detection.confidence).toBe('high');
    });

    it('should NOT fire when response >= 500 chars', () => {
      const result = makeResult({
        response: 'I need to ' + 'x'.repeat(490),
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('announced-next-step');
    });

    it('should NOT fire when there are no steps', () => {
      const result = makeResult({
        response: "I'll now fix the bug",
        steps: [],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('announced-next-step');
    });
  });

  // ── Signal 6: incomplete-thought ───────────────────────────────────────
  // NOTE: This signal delegates to detectIncompleteResponse from
  // @bing/shared/agent/feedback-injection. The test verifies the
  // integration — if the external module's heuristics change, this
  // may need updating.
  describe('incomplete-thought', () => {
    it('should fire when response has mid-sentence cutoff and unclosed code block (confidence > 0.5)', () => {
      // The detectIncompleteResponse function combines signals:
      // mid-sentence (+0.3) + unclosed code block (+0.4) = 0.7 > 0.5 threshold
      const result = makeResult({
        response: 'I found the bug in the config file\n```\nconst port = 8080',
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('incomplete-thought');
      expect(detection.confidence).toBe('high');
    });
  });

  // ── Signal 7: step-enumeration ─────────────────────────────────────────
  describe('step-enumeration', () => {
    it('should fire when last line is "Step 1:" with response < 300 chars', () => {
      const result = makeResult({
        response: 'Here is my plan:\nStep 1:',
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('step-enumeration');
      expect(detection.confidence).toBe('high');
    });

    it('should fire when last line is "First,"', () => {
      const result = makeResult({
        response: 'To fix this bug, I need to:\nFirst,',
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('step-enumeration');
    });

    it('should NOT fire when response >= 300 chars', () => {
      const result = makeResult({
        response: 'Step 1: ' + 'x'.repeat(295),
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('step-enumeration');
    });
  });

  // ── Signal 8: planned-multi-step ───────────────────────────────────────
  describe('planned-multi-step', () => {
    it('should fire when 2+ plan words found and no writes performed', () => {
      const result = makeResult({
        response: 'First, I will refactor the component. Then, I will update the tests.',
        steps: [step('grep', { pattern: 'component' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('planned-multi-step');
      expect(detection.confidence).toBe('high');
    });

    it('should NOT fire when writes were performed', () => {
      const result = makeResult({
        response: 'First I will refactor. Then I will test.',
        steps: [
          step('read_file', { path: '/src/a.ts' }),
          step('write_file', { path: '/src/b.ts' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('planned-multi-step');
    });

    it('should NOT fire with only 1 plan word', () => {
      const result = makeResult({
        response: 'I fixed the bug by updating the import statement.',
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('planned-multi-step');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// FACTOR 3: PARTIAL EDIT DETECTION
// ──────────────────────────────────────────────────────────────────────────

describe('detectNeedsMoreTurns — Factor 3: Partial Edit Detection', () => {
  // ── Signal 9: read-many-write-none ────────────────────────────────────
  describe('read-many-write-none', () => {
    it('should fire when 2+ reads and zero writes', () => {
      const result = makeResult({
        steps: [
          step('read_file', { path: '/src/a.ts' }),
          step('glob', { pattern: '**/*.ts' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('read-many-write-none');
      expect(detection.confidence).toBe('high');
    });

    it('should NOT fire with only 1 read', () => {
      const result = makeResult({
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('read-many-write-none');
    });

    it('should NOT fire when writes occurred', () => {
      const result = makeResult({
        steps: [
          step('read_file', { path: '/src/a.ts' }),
          step('read_file', { path: '/src/b.ts' }),
          step('write_file', { path: '/src/c.ts' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('read-many-write-none');
    });
  });

  // ── Signal 10: single-write-silent ─────────────────────────────────────
  describe('single-write-silent', () => {
    it('should fire when exactly 1 write, response < 80 chars, and <= 1 read', () => {
      const result = makeResult({
        response: 'Done.',
        steps: [step('write_file', { path: '/src/out.txt' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('single-write-silent');
      expect(detection.confidence).toBe('medium');
    });

    it('should NOT fire with response >= 80 chars', () => {
      const result = makeResult({
        response: 'I have successfully updated the file to fix the reported bug. The change was minimal and only affected one line.',
        steps: [step('write_file', { path: '/src/out.txt' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('single-write-silent');
    });

    it('should NOT fire with 2+ writes', () => {
      const result = makeResult({
        response: 'Done.',
        steps: [
          step('write_file', { path: '/src/a.ts' }),
          step('write_file', { path: '/src/b.ts' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('single-write-silent');
    });
  });

  // ── Signal 11: diff-no-explanation ─────────────────────────────────────
  describe('diff-no-explanation', () => {
    it('should fire when patch tool used and response < 100 chars', () => {
      const result = makeResult({
        response: 'Fixed.',
        steps: [step('str_replace', { path: '/src/app.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('diff-no-explanation');
      expect(detection.confidence).toBe('medium');
    });

    it('should fire for edit_file tool', () => {
      const result = makeResult({
        response: 'Done.',
        steps: [step('edit_file', { path: '/src/app.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('diff-no-explanation');
      expect(detection.confidence).toBe('medium');
    });

    it('should NOT fire with response >= 100 chars', () => {
      const result = makeResult({
        response: 'I applied the diff to fix the type error. The change replaces the any cast with a proper interface type.',
        steps: [step('str_replace', { path: '/src/app.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('diff-no-explanation');
    });

    it('should NOT fire for non-patch tools', () => {
      const result = makeResult({
        response: 'No.',
        steps: [step('write_file', { path: '/src/full.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('diff-no-explanation');
    });
  });

  // ── Signal 12: edits-mismatch ─────────────────────────────────────────
  describe('edits-mismatch', () => {
    it('should fire when fileEdits populated and response < 100 chars', () => {
      const result = makeResult({
        response: 'ok',
        steps: [step('write_file', { path: '/src/a.ts' })],
        fileEdits: [{ path: '/src/a.ts', content: 'console.log("hi");' }],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('edits-mismatch');
      expect(detection.confidence).toBe('medium');
    });

    it('should NOT fire when response >= 100 chars', () => {
      const result = makeResult({
        response: 'I have made the necessary changes to the file to fix the bug. Here is a detailed summary of everything that was modified and why.',
        steps: [step('write_file', { path: '/src/a.ts' })],
        fileEdits: [{ path: '/src/a.ts', content: 'console.log("hi");' }],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('edits-mismatch');
    });

    it('should NOT fire when fileEdits is empty', () => {
      const result = makeResult({
        response: 'ok',
        steps: [step('write_file', { path: '/src/a.ts' })],
        fileEdits: [],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('edits-mismatch');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// FACTOR 4: RESPONSE QUALITY
// ──────────────────────────────────────────────────────────────────────────

describe('detectNeedsMoreTurns — Factor 4: Response Quality', () => {
  // ── Signal 13: empty-after-tools ───────────────────────────────────────
  describe('empty-after-tools', () => {
    it('should fire when response < 100 chars after 2+ tool calls', () => {
      const result = makeResult({
        response: 'ok',
        steps: [
          step('grep', { pattern: 'foo' }),
          step('read_file', { path: '/src/a.ts' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('empty-after-tools');
      expect(detection.confidence).toBe('high');
    });

    it('should NOT fire with only 1 tool call', () => {
      const result = makeResult({
        response: 'ok',
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('empty-after-tools');
    });

    it('should NOT fire when response >= 100 chars', () => {
      const result = makeResult({
        response: 'x'.repeat(100),
        steps: [
          step('grep', { pattern: 'foo' }),
          step('read_file', { path: '/src/a.ts' }),
        ],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('empty-after-tools');
    });
  });

  // ── Signal 14: unclosed-code-block ─────────────────────────────────────
  describe('unclosed-code-block', () => {
    it('should fire when response has an unclosed ``` fence near the end', () => {
      const result = makeResult({
        response: 'Here is the fix:\n```typescript\nconst x = 1;\n',
        steps: [step('write_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('unclosed-code-block');
      // single-write-silent fires first (1 write, response < 80 chars) keeping confidence at 'medium'
      expect(detection.confidence).toBe('medium');
    });

    it('should NOT fire with properly closed fences', () => {
      const result = makeResult({
        response: 'Done:\n```ts\nconst x = 1;\n```',
        steps: [step('write_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('unclosed-code-block');
    });

    it('should NOT fire when the unclosed fence is far from the end (> 200 chars)', () => {
      const result = makeResult({
        response: '```typescript\nconst x = 1;\n' + 'x'.repeat(250),
        steps: [step('write_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('unclosed-code-block');
    });
  });

  // ── Signal (bonus): mid-sentence-cutoff ────────────────────────────────
  describe('mid-sentence-cutoff', () => {
    it('should fire when response ends without terminal punctuation (30 < len < 1000)', () => {
      const result = makeResult({
        response: 'The issue is that the function does not handle the edge case correctly because',
        steps: [step('read_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).toContain('mid-sentence-cutoff');
      expect(detection.confidence).toBe('high');
    });

    it('should NOT fire when response ends with a period', () => {
      const result = makeResult({
        response: 'The issue is fixed. The function now handles the edge case.',
        steps: [step('write_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('mid-sentence-cutoff');
    });

    it('should NOT fire for very short responses (<= 30 chars)', () => {
      const result = makeResult({
        response: 'Done',
        steps: [step('write_file', { path: '/src/a.ts' })],
      });
      const detection = detectNeedsMoreTurns(result);
      expect(detection.signals).not.toContain('mid-sentence-cutoff');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// EDGE CASES
// ──────────────────────────────────────────────────────────────────────────

describe('detectNeedsMoreTurns — Edge Cases', () => {
  it('should return needsMoreTurns: false when steps is empty', () => {
    const result = makeResult({ steps: [] });
    const detection = detectNeedsMoreTurns(result);
    expect(detection.needsMoreTurns).toBe(false);
    expect(detection.signals).toEqual([]);
    expect(detection.confidence).toBe('low');
  });

  it('should return needsMoreTurns: false when steps is undefined', () => {
    const result: DetectableResult = {
      success: true,
      response: 'hello',
      steps: undefined as any,
    };
    const detection = detectNeedsMoreTurns(result);
    expect(detection.needsMoreTurns).toBe(false);
    expect(detection.signals).toEqual([]);
  });

  it('should return needsMoreTurns: false when no signals fire', () => {
    const result = makeResult({
      response: 'Done. I have completed the task. Here is a summary of everything that was done and why each change was necessary for the fix.',
      steps: [step('write_file', { path: '/src/out.ts' })],
    });
    const detection = detectNeedsMoreTurns(result);
    expect(detection.needsMoreTurns).toBe(false);
    expect(detection.signals).toEqual([]);
    expect(detection.confidence).toBe('low');
  });

  it('should fire multiple signals simultaneously', () => {
    // read_file (read-only, no write) + short response < 100 + 2+ tools
    const result = makeResult({
      response: 'ok',
      steps: [
        step('read_file', { path: '/src/a.ts' }),
        step('glob', { pattern: '**/*.ts' }),
        step('web_search', { query: 'react' }),
      ],
    });
    const detection = detectNeedsMoreTurns(result);
    expect(detection.needsMoreTurns).toBe(true);
    // read-then-stall, deep-research-loop, read-many-write-none, empty-after-tools
    expect(detection.signals.length).toBeGreaterThanOrEqual(3);
    expect(detection.signals).toContain('read-then-stall');
    expect(detection.signals).toContain('empty-after-tools');
    expect(detection.signals).toContain('read-many-write-none');
  });

  it('should handle empty response string', () => {
    const result = makeResult({
      response: '',
      steps: [step('read_file', { path: '/src/a.ts' })],
    });
    const detection = detectNeedsMoreTurns(result);
    expect(detection.needsMoreTurns).toBe(true);
    expect(detection.signals).toContain('read-then-stall');
  });

  it('should handle response with only whitespace', () => {
    const result = makeResult({
      response: '   \n  \t  ',
      steps: [step('read_file', { path: '/src/a.ts' })],
    });
    const detection = detectNeedsMoreTurns(result);
    expect(detection.needsMoreTurns).toBe(true);
    expect(detection.signals).toContain('read-then-stall');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// REPROMPT BUILDER
// ──────────────────────────────────────────────────────────────────────────

describe('buildDetectedReprompt', () => {
  it('should return failure-cascade reprompt when that signal fires', () => {
    const reprompt = buildDetectedReprompt(
      ['failure-cascade', 'empty-after-tools'],
      ['write_file', 'edit_file'],
      4,
      step('edit_file', { path: '/src/a.ts' }),
    );
    expect(reprompt).toContain('Several tools failed');
    expect(reprompt).toContain('write_file');
    expect(reprompt).toContain('edit_file');
  });

  it('should return deep-research-loop reprompt when that signal fires', () => {
    const reprompt = buildDetectedReprompt(
      ['deep-research-loop'],
      [],
      5,
      step('web_search', { query: 'api' }),
    );
    expect(reprompt).toContain('STOP reading');
    expect(reprompt).toContain('5');
  });

  it('should return read-then-stall reprompt (takes priority over read-many-write-none)', () => {
    const reprompt = buildDetectedReprompt(
      ['read-then-stall', 'read-many-write-none'],
      [],
      2,
      step('read_file', { path: '/src/config.ts' }),
    );
    expect(reprompt).toContain('read /src/config.ts');
    expect(reprompt).toContain('take action');
  });

  it('should return read-many-write-none reprompt when read-then-stall is absent', () => {
    const reprompt = buildDetectedReprompt(
      ['read-many-write-none'],
      [],
      3,
      step('glob', { pattern: '**/*.ts' }),
    );
    expect(reprompt).toContain('read');
    expect(reprompt).toContain('take action');
  });

  it('should return unclosed-code-block reprompt', () => {
    const reprompt = buildDetectedReprompt(
      ['unclosed-code-block'],
      [],
      1,
      step('write_file', { path: '/src/a.ts' }),
    );
    expect(reprompt).toContain('cut off mid-code-block');
  });

  it('should return mid-sentence-cutoff reprompt', () => {
    const reprompt = buildDetectedReprompt(
      ['mid-sentence-cutoff'],
      [],
      1,
      step('read_file', { path: '/src/a.ts' }),
    );
    expect(reprompt).toContain('truncated mid-sentence');
  });

  it('should return write-verify-loop reprompt', () => {
    const reprompt = buildDetectedReprompt(
      ['write-verify-loop'],
      [],
      2,
      step('read_file', { path: '/src/app.ts' }),
    );
    expect(reprompt).toContain('verify your work');
    expect(reprompt).toContain('/src/app.ts');
  });

  it('should return announced-next-step reprompt', () => {
    const reprompt = buildDetectedReprompt(
      ['announced-next-step'],
      [],
      1,
      step('read_file', { path: '/src/a.ts' }),
    );
    expect(reprompt).toContain('outlined next steps');
  });

  it('should return planned-multi-step reprompt', () => {
    const reprompt = buildDetectedReprompt(
      ['planned-multi-step'],
      [],
      1,
      step('grep', { pattern: 'config' }),
    );
    expect(reprompt).toContain('outlined next steps');
  });

  it('should return diff-no-explanation reprompt', () => {
    const reprompt = buildDetectedReprompt(
      ['diff-no-explanation'],
      [],
      1,
      step('str_replace', { path: '/src/a.ts' }),
    );
    expect(reprompt).toContain('made file edits');
    expect(reprompt).toContain('Explain');
  });

  it('should return single-write-silent reprompt', () => {
    const reprompt = buildDetectedReprompt(
      ['single-write-silent'],
      [],
      1,
      step('write_file', { path: '/src/a.ts' }),
    );
    expect(reprompt).toContain('made file edits');
    expect(reprompt).toContain('Explain');
  });

  it('should return generic fallback for unknown signal combinations', () => {
    const reprompt = buildDetectedReprompt(
      ['step-enumeration', 'incomplete-thought'],
      [],
      2,
      step('read_file', { path: '/src/a.ts' }),
    );
    expect(reprompt).toContain('Continue from where you left off');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// shouldAutoContinue WRAPPER
// ──────────────────────────────────────────────────────────────────────────

describe('shouldAutoContinue', () => {
  it('should return true when detectNeedsMoreTurns fires', () => {
    const result = makeResult({
      steps: [step('read_file', { path: '/src/a.ts' })],
    });
    expect(shouldAutoContinue(result)).toBe(true);
  });

  it('should return false when no signals fire', () => {
    const result = makeResult({
      response: 'Done. I have completed the task and everything looks good. Here is a detailed explanation of the changes.',
      steps: [step('write_file', { path: '/src/out.ts' })],
    });
    expect(shouldAutoContinue(result)).toBe(false);
  });

  it('should return false for empty steps', () => {
    const result = makeResult({ steps: [] });
    expect(shouldAutoContinue(result)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildAutoContinueReprompt (manual fallback)
// ──────────────────────────────────────────────────────────────────────────

describe('buildAutoContinueReprompt', () => {
  it('should return read-then-act reprompt when last tool is read-only', () => {
    const reprompt = buildAutoContinueReprompt(
      makeResult({ steps: [step('read_file', { path: '/src/app.ts' })] }),
    );
    expect(reprompt).toContain('read');
    expect(reprompt).toContain('/src/app.ts');
  });

  it('should return failure reprompt when some tools failed', () => {
    const reprompt = buildAutoContinueReprompt(
      makeResult({
        steps: [
          step('write_file', {}, { success: false, error: 'disk full' }),
          step('write_file', {}, { success: true }),  // Last step is NOT read-only
        ],
      }),
    );
    expect(reprompt).toContain('Some tools failed');
    expect(reprompt).toContain('write_file');
  });

  it('should return generic reprompt as fallback', () => {
    const reprompt = buildAutoContinueReprompt(
      makeResult({
        response: 'Done.',
        steps: [step('write_file', { path: '/src/out.ts' })],
      }),
    );
    expect(reprompt).toContain('Continue from where you left off');
  });

  it('should handle empty steps gracefully', () => {
    const reprompt = buildAutoContinueReprompt(makeResult({ steps: [] }));
    expect(reprompt).toContain('Continue from where you left off');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

describe('countConsecutiveFailures', () => {
  it('should count trailing consecutive failures', () => {
    const steps = [
      { toolName: 'read_file', result: { success: true } },
      { toolName: 'write_file', result: { success: false, error: 'err' } },
      { toolName: 'edit_file', result: { success: false, error: 'err' } },
    ];
    expect(countConsecutiveFailures(steps)).toBe(2);
  });

  it('should return 0 when no failures', () => {
    const steps = [
      { toolName: 'read_file', result: { success: true } },
      { toolName: 'write_file', result: { success: true } },
    ];
    expect(countConsecutiveFailures(steps)).toBe(0);
  });

  it('should stop counting at the first success', () => {
    const steps = [
      { toolName: 'write_file', result: { success: false, error: 'err' } },
      { toolName: 'read_file', result: { success: true } },
      { toolName: 'edit_file', result: { success: false, error: 'err' } },
    ];
    expect(countConsecutiveFailures(steps)).toBe(1); // Only the last one is consecutively failing
  });

  it('should detect error by presence of error string', () => {
    const steps = [
      { toolName: 'write_file', result: { error: 'something went wrong' } },
    ];
    expect(countConsecutiveFailures(steps)).toBe(1);
  });
});

describe('countTrailingConsecutive', () => {
  it('should count trailing elements matching the predicate', () => {
    const steps = [
      { toolName: 'write_file', result: {} },
      { toolName: 'read_file', result: {} },
      { toolName: 'read_file', result: {} },
    ];
    const isRead = (s: { toolName: string }) => s.toolName === 'read_file';
    expect(countTrailingConsecutive(steps, isRead)).toBe(2);
  });

  it('should return 0 when the last element does not match', () => {
    const steps = [
      { toolName: 'read_file', result: {} },
      { toolName: 'write_file', result: {} },
    ];
    const isRead = (s: { toolName: string }) => s.toolName === 'read_file';
    expect(countTrailingConsecutive(steps, isRead)).toBe(0);
  });
});

describe('fingerprintSteps', () => {
  it('should create a stable fingerprint from tool names and args', () => {
    const steps = [
      { toolName: 'read_file', args: { path: '/a.ts' }, result: {} },
      { toolName: 'write_file', args: { path: '/b.ts' }, result: {} },
    ];
    const fp = fingerprintSteps(steps);
    expect(fp).toContain('read_file:');
    expect(fp).toContain('write_file:');
    expect(fp).toContain('/a.ts');
    expect(fp).toContain('/b.ts');
  });

  it('should produce the same fingerprint for identical steps', () => {
    const a = [{ toolName: 'read_file', args: { path: '/a.ts' }, result: {} }];
    const b = [{ toolName: 'read_file', args: { path: '/a.ts' }, result: {} }];
    expect(fingerprintSteps(a)).toBe(fingerprintSteps(b));
  });

  it('should produce different fingerprints for different steps', () => {
    const a = [{ toolName: 'read_file', args: { path: '/a.ts' }, result: {} }];
    const b = [{ toolName: 'read_file', args: { path: '/b.ts' }, result: {} }];
    expect(fingerprintSteps(a)).not.toBe(fingerprintSteps(b));
  });
});

describe('countIdenticalFingerprints', () => {
  it('should count how many consecutive fingerprints match the target from the end', () => {
    const fps = ['a', 'b', 'b', 'b'];
    expect(countIdenticalFingerprints(fps, 'b')).toBe(3);
  });

  it('should return 0 when the last fingerprint does not match', () => {
    const fps = ['a', 'b', 'a'];
    expect(countIdenticalFingerprints(fps, 'b')).toBe(0);
  });
});
