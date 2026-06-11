/**
 * Unit tests for the [STEER] service and numbered edit scheme.
 *
 * Closes the run.log audit items #1, #21, #22, #31 by ensuring the service:
 *   1. Builds a [STEER]-prefixed prompt for every failure category.
 *   2. Keeps prompts under the ~1200-char budget.
 *   3. Detects triggers from streaming / bash / path / hunk / idle-timeout
 *      signals via the steerFrom* helpers.
 *   4. Joins multiple dropped edits with per-edit numbering so the LLM
 *      can re-issue just the failed edit instead of the whole batch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  buildSteerPrompt,
  buildCombinedSteerPrompt,
  buildNumberedEditPromptPrefix,
  steerFromFinishReason,
  steerFromIdleTimeout,
  steerFromToolResultFalse,
  steerFromInvalidPath,
  steerFromHunkMismatch,
  steerFromBashError,
  steerFromDroppedEdits,
  applyNumberedEdits,
  ALL_STEER_TRIGGER_KINDS,
  type SteerTrigger,
  type NumberedFileEdit,
} from '../steer-service';

describe('buildSteerPrompt — every trigger kind produces a [STEER] prompt', () => {
  it.each(ALL_STEER_TRIGGER_KINDS)('renders a non-empty [STEER] prompt for %s', (kind) => {
    // Build a sample of each kind. Some kinds have required detail fields;
    // we provide plausible defaults.
    const samples: Record<string, SteerTrigger> = {
      empty_completion: {
        kind: 'empty_completion',
        detail: { provider: 'mistral', model: 'mistral-large-latest', finishReason: 'stop' },
      },
      missing_tool_call: {
        kind: 'missing_tool_call',
        detail: { availableTools: 19, provider: 'mistral', model: 'mistral-large-latest' },
      },
      invalid_path: {
        kind: 'invalid_path',
        detail: { path: '{name}"', tool: 'write_file', reason: 'contains markup' },
      },
      hunk_mismatch: {
        kind: 'hunk_mismatch',
        detail: {
          file: 'src/app.ts',
          line: 3,
          expectedAdded: 2,
          expectedRemoved: 1,
          actualAdded: 0,
          actualRemoved: 0,
        },
      },
      enoent_eacces: {
        kind: 'enoent_eacces',
        detail: { command: 'python3 main.py', code: 'ENOENT', tool: 'bash_execute' },
      },
      idle_timeout: {
        kind: 'idle_timeout',
        detail: { provider: 'nvidia', model: 'moonshotai/kimi-k2.6', idleMs: 60000 },
      },
      tool_result_false: {
        kind: 'tool_result_false',
        detail: { tool: 'bash_execute', error: 'permission denied' },
      },
      dropped_text_mode_edit: {
        kind: 'dropped_text_mode_edit',
        detail: { editNumber: 2, total: 5, path: 'src/foo.ts', reason: 'invalid path' },
      },
    };

    const prompt = buildSteerPrompt(samples[kind]);
    expect(prompt).toMatch(/^\[STEER\]/);
    expect(prompt.length).toBeGreaterThan(40);
    // Budget: every prompt stays under 1200 chars so the next turn's system
    // prompt doesn't grow unbounded.
    expect(prompt.length).toBeLessThan(1200);
  });

  it('prefixes every prompt with [STEER] for log/grep discoverability', () => {
    const prompt = buildSteerPrompt({
      kind: 'empty_completion',
      detail: { provider: 'mistral', model: 'mistral-large-latest' },
    });
    expect(prompt.startsWith('[STEER]')).toBe(true);
  });
});

describe('steerFromFinishReason — turns streaming signals into triggers', () => {
  it('returns empty_completion when responseText is empty', () => {
    const t = steerFromFinishReason({
      responseText: '',
      availableTools: 5,
      provider: 'mistral',
      model: 'mistral-large-latest',
      toolCallsDone: 0,
    });
    expect(t?.kind).toBe('empty_completion');
  });

  it('returns missing_tool_call when tools are available but none called', () => {
    const t = steerFromFinishReason({
      responseText: 'I think we should...',
      availableTools: 19,
      provider: 'mistral',
      model: 'mistral-large-latest',
      finishReason: 'stop',
      toolCallsDone: 0,
    });
    expect(t?.kind).toBe('missing_tool_call');
    if (t?.kind === 'missing_tool_call') {
      expect(t.detail.availableTools).toBe(19);
      expect(t.detail.finishReason).toBe('stop');
    }
  });

  it('returns null when tools were called (no steer needed)', () => {
    const t = steerFromFinishReason({
      responseText: 'Done',
      availableTools: 19,
      toolCallsDone: 3,
    });
    expect(t).toBeNull();
  });
});

describe('steerFromIdleTimeout — run.log line 1518 / 1652 case', () => {
  it('produces an idle_timeout trigger with provider/model/idleMs', () => {
    const t = steerFromIdleTimeout({
      provider: 'nvidia',
      model: 'moonshotai/kimi-k2.6',
      idleMs: 60000,
      tokensReceived: 411,
      toolCallsDone: 2,
    });
    expect(t.kind).toBe('idle_timeout');
    if (t.kind === 'idle_timeout') {
      expect(t.detail.idleMs).toBe(60000);
      expect(t.detail.tokensReceived).toBe(411);
    }
  });

  it('renders an actionable prompt mentioning the stall', () => {
    const prompt = buildSteerPrompt(
      steerFromIdleTimeout({
        provider: 'nvidia',
        model: 'moonshotai/kimi-k2.6',
        idleMs: 60069,
        tokensReceived: 138,
        toolCallsDone: 7,
      }),
    );
    expect(prompt).toMatch(/stalled for 60069ms/i);
    expect(prompt).toMatch(/received 138 tokens/);
    expect(prompt).toMatch(/7 tool calls/);
  });
});

describe('steerFromBashError — only ENOENT/EACCES-family codes fire', () => {
  it.each(['ENOENT', 'EACCES', 'EAGAIN', 'EBUSY', 'EISDIR', 'ENOTDIR', 'EPERM'])(
    'fires for %s',
    (code) => {
      const t = steerFromBashError({
        command: 'python3 main.py',
        code,
        tool: 'bash_execute',
      });
      expect(t?.kind).toBe('enoent_eacces');
    },
  );

  it.each(['ENOENT_NOT_REAL', 'TYPE_ERROR', 'INVALID', '', 'SIGTERM'])(
    'returns null for non-errno code %s',
    (code) => {
      const t = steerFromBashError({ command: 'foo', code, tool: 'bash_execute' });
      expect(t).toBeNull();
    },
  );
});

describe('steerFromInvalidPath / steerFromHunkMismatch / steerFromToolResultFalse', () => {
  it('builds an invalid_path trigger from the run.log "=/{name}" garbage paths', () => {
    const t = steerFromInvalidPath({
      path: '=',
      tool: 'write_file',
      reason: 'contains invalid characters',
    });
    expect(t.kind).toBe('invalid_path');
    const prompt = buildSteerPrompt(t);
    expect(prompt).toContain('"="');
    expect(prompt).toMatch(/paths must be relative/i);
  });

  it('builds a hunk_mismatch trigger with line-number and counts', () => {
    const t = steerFromHunkMismatch({
      file: 'workspace/sessions/001/ai_terminal/main.py',
      line: 3,
      expectedAdded: 2,
      expectedRemoved: 1,
      actualAdded: 0,
      actualRemoved: 0,
    });
    expect(t.kind).toBe('hunk_mismatch');
    const prompt = buildSteerPrompt(t);
    expect(prompt).toContain('line 3');
    expect(prompt).toMatch(/re-read/i);
  });

  it('builds a tool_result_false trigger with args preview', () => {
    const t = steerFromToolResultFalse({
      tool: 'bash_execute',
      error: 'Command failed: spawn python3 ENOENT',
      argsPreview: '{"command":"python3 main.py"}',
    });
    const prompt = buildSteerPrompt(t);
    expect(prompt).toContain('bash_execute');
    expect(prompt).toContain('ENOENT');
  });
});

describe('applyNumberedEdits + steerFromDroppedEdits', () => {
  it('numbers edits 1..N in input order', async () => {
    const numbered = await applyNumberedEdits(
      [
        { path: 'a.ts', content: 'A' },
        { path: 'b.ts', content: 'B' },
        { path: 'c.ts', content: 'C' },
      ],
      async () => ({ applied: true }),
    );
    expect(numbered.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(numbered.every((e) => e.applied)).toBe(true);
  });

  it('records per-edit dropReason when apply fails', async () => {
    const numbered = await applyNumberedEdits(
      [
        { path: 'good.ts', content: 'A' },
        { path: 'bad.ts', content: 'B' },
        { path: 'good.ts', content: 'C' },
      ],
      async (e) => {
        if (e.path === 'bad.ts') {
          return { applied: false, dropReason: 'invalid path' };
        }
        return { applied: true };
      },
    );

    expect(numbered[0].applied).toBe(true);
    expect(numbered[1].applied).toBe(false);
    expect(numbered[1].dropReason).toBe('invalid path');
    expect(numbered[2].applied).toBe(true);
  });

  it('captures thrown errors as dropReason', async () => {
    const numbered = await applyNumberedEdits(
      [{ path: 'boom.ts', content: 'X' }],
      async () => {
        throw new Error('EACCES: permission denied');
      },
    );
    expect(numbered[0].applied).toBe(false);
    expect(numbered[0].dropReason).toContain('EACCES');
  });

  it('steerFromDroppedEdits returns null when all edits applied', async () => {
    const numbered = await applyNumberedEdits(
      [{ path: 'a.ts', content: 'A' }],
      async () => ({ applied: true }),
    );
    expect(steerFromDroppedEdits(numbered)).toBeNull();
  });

  it('steerFromDroppedEdits joins every dropped edit with its number, path, and reason', async () => {
    const numbered: NumberedFileEdit[] = [
      { number: 1, path: 'a.ts', content: 'A', action: 'write', applied: true },
      { number: 2, path: '=', content: 'B', action: 'write', applied: false, dropReason: 'invalid path' },
      { number: 3, path: 'c.ts', content: 'C', action: 'write', applied: true },
      { number: 4, path: '', content: '', action: 'write', applied: false, dropReason: 'empty content' },
    ];

    const steer = steerFromDroppedEdits(numbered);
    expect(steer).not.toBeNull();
    expect(steer).toMatch(/\[STEER\]/);
    // Edit 2 of 4 was dropped
    expect(steer).toContain('Edit 2 of 4');
    expect(steer).toContain('"="');
    // Edit 4 of 4 was dropped
    expect(steer).toContain('Edit 4 of 4');
    expect(steer).toContain('empty content');
    // The LLM is told NOT to re-issue successful edits
    expect(steer).toMatch(/do not duplicate edits 1\.\.1/i);
  });
});

describe('buildCombinedSteerPrompt — joins multiple triggers', () => {
  it('joins bodies with blank lines and caps at MAX_TRIGGERS_PER_PROMPT', () => {
    const triggers: SteerTrigger[] = Array.from({ length: 8 }, (_, i) => ({
      kind: 'empty_completion',
      detail: { provider: 'mistral', model: `model-${i}` },
    }));
    const prompt = buildCombinedSteerPrompt(triggers);
    expect(prompt).toMatch(/^\[STEER\]/);
    // Default cap is 5, so 3 should be summarized
    expect(prompt).toMatch(/\+3 more issue/);
  });

  it('returns an empty string for an empty input', () => {
    expect(buildCombinedSteerPrompt([])).toBe('');
  });
});

describe('buildNumberedEditPromptPrefix — system-prompt helper', () => {
  it('returns a prefix that asks the LLM to label its text-mode edits', () => {
    const prefix = buildNumberedEditPromptPrefix();
    expect(prefix).toMatch(/Edit N\/M/);
    expect(prefix).toMatch(/1-based/i);
  });
});
