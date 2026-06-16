// Vitest smoke for the cross-file reuse surface landed by the Q2 cascade:
//   - PROMPT_SOURCE                 (export const)   discriminator values
//   - PromptSource                  (export type)    derived union via (typeof _)[keyof typeof _]
//   - stringOrNullToPromptSource    (helper, widened  string|null -> string|null|undefined)
//   - Q2_LIFT_REASON                (runtime anchor) refutes the rationale drifts claim
//   - makeSsePromptChunk            (shared factory) Q3 lift to web/lib/orchestra/sse-prompt-chunk.ts
//
// route.ts SSE-payload emitters import this contract so they no longer
// redefine the discriminator inline.

import { describe, expect, it } from 'vitest';
import {
  PROMPT_SOURCE,
  type PromptSource,
  stringOrNullToPromptSource,
  Q2_LIFT_REASON,
} from '@/lib/orchestra/unified-agent-service';
import { makeSsePromptChunk } from '@/lib/orchestra/sse-prompt-chunk';

describe('PROMPT_SOURCE discriminator (Q2 + Q3 cascade contract)', () => {
  it('PROMPT_SOURCE.OVERRIDE resolves to the literal "override"', () => {
    expect(PROMPT_SOURCE.OVERRIDE).toBe('override');
  });

  it('PROMPT_SOURCE.NO_OVERRIDE resolves to the literal "no-override"', () => {
    expect(PROMPT_SOURCE.NO_OVERRIDE).toBe('no-override');
  });

  it('PromptSource type is assignable from both enum members', () => {
    const a: PromptSource = PROMPT_SOURCE.OVERRIDE;
    const b: PromptSource = PROMPT_SOURCE.NO_OVERRIDE;
    expect([a, b]).toEqual([PROMPT_SOURCE.OVERRIDE, PROMPT_SOURCE.NO_OVERRIDE]);
  });

  it('Q2_LIFT_REASON runtime anchor pins the rationale so renaming cannot rot the comment', () => {
    expect(Q2_LIFT_REASON).toBe('SSE-payload discriminator reuse');
  });
});

describe('stringOrNullToPromptSource helper (Q2 widened from string|null to string|null|undefined)', () => {
  it('maps null to NO_OVERRIDE (caller skipped)', () => {
    const out: PromptSource = stringOrNullToPromptSource(null);
    expect(out).toBe(PROMPT_SOURCE.NO_OVERRIDE);
  });

  it('maps undefined to NO_OVERRIDE (Q2 widen; upstream pre-booking skip)', () => {
    const out: PromptSource = stringOrNullToPromptSource(undefined);
    expect(out).toBe(PROMPT_SOURCE.NO_OVERRIDE);
  });

  it('maps non-null string to OVERRIDE (caller requested)', () => {
    const out: PromptSource = stringOrNullToPromptSource('user prompt text');
    expect(out).toBe(PROMPT_SOURCE.OVERRIDE);
  });

  // Q7: ??-empty-string booking rule: caller pre-booked but ended up sending
  // empty string is still classified as OVERRIDE (caller-requested) because the
  // ??-default-to-empty already co-elevated the booking token.
  it('??-empty-string booking: maps "" (empty non-null) to OVERRIDE', () => {
    const out: PromptSource = stringOrNullToPromptSource('');
    expect(out).toBe(PROMPT_SOURCE.OVERRIDE);
  });
});

describe('SSE-payload emitter scenario (route.ts via shared makeSsePromptChunk factory)', () => {
  it('composedPrompt: string \u2192 emit chunk with composedPromptSource: OVERRIDE', () => {
    const composedPrompt: string | null = 'hello world';
    const composedPromptSource: PromptSource = stringOrNullToPromptSource(composedPrompt);
    const chunk = makeSsePromptChunk(composedPromptSource, composedPrompt);
    expect(chunk).toEqual({ type: 'prompt', source: 'override', content: 'hello world' });
  });

  it('composedPrompt: null \u2192 emit chunk with composedPromptSource: NO_OVERRIDE (audit trail distinct)', () => {
    const composedPrompt: string | null = null;
    const composedPromptSource: PromptSource = stringOrNullToPromptSource(composedPrompt);
    const chunk = makeSsePromptChunk(composedPromptSource, composedPrompt);
    expect(chunk).toEqual({ type: 'prompt', source: 'no-override', content: null });
  });
});
