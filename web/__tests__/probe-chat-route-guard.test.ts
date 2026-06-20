/**
 * __tests__/probe-chat-route-guard.test.ts
 *
 * CI guard for scripts/probe-chat-route.ts.
 *
 * What this test does:
 *   1. Spawn scripts/probe-chat-route.ts as a child process (PROBE_N=50).
 *   2. Read /tmp/probe-chat-route.json.
 *   3. Assert cumulative_savings_p50_ms >= audit_low * (1 - TOLERANCE) = 60ms.
 *   4. Assert each layer's measured_saved_p50_ms stays within its audit
 *      [low, high] range — cumulative alone risks a future optimization
 *      in one layer masking a complete regression in another.
 *
 * When this test fails:
 *   - Cumulative failure surfaces ISO timestamp + per-layer zoom so a CI
 *     log reader sees the regressed layer immediately.
 *   - Per-layer failure surfaces WHICH layer regressed / over-optimized.
 *
 * When this test skips:
 *   - Default-skipped for local devs (avoids the ~30s smoke blocking
 *     `pnpm test`).
 *   - CI runners set `CI=true` automatically; opt-in for local runs via
 *     `PROBE_CI=1 pnpm test __tests__/probe-chat-route-guard.test.ts`.
 *
 * Why spawnSync (not direct import):
 *   - The probe uses Node's `register()` from `node:module` to install
 *     a custom loader hook. Vitest's esm resolver + auto-mock plugin
 *     conflict with `register()` — spawn isolation prevents cache /
 *     loader poisoning.
 *
 * Run via:
 *   PROBE_CI=1 pnpm test __tests__/probe-chat-route-guard.test.ts      (local CI simulation)
 *   CI=true    pnpm test __tests__/probe-chat-route-guard.test.ts      (CI runner; auto-enabled)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PROBE_SCRIPT = join(PROJECT_ROOT, 'scripts', 'probe-chat-route.ts');
const REPORT_PATH = '/tmp/probe-chat-route.json';

// Local devs opt out unless either env var is set.
const shouldRun = !!(process.env.CI || process.env.PROBE_CI);

// Tolerances derived from the audit doc
// /opt/bing/docs/async-parallelization-opportunities.md "Top 5 Quick Wins" #1-#5.
const AUDIT_FLOOR_MS = 80;
const TOLERANCE_FRACTION = 0.25;
const CUM_P50_THRESHOLD_MS = AUDIT_FLOOR_MS * (1 - TOLERANCE_FRACTION); // 60ms

// Per-layer audit claim [low, high] — must mirror probe-stub-manifest.ts.
// If this drifts, also update probe-stub-manifest.ts AUDIT_CLAIMS.
const PER_LAYER_CLAIMS: Record<string, { low: number; high: number }> = {
  'NEW-1':      { low: 5,  high: 15  },
  'NEW-2':      { low: 10, high: 30  },
  'Tier 1 #1':  { low: 40, high: 100 },
  'Tier 1 #3':  { low: 15, high: 65  },
};

interface PerLayerEntry {
  layer: string;
  audit_saved_low_ms: number;
  audit_saved_high_ms: number;
  measured_saved_p50_ms: number;
  measured_saved_p90_ms: number;
  within: boolean;
}
interface ProbeReport {
  cumulative_savings_p50_ms: number;
  cumulative_savings_p90_ms: number;
  audit_estimate_low_ms: number;
  audit_estimate_high_ms: number;
  cumulative_within_audit_range: boolean;
  per_layer_audit_vs_measured: PerLayerEntry[];
}

// Use `describeIf` pattern (compatible with all vitest versions).
const probeGuard = shouldRun ? describe : describe.skip;
const PROBE_TIMEOUT_MS = 120_000; // 2 minutes: covers worst-case CI runners

probeGuard('probe-chat-route CI guard', () => {
  let report: ProbeReport;
  let probeExitCode = -1;
  let probeDurationSec = 0;

  beforeAll(() => {
    const t0 = Date.now();
    const res = spawnSync(
      'npx',
      ['tsx', PROBE_SCRIPT],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          PROBE_N: process.env.PROBE_N ?? '50',
          PROBE_WARMUP: process.env.PROBE_WARMUP ?? '10',
        },
        encoding: 'utf-8',
        timeout: PROBE_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    probeExitCode = res.status ?? -1;
    probeDurationSec = (Date.now() - t0) / 1000;

    if (probeExitCode !== 0) {
      // Surface probe stderr/stdout so CI logs show what actually went wrong.
      const stderr = res.stderr ?? '';
      const stdout = (res.stdout ?? '').slice(0, 4000);
      throw new Error(
        `probe exited with code ${probeExitCode} after ${probeDurationSec.toFixed(2)}s.\n` +
          `--- stderr ---\n${stderr}\n--- stdout (first 4KB) ---\n${stdout}`,
      );
    }
    if (!existsSync(REPORT_PATH)) {
      throw new Error(
        `probe exited 0 but ${REPORT_PATH} not written (duration=${probeDurationSec.toFixed(2)}s)`,
      );
    }
    report = JSON.parse(readFileSync(REPORT_PATH, 'utf-8')) as ProbeReport;
    // Sanity-check JSON shape so a silent probe regression in the report
    // schema fails loud here.
    if (typeof report.cumulative_savings_p50_ms !== 'number') {
      throw new Error(
        `report missing or non-numeric cumulative_savings_p50_ms: ${JSON.stringify(report).slice(0, 200)}`,
      );
    }
    if (!Array.isArray(report.per_layer_audit_vs_measured)) {
      throw new Error(
        `report missing per_layer_audit_vs_measured array: ${JSON.stringify(report).slice(0, 200)}`,
      );
    }
  }, PROBE_TIMEOUT_MS + 10_000);

  afterAll(() => {
    // In CI, keep the JSON so the workflow's
    // `.github/workflows/probe-regression.yml` artifact-upload step can
    // publish /tmp/probe-chat-route.json for PR-comment diffs. Local
    // devs (CI unset, including PROBE_CI=1 manual smoke runs) still get
    // cleanup so their /tmp doesn't accumulate stale reports across
    // repeated runs.
    if (existsSync(REPORT_PATH) && !process.env.CI) {
      try {
        unlinkSync(REPORT_PATH);
      } catch {
        // cleanup is best-effort; failure here shouldn't fail the test
      }
    }
  });

  // ----------------------------------------------------------------- CUMULATIVE
  it(
    'cumulative_savings_p50_ms stays <= sum(audit_high) * 1.25',
    () => {
      const cumP50 = report.cumulative_savings_p50_ms;
      // Compute the upper budget from PER_LAYER_CLAIMS.high (not a
      // hardcoded layer count of 5) so the threshold stays in sync as the
      // manifest grows. In the current 4-layer state: 15+30+100+65 = 210,
      // \u00b7 1.25 = 262.5ms ceiling \u2014 covers the prior 242ms overflow
      // (post-calibration target ~135ms is well below).
      const CUM_OVER_BUDGET_THRESHOLD_MS =
        Object.values(PER_LAYER_CLAIMS).reduce((acc, c) => acc + c.high, 0) *
        OVER_BUDGET_FACTOR;
      const zoom = report.per_layer_audit_vs_measured
        .map((r) => `${r.layer}: ${r.measured_saved_p50_ms.toFixed(2)}ms`)
        .join(', ');
      const stamp = new Date().toISOString();
      expect(
        cumP50,
        `[${stamp}] CUMULATIVE OVER-BUDGET: cum_p50=${cumP50.toFixed(2)}ms > sum(audit_high)*\u00b7${OVER_BUDGET_FACTOR}=${CUM_OVER_BUDGET_THRESHOLD_MS.toFixed(1)}ms ` +
          `(probe took ${probeDurationSec.toFixed(2)}s) \u2014 per-layer zoom (saved_p50): ${zoom}`,
      ).toBeLessThanOrEqual(CUM_OVER_BUDGET_THRESHOLD_MS);
    },
  );
  it(
    'cumulative_savings_p50_ms stays >= audit_low * (1 - tolerance)',
    () => {
      const cumP50 = report.cumulative_savings_p50_ms;
      const zoom = report.per_layer_audit_vs_measured
        .map((r) => `${r.layer}: ${r.measured_saved_p50_ms.toFixed(2)}ms`)
        .join(', ');
      const stamp = new Date().toISOString();
      expect(
        cumP50,
        `[${stamp}] REGRESSION: cum_p50=${cumP50.toFixed(2)}ms < audit_low*\u00b7(1\u2212${TOLERANCE_FRACTION})=${CUM_P50_THRESHOLD_MS}ms ` +
          `(probe took ${probeDurationSec.toFixed(2)}s) \u2014 per-layer zoom (saved_p50): ${zoom}`,
      ).toBeGreaterThanOrEqual(CUM_P50_THRESHOLD_MS);
    },
  );

  // ------------------------------------------------------------ PER-LAYER CHECKS
  // Use a per-layer loop so the name of each layer shows up in the vitest
  // failure list, making CI logs drill-downable.
  const layerNames = Object.keys(PER_LAYER_CLAIMS);
  // Per-layer OVER-BUDGET factor — measured_saved_p50_ms must stay within
  // audit_high * this factor; otherwise stub internal-latency is
  // double-counting with the wrapper (the prior calibration bug).
  const OVER_BUDGET_FACTOR = 1.25;
  for (const layer of layerNames) {
    it(`${layer} measured_saved_p50_ms sits inside audit [low, high*\u00b7${OVER_BUDGET_FACTOR}]`, () => {
      const entry = report.per_layer_audit_vs_measured.find((r) => r.layer === layer);
      if (!entry) {
        throw new Error(
          `probe report is missing layer "${layer}". Known layers: ${report.per_layer_audit_vs_measured
            .map((r) => r.layer)
            .join(', ')}`,
        );
      }
      const claim = PER_LAYER_CLAIMS[layer];
      // Lower bound: regression — measured < audit_low means savings shrunk.
      expect(
        entry.measured_saved_p50_ms,
        `[${new Date().toISOString()}] REGRESSION on layer ${layer}: ` +
          `measured=${entry.measured_saved_p50_ms.toFixed(2)}ms < audit_low=${claim.low}ms. ` +
          `Either the layer's parallelism was reverted, or the stub latency drifted from manifest.`,
      ).toBeGreaterThanOrEqual(claim.low);
      // Upper bound: over-budget — measured > audit_high * 1.25 means the
      // stub-internal latency is double-counting with the wrapper. The
      // prior calibration bug (Tier 1 #1 measured 121ms vs audit_high 100ms,
      // Tier 1 #3 measured 91ms vs audit_high 65ms) is exactly what this
      // guard catches \u2014 fail loudly so the regression surfaces immediately
      // instead of slipping past as a soft warn.
      const upperThreshold = claim.high * OVER_BUDGET_FACTOR;
      expect(
        entry.measured_saved_p50_ms,
        `[${new Date().toISOString()}] OVER-BUDGET on layer ${layer}: ` +
          `measured=${entry.measured_saved_p50_ms.toFixed(2)}ms > audit_high*\u00b7${OVER_BUDGET_FACTOR}=${upperThreshold.toFixed(1)}ms. ` +
          `Stub latency in probe-stub-manifest.ts is likely double-counting \u2014 see prior calibration note.`,
      ).toBeLessThanOrEqual(upperThreshold);
    });
  }

  // ------------------------------------------------------- ARCHITECTURE MARKER
  it('probe architecture marker is v4 (module-hooks-driven stub-loader)', () => {
    const arch = (report as unknown as { architecture?: string }).architecture;
    expect(arch, 'probe architecture marker mismatched; expected "v4 ..."').toMatch(
      /^v4 /,
    );
  });
}, PROBE_TIMEOUT_MS + 10_000);
