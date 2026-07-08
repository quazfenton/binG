# Prompt-Orchestrator Default Scripts (`default-scripts.ts`)

> Companion doc for the shared-constants module at `web/lib/orchestra/prompt-orchestrator/default-scripts.ts`. Explains the consolidation move, the per-call-site `promptId` rationale, the dynamic-import constraint on the `.bing-shared/*` caller, and the 3 production guards that lock the shape.

## What this module is

A single source of truth for the 2 default `PromptScript` constants exported to the prompt-orchestrator production callers. Before this module landed (2026-07-08), both `web/lib/orchestra/unified-agent-service.ts` and `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts` declared a local `const PO_DEFAULT_SCRIPT = {...}` inline — two copies of the SAME shape, both named identically, both introducing the same opportunity for drift if a 3rd caller landed.

The consolidation move (`PO_DEFAULT_SCRIPT` → `PO_UNIFIED_AGENT_SCRIPT` consolidation into `default-scripts.ts`) eliminates the duplicated constant and renames each copy to a per-call-site name so observability dashboards can split the call sites by `promptId` (Prometheus label).

## The 2 per-call-site constants

| Constant | `promptId` | Source label | Production caller |
|----------|-----------|--------------|-------------------|
| `PO_UNIFIED_AGENT_SCRIPT` | `unified-agent-entry` | `unified-agent` | `web/lib/orchestra/unified-agent-service.ts:L1512` (1st caller) |
| `PO_MARKER_TAIL_SCRIPT`   | `marker-tail-poll`    | `marker-tail` | `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts` poll loop (2nd caller) |

### Why two constants, not one (by design — observability attribution)

Each `promptId` becomes a Prometheus label on `prompt_injection_total{..., promptId="..."}` and `prompt_apply_duration_seconds{..., promptId="..."}` (see `web/lib/orchestra/prompt-orchestrator/observability.ts`). If both callers shared one `promptId`, their metric series would mesh together, hiding per-call-site attribution in the operator dashboard.

The disjoint invariant — `PO_UNIFIED_AGENT_SCRIPT.promptId !== PO_MARKER_TAIL_SCRIPT.promptId` — is locked by `web/lib/orchestra/prompt-orchestrator/__tests__/default-scripts.test.ts` (the `observability attribution` case). A future PR that collapses the promptIds will fail that test loudly.

### Why both shapes are intentionally empty (`steps: []`)

`applyScript(target, script)` walks `script.steps`; with `steps: []` the inject path is a no-op faithful pass-through (only `scan` + idempotency-check run). The 2 callers wire the FOUNDATION path through themselves (Tier 8 step 2) WITHOUT injecting any actual markers — moving from structural to behavioral happens at a future step 4 un-defer by either (a) adding a step to one of the consts, or (b) switching to `loadScript(...)` for a disk-stored script.

## The dynamic-import constraint on the `.bing-shared/*` caller

Caller A (unified-agent-service.ts) DOES static-import from the facade:

```ts
import { observeApplyScript, PO_UNIFIED_AGENT_SCRIPT } from '@/lib/orchestra/prompt-orchestrator';
```

Caller B (marker-scanner.ts in `web/.bing-shared/`) MUST dynamic-import from this path inside `start()`:

```ts
// (parallel to the existing scanMarkers + observeApplyScript dynamic-imports)
const { PO_MARKER_TAIL_SCRIPT } = await import(
  '@bing/shared/lib/orchestra/prompt-orchestrator/default-scripts'
).catch(() => ({ PO_MARKER_TAIL_SCRIPT: null }));
```

The reason is the `boot-without-prompt-orchestrator` contract at `marker-scanner.ts:L11-L16` — a STATIC value import would force the marker-scanner module to load the foundation at static-import time. If the foundation failed to resolve (missing dep, build error elsewhere), the entire scheduler would fail to boot even if no caller actually needed the marker-tail script.

The reverse-direction import (`web/.bing-shared/` → `web/lib/`) is OK specifically because the value is dynamic-imported inside `start()`'s try/catch — the static analyzer doesn't require the foundation to resolve at boot. Calling the constant inside `start()` AFTER the dynamic-import resolves is safe.

## The 3 production guards

The shape is locked by 3 layers, each catching a different failure mode. **All 3 must pass** for a green ship; any single failure should block the PR.

### Guard 1 — vitest snapshot lock (`__tests__/default-scripts.test.ts`)

File-level snapshot per const via `toMatchSnapshot()` + explicit `promptId` + `steps: []` assertions + the disjoint-promptIds invariant. Runs on every test invocation; CI fails on snapshot drift.

**Catches**: accidental semantic drift — same const names, different shape (e.g., someone changes `steps: []` to `steps: [{...}]` then later removes the step but forgets to update the shape lock).

### Guard 2 — static audit lock (`__tests__/unified-agent-prompt-orchestrator-audit.test.ts`)

Text-pass regex on the file: (a) caller imports `PO_UNIFIED_AGENT_SCRIPT` from the facade, (b) facade re-exports from `./default-scripts`, (c) default-scripts.ts defines `PO_UNIFIED_AGENT_SCRIPT: PromptScript = {`. Runs as part of the prompt-orchestrator audit suite.

**Catches**: file-level edits — someone renames a const, adds a field, removes a const, drops the re-export.

### Guard 3 — disjoint-promptIds invariant (locked in `default-scripts.test.ts`)

Single 2-line test: `expect(PO_UNIFIED_AGENT_SCRIPT.promptId).not.toBe(PO_MARKER_TAIL_SCRIPT.promptId)`. Locks the RELATION between two consts (not just their individual shapes).

**Catches**: a future PR that collapses the promptIds to one — the operator dashboard would lose per-call-site attribution.

### Optional Guard 4 — shell-level shape lock (`scripts/check-default-scripts-shape.ts`)

Runs **Guard 1 (snapshot) + the facade-re-export half of Guard 2 + Guard 3 (disjoint)** on RAW FILE TEXT — no vitest / node-runtime dependency, so the script can run as a pre-commit hook or a Vercel preview-deployment gate that catches shape drift before the test suite spins up. Exits non-zero on any check failure.

**Intentionally not mirrored** from Guard 2: the **caller-side import check** — verifying `unified-agent-service.ts:L29-35` does `import { observeApplyScript, PO_UNIFIED_AGENT_SCRIPT } from '@/lib/orchestra/prompt-orchestrator'` — lives in the audit suite (`__tests__/unified-agent-prompt-orchestrator-audit.test.ts` Test 2c step a), not in this shell script. Keeping it out of the shell script avoids coupling the pre-commit / preview-gate to the caller file location — a caller-file rename in a refactor would otherwise silently change the shape-lock contract.

## Adding or modifying a constant

Three rules of thumb to keep all guards green at once:

1. **Adding a 3rd const** → add a new `it.each([...])` row + snap (Guard 1); add a regex pattern to the static audit (Guard 2); add a disjoint-promptIds assertion vs the existing 2 consts (Guard 3); add a regex pattern to the shell script (Guard 4).
2. **Renaming a const** → `vitest -u` after manually verifying the rename is intentional (Guard 1 snapshot updates); update the static audit regex (Guard 2); update the disjoint-promptIds test if applicable (Guard 3); update the shell script regex (Guard 4).
3. **Adding a step** → guards 1 (snapshot), 3 (disjoint, unchanged), 4 (regex) need `steps: []` → `steps: [{...}]` updates; guard 2 (audit) is unchanged because it only checks the const exists + has PromptScript type. This is the Tier 8 step 4 un-defer unblocker.

## Cross-references

- **Source module**: `web/lib/orchestra/prompt-orchestrator/default-scripts.ts`
- **Foundation re-exports**: `web/lib/orchestra/prompt-orchestrator/index.ts:L29-L34`
- **1st caller**: `web/lib/orchestra/unified-agent-service.ts:L29-35` (import) + `:L1512` (call site)
- **2nd caller**: `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts` (dynamic import in `start()`)
- **Guard 1**: `web/lib/orchestra/prompt-orchestrator/__tests__/default-scripts.test.ts`
- **Guard 2**: `web/lib/orchestra/__tests__/unified-agent-prompt-orchestrator-audit.test.ts` (Test 2c — file-level audit)
- **Guard 3**: `web/lib/orchestra/prompt-orchestrator/__tests__/default-scripts.test.ts` (the `observability attribution` case)
- **Guard 4**: `scripts/check-default-scripts-shape.ts` (the new shell script)
- **Companion followup doc**: `docs/prompt-orchestrator-deferred-steps.md` (4 deferred steps 4, 5, 8, 9 with full structural-conflict analysis)
- **Main tier**: `docs/async-parallelization-opportunities.md` → Tier 8 (verdict table mentioning the `PO_DEFAULT_SCRIPT` → `PO_UNIFIED_AGENT_SCRIPT` consolidation into `default-scripts.ts`)
