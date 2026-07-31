/**
 * Tests for HTTPTransport AbortSignal threading + init-phase probe ceiling
 * — chat-hang-fix full plan (Steps A + B + C).
 *
 * Vector summary:
 *   Step A: signal plumbing through HTTPTransport.request path →
 *     route.ts:1827 watchdog now aborts a hung remote MCP fetch in ≤100ms
 *     instead of `maxRetries × timeout = 3 × 30s = 90s`.
 *   Step B: signal plumbing through getRemoteMCPTools (listTools path).
 *   Step C: probeAndRegisterRemoteMCPServers parallel probe bounded by
 *     INIT_PROBE_TIMEOUT_MS (5s) per server — was sequential for-loop with
 *     no per-call timeout, N dead servers held init open N × 30s (270s+ for
 *     N=9). Now: bounded by INIT_PROBE_TIMEOUT_MS regardless of N.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HTTPTransport,
  getRemoteMCPTools,
  registerHTTPTransport,
  clearAllHTTPTransports,
  clearRemoteToolsCache,
  INIT_PROBE_TIMEOUT_MS,
} from '../http-transport';
import { probeAndRegisterRemoteMCPServers } from '../architecture-integration';

const ABORT_ERROR = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' });

/**
 * Faithful fetch stub — mirrors real fetch's AbortSignal contract.
 * Real undici-fetch rejects on signal abort; this stub does the same.
 * Without signal honoring, the test would hang on the implicit +30s
 * safety timer instead of bailing on the abort.
 */
function makeHungFetch() {
  return vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        if (signal.aborted) {
          reject(ABORT_ERROR());
          return;
        }
        signal.addEventListener(
          'abort',
          () => reject(ABORT_ERROR()),
          { once: true }
        );
      }
      // Hung — no natural resolve.
    });
  });
}

describe('HTTPTransport — AbortSignal threading (chat-hang-fix Steps A+B+C)', () => {
  let transport: HTTPTransport;

  beforeEach(() => {
    transport = new HTTPTransport({
      url: 'http://mock-internal/mcp',
      timeout: 30_000,
      maxRetries: 3,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Test isolation: module-level Map + cache from http-transport.ts.
    clearAllHTTPTransports();
    clearRemoteToolsCache();
  });

  // ────────────────────────────────────────────────────────────────────
  // T1 — pre-call abort: watchdog fired before MCP dispatch began.
  // Must NOT invoke fetch and MUST throw AbortError fast.
  // ────────────────────────────────────────────────────────────────────
  it('T1: pre-call abort throws AbortError without invoking fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(
      () => Promise.reject(new Error('INVARIANT: fetch must not run after pre-call abort'))
    );

    const controller = new AbortController();
    controller.abort();

    await expect(
      transport.request(
        'tools/call',
        { name: 'x', arguments: {} },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────
  // T2 — mid-fetch abort: hung fetch, external abort at +5ms → throw
  // AbortError within ≤100ms. Retry loop must NOT swallow this.
  // ────────────────────────────────────────────────────────────────────
  it('T2: mid-fetch abort throws AbortError within ≤100ms of signal.abort()', async () => {
    const fetchSpy = makeHungFetch();

    const controller = new AbortController();
    const start = performance.now();
    setTimeout(() => controller.abort(), 5);

    await expect(
      transport.request(
        'tools/call',
        { name: 'x', arguments: {} },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    // Mid-fetch abort must NOT have fallen through to attempt 2/3.
    expect(fetchSpy.mock.calls.length).toBeLessThan(3);
  });

  // ────────────────────────────────────────────────────────────────────
  // T3 — mid-retry-cycle abort: external abort lands while a slow-fetch
  // is in flight. Catch block sees externalSignal.aborted and bails
  // out before retries exhaust.
  // ────────────────────────────────────────────────────────────────────
  it('T3: mid-retry-cycle abort breaks out before maxRetries exhaustion', async () => {
    let attempts = 0;
    vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const signal = init?.signal;
      return new Promise((_, reject) => {
        attempts++;
        if (signal) {
          if (signal.aborted) { reject(ABORT_ERROR()); return; }
          signal.addEventListener('abort', () => reject(ABORT_ERROR()), { once: true });
        }
        setTimeout(() => reject(new Error('transient-' + attempts)), 30);
      });
    });

    const controller = new AbortController();
    const start = performance.now();
    setTimeout(() => controller.abort(), 15);

    await expect(
      transport.request(
        'tools/call',
        { name: 'x', arguments: {} },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    // attempts may be 1 OR 2 depending on Node's microtask/timer
    // ordering at the +15ms / +30ms boundary — both satisfy < 3.
    expect(attempts).toBeLessThan(3);
  });

  // ────────────────────────────────────────────────────────────────────
  // T4 — INIT-PHASE PROBE (Step C): probeAndRegisterRemoteMCPServers
  // bounds wallclock to INIT_PROBE_TIMEOUT_MS + headroom regardless
  // of how many servers are dead. Was sequential before: N=3 dead
  // servers would take 90s. Now: ~5s.
  // ────────────────────────────────────────────────────────────────────
  it('T4: probeAndRegisterRemoteMCPServers — wallclock bounded by INIT_PROBE_TIMEOUT_MS + headroom regardless of N dead servers', async () => {
    makeHungFetch();

    const start = performance.now();
    await probeAndRegisterRemoteMCPServers([
      { name: 'dead-1', url: 'http://127.0.0.1:1' },
      { name: 'dead-2', url: 'http://127.0.0.1:2' },
      { name: 'dead-3', url: 'http://127.0.0.1:3' },
    ]);
    const elapsed = performance.now() - start;

    // INIT_PROBE_TIMEOUT_MS (5s) + 2s headroom for jitter.
    expect(elapsed).toBeLessThan(INIT_PROBE_TIMEOUT_MS + 2_000);
    // Sanity: at least most of INIT_PROBE_TIMEOUT_MS was actually used.
    expect(elapsed).toBeGreaterThanOrEqual(INIT_PROBE_TIMEOUT_MS - 200);
  });

  // ────────────────────────────────────────────────────────────────────
  // T5 — listTools signal threading (Step B): getRemoteMCPTools honors
  // an external signal — per-server listTools bails within ≤100ms
  // of the abort, and the whole Promise.all resolves fast.
  // ────────────────────────────────────────────────────────────────────
  it('T5: getRemoteMCPTools honors external signal — wallclock ≤100ms', async () => {
    registerHTTPTransport(
      't5-mock',
      new HTTPTransport({ url: 'http://mock', timeout: 30_000, maxRetries: 1 })
    );
    makeHungFetch();

    const controller = new AbortController();
    const start = performance.now();
    setTimeout(() => controller.abort(), 5);

    // Per-server try/catch swallows the reject and returns []. The
    // outer await resolves when Promise.all settles — wallclock is
    // bounded by the slowest server's abort latency.
    const result = await getRemoteMCPTools(false, { signal: controller.signal });
    expect(Array.isArray(result)).toBe(true);

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  // ────────────────────────────────────────────────────────────────────
  // T6 — REGRESSION: when NO external signal is provided, the original
  // timeout-driven abort + maxRetries-exhausted rethrow semantics are
  // preserved exactly.
  // ────────────────────────────────────────────────────────────────────
  it('T6: no external signal preserves timeout + maxRetries semantics', async () => {
    let attempts = 0;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => {
      attempts++;
      return Promise.reject(new Error('transient-failure'));
    });

    transport = new HTTPTransport({
      url: 'http://mock-internal/mcp',
      timeout: 5,
      maxRetries: 3,
    });

    await expect(
      transport.request('tools/call', { name: 'x', arguments: {} })
    ).rejects.toBeInstanceOf(Error);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(attempts).toBe(3);
  });

  // ────────────────────────────────────────────────────────────────────
  // T7 — CONCURRENT listTools + signal (Step B + C combined): N=3
  // pre-registered hung transports; external signal flips at +5ms;
  // getRemoteMCPTools wallclock bounded ≤100ms regardless of N. This
  // is the operational shape the chat route hits when an MCP server
  // box is reachable but its outlet is dead.
  // ────────────────────────────────────────────────────────────────────
  it('T7: concurrent listTools — external signal aborts ≤100ms wallclock regardless of N transports', async () => {
    registerHTTPTransport('t7-mock-1', new HTTPTransport({ url: 'http://mock1', timeout: 30_000, maxRetries: 1 }));
    registerHTTPTransport('t7-mock-2', new HTTPTransport({ url: 'http://mock2', timeout: 30_000, maxRetries: 1 }));
    registerHTTPTransport('t7-mock-3', new HTTPTransport({ url: 'http://mock3', timeout: 30_000, maxRetries: 1 }));
    makeHungFetch();

    const controller = new AbortController();
    const start = performance.now();
    setTimeout(() => controller.abort(), 5);

    await getRemoteMCPTools(false, { signal: controller.signal });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
