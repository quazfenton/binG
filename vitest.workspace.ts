/**
 * vitest 4 workspace configuration \u2014 ORCHESTRATOR OF RECORD.
 *
 * Replaces the previous arrangement where:
 *   - /opt/bing/vitest.config.ts (root) declared `include` global globs
 *     (`**/__tests__/**/*.test.ts`, `test/**/*.test.ts`, ...) and tried to
 *     govern ALL workspaces from a single config, with `exclude` masking
 *     `**/web/**` to prevent overlap.
 *   - /opt/bing/web/vitest.config.ts duplicated the same `__tests__/**/*.test.ts`
 *     glob and re-declared it for the web subproject.
 *   - pnpm recursive orchestration (`pnpm -r ... test`) routed by workspace
 *     filter only, with no per-project isolation tuning.
 *
 * The new arrangement (vitest 4 native workspaces):
 *   - Two named projects, each with its own `root`, `include`, `pool`,
 *     `poolOptions`. Vitest runs the projects in isolation \u2014 each project's
 *     `include` filters against ITS OWN root, so the brittle cross-project
 *     `**/__tests__/**` glob is gone.
 *   - Workspace projects inherit test invocation: `vitest run` (no config flag)
 *     automatically picks up this `vitest.workspace.ts` and runs all projects.
 *     `vitest --project web` runs only web. `vitest --project packages` runs
 *     only packages.
 *   - Per-project pool sizing follows workload: `packages` runs sequentially
 *     (single fork, cheap), `web` runs with up to 4 forks (heavy test volume).
 *
 * CWD assumption: all paths in this file are RELATIVE TO /opt/bing (the
 * directory this workspace file lives in). The `extends` path on the `web`
 * project is the canonical pattern that also gets discovered when vitest is
 * invoked from /opt/bing/web/ with `--project web` (verified empirically).
 * If this file is moved, update the relative paths AND the explicit
 * `./` prefixes below — they harden against cross-team reproduction
 * when maintainers re-run from a sub-cwd.
 *
 * Audit reference: F4 (vitest workspace config duplication) \u2192 upgraded to
 * native vitest.workspace.ts.
 */

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // \u2500\u2500\u2500 packages/* : minimal, sequential \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // packages/* has its own per-package vitest passes (e.g. packages/shared
  // runs `tsc --noEmit -p tsconfig.json` for typecheck). The orchestrator
  // ONLY invokes runtime test suites that exist today: none of packages/*
  // ships a runtime `.test.ts` yet. We declare the project anyway so that
  // when tests land (e.g. for agent validation logic), they auto-discover
  // without needing a workspace.ts edit.
  {
    name: 'packages',
    root: './packages',
    test: {
      include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.tsbuildinfo'],
      pool: 'forks',
      poolOptions: {
        forks: {
          // Sequential. packages/* has ~0 tests today; once tests land,
          // singleFork keeps deterministic ordering for the small N expected.
          singleFork: true,
        },
      },
      testTimeout: 30000,
    },
  },

  // \u2500\u2500\u2500 web : heavy, parallel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // web is the main consumer-facing test target. The project inherits
  // /opt/bing/web/vitest.config.ts (vite aliases, INTEGRATION_TEST_PATTERNS,
  // UNIMPLEMENTED_MODULE_TEST_PATTERNS, testTimeout, env, exclude list) and
  // overrides include + poolOptions. Extending keeps web's config file
  // authoritative for its OWN test conventions \u2014 the workspace project only
  // orients WHICH paths run + pool sizing.
  {
    name: 'web',
    // extends path is RELATIVE TO project root (./web = /opt/bing/web),
    // so '../web/vitest.config.ts' resolves to /opt/bing/web/vitest.config.ts.
    // Using the upward-relative form makes resolution stable across vitest
    // versions where extends may resolve from project-root vs workspace-cwd.
    extends: '../web/vitest.config.ts',
    root: './web',
    test: {
      // Override include to drop the brittle global `__tests__/**` glob and
      // instead pin explicit top-level directories. web's wide exclude list
      // (INTEGRATION_TEST_PATTERNS, UNIMPLEMENTED_MODULE_TEST_PATTERNS,
      // deprecated, .next, node_modules) is inherited from web/vitest.config.ts.
      include: [
        '__tests__/api/**/*.test.ts',
        '__tests__/tools/**/*.test.ts',
        '__tests__/orchestra/**/*.test.ts',
        '__tests__/mcp/**/*.test.ts',
      ],
      pool: 'forks',
      poolOptions: {
        forks: {
          // Up to 4 parallel forks for web's heavy test volume.
          // web's poolOverrides override the inherited `'forks'` setting.
          maxForks: 4,
        },
      },
    },
  },
]);
