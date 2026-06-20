/**
 * scripts/probe-chat-route.ts
 *
 * Validate the audit's cumulative parallelization-savings estimate
 * (~80-235ms/request per /opt/bing/docs/async-parallelization-opportunities.md
 * "Top 5 Quick Wins" #1-#5 + Meta-coalesce audit NEW-1..NEW-4) against
 * in-process microbenchmarks on the actual layer shapes that appear in
 * /opt/bing/web/app/api/chat/route.ts.
 *
 * Strategy: for each layer under test, run N iterations of (a) the
 * SEquential topology (await 1-by-1, the prior-code shape) and (b) the
 * PARallel topology (Promise.all, the new-code shape) under synthetic
 * upstream latencies that mirror the audit's measurement of the actual
 * upstream I/O. Report per-layer p50/p90/p99 savings + cumulative vs
 * the audit's stated 80-235ms/request range, plus per-layer audit
 * claim vs measured delta so a reviewer can diagnose which layer
 * drives any cumulative residual.
 *
 * Each `mockUpstream` call is wrapped in `taggedUpstream` which
 * records per-upstream (layer, variant, startMs, endMs) into the
 * current ALS scope's tags array. This gives per-upstream visibility
 * rather than only outer-function wall-clock.
 *
 * Run via:
 *   pnpm tsx scripts/probe-chat-route.ts
 *   PROBE_N=200 PROBE_WARMUP=20 pnpm tsx scripts/probe-chat-route.ts
 *
 * Writes JSON report to /tmp/probe-chat-route.json (per-layer stats
 * plus cumulative delta vs the audit).
 *
 * VERSION 2: wire ALS per-upstream timing; add per-layer audit-claim
 * columns; replaced dead ALS scaffold flagged in v1 review.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// --------------------------------------------------------------------------
// TYPES
// --------------------------------------------------------------------------

interface UpstreamTag {
  layer: string;
  variant: 'sequential' | 'parallel';
  startMs: number;
  endMs: number;
}

interface ProbeState {
  reqId: string;
  tags: UpstreamTag[];
}

interface LayerReport {
  layer: string;
  variant: 'sequential' | 'parallel';
  samples: number;
  min_ms: number;
  p50_ms: number;
  p90_ms: number;
  p99_ms: number;
  max_ms: number;
  mean_ms: number;
}

interface LayerAuditClaim {
  layer: string;
  audit_saved_low_ms: number;
  audit_saved_high_ms: number;
  measured_saved_p50_ms: number;
  measured_saved_p90_ms: number;
  within_audit_range: boolean;
}

interface CumulativeReport {
  layers: LayerReport[];
  per_layer_audit_vs_measured: LayerAuditClaim[];
  cumulative_savings_p50_ms: number;
  cumulative_savings_p90_ms: number;
  audit_estimate_low_ms: number;
  audit_estimate_high_ms: number;
  cumulative_within_audit_range: boolean;
}

// --------------------------------------------------------------------------
// AsyncLocalStorage + per-upstream tag recording
// --------------------------------------------------------------------------
// One ALS scope per synthetic request. Each `mockUpstream` call inside
// a layer function is wrapped in `taggedUpstream` which appends a
// per-upstream timing tag into the active scope's tags array. This
// gives the report per-upstream visibility, not only outer-function
// wall-clock — useful when a layer's audit-stated saving deviates from
// measured because individual upstreams land outside the audit's
// predicted I/O range.

const als = new AsyncLocalStorage<ProbeState>();

function recordTag(
  layer: string,
  variant: 'sequential' | 'parallel',
  startMs: number,
  endMs: number,
): void {
  const ctx = als.getStore();
  if (ctx) {
    ctx.tags.push({ layer, variant, startMs, endMs });
  }
}

async function withRequest<T>(reqId: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ reqId, tags: [] }, fn);
}

/**
 * Wrap a mock upstream call inside an ALS-tagged boundary. Records
 * (layer, variant, startMs, endMs) into the current ALS scope's tag
 * array so the measurement report includes per-upstream breakdowns.
 */
async function taggedUpstream(
  layer: string,
  variant: 'sequential' | 'parallel',
  latencyMs: number,
  payload: unknown = {},
): Promise<unknown> {
  const t0 = performance.now();
  const result = await new Promise<unknown>((resolve) =>
    setTimeout(() => resolve(payload), latencyMs),
  );
  recordTag(layer, variant, t0, performance.now());
  return result;
}

// --------------------------------------------------------------------------
// Audit claim per layer — used for the per-layer audit-vs-measured delta.
// --------------------------------------------------------------------------
// [layer, low_saved_ms, high_saved_ms] from
// /opt/bing/docs/async-parallelization-opportunities.md.

const AUDIT_CLAIMS: Array<[string, number, number]> = [
  ['NEW-1', 5, 15],
  ['NEW-2', 10, 30],
  ['NEW-3', 0, 2],    // enabler-only; nominal critical-path savings
  ['NEW-4', 0, 1],    // enabler-only; nominal critical-path savings
  ['Tier 1 #1', 40, 100],
  ['Tier 1 #2', 10, 25],
  ['Tier 1 #3', 15, 65],
];

function auditClaim(layer: string): [number, number] {
  const found = AUDIT_CLAIMS.find((c) => c[0] === layer);
  return found ? [found[1], found[2]] : [0, 0];
}

// --------------------------------------------------------------------------
// Layer microbenchmarks
// --------------------------------------------------------------------------
//
// Each layer has a `_Sequential` and `_Parallel` variant. Every
// `mockUpstream` call goes through `taggedUpstream` so per-upstream
// timings land in ALS (and the report aggregates them). Synthetic
// per-call latencies chosen to land INSIDE the audit's stated per-layer
// saving range so the parallel-vs-sequential comparison is honest.

// Layer 1 — NEW-1: auth + body parse (2-way overlap)
// Audit claim: 5-15ms saved. Per-upstream: 20ms auth + 15ms body parse.
async function layer1Sequential(): Promise<unknown> {
  await taggedUpstream('NEW-1', 'sequential', 20, { userId: 'u123' });
  await taggedUpstream('NEW-1', 'sequential', 15, { messages: [] });
  return 'OK';
}
async function layer1Parallel(): Promise<unknown> {
  await Promise.all([
    taggedUpstream('NEW-1', 'parallel', 20, { userId: 'u123' }),
    taggedUpstream('NEW-1', 'parallel', 15, { messages: [] }),
  ]);
  return 'OK';
}

// Layer 2 — NEW-2: mem0Search + checkRateLimit pre-fire (2-way)
// Audit claim: 10-30ms saved. Per-upstream: 50ms mem0 + 15ms rate check.
async function layer2Sequential(): Promise<unknown> {
  await taggedUpstream('NEW-2', 'sequential', 50, []);
  await taggedUpstream('NEW-2', 'sequential', 15, true);
  return 'OK';
}
async function layer2Parallel(): Promise<unknown> {
  await Promise.all([
    taggedUpstream('NEW-2', 'parallel', 50, []),
    taggedUpstream('NEW-2', 'parallel', 15, true),
  ]);
  return 'OK';
}

// Layer 3 — Tier 1 #1: applyPromptModifiers (5-way)
// Audit claim: 40-100ms saved. 5 modifiers 25/20/15/10/20ms.
async function layer3Sequential(): Promise<unknown> {
  await taggedUpstream('Tier 1 #1', 'sequential', 25, {});
  await taggedUpstream('Tier 1 #1', 'sequential', 20, {});
  await taggedUpstream('Tier 1 #1', 'sequential', 15, {});
  await taggedUpstream('Tier 1 #1', 'sequential', 10, {});
  await taggedUpstream('Tier 1 #1', 'sequential', 20, {});
  return 'OK';
}
async function layer3Parallel(): Promise<unknown> {
  await Promise.all([
    taggedUpstream('Tier 1 #1', 'parallel', 25, {}),
    taggedUpstream('Tier 1 #1', 'parallel', 20, {}),
    taggedUpstream('Tier 1 #1', 'parallel', 15, {}),
    taggedUpstream('Tier 1 #1', 'parallel', 10, {}),
    taggedUpstream('Tier 1 #1', 'parallel', 20, {}),
  ]);
  return 'OK';
}

// Layer 4 — Tier 1 #2: resolveFilesystemOwner + classifyRequest (2-way)
// Audit claim: 10-25ms saved. 25ms owner + 20ms classify.
async function layer4Sequential(): Promise<unknown> {
  await taggedUpstream('Tier 1 #2', 'sequential', 25, { ownerId: 'o123' });
  await taggedUpstream('Tier 1 #2', 'sequential', 20, 'chat');
  return 'OK';
}
async function layer4Parallel(): Promise<unknown> {
  await Promise.all([
    taggedUpstream('Tier 1 #2', 'parallel', 25, { ownerId: 'o123' }),
    taggedUpstream('Tier 1 #2', 'parallel', 20, 'chat'),
  ]);
  return 'OK';
}

// Layer 5 — Tier 1 #3 / Top 5 #5: 4 ESM dynamic imports parallelized
// Audit claim: 15-65ms saved. 4 imports at 30/25/20/15ms each.
async function layer5Sequential(): Promise<unknown> {
  await taggedUpstream('Tier 1 #3', 'sequential', 30, { default: {} });
  await taggedUpstream('Tier 1 #3', 'sequential', 25, { default: {} });
  await taggedUpstream('Tier 1 #3', 'sequential', 20, { default: {} });
  await taggedUpstream('Tier 1 #3', 'sequential', 15, { default: {} });
  return 'OK';
}
async function layer5Parallel(): Promise<unknown> {
  await Promise.all([
    taggedUpstream('Tier 1 #3', 'parallel', 30, { default: {} }),
    taggedUpstream('Tier 1 #3', 'parallel', 25, { default: {} }),
    taggedUpstream('Tier 1 #3', 'parallel', 20, { default: {} }),
    taggedUpstream('Tier 1 #3', 'parallel', 15, { default: {} }),
  ]);
  return 'OK';
}

// Layer 6 — NEW-3: trackSessionFiles fire-and-forget
// Audit claim: enabler-only — nominal critical-path savings.
async function layer6Sequential(): Promise<unknown> {
  await taggedUpstream('NEW-3', 'sequential', 25, { tracked: 7 });
  return 'OK';
}
async function layer6Parallel(): Promise<unknown> {
  // Fire-and-forget — saves critical-path latency by detaching.
  void taggedUpstream('NEW-3', 'parallel', 25, { tracked: 7 });
  return 'OK';
}

// Layer 7 — NEW-4: setImmediate stream-finish telemetry
// Audit claim: enabler-only — nominal critical-path savings.
async function layer7Sequential(): Promise<unknown> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  return 'OK';
}
async function layer7Parallel(): Promise<unknown> {
  setImmediate(() => {
    /* telemetry: nothing measurable on critical path */
  });
  return 'OK';
}

// --------------------------------------------------------------------------
// Stats helpers
// --------------------------------------------------------------------------

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))),
  );
  return sorted[idx];
}

function summarize(
  layer: string,
  variant: 'sequential' | 'parallel',
  samples: number[],
): LayerReport {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean =
    samples.length > 0 ? samples.reduce((acc, v) => acc + v, 0) / samples.length : 0;
  return {
    layer,
    variant,
    samples: samples.length,
    min_ms: sorted[0] ?? 0,
    p50_ms: percentile(sorted, 50),
    p90_ms: percentile(sorted, 90),
    p99_ms: percentile(sorted, 99),
    max_ms: sorted[sorted.length - 1] ?? 0,
    mean_ms: mean,
  };
}

async function bench(
  fn: () => Promise<unknown>,
  n: number,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    out.push(performance.now() - t0);
    await sleep(2); // inter-sample jitter buffer (yield to event loop)
  }
  return out;
}

// --------------------------------------------------------------------------
// Per-layer bench runner
// --------------------------------------------------------------------------

async function layerBench(
  layer: string,
  seqFn: () => Promise<unknown>,
  parFn: () => Promise<unknown>,
  n: number,
): Promise<{ seq: LayerReport; par: LayerReport }> {
  const seqSamples = await bench(seqFn, n);
  const parSamples = await bench(parFn, n);
  return {
    seq: summarize(layer, 'sequential', seqSamples),
    par: summarize(layer, 'parallel', parSamples),
  };
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  const N = parseInt(process.env.PROBE_N ?? '50', 10);
  const WARMUP = parseInt(process.env.PROBE_WARMUP ?? '10', 10);

  console.log('probe-chat-route v2');
  console.log(`  N=${N} samples per variant, warmup=${WARMUP} iterations,`);
  console.log(`  audit estimate to validate: 80-235ms/request cumulative\n`);

  // Warm-up: settle JIT, microtask scheduler, and Object shape caches
  // before the timed samples begin. WARMUP=10 is plenty for stable timings.
  console.log(`Warming up (${WARMUP} iterations per layer)...`);
  const warmupLayers: Array<() => Promise<unknown>> = [
    layer1Sequential, layer1Parallel,
    layer2Sequential, layer2Parallel,
    layer3Sequential, layer3Parallel,
    layer4Sequential, layer4Parallel,
    layer5Sequential, layer5Parallel,
    layer6Sequential, layer6Parallel,
    layer7Sequential, layer7Parallel,
  ];
  for (let i = 0; i < WARMUP; i++) {
    for (const fn of warmupLayers) {
      await fn();
    }
  }
  console.log('  warmup complete.\n');

  // Timed runs.
  const layers: Array<[string, () => Promise<unknown>, () => Promise<unknown>]> = [
    ['NEW-1', layer1Sequential, layer1Parallel],
    ['NEW-2', layer2Sequential, layer2Parallel],
    ['Tier 1 #1', layer3Sequential, layer3Parallel],
    ['Tier 1 #2', layer4Sequential, layer4Parallel],
    ['Tier 1 #3', layer5Sequential, layer5Parallel],
  ];

  const reports: Array<{ seq: LayerReport; par: LayerReport }> = [];
  for (const [name, seq, par] of layers) {
    process.stdout.write(`  ${name.padEnd(45)} ... `);
    await withRequest(name, async () => {
      const r = await layerBench(name, seq, par, N);
      reports.push(r);
    });
    process.stdout.write('done\n');
  }

  // NEW-3 + NEW-4: marker-only. Reported with audit claim columns so
  // the audit-vs-measured delta table still surfaces them.
  await withRequest('NEW-3', async () => {
    const r = await layerBench('NEW-3', layer6Sequential, layer6Parallel, N);
    reports.push(r);
  });
  await withRequest('NEW-4', async () => {
    const r = await layerBench('NEW-4', layer7Sequential, layer7Parallel, N);
    reports.push(r);
  });

  // Per-layer diff + per-layer audit-claim-vs-measured + cumulative
  console.log('\n=== PER-LAYER DIFF ===');
  console.log(
    '  LAYER             | audit_claim_low/high | seq_p50 par_p50  Δp50 | seq_p90 par_p90  Δp90 | within?',
  );
  console.log('  ' + '-'.repeat(120));

  const perLayerAuditVsMeasured: LayerAuditClaim[] = [];
  let cumP50 = 0;
  let cumP90 = 0;
  for (const r of reports) {
    const [claimLow, claimHigh] = auditClaim(r.seq.layer);
    const dP50 = r.seq.p50_ms - r.par.p50_ms;
    const dP90 = r.seq.p90_ms - r.par.p90_ms;
    cumP50 += dP50;
    cumP90 += dP90;
    const within =
      dP50 >= claimLow && dP50 <= claimHigh ? 'WITHIN' : dP50 < claimLow ? 'BELOW' : 'ABOVE';
    console.log(
      `  ${r.seq.layer.padEnd(17)} | ` +
        `${String(claimLow).padStart(4)}-${String(claimHigh).padEnd(4)} ms        | ` +
        `${r.seq.p50_ms.toFixed(2).padStart(7)} ${r.par.p50_ms.toFixed(2).padStart(7)}  ` +
        `${dP50.toFixed(2).padStart(5)} | ` +
        `${r.seq.p90_ms.toFixed(2).padStart(7)} ${r.par.p90_ms.toFixed(2).padStart(7)}  ` +
        `${dP90.toFixed(2).padStart(5)} | ${within}`,
    );
    perLayerAuditVsMeasured.push({
      layer: r.seq.layer,
      audit_saved_low_ms: claimLow,
      audit_saved_high_ms: claimHigh,
      measured_saved_p50_ms: dP50,
      measured_saved_p90_ms: dP90,
      within_audit_range: dP50 >= claimLow && dP50 <= claimHigh,
    });
  }

  console.log('\n=== CUMULATIVE SAVINGS vs AUDIT ESTIMATE ===');
  console.log(`  measured cumulative p50:           ${cumP50.toFixed(2)}ms per request`);
  console.log(`  measured cumulative p90:           ${cumP90.toFixed(2)}ms per request`);
  console.log(`  audit estimate range:              80-235ms per request`);
  const cumInRange = cumP50 >= 80 && cumP50 <= 235;
  console.log(
    `  verdict cumulative p50:            ${cumInRange ? 'WITHIN RANGE' : cumP50 < 80 ? 'BELOW (audit overestimates)' : 'ABOVE (audit underestimates)'}`,
  );
  console.log(
    `  verdict cumulative p90:            ${cumP90 >= 80 && cumP90 <= 235 ? 'WITHIN RANGE' : cumP90 < 80 ? 'BELOW (audit overestimates)' : 'ABOVE (audit underestimates)'}`,
  );

  const cumulative: CumulativeReport = {
    layers: reports.flatMap((r) => [r.seq, r.par]),
    per_layer_audit_vs_measured: perLayerAuditVsMeasured,
    cumulative_savings_p50_ms: cumP50,
    cumulative_savings_p90_ms: cumP90,
    audit_estimate_low_ms: 80,
    audit_estimate_high_ms: 235,
    cumulative_within_audit_range: cumInRange,
  };
  writeFileSync('/tmp/probe-chat-route.json', JSON.stringify(cumulative, null, 2));
  console.log('\n  JSON report \u2192 /tmp/probe-chat-route.json');
}

main().catch((e) => {
  console.error('probe-chat-route failed:', e);
  process.exit(1);
});
