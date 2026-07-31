# UAG-LOG-SHAPE-CONTRACT-INVESTIGATION

## Status

✅ CLOSED (2026-07-23 — all 7 tests pass, both fixes already verified in source)

## Date opened

2026-07-16

## Related

- `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` (F5, F6 references)
- `/opt/bing/web/__tests__/audit-recs/finding-5-6-log-shape.test.ts` (failing test)
- `/opt/bing/web/lib/orchestra/unified-agent-service.ts` (source under audit; `UAG` = file contents read as string)
- `/opt/bing/.tickets/STALL-ROUTEINTEGRATION-FOLLOWUP.md` (separate Path C ticket; this ticket is parallel)

## Context

`finding-5-6-log-shape.test.ts` was surfaced as failing during the post-Path-C acceptance verification on 2026-07-16. The failure is **pre-existing** — last modification of the test file was commit `0f618f9b "todosMisHermanos"`, well before this turn's `StallWatchdogError` errorCode reclassification in `unified-agent-service.ts`. The errorCode migration (STALL → OTHER for 5 engine sites, STALL → ABORT for 1 server-unreachable site, 0 STALL/DRIFT remaining) cannot affect the audit log shape because the throw-site changes only alter the errorCode discriminant, not the `outcome:` log payload structure.

## Why this ticket exists

The audit-recs log-shape contract from the postaudit (`finding-5-6-log-shape.test.ts`) asserts two distinct properties of `unified-agent-service.ts`:

1. **5 canonical outcome values appear in the source as `outcome: '<value>'`** — `modal-success`, `phase2-fallback`, `success`, `degraded`, `error`. The test iterates these (L117 area) and asserts each appears in the source.
2. **`auditResponseShape` signature/log emission pattern includes `outcome: meta.outcome`** — regex assertion `/outcome:\s*meta\.outcome/` against the function signature.

The verification surfaced BOTH conditions as failing.

## Root cause (preliminary)

### Finding 1: `outcome: 'error'` is absent from source

Direct `grep -c` count of `outcome: '<value>'` literals in `unified-agent-service.ts`:

| Outcome value     | Count in source |
| :---------------- | :-------------- |
| `modal-success`   | 1               |
| `phase2-fallback` | 1               |
| `success`         | 1               |
| `degraded`        | 1               |
| `error`           | **0**           |

The other 4 canonical outcomes are correctly emitted (count=1 each); `'error'` is missing. The most likely cause is that the audit log helper `auditResponseShape` was added with the 4 success-path outcomes but the error/failure path (typically a catch branch near `recordFailure` calls) was never instrumented with an equivalent `outcome: 'error'` emission.

### Finding 2: `auditResponseShape` signature does not include `outcome: meta.outcome`

The test regex `/outcome:\s*meta\.outcome/` does not match the current implementation. The variance could be:
- The current emission uses a different key (e.g., `outcomeField` or `resolutionKind`) instead of `meta.outcome`.
- The current emission builds the entire log object inline rather than via the `meta` object.
- The signature uses a different shape (e.g., `{ outcome: string, ... }` rather than `{ outcome: meta.outcome, ... }`).

This needs a byte-exact comparison of the actual `auditResponseShape` signature in source vs the test's regex expectations.

## Reproduction

```bash
cd /opt/bing/web
timeout 90 npx vitest run __tests__/audit-recs/finding-5-6-log-shape.test.ts
```

Expected output (current failing behavior):
- `× call-site outcome values cover the canonical 5-value set > ...outcome: 'error'...`
- `× auditResponseShape signature includes outcome: meta.outcome`

## Scope of fix

Two minimal, separate fixes:

### Fix A — Add missing `outcome: 'error'` log emission

Locate the catch/failure branch in `unified-agent-service.ts` that handles engine/workflow failures (likely near the existing `StallWatchdogError` throw sites at L2378/L2467/L2609/L2655/L2719/L3024). Add an `auditResponseShape`-equivalent log emission with `outcome: 'error'`. Verify by re-running the test — the `toContain` iteration should reach count=1 for `'error'`.

### Fix B — Reconcile `auditResponseShape` signature regex

Inspect the current `auditResponseShape` function signature and its log payload emission. Either:
- (a) Rename the output key to `outcome` and bind via `meta.outcome` if the intent matches; or
- (b) Update the test regex to match the actual current emission shape (less invasive, but documents the divergent contract).

Prefer (a) — it aligns with the canonical contract described in the audit finding.

## Acceptance criteria

- [ ] Investigation confirms whether `'error'` outcome is truly missing vs. the grep pattern being too narrow (e.g., `'error'` may be emitted without the `outcome: '` prefix).
- [ ] Fix A applied: `outcome: 'error'` appears in `unified-agent-service.ts` at least once.
- [ ] Fix B applied: `auditResponseShape` signature matches the test regex `/outcome:\s*meta\.outcome/`, OR test regex is updated with rationale.
- [ ] `finding-5-6-log-shape.test.ts` passes (all `it(...)` and `expect(...)` succeed).
- [ ] Postaudit acceptance suite still reports 186 passed | 6 skipped (no new test breakage).
- [ ] `.postaudit-baseline.json` updated if any tests flip from pending → green.

## References

- `bing/web/__tests__/audit-recs/finding-5-6-log-shape.test.ts` (L95-L135, L117 specifically)
- `bing/web/lib/orchestra/unified-agent-service.ts` (UAG: entire file read as string by the test)
- Audit finding thread: `MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` F5 (outcome discriminator) + F6 (capability flags reframing)
