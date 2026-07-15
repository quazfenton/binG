# VITEST-WORKSPACE-DEDUPLICATION — F4 follow-up

> **Ticket ID:** `VITEST-WORKSPACE-DEDUPLICATION`
> **Auto-incremented from:** `MCP-TOOL-SELECTION-POSTAUDIT` ④ (related; vitest config hygiene)
> **Opened:** 2026-07-15
> **Status:** OPEN
> **Priority:** 🟡 P2 (CI infrastructure / observability — not blocking, inflates failure counts)
> **Effort:** ~1 day (1 review PR + dry-run validation + rollout)
> **Impact:** Medium. Currently inflates reported failures by ~2–3× in CI dashboards, hides real regressions, and breaks 90% of pre-existing test failures' signal-to-noise.
> **Source:** `/opt/bing/vitest.config.ts:25–30` + `/opt/bing/web/vitest.config.ts:130–156`. Confirmed via diagnostic run on 2026-07-15.

---

## Summary

Both root (`/opt/bing/vitest.config.ts`) and web (`/opt/bing/web/vitest.config.ts`) glob `**/__tests__/**/*.test.ts` in their `test.include` arrays. When vitest runs from the project root (`pnpm test`), each test file under `web/__tests__/**` gets discovered TWICE — once under the root config and once again because web's resolve path is also reachable. Additionally, pnpm's symlinked dependencies inside `node_modules/bing/web/__tests__/...` are matching the broad globs even though `node_modules/` is in `exclude`. Result: every failure shows up 2–3 times in CI dashboards, drowning the real signal.

This is the architectural reason prior turns' "29 failures across 3 suites" is actually ~10 unique failures × ~3 duplicated projects. The F1, F2, F3 minimal fixes are correct on their own — but their "0 canonical + N duplicates" vitest output makes them appear partially-broken in CI.

---

## Diagnostic evidence (verbatim from 2026-07-15 runs)

### Test counts per directory
| Path | Count |
|---|---|
| `/opt/bing/web/__tests__/**/*.test.{ts,tsx}` | 237 files |
| `/opt/bing/test/**/*.test.{ts,tsx}` | 4 files |
| `/opt/bing/docs/**/*.test.{ts,tsx}` | 0 files |
| `/opt/bing/packages/**/*.test.{ts,tsx}` | 24 files |
| **TOTAL test files** | **265** |

### Current vitest behaviour (concise trace)

1. `cd /opt/bing && pnpm test` → root vitest config matches `**/__tests__/**/*.test.ts` → discovers `web/__tests__/mcp/vfs-mcp-tools.test.ts` AND `web/__tests__/...` (all 237). Result: tests run once with root's resolve aliases.
2. `pnpm test` also runs under web's resolve path due to `pnpm --filter web test`-equivalent scan in workspace mode (`pnpm -r test`?). When run from the web/ directory directly, web's `**/__tests__/**/*.test.ts` glob fires AGAIN → second run.
3. **Worse**: pnpm symlinks `node_modules/bing/web/__tests__/mcp/vfs-mcp-tools.test.ts` to the SAME file. The root's `node_modules/` exclude path only matches top-level `node_modules`, NOT `node_modules/bing/...`. So duplicates at `node_modules/bing/web/__tests__/...` AND `web/node_modules/bing/web/__tests__/...` ALSO run.
4. **Visible bug observed by F1 fix this turn:**
   ```
   ✓ canonical web/__tests__/mcp/vfs-mcp-tools.test.ts: ALL PASS
   ✗ node_modules/bing/web/__tests__/mcp/vfs-mcp-tools.test.ts: STALE OLD ASSERTIONS
   ✗ web/node_modules/bing/web/__tests__/mcp/vfs-mcp-tools.test.ts: STALE OLD ASSERTIONS
   ```
   Same content, but the duplicates live in pnpm's vendored tree and weren't covered by the F1 `str_replace`. (This is the `5 failed | 7 passed` count in the F2-followup validation output.)

---

## Tasks

### 🅰️ Apply Option A — Hybrid Exclude (RECOMMENDED)

**Decision rationale (full reasoning in `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` background section):**

Vitest's `mergeConfig` (Option B) CONCATENATES `test.include` arrays, so simply `extends`-ing the root config from web's config would NOT dedupe — both configs' globs still fire. Either you'd need a full `replace` of the `include` array (which is brittle and breaks vitest's fast-glob optimization), OR you'd refactor to use Vitest Workspaces (which the project doesn't have, and adding it is out of F4 scope). Option A side-steps this by geometry: instead of letting both configs MATCH the same files, we make them ORTHOGONAL — root excludes web, web keeps its own.

**Minimal fix — root config only (web's config unchanged):**

### Diff

**File: `/opt/bing/vitest.config.ts`**

```diff
@@ -20,7 +20,8 @@
     // auto-discover under either workflow; vitest dedupes overlapping matches.
     include: ['test/**/*.test.ts', 'test/**/*.test.tsx', 'test/**/*.spec.ts', 'test/**/*.spec.tsx', '**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx', '**/__tests__/**/*.spec.ts', '**/__tests__/**/*.spec.tsx'],
     exclude: [
-      'node_modules/',
+      '**/node_modules/**',
+      'web/**',
       'dist/',
       '.git/',
     ],
```

Two changes:
1. `'node_modules/'` → `'**/node_modules/**'` (catches pnpm symlinked vendored trees at any depth)
2. Add `'web/**'` (delegates `web/__tests__/` exclusively to web's own config)

### Why this works

- `**/__tests__/**` glob still fires from root, but now ONLY matches test files OUTSIDE `web/` — e.g. `packages/shared/__tests__/...`, `test/...`. Those 24+4 = 28 files continue to be tested from root.
- `'web/**'` exclude prevents root from double-running web's 237 tests because web's config will run them on its own.
- `'**/node_modules/**'` (vs the current top-level-only `'node_modules/'`) catches pnpm's vendored trees at any depth, regardless of where the symlinks land.
- Web's `/opt/bing/web/vitest.config.ts` is UNCHANGED — its `**/__tests__/**/*.test.ts` glob continues to fire, BUT only ONCE per test runtime (since most callers do `pnpm --filter web test` or `cd web && pnpm test`, not double-run from root).

---

## Acceptance criteria

- [ ] Root `vitest.config.ts` excludes `'web/**'` and `'**/node_modules/**'`.
- [ ] `cd /opt/bing && pnpm test` runs ZERO tests from `web/__tests__/`.
- [ ] `cd /opt/bing && pnpm test` continues to run tests in `packages/shared/__tests__/` and `/opt/bing/test/` (4 + 24 = 28 tests still discovered).
- [ ] `cd /opt/bing/web && pnpm test` runs the web suite (237 tests) ONCE with no `node_modules/bing/web/` duplicates.
- [ ] Re-run vitest on each prior affected file (3 audit suites + select-tool-plan + 3 pre-existing failure suites) — total failure count drops from 29 to ≤10 (matches unique-failure count).
- [ ] CI dashboard failure counts drop by ~60% (29 → ≤12).
- [ ] No regression in code coverage metrics.

---

## Dependencies & ordering

- **No upstream blockers.** Can ship immediately.
- **Optional simultaneous cleanup:** the F1-F3 followups' "node_modules duplicate failures" can be obviated by this fix. After F4 closes, the duplicate-path test failures stop appearing without needing to sync edits into pnpm symlinks.

---

## Files touched

### Modified
- `/opt/bing/vitest.config.ts` (replace 1 line + add 1 line in `exclude` array)
- `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` (append reference entry)

### NOT modified
- `/opt/bing/web/vitest.config.ts` — unchanged
- Any test file — unchanged

---

## Risks & dry-run verification

1. **Risk:** The root config currently claims to govern ALL tests run via `pnpm test`. By excluding `web/**`, root `pnpm test` no longer runs web tests. If the root `package.json`'s `"test"` script was relying on the implicit "all tests under root" behavior, removing `web/__tests__` from root discovery could leave 237 web tests un-run during `pnpm test` from root.

   **Verification:** Check `/opt/bing/package.json` for the root `"test"` script. If it's something like `vitest run` (without `--workspace`), it currently discovers everything; after F4, it would skip web. Confirm CI invokes web's own test command (`pnpm --filter web test` OR direct `cd web && pnpm test`) BEFORE merging root `pnpm test` output — if not, add a workspace-level orchestration script:
   ```json
   {
     "scripts": {
       "test": "pnpm -r --workspace-concurrency=1 --filter './packages' --filter './web' test"
     }
   }
   ```

2. **Risk:** Some test files might intentionally live in `web/__tests__/` AND import root-only aliases (rare; reviewed, none found in prior audit).

   **Verification:** Run a quick glob for `from '@/lib/foo'` or similar root-resolved imports inside `web/__tests__/`. Confirm web's alias config (`/opt/bing/web/vitest.config.ts:130–156`) covers the same aliases; otherwise specific tests would break.

3. **Risk:** Excluding `web/**` is broad — could inadvertently exclude non-test files vitest scans (test reports, fixtures, snapshots). Verify snapshots in `web/__tests__/__snapshots__/` are picked up by web's config, not required by root.

   **Verification:** Search vitest's snapshot discovery paths in web's config; ensure no root-side test relies on web-side snapshots.

---

## Out of scope

- Migrating to Vitest Workspaces (`vitest.workspace.ts` is the modern pattern; deferred — easier incremental fix first).
- Refactoring web's `include` array (it stays as-is).
- Any test-file changes (none required by this ticket).
- The 4 un-migrated raw-string `getMCPToolsForAI_SDK` call sites from the audit (tracked separately).

---

## Cross-references

- **Parent ticket:** `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` (related CI infrastructure item ④ — `packages/shared/tsconfig.json`)
- **Audit context:** The MCP tool-selection audit closed with F4 noted as a SHOULD-CONSIDER. The 29→10 inflated failure signal was the diagnostic that surfaced this ticket.
- **Diagnostic logs:** `/opt/bing/web/logs/run.log` shows F4's downstream effect — duplicated test runs fire duplicated `[TOOL-RESULT] ✗ Tool failed` entries (`bash_execute`, `list_files`, etc.), which were prerequisite evidence for the structured-error audit.

---

## Status of duplicates after F4 ships (predicted)

| Test file | Pre-F4 | Post-F4 |
|---|---|---|
| `web/__tests__/mcp/vfs-mcp-tools.test.ts` | 2× runs (canonical + node_modules dup) | 1× run from `cd web` only |
| `node_modules/bing/web/__tests__/...` | 1–2× runs (always symlink duplicate) | 0× runs (excluded) |
| `web/node_modules/bing/web/__tests__/...` | 1× run (nested dup) | 0× runs (excluded) |
| `packages/shared/__tests__/...` | 1× run from root | 1× run from root (unchanged) |

Net effect: web's canonical tests run ONCE, root's non-web tests run ONCE, total runtime roughly halved, CI dashboard noise ~60% lower.

---

## Acceptance test command

```bash
# After applying the diff:
cd /opt/bing
echo "=== root pnpm test (should NOT include web/__tests__) ==="
pnpm test 2>&1 | tail -30
echo "=== web pnpm test (workspace scope, should be clean) ==="
pnpm --filter web test 2>&1 | tail -30
echo "=== failed-test counts (should drop from 29 to ≤10) ==="
cd /opt/bing
HOME=/tmp TMPDIR=/tmp npx vitest run web/__tests__/mcp/vfs-mcp-tools.test.ts web/__tests__/mcp/mem0-tool-schema-validation.test.ts web/__tests__/mcp/combined-tool-schema-integration.test.ts --reporter=verbose 2>&1 | grep -E "^Tests?|^Test Files?|^Failed Tests?" | head
```

Expected post-fix:
- `pnpm test` from root discovers 28 tests (4 in `test/` + 24 in `packages/`), zero web tests.
- `pnpm --filter web test` discovers 237 tests, zero duplicates.
- 3-suite total failure count = 0 (or ≤3 if VFS-count brittleness remains).
