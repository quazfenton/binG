# ARCH-001 — Three architectural followups surfaced by the SEV-12 / SEV-13 / SEV-15 audit chain

**Status:** Open (work intentionally deferred — see §"Not in this commit")
**ID:** ARCH-001 (first of a new ticket family; orthogonal to the RT-001..RT-005 routing/threshold family)
**Severity:** low (latent — each flag is a workaround that today keeps residual tsc errors out of CI; long-term blast radius is "the workaround calcifies into a permanent fixture")
**Type:** architecture / refactor / CI guardrail
**Affected files (cross-cuts):**

| Flag | Primary sites |
|---|---|
| 1. Shape consolidation | `/opt/bing/web/app/api/chat/route.ts:1697`, `/opt/bing/web/lib/orchestra/unified-agent-service.ts:1706+1711`, `/opt/bing/web/lib/orchestra/unified-agent-service.ts:4636+4645`, `/opt/bing/web/lib/chat/auto-continue-helper.ts:174` |
| 2. Vaul version pin | `/opt/bing/web/components/ui/drawer.tsx` (root + 4 forwardRef sites: Overlay/Title/Description/Content) |
| 3. Vendor-drift guardrail | `/opt/bing/web/lib/utils/empty-module.ts` (SEV-15 audit anchor), `/opt/bing/web/next.config.mjs` (Webpack/Turbopack alias list), `node_modules/@daytonaio/sdk@0.175.0/dist/index.d.ts` (pinned-version export set for the drift baseline), CI scripts in `/opt/bing/scripts/preflight*` if present |

> **Not in this commit.** This ticket is opened so the architectural work has a documented home. Each flag below is meant to land as its own commit/PR; this commit deliberately contains only the ticket file.
>
> **Gitignore note.** `/opt/bing/.tickets/` is **not** in `/opt/bing/.gitignore` (verified during RT-005 pickup). Stage by path (`git add .tickets/ARCH-001-vendor-shape-consolidation.md`); do not let `git add -A` carry it along with source-edit commits.
>
> **Scope-clarification note (interpretive call).** Your request was "open a separate sprint ticket for the architectural flags surfaced in this investigation." Three flags crossed the line between "workaround" (justified in the SEV-12 / SEV-13 / SEV-15 patches) and "structural debt that should be paid down". Those three are filed here. Other minor followups (the SEV-15 reviewer's 5 non-blocking items, the SEV-13 reviewer's 4 non-blocking items) deliberately stay off this ticket — they are cleanup of the workaround layer, not architectural debt.
>
> **Disambiguation from RT-006.** RT-005 reference footer reserves "RT-006" as a soft forward-reference for mirror alignment of `/opt/bing/web/.bing-shared/agent/first-response-routing.ts`. ARCH-001 is **NOT** that ticket — ARCH-001 is a parallel-prefix ticket family covering cross-cutting architectural flags. RT-006 remains pending open in the RT family; ARCH-001 opens a new family from scratch.

---

## Background (context for all three flags)

The SEV-12 sweep (TS2345 / TS2322 / TS2739 narrow-and-cast), the SEV-13 patch (CHOOSE_ROLE_MENU production-guard extraction), and the SEV-15 patch (proactive `@daytonaio/sdk` symbol expansion in `empty-module.ts`) collectively surfaced three architectural seams where the **patched workaround** is fundamentally backwards-facing:

1. **Boundary casts at every cross-package shape translation.** The narrow-and-cast pattern (`result as unknown as Parameters<typeof decideAutoContinue>[0]['result']`) keeps the seam working at the call boundary, but the real fix is that the producer (`processUnifiedAgentRequest`) should emit a shape that the consumer (`decideAutoContinue`) accepts directly — eliminating the cast at every call site.
2. **A library-version-driven runtime cast in the UI tier.** The `shouldScaleBackground={shouldScaleBackground as any}` workaround on the Drawer Root + the 4 `forwardRef` `@ts-expect-error` directives reflect a mismatch between the vaul surface we use and the vaul version we have installed. The fix is a single coordinated version pin across `web/components/ui/`, not a permanent cast.
3. **Vendor API drift surfacing as after-the-fact manual sweeps.** SEV-15's audit anchor `// bump this anchor on next SDK bump` is a discipline reminder with no automated gate. The fix is a CI guardrail (radically similar to `next-types-trace`) that pins vendor-API export sets at install time and breaks tsc when they drift.

These three flags are filed together because they share a common shape: "today we patched around them; the patch is acceptable but the underlying architectural debt should be paid down."

---

## Flag 1 — Consolidate `UnifiedAgentResult` ↔ `AutoContinueResultData` shape upstream

### Background

`/opt/bing/web/lib/chat/auto-continue-helper.ts:174` exports:

```ts
export interface AutoContinueResultData extends DetectableResult {
  // shape consumed by decideAutoContinue's parameter type
}
```

`/opt/bing/web/lib/orchestra/unified-agent-service.ts` defines a DIFFERENT but overlapping `UnifiedAgentResult` interface. The two interfaces are not structural twins — `AutoContinueResultData` carries detector-helper fields (`errors`, `toolFailures`, `incompleteSignals`) that `UnifiedAgentResult` does NOT carry by name, and `UnifiedAgentResult` carries orchestrator/UI fields (`mode`, `metadata`, `fileEdits`, `loopAbort`) that `AutoContinueResultData` does NOT carry.

The SEV-12 round-7 patch (c) addressed this with `result as unknown as AutoContinueResultData` at the call boundary, and SEV-12 round-8 added a second cast at the same shape on L4636 with the `Parameters<typeof decideAutoContinue>[0]['result']` indexed expression for type-system coupling. BOTH casts work today, but they are two paths in the codebase doing the same translation independently — which is the textbook indicator that the underlying types are wrong.

### Proposed reconciliation

Make `processUnifiedAgentRequest` (the producer of `UnifiedAgentResult`) emit a single enriched shape that satisfies both interfaces natively. The shape extension should:

- Add the three missing detector-helper fields to `UnifiedAgentResult`: `errors: ReadonlyArray<unknown>`, `toolFailures: ReadonlyArray<ToolResult>`, `incompleteSignals: ReadonlyArray<unknown>`.
- Decide whether the `detector` extension is opt-in via `Pick<AutoContinueResultData, ...>` or whether `UnifiedAgentResult` fully subsumes `AutoContinueResultData` (recommended — full subsumption eliminates the union).
- Update `decideAutoContinue`'s parameter type to `Pick<UnifiedAgentResult, 'steps' | 'responseText' | 'result'> & { requestId: string; routing?: ... }` (or, if full subsumption, just `UnifiedAgentResult['result']`).

After consolidation:

- **Delete** the cast at `route.ts:1697` (`result as unknown as AutoContinueResultData`).
- **Delete** the cast at `unified-agent-service.ts:1711` (`result: result as unknown as AutoContinueResultData,`).
- **Delete** the cast at `unified-agent-service.ts:4645` (`}))() as unknown as Parameters<typeof decideAutoContinue>[0]['result'],`).
- `choose-role-tool.ts` `assertNoChooseRoleMenuDrift()` and any future site that needed the boundary cast can call `decideAutoContinue({ ..., result: result })` directly.

### Acceptance criteria (when the fix lands)

- [ ] `UnifiedAgentResult` in `unified-agent-service.ts` includes `'errors'` (or equivalent), `'toolFailures'`, `'incompleteSignals'` fields with documented semantics.
- [ ] `decideAutoContinue`'s parameter shape in `auto-continue-helper.ts` either subsumes `UnifiedAgentResult` (recommended) or has a clean declared overlap with it.
- [ ] Three explicit boundary casts REMOVED:
  - `/opt/bing/web/app/api/chat/route.ts:1697`
  - `/opt/bing/web/lib/orchestra/unified-agent-service.ts:1711`
  - `/opt/bing/web/lib/orchestra/unified-agent-service.ts:4645`
- [ ] No `as any` introduced by the consolidation.
- [ ] `classifyV1Route`, `decideAutoContinue`, `runV1Orchestrated`, `runV1Api` all consume `UnifiedAgentResult` directly without boundary casts.
- [ ] Existing tests in `__tests__/chat/auto-continue-helper.test.ts` continue to pass.
- [ ] Targeted tsc on touched files: 0 boundary-cast errors of shape `TS2739` remain.

### Out of scope / not in this commit

- The actual `auto-continue-helper.ts` / `unified-agent-service.ts` / `route.ts` source edits.
- Refactoring `DetectableResult` (the upstream base of `AutoContinueResultData`).
- Vendor-shape exports (`@bing/shared/agent/*`) — Flag 3 covers CI guardrails for those.

---

## Flag 2 — Coordinate a `vaul` version pin across `web/components/ui/`

### Background

`/opt/bing/web/components/ui/drawer.tsx` is a single-component port of vaul's `DrawerPrimitive.*` family. The component renders:

- **Root** (`<Drawer.Root shouldScaleBackground={shouldScaleBackground as any}>`) — the prop type on `shouldScaleBackground` is `boolean | undefined` upstream, but the bundled vaul version accepts `unknown`, hence the cast.
- **Overlay**, **Content**, **Title**, **Description** — each is a `React.forwardRef` whose upstream type signature differs from the bundled vaul version. The patches used `@ts-expect-error` directives to suppress the resulting TS2322 errors. Round-6 converged on the working solution (a `VaulComponent` adapter with a typed signature) but rounds 1-5 each failed with TS2578 / TS2322 propagating through deeply-nested sibling JSX.

All four `forwardRef` sites + the Root `shouldScaleBackground` cast together imply that the bundled vaul version's surface drifts from the vaul version that the upstream type definitions describe.

### Proposed reconciliation

Coordinate a SINGLE vaul version pin across `/opt/bing/web/components/ui/` so the bundled version matches the upstream type definitions exactly:

1. **Inventory check.** Run `pnpm ls vaul` (or `npm ls vaul`) in `/opt/bing` and `/opt/bing/web` to confirm whether vaul is hoisted, nested, or duplicated.
2. **Pin the version** in `/opt/bing/web/package.json` (or `/opt/bing/package.json` if hoisted) with an exact-version range (no `^` or `~`).
3. **Re-derive the types.** If the bundled version's `.d.ts` differs from the upstream type definitions, regenerate the local types via `pnpm dlx vaul@<pinned-version> --dts` (or the equivalent CLI for vaul's type-emit pipeline) and drop them under a `web/types/` directory.
4. **Drop all casts.** Once the types match, remove:
   - `shouldScaleBackground={shouldScaleBackground as any}` on Root.
   - All 4 `@ts-expect-error` directives on `forwardRef` sites (Overlay, Content, Title, Description).
   - The `VaulComponent` adapter that round-6 introduced as a workaround.
5. **Re-add tests** for the Drawer component (currently absent; the SEV-14 + SEV-15 cycles added casts without adding tests to verify the casts are doing the right thing).

### Acceptance criteria (when the fix lands)

- [ ] Single vaul version pin across `web/components/ui/` (exact-version range, no `^`/`~`).
- [ ] `pnpm ls vaul` returns exactly one vaul version (no duplication across `/opt/bing`, `/opt/bing/web`, `/opt/bing/desktop`, etc.).
- [ ] Zero `as any` casts in `drawer.tsx`.
- [ ] Zero `@ts-expect-error` directives in `drawer.tsx`.
- [ ] No TS2322 errors in `drawer.tsx` after the version pin (verifiable via targeted tsc).
- [ ] At least one vitest added covering: Drawer Root → renders, Drawer Trigger → opens overlay, shouldScaleBackground → propagates `boolean | undefined` without cast. Path: `/opt/bing/web/components/ui/__tests__/drawer.test.tsx`.

### Out of scope / not in this commit

- The actual vaul version upgrade (one-off, scheduled).
- Refactoring the other ui primitives that follow the same port pattern (`sheet.tsx`, `popover.tsx`, `tooltip.tsx` — their type-mismatch surface may overlap).
- Generating the local vaul type definitions (one-off).

---

## Flag 3 — Vendor-drift CI guardrail (next-types-trace-style for non-Next APIs)

### Background

The SEV-15 patch (`/opt/bing/web/lib/utils/empty-module.ts`) preemptively declared 6 `@daytonaio/sdk` symbols (`FileSystem`, `Workspace`, `DockerImage`, `Chart`, `ComputerUse`, `Snapshot`). The patch included a comment-as-anchor:

```ts
//   - Snapshot: ..., keep on next SDK bump
```

This anchor is a discipline reminder with no automated enforcement: a future SDK bump that adds, removes, or renames an export will NOT surface as a tsc error — it will only surface as a runtime `TypeError` (or, worse, as a silent acceptance-via-proxy at compile time, IF the empty-module Proxy is doing its job).

Across the SEV-chain, similar vendor API mismatches surfaced without a guardrail:

- SEV-13 (`Daytona` SDK at `lib/sandbox/providers/daytona-provider.ts:1`).
- SEV-14 (`ModalClient` SDK at `lib/modal/modal-client.ts`).
- SEV-15 (`@daytonaio/sdk` package in `empty-module.ts`).
- The `vaul` package version drift (Flag 2).
- The `Vercel AI SDK` `ModelMessage[]` schema validation failures (mentioned in `unified-agent-service.ts:processUnifiedAgentRequest`'s v1-agent-loop branch).

### Proposed reconciliation

Add a CI guardrail that pins the vendor-API export set at install time and breaks tsc when the export set drifts:

1. **Snapshot script.** Create `/opt/bing/scripts/check-vendor-api-drift.ts` (runnable as `pnpm dlx tsx scripts/check-vendor-api-drift.ts`). For each pinned vendor package (`@daytonaio/sdk`, `vaul`, `@opencode-ai/sdk`, `modal`, etc.), the script:
   - Imports from the package (or static-analyses its `package.json` `exports` map + the `.d.ts` files under `node_modules/<package-name>/dist/`).
   - Collects the full set of NAMED exports.
   - Writes the set to `/opt/bing/scripts/vendor-api-snapshots/<package-name>.json`.
2. **Diff check.** On every CI run (or pre-commit hook), the script compares the live export set to the snapshot. If they differ, exit non-zero with a printed diff:
   ```
   [vendor-drift] @daytonaio/sdk export set drifted:
     + new: Workspace.from
     - removed: Snapshot.pull
     ~ renamed: Image → ContainerImage
   ```
3. **Wire into preflight.** Add `pnpm check:vendor-drift` to the existing `/opt/bing/scripts/preflight.sh` (or `pnpm preflight` script if present). The pure-radical pattern after `next-types-trace` is to write the snapshot to disk and `git diff` it on CI; real-time tsc breakage is the optional secondary.
4. **Cover the SEV-15 anchor specifically.** Update the SEV-15 audit anchor to read `// Snapshot drift target — see /opt/bing/scripts/vendor-api-snapshots/@daytonaio-sdk.json (regenerate via \`pnpm check:vendor-drift --update\` on SDK bump)`.

### Acceptance criteria (when the fix lands)

- [ ] `/opt/bing/scripts/check-vendor-api-drift.ts` exists, is runnable via `pnpm dlx tsx scripts/check-vendor-api-drift.ts`, and exits 0 on no-drift / non-zero on drift.
- [ ] Snapshot files exist for the 4 packages named in this ticket at minimum: `@daytonaio/sdk`, `vaul`, `modal`, `@opencode-ai/sdk`.
- [ ] `pnpm check:vendor-drift` is wired into `/opt/bing/scripts/preflight.sh` (or equivalent), so drift surfaces as a CI break not as an after-the-fact manual sweep.
- [ ] SEV-15 audit anchors in `empty-module.ts` updated to reference the snapshot file + the regeneration command.
- [ ] Drift test: a forced fake-drift (renaming an export in a snapshot file) breaks preflight with a clear diff message.
- [ ] On a real SDK bump, the operator workflow is: bump SDK → run `pnpm check:vendor-drift --update` → review the printed diff → commit the snapshot if intentional, or roll back the bump if not.

### Out of scope / not in this commit

- Real-time tsc breakage (the script surfaces drift as a CI failure, not as a build-time tsc error — the build-time approach is more invasive and would require plumbing vendor types into the tsc config; defer to a follow-up ARCH ticket).
- Replacing `/opt/bing/scripts/preflight.sh` wholesale.
- Auto-regenerating snapshots on a SDK bump (the workflow is explicit `--update`, not auto).

---

## Why three flags, not one merged ticket

The three flags are filed together because they share the "patched workaround paying debt later" shape. They are deliberately NOT merged into a single mega-ticket because:

1. **Different acks.** Flag 1 (shape consolidation) wants a mechanical type-system fix. Flag 2 (vaul pin) wants a coordinated version-pin decision. Flag 3 (CI guardrail) wants a brand-new script + plumbing. A reviewer reviewing all three at once gets dilution.
2. **Different owners.** Flag 1 will likely be picked up by the maintainer who owns `unified-agent-service.ts` and `auto-continue-helper.ts`. Flag 2 will likely be picked up by the maintainer who owns `web/components/ui/`. Flag 3 is platform-team work.
3. **Different lifecycles.** Flag 1 lands in 1-2 days of focused diff-time. Flag 2 lands in 1-2 days PLUS a coordinated SDK-bump PR. Flag 3 lands in 3-5 days (new script + plumbing + 4 snapshot files + anchor updates + drift test).

Keeping them as numbered sub-flags (`ARCH-001.1`, `ARCH-001.2`, `ARCH-001.3`) so the family has an audit chain, but the acceptance criteria are independent.

---

## Naming convention note (forward-looking)

This ticket opens the **ARCH-NNN** family. Future architectural followups that do NOT fit the RT-NNN routing/threshold family should use ARCH-NNN. Suggested naming:

- **RT-NNN** — Routing/threshold followups (RT-001..RT-005 active; RT-006 soft-reserved).
- **ARCH-NNN** — Cross-cutting architectural followups (ARCH-001 = this ticket).
- **SEV-NN** — Severity-tagged bug reports (SEV-12 / SEV-13 / SEV-15 active).

---

## Cross-references

- **SEV-12** — boundary-cast pattern applied at L1706, L4636, route.ts:1697. Status: Open. Severity: medium (workaround, not pinned by a CI gate).
- **SEV-13** (recent SEV-chain, on this audit cycle) — `@daytonaio/sdk` preemptive stub at `/opt/bing/web/lib/utils/empty-module.ts`. This is the SEV-13 referenced by the Flag 1 + Flag 3 cross-cuts in this ticket.
- **ARCH-SEV-13-pre-stubs** (separate, prior audit chain) — `low` server-side refresh-mismatch (the August 2024 auth/logout symptom). Listed in `BUGS_AUDIT.md`. **Distinct from the recent SEV-13** above. The retroactive rename to `ARCH-SEV-13-pre-stubs` is the corridor handoff so a `grep SEV-13` returns exactly one match per state of the codebase (recent chain). Future readers looking up "SEV-13" via this ticket should default to the recent chain (Daytona stub); to look up the pre-stub SEV-13, grep `ARCH-SEV-13-pre-stubs`.
- **SEV-15** — proactive `@daytonaio/sdk` symbol expansion; audit anchor is the comment on the `Workspace` and `Snapshot` constants in `empty-module.ts`.
- **RT-001..RT-005** — routing/threshold sweep. Status: RT-001..RT-005 Open; RT-006 soft-reserved for mirror alignment.
- **SEV-14** — ModalClient preemptive stub (vendor mismatch history similar to SEV-15 but lower priority).

---

## Open question (for pickup-phase reviewer)

Of the three flags, **which should be picked up first**? The recommended order (subject to maintainer prerogative):

1. **Flag 3** (CI guardrail) — picks up "vendor API drift" as a class, not just for one package. Future sweeps (SEV-NN-1, RT-NNN-1) can use the script instead of writing audit anchors.
2. **Flag 1** (shape consolidation) — deletes the three boundary casts added by SEV-12. Pure mechanical.
3. **Flag 2** (vaul pin) — requires a coordinated SDK-bump PR + version-lock decision. Slowest cycle.

Pickup-phase reviewer: please confirm or override the order at first-look. If the order is overridden, the "Out of scope / not in this commit" sections remain accurate (each flag is independently scoped).
