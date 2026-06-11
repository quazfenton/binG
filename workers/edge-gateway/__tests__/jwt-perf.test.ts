/**
 * Microbenchmark for HS256 JWT signing in the edge-gateway hot path.
 *
 * Measures `signJwt` from `@bing/shared/auth/jwt` over 1000 iterations and
 * reports median / p95 / p99 wall-clock timings. Designed as a regression
 * baseline — if a future change (e.g. switching to a different crypto lib,
 * adding extra header fields, changing the base64url encoder) regresses
 * signing cost, this test will surface it.
 *
 * IMPORTANT: Numbers will differ on real Cloudflare Workers vs. the Node
 * runtime vitest uses locally. Workers' crypto.subtle is hardware-accelerated
 * and generally faster than Node's. Use this test for *relative* comparisons
 * (before/after a change) rather than absolute Worker timings.
 *
 * The test NEVER fails on absolute numbers — it only logs them. Pass/fail
 * comes from the structural assertions (token shape, signature validity).
 */

import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '@bing/shared/auth/jwt';

const ITERATIONS = 1000;
const WARMUP_ITERATIONS = 10;
const SECRET = 'perf-test-secret-not-the-real-one-but-32-bytes-long-for-realism';
const PAYLOAD = {
  sub: 'perf-user-123',
  exp: Math.floor(Date.now() / 1000) + 5 * 60,
  scope: 'chat:stream',
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function summarize(label: string, samples: number[]): void {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const stats = {
    label,
    iterations: sorted.length,
    totalMs: Number(sum.toFixed(3)),
    meanMs: Number((sum / sorted.length).toFixed(4)),
    medianMs: Number(percentile(sorted, 50).toFixed(4)),
    p95Ms: Number(percentile(sorted, 95).toFixed(4)),
    p99Ms: Number(percentile(sorted, 99).toFixed(4)),
    minMs: Number(sorted[0].toFixed(4)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(4)),
  };
  // Log to console so it shows up in vitest output as a baseline snapshot.
  console.log(`[jwt-perf] ${JSON.stringify(stats)}`);
}

describe('signJwt microbenchmark', () => {
  it('signs 1000 tokens and reports median / p95 / p99 timings', async () => {
    // Warmup — V8 needs a few iterations to JIT-optimize the hot path.
    // Skipping warmup makes the first ~20 samples misleadingly slow.
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      await signJwt(PAYLOAD, SECRET);
    }

    // Measured loop
    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      const token = await signJwt(PAYLOAD, SECRET);
      const t1 = performance.now();
      samples.push(t1 - t0);

      // Light structural assertion to catch any accidental breakage —
      // doesn't fail the test on timing, only on malformed output.
      expect(token.split('.').length).toBe(3);
    }

    summarize('signJwt', samples);

    // Sanity bound: signing should never exceed 50ms in any reasonable
    // runtime. If we ever see 50ms+, something is very wrong (e.g. a
    // sync-blocking call was accidentally added). This is a soft upper
    // bound, not a perf target.
    const maxSample = Math.max(...samples);
    expect(maxSample).toBeLessThan(50);
  });

  it('a signed token from the perf loop round-trips through verifyJwt', async () => {
    // Generate a token with the same shape the Worker produces, then verify.
    // This is a structural regression guard — if signJwt or verifyJwt
    // change their encoding/algorithm incompatibly, this will fail.
    const token = await signJwt(PAYLOAD, SECRET);
    const verified = await verifyJwt(token, SECRET);
    expect(verified.valid).toBe(true);
    expect(verified.payload?.sub).toBe(PAYLOAD.sub);
    expect(verified.payload?.scope).toBe(PAYLOAD.scope);
  });

  it('1000 back-to-back sign-then-verify pairs stay under 20ms each (p99)', async () => {
    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      const token = await signJwt(PAYLOAD, SECRET);
      const verified = await verifyJwt(token, SECRET);
      const t1 = performance.now();
      samples.push(t1 - t0);
      expect(verified.valid).toBe(true);
    }
    summarize('signJwt+verifyJwt round-trip', samples);
    const sorted = [...samples].sort((a, b) => a - b);
    const p99 = percentile(sorted, 99);
    expect(p99).toBeLessThan(20);
  });
});
