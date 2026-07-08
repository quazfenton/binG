/**
 * __tests__/mcp/http-transport-signal.test.ts
 *
 * Regression tests for chat-hang-fix Step A: the external watchdog
 * AbortSignal (`agentTurnSignal`) plumbing through HTTPTransport.request.
 *
 * The threading was already landed at:
 *   - app/api/chat/route.ts:1844           (creates + passes `agentTurnSignal`)
 *   - lib/mcp/architecture-integration.ts  (callMCPToolFromAI_SDK accepts + forwards)
 *   - lib/mcp/http-transport.ts            (callRemoteMCPTool accepts + forwards)
 *   - lib/mcp/http-transport.ts:request()  (AbortSignal.any + retry-loop bails)
 *
 * These four tests pin the 4 invariants the existing inline comments reference
 * (T1, T2, T3, T6). The fetch-timeout plumbing must NOT regress the existing
 * maxRetries behavior on the no-watchdog path — that's what T6 guards.
 *
 * Why these tests matter: before this plumbing, a hung remote MCP fetch on a
 * dead socket waited `maxRetries × timeout = 3 × 30s = 90s` to exhaust, while
 * the chat route's 60s watchdog gave up first. The MCP call would still be in
 * flight when the route tried to send 524 to the client, leaving the underlying
 * TCP socket wedged until either the kernel timeout or the eventual
 * maxRetries-exhausted throw. After this fix, the watchdog abort propagates
 * through `AbortSignal.any(...)` and a pre-attempt or mid-retry bailout
 * short-circuits within ≤100ms.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HTTPTransport } from '@/lib/mcp/http-transport';

describe('HTTPTransport.request — agentTurnSignal plumbing (chat-hang-fix Step A)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ────────────────────────────────────────────────────────────────
  // T1 — PRE-ATTEMPT BAILOUT
  //
  // If the watchdog (agentTurnSignal) already fired BEFORE request() is
  // awaited, the loop's top-of-iteration `if (externalSignal?.aborted)` check
  // throws BEFORE calling fetch. Proves zero network resources are wasted
  // on a dead-on-arrival request (critical when the upstream proxy or
  // load-balancer has already timed out).
  // ────────────────────────────────────────────────────────────────
  it('T1: bails out before attempting fetch if external signal is already aborted', async () => {
    const transport = new HTTPTransport({
      url: 'http://example.com/mcp',
      timeout: 50,
      maxRetries: 3,
    });

    const controller = new AbortController();
    controller.abort(); // Pre-abort BEFORE awaiting — the dead-socket signal

    await expect(
      transport.callTool('myTool', {}, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: 'aborted',
    });

    // Zero fetch attempts — the pre-attempt check caught it before any
    // network call. If the fix regressed, fetch would be called min 1× here.
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  // ────────────────────────────────────────────────────────────────
  // T2 — COMBINED SIGNAL ABORTS IN-FLIGHT FETCH
  //
  // AbortSignal.any [internal-timeout-AbortController, external-watchdog]
  // composes the two aborts into one signal handed to fetch. When the
  // external watchdog fires, the combined signal flips → fetch rejects with
  // AbortError within ≤100ms — proving the propagation path:
  //   route.agentTurnSignal → callMCPToolFromAI_SDK.options.signal
  //   → callRemoteMCPTool.options.signal → transport.callTool.options.signal
  //   → request.options.signal → AbortSignal.any([timeoutSignal, externalSignal])
  //   → fetch({ signal: combinedSignal }) → fetch aborts.
  // ────────────────────────────────────────────────────────────────
  it('T2: combined signal (timeout + external) aborts the in-flight fetch via AbortSignal.any', async () => {
    // Mock fetch that pends until its own signal aborts, then rejects.
    fetchMock.mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            const err: any = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const transport = new HTTPTransport({
      url: 'http://example.com/mcp',
      timeout: 5000, // long enough that internal timeout never fires
      maxRetries: 1,
    });

    const controller = new AbortController();
    const reqPromise = transport.callTool('myTool', {}, { signal: controller.signal });
    controller.abort(); // Fire watchdog while fetch is pending.

    await expect(reqPromise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'aborted',
    });

    // Fetch was attempted exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The signal passed DOWN to fetch is the COMBINED (any) — and it is
    // aborted. This is the parser contract: if this signal weren't the
    // combined one, the external abort wouldn't have been observable to fetch.
    const passedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(passedSignal).toBeDefined();
    expect(passedSignal.aborted).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────
  // T3 — MID-RETRY-CYCLE BAILOUT
  //
  // If the watchdog fires DURING a transient-failure attempt (not before
  // the first attempt, not after all attempts — but between attempts 0 and
  // 1), the catch block's `if (externalSignal?.aborted)` re-throws as
  // AbortError rather than falling through to the next retry. Proves the
  // watchdog beat clears the retry queue — without it, a network blip +
  // event-loop watchdog would compound into `maxRetries × timeout` wallclock.
  // ────────────────────────────────────────────────────────────────
  it('T3: breaks the retry loop immediately if external signal fires during a transient failure', async () => {
    const externalController = new AbortController();
    let fetchCalls = 0;

    // Each fetch attempt throws + simultaneously aborts the external signal.
    // The catch block reads `externalSignal.aborted === true` and bails
    // BEFORE falling through to the next retry iteration.
    fetchMock.mockImplementation(() => {
      fetchCalls++;
      externalController.abort();
      throw new Error('Transient network error');
    });

    const transport = new HTTPTransport({
      url: 'http://example.com/mcp',
      timeout: 5000,
      maxRetries: 3, // would retry 3× if the watchdog-bail were broken
    });

    await expect(
      transport.callTool('myTool', {}, { signal: externalController.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: 'aborted',
    });

    // CRITICAL: fetch was attempted exactly once. If the fix regressed
    // (catch block fell through to the retry loop), fetchCalls would be
    // 3 (one per retry).
    expect(fetchCalls).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────
  // T6 — PRESERVES maxRetries WHEN NO EXTERNAL SIGNAL IS PROVIDED
  //
  // Regression guard for the no-watchdog path. The new signal plumbing
  // must NOT break the existing pure-timeout + retry-on-transient semantics
  // for callers that don't pass an AbortSignal (e.g. internal MCP probes,
  // other MCP tooling endpoints). With 3 transient errors and no signal,
  // the loop must attempt exactly `maxRetries` times and throw the LAST
  // error (the canonical maxRetries-exhausted rethrow).
  // ────────────────────────────────────────────────────────────────
  it('T6: preserves maxRetries exhausted behavior when no external signal is provided', async () => {
    const transientError = new Error('Connection Reset');
    // mockRejectedValue returns `Promise.reject(error)` each call — the
    // await fetch(...) rejection is the transient path.
    fetchMock.mockRejectedValue(transientError);

    const transport = new HTTPTransport({
      url: 'http://example.com/mcp',
      timeout: 5, // tiny: keeps the test wallclock under ~20ms
      maxRetries: 3,
    });

    // NO `options.signal` passed — exercises the unwatched path.
    await expect(transport.callTool('myTool', {})).rejects.toThrow('Connection Reset');

    // Exactly maxRetries attempts (not 1, not 0, not 30).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
