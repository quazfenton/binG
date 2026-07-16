# Routing threshold mismatch — producer vs consumer

**Status:** Open
**ID:** RT-001
**Severity:** medium (a 1-step plan's `continue` classification drifts
between producer and consumer; `explicitContinue` feeds downstream gating
in `plan-act-verify.ts` and `choose_role`)
**Affected file:** `/opt/bing/packages/shared/agent/first-response-routing.ts`
(mirror at `/opt/bing/web/.bing-shared/agent/first-response-routing.ts` is
byte-identical per `cmp -s`)

## Reproduction

Given `parsed = { planSteps: ["step1"], continue: undefined }` and an
env-default set to `true` (the canonical row in the audit recorded on this
file), the consumer emits `explicitContinue = true` while the producer's
intermediate state was `continue = resolveDefaultContinue()` (i.e. *not* an
explicit assertion).

Trace:

```
Producer (validateAndNormalize, line 255):
  parsed.planSteps.length >= 2 ? true : resolveDefaultContinue()
                                       └────────────┬────────────┘
                                  1-step plan → resolveDefaultContinue()
                                  returns: true under env-default-on,
                                           false under env-default-off.

Consumer (buildRoutingMetadataForClient, line 373):
  const explicitContinue =
      !!routing.continue          // truthy under both env-default-on AND
                                  // any external setter
   && Array.isArray(routing.planSteps)
   && routing.planSteps.length > 0;   // <-- HERE: `> 0`, not `>= 2`

  Result for 1-step plan: !!true === true && length === 1 > 0 = true
   → consumer labels the env-default-derived continue as "explicit".
```

The asymmetry: producer says "1-step plan is env-default-driven",
consumer says "it's explicit user assertion".

## Related producer-side gap

Line 255 of `validateAndNormalize` overwrites any explicit `parsed.continue`
on a 1-step plan with the result of `resolveDefaultContinue()`. So even if
some upstream code path mutates `routing.continue = true` while leaving
`planSteps.length = 1`, the producer's ternary drops it. This means
"explicit-continue on a 1-step plan" is *not preservable through validate
currently*. Worth flagging if any caller relies on the prior behavior.

## Reconciliation options

| Option | Where | Change | Trade-off |
|---|---|---|---|
| **A. Tighten consumer gate** | `buildRoutingMetadataForClient` line 373 | Replace `> 0` with `>= 2` so `explicitContinue` ⇔ `hasMultiplePlanSteps`. | Lowest blast radius; only affects how the consumer *labels* a value the producer already classified. Removes the semantic drift. Risk: any consumer path that visually keys off `length > 0` will now key off `>= 2`. |
| **B. Loosen producer gate** | `validateAndNormalize` line 255 | Allow 1-step plans to bypass `resolveDefaultContinue()` entirely (i.e. take the `true` branch whenever `parsed.continue === true`, regardless of length). | Larger semantic change; effectively promotes "user said continue" over "env default". Risk: opt-out callers (env-default-off) cannot now suppress a 1-step plan; if the planner is wrong about step count, the chat will continue spuriously. |
| **C. Make the producer preserve-both-explicit** | `validateAndNormalize` line 255 + consumer line 373 | Producer: `parsed.continue !== undefined ? parsed.continue : (parsed.planSteps.length >= 2 ? true : resolveDefaultContinue())`. Consumer: gate stays `> 0` (no change). | Preserves any explicit `continue` (true OR false) on a 1-step plan; env-default only fires when `parsed.continue` is undefined. Removes both the producer-line-255 silent drop and the consumer-line-373 `> 0` label drift (consumer still reads `> 0` and now agrees with the producer's "if explicit, trust it; otherwise use length or env default"). Risk: callers that today rely on `continue: undefined → env-default-on=true` keep working; callers that relied on `continue: undefined` being silently dropped on a 1-step plan get a behavior change. |

Recommended: **Option C** (preserves any explicit `continue` value
regardless of `planSteps.length`, removes the producer-side silent-drop on
explicit-off, and removes the consumer-side label drift).

## Test cases that should pass after reconciliation

- `planSteps: ["step1"], continue: undefined, env-default-on: true` →
  producer `continue = true` (from resolveDefaultContinue), consumer
  `explicitContinue = true`, `hasMultiplePlanSteps = false` (no change).
- `planSteps: ["step1"], continue: true, env-default-off: false` →
  producer `continue = true` (preserve option C's override), consumer
  `explicitContinue = true`, `hasMultiplePlanSteps = false`.
- `planSteps: ["step1"], continue: false, env-default-on: true` →
  producer `continue = false` (preserve explicit *off* via Option C's
  preserve-both-explicit semantics; previously this case silently
  collapsed to env-default-continue under the prior line-255 ternary),
  consumer `explicitContinue = false`, `hasMultiplePlanSteps = false`.
- `planSteps: ["step1", "step2"], continue: undefined, env-default-on: false`
  → producer `continue = true` (>= 2 wins), consumer `explicitContinue = true`,
  `hasMultiplePlanSteps = true` (unchanged from today).

## Out of scope

- **RT-002** — Re-tuning the env-default-on default value.
- **RT-003** — Migrate the `route.ts:1589`,
  `unified-agent-service.ts:1643 + :5169` loose-truthy reads to the
  env-default-aware wrapper (`shouldAutoContinue` from
  `lib/chat/llm-continuation`).
- **RT-004** — Fix the inverted `!roleSelection?.continue` pattern at
  `unified-agent-service.ts:1676 + :5233` (replace with
  `roleSelection?.continue !== false`).

## References

- `validateAndNormalize` (the producer) and `buildRoutingMetadataForClient`
  (the consumer) are both in `first-response-routing.ts`. `Bug #2 fix`
  referenced at line ~605 of that file maps to the same producer region.
- The sibling audit at `unified-agent-service.ts` documented the
  consumer-side loose-truthy sites — RT-003 and RT-004 trace back to
  that sweep.
