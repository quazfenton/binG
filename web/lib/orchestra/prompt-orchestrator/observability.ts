/**
 * prompt-orchestrator/observability.ts
 *
 * Tier 8 step 8 — observability/metrics for the prompt-orchestrator foundation.
 *
 * Public API:
 *   - `observeApplyScript(target, script, source)`: drop-in observability wrapper
 *     around `applyScript`. Per-step attributed injection / idempotency-skip
 *     counters + sha-aware pre-classification matching applyScript's actual
 *     behavior + wall-time duration + post-call marker-count gauge.
 *   - `serializeMetrics()`: returns Prometheus exposition text (version 0.0.4)
 *     for `GET /api/orchestra/prompt-orchestrator/metrics`.
 *
 * @internal helpers (NOT re-exported from `index.ts`; used only by unit tests
 * and future direct callers who need to drive metrics without going through
 * the wrapper):
 *   - recordInjection / recordIdempotencySkip / observeApplyDurationMs /
 *     setMarkerCount / recordScriptsLoaded
 *   - getInjectionCount / getIdempotencySkipCount / getMarkerCount /
 *     getScriptsLoadedCount
 *   - resetMetrics
 *   - applyScript (re-export for test #4 that pre-populates a target; not
 *     intended as a primary entry point — most callers should use the facade)
 *
 * Per-step attribution discipline:
 *   Each `script.steps[*]` is classified independently using applyScript's own
 *   `(promptId, step, sha)` key. Each skip records under its OWN step name;
 *   each inject under its OWN mode. A 3-step script that injects 2 + skips 1
 *   produces THREE counter lines, not one (fixes the v1 firstStepName bug).
 *
 * SHA-aware pre-classification:
 *   Pre-classification replicates applyScript's idempotency logic exactly.
 *   A step whose payload has been edited (different sha from the previous
 *   injection) is classified as INJECTION — matching what applyScript does
 *   at runtime so the counter never diverges from actual behavior.
 *
 * Cardinality:
 *   - `sha` is NOT a label (would explode label cardinality past Prometheus's
 *     10K combinations/metric ceiling — every payload edit yields a fresh
 *     SHA-256 hex).
 *   - `mode` is on the injection counter because InsertMode is a bounded
 *     3-value union (append / after-divider / replace-block).
 *
 * State:
 *   In-memory JavaScript Maps. Resets on dev-server restart. Acceptable
 *   for operator-debug scope per the spec at
 *   docs/prompt-orchestrator-deferred-steps.md#L20 (RI0 threshold ~10 QPS).
 *
 * Boot-without-prompt-orchestrator contract:
 *   Workshops wanting strict isolation (e.g. `.bing-shared/scheduler/triggers`
 *   trigger manager) should NOT import this file at module top — they should
 *   dynamic-import it alongside scanMarkers/applyScript so the scheduler
 *   still boots when the orchestrator is absent. See
 *   `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts`'s
 *   `observeApplyScriptFn` injection option for the test-friendly pattern.
 *
 * Markers-in-history gauge (last-observed-value semantics):
 *   `prompt_markers_in_history{source=...}` is the LAST observed marker count
 *   for that source — passive "last writer wins". A stale call (50 markers)
 *   then a recent call (0 markers) will leave the gauge at 50 until the next
 *   call. HELP line documents this caveat; a future PR can upgrade to a
 *   `{count, observedAt}` tuple with freshness-cache eviction if SRE
 *   alerting requires it.
 */
import { scanMarkers, idempotencyKey } from './marker-scanner';
import { applyScript, calculateSha } from './injection-planner';
import type { PromptScript } from './types';

// ─── Module-level state (in-memory; resets on process restart) ──────────────

type InjectionKey = `${string}|${string}|${string}`; // source|promptId|mode
type IdempotencyKey = `${string}|${string}|${string}`; // source|promptId|step
type DurationKey = `${string}|${string}`; // source|promptId

/**
 * Cardinality caps (long-running process memory bound):
 *   - MAX_KEYS_PER_MAP caps the per-counter Map size. When the cap is hit
 *     and a NEW key is being inserted, the OLDEST key (FIFO via Map
 *     insertion order) is evicted first. This bounds memory in the face of
 *     unbounded `(source, promptId, mode|step)` label combinations. With
 *     ~2-3 sources + ~10-30 promptIds + 3 modes / ~5 steps typical, the
 *     maps hold <500 keys in practice; 10k is a generous safety ceiling
 *     for label-explosion scenarios. Promote to LRU + per-process metrics
 *     if SRE alerting needs different eviction semantics.
 *   - MAX_SAMPLES_PER_KEY caps the per-(source,promptId) duration window.
 *     When the cap is hit, the OLDEST sample is shifted out (FIFO).
 */
const MAX_KEYS_PER_MAP = 10_000;
const _injectionCounts = new Map<InjectionKey, number>();
const _idempotencySkipCounts = new Map<IdempotencyKey, number>();
/**
 * Rolling samples per (source, promptId). Capped at MAX_SAMPLES to bound
 * memory — when the cap hits, the OLDEST sample is shifted out (FIFO).
 */
const _applyDurations = new Map<DurationKey, number[]>();
const MAX_SAMPLES_PER_KEY = 1000;

/** Per-source marker-count gauge (last-observed-value; passive last-wins). */
const _markerCountGauge = new Map<string, number>();
/** Set of distinct script.promptId values — powers the scripts_loaded gauge. */
const _scriptsLoaded = new Set<string>();

const _kInjection = (source: string, promptId: string, mode: string): InjectionKey =>
  `${source}|${promptId}|${mode}` as InjectionKey;
const _kIdempotency = (source: string, promptId: string, step: string): IdempotencyKey =>
  `${source}|${promptId}|${step}` as IdempotencyKey;
const _kDuration = (source: string, promptId: string): DurationKey =>
  `${source}|${promptId}` as DurationKey;

// ─── @internal: recording helpers (NOT re-exported from index.ts) ───────────

/** @internal — testing seam + future direct callers. */
export function recordInjection(source: string, promptId: string, mode: string): void {
  const k = _kInjection(source, promptId, mode);
  // FIFO eviction: if the Map is at the cardinality cap AND this is a new
  // key, drop the oldest entry before inserting. Existing-key increments
  // (the common hot-path case) are unaffected.
  if (!_injectionCounts.has(k) && _injectionCounts.size >= MAX_KEYS_PER_MAP) {
    const oldest = _injectionCounts.keys().next().value;
    if (oldest !== undefined) _injectionCounts.delete(oldest);
  }
  _injectionCounts.set(k, (_injectionCounts.get(k) ?? 0) + 1);
}

/** @internal — testing seam + future direct callers. */
export function recordIdempotencySkip(source: string, promptId: string, step: string): void {
  const k = _kIdempotency(source, promptId, step);
  if (!_idempotencySkipCounts.has(k) && _idempotencySkipCounts.size >= MAX_KEYS_PER_MAP) {
    const oldest = _idempotencySkipCounts.keys().next().value;
    if (oldest !== undefined) _idempotencySkipCounts.delete(oldest);
  }
  _idempotencySkipCounts.set(k, (_idempotencySkipCounts.get(k) ?? 0) + 1);
}

/** @internal — testing seam + future direct callers. */
export function observeApplyDurationMs(source: string, promptId: string, durationMs: number): void {
  const k = _kDuration(source, promptId);
  const arr = _applyDurations.get(k) ?? [];
  if (arr.length >= MAX_SAMPLES_PER_KEY) arr.shift();
  arr.push(durationMs);
  _applyDurations.set(k, arr);
}

/** @internal — testing seam + future direct callers. */
export function setMarkerCount(source: string, count: number): void {
  _markerCountGauge.set(source, count);
}

/** @internal — testing seam + future direct callers. */
export function recordScriptsLoaded(promptId: string): void {
  _scriptsLoaded.add(promptId);
}

// ─── @internal: read-side helpers (NOT re-exported from index.ts) ───────────

/** @internal — testing seam + future direct callers. */
export function getInjectionCount(source: string, promptId: string, mode: string): number {
  return _injectionCounts.get(_kInjection(source, promptId, mode)) ?? 0;
}

/** @internal — testing seam + future direct callers. */
export function getIdempotencySkipCount(source: string, promptId: string, step: string): number {
  return _idempotencySkipCounts.get(_kIdempotency(source, promptId, step)) ?? 0;
}

/** @internal — testing seam + future direct callers. */
export function getMarkerCount(source: string): number {
  return _markerCountGauge.get(source) ?? 0;
}

/** @internal — testing seam + future direct callers. */
export function getScriptsLoadedCount(): number {
  return _scriptsLoaded.size;
}

/** @internal — testing seam (clears all in-memory state between cases). */
export function resetMetrics(): void {
  _injectionCounts.clear();
  _idempotencySkipCounts.clear();
  _applyDurations.clear();
  _markerCountGauge.clear();
  _scriptsLoaded.clear();
}

// ─── The wrapper: drop-in observability for `applyScript` ───────────────────

/**
 * Drop-in wrapper around `applyScript` that records observability metrics
 * around the call. Semantically identical to `applyScript`:
 *   const out = observeApplyScript(target, script, source);
 * is one-to-one with
 *   const out = applyScript(target, script);
 * modulo the side effects above (counter / gauge / duration updates).
 *
 * Each `script.steps[*]` is classified independently using applyScript's own
 * idempotency logic: we compute the sha-256 of the step's payload, build
 * the same `(promptId, step, sha)` key that applyScript uses, and check
 * against `scanMarkers(target)`. Each skip records under its own step name;
 * each inject under its own mode. A step whose payload has been edited
 * (different sha from a previous injection) is treated as a new INJECTION —
 * matching applyScript's behavior so the counts never diverge.
 *
 * Throws whatever `applyScript` throws (e.g. on unknown InsertMode). The
 * wrapper does NOT swallow errors — a fall-through-no-record would hide
 * a failure from the operator. Callers should keep their existing try/catch.
 */
export function observeApplyScript(
  target: string,
  script: PromptScript,
  source: string,
): string {
  // 1. Pre-compute the (promptId, step, sha) keys already present. Mirrors
  //    applyScript's idempotency logic exactly so the wrapper's classification
  //    matches applyScript's actual behavior.
  const existingKeys = new Set(
    scanMarkers(target).map((m) => idempotencyKey(m.promptId, m.step, m.sha)),
  );

  // 2. Per-step classification. Each step records under its OWN label key.
  for (const step of script.steps) {
    const sha = calculateSha(step.payload);
    const key = idempotencyKey(script.promptId, step.step, sha);
    if (existingKeys.has(key)) {
      recordIdempotencySkip(source, script.promptId, step.step);
    } else {
      recordInjection(source, script.promptId, step.mode ?? 'append');
    }
  }
  recordScriptsLoaded(script.promptId);

  // 3. Time the pure applyScript call.
  const t0 = performance.now();
  const out = applyScript(target, script);
  const dt = performance.now() - t0;
  observeApplyDurationMs(source, script.promptId, dt);

  // 4. Update marker-count gauge. Passive last-wins; HELP line documents caveat.
  setMarkerCount(source, scanMarkers(out).length);
  return out;
}

// ─── Prometheus exposition text formatter ───────────────────────────────────

/**
 * Escape a label value: backslash + double-quote + newline.
 */
function _escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Serialize in-memory state as Prometheus exposition text format (v0.0.4).
 * Cardinality-discipline: no `sha` label, bounded `mode` union.
 */
export function serializeMetrics(): string {
  const lines: string[] = [];
  // 1. prompt_injection_total — counter (per-step attribution; sha dedupe)
  lines.push('# HELP prompt_injection_total Number of new PO-INJECT markers appended to a target. Per-step attribution; pre-classification uses `(promptId, step, sha)` matching applyScript so payload-edits count as INJECTION not SKIP.');
  lines.push('# TYPE prompt_injection_total counter');
  for (const [k, v] of _injectionCounts.entries()) {
    const [source, promptId, mode] = k.split('|');
    lines.push(
      `prompt_injection_total{source="${_escapeLabelValue(source)}",promptId="${_escapeLabelValue(promptId)}",mode="${_escapeLabelValue(mode)}"} ${v}`,
    );
  }
  // 2. prompt_idempotency_skip_total — counter (per-step attributed)
  lines.push('# HELP prompt_idempotency_skip_total Number of step conflicts resolved by SHA-256 idempotency (no-op). Per-step attribution.');
  lines.push('# TYPE prompt_idempotency_skip_total counter');
  for (const [k, v] of _idempotencySkipCounts.entries()) {
    const [source, promptId, step] = k.split('|');
    lines.push(
      `prompt_idempotency_skip_total{source="${_escapeLabelValue(source)}",promptId="${_escapeLabelValue(promptId)}",step="${_escapeLabelValue(step)}"} ${v}`,
    );
  }
  // 3. prompt_apply_duration_seconds — summary (count + sum + p50 + p99)
  lines.push('# HELP prompt_apply_duration_seconds Apply-script wall-clock duration in seconds (summary: count + sum + p50 + p99 quantiles; not a true bucketed histogram). Cardinality: 1 series per (source, promptId).');
  lines.push('# TYPE prompt_apply_duration_seconds summary');
  for (const [k, samples] of _applyDurations.entries()) {
    const [source, promptId] = k.split('|');
    const n = samples.length;
    const sumSec = samples.reduce((a, b) => a + b, 0) / 1000;
    const sorted = [...samples].sort((a, b) => a - b);
    const p50Ms = n > 0 ? sorted[Math.min(Math.floor(n * 0.5), n - 1)] : 0;
    const p99Ms = n > 0 ? sorted[Math.min(Math.floor(n * 0.99), n - 1)] : 0;
    lines.push(
      `prompt_apply_duration_seconds{source="${_escapeLabelValue(source)}",promptId="${_escapeLabelValue(promptId)}",quantile="0.5"} ${(p50Ms / 1000).toFixed(6)}`,
    );
    lines.push(
      `prompt_apply_duration_seconds{source="${_escapeLabelValue(source)}",promptId="${_escapeLabelValue(promptId)}",quantile="0.99"} ${(p99Ms / 1000).toFixed(6)}`,
    );
    lines.push(
      `prompt_apply_duration_seconds_count{source="${_escapeLabelValue(source)}",promptId="${_escapeLabelValue(promptId)}"} ${n}`,
    );
    lines.push(
      `prompt_apply_duration_seconds_sum{source="${_escapeLabelValue(source)}",promptId="${_escapeLabelValue(promptId)}"} ${sumSec.toFixed(6)}`,
    );
  }
  // 4. prompt_markers_in_history — gauge (per source). Passive last-observed.
  lines.push('# HELP prompt_markers_in_history Number of PO-INJECT markers in the most recently observed target (per source). PASSIVE LAST-OBSERVED-VALUE semantics — a stale write biases the gauge until the next call. Promote to `{count, observedAt}` freshness tuple if SRE alerting requires it.');
  lines.push('# TYPE prompt_markers_in_history gauge');
  for (const [source, count] of _markerCountGauge.entries()) {
    lines.push(
      `prompt_markers_in_history{source="${_escapeLabelValue(source)}"} ${count}`,
    );
  }
  // 5. prompt_scripts_loaded — gauge (single value; bounded by Set cardinality).
  lines.push('# HELP prompt_scripts_loaded Number of unique script.promptId values seen by observability.');
  lines.push('# TYPE prompt_scripts_loaded gauge');
  lines.push(`prompt_scripts_loaded ${_scriptsLoaded.size}`);
  return lines.join('\n') + '\n';
}
