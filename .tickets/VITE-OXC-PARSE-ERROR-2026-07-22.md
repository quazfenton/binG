# Vite:oxc PARSE_ERROR at vercel-ai-streaming.ts:L4179

**Stable anchor:** `#vite-oxc-parse-error-2026-07-22`
**Opened:** 2026-07-22
**Status:** 🔴 OPEN

## Summary

A pre-existing `vite:oxc` parser quirk trips a `PARSE_ERROR: Unterminated string` at
`/opt/bing/web/lib/chat/vercel-ai-streaming.ts` line 4179, column 2, when vitest
transforms the file during test loading. `node --check` and `tsc --noEmit` BOTH pass
on the same source — the issue is parser-specific to vite:oxc (used by `vitest@4.x`).

**Confirmed pre-existing** via `git stash` + parse-baseline test:
- HEAD (un-edited, 4181 lines): `node --check` ✔ + vite:oxc ❌ (same error)
- After my Bug 2 wire-up edits (4210 lines): `node --check` ✔ + vite:oxc ❌ (same error)

The parse error blocks ANY vitest test that transitively imports
`streamWithVercelAI` — including the new Bug 2 wire-up integration test at
`__tests__/chat/vercel-ai-streaming-reaper-integration.test.ts` (gated by env
`REAPER_WIRE_TEST_GATE`, see the inline docblock for details).

## Repro commands (cite verbatim)

```bash
cd /opt/bing/web
# 1. The error fires from vitest itself:
npx vitest run __tests__/chat/vercel-ai-streaming-reaper-integration.test.ts

# Expected:
#   [PARSE_ERROR] Unterminated string
#         ╭─[ lib/chat/vercel-ai-streaming.ts:4179:2 ]
#   4179 │ }
#         │  ┬
#         │  ╰──

# 2. But Node + tsc both pass:
node --check /opt/bing/web/lib/chat/vercel-ai-streaming.ts   # exits 0
npx tsc --noEmit -p tsconfig.json 2>&1 | grep vercel-ai      # 0 errors at the file
```

## Hypothesis (regression-vector-isolated)

`vite:oxc` (oxc-parser underneath) tracks brace/quote depth differently than `tsc`.
A specific token pattern somewhere before L4179 likely confuses oxc's bracket-balance
heuristic. Diagnostic priorities (in order of likelihood):

1. **Template-literal escape sequence**: a `\${` pattern inside a nested template
   literal (the file has heavy template literal usage around the `[TIMEOUT]`
   operator log shaping at L2071 → surrounding block L2070-L2090).
2. **String continuation across a comment block**: a `\` JSDoc comment near
   the end of `streamWithVercelAI` may be misinterpreted by oxc as a string
   continuation.
3. **`// fallthrough` after JSDoc comment**: a 1-line `// \`\`\`` near L4170
   that oxc might track as opening a template literal.

## Mitigation

The new Bug 2 wire-up integration test is gated by the env var
`REAPER_WIRE_TEST_GATE`:

```bash
# Default (test SKIPS, vitest doesn't trip on vercel-ai-streaming.ts):
npx vitest run __tests__/chat/vercel-ai-streaming-reaper-integration.test.ts

# After this ticket is fixed (test RUNS):
REAPER_WIRE_TEST_GATE=on npx vitest run __tests__/chat/vercel-ai-streaming-reaper-integration.test.ts
```

The SKIPPED branch uses `describe.skip` + `it.skip` with no static imports of
`@/lib/chat/vercel-ai-streaming`, so vitest's static-analysis-driven transform
doesn't pre-load the file when the gate is OFF.

## Resolution actions (TBD)

1. Identify the exact byte position + token that triggers oxc's bracket-balance drift.
2. Try the 3 candidate fixes (escape `\${`, replace JSDoc, drop stray backtick).
3. Verify `npx vitest run __tests__/chat/vercel-ai-streaming-reaper-integration.test.ts`
   passes 5/5 with the gate removed (then flip the gate default to ON).
4. Update CENTRALIZED_TODO_LIST cross-reference at the `BUG2-ZOMBIE-STREAM-REAPER`
   closure entry to mark this ticket as RESOLVED.

## Related

- `/opt/bing/.tickets/BUG2-ZOMBIE-STREAM-REAPER.md` (CLOSED — wire-up landed)
- `/opt/bing/__tests__/chat/vercel-ai-streaming-reaper-integration.test.ts` (gated test)
- `/opt/bing/web/lib/chat/vercel-ai-streaming.ts` (the problem file, 4210 lines)
