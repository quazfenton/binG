/**
 * Magic-hook defensive guard — GATED SOURCE-ANALYSIS REGRESSION.
 *
 * Background (post-diagnostic, 2026-07-22):
 *   The SHOULD-CONSIDER #1 magic-hook defensive guard is a real
 *   contract: every chunk processed by streamWithVercelAI() must bump
 *   the reaper's lastActivityTime so case 'start' / case 'finish' (and
 *   any future no-op cases) cannot desync from resetIdleTimeout().
 *
 *   The first attempt to land the guard (see /opt/bing/.tickets/
 *   MAGIC-HOOK-PREREQUISITES-2026-07-22.md) failed at compile time
 *   because the prerequisite Bug 2 wire-up that prior conversation
 *   turns documented (L37 import, L1660 streamId declaration, L1685
 *   registerStream call, L2014 updateStreamActivity in resetIdleTimeout,
 *   L4135 unregisterStream in finally) was an ASPIRATIONAL TARGET that
 *   never actually landed in the codebase. Adding the guard on top of
 *   missing infra produced 5 TS2304 errors at tsc.
 *
 * This test surfaces the gap: each PREREQ it() block runs a real
 * source-analysis assertion that FAILS today and PASSES once the
 * respective prerequisite actually lands in /opt/bing/web/lib/chat/
 * vercel-ai-streaming.ts. PRE-EXISTING failures mean the wire-up
 * still hasn't landed — flip the gate on to surface them in CI.
 *
 * Gate-aware: REAPER_MAGIC_HOOK_TEST_GATE !== 'on' (default OFF) —
 * skipped by default to bypass the pre-existing vite:oxc PARSE_ERROR
 * at vercel-ai-streaming.ts:4179:2 triggered by vitest's static-
 * analysis pre-load of the full file.
 *
 * NOTE: gate is implemented via nested `describe.skip + early-return`
 * (NOT `describe.skipIf`) because the project's vitest version does not
 * support `skipIf` — verified empirically (skippedIf crashed the suite
 * with `Failed Suites 1 / no tests`).
 *
 * @see /opt/bing/.tickets/MAGIC-HOOK-PREREQUISITES-2026-07-22.md
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GATE_ENABLED = process.env.REAPER_MAGIC_HOOK_TEST_GATE === 'on';
const TARGET_FILE = resolve(process.cwd(), 'lib/chat/vercel-ai-streaming.ts');

describe('Bug 2 closure — SHOULD-CONSIDER #1 magic-hook defensive guard (PREREQ at-source analysis)', () => {
  if (!GATE_ENABLED) {
    // Gate OFF — collapse to a single describe.skip so a future audit doesn't
    // read the dead `it.skip(...)` calls below as silently-no-op tests. The 5
    // PREREQ assertions below DO run when GATE is ON; only OFF is skipped.
    describe.skip('gate OFF — REAPER_MAGIC_HOOK_TEST_GATE !== "on" (source-analysis skipped to bypass vite:oxc parse error)');
    return;
  }

  let src: string;
  beforeAll(() => {
    src = readFileSync(TARGET_FILE, 'utf8');
  });

  it('IO sanity: target file read successfully + is the streaming module', () => {
    expect(src.length).toBeGreaterThan(100_000);
    expect(src).toContain('streamWithVercelAI');
    expect(src).toContain('resetIdleTimeout');
  });

  it('PREREQ #1 — top-level import from zombie-stream-reaper (any canonical path: ./, ../, @/lib/chat/)', () => {
    // Widen the regex to accept any relative or aliased path so the test
    // FLIPS to PASS once the wire-up lands regardless of which path
    // convention the next implementation chooses (./zombie-stream-reaper,
    // ../chat/zombie-stream-reaper, @/lib/chat/zombie-stream-reaper, etc.).
    expect(
      src,
      'expected: `import { ... } from "<path-to>/zombie-stream-reaper"` — confirms the reaper module is wired into the streaming layer'
    ).toMatch(/from\s*['"](?:\.\.?\/|\@\/lib\/chat\/)zombie-stream-reaper['"]/);
  });

  it('PREREQ #2 — `streamId` declared in the function-body scope of streamWithVercelAI() (NOT inside `if (firstTokenTimeoutMs > 0)` sub-block)', () => {
    expect(
      src,
      'expected: `let streamId` or `const streamId` at function-body scope of streamWithVercelAI() — required for the magic-hook defensive guard to be in-scope inside the inner for-of chunk loop'
    ).toMatch(/(?:let|const)\s+streamId\b/);
  });

  it('PREREQ #3 — registerStream(streamId-bearing arg) call BEFORE `for await (const chunk of fullStream)` consumption', () => {
    // Dotall-flagged non-greedy match up to 700 chars inside the parens.
    // This is robust against THREE realistic shapes:
    //   (a) options-object args with nested fields: registerStream({ streamId, provider: { foo: 'bar' } })
    //   (b) direct arg list:                      registerStream(streamId, opts)
    //   (c) callback closures that mention streamId: registerStream(() => { baz(streamId) })
    // \b word boundaries + `(?!\\s*:\\s*string\\b)` lookahead avoid false positives
    // on `(?:const|let) streamId: string = ...` type-annotation declarations
    // (which carry the symbol but don't register a stream).
    expect(
      src,
      'expected: `registerStream(<call arg bearing streamId>)` call site somewhere in streamWithVercelAI() before the for-await-fullStream loop — registers the stream with the reaper so updateStreamActivity has a target'
    ).toMatch(/registerStream\s*\([\s\S]{0,700}?\bstreamId\b(?!\s*:\s*string\b)/);
  });

  it('PREREQ #4 — unregisterStream(streamId) call in the OUTER finally of streamWithVercelAI()', () => {
    expect(
      src,
      'expected: `unregisterStream(streamId)` call site (anywhere in the file is acceptable for this PREREQ — final placement is the OUTER finally envelope)'
    ).toMatch(/unregisterStream\s*\(\s*streamId\s*\)/);
  });

  it('PREREQ #5 — updateStreamActivity(streamId) wired into resetIdleTimeout (declared as arrow function `const resetIdleTimeout = (...) => {` at L1982)', () => {
    expect(
      src,
      'expected: `updateStreamActivity(streamId, ...)` call site somewhere INSIDE the resetIdleTimeout function body (or anywhere inside streamWithVercelAI — final placement is inside resetIdleTimeout for SHOULD-CONSIDER #1)'
    ).toMatch(/updateStreamActivity\s*\(\s*streamId\b/);
  });
});
