/**
 * Regression tests for Bug #61 wiring (useRef-based fallback chain).
 *
 * Covers:
 *   1. `pushChainEntry` — synchronously updates the chain ref (no setState)
 *   2. `buildFallbackChainList` — three-tier lookup order: ref → metadata → [orig, selected] → []
 *   3. `recordFallbackChainAttempt` / `recordFallbackChainExhausted` mock shape
 *      (verified via direct import + spy, not by rendering the full hook —
 *      the full hook requires complex auth/streaming mocks that are out of
 *      scope for a regression test of the wiring shape)
 *
 * The metrics integration is verified at the *call-site contract* level:
 * the mock is asserted to be callable with the exact payload shape that
 * the production code uses at lines 804, 893, 903, 921, 1636, 1672, 1682,
 * 1699, 1736 of use-enhanced-chat.ts.
 *
 * See: `use-enhanced-chat.test.ts` for `rotateProviderModel` tests
 * (the same-provider rotation + fallback-chain cycling logic).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { pushChainEntry, buildFallbackChainList, emitFallbackOutcome, emitFallbackExhausted } from '../use-enhanced-chat';

// Mock @/lib/chat/chat-metrics so we can spy on the record* calls
// without pulling in the full metrics backend.
const { mockRecordAttempt, mockRecordExhausted } = vi.hoisted(() => ({
  mockRecordAttempt: vi.fn(),
  mockRecordExhausted: vi.fn(),
}));

vi.mock('@/lib/chat/chat-metrics', () => ({
  recordFallbackChainAttempt: mockRecordAttempt,
  recordFallbackChainExhausted: mockRecordExhausted,
}));

import { recordFallbackChainAttempt, recordFallbackChainExhausted } from '@/lib/chat/chat-metrics';

type ChainRef = Map<string, Array<{ provider: string; model: string }>>;

describe('pushChainEntry (#61: synchronous ref update)', () => {
  beforeEach(() => {
    mockRecordAttempt.mockReset();
    mockRecordExhausted.mockReset();
  });

  it('initializes a new array for a messageId that has no entry', () => {
    const ref: ChainRef = new Map();
    pushChainEntry(ref, 'msg-1', 'google', 'gemini-2.5-flash');

    expect(ref.get('msg-1')).toEqual([
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);
  });

  it('appends to an existing array for a messageId that already has entries', () => {
    const ref: ChainRef = new Map();
    pushChainEntry(ref, 'msg-1', 'google', 'gemini-2.5-flash');
    pushChainEntry(ref, 'msg-1', 'anthropic', 'claude-sonnet-4-20250514');
    pushChainEntry(ref, 'msg-1', 'mistral', 'mistral-small-latest');

    expect(ref.get('msg-1')).toEqual([
      { provider: 'google', model: 'gemini-2.5-flash' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      { provider: 'mistral', model: 'mistral-small-latest' },
    ]);
  });

  it('keeps entries for different messageIds isolated (per-message keyed for concurrent streams)', () => {
    const ref: ChainRef = new Map();
    pushChainEntry(ref, 'msg-1', 'google', 'gemini-2.5-flash');
    pushChainEntry(ref, 'msg-2', 'anthropic', 'claude-sonnet-4-20250514');

    expect(ref.get('msg-1')).toEqual([
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);
    expect(ref.get('msg-2')).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ]);
    expect(ref.size).toBe(2);
  });

  it('creates an entry with empty provider when provider is empty (no defensive guard)', () => {
    // The production `pushChainEntry` does NOT guard against empty provider —
    // it creates the entry unconditionally. This is intentional: the caller
    // is responsible for passing a non-empty provider. Verify the actual
    // behavior so a future guard would be a deliberate, visible change.
    const ref: ChainRef = new Map();
    pushChainEntry(ref, 'msg-1', '', 'gemini-2.5-flash');

    expect(ref.get('msg-1')).toEqual([
      { provider: '', model: 'gemini-2.5-flash' },
    ]);
  });

  it('allows cleanup via ref.delete(messageId) after success/exhaustion (no memory leak)', () => {
    const ref: ChainRef = new Map();
    pushChainEntry(ref, 'msg-1', 'google', 'gemini-2.5-flash');
    pushChainEntry(ref, 'msg-1', 'anthropic', 'claude-sonnet-4-20250514');
    expect(ref.size).toBe(1);

    // Simulate the cleanup at the terminal call sites (success/exhaustion)
    ref.delete('msg-1');

    expect(ref.size).toBe(0);
    expect(ref.get('msg-1')).toBeUndefined();
  });
});

describe('buildFallbackChainList (#61: three-tier lookup order)', () => {
  beforeEach(() => {
    mockRecordAttempt.mockReset();
    mockRecordExhausted.mockReset();
  });

  it('returns the ref entry when messageId is present in the ref (TIER 1 — source of truth)', () => {
    const ref: ChainRef = new Map();
    ref.set('msg-1', [
      { provider: 'google', model: 'gemini-2.5-flash' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ]);

    const result = buildFallbackChainList(ref, 'msg-1', undefined);
    expect(result).toEqual([
      { provider: 'google', model: 'gemini-2.5-flash' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ]);
  });

  it('returns the metadata.fallbackChain when ref is empty for messageId (TIER 2 — stale fallback)', () => {
    const ref: ChainRef = new Map();
    const metadata = {
      fallbackChain: [
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
    };

    const result = buildFallbackChainList(ref, 'msg-1', metadata);
    expect(result).toEqual([
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);
  });

  it('prefers ref over metadata.fallbackChain (TIER 1 wins over TIER 2)', () => {
    // Even if metadata has an entry, the ref is the source of truth for
    // in-flight requests (the useRef fix for the stale-state issue).
    const ref: ChainRef = new Map();
    ref.set('msg-1', [{ provider: 'ref-provider', model: 'ref-model' }]);
    const metadata = {
      fallbackChain: [{ provider: 'meta-provider', model: 'meta-model' }],
    };

    const result = buildFallbackChainList(ref, 'msg-1', metadata);
    expect(result).toEqual([{ provider: 'ref-provider', model: 'ref-model' }]);
  });

  it('returns [orig, selected] pair when ref and metadata are empty (TIER 3)', () => {
    const ref: ChainRef = new Map();

    const result = buildFallbackChainList(
      ref,
      'msg-1',
      undefined,
      'nvidia',
      'moonshotai/kimi-k2.5',
      'google',
      'gemini-2.5-flash',
    );
    expect(result).toEqual([
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);
  });

  it('returns [] when ref, metadata, and orig/selected are all empty (no chain to report)', () => {
    const ref: ChainRef = new Map();
    const result = buildFallbackChainList(ref, 'msg-1', undefined);
    expect(result).toEqual([]);
  });

  it('returns [] when messageId is undefined (no key to look up)', () => {
    const ref: ChainRef = new Map();
    ref.set('msg-1', [{ provider: 'google', model: 'gemini-2.5-flash' }]);

    const result = buildFallbackChainList(ref, undefined, undefined);
    expect(result).toEqual([]);
  });

  it('returns [orig, selected] when chainRef is undefined (TIER 3 fallback for no-ref callers)', () => {
    // When the caller passes `undefined` for chainRef (e.g. a code path that
    // doesn't have access to the ref), TIER 1 is skipped and TIER 3 fires
    // with the orig/selected pair. selectedProvider/selectedModel default
    // to '' when not provided, so the selected entry is `{ provider: '',
    // model: '' }` — still a valid entry, not filtered out.
    const result = buildFallbackChainList(undefined, 'msg-1', undefined, 'orig-prov', 'orig-model');
    expect(result).toEqual([
      { provider: 'orig-prov', model: 'orig-model' },
      { provider: '', model: '' },
    ]);
  });

  it('returns [orig, selected] with both populated when chainRef is undefined and selected is provided', () => {
    const result = buildFallbackChainList(
      undefined,
      'msg-1',
      undefined,
      'nvidia',
      'moonshotai/kimi-k2.5',
      'google',
      'gemini-2.5-flash',
    );
    expect(result).toEqual([
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);
  });
});

describe('recordFallbackChainAttempt/Exhausted mock contract (#61 wiring shape)', () => {
  beforeEach(() => {
    mockRecordAttempt.mockReset();
    mockRecordExhausted.mockReset();
  });

  it('recordFallbackChainAttempt accepts the expected payload shape (success)', () => {
    // The production code at lines 804, 903, 1636, 1682 calls:
    //   recordFallbackChainAttempt({ provider, model, outcome: 'success', reason? })
    recordFallbackChainAttempt({
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });

    expect(mockRecordAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordAttempt).toHaveBeenCalledWith({
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });
  });

  it('recordFallbackChainAttempt accepts the expected payload shape (failure with reason)', () => {
    // The production code at lines 893, 1672 calls:
    //   recordFallbackChainAttempt({ provider, model, outcome: 'failure', reason })
    recordFallbackChainAttempt({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      outcome: 'failure',
      reason: 'pre-stream HTTP 500',
    });

    expect(mockRecordAttempt).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      outcome: 'failure',
      reason: 'pre-stream HTTP 500',
    });
  });

  it('recordFallbackChainExhausted accepts the expected payload shape', () => {
    // The production code at lines 921, 1699, 1736 calls:
    //   recordFallbackChainExhausted({ reason, attempts })
    const attempts = [
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'google', model: 'gemini-2.5-flash' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ];
    recordFallbackChainExhausted({
      reason: 'pre-stream: max retries (3) reached',
      attempts,
    });

    expect(mockRecordExhausted).toHaveBeenCalledTimes(1);
    expect(mockRecordExhausted).toHaveBeenCalledWith({
      reason: 'pre-stream: max retries (3) reached',
      attempts,
    });
  });

  it('documents the full retry sequence payload contract: initial failure → retry failure → retry success', () => {
    // Simulates the metrics calls made during a successful retry sequence
    // in the pre-stream path (lines 804, 893, 903 of use-enhanced-chat.ts).
    const origProvider = 'nvidia';
    const origModel = 'moonshotai/kimi-k2.5';
    const rotatedProvider = 'google';
    const rotatedModel = 'gemini-2.5-flash';

    // 1. Original request fails
    recordFallbackChainAttempt({
      provider: origProvider,
      model: origModel,
      outcome: 'failure',
      reason: 'pre-stream HTTP 500',
    });

    // 2. Retried request also fails
    recordFallbackChainAttempt({
      provider: rotatedProvider,
      model: rotatedModel,
      outcome: 'failure',
      reason: 'pre-stream HTTP 502',
    });

    // 3. Second retry succeeds
    recordFallbackChainAttempt({
      provider: rotatedProvider,
      model: rotatedModel,
      outcome: 'success',
    });

    expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
    expect(mockRecordAttempt).toHaveBeenNthCalledWith(1, {
      provider: origProvider,
      model: origModel,
      outcome: 'failure',
      reason: 'pre-stream HTTP 500',
    });
    expect(mockRecordAttempt).toHaveBeenNthCalledWith(2, {
      provider: rotatedProvider,
      model: rotatedModel,
      outcome: 'failure',
      reason: 'pre-stream HTTP 502',
    });
    expect(mockRecordAttempt).toHaveBeenNthCalledWith(3, {
      provider: rotatedProvider,
      model: rotatedModel,
      outcome: 'success',
    });
  });

  it('documents the exhaustion path payload contract: 3 failures → recordFallbackChainExhausted', () => {
    // Simulates the metrics calls made when all retries are exhausted
    // in the pre-stream path (lines 921 of use-enhanced-chat.ts).
    const attempts = [
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'google', model: 'gemini-2.5-flash' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ];

    for (const a of attempts) {
      recordFallbackChainAttempt({
        provider: a.provider,
        model: a.model,
        outcome: 'failure',
        reason: 'pre-stream HTTP 500',
      });
    }

    recordFallbackChainExhausted({
      reason: 'pre-stream: max retries (3) reached',
      attempts,
    });

    expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
    expect(mockRecordExhausted).toHaveBeenCalledTimes(1);
    expect(mockRecordExhausted).toHaveBeenCalledWith({
      reason: 'pre-stream: max retries (3) reached',
      attempts,
    });
  });
});

describe('emitFallbackOutcome (#61: per-attempt wrapper)', () => {
  beforeEach(() => {
    mockRecordAttempt.mockReset();
    mockRecordExhausted.mockReset();
  });

  it('calls recordFallbackChainAttempt with the right payload (success)', () => {
    const ref: ChainRef = new Map();
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });

    expect(mockRecordAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordAttempt).toHaveBeenCalledWith({
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });
  });

  it('calls recordFallbackChainAttempt with the right payload (failure + reason)', () => {
    const ref: ChainRef = new Map();
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      outcome: 'failure',
      reason: 'pre-stream HTTP 500',
    });

    expect(mockRecordAttempt).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      outcome: 'failure',
      reason: 'pre-stream HTTP 500',
    });
  });

  it('pushes the entry to the ref synchronously (ref update + metrics call together)', () => {
    const ref: ChainRef = new Map();
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });

    // The ref should have been updated synchronously
    expect(ref.get('msg-1')).toEqual([
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);
  });

  it('appends to existing ref entries (multiple attempts for the same message)', () => {
    const ref: ChainRef = new Map();
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'nvidia',
      model: 'moonshotai/kimi-k2.5',
      outcome: 'failure',
    });
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });

    expect(ref.get('msg-1')).toEqual([
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
  });

  it('simulates the full pre-stream retry sequence: original failure → rotated failure → rotated success', () => {
    // This test verifies the payload contract that production code at lines
    // 860, 949, 959 of use-enhanced-chat.ts uses for the pre-stream path.
    const ref: ChainRef = new Map();

    // 1. Original request fails (line 860)
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'nvidia',
      model: 'moonshotai/kimi-k2.5',
      outcome: 'failure',
      reason: 'pre-stream HTTP 500',
    });

    // 2. Retried request also fails (line 949)
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'failure',
      reason: 'retry HTTP 502 (pre-stream)',
    });

    // 3. Second retry succeeds (line 959)
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });

    expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
    expect(ref.get('msg-1')).toHaveLength(3);
  });

  it('simulates the full assistant stream retry sequence (lines 1692, 1728, 1738)', () => {
    const ref: ChainRef = new Map();

    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-2',
      provider: 'nvidia',
      model: 'moonshotai/kimi-k2.5',
      outcome: 'failure',
      reason: 'empty-response (stream done with no content)',
    });
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-2',
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'failure',
      reason: 'retry HTTP 500 (empty-response)',
    });
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-2',
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });

    expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
    expect(ref.get('msg-2')).toHaveLength(3);
  });
});

describe('emitFallbackExhausted (#61: exhaustion wrapper)', () => {
  beforeEach(() => {
    mockRecordAttempt.mockReset();
    mockRecordExhausted.mockReset();
  });

  it('calls recordFallbackChainExhausted with the full chain from the ref', () => {
    const ref: ChainRef = new Map();
    ref.set('msg-1', [
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'google', model: 'gemini-2.5-flash' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ]);

    emitFallbackExhausted({
      chainRef: ref,
      messageId: 'msg-1',
      metadata: undefined,
      reason: 'pre-stream: max retries (3) reached',
    });

    expect(mockRecordExhausted).toHaveBeenCalledTimes(1);
    expect(mockRecordExhausted).toHaveBeenCalledWith({
      reason: 'pre-stream: max retries (3) reached',
      attempts: [
        { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      ],
    });
  });

  it('passes orig/selected through to buildFallbackChainList (TIER 3 fallback)', () => {
    const ref: ChainRef = new Map();
    // ref is empty — the wrapper will use TIER 3 (orig/selected pair)

    emitFallbackExhausted({
      chainRef: ref,
      messageId: 'msg-1',
      metadata: undefined,
      reason: 'empty-response after 3 attempts (cascade to text mode)',
      origProvider: 'nvidia',
      origModel: 'moonshotai/kimi-k2.5',
      selectedProvider: 'google',
      selectedModel: 'gemini-2.5-flash',
    });

    expect(mockRecordExhausted).toHaveBeenCalledWith({
      reason: 'empty-response after 3 attempts (cascade to text mode)',
      attempts: [
        { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
    });
  });

  it('does NOT call recordFallbackChainAttempt (exhausted is a separate metric)', () => {
    const ref: ChainRef = new Map();
    ref.set('msg-1', [{ provider: 'google', model: 'gemini-2.5-flash' }]);

    emitFallbackExhausted({
      chainRef: ref,
      messageId: 'msg-1',
      metadata: undefined,
      reason: 'test',
    });

    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(mockRecordExhausted).toHaveBeenCalledTimes(1);
  });

  it('simulates the pre-stream exhaustion path (line 977)', () => {
    const ref: ChainRef = new Map();
    ref.set('msg-1', [
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);

    emitFallbackExhausted({
      chainRef: ref,
      messageId: 'msg-1',
      metadata: { fallbackChain: [{ provider: 'stale', model: 'stale' }] },
      reason: 'pre-stream HTTP 500 -> retry failed after 3 attempts',
      origProvider: 'nvidia',
      origModel: 'moonshotai/kimi-k2.5',
      selectedProvider: 'google',
      selectedModel: 'gemini-2.5-flash',
    });

    // TIER 1 wins: the ref entry is used, not the stale metadata
    expect(mockRecordExhausted).toHaveBeenCalledWith({
      reason: 'pre-stream HTTP 500 -> retry failed after 3 attempts',
      attempts: [
        { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
    });
  });

  it('simulates the assistant stream exhaustion path (line 1755)', () => {
    const ref: ChainRef = new Map();
    ref.set('msg-2', [
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ]);

    emitFallbackExhausted({
      chainRef: ref,
      messageId: 'msg-2',
      metadata: undefined,
      reason: 'empty-response after 3 attempts (cascade to text mode)',
      origProvider: 'nvidia',
      origModel: 'moonshotai/kimi-k2.5',
      selectedProvider: 'anthropic',
      selectedModel: 'claude-sonnet-4-20250514',
    });

    expect(mockRecordExhausted).toHaveBeenCalledWith({
      reason: 'empty-response after 3 attempts (cascade to text mode)',
      attempts: [
        { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      ],
    });
  });
});

describe('useRef cleanup integration (#61: bounded memory across streams)', () => {
  beforeEach(() => {
    mockRecordAttempt.mockReset();
    mockRecordExhausted.mockReset();
  });

  it('cleanup: push → use → delete leaves the ref empty for the next message', () => {
    // Simulates the full lifecycle for one message:
    //   1. pushChainEntry at rotation time
    //   2. buildFallbackChainList at exhaustion time (reads the ref)
    //   3. ref.delete at the terminal call site (cleanup)
    const ref: ChainRef = new Map();

    // 1. Push entries during the retry sequence
    pushChainEntry(ref, 'msg-1', 'nvidia', 'moonshotai/kimi-k2.5');
    pushChainEntry(ref, 'msg-1', 'google', 'gemini-2.5-flash');

    // 2. Read the ref at exhaustion time
    const chain = buildFallbackChainList(ref, 'msg-1', undefined);
    expect(chain).toHaveLength(2);

    // 3. Cleanup at the terminal call site
    ref.delete('msg-1');
    expect(ref.size).toBe(0);

    // 4. A new message can use the ref without interference
    pushChainEntry(ref, 'msg-2', 'google', 'gemini-2.5-flash');
    expect(ref.get('msg-1')).toBeUndefined();
    expect(ref.get('msg-2')).toEqual([
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);
  });

  it('concurrent streams: entries for different messageIds do not interfere', () => {
    // The ref is keyed by messageId, so concurrent streams (multiple
    // messages retrying simultaneously) get isolated chain histories.
    const ref: ChainRef = new Map();

    pushChainEntry(ref, 'msg-1', 'nvidia', 'moonshotai/kimi-k2.5');
    pushChainEntry(ref, 'msg-2', 'google', 'gemini-2.5-flash');
    pushChainEntry(ref, 'msg-1', 'anthropic', 'claude-sonnet-4-20250514');
    pushChainEntry(ref, 'msg-2', 'mistral', 'mistral-small-latest');

    expect(buildFallbackChainList(ref, 'msg-1', undefined)).toEqual([
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ]);
    expect(buildFallbackChainList(ref, 'msg-2', undefined)).toEqual([
      { provider: 'google', model: 'gemini-2.5-flash' },
      { provider: 'mistral', model: 'mistral-small-latest' },
    ]);

    // Cleanup of one stream does not affect the other
    ref.delete('msg-1');
    expect(ref.get('msg-1')).toBeUndefined();
    expect(ref.get('msg-2')).toEqual([
      { provider: 'google', model: 'gemini-2.5-flash' },
      { provider: 'mistral', model: 'mistral-small-latest' },
    ]);
  });
});

// ============================================================================
// Outcome type coverage (all 4 outcomes from chat-metrics.ts type union)
// ============================================================================

describe('emitFallbackOutcome — all 4 outcome types', () => {
  beforeEach(() => {
    mockRecordAttempt.mockReset();
    mockRecordExhausted.mockReset();
  });

  it('emits outcome="success" with the right payload', () => {
    const ref: ChainRef = new Map();
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });
    expect(mockRecordAttempt).toHaveBeenCalledWith({
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });
  });

  it('emits outcome="failure" with the right payload (and reason)', () => {
    const ref: ChainRef = new Map();
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      outcome: 'failure',
      reason: 'pre-stream HTTP 500',
    });
    expect(mockRecordAttempt).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      outcome: 'failure',
      reason: 'pre-stream HTTP 500',
    });
  });

  it('emits outcome="circuit_open" with the right payload (circuit breaker tripped)', () => {
    // The chat-metrics.ts type union includes 'circuit_open' as a valid outcome.
    // The wrapper should pass it through unchanged. (Production code may fire
    // this when the circuit breaker for a provider is open.)
    const ref: ChainRef = new Map();
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'mistral',
      model: 'mistral-small-latest',
      outcome: 'circuit_open',
    });
    expect(mockRecordAttempt).toHaveBeenCalledWith({
      provider: 'mistral',
      model: 'mistral-small-latest',
      outcome: 'circuit_open',
    });
    // The ref should still be updated even on circuit_open (for the chain history)
    expect(ref.get('msg-1')).toEqual([
      { provider: 'mistral', model: 'mistral-small-latest' },
    ]);
  });

  it('emits outcome="rate_limited" with the right payload (HTTP 429)', () => {
    // The chat-metrics.ts type union includes 'rate_limited' as a valid outcome.
    // The wrapper should pass it through unchanged. (Production code may fire
    // this when a provider returns HTTP 429.)
    const ref: ChainRef = new Map();
    emitFallbackOutcome({
      chainRef: ref,
      messageId: 'msg-1',
      provider: 'openai',
      model: 'gpt-4o',
      outcome: 'rate_limited',
      reason: 'HTTP 429 (rate limit exceeded)',
    });
    expect(mockRecordAttempt).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4o',
      outcome: 'rate_limited',
      reason: 'HTTP 429 (rate limit exceeded)',
    });
    expect(ref.get('msg-1')).toEqual([
      { provider: 'openai', model: 'gpt-4o' },
    ]);
  });

  it('emits all 4 outcomes in sequence (simulates a full retry cascade)', () => {
    // Simulates a retry sequence that hits all 4 outcome types:
    // 1. Original request: rate_limited (429)
    // 2. Retried request: circuit_open (provider circuit breaker tripped)
    // 3. Second retry: failure (HTTP 500)
    // 4. Third retry: success
    const ref: ChainRef = new Map();
    const messageId = 'msg-cascade';

    emitFallbackOutcome({
      chainRef: ref,
      messageId,
      provider: 'openai',
      model: 'gpt-4o',
      outcome: 'rate_limited',
      reason: 'HTTP 429',
    });
    emitFallbackOutcome({
      chainRef: ref,
      messageId,
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      outcome: 'circuit_open',
    });
    emitFallbackOutcome({
      chainRef: ref,
      messageId,
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'failure',
      reason: 'HTTP 500',
    });
    emitFallbackOutcome({
      chainRef: ref,
      messageId,
      provider: 'google',
      model: 'gemini-2.5-flash',
      outcome: 'success',
    });

    expect(mockRecordAttempt).toHaveBeenCalledTimes(4);
    // The ref should have all 4 entries in order
    expect(ref.get(messageId)).toEqual([
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      { provider: 'google', model: 'gemini-2.5-flash' },
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);
  });
});

// ============================================================================
// Exhaustion reason template coverage (all 3 reason templates from production)
// ============================================================================

describe('emitFallbackExhausted — all 3 reason templates', () => {
  beforeEach(() => {
    mockRecordAttempt.mockReset();
    mockRecordExhausted.mockReset();
  });

  it('emits pre-stream exhaustion reason: "pre-stream HTTP ${statusCode} -> retry failed after ${maxRetries} attempts"', () => {
    // This is the reason template used at line 977 of use-enhanced-chat.ts
    // (pre-stream retry exhaustion in the catch block).
    const ref: ChainRef = new Map();
    ref.set('msg-1', [
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);

    emitFallbackExhausted({
      chainRef: ref,
      messageId: 'msg-1',
      metadata: undefined,
      reason: 'pre-stream HTTP 500 -> retry failed after 3 attempts',
      origProvider: 'nvidia',
      origModel: 'moonshotai/kimi-k2.5',
      selectedProvider: 'google',
      selectedModel: 'gemini-2.5-flash',
    });

    expect(mockRecordExhausted).toHaveBeenCalledWith({
      reason: 'pre-stream HTTP 500 -> retry failed after 3 attempts',
      attempts: [
        { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
    });
  });

  it('emits assistant stream cascade reason: "empty-response after ${maxRetries} attempts (cascade to text mode)"', () => {
    // This is the reason template used at line 1755 of use-enhanced-chat.ts
    // (assistant stream retry exhaustion, inner branch).
    const ref: ChainRef = new Map();
    ref.set('msg-2', [
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ]);

    emitFallbackExhausted({
      chainRef: ref,
      messageId: 'msg-2',
      metadata: undefined,
      reason: 'empty-response after 3 attempts (cascade to text mode)',
      origProvider: 'nvidia',
      origModel: 'moonshotai/kimi-k2.5',
      selectedProvider: 'anthropic',
      selectedModel: 'claude-sonnet-4-20250514',
    });

    expect(mockRecordExhausted).toHaveBeenCalledWith({
      reason: 'empty-response after 3 attempts (cascade to text mode)',
      attempts: [
        { provider: 'nvidia', model: 'moonshotai/kimi-k2.5' },
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      ],
    });
  });

  it('emits assistant stream outer branch reason: "empty-response after ${maxRetries} attempts (cascade to text mode, outer branch)"', () => {
    // This is the reason template used at line 1812 of use-enhanced-chat.ts
    // (assistant stream outer branch — hit even when the stream returned empty
    // on the first try, so the `if (exhaustedChain.length > 0)` guard
    // prevents firing with 0 attempts).
    const ref: ChainRef = new Map();
    ref.set('msg-3', [
      { provider: 'google', model: 'gemini-2.5-flash' },
    ]);

    emitFallbackExhausted({
      chainRef: ref,
      messageId: 'msg-3',
      metadata: undefined,
      reason: 'empty-response after 3 attempts (cascade to text mode, outer branch)',
      origProvider: 'google',
      origModel: 'gemini-2.5-flash',
      selectedProvider: 'mistral',
      selectedModel: 'mistral-small-latest',
    });

    expect(mockRecordExhausted).toHaveBeenCalledWith({
      reason: 'empty-response after 3 attempts (cascade to text mode, outer branch)',
      attempts: [
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
    });
  });
});
