/**
 * Behavioral vitest for `buildErrorFinalContent` — directly exercises
 * each branch of the SSE-stall discriminator WITHOUT React hook setup.
 *
 * Reference: Finding #1 SSE-stall discriminator. Companion to the
 * shape-lock vitest at
 * `__tests__/audit-recs/finding-1-stall-discriminator.test.ts`. The
 * shape-lock catches REFACTOR REGRESSIONS (someone dropping the
 * `eventData.isStall === true` read or the "Server timed out — please
 * try again." string), and this behavioral vitest catches BEHAVIORAL
 * REGRESSIONS in the disambiguator's 6 partitions — for example a
 * future engineer accidentally swapping the canRetry branches and
 * silently rendering the wrong suffix for the (canRetry:false,
 * !hadContent) corner of the table.
 *
 * Each partition's `finalContent` is pinned byte-exact (including the
 * Unicode arrows `⚠️` and the asymmetric italic-underscore styling) so a
 * future regression that drifts the copy trips THIS test.
 *
 * No mocks. No React. No DOM. Just the pure helper.
 */
import { describe, expect, it } from 'vitest';
import { buildErrorFinalContent } from '@/lib/chat/build-error-final-content';

// ─── Discriminator flag axes ─────────────────────────────────────────
// These lock the boolean/string outputs of the helper independent of the
// finalContent rendering. They cover the subtler semantics:
//   * `isStall === true` is STRICT (not truthy) — number 1 / string 'true'
//     must NOT trigger stall branding.
//   * `hadContent` is whitespace-trim — empty / whitespace-only content
//     is treated as no-streamed-content. (Observable via partition
//     selection; the field is no longer in the public bundle.)
//   * `canRetry` is forced false on stall (overrides canRetry:true input)
//     and is true on non-stall with canRetry:undefined by default.
//   * `errMsg` falls through on empty-string message + defaults on
//     both-missing.
describe('buildErrorFinalContent — discriminator flags', () => {
  describe('isStall — strict === true', () => {
    it('treats explicit true as a stall', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { isStall: true } });
      expect(r.isStall).toBe(true);
    });

    it('does NOT treat number 1 as a stall (strict === true, not truthy)', () => {
      // The SSR producer (route.ts emitSseError) emits `isStall: true`
      // only; number 1 is a wire-shape drift that MUST NOT trigger
      // stall branding. Without this guard, a future refactor that
      // drifts the producer's emitter would silently misbrand.
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { isStall: 1 as unknown as boolean } });
      expect(r.isStall).toBe(false);
    });

    it('does NOT treat string "true" as a stall', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { isStall: 'true' as unknown as boolean } });
      expect(r.isStall).toBe(false);
    });

    it('treats undefined as not a stall', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: {} });
      expect(r.isStall).toBe(false);
    });

    it('treats explicit false as not a stall', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { isStall: false } });
      expect(r.isStall).toBe(false);
    });
  });

  describe('hadContent — whitespace-trim (observable via finalContent partition selection)', () => {
    // hadContent is no longer in the public bundle (reviewer follow-up
    // #1 — drop unused surface noise) but its COMPUTATION still drives
    // branch selection in the helper. These tests pin the observable
    // effect: whitespace-only input falls into the "no content"
    // partition (renders the standalone warning instead of "prefix +
    // warning" suffix).
    it('empty string falls into the no-content partition (renders standalone "⚠️ _Server timed out…" without prefix)', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { isStall: true } });
      expect(r.finalContent).toBe('⚠️ _Server timed out — please try again._');
    });

    it('whitespace-only string falls into the no-content partition (matches empty-string behavior)', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '   \n  \t  ', eventData: { isStall: true } });
      // Same standalone rendering — pre-fix this would have produced
      // "   \\n  \\t  \\n\\n⚠️ _Server timed out…_" (visibly broken with
      // leading whitespace before the warning).
      expect(r.finalContent).toBe('⚠️ _Server timed out — please try again._');
    });

    it('non-empty string falls into the with-content partition (renders prefix + warning)', () => {
      const r = buildErrorFinalContent({ accumulatedContent: 'partial response', eventData: { isStall: true } });
      expect(r.finalContent).toBe('partial response\n\n⚠️ _Server timed out — please try again._');
    });
  });

  describe('canRetry — stall overrides; non-stall defaults true', () => {
    it('stall ALWAYS forces canRetry:false (overrides canRetry:true input)', () => {
      // Audit invariant: a stall MUST NOT auto-retry because the request
      // already timed out server-side. Event with canRetry:true input, a
      // stall overrides to false. Without this assertion, the user-facing
      // Retry button would re-trigger the same timeout.
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { isStall: true, canRetry: true } });
      expect(r.isStall).toBe(true);
      expect(r.canRetry).toBe(false);
    });

    it('non-stall with canRetry:undefined defaults to true (transient errors retryable)', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { message: 'transient' } });
      expect(r.canRetry).toBe(true);
    });

    it('non-stall with canRetry:true propagates', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { canRetry: true } });
      expect(r.canRetry).toBe(true);
    });

    it('non-stall with canRetry:false propagates', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { canRetry: false } });
      expect(r.canRetry).toBe(false);
    });
  });

  describe('errMsg — fallback chain message || error || default', () => {
    it('explicit message wins over error', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { message: 'm', error: 'e' } });
      expect(r.errMsg).toBe('m');
    });

    it('falls through to error when message is empty string', () => {
      // `message || error` — empty string is falsy so falls through.
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { message: '', error: 'e' } });
      expect(r.errMsg).toBe('e');
    });

    it('falls through to "Streaming error" when both are missing', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: {} });
      expect(r.errMsg).toBe('Streaming error');
    });

    it('falls through to "Streaming error" when both are explicitly undefined', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { message: undefined, error: undefined } });
      expect(r.errMsg).toBe('Streaming error');
    });
  });
});

// ─── finalContent rendering — 6 partitions of the disambiguator ─────
// Each partition is pinned byte-exact, including:
//   * Unicode arrows (`⚠️`)
//   * Markdown italic asymmetric styling (`_..._` only with content)
//   * Newline separator (`\n\n` only with content)
//   * The "Please retry your request." inline suffix (only on
//     non-stall + canRetry + no-content)
describe('buildErrorFinalContent — finalContent rendering (the 6 partitions)', () => {
  describe('isStall partitions', () => {
    it('part 1: stall + has content → prefix + "\\n\\n⚠️ _Server timed out — please try again._"', () => {
      const r = buildErrorFinalContent({
        accumulatedContent: 'partial streamed response',
        eventData: { isStall: true, message: 'whatever — not interpolated' },
      });
      expect(r.finalContent).toBe(
        'partial streamed response\n\n⚠️ _Server timed out — please try again._',
      );
    });

    it('part 2: stall + no content → "⚠️ _Server timed out — please try again._"', () => {
      const r = buildErrorFinalContent({ accumulatedContent: '', eventData: { isStall: true } });
      expect(r.finalContent).toBe('⚠️ _Server timed out — please try again._');
    });
  });

  describe('non-stall + canRetry partitions', () => {
    it('part 3: non-stall + canRetry + has content → prefix + "\\n\\n⚠️ _Stream interrupted: ${errMsg}. You can retry._" (italics + \\n\\n)', () => {
      const r = buildErrorFinalContent({
        accumulatedContent: 'already streamed',
        eventData: { error: 'connection reset', canRetry: true },
      });
      // errMsg resolves to "connection reset" (no message, so error wins).
      expect(r.finalContent).toBe(
        'already streamed\n\n⚠️ _Stream interrupted: connection reset. You can retry._',
      );
    });

    it('part 4: non-stall + canRetry + no content → "⚠️ ${errMsg} Please retry your request." (NO \\n\\n, NO underscores, inline suffix)', () => {
      // The asymmetry: WITHOUT content, no leading \n\n, no italic
      // underscores (italicizing the entire empty bubble looks wrong).
      // Plus the inline "Please retry your request." suffix.
      const r = buildErrorFinalContent({
        accumulatedContent: '',
        eventData: { error: 'connection reset', canRetry: true },
      });
      expect(r.finalContent).toBe('⚠️ connection reset Please retry your request.');
    });

    it('part 4 message-priority: non-stall + canRetry + no content with explicit message → message wins', () => {
      const r = buildErrorFinalContent({
        accumulatedContent: '',
        eventData: { message: 'rate-limited', error: 'connection reset', canRetry: true },
      });
      expect(r.finalContent).toBe('⚠️ rate-limited Please retry your request.');
    });
  });

  describe('non-stall + !canRetry partitions', () => {
    it('part 5: non-stall + !canRetry + has content → prefix + "\\n\\n⚠️ _${errMsg}_" (italics around errMsg)', () => {
      const r = buildErrorFinalContent({
        accumulatedContent: 'still streaming',
        eventData: { message: 'auth failure', canRetry: false },
      });
      expect(r.finalContent).toBe('still streaming\n\n⚠️ _auth failure_');
    });

    it('part 6: non-stall + !canRetry + no content → "⚠️ ${errMsg}" (NO suffix, NO italics)', () => {
      const r = buildErrorFinalContent({
        accumulatedContent: '',
        eventData: { message: 'auth failure', canRetry: false },
      });
      expect(r.finalContent).toBe('⚠️ auth failure');
    });
  });
});

// ─── Defensive defaults ─────────────────────────────────────────────
// `BuildErrorFinalContentInput` makes both (accumulatedContent,
// eventData) optional so the type contract self-documents the defensive
// defaults. These tests exercise the public surface WITHOUT bypass
// casts (`as unknown as ...` dropped — review follow-up #2).
describe('buildErrorFinalContent — defensive defaults', () => {
  it('handles missing eventData — falls into non-stall canRetry warning', () => {
    const r = buildErrorFinalContent({ accumulatedContent: '' });
    expect(r.isStall).toBe(false);
    expect(r.canRetry).toBe(true);
    expect(r.errMsg).toBe('Streaming error');
    expect(r.finalContent).toBe('⚠️ Streaming error Please retry your request.');
  });

  it('handles missing accumulatedContent — falls into non-stall canRetry warning', () => {
    const r = buildErrorFinalContent({ eventData: {} });
    expect(r.isStall).toBe(false);
    expect(r.canRetry).toBe(true);
    expect(r.errMsg).toBe('Streaming error');
    expect(r.finalContent).toBe('⚠️ Streaming error Please retry your request.');
  });

  it('handles missing BOTH fields — still produces a safe warning string (zero-arg)', () => {
    // The minimal possible call: zero-arg invocation. The optional
    // input fields in BuildErrorFinalContentInput let this compile.
    const r = buildErrorFinalContent();
    expect(r.isStall).toBe(false);
    expect(r.canRetry).toBe(true);
    expect(r.errMsg).toBe('Streaming error');
    expect(r.finalContent).toBe('⚠️ Streaming error Please retry your request.');
  });
});
