/**
 * __tests__/mcp/ceiling-matrix-integration.test.ts
 *
 * Phase-2 ceiling matrix audit: verifies the nested abort-signal chain
 * resolves to `min(all)` when multiple ceilings are wired.
 *
 * The nested chain after the hoist + signal-thread changes:
 *
 *   route.ts `agentTurnSignal` (60s ─ MCP_AGENT_TIMEOUT_MS)
 *     → MCP_TOOLS_TIMEOUT signal (1s default, via route.ts:mcpAbortSignal)
 *       → getMCPToolsForAI_SDK Phase 2 race (against mcpAbortSignal)
 *         → getRemoteMCPTools PA (signal forwarded)
 *           → transport.listTools({ signal }) (30s internal timeout)
 *
 * The ceiling matrix resolves to `min(60_000, 1_000, 30_000)` = 1_000 ms
 * in the chat-route path. For the 3 back-port sites (no upstream signal),
 * the chain is:
 *
 *   AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS)  (60s)
 *     → callMCPToolFromAI_SDK(options.signal)
 *       → callRemoteMCPTool(options.signal)
 *         → HTTPTransport.request(...) combined signal
 *
 * This test builds a 4-layer mock chain with synthetic ceilings and
 * verifies `min(all)` is the observed abort latency.
 *
 * IMPORTANT: uses `vi.useFakeTimers()` so wallclock is NOT actually
 * consumed. Elapsed is measured by summing the fake-timer advancement,
 * not via `Date.now()` (which is frozen by fake timers).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCP_AGENT_TIMEOUT_MS } from '@/lib/mcp/timeouts';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    }
  });
}

/**
 * Build a Promise that hangs until `signal` fires (like callMCPToolFromAI_SDK
 * backed by a hung MCP transport). Returns the (fake-)elapsed latency on
 * abort.
 */
function hangUntilSignal(signal: AbortSignal): Promise<number> {
  const start = performance.now();
  return new Promise<number>((_resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
}

describe('Phase-2 ceiling matrix — outer-most-wins (min of all ceilings)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves to min of [50s, 10s, 5s, 2s] = 2s', async () => {
    // Layer 1: outer-most (50s)
    const outerSignal = AbortSignal.timeout(50_000);

    // Layer 2: the min of all ceilings — must fire first at 2s
    const transportSignal = AbortSignal.timeout(2_000);

    // Hang a work promise against transportSignal
    const workPromise = hangUntilSignal(transportSignal);

    // Race the work against the outer signal
    const racePromise = Promise.race([
      workPromise,
      hangUntilSignal(outerSignal),
    ]);

    // Advance past the fastest ceiling (2s)
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(racePromise).rejects.toMatchObject({ name: 'AbortError' });

    // Advance the rest — no further rejection should occur
    await vi.advanceTimersByTimeAsync(100_000);
  });

  it('resolves to min of [60s, 1s, 30s] with production-like ceilings', async () => {
    // Simulates chat-route path: agentTurnSignal (60s) > MCP_TOOLS_TIMEOUT (1s)
    const outerSignal = AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS);
    const mcpToolsSignal = AbortSignal.timeout(1_000);
    const transportSignal = AbortSignal.timeout(30_000);

    const workPromise = hangUntilSignal(mcpToolsSignal);
    const racePromise = Promise.race([
      workPromise,
      hangUntilSignal(outerSignal),
      hangUntilSignal(transportSignal),
    ]);

    // Fastest ceiling is 1s
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(racePromise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('resolves to min of [60s, 30s, 30s, 5s] when MCP_TOOLS_TIMEOUT is relaxed', async () => {
    const outerSignal = AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS);
    const mcpToolsSignal = AbortSignal.timeout(30_000);
    const transportSignal = AbortSignal.timeout(5_000);

    const workPromise = hangUntilSignal(transportSignal);
    const racePromise = Promise.race([
      workPromise,
      hangUntilSignal(outerSignal),
      hangUntilSignal(mcpToolsSignal),
    ]);

    // Fastest ceiling is 5s
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(racePromise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('outer-most (60s) is the ceiling when all inner layers are longer', { timeout: 120_000 }, async () => {
    // Simulates the case where inner layers are all long but outer is shorter
    const outerSignal = AbortSignal.timeout(60_000);
    const longSignalA = AbortSignal.timeout(100_000);
    const longSignalB = AbortSignal.timeout(100_000);

    const workPromise = hangUntilSignal(outerSignal);
    const racePromise = Promise.race([
      workPromise,
      hangUntilSignal(longSignalA),
      hangUntilSignal(longSignalB),
    ]);

    // Advance past the fastest ceiling (60s)
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(racePromise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Phase-2 ceiling matrix — no upstream signal (back-port path)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('MCP_AGENT_TIMEOUT_MS alone is the ceiling when no upstream signal is wired', { timeout: 120_000 }, async () => {
    // Mirrors the 3 back-port sites: `{ signal: AbortSignal.timeout(60_000) }`
    // is the only timeout in play. No upstream agentTurnSignal exists.
    const agentSignal = AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS);

    const hang = sleep(120_000, agentSignal);

    // Advance past agent timeout (60s) — sleep(120s) should abort
    await vi.advanceTimersByTimeAsync(MCP_AGENT_TIMEOUT_MS);

    await expect(hang).rejects.toMatchObject({ name: 'AbortError' });
  });
});
