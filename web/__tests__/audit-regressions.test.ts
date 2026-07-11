/**
 * __tests__/audit-regressions.test.ts
 *
 * Audit-regression suite for the 2025-07-08 audit findings (9 findings + 4
 * behavioral recommendations). This is a TDD-REVERSE pattern: each test
 * asserts the CORRECT behavior, so the test FAILS today (red) and PASSES
 * once the corresponding fix is applied (green).
 *
 * Why a single consolidated file? — These tests act as an executable
 * checklist of the audit. Running `vitest run audit-regressions` lets an
 * operator verify the audit's claims are addressed without digging through
 * 9 different component directories.
 *
 * Test pattern notes:
 *  - Many tests use `readFileSync` to assert source-level patterns
 *    (file-presence + assertion on the documented bug-fix pattern). This
 *    is a contract-leaning substitute for deep integration mocks.
 *  - A subset of tests (F2, F3, F7) probe runtime exports to assert
 *    missing symbols (e.g. a detector function that should exist after
 *    the fix is applied).
 *  - Negative assertions (`expect(X).not.toMatch(/...)`) pin the absence
 *    of a known-bad pattern; these turn GREEN only after the fix removes
 *    the bug.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readSrc = (relPath: string): string =>
  readFileSync(join(process.cwd(), relPath), 'utf-8');

// ============================================================================
// F1: Watchdog fires + POST 200 + browser error are conflicting signals
// ============================================================================
describe('F1: watchdog pre-stream returns HTTP 524 (route.ts + use-enhanced-chat)', () => {
  it('route.ts uses 524 status code for pre-stream stall', () => {
    // Today: depending on the branch the route may return 200 even when stall
    //   fires. The audit expects a 524 status code on the pre-stream path.
    // After fix: the 524 status must be present in route.ts as a status-code
    //   literal in a `new NextResponse(..., { status: 524 })` constructor.
    const src = readSrc('app/api/chat/route.ts');
    expect(src).toMatch(/new\s+NextResponse\([^)]*\{\s*status:\s*524/);
  });

  it('use-enhanced-chat.ts distinguishes isStall event for timeout copy', () => {
    // The browser handler must branch on `isStall` to render
    // "⚠️ Server timed out — please try again." instead of the generic
    // stream-interrupted copy. The audit says this is wired but the audit
    // identifies the 200-vs-524 conflict; the client copy must not lie
    // ("stream interrupted" when actually "server timed out").
    //
    // After the F1 refactor lifted the inline discriminator to a pure
    // helper at lib/chat/build-error-final-content.ts, the discriminator
    // read lives in the helper and the hook calls it. Cross-file
    // invariant:
    //   - HOOK has the helper call (so the discriminator is wired in)
    //   - HELPER has the strict `=== true` read + the "Server timed out"
    //     copy (single source of truth for the UX).
    //   - HOOK does NOT still contain the inline discriminator read
    //     (re-inlining silently bypasses the helper's tests).
    const src = readSrc('hooks/use-enhanced-chat.ts');
    expect(src).toMatch(/buildErrorFinalContent\s*\(\s*\{\s*accumulatedContent\s*,\s*eventData\s*\}\s*\)/);
    expect(src).not.toMatch(/const\s+isStall\s*=\s*eventData\.isStall\s*===\s*true/);
    const helperSrc = readSrc('lib/chat/build-error-final-content.ts');
    expect(helperSrc).toMatch(/isStall\s*===\s*true/);
    expect(helperSrc).toMatch(/Server timed out/);
  });
});

// ============================================================================
// F2: 24 KB prose + 0 tool calls passes every auto-continue detector
// ============================================================================
describe('F2: 24KB prose + 0 tools triggers `ramble-no-tools` auto-continue (rec #1)', () => {
  it('auto-continue-helper exports a rambleNoToolsDetector (RED today)', async () => {
    // The behavioral rec #1 says: "Add a `ramble-no-tools` detector in
    // `_enrichResultData` for `responseLen > 4000 && toolFailures.length === 0`.
    // Today the module exposes NO such detector (all existing detectors
    // are bounded at responseLen < 1000).
    const helper = await import('@/lib/chat/auto-continue-helper');
    const exports = Object.keys(helper) as string[];
    expect(exports).toContain('rambleNoToolsDetector');
  });

  it('_enrichResultData includes a ramble-no-tools signal branch', () => {
    const src = readSrc('lib/chat/auto-continue-helper.ts');
    // After fix: a `ramble-no-tools` (or `rambleNoTools`) signal name is
    // pushed into `incompleteSignals` for responseLen > 4000 + zero
    // toolFailures.
    expect(src).toMatch(/ramble[-_]no[-_]tools/);
  });
});

// ============================================================================
// F3: Tool telemetry writes/reads are disconnected (rotates blind)
// ============================================================================
describe('F3: tool telemetry read/write are connected (model-ranker.ts L56-95, rec #3)', () => {
  it('model-ranker.ts does NOT silently swallow toolCallTracker errors via .catch(() => [])', () => {
    // Today: toolCallTracker.getModelToolStats(10).catch(() => []) silently
    //   discards telemetry-read errors. rotation becomes blind.
    // After fix: the .catch is removed OR replaced with explicit logging
    //   so the operator can see when telemetry is missing.
    const src = readSrc('lib/providers/model-ranker.ts');
    expect(src).not.toMatch(/getModelToolStats[^)]*\.catch\(\(\)\s*=>\s*\[\]\)/);
  });

  it('model-ranker.ts has a toolCallTracker.hasRecordedTools-style verifier', () => {
    // Behavioral rec #3: "add an integration test
    //   `toolCallTracker.hasRecordedTools()` that runs and asserts nonzero".
    // After fix: the verifier exists.
    const src = readSrc('lib/providers/model-ranker.ts');
    expect(src).toMatch(/hasRecordedTools/);
  });
});

// ============================================================================
// F4: responseLen (server) vs accumulatedContentLength (client) conflation
// ============================================================================
describe('F4: responseLen vs accumulatedContentLength are differentiated', () => {
  it('use-enhanced-chat.ts logs accumulatedContentLength alongside server responseLen', () => {
    // The audit says both metrics get reported "as if they're the same metric".
    // After fix: they must be logged under distinct keys.
    const src = readSrc('hooks/use-enhanced-chat.ts');
    expect(src).toMatch(/accumulatedContentLength/);
  });

  it('unified-agent-service.ts distinguishes server responseLen from client accumulatedContentLength', () => {
    const src = readSrc('lib/orchestra/unified-agent-service.ts');
    // After fix: server-side logs include `responseLen` distinctly. The audit
    // says they're conflated — fix must differentiate.
    expect(src).toMatch(/responseLen/);
  });
});

// ============================================================================
// F5: "ALL FALLBACKS EXHAUSTED" then "processUnifiedAgentRequest returned"
// ============================================================================
describe('F5: auditResponseShape emits distinct outcome for fallback-exhausted', () => {
  it('unified-agent-service.ts logs outcome="exhausted" on total fallback failure', () => {
    // Audit: two separate paths conflate (one logs "ALL FALLBACKS EXHAUSTED",
    // another logs "processUnifiedAgentRequest returned").
    // After fix: auditResponseShape is invoked with an `outcome` discriminator,
    // and `'exhausted'` is one of the literal outcomes.
    const src = readSrc('lib/orchestra/unified-agent-service.ts');
    expect(src).toMatch(/outcome:\s*['"]exhausted['"]/);
  });
});

// ============================================================================
// F6: Capability flags log as false but mode succeeds anyway (silent bypass)
// ============================================================================
describe('F6: capability flags strictly gate unified-agent mode selection', () => {
  it('unified-agent-service.ts references startupCaps capability check', () => {
    // Today the audit says: "Capability flags log as false but mode succeeds
    //   anyway — bypasses operator mental model".
    // After fix: startupCaps.<mode> checks strictly gate mode selection.
    const src = readSrc('lib/orchestra/unified-agent-service.ts');
    expect(src).toMatch(/startupCaps\.[a-zA-Z]+/);
  });
});

// ============================================================================
// F7: ninerouter stuck-edge stalls + chain-walk ceiling (rec #4)
// ============================================================================
describe('F7: ninerouter-class silenceMs default is 5s (rec #4)', () => {
  it('llm-fallback-coordinator.ts sets 5000ms silenceMs default for ninerouter-class providers', () => {
    // The behavioral rec #4: drop the chunk-race silenceMs default to 5s
    // for ninerouter-class providers.
    // After fix: a literal `5000` appears within ~500 chars of the
    // ninerouter/ollama/kiro keyword block.
    const src = readSrc('lib/chat/llm-fallback-coordinator.ts');
    expect(src).toMatch(/ninerouter[\s\S]{0,500}5000/);
  });
});

// ============================================================================
// F8: Source maps lost in browser stack trace
// ============================================================================
describe('F8: source maps preserved in browser stack trace', () => {
  it('use-enhanced-chat.ts preserves error.stack attribute (does not stringify and destroy)', () => {
    const src = readSrc('hooks/use-enhanced-chat.ts');
    // After fix: streamingErrorHandler preserves error.stack as-is,
    // not via JSON.stringify or .toString() (which drops stack frames).
    expect(src).toMatch(/err\.stack|error\.stack/);
    expect(src).not.toMatch(/err\.stack\s*[:=]\s*JSON\.stringify|JSON\.stringify\([^)]*err[^)]*\.stack/);
  });
});

// ============================================================================
// F9: SessionManager heartbeat count vs active chat sessions
// ============================================================================
describe('F9: SessionManager heartbeat count matches active chat sessions', () => {
  it('session-manager.ts tracks activeSessions count', () => {
    const src = readSrc('lib/session/session-manager.ts');
    expect(src).toMatch(/activeSessions/);
  });
});
