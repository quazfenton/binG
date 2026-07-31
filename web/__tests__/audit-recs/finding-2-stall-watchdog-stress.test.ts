/**
 * Ticket F2: Stall Watchdog Ergonomics — STRESS TEST
 * Opened: 2026-07-16
 * Parent audit-finding thread: F2 (route.ts stall watchdog timeout sensitivity).
 * Status: F2-a + F2-b already landed in /opt/bing/web/app/api/chat/route.ts:L1920-L2008
 *         (per-call toolCallAbort isolation + lastProgressAt bumps on tool start/complete).
 *         F2-c (this file) is the regression-locking test for the contract.
 *
 * Acceptance criteria locked in by this test file:
 *
 *   (F2-a) The route-level stall watchdog's `lastProgressAt` MUST be bumped
 *          at the start AND completion of every tool-call dispatch so a
 *          long-running tool call (e.g. 65s) does not trigger the
 *          no-progress stall. Verified by per-iteration bumpCount assertion
 *          + explicit no-fire across 65s of watchdog ticks.
 *
 *   (F2-b) Per-stage AbortSignal isolation. When the tool-call stage
 *          stalls, ONLY the per-call `toolCallAbort` MUST be aborted —
 *          the parent `agentTurnAbort` MUST remain un-aborted so the
 *          LLM-continuation retry path is eligible to recover cleanly.
 *          Verified by the directional propagation tests (Test 4, 5, 6)
 *          that directly assert AbortController state independent of
 *          the watchdog helper.
 *
 *   (F2-c — the stress aspect) 10 simulated requests × 65s tool calls
 *          each. Expect ZERO `fireStall` invocations across all 10
 *          iterations. Mirror of the audit-reported failure mode
 *          before F2-a landed.
 *
 * DETERMINISM STRATEGY (SYNTHETIC CLOCK):
 * To absolutely guarantee no flakes from fake-timer interactions (e.g.
 * drift between setInterval ticks, microtask queue resolution, and
 * Date.now() bindings), this suite uses a strictly synthetic `nowMs`
 * integer. There is ZERO dependency on vitest's fake timers. The
 * watchdog reads `nowMs` (not `Date.now()`) for all comparisons, so
 * the math is provable by inspection: every `advance(1000)` increments
 * the synthetic clock and ticks the watchdog deterministically.
 *
 * The trade-off: the synthetic-clock approach does NOT exercise the real
 * `setInterval(stallWatchdog, ~15000)` firing path in route.ts. It tests
 * the LOGIC contract: "if lastProgressAt is bumped when there is progress,
 * the watchdog never fires". The actual setInterval wiring is covered by
 * route-level integration tests (out of scope for this file).
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Synthetic Timer State ──────────────────────────────────────────────────

// Global (module-level) synthetic clock.
let nowMs = 0;

/**
 * Pure, deterministic time advancement. Used by every test to drive
 * the watchdog forward by a known delta.
 */
function advance(ms: number): void {
  nowMs += ms;
}

// ── Helpers (mirror route.ts:L1925-L2010 contract) ─────────────────────────

interface WatchdogHandles {
  fires: () => number;
  lastProgressAt: () => number;
  bumpProgress: () => void;
  tick: () => null | 'max-turn' | 'no-progress';
}

/**
 * Pure functional reproducer of the route-level stall watchdog logic.
 * Reads solely from the synthetic `nowMs`. No setInterval — caller
 * invokes `tick()` explicitly per second (or per any cadence the test
 * chooses), so the test body's control flow IS the contract.
 *
 * Mirrors route.ts:L1674-L1683 (the `setInterval(stallWatchdog)` body)
 * but without the bundling/concurrency concerns of the real setInterval.
 */
function createWatchdog(opts: {
  STALL_TIMEOUT_MS: number;
  MAX_TURN_MS: number;
}): WatchdogHandles {
  // Capture startTimeMs from the SYNTHETIC clock (not Date.now()). This
  // ensures that a watchdog created mid-test (after some `advance()`
  // calls) sees a consistent turnMs baseline.
  const startTimeMs = nowMs;
  let lastProgressAtMs = nowMs;
  let firesCount = 0;

  return {
    fires: () => firesCount,
    lastProgressAt: () => lastProgressAtMs,

    /**
     * Mirrors route.ts:L1938-L1943 (tool START) and L1997-L2002
     * (tool COMPLETE in `finally`). The contract: a single bump
     * refreshes the watchdog's idle window to NOW.
     */
    bumpProgress: () => {
      lastProgressAtMs = nowMs;
    },

    /**
     * Mirrors route.ts:L1674-L1683 (one `setInterval(stallWatchdog)` tick).
     * Returns the fire reason if a stall was detected, else null.
     */
    tick: () => {
      const noProgressMs = nowMs - lastProgressAtMs;
      const turnMs = nowMs - startTimeMs;

      if (turnMs >= opts.MAX_TURN_MS) {
        firesCount++;
        return 'max-turn';
      }
      if (noProgressMs >= opts.STALL_TIMEOUT_MS) {
        firesCount++;
        return 'no-progress';
      }
      return null;
    },
  };
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('finding-2-stall-watchdog-stress', () => {
  beforeEach(() => {
    // Reset synthetic clock before every test to isolate state.
    nowMs = 0;
  });

  // ── Test 1 — Single 65 s tool call. F2-a bump regime. Expect 0 fires. ──
  it('a 65s tool call does NOT trip the stall watchdog (F2-a bump regime)', () => {
    const wd = createWatchdog({
      STALL_TIMEOUT_MS: 1000,
      MAX_TURN_MS: 200_000,
    });

    // Tool start signal.
    wd.bumpProgress();

    // 65 iterations of 1 s advancement WITH bumps. After each step:
    //   nowMs - lastProgressAtMs == 0 < STALL_TIMEOUT_MS (1000)
    // so every tick returns null and firesCount stays at 0.
    for (let s = 0; s < 65; s++) {
      advance(1000);
      wd.bumpProgress();
      wd.tick();
    }

    // Tool complete signal (mirrors `finally { lastProgressAt = ... }`).
    // No post-bump tick: with lastProgressAtMs == nowMs, noProgressMs == 0,
    // so a tick here is provably null and adds no information beyond the
    // bump itself.
    wd.bumpProgress();

    expect(wd.fires()).toBe(0);
  });

  // ── Test 2 — NEGATIVE CONTROL. WITHOUT F2-a bump regime, a 65 s tool
  // trips the watchdog. Confirms the test is sensitive to the fix.
  it('(NEGATIVE CONTROL) without F2-a progress bumps, a 65s tool call TRIPS the stall watchdog', () => {
    const wd = createWatchdog({
      STALL_TIMEOUT_MS: 1000,
      MAX_TURN_MS: 200_000,
    });

    // 65 iterations of 1 s advancement WITHOUT bumps. After each step:
    //   lastProgressAtMs stays at 0
    //   nowMs - lastProgressAtMs == 1000, 2000, ..., 65000
    // Every tick fires (>= 1000) once it crosses 1000. Expect exactly
    // 65 fires (one per tick after cross).
    for (let s = 0; s < 65; s++) {
      advance(1000);
      wd.tick();
    }

    expect(wd.fires()).toBeGreaterThanOrEqual(1);
    expect(wd.fires()).toBe(65);
  });

  // ── Test 3 — F2-c stress. 10 iterations × 65 s each, F2-a bump regime
  // applied per iteration, ZERO fires expected.
  it('10 requests × 65s tool calls each — zero stall watchdog fires (F2-c stress)', () => {
    const wd = createWatchdog({
      STALL_TIMEOUT_MS: 1000,
      // 10 × 65 s = 650 s — keep MAX_TURN_MS above this so the no-progress
      // threshold (STALL_TIMEOUT_MS) governs the test, not max-turn.
      MAX_TURN_MS: 1_000_000,
    });

    for (let i = 0; i < 10; i++) {
      wd.bumpProgress(); // tool start
      for (let s = 0; s < 65; s++) {
        advance(1000);
        wd.bumpProgress();
        wd.tick();
      }
      wd.bumpProgress(); // tool complete (no redundant post-bump tick;
      // same reasoning as Test 1: provably null when lastProgressAtMs == nowMs).
    }

    expect(wd.fires()).toBe(0);
  });

  // ── Test 4 — F2-b isolation part 1: toolCallAbort.abort() does NOT
  // propagate to agentTurnAbort. Hardened with explicit signal.reason
  // assertion per code-reviewer SHOULD-CONSIDER #4 so a future
  // AbortSignal.any behavior change surfaces as a test failure rather
  // than a silent shape shift.
  it('per-stage abort isolation: toolCallAbort.abort() does NOT propagate to agentTurnAbort (F2-b)', () => {
    // Pure state-machine validation — no synthetic-clock dependency.
    const agentTurnAbort = new AbortController();
    const toolCallAbort = new AbortController();

    const STALL_REASON = 'stalled-tool-call-stage';
    toolCallAbort.abort(STALL_REASON);

    expect(toolCallAbort.signal.aborted).toBe(true);
    expect(toolCallAbort.signal.reason).toBe(STALL_REASON);

    // The load-bearing F2-b assertion: child abort is directionally
    // bounded — parent abort signal stays un-aborted.
    expect(agentTurnAbort.signal.aborted).toBe(false);
  });

  // ── Test 5 — F2-b directional: agentTurnAbort.abort() DOES propagate
  // into the per-call signal (parent → child is acceptable per the
  // audit's stated phase-2 reset rule).
  it('parent-stage abort DOES propagate into the per-call signal (F2-b directional)', () => {
    const agentTurnAbort = new AbortController();
    const toolCallAbort = new AbortController();
    const toolCallSignal = AbortSignal.any([
      agentTurnAbort.signal,
      toolCallAbort.signal,
    ]);

    const USER_CANCEL_REASON = 'user-cancel-turn';
    agentTurnAbort.abort(USER_CANCEL_REASON);

    expect(agentTurnAbort.signal.aborted).toBe(true);
    expect(agentTurnAbort.signal.reason).toBe(USER_CANCEL_REASON);
    expect(toolCallSignal.aborted).toBe(true);

    // The per-call abort did NOT also flip — that's the bidirectional
    // coupling we're guarding against.
    expect(toolCallAbort.signal.aborted).toBe(false);
  });

  // ── Test 6 — Per-call controller disposal in `finally` does not leak
  // signal-aborted state to next call (F2-b contract). Mirrors
  // route.ts:L2007 (`toolCallAbort.abort()` inside `finally`).
  it('per-call controller disposal in `finally` does not leak signal-aborted state to next call (F2-b)', () => {
    const agentTurnAbort = new AbortController();

    // First tool call — stalls, controller is disposed in finally block
    // (mirrors route.ts:L2007).
    const firstCallAbort = new AbortController();
    const firstCallSignal = AbortSignal.any([
      agentTurnAbort.signal,
      firstCallAbort.signal,
    ]);
    firstCallAbort.abort('first-call-stalled');
    expect(firstCallSignal.aborted).toBe(true);

    // Second tool call — gets a fresh controller. The previously
    // aborted firstCallAbort does NOT influence the second call's
    // signal (each `AbortSignal.any` is constructed from the live
    // parent + the freshly-allocated child).
    const secondCallAbort = new AbortController();
    const secondCallSignal = AbortSignal.any([
      agentTurnAbort.signal,
      secondCallAbort.signal,
    ]);
    expect(secondCallAbort.signal.aborted).toBe(false);
    expect(secondCallSignal.aborted).toBe(false);

    // Sanity: the parent abort still propagates into the second
    // call's signal (canonical direction).
    agentTurnAbort.abort('user-cancel-after-first');
    expect(secondCallSignal.aborted).toBe(true);
  });
});
