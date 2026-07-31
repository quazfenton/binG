# Engineering Decision Rules

**Audience:** Code reviewers flagging suppression workarounds; maintainers picking up SEV-NN / RT-NNN / ARCH-NNN tickets.
**Status:** v1.0 (2026-06-18) — derived from the SEV-12 / SEV-13 / SEV-14 / SEV-15 sweep and the 6-round drawer.tsx vaul repair.
**Cross-referenced from:** every SEV-NN.md and ARCH-NNN.md ticket footer should include the link `[/opt/bing/docs/ENGINEERING_DECISION_RULES.md](../docs/ENGINEERING_DECISION_RULES.md)` in its "References" section (the `../docs/` prefix is required because tickets live under `.tickets/`).

This document codifies the **enforceable heuristics** that a reviewer can cite in a flag-up PR comment. Each rule ships with:

- a one-line **decision rule** (the actionable verdict);
- a **when-to-apply** section with examples;
- a **when-NOT-to-apply** section with counter-examples;
- a **canonical site** reference (the codebase's working or anti-example).

---

## Rule A — `{ mode: 'all' }` vs `{ mode: 'choose' }` for `normalizeAndValidateRole`

**Decision rule.** Pass `{ mode: 'all' }` ONLY at internal-orchestrator pick paths and broad-union contract tests. Leave the parameter unset (which keeps the `'choose'` default) at every LLM-facing entry point.

### Canonical site

`/opt/bing/packages/shared/agent/unified-role-selector.ts` — `normalizeAndValidateRole` (line 988+). The function accepts a `mode: 'choose' | 'all'` option whose default is `'choose'`. The mode-aware tier-1 validation gates:

- `mode === 'choose'` (default) — strict 9-ID check against `CHOOSE_ROLE_MENU ∩ SYSTEM_PROMPTS keys`. Used by `choose-role-tool.ts` and any other LLM-facing aiTool so the LLM is told ONLY IDs that compose.
- `mode === 'all'` — broad 76-union check against `getAllRoleIds()`. Used by MCP `role_selection`, internal orchestrator auto-detect, broad-union contract tests.

### When to pass `{ mode: 'all' }`

- **Internal orchestrator auto-pick paths.** If the role string originates from `pickRoleFromContext(...)` (a 76-union keyword router) rather than from an LLM emit, pass `{ mode: 'all' }`. The picker's output ISN'T constrained to the 9-ID menu because the picker is a keyword router, not a constrained dropdown. **Mitigation contract:** pickRoleFromContext callers that pipe the result through normalizeAndValidateRole MUST pass `{ mode: 'all' }` to avoid silent-reject of broad-union picks (e.g., `mlEngineer` from a `'Train a model'` keyword match).
- **MCP `role_selection` handlers.** The MCP layer uses the broad-union contract because it accepts role IDs from outside the LLM dropdown flow.
- **Broad-union contract tests.** Tests that assert `mlEngineer` / `legalAnalyst` / `chef` / `scientist` validation succeed (see `__tests__/unified-role-selector.test.ts` lines 449, 472, 484, 496, 508 that already pass `{ mode: 'all' }`).

### When NOT to pass `{ mode: 'all' }` (leave default `'choose'`)

- **LLM-facing aiTool / cap tool entry points.** Both production `choose_role`/`chooseRoleCapability` callers (`packages/shared/agent/orchestration/plan-act-verify.ts:626` and `web/lib/chat/tools/choose-role-tool.ts:108`) are LLM-driven with a Zod `describe()` / tool-description text that constrains the LLM to the 9-ID menu. Adding `{ mode: 'all' }` here would *weaken* the inputSchema's 9-ID guarantee and let the LLM trip the SEV-12 LLM-retry-leak path on a broad-union ID it has no context for.
- **User-surface dropdown UI.** No route/page that renders a role-picker dropdown for the user should pass `{ mode: 'all' }`.

### A.3 Corollary — Hybrid force-driven paths (selectAndComposeSystemPrompt + forceRole)

For hybrid paths where a caller invokes `selectAndComposeSystemPrompt({ forceRole: X })` directly (bypassing `pickRoleFromContext`):

- The caller PRE-VALIDATED the role constraint. No `{ mode: 'all' }` is automatically needed.
- Delegate to the upstream caller's origin:
  - If the `forceRole` value originated from an LLM-facing entry point (e.g., an aiTool's 9-ID description-constrained inputSchema), apply **Rule A.1** (default `'choose'`). The validation tier at `normalizeAndValidateRole` is still relevant because the LLM may have emitted a value outside the menu despite the inputSchema constraint.
  - If the `forceRole` value originated from an internal orchestrator path that broad-union-picked first (e.g., `pickRoleFromContext` returned `mlEngineer`), apply **Rule A.2** (pass `{ mode: 'all' }`). The 9-ID tier would otherwise silently reject `mlEngineer`.

Pattern: trace the role INPUT backwards through forceRole chains; pick Rule A.1 vs A.2 based on the origin, NOT based on which public API the role arrives at.

### Citation pattern

> Violates [Rule A.1] (`mode='all'` at LLM-facing entry). Pass-through `pickRoleFromContext → normalizeAndValidateRole` pipelines with internal-orchestrator trigger MUST pass `{ mode: 'all' }`; LLM-facing entry points must stay `'choose'`.

---

## Rule B — Inline-cast vs extract helper

**Decision rule.** Below N=2 cast sites for the same root cause, inline-cast acceptable. At N≥2 sites, extract an import-level helper adapter. This rule applies to TypeScript casts (`as any`, `as unknown as X`, narrowed-IIFE) AND to `@ts-expect-error` directives in concert.

### Canonical sites

- **Round-6 winning pattern (recommended):** `/opt/bing/web/components/ui/drawer.tsx` — `VaulComponent` import-level adapter at lines 16-30 wraps each `DrawerPrimitive.X` accessor as a typed passthrough; the 4 forwardRef sites reuse the adapter shape; Root's SINGLE-prop quirk is handled with a one-line `(shouldScaleBackground as any)` inline-cast at the JSX site.
- **Anti-pattern (rejected):** rounds 1-5 of `drawer.tsx` — per-site `@ts-expect-error` directives repeated 4 times for the same VaulRuntime mismatch root cause. Regressed TS2322 on the multi-sibling `<DrawerPrimitive.Content>` sibling JSX tree.

### When to inline-cast (`as any` / `as unknown as X` / narrowed-IIFE)

- **SINGLE site.** The cast surfaces at exactly one JSX expression for a SINGLE prop envelope quirk (e.g., Root `shouldScaleBackground={shouldScaleBackground as any}`).
- **Surgical prop envelope.** The cast preserves a runtime contract that the upstream typedef has dropped but the library defines (e.g., vaul vX removed `shouldScaleBackground` from `Root` props but runtime still respects it).

### When to extract an import-level helper adapter

- **N=2 sites, same LIBRARY-VERSION root cause (extract IMMEDIATELY).** Two sites where the root cause is library-version drift (e.g., vaul vX removed a prop; the bundled vaul version's typedefs drifted from the bundled runtime) extract IMMEDIATELY per the `drawer.tsx` round-6 precedent. Library-version drift tends to broaden: the third site arrives a few weeks later when the lib changes again. Inline `@rationale` on two such sites reads as "the workaround grew", not "two isolated quirks" — extract.<br>- **N=2 sites, isolated prop quirks (inline acceptable, document duplication).** Two sites where each cast surfaces a different isolated prop quirk (one prop removed upstream, one prop renamed upstream). At two such sites, write a `@rationale` JSDoc on BOTH sites explaining the duplication; consolidate ONLY when adding the third. The intent here is that two isolated quirks are not yet a structural pattern.
- **N≥3 sites, same root cause.** MANDATORY extraction. The duplication ossifies into a maintenance hazard: tracked errors, late-removal drift, and reader confusion. Extract a typed passthrough adapter at the import boundary:
  ```ts
  const XComponent = {
    Foo: Lib.Foo as Type1,
    Bar: Lib.Bar as Type1,
    Baz: Lib.Baz as Type2,
  };
  ```
- **Multi-sibling JSX bodies.** When the cast must span a JSX sibling tree (e.g., `<Portal><Overlay /><Content /></Portal>`), inline-cast and per-site `@ts-expect-error` BOTH regress under TS@5 next-line semantics. The cast MUST move to the import boundary so downstream consumers see the cast as a typed shape, not a per-site propagation hazard.

### When narrowed-IIFE cast applies

- **The cast is a per-call transformation, not a static shape adapter.** Example: `((x: unknown) => x as X)(value)` for a single assertion in a function body where the type-flow through the call-site cannot express the narrowing. Default to `as unknown as X` first; use the IIFE only when the call site cannot acquire the type via direct narrowing.

### Citation pattern

> Violates [Rule B.3] (≥3 inline-casts for the same root cause). Extract a `XComponent` import-level adapter per the round-6 precedent on `drawer.tsx`.

---

## Rule C — `@ts-expect-error` is acceptable vs BLOCKED

**Decision rule.** `@ts-expect-error` is BLOCKED in production code paths under the conditions in Rule B (multi-sibling JSX, ≥3-site root-cause repetition, CI-detectable root cause). `@ts-expect-error` is acceptable in test/ mocksites, single-call, where the under-typed API is the test target itself.

### Canonical anti-pattern (BLOCKED)

`/opt/bing/web/components/ui/drawer.tsx` rounds 1-5 — four per-site `@ts-expect-error` directives at `DrawerOverlay` / `DrawerContent` / `DrawerTitle` / `DrawerDescription` forwardRef sites. Round-5 regressed with TS2322 on `<DrawerPrimitive.Content>` because TS@5 next-line semantics don't propagate through the multi-sibling JSX body (`<Portal><Overlay /><Content /></Portal>`), and the third directive on `DrawerContent` triggered TS2578 because the directive is "unused" relative to the surrouding JSX. Round-6 converged on the import-level `VaulComponent` adapter (Rule B pattern). The fix path is documented in the round-7 reversion log.

### When `@ts-expect-error` is acceptable

- **Test/ mocksites, single-call.** Mock third-party libs whose types are out-of-sync with the test target. Each mock imports ONE upstream type-shape and casts the rest; per-site `@ts-expect-error` is acceptable here because the directive is the test target itself.
- **Type-sanity demonstration file.** A negative-test verifying that a bad tsconfig includes/excludes type defs (cf. `wrangler/templates/tsconfig-sanity.ts:1` `// @ts-nocheck \`@types/node\` should NOT be included`, but for `@ts-expect-error` this would be the equivalent "this SHOULD include but doesn't" demo).
- **SEV-tagged single-site workaround** with a tracked removal trigger. Pattern: `// @ts-expect-error SEV-NN — <api surface mismatch>; remove when <upstream package> vX refreshes typedefs.` When maintained, the directive is a temporary bridge with an automation-friendly removal trigger.

### When `@ts-expect-error` is BLOCKED

- **≥3 sites for the same root cause.** Consolidate per Rule B. `@ts-expect-error` directives that must be repeated 3+ times for the same VaulRuntime / type-mismatch class ossify into "permanent fixture" rather than "temporary bridge".
- **Multi-sibling JSX body.** When the cast spans a JSX sibling tree (e.g., Vaul's `DrawerPortal → DrawerOverlay + DrawerPrimitive.Content` siblings), per-outermost-JSX directive propagation breaks at TS@5 — the directive catches the FIRST sibling's TS2322 but the SECOND sibling's TS2322 still surfaces. ROOT CAUSE: import-level adapter per Rule B.
- **Root cause has a CI-detectable solution.** If a `next-types-trace`-style guardrail, vendor-drift detector, or pinned-version export-set snapshot (cf. ARCH-001 Flag 3) would catch the same drift on CI, prefer the guardrail over the suppression. The `@ts-expect-error` is sitting on top of a class-level signal the CI should fire on instead.

### Citation pattern

> Violates [Rule C.3] (multi-sibling JSX body). Per-outermost `@ts-expect-error` directives do not propagate to the second/third sibling at TS@5. Extract an import-level adapter per Rule B.

---

## Rule D — `@ts-nocheck` is acceptable ONLY at the top of a type-sanity demonstration file

**Decision rule.** `@ts-nocheck` is acceptable ONLY at the top of a type-sanity demonstration file — a negative-test verifying tsconfig includes/excludes behavior. It is BLOCKED for every other use case, including any production file, test file, hook, library, server route, AI tool, or component.

### Canonical precedent (acceptable)

`/opt/bing/ssh-ca/worker/node_modules/wrangler/templates/tsconfig-sanity.ts:1`:
```ts
// @ts-nocheck `@types/node` should NOT be included
```
The file is a demonstration file committed to the wrangler repo to verify the schema-vs-tsconfig include/exclude semantics. The `@ts-nocheck` at the top is REQUIRED so a syntactic-correct file can be TYPE-ERROR'd by tsc when the bad `@types/node` IS present, demonstrating the failure mode.

### When `@ts-nocheck` is acceptable

- **Negative-test tsconfig demonstration files.** A standalone file whose purpose is to demonstrate that a tsconfig misconfiguration produces a tsc error. The `@ts-nocheck` is necessary to keep the file syntactically valid while letting the broken `tsc.json` show the failure.

### When `@ts-nocheck` is BLOCKED (everywhere else)

- **Production code paths** — components, services, hooks, libraries, server routes, AI tools, routes — no acceptable use. `@ts-nocheck` blocks ALL type-checking on the file, masking every other potential type error. The blast radius is unbounded: introducing a NEW type error by mistake will go silent.
- **Test files** — tests are the most concentrated type-error surface area. A wrong prop name, wrong enum value, wrong interface field — these are exactly the errors `@ts-nocheck` would silently let through.
- **Acceptable alternatives exist.** Per Rule C, `@ts-expect-error` is the surgical bridge for a known-bad third-party type surface; Rule B's import-level adapter consolidates multi-site casts; the vendor-drift guardrail (ARCH-001 Flag 3) automates the SEV-NN discovery. None of these require blanket-suppression.

### Citation pattern

> Violates [Rule D.1] (`@ts-nocheck` on production file). The blanket suppression masks every other type error on the file; use `@ts-expect-error` per Rule C or extract an adapter per Rule B instead.

---

## `@rationale` JSDoc template (inline, NOT a separate file)

The `@rationale` JSDoc block is the standard inline annotation at every cast site that does NOT roll up into a Rule B import-level adapter. Apply it directly above the `export const`, the forwardRef declaration, or the JSX expression that carries the cast.

**Template:**

```ts
/**
 * @rationale <technique chosen>: <one-line justification> — <ticket ID>; remove when <removal trigger>.
 */
```

**Length budget:** 1-3 lines, not 20. Verbose inline JSDoc becomes noise.

**Examples already in the codebase** (apply the template as a `@rationale` line at each):

| Site | Technique | Rationale one-liner | Ticket |
|---|---|---|---|
| `web/lib/utils/empty-module.ts` Headers/Request/Response/fetch | `= stub` Proxy | Turbopack static-rejects undeclared named exports; Proxy preserves callable shape | SEV-10 |
| `web/lib/utils/empty-module.ts` ModalClient/Sandbox/Image/App/Secret/Volume | `= stub` Proxy | Same as above for `modal` npm package | SEV-14 |
| `web/lib/utils/empty-module.ts` Daytona/Blob/File/FormData/URL/URLSearchParams/ReadableStream/Buffer/process | `= stub` Proxy | Same for `@daytonaio/sdk@0.175.0` | SEV-13 |
| `web/lib/utils/empty-module.ts` FileSystem/Workspace/DockerImage/Chart/ComputerUse/Snapshot | `= stub` Proxy | Preemptive SDK-symbol coverage expansion (drift target) | SEV-15 |
| `web/components/ui/drawer.tsx` Root `shouldScaleBackground={shouldScaleBackground as any}` | `as any` (Q5 carve-out) | vaul vX removed this prop from Root typedef but runtime respects it — cast on the JSX expression keeps the prop envelope without widening the adapter | (refer to ARCH-001 Flag 2) |
| `web/components/ui/drawer.tsx` VaulComponent adapter | import-level typed passthrough adapter | Consolidates 4 per-site cast sites (Overlay/Content/Title/Description) per Rule B | (refer to ARCH-001 Flag 2) |

---

## Ticket cross-link appendix

This doc is cross-referenced from each ticket footer. Add the following line at the bottom of every SEV-NN.md and ARCH-NNN.md "**Cross-references**" / "**References**" section:

```markdown
- [Engineering decision rules](../docs/ENGINEERING_DECISION_RULES.md) — Rules A/B/C/D for normalization modes, inline-cast vs helper, `@ts-expect-error` policy, `@ts-nocheck` policy.
```

The relative path `../docs/ENGINEERING_DECISION_RULES.md` resolves correctly from both `/opt/bing/.tickets/` (ARCH / RT / SEV family) and any future ticket locations. The breadcrumb is sufficient to navigate from a picked-up ticket into the rulebook without polluting the ticket body.

---

## Decision-rule audit checklist (use in PR review)

When reviewing a PR that adds or modifies a cast / suppression / mode parameter, apply this checklist:

- [ ] **Rule A — mode selection.** If the new code calls `normalizeAndValidateRole`, is the `mode` parameter set correctly per Rule A.1 (LLM-facing default `'choose'`) or A.2 (internal-orchestrator / MCP / test `'all'`)? Cross-reference: does the call originate from `pickRoleFromContext` (→ `'all'`), an aiTool description (→ `'choose'`), or MCP `role_selection` (→ `'all'`)?
- [ ] **Rule B — cast site count.** Does the new cast pattern duplicate a pre-existing root cause? If the file already has the same workaround at N sites and the new PR adds N+1, cite Rule B.3 and request extraction of the adapter.
- [ ] **Rule C — `@ts-expect-error` acceptability.** Is the directive applied at a single test/ mocksite, or is it applied ≥3 times, or does it span a multi-sibling JSX body? If any of the BLOCKED conditions hold, request consolidation / adapter extraction per Rule B before merging.
- [ ] **Rule D — `@ts-nocheck` prohibition.** Is the directive at the top of a type-sanity demo file? If not, request removal and replace with one of Rule C's acceptable alternatives.

---

## Changelog

- **v1.0 — 2026-06-18.** Initial codification. Source data: SEV-12 / SEV-13 / SEV-14 / SEV-15 sweep; 6-round drawer.tsx vaul repair; unified-role-selector audit-comment block.

## See also

- [Monorepo Layout](MONOREPO_LAYOUT.md) — the `.bing-shared/*` vs `packages/shared/*` tsconfig resolution priority. Any contributor adding files under `packages/*`, `packages/platform/*`, or `infra/*` should READ THIS BEFORE doing so; a new file at a relative path that already exists under `web/.bing-*` will silently shadow the mirror copy. See the "What to do when adding a new file" section for the decision tree and PR-description template.
