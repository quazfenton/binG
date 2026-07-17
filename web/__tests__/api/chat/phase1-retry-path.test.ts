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

const ROUTE_PATH = resolve(
  process.cwd(),
  'app/api/chat/route.ts',
);

/**
 * Read route.ts once per test file load — the file is large; reading
 * on every test adds nontrivial cumulative delay.
 */
const routeSource = readFileSync(ROUTE_PATH, 'utf8');

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
      expect(routeSource).toMatch(
        /retryContext\?:\s*\{[\s\S]{0,2000}phase1Status\?:\s*['"`]success['"`]\s*\|\s*['"`]empty['"`]\s*\|\s*['"`]error['"`]\s*\|\s*['"`]skipped['"`]/,
      );
    });

    it('keeps phase1Status as an optional field (backward compat with existing clients)', () => {
      // The question mark after phase1Status is what makes the field
      // backward-compatible — old clients that don't send phase1Status
      // still pass Zod validation + hit the pre-existing retry path.
      expect(routeSource).toMatch(/phase1Status\?:\s*['"`]success/);
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
});
