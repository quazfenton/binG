# Monorepo Layout

> **Source of truth for which file wins when `@bing/shared/*` (or any other
> `@bing/*` alias) is resolved.** This doc is the canonical reference for
> the mirror-vs-canonical resolution priority and the consequences for
> contributors.

## Top-level structure (`/opt/bing`)

```
/opt/bing/
├── packages/                    # Workspace packages (npm workspaces)
│   ├── shared/                  # 226 files — canonical @bing/shared/* source
│   ├── platform/                # Canonical @bing/platform/* source
│   └── mcp-server/              # Standalone MCP server package
├── infra/                       # Canonical @bing/infra/* source
├── web/                         # Next.js app (the consumer of the mirrors)
│   ├── .bing-shared/            # 101 files — tsconfig-aliased MIRROR of packages/shared/*
│   ├── .bing-platform/          # tsconfig-aliased MIRROR of packages/platform/src/*
│   ├── .bing-infra-config/      # tsconfig-aliased MIRROR of infra/*
│   ├── app/                     # Next.js app/ directory
│   ├── lib/                     # web-local source (NOT mirrored)
│   ├── components/              # web-local React components (NOT mirrored)
│   ├── public/                  # static assets
│   ├── tsconfig.json            # ← resolution priority lives here
│   ├── package.json             # @bing/web
│   └── vitest.config.ts
├── scripts/                     # repo-level scripts (sync, drift check, etc.)
├── docs/                        # this doc + all other repo docs
└── .agents/  .amp/  .codex/     # tool configs
```

## The four `web/.*` mirrors

The three `web/.bing-*` directories (plus `web/.bing-infra-config`) are
**build-time mirrors** of the corresponding canonical source. The
hypothesis for why they exist (not verified in this doc — please check
the relevant Next.js / Turbopack / monorepo discussions for the
specific reason): Next.js / Turbopack hot reload + path-alias
resolution may be faster when the source lives at a known depth inside
the `web/` tree, and Turbopack in particular has been observed to
suffer significant cold-compile latency for cross-root imports under
some bundler configurations.

The mirrors are NOT symbolic links — they are real directories. A
contributor who edits `web/.bing-shared/agent/foo.ts` is editing the
mirror, not the canonical `packages/shared/agent/foo.ts`. There is no
automatic sync between the two: today they happen to be in sync because
the audit on 2026-07-08 confirmed 0 `packages/` counterparts for the
files edited in the Tier 8 step 8 apply (see "Audit history" below).

## Resolution priority (THE CRITICAL PART)

`web/tsconfig.json` declares path aliases for the `@bing/*` family.
For each alias, the array is **ordered** — TypeScript / Next.js / vitest
all try the entries **in order** and use the first one that resolves.

**The canonical (`packages/*`, `infra/*`) entry is FIRST. The mirror
(`web/.bing-*`) entry is SECOND.**

Verbatim from `/opt/bing/web/tsconfig.json` (lines 25-52):

```jsonc
"paths": {
  "@bing/platform":     ["../packages/platform/src/env.ts",  "./.bing-platform/src/env.ts"],
  "@bing/platform/*":   ["../packages/platform/src/*",       "./.bing-platform/src/*"],
  "@bing/shared":       ["../packages/shared/index.ts",      "./.bing-shared/index.ts"],
  "@bing/shared/*":     ["../packages/shared/*",             "./.bing-shared/*"],
  "@bing/shared/agent": ["../packages/shared/agent/index.ts","./.bing-shared/agent/index.ts"],
  "@bing/shared/agent/*":["../packages/shared/agent/*",      "./.bing-shared/agent/*"],
  "@bing/infra/*":      ["../infra/*",                        "./.bing-infra-config/*"]
}
```

### What this means in practice

For an import like:

```ts
import { foo } from '@bing/shared/agent/services/scheduler/triggers/marker-scanner';
```

The resolver tries:
1. `packages/shared/agent/services/scheduler/triggers/marker-scanner.ts` (canonical)
2. `web/.bing-shared/agent/services/scheduler/triggers/marker-scanner.ts` (mirror) ← **only used if step 1 misses**

**Consequence for contributors**: any future PR that creates a file
under `packages/shared/*` will **silently shadow** the mirror copy
under `web/.bing-shared/*`. After the PR lands, an `import` that was
previously resolving to the mirror will resolve to the new canonical
file — with no compiler warning, no test failure, no PR-comment signal.

### Worked example (hypothetical)

Before the PR: `@bing/shared/agent/services/scheduler/triggers/marker-scanner`
resolves to `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts`.

A PR adds `packages/shared/agent/services/scheduler/triggers/marker-scanner.ts`.

After the PR: the same import resolves to the new canonical file. The
mirror copy at `web/.bing-shared/...` is now ORPHANED — it is still on
disk but no longer reachable via the alias. Any subsequent edit to the
mirror is a silent no-op (the canonical file is what runs in production).

The orphan is invisible to TypeScript and vitest unless a CI step
explicitly diffs `packages/shared/*` against `web/.bing-shared/*` to
flag drift.

## What to do when adding a new file

Before adding a file under `packages/shared/`, `packages/platform/`, or
`infra/`:

1. **Search the mirror for an existing copy.** If a mirror copy exists
   at the same relative path, the existing mirror will be silently
   shadowed. Decide which one is canonical for your change:
   - If the change is a workspace-wide refactor (e.g., changing a
     shared interface signature), prefer editing the canonical
     `packages/*` AND updating the mirror in lockstep.
   - If the change is web-only, prefer keeping the file in the mirror
     and NOT creating a canonical counterpart.
2. **Document the choice in the PR description.** "This change is
   web-only — no canonical counterpart added" / "This change adds
   packages/shared/X — mirror web/.bing-shared/X is now orphaned and
   removed in this PR" / "This change is a shared interface refactor
   — packages/shared/X and web/.bing-shared/X both updated in lockstep".

The third option ("lockstep update") is the most fragile because there
is no automated sync. Prefer the first two options unless the
cross-root reach justifies the duplication cost.

### Strongly recommended: add a CI mirror-drift detector

The repo currently has no automated check for `packages/*` vs
`web/.bing-*` mirror drift. The pattern exists in
`scripts/check-vendor-api-drift.ts` (a similar diff check for vendor
APIs). A future PR should add a `scripts/check-monorepo-mirror-drift.ts`
that:
- Walks `web/.bing-shared/`, `web/.bing-platform/`, `web/.bing-infra-config/`
- For each file, checks if a canonical counterpart exists at the
  resolved mirror→canonical path
- If a canonical counterpart exists, diffs the two and fails CI on
  drift
- If no canonical counterpart exists, warns (does not fail) that
  the mirror is the sole source — the doc above is the only
  documentation of the relationship

Until that script exists, the burden is on the contributor to (a)
read this doc, (b) check the mirror, (c) document the choice in the
PR description.

## What to do when editing an existing mirror file

If you are editing a file under `web/.bing-shared/`, `web/.bing-platform/`,
or `web/.bing-infra-config/`:

1. **Check if a canonical counterpart exists.** Run
   `find /opt/bing/packages -name '<yourfile>'` (or `/opt/bing/infra`
   for `.bing-infra-config`). If a match is found, the canonical file
   is the one being resolved — your edit to the mirror is a no-op.
2. **If no canonical counterpart exists**, your mirror edit is the
   real edit. Add a comment at the top of the file explaining that
   it is the canonical source for now and naming the path it would
   live at if promoted to `packages/shared/*`.

## Audit history

- **2026-07-08 (Tier 8 step 8 apply)**: The `.bing-shared/*` mirror
  vs `packages/shared/*` priority was identified as a risk during the
  audit of `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts`
  edits. The audit confirmed 0 `packages/shared/services/scheduler/...`
  counterparts exist for the files edited in the apply — so the
  mirror-only edits are safe today. This doc was created to capture
  the risk for future contributors.

## See also

- `/opt/bing/web/tsconfig.json` (lines 21-53) — the resolution-priority
  source of truth
- `/opt/bing/scripts/check-vendor-api-drift.ts` — CI drift-detection
  script (reusable as a pattern for a `packages/*` vs `web/.bing-*`
  mirror-drift detector if/when one is added)
- `/opt/bing/docs/ENGINEERING_DECISION_RULES.md` — repo-wide
  engineering rules
- `/opt/bing/docs/prompt-orchestrator-deferred-steps.md` — example
  of a doc that was authored against the mirror (the apply cycle
  edited `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts`
  with no canonical counterpart, verified by the 2026-07-08 audit)
