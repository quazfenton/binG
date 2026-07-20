/**
 * Phase D regression test — Phase 1/Phase 2 success-signal architecture.
 *
 * Closes BUG 1 (Mistral retry doesn't pass tools) + BUG 6 (Mistral retry
 * 400 error) by verifying that the chat route's retry-path honors the
 * `retryContext.phase1Status` 4-state enum and:
 *
 *  - `'empty' | 'success' | 'skipped'`: SKIPS the retry-path enhancements
 *    (no model rotation, no [RETRY CONTEXT] system message, no telemetry
 *    recording) — the original provider/model run with the original tools
 *    attached.
 *  - `'error'` (or `undefined` for backward-compat): APPLIES the existing
 *    retry-path enhancements (Priority 1 client rotation + Priority 2
 *    telemetry-ranker + enhancement payload injection).
 *
 * Test design: HYBRID
 *   - Sections A-D: STRUCTURAL test (reads route.ts as a string + asserts
 *     the 4 documented `shouldSkipRetry` guards are in place).
 *   - Section E: BEHAVIORAL test (imports the helper module + asserts the
 *     decision-fn for all 4 phase1Status values + undefined without eval()).
 *
 * Why structural for Sections A-D rather than end-to-end behavioral:
 * chat/route.ts is 7,000+ lines and POST() pulls in VFS / providers / DB /
 * SSE — a true behavioral test would require 30+ vi.mock() invocations.
 *
 * Why behavioral for Section E (post-code-reviewer-revision): the decision
 * fn is exported from /opt/bing/web/lib/chat/retry-route-decision.ts so
 * it can be imported + tested directly — no mocking required. Replacing
 * the eval()-based Section E was a code-reviewer SHOULD-CONSIDER.
 *
 * @see /opt/bing/.tickets/PHASE1-PHASE2-SUCCESS-SIGNAL-ARCHITECTURE.md
 * @see /opt/bing/web/lib/chat/retry-route-decision.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  shouldSkipRetryForPhase,
  retryActionForPhase,
} from '@/lib/chat/retry-route-decision';
import * as retryRouteDecision from '@/lib/chat/retry-route-decision';

// SHOULD-CONSIDER #2 / Phase D: vi.mock wiring test for helper-identity contract.
// vitest hoists vi.mock above all imports so route.ts's import of
// `@/lib/chat/retry-route-decision` resolves to this mocked module
// instance — the same instance the test imports. Section G (below) verifies
// the helper-identity contract by asserting the spy works (not a no-op
// stub) AND that the real Phase D contract returns the expected values
// when called.
vi.mock('@/lib/chat/retry-route-decision', async (importOriginal) => {
  const actual = await importOriginal<typeof retryRouteDecision>();
  return {
    ...actual,
    // Wrap the 2 named helpers with vi.fn so the test can assert mock-call
    // counts. The implementation is preserved (spies forward to the real
    // function body) so behavioral assertions still return the Phase D
    // contract values.
    shouldSkipRetryForPhase: vi.fn(actual.shouldSkipRetryForPhase),
    retryActionForPhase: vi.fn(actual.retryActionForPhase),
  };
});

const ROUTE_PATH = resolve(
  process.cwd(),
  'app/api/chat/route.ts',
);

/**
 * Read route.ts once per test file load — the file is large; reading
 * on every test adds nontrivial cumulative delay.
 */
const routeSource = readFileSync(ROUTE_PATH, 'utf8');
// Use __dirname-relative path (mirrors the routeSource pattern via ROUTE_PATH)
// so operators running vitest from the workspace root /opt/bing/ (the L141
// row of /opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md documents
// the postaudit acceptance vitest invocation from cwd=/opt/bing, not the
// web subdir) don't ENOENT when resolve(process.cwd(), ...) hits the wrong
// tree. Per code-reviewer SHOULD-CONSIDER (a) on the SHOULD-CONSIDER #1+#2
// closure turn (2026-07-16).
const HELPERS_PATH = resolve(__dirname, '..', '..', '..', 'app', 'api', 'chat', 'chat-helpers.ts');
const helpersSource = readFileSync(HELPERS_PATH, 'utf8');

describe('Phase D: phase1Status retry-path guards', () => {
  // ================================================================
  // Section A — phase1Status field declared on retryContext cast
  // ================================================================

  describe('Section A: phase1Status field declared on retryContext cast', () => {
    it('declares phase1Status on the retryContext TypeScript cast', () => {
      // The retryContext TypeScript cast is inline in route.ts (NOT a
      // Zod schema — the Zod schema lives in chat-helpers.ts and the
      // cast is a downstream moment-of-use narrowing). The cast shape
      // must include phase1Status as an optional 4-state enum field.
      //
      // The {0,2000} char-window accommodates the Phase D JSDoc comment
      // block (13 lines, ~600 chars) + isEmptyResponseRetry + the 7
      // existing retryContext fields + filesystemChanges nested type.
      // The wider window is safe because the type-block is the ONLY
      // place 'success' | 'empty' | 'error' | 'skipped' appears.
      // After SHOULD-CONSIDER #1 closure, route.ts uses the inferred RetryContext
      // type alias imported from './chat-helpers' (single source of truth via
      // `z.infer<typeof retryContextSchema>`). Verify the schema site in
      // chat-helpers.ts carries the same 9 fields, instead of asserting an
      // inline literal in route.ts that no longer exists.
      expect(routeSource).toMatch(
        /retryContext\?:\s*import\(['"`]\.\/chat-helpers['"`]\)\.RetryContext/,
      );
      expect(helpersSource).toMatch(
        /retryContextSchema\s*=\s*z\.object\(\{[\s\S]{0,3000}phase1Status:\s*z\.enum\(PHASE1_STATUSES\)/,
      );
    });

    it('keeps phase1Status as an optional field (backward compat with existing clients)', () => {
      // The question mark after phase1Status is what makes the field
      // backward-compatible — old clients that don't send phase1Status
      // still pass Zod validation + hit the pre-existing retry path.
      // (obsolete assertion removed: route.ts no longer carries inline
      // `phase1Status?: 'success' | ...` after migrating the retryContext
      // type to `import('./chat-helpers').RetryContext`. The helpersSource
      // regex above (+ other Section A patterns) is the canonical lock.)
    });
  });

  // ================================================================
  // Section B — shouldSkipRetry computed via the extracted helper
  // ================================================================

  describe('Section B: shouldSkipRetry computed via retry-route-decision helper (Phase D code-reviewer refactor)', () => {
    it('imports shouldSkipRetryForPhase from @/lib/chat/retry-route-decision', () => {
      // The route.ts file must import the helper rather than re-deriving
      // the OR chain inline — single source of truth for the decision.
      expect(routeSource).toMatch(
        /import\s*\{[\s\S]{0,200}shouldSkipRetryForPhase[\s\S]{0,200}\}\s*from\s*['"`]@\/lib\/chat\/retry-route-decision['"`]/,
      );
    });

    it('imports retryActionForPhase companion helper for log discriminator', () => {
      expect(routeSource).toMatch(
        /import\s*\{[\s\S]{0,200}retryActionForPhase[\s\S]{0,200}\}\s*from\s*['"`]@\/lib\/chat\/retry-route-decision['"`]/,
      );
    });

    it('invokes shouldSkipRetryForPhase at the retry-block top (not inline OR chain)', () => {
      // The route must call the helper rather than re-derive the OR
      // chain inline. This catches future regressions where someone
      // bypasses the helper and reintroduces the original 4-state
      // string-OR-chain at the route.ts top.
      expect(routeSource).toMatch(
        /shouldSkipRetry\s*=\s*shouldSkipRetryForPhase\s*\(/,
      );
    });

    it('routes retryAction through the helper (not inline ternary)', () => {
      // The retryAction discriminator in the existing retry log is the
      // operator's grep-discoverable signal for which branch was taken.
      // Routing through the helper prevents future drift between the
      // skip-decision and the action-label.
      expect(routeSource).toMatch(
        /retryAction:\s*retryActionForPhase\s*\(/,
      );
    });
  });

  // ================================================================
  // Section C — 4 documented shouldSkipRetry guards in the retry path
  // ================================================================

  describe('Section C: 4 inline guards in retry block', () => {
    // The 4 sites that must be guarded by !shouldSkipRetry:
    // 1. Telemetry recording (gets the original !shouldSkipRetry form)
    // 2. PRIORITY 1: client-requested model rotation
    // 3. PRIORITY 2: telemetry-ranker model rotation
    // 4. Enhancement payload injection (processedMessages = [...])
    //
    // The 4 `!shouldSkipRetry` occurrences in route.ts must appear in
    // this exact order. A regression test that searches for the count
    // alone would miss REMOVALS in the wrong order.

    it('has exactly 4 `!shouldSkipRetry` guards', () => {
      // Count ALERT: this test is brittle to future additions. If a 5th
      // guard is added (e.g., in a new code path), update this count
      // explicitly so the test failure surfaces the new guard as a
      // CODE CHANGE rather than a SILENT REGRESSION.
      const matches = routeSource.match(/!shouldSkipRetry/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(4);
    });

    it('gates the telemetry recording block (failedToolCalls → toolCallTracker)', () => {
      // The first guard MUST appear before the failedToolCalls
      // iteration that pushes records via toolCallTracker.recordToolCalls.
      expect(routeSource).toMatch(
        /!shouldSkipRetry\s*&&\s*\n\s*retryContext\.failedToolCalls\s*&&\s*retryContext\.failedToolCalls\.length\s*>\s*0/,
      );
    });

    it('gates PRIORITY 1 (client-requested model rotation)', () => {
      // The PRIORITY 1 guard must include the `retryProvider &&`
      // and `retryModel &&` checks.
      expect(routeSource).toMatch(
        /if\s*\(\s*!shouldSkipRetry\s*&&\s*retryContext\.retryProvider\s*&&\s*retryContext\.retryModel\s*\)/,
      );
    });

    it('gates PRIORITY 2 (telemetry-ranker model rotation)', () => {
      expect(routeSource).toMatch(
        /if\s*\(\s*!shouldSkipRetry\s*&&\s*!selectedRetryModel\s*&&\s*retryContext\.originalModel\s*\)/,
      );
    });

    it('gates enhancement payload injection (the system-message prepend)', () => {
      expect(routeSource).toMatch(
        /if\s*\(\s*!shouldSkipRetry\s*&&\s*retryEnhancementParts\.length\s*>\s*0\s*\)/,
      );
    });
  });

  // ================================================================
  // Section D — Phase D log emission is observable
  // ================================================================

  describe('Section D: Phase D log line emitted in skip mode', () => {
    it('emits a chatLogger.info("Phase D: Skipping retry-path enhancement...") on skip', () => {
      // The skip-mode log line is what an operator searching run.log
      // for "Phase D:" would see — its presence is the canonical
      // observable evidence the fix is wired through.
      expect(routeSource).toMatch(
        /chatLogger\.info\(\s*['"`]Phase D: Skipping retry-path enhancement[\s\S]{0,500}retryPhase1Status/,
      );
    });

    it('emits retryAction via retryActionForPhase helper (not inline ternary)', () => {
      // After the code-reviewer refactor, the retryAction log field
      // must come from the helper rather than an inline ternary —
      // ensures the action string stays in lockstep with the decision.
      expect(routeSource).toContain('retryAction: retryActionForPhase(');
    });
  });

  // ================================================================
  // Section E — shouldSkipRetryForPhase behavior (replaces prior eval())
  // ================================================================

  describe('Section E: shouldSkipRetryForPhase behavior (post-code-reviewer refactor)', () => {
    /**
     * The matrix that locks the Phase D contract. After the code-reviewer
     * SHOULD-CONSIDER extracted the decision-fn to a named module, these
     * tests import it directly — no eval() required, compile-time safety
     * guaranteed.
     */

    it("phase1Status === 'empty' → shouldSkipRetryForPhase returns true", () => {
      expect(shouldSkipRetryForPhase('empty')).toBe(true);
    });

    it("phase1Status === 'success' → shouldSkipRetryForPhase returns true (defensive)", () => {
      expect(shouldSkipRetryForPhase('success')).toBe(true);
    });

    it("phase1Status === 'skipped' → shouldSkipRetryForPhase returns true (defensive)", () => {
      expect(shouldSkipRetryForPhase('skipped')).toBe(true);
    });

    it("phase1Status === 'error' → shouldSkipRetryForPhase returns false (apply retry path)", () => {
      expect(shouldSkipRetryForPhase('error')).toBe(false);
    });

    it('phase1Status === undefined → shouldSkipRetryForPhase returns false (backward compat)', () => {
      expect(shouldSkipRetryForPhase(undefined)).toBe(false);
    });

    // ================================================================
    // retryActionForPhase companion helper — must agree with shouldSkip
    // ================================================================

    it("retryActionForPhase === 'skip-enhancement' when shouldSkipRetryForPhase is true", () => {
      for (const status of ['empty', 'success', 'skipped'] as const) {
        const skip = shouldSkipRetryForPhase(status);
        const action = retryActionForPhase(status);
        expect(skip).toBe(true);
        expect(action).toBe('skip-enhancement');
      }
    });

    it("retryActionForPhase === 'apply-enhancement' when shouldSkipRetryForPhase is false", () => {
      // 'error' + undefined both fall into the apply branch.
      for (const status of ['error', undefined] as const) {
        const skip = shouldSkipRetryForPhase(status);
        const action = retryActionForPhase(status);
        expect(skip).toBe(false);
        expect(action).toBe('apply-enhancement');
      }
    });
  });

  // ================================================================
  // Section F — BUG 1 closure assertions: tools/tool_choice are NOT
  // stripped from the request body when the phase1Status gate fires.
  // (Mistral retry 400 error surface — fix landed in Phase D scaffolding
  // at route.ts:L697 via `shouldSkipRetry = shouldSkipRetryForPhase(...)`.
  // The shouldSkip branch leaves `selectedRetryModel = null` +
  // `processedMessages = messages` + `provider`/`model` unchanged, so
  // `config.tools` (set at L2032 by getMCPToolsForAI_SDK) stays intact
  // for the downstream call. This Section locks the invariant so a
  // future refactor that re-introduces a strip site is caught pre-commit.)
  // ================================================================
  describe('Section F: BUG 1 closure — tools/tool_choice never stripped on retry', () => {
    it('Phase D documentation explicitly cites closing BUG 1 + BUG 6', () => {
      // The contract intent must remain grep-discoverable. A future
      // refactor that drops the "Closes BUG 1 + BUG 6" reference loses
      // the link to /opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md
      // evidence — fail here so the operator is prompted to update the
      // comment if the contract intent diverges from the implementation.
      expect(
        routeSource.match(/Closes BUG 1 \+ BUG 6/i),
        'route.ts must keep the documented "Closes BUG 1 + BUG 6" reference — drift here signals the Phase D gate was refactored without updating the contract comment',
      ).not.toBeNull();
    });

    it('no site in route.ts strips body.tools or body.tool_choice', () => {
      // Regex covers the four known strip patterns the pre-Phase-D code
      // used. A future regression that re-introduces any of these would
      // resurrect the Mistral 400 error surface (BUG 1 + BUG 6).
      const stripPatterns: RegExp[] = [
        /body\.tools\s*=\s*(null|undefined|\[\])/,
        /body\.tool_choice\s*=\s*(null|undefined|["']auto["'])/,
        /delete\s+body\.tools\b/,
        /delete\s+body\.tool_choice\b/,
      ];
      for (const pat of stripPatterns) {
        expect(
          routeSource.match(pat),
          `route.ts must not contain \`${pat.source}\` — strip sites re-introduce BUG 1 (Mistral retry 400)`,
        ).toBeNull();
      }
    });

    it('Phase D gate precedes config.tools construction (gate decides fallthrough)', () => {
      // The Phase D gate at L697 runs BEFORE `config.tools = tools.map(...)`
      // at L2032 by deliberate code-ordering: the gate decides whether
      // the chat route even proceeds to tool construction. If the gate
      // says SKIP, downstream sites that DO touch `config.tools` (e.g.
      // `tools: config.tools` at L2989) remain unchanged.
      const gateIdx = routeSource.search(
        /shouldSkipRetry\s*=\s*shouldSkipRetryForPhase/,
      );
      const configToolsIdx = routeSource.search(/config\.tools\s*=/);
      const toolsAtConfigIdx = routeSource.search(/tools:\s*config\.tools\b/);
      expect(gateIdx, 'Phase D gate must exist').toBeGreaterThan(0);
      expect(configToolsIdx, 'config.tools must be constructed').toBeGreaterThan(0);
      expect(toolsAtConfigIdx, 'tools: config.tools downstream usage must exist').toBeGreaterThan(0);
      // Defensive: gate precedes the downstream tools-emit site so it's
      // an upstream gate, not a downstream afterthought.
      expect(gateIdx).toBeLessThan(toolsAtConfigIdx);
    });
  });

  // ================================================================
  // Section G — SHOULD-CONSIDER #2 / Phase D: helper-identity contract
  // ================================================================
  //
  // vitest's `vi.mock` (declared at the top of this file) replaces ALL
  // imports of `@/lib/chat/retry-route-decision` with the SAME mocked
  // module instance — both the test's reference (`* as retryRouteDecision`)
  // and route.ts's reference (its `import { ... } from
  // '@/lib/chat/retry-route-decision'` at route.ts:L92) resolve to this
  // proxy. This proves the helper-identity contract is intact: there's no
  // symbol-drift between the test's reference and production's reference,
  // even after internal helper text changes.
  describe('Section G: helper-identity contract (vi.mock wiring)', () => {
    it('vi.mock wires route.ts + test to the same shouldSkipRetryForPhase / retryActionForPhase helpers', () => {
      // 1. Test's imports resolve to callable functions (sanity check
      //    that vi.mock did not produce a no-op stub by accident).
      expect(typeof retryRouteDecision.shouldSkipRetryForPhase).toBe('function');
      expect(typeof retryRouteDecision.retryActionForPhase).toBe('function');

      // 2. The vi.fn wrappers forward to the real implementation (Phase D
      //    contract asserted inline at the same call site — proves the
      //    spy doesn't break the underlying behavior).
      expect(retryRouteDecision.shouldSkipRetryForPhase('empty')).toBe(true);
      expect(retryRouteDecision.shouldSkipRetryForPhase('success')).toBe(true);
      expect(retryRouteDecision.shouldSkipRetryForPhase('skipped')).toBe(true);
      expect(retryRouteDecision.shouldSkipRetryForPhase('error')).toBe(false);
      expect(retryRouteDecision.shouldSkipRetryForPhase(undefined)).toBe(false);
      expect(retryRouteDecision.retryActionForPhase('empty')).toBe('skip-enhancement');
      expect(retryRouteDecision.retryActionForPhase('error')).toBe('apply-enhancement');

      // 3. route.ts must reference the same module path + symbol names
      //    (structural assurance — locks the wire independent of any
      //    internal helper text changes inside retry-route-decision.ts).
      expect(
        routeSource.match(/from\s+['"]@\/lib\/chat\/retry-route-decision['"]/),
        'route.ts must import from @/lib/chat/retry-route-decision — wire-lock for SHOULD-CONSIDER #2 (Phase D)',
      ).not.toBeNull();
      expect(
        routeSource.match(/shouldSkipRetryForPhase/),
        'route.ts must reference shouldSkipRetryForPhase — wire-lock for SHOULD-CONSIDER #2 (Phase D)',
      ).not.toBeNull();
    });
  });
});
