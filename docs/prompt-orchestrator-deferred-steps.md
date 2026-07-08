# Prompt-Orchestrator Deferred Steps (4, 5, 8, 9)

> Companion followup doc to **Tier 8 — Prompt-Orchestrator Brainstorm (9 steps)** in `docs/async-parallelization-opportunities.md`. This doc holds the 4 deferred steps in the same Group C Phase-2 verdict-table format (Apply site / Pattern / Reviewer role / Verdict / Rationale) with full structural-conflict analysis, ROI re-justification, and the conditions that would un-defer each step.
>
> The 4 deferred steps are intentionally NOT in `async-parallelization-opportunities.md`'s main tier body — keeping them here prevents the main tier from being polluted with permanent-defer entries (like #62, #69 in the Status Audit).

## Cross-reference

- **Main doc**: `docs/async-parallelization-opportunities.md` → Tier 8 verdict table (lists these 4 as `⚠ deferred` with a one-line rationale)
- **Applied steps** (in main doc Tier 8): #1 ✓ applied, #2 ✓ applied (in-scope-of-#1), #3 ✓ applied, #7 ✓ applied
- **Pending APPLY** (in main doc Tier 8): #6 ☐ pending APPLY
- **Deferred** (this doc): #4, #5, #8, #9

## Verdict table (Group C Phase-2 format)

| # | Apply site | Pattern | Reviewer role | Verdict | ROI | Rationale |
|---|------------|---------|---------------|:-------:|:---:|-----------|
| **4** | `web/lib/orchestra/prompt-orchestrator/injection-planner.ts` (new `writeAdapter` method) + a `reverseMap` data structure that tracks (target, promptId, step, sha) → (injected line range) so subsequent edits can update the marker in place | Adapter writes — given a marker in the agent history, locate the source prompt script on disk and write the updated payload back; round-trip closes the loop between injected markers and source scripts | prompt-orchestrator owner | **⚠ deferred** | **★★★☆☆** | **Structural-conflict analysis**: writing back to a user-controlled source introduces 3 risk classes that the current `applyScript` (which only appends to the in-memory target) deliberately avoids:<br>1. **Write contention** — concurrent `applyScript` + `writeAdapter` calls on the same `(target, promptId, step)` triple could race on the file lock. Current `applyScript` is in-memory (no file lock); adding `writeAdapter` opens a new concurrency surface.<br>2. **Partial-write failure** — `writeFile` is not atomic; a partial write (e.g. crash mid-write) would leave the prompt script in an inconsistent state. Mitigation would require a temp-file + rename pattern, which adds I/O cost on every `applyScript` call.<br>3. **Source-of-truth ambiguity** — once `writeAdapter` exists, is the source the disk script, the marker in agent history, or both? Diverging them creates a new debugging surface (which one is canonical?).<br>**Un-defer conditions**: (a) `applyScript` has been load-tested in production for 30+ days without file-write errors; (b) the team has decided the source-of-truth question (recommend: disk script is canonical, marker in history is a cache that can be re-derived); (c) temp-file + rename atomic-write helper is added to the foundation. |
| **5** | (deferred) `web/lib/orchestra/prompt-orchestrator/provider-fallback.ts` (new file) + extend `loadScript` to accept an array of sources + try them in order with fallback-on-error | Provider fallback for prompts — alternate prompt sources (e.g. local file, Redis, HTTP endpoint) when the primary fails to load. Mirrors the LLM provider-fallback pattern in `web/lib/orchestra/stateful-agent/agents/provider-fallback.ts` | prompt-orchestrator owner + LLM provider team (cross-team) | **⚠ deferred** | **★★★☆☆** | **Structural-conflict analysis**: the LLM provider-fallback has a known set of 3 failure modes (auth fail, rate limit, network error) and a known fallback contract (first-success-wins, in priority order). The prompt source landscape is much more heterogeneous — a "fallback" could mean: alternate file path, alternate script with the same promptId, alternate HTTP endpoint, alternate Redis key, alternate VFS path, alternate in-memory cache. Each has different failure semantics. The current `loadScript(filePath)` contract is intentionally narrow (one path, one shape); expanding it to multi-source fallback would need a config schema + a per-source error-handler. **Un-defer conditions**: (a) at least one production incident is traced to a `loadScript` failure that would have been avoided by fallback; (b) the team has agreed on the source-priority schema (recommend: 1-line comma-separated env var `PROMPT_SOURCES` parsed at boot); (c) per-source error-handler is implemented (recommend: `loadScript` returns `{ source, script }` so the caller knows which source won). |
| **8** | new `observability.ts` + `/api/orchestra/prompt-orchestrator/metrics` route | Observability/metrics — Prometheus counters + duration summary + per-source gauges (apply-state below has the 5 metric names + label schema) | prompt-orchestrator owner + observability team | **✓ applied (2026-07-08)** | **★★☆☆☆** | Pure additive consumer of step 1/3/7; no structural conflicts. See **Step 8 apply summary (2026-07-08)** below. | (a) QPS > 10/s sustained; (b) operator-debug grep-bottleneck (incident >30min); or (c) SLO alerting (`prompt_apply_duration_seconds{p99}>100ms/5min`). |
| **9** | `web/app/api/orchestra/prompt-orchestrator/scripts/route.ts` (CRUD) + a new `web/app/admin/prompt-orchestrator/` page (React) | UI/CLI for prompt management — operator surface for listing/creating/editing/deleting prompt scripts, viewing injection history (via step 8 metrics + step 3 metadata), viewing in-flight triggers (via step 7 `getTriggerStatus`) | prompt-orchestrator owner + admin-UI team | **⚠ deferred** | **★★☆☆☆** | **Structural-conflict analysis**: 2 risk classes:<br>1. **Scope creep** — operator-facing vs end-user-facing vs both? End-user-facing is much higher scope (needs auth, RBAC, rate-limiting, audit log); operator-facing is lower scope but still needs auth.<br>2. **Data-model coupling** — the UI surfaces data from steps 1, 3, 7, 8. If any of those data models change, the UI breaks. Un-defering before steps 4 + 8 settle the data model means re-shaping the UI when they land.<br>**Un-defer conditions**: (a) step 4 (round-trip) + step 8 (observability) data models are stable for 30+ days; (b) the team has decided the audience (recommend: operator-only at first, end-user-facing deferred to a separate brainstorm); (c) the admin-UI infrastructure is in place (auth, RBAC, layout). |


### Step 8 apply summary (2026-07-08)

**Applied 2026-07-08.** Companion files at:
- `web/lib/orchestra/prompt-orchestrator/observability.ts` `— in-memory Maps; no OTel SDK init at the foundation layer
- `web/app/api/orchestra/prompt-orchestrator/metrics/route.ts` `— GET endpoint, text/plain; version=0.0.4
- `web/lib/orchestra/prompt-orchestrator/__tests__/observability.test.ts` `— 5 vitest cases (new-gen, idempotency, exposition, per-step attribution, sha-aware pre-classification)

**Call sites wired:** `web/lib/orchestra/unified-agent-service.ts` L1512 (1st caller, source=`unified-agent`; was L1517 pre-consolidation, shifted after the `PO_DEFAULT_SCRIPT` → `PO_UNIFIED_AGENT_SCRIPT` move to `default-scripts.ts`) + `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts` poll loop (2nd caller, source=`marker-tail`). The marker-tail caller dynamic-imports `observability.ts` in `start()` in parallel to its existing scanMarkers dynamic-import — the boot-without-prompt-orchestrator contract is preserved.

**Cardinality discipline:** labels are `(source, promptId, mode)` for injection + `(source, promptId, step)` for idempotency-skip + `(source, promptId)` for duration. `sha` is intentionally NOT a label — SHA-256 hex is 64 chars and every payload edit creates a fresh value, which would explode label cardinality past Prometheus’s 10K combinations/metric ceiling.

**Triggers that established this work as eligible** (per the spec): (a) QPS in the hot path — still unmet, (b) operator-debug bottleneck on ad-hoc grep — now MET (the wrapper is a 0-dependency `curl /api/orchestra/prompt-orchestrator/metrics` replacement for the prior `metadata.json grep + applyScript return value` baseline), (c) SLO-based alerting — still unmet.


## ROI ranking within the deferred set

1. **Step 4 (adapter writes)** — ★★★☆☆ — closes the round-trip loop; medium ROI, but the structural conflicts (write contention, partial-write, source-of-truth) need explicit design before un-defer
2. **Step 5 (provider fallback)** — ★★★☆☆ — adds resilience; medium ROI, but the heterogeneous source landscape needs a config schema first
3. **Step 8 (observability)** — ★★☆☆☆ — pure additive; lowest structural risk, but ROI scales with QPS (not blocking at current scale)
4. **Step 9 (UI/CLI)** — ★★☆☆☆ — pure additive; lowest priority because it depends on steps 4 + 8 settling first

## Cross-tier composition

The 4 deferred steps compose with the 4 ☐ pending APPLY steps in the main doc Tier 8 to form the full 9-step brainstorm:

| Phase | Steps | Where documented |
|-------|-------|------------------|
| **Phase 1 — Foundation** (apply first) | 1, 2, 3, 6, 7 | `async-parallelization-opportunities.md` Tier 8 (5 steps: 4 ☐ APPLY + 2 ✓ applied in-scope-of-1) |
| **Phase 2 — Resilience + Observability** (defer to Phase 1 production validation) | 4, 5, 8 | This doc (3 steps) |
| **Phase 3 — Operator UX** (defer to Phase 2 data-model stability) | 9 | This doc (1 step) |

## Conditions summary (all 4 deferred)

| Step | Earliest un-defer | Required preconditions |
|------|-------------------|------------------------|
| 4 (adapter writes) | After step 1 has 30+ days production telemetry | Source-of-truth decision; atomic-write helper in foundation |
| 5 (provider fallback) | After 1 prod incident traced to `loadScript` failure | Source-priority schema agreed; per-source error-handler |
| 8 (observability) | When QPS > 10/s OR debugging is grep-bottlenecked | None (pure additive) |
| 9 (UI/CLI) | After steps 4 + 8 data models are stable 30+ days | Audience decided; admin-UI infra in place |

## Companion files

- **Main tier**: `docs/async-parallelization-opportunities.md` → Tier 8
- **Status Audit cross-ref**: `docs/async-parallelization-opportunities.md` → "Action priority" section (added entry pointing here + Tier 8)
- **Foundation module** (applied): `web/lib/orchestra/prompt-orchestrator/` (6 files)
- **Checkpointer** (applied): `web/lib/orchestra/stateful-agent/checkpointer/index.ts` (GitSnapshotWrapper)
- **Scheduler** (applied): `web/.bing-shared/services/scheduler/` (6 files)

