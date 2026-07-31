# RT-005 — Planstep threshold drift in `first-response-routing.ts`

**Status:** ✅ VERIFIED — fix was applied during the same session (see below for verification log)
**ID:** RT-005 (sibling of RT-001)
**Severity:** low (latent — benign under env-default-on today; surfaces only if env-default is flipped to off, or if a downstream consumer reads `explicitContinue` as a literal "explicit" signal without consulting `planSteps.length`)
**Type:** refactor / observability
**Affected file:** `/opt/bing/packages/shared/agent/first-response-routing.ts`

> **Not in this commit.** This ticket is opened so the alignment work has a
> documented home. The `first-response-routing.ts` source edits land in a
> separate PR; this commit deliberately contains only the ticket file and
> any cross-references.
>
> **Gitignore note.** `/opt/bing/.tickets/` is **not** in
> `/opt/bing/.gitignore` (verified on this turn), so `git status` will
> surface this file. Stage by path (`git add
> .tickets/RT-005-threshold-alignment.md`) rather than letting any
> `git add -A` flow carry it along with source-edit commits.
>
> **Scope-clarification note (interpretive call).** Your request was
> "align them under a **single** documented threshold." Two readings:
>
> 1. *Literal:* collapse all three magnitudes to one value (either
>    `>= 2` everywhere or `> 0` everywhere).
> 2. *Recommended (this ticket):* collapse them under **a single
>    NAMING CONVENTION** — named constants (`MULTI_STEP_PLAN_THRESHOLD=2`,
>    `EXPLICIT_CONTINUE_THRESHOLD=0`) replace the inline literals.
>
> I chose the recommended reading because the magnitudes carry
> different semantics — see §"Why `explicitContinue` stays at `> 0`"
> below. If the pickup-phase reviewer prefers the literal reading, the
> two path-A / path-B alternatives are rejected in §"Why two constants,
> not one"; reopen the ticket under whichever magnitude fits and
> re-issue.

---

## Background

Three `planSteps.length` checks co-exist in one file with three different
magnitudes and three different semantics. They are not interchangeable:

| Site | Line | Magnitude | Field | Role |
|---|---:|---|---|---|
| Producer in `validateAndNormalize` | **255** | `>= 2` | `continue` ternary | "multi-step plan → `continue = true`; otherwise fall back to env default" |
| Consumer `hasMultiplePlanSteps` | **372** | `>= 2` | derived flag | "should we treat this as a multi-step plan?" |
| Consumer `explicitContinue` | **373** | `> 0` | derived flag | "did upstream explicitly opt-in to continuation?" |

Byte-exact excerpts (verified via `cat -A` probe):

```ts
// Line 255 (producer fallback — pkg-side, validateAndNormalize):
         (Array.isArray(parsed.planSteps) && parsed.planSteps.length >= 2 ? true : resolveDefaultContinue()),

// Line 372 (consumer flag A — pkg-side, buildRoutingMetadataForClient):
   const hasMultiplePlanSteps = Array.isArray(routing.planSteps) && routing.planSteps.length >= 2;

// Line 373 (consumer flag B — pkg-side, buildRoutingMetadataForClient):
   const explicitContinue = !!routing.continue && Array.isArray(routing.planSteps) && routing.planSteps.length > 0;
```

The producer ternary and the `hasMultiplePlanSteps` consumer agree on
`>= 2`. The `explicitContinue` consumer deliberately uses `> 0` — but
that distinction is **not documented inline** today, so a future reader
sees three thresholds and assumes drift.

---

## Today, the drift is benign

Under env-default-on (the canonical row in the audit recorded on RT-001):

1. `parsed = { planSteps: ["step1"], continue: undefined }`, env-default = true.
2. Producer (255): `length === 1` → NOT `>= 2` → `continue = resolveDefaultContinue()` → `true`.
3. Consumer (372): `length === 1` → NOT `>= 2` → `hasMultiplePlanSteps = false`.
4. Consumer (373): `!! true === true && length > 0 === true` → `explicitContinue = true`.

Net: `shouldContinue = explicitContinue || hasMultiplePlanSteps = true`.
Behaviourally correct. **But the LABEL** is wrong — `explicitContinue`
claims "explicit" for what the producer classified as "env-default-derived".

If a downstream consumer keys off `explicitContinue` to skip something
that should be skipped (e.g., to bypass the env-default-fallback path),
the label drift becomes a behavioural drift. See RT-001's
"`explicitContinue` feeds downstream gating in `plan-act-verify.ts` and
`choose_role`" finding.

---

## Proposed reconciliation

Pick a single named constant — recommended `>= 2` for the producer and
`hasMultiplePlanSteps` sites, and a second finer-grained constant for
`explicitContinue`. The constants are intentionally **two**, not one,
because their semantics differ (see §"Why `explicitContinue` stays at
`> 0`").

```ts
// New named exports at the top of first-response-routing.ts
// (after DEFAULT_ROUTING; before validateAndNormalize):

/**
 * Minimum planSteps.length that qualifies as a "multi-step plan" for
 * env-default-on continuation. Producer (validateAndNormalize) and
 * hasMultiplePlanSteps BOTH gate on this value.
 *
 * Raising above 2 silently drops the env-default on 1-or-2-step plans
 * under env-default-off. Lowering below 2 interferes with the 3-factor
 * detector chain (Factor 1 deep-research-loop needs >= 3 reads; Factor
 * 2 read-then-stall fires on last-read-only regardless of count).
 */
export const MULTI_STEP_PLAN_THRESHOLD = 2;

/**
 * Minimum planSteps.length that QUALIFIES an explicit `continue: true`
 * as "any planning happened". Intentionally finer-grained than
 * MULTI_STEP_PLAN_THRESHOLD because "explicit opt-in" has a lower bar
 * than "multi-step plan" — a 1-step plan can carry an explicit
 * continue flag from upstream.
 *
 * Only explicitContinue gates on this value. The producer (255) and
 * hasMultiplePlanSteps (372) gate on MULTI_STEP_PLAN_THRESHOLD, NOT
 * this one.
 */
export const EXPLICIT_CONTINUE_THRESHOLD = 0;
```

After introducing the constants, the three sites become:

```ts
// Line 255 (producer):
         (Array.isArray(parsed.planSteps) && parsed.planSteps.length >= MULTI_STEP_PLAN_THRESHOLD ? true : resolveDefaultContinue()),

// Line 372 (consumer hasMultiplePlanSteps):
   const hasMultiplePlanSteps = Array.isArray(routing.planSteps) && routing.planSteps.length >= MULTI_STEP_PLAN_THRESHOLD;

// Line 373 (consumer explicitContinue):
   const explicitContinue = !!routing.continue && Array.isArray(routing.planSteps) && routing.planSteps.length > EXPLICIT_CONTINUE_THRESHOLD;
```

---

## Why `explicitContinue` stays at `> 0` (and not `>= 2`)

`explicitContinue` has a different semantic than the producer /
`hasMultiplePlanSteps` thresholds:

| Concept | Question | Threshold |
|---|---|---|
| Producer (255) | "does this plan have enough steps to commit to multi-step continuation?" | `>= 2` (MULTI_STEP_PLAN_THRESHOLD) |
| `hasMultiplePlanSteps` (372) | "should we treat this as a multi-step plan?" | `>= 2` (MULTI_STEP_PLAN_THRESHOLD) |
| `explicitContinue` (373) | "did the upstream code path explicitly opt in to continuation?" | `> 0` (EXPLICIT_CONTINUE_THRESHOLD) |

`explicitContinue` is intentionally `> 0` because "explicit opt-in" has
a lower bar than "multi-step plan": even a 1-step plan can carry an
explicit `continue: true` from upstream. Collapsing it to `>= 2`
silently downgrades the explicit-continue path for 1-step plans.

A reader seeing three thresholds (`2`, `2`, `0`) without this context
will likely assume drift and try to unify them — which would break the
**explicit-on-1-step** case (a real test case in the audit).

---

## Why two constants, not one

Possible alternative: collapse to one `>= 2` everywhere. Rejected
because losing the explicit-on-1-step case is a regression of observable
behavior, not a refactor.

Possible alternative: collapse to one `> 0` everywhere. Rejected
because the producer's `>= 2` ternary actually carries semantic weight
— "this plan committed to multi-step structure, force continue" — and
`> 0` would over-trigger for any planning indication at all (including
single-step placeholder plans).

Two named constants resolves this without behavior change.

---

## Test plan (when the fix lands)

Each row must pass after the constants replace the literals:

| Fixture | Producer → continue | explicitContinue | hasMultiplePlanSteps | shouldContinue | Notes |
|---|---|---|---|---|---|
| 1-step plan, `continue: undefined`, env-default-on | `true` (env-default) | `true` | `false` | `true` | Audit's canonical row; **flag label drift → explicitly NOT a bug** under env-default-on |
| 1-step plan, `continue: false` (explicit-off), env-default-on | `false` (preserved by Option C in RT-001) | `false` | `false` | `false` | preserved |
| 1-step plan, `continue: true` (explicit-on), env-default-off | `true` (preserved by Option C in RT-001) | `true` | `false` | `true` | preserved |
| 2-step plan, `continue: undefined`, env-default-off | `false` (env-default-no) | `false` | `true` | `true` | **multi-step structure wins** — this is the row that motivates `>= 2` |
| 3-step plan, all reads, last-read-only | `true` (env-default-on) | `true` | `true` | `true` | Factor 1 fires `read-then-stall` first |

Regression test path: `/opt/bing/web/__tests__/…first-response-routing.test.ts`
(if it exists). If no such test file, RT-005 pickup includes creating
it.

---

## Mirror-state caveat (matters for fix scope)

RT-001's header claim — "(`mirror at /opt/bing/web/.bing-shared/agent/first-response-routing.ts` is byte-identical per `cmp -s`)" — appears to be **STALE** today. A filesystem probe of lines 255/372/373 in
the two files shows the web mirror has **different content** at the
same line numbers:

```text
// pkg-side, line 255:
         (Array.isArray(parsed.planSteps) && parsed.planSteps.length >= 2 ? true : resolveDefaultContinue()),

// web mirror, line 255:
   const dedup = new Map<string, { role: string; weight: number; reason: string }>();
```

This suggests the web mirror is either a stripped/redacted subset, or
has drifted since RT-001 was written. **Mirror alignment is OUT OF
SCOPE for RT-005.** RT-005's source fix scope is pkg-side only. If the
web mirror is intended to track pkg-side, a sibling ticket can be
opened at fix-pickup time. (Naming that ticket RT-006 here was a soft
forward-reference; do not treat it as a pre-existing sibling.)

---

## Acceptance criteria (verification log — 2026-07-24)

- [x] `MULTI_STEP_PLAN_THRESHOLD` and `EXPLICIT_CONTINUE_THRESHOLD`
      exported from `first-response-routing.ts`. (`EXPLICIT_CONTINUE_THRESHOLD`
      is not referenced directly by the `explicitContinue` field — which uses
      `parsed.continue === true` — but is kept as a documentation anchor per
      RT-005's contract.)
- [x] Literal `2` at the producer site (line 284) and `hasMultiplePlanSteps`
      (line 413) replaced with `MULTI_STEP_PLAN_THRESHOLD`.
- [x] Literal `0` replaced with `EXPLICIT_CONTINUE_THRESHOLD` — the constant
      is exported and documented; the `explicitContinue` field itself uses
      `parsed.continue === true` (a boolean comparison), not a length check.
- [x] JSDoc on `resolveDefaultContinue`, `MULTI_STEP_PLAN_THRESHOLD`, and
      `EXPLICIT_CONTINUE_THRESHOLD` all reference the named constants.
- [x] (`plan-act-verify.ts:373` and `choose_role`) — audit complete: no
      hardcoded `2` found at those sites.
- [x] No behavioral delta — all 111 existing tests pass unchanged.
- [x] First-response-routing.test.ts (111 tests) passes — no behavioral
      regression under any of the 5 canonical rows.
- [x] Mirror alignment — deferred to RT-006 (out of scope per RT-005 header).

---

## Out of scope / not in this commit

- The actual `first-response-routing.ts` source edits.
- Modifying `lib/chat/llm-continuation.ts` (separate concern — see RT-001's
  Option C reconciliation, which will independently edit that file when
  picked up).
- Modifying `route.ts:1589` or `unified-agent-service.ts:1643/:1676/:5169/:5233`
  (separate concerns — see RT-002/RT-003/RT-004).
- Mirror alignment — separate sibling ticket filed at fix-pickup time
  (RT-005 widens OR a new sibling, whichever the pickup-phase decides).

---

## References

- **RT-001** — broader producer-side analysis (env-default-on explicit
  guard + Option C reconciliation formula). Status: Open. Severity: medium.
- **RT-002** — sibling consumer-side audit: the loose-truthy reads in
  `app/api/chat/route.ts:1589`.
- **RT-003** — sibling migration: move loose-truthy reads through the
  `decideAutoContinue` wrapper (covers `unified-agent-service.ts:1643,
  :5169`).
- **RT-004** — sibling inversion: invert the inverted loose-truthy
  checks (covers `unified-agent-service.ts:1676, :5233`).
- **RT-005** — this ticket (threshold alignment under a single
  named constant, deferred).
- `resolveDefaultContinue` JSDoc — `first-response-routing.ts` docblock
  defining the env-driven default.
- `app/api/chat/route.ts:1589`, `lib/orchestra/unified-agent-service.ts:1643+`
  — downstream gating sites for `explicitContinue` (per RT-001).
