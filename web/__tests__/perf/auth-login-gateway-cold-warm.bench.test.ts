/**
 * auth-login-gateway-cold-warm.bench.test.ts
 *
 * Cold-vs-warm micro-benchmark for `/api/auth/login` now that the audit-log
 * static-import + fire-and-forget are live (see MED-5 fix in
 * /opt/bing/web/app/api/auth/login/gateway.ts L260-273).
 *
 * ## Boundary attribution
 *
 * The gateway emits 2 boundary markers in the live tree:
 *
 *   - **b0**: `tLoginStart = process.hrtime.bigint()` at L61 — placed
 *     BEFORE `await authService.login(...)`. Pre_login start.
 *   - **b1**: `logger.info('login gateway cold-path timing', { boundary: 'pre_response', elapsedMs, mfaEnabled })`
 *     at L288 — placed AFTER VFS-fire-and-forget + audit-fire-and-forget
 *     dispatch + cookie/CSRF writes, just BEFORE the response is returned.
 *
 * This test attributes the 4 user-requested boundaries as follows:
 *
 *   - **pre_db / post_db / post_bcrypt** — derived from synthetic MOCK_DB_MS
 *     + MOCK_BCRYPT_MS (no live markers INSIDE authService.login today).
 *     Trade-off justified below.
 *   - **post_audit / pre_response** — captured by b1 (post-fire-and-forget
 *     dispatch; the audit row itself is awaited-as-tail, but the post-
 *     audit latency is included in b1's elapsedMs).
 *
 * Trade-off rationale (per thinker's design plan answer #2): add the 3
 * granular markers INSIDE authService.login ONLY if the residue vs bcrypt
 * is interesting for next-round targeting. Today the audit-log static-
 * import + fire-and-forget is the suspect (MED-5 fix), so b1 alone —
 * combined with the known MOCK_BCRYPT_MS — yields a usable residue
 * signal that flags whether the gateway wrapper has tightened.
 *
 * ## Cold vs Warm isolation
 *
 * - **Cold path**: each measured invocation is preceded by `vi.resetModules()`
 *   which clears the Node require cache → V8 re-parses + re-warms the
 *   gateway and its dependencies. N=20 cycles.
 * - **Warm path**: after one warmup invocation (NOT measured — primes V8's
 *   optimizing compiler + the auth-service mock's JIT), N=20 sequential
 *   invocations on the same module context.
 *
 * ## Mock strategy
 *
 * - `@/lib/auth/auth-service` — `login` returns a fixture user record
 *   after a deterministic MOCK_DB_MS + MOCK_BCRYPT_MS pause; `logout`
 *   returns `undefined`. This isolates the gateway wrapper from real
 *   bcryptjs + better-sqlite3 costs.
 * - `@/lib/auth/transfer-anon-vfs` — `transferVFSOnLogin` returns
 *   `{ transferredFiles: 0 }` (no-op).
 * - `@/lib/auth/auth-audit-logger` — `logLoginSuccess` + `logLoginFailure`
 *   resolve with `undefined` (no-op).
 *
 * Total benchmark runtime (estimated): ~20ms × 20 cold + ~110ms × 20 warm
 * ≈ 2.6 seconds.
 */
import { describe, it, expect, vi } from 'vitest';

const MOCK_DB_MS = 10;
// MOCK_BCRYPT_MS reduced from 100 → 30 to reflect native bcrypt speed.
// The benchmark isolates the gateway wrapper + module-load cost; the mock
// value only needs to be large enough to be measurable above noise but
// small enough to keep total runtime low. Native bcrypt at cost-12 is
// ~250ms in production; bcryptjs is ~4200ms. The mock decouples the test
// from either real implementation.
const MOCK_BCRYPT_MS = 30;
const N = 20;
const SAMPLE_LABEL = 'auth-login-gateway-cold-warm';

// Mock the heavy hitters so the benchmark isolates the gateway wrapper +
// module-load cost. Mocks live at the @/lib path alias the gateway uses —
// vitest's vi.mock applies BEFORE the gateway's first static import.
vi.mock('@/lib/auth/auth-service', () => ({
  authService: {
    login: vi.fn(async (_args: any, _ctx: any) => {
      // simulated DB lookup latency
      await new Promise((r) => setTimeout(r, MOCK_DB_MS));
      // simulated bcryptjs verify latency (cost-12 baseline ~4200ms in
      // production; replaced by MOCK_BCRYPT_MS so the cold/warm signal
      // isolates module-loading + gateway wrapper, NOT real bcrypt)
      await new Promise((r) => setTimeout(r, MOCK_BCRYPT_MS));
      return {
        success: true,
        user: { id: 'test', emailVerified: true },
        sessionId: 'sess-test',
        token: 'tok-test',
      };
    }),
    logout: vi.fn(async () => undefined),
  },
}));

vi.mock('@/lib/auth/transfer-anon-vfs', () => ({
  transferVFSOnLogin: vi.fn().mockResolvedValue({ transferredFiles: 0 }),
}));

vi.mock('@/lib/auth/auth-audit-logger', () => ({
  logLoginSuccess: vi.fn().mockResolvedValue(undefined),
  logLoginFailure: vi.fn().mockResolvedValue(undefined),
}));

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[(sorted.length - 1) / 2];
}

async function invokeGatewayAndCaptureB1(): Promise<number> {
  const { POST } = await import('@/app/api/auth/login/gateway');
  const { logger } = await import('@/lib/utils/logger');
  const infoSpy = vi.spyOn(logger, 'info');

  const request = new Request('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com', password: 'pw' }),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
      'user-agent': 'bench',
    },
  });

  await POST(request as unknown as Parameters<typeof POST>[0]);

  const b1LogCall = infoSpy.mock.calls.find(
    (c) =>
      typeof c[1] === 'object' &&
      c[1] !== null &&
      (c[1] as { boundary?: string }).boundary === 'pre_response',
  );
  if (!b1LogCall) {
    throw new Error('b1 elapsedMs log not captured — gateway L288 marker missing or signature changed');
  }
  return (b1LogCall[1] as { elapsedMs: number }).elapsedMs;
}

describe('/api/auth/login cold-vs-warm micro-benchmark (b0/b1 boundary capture)', () => {
  const coldResults: number[] = [];
  const warmResults: number[] = [];

  it(`cold path — N=${N} invocations, each preceded by vi.resetModules()`, async () => {
    for (let i = 0; i < N; i++) {
      vi.resetModules();
      coldResults.push(await invokeGatewayAndCaptureB1());
    }
  });

  it(`warm path — N=${N} sequential invocations after warmup on a single module context`, async () => {
    vi.resetModules();
    // Warmup invocation — primes V8's optimizing compiler + the mocked
    // auth-service JIT. NOT measured.
    await invokeGatewayAndCaptureB1();
    for (let i = 0; i < N; i++) {
      warmResults.push(await invokeGatewayAndCaptureB1());
    }
  });

  it('benchmark summary + residue attribution', () => {
    const coldMedian = median(coldResults);
    const warmMedian = median(warmResults);
    const coldResidue = coldMedian - (MOCK_DB_MS + MOCK_BCRYPT_MS);
    const warmResidue = warmMedian - (MOCK_DB_MS + MOCK_BCRYPT_MS);

    console.log(`\n### ${SAMPLE_LABEL} \u2014 Benchmark Results (N=${N})`);
    console.log('| Metric | Cold (p50) | Warm (p50) | Delta |');
    console.log('|---|---|---|---|');
    console.log(
      `| b1 elapsedMs (raw, pre_response) | ${coldMedian.toFixed(2)}ms | ${warmMedian.toFixed(2)}ms | +${(coldMedian - warmMedian).toFixed(2)}ms |`,
    );
    console.log(
      `|   \u2212 MOCK_DB_MS (synthetic pre_db \u2192 post_db) | \u2212${MOCK_DB_MS}ms | \u2212${MOCK_DB_MS}ms | 0.00ms |`,
    );
    console.log(
      `|   \u2212 MOCK_BCRYPT_MS (synthetic post_db \u2192 post_bcrypt) | \u2212${MOCK_BCRYPT_MS}ms | \u2212${MOCK_BCRYPT_MS}ms | 0.00ms |`,
    );
    console.log(
      `| = Gateway residue (post_audit-elapsed) | ${coldResidue.toFixed(2)}ms | ${warmResidue.toFixed(2)}ms | +${(coldResidue - warmResidue).toFixed(2)}ms |`,
    );
    console.log(
      '\n**Sources**:',
    );
    console.log(
      '  \u2022 b1 \u2014 bing/web/app/api/auth/login/gateway.ts:L288 logger.info({ boundary: \'pre_response\', elapsedMs })',
    );
    console.log('  \u2022 pre_db / post_db / post_bcrypt \u2014 derived from synthetic MOCK_DB_MS + MOCK_BCRYPT_MS (no live markers INSIDE authService.login today)');
    console.log('  \u2022 post_audit \u2014 captured by b1 (the fire-and-forget audit dispatch lives AFTER authService.login but BEFORE the b1 logger.info is emitted)');
    console.log(
      `\n**Next-round tightening target hint**: if cold-residue > warm-residue + ~10ms, the gateway wrapper has module-load cost to recover; if cold-residue is already tight (< 5ms), the next round targets SIDE channels (VFS-on-login fire-and-forget, CSRF token gen, cookie serialization) \u2014 each callable for additive measurement.`,
    );

    expect(coldResults.length).toBe(N);
    expect(warmResults.length).toBe(N);
    // Sanity: cold + warm b1 should at least exceed the synthetic mock
    // floor. If both <= (MOCK_DB_MS + MOCK_BCRYPT_MS), the marker capture
    // is broken — fail loudly.
    expect(coldMedian).toBeGreaterThan(MOCK_DB_MS + MOCK_BCRYPT_MS);
    expect(warmMedian).toBeGreaterThan(MOCK_DB_MS + MOCK_BCRYPT_MS);
  });
});
