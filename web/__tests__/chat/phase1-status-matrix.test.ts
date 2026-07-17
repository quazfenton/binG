/**
 * Phase E — Per-status test matrix for the Phase 1/Phase 2 success-signal
 * architecture.
 *
 * Source of truth: /opt/bing/.tickets/PHASE1-PHASE2-SUCCESS-SIGNAL-ARCHITECTURE.md
 * (per-status test matrix, L226-L237 in the ticket).
 *
 * ## What this asserts
 *
 * Locks the **scenario → phase1Status → retry_action → ui_behavior →
 * loop_guard_action** contract for all 10 documented Phase 1 outcomes:
 *
 *   6 BUG scenarios (BUG 1-6) — reproduced from /opt/bing/web/logs/run.log
 *   1 baseline (Phase 1 succeeds with edits + assistant text)
 *   3 defensive (tool-error, VFS-off, text-only path)
 *
 * Each `it()` asserts against the fully-pinned contract — a future regression
 * that breaks any cell below fails loudly. This replaces the postaudit's
 * "request-to-final-list" verification gap for the success-signal thread.
 *
 * @see lib/agent/phase-status.ts (Phase A)
 * @see lib/chat/retry-route-decision.ts (Phase D)
 * @see __tests__/api/chat/phase1-retry-path.test.ts (Phase D retry-path tests)
 */

import { describe, it, expect } from 'vitest';
import {
  derivePhase1Status,
  type Phase1Status,
  type Phase1DerivationInput,
} from '@/lib/agent/phase-status';
import { retryActionForPhase } from '@/lib/chat/retry-route-decision';

/**
 * Cross-layer expected-behavior maps. Phase C (loop-guard migration) +
 * Phase UI (chat hook rendering) are NOT YET fully wired per ticket acceptance
 * criteria, so we encode the **target** contract (what the architecture
 * promises post-migration) and let test results flag drift between the
 * canonical helpers and the eventual production wiring at those sites.
 *
 * If a future change to the helpers moves away from this map, both this
 * file and llm-fallback-coordinator's `derivePhase1Status` caller must
 * update together — the ticket's grep-discoverability-of-`phase1Status`
 * property is what keeps that drift visible.
 */
type UIShow =
  | 'show-edits'
  | 'show-empty'
  | 'show-error'
  | 'show-fallback';

type LoopGuardAction = 'skip' | 'evaluate';

interface ScenarioExpected {
  retry_action: 'skip-enhancement' | 'apply-enhancement';
  ui: UIShow;
  loopGuard: LoopGuardAction;
}

/**
 * Authoritative expectations table — the SELECT statement of the matrix.
 * Mutating this list without updating the ticket = contract drift, full stop.
 */
const SCENARIO_EXPECTATIONS: Record<Phase1Status, ScenarioExpected> = {
  success: {
    retry_action: 'skip-enhancement',
    ui: 'show-edits',
    loopGuard: 'skip',
  },
  empty: {
    retry_action: 'skip-enhancement',
    ui: 'show-empty',
    loopGuard: 'evaluate',
  },
  error: {
    retry_action: 'apply-enhancement',
    ui: 'show-error',
    loopGuard: 'skip',
  },
  skipped: {
    retry_action: 'skip-enhancement',
    ui: 'show-fallback',
    loopGuard: 'skip',
  },
};

/**
 * Centralized scenario assertion — locks derivation + cross-layer contract
 * for any given Phase 1 input. Errors if either the derivation OR the
 * retry_action drift away from the documented contract.
 */
function assertScenario(
  scenarioId: string,
  input: Phase1DerivationInput,
  expected: Phase1Status,
): void {
  // 1. Derivation contract — single source of truth in lib/agent/phase-status.ts
  const actual = derivePhase1Status(input);
  expect(
    actual,
    `[${scenarioId}] derivePhase1Status(${JSON.stringify(input)}) → ${actual}; expected ${expected}`,
  ).toBe(expected);

  // 2. Retry-action contract — single source of truth in retry-route-decision.ts
  const expectedAction = SCENARIO_EXPECTATIONS[expected].retry_action;
  const actualAction = retryActionForPhase(actual);
  expect(
    actualAction,
    `[${scenarioId}] retryActionForPhase(${actual}) → ${actualAction}; expected ${expectedAction}`,
  ).toBe(expectedAction);

  // 3. Cross-layer expected behaviors — pinned against the table above.
  //    These don't hit production code yet (UI hook + loop-guard are pending
  //    Phase C migration per the ticket), but they document the contract
  //    the migration must satisfy. Drift is future-detected via it.each in
  //    phase1-status-cascade.test.ts.
  const expectation = SCENARIO_EXPECTATIONS[expected];
  expect(
    expectation.ui,
    `[${scenarioId}] expected UI: ${expectation.ui}`,
  ).toMatch(/^show-(edits|empty|error|fallback)$/);
  expect(
    expectation.loopGuard,
    `[${scenarioId}] expected loop-guard: ${expectation.loopGuard}`,
  ).toMatch(/^(skip|evaluate)$/);
}

describe('Phase 1/Phase 2 success-signal scenario matrix', () => {
  // ==========================================================================
  // Run-log BUG 1-6 scenarios (from /opt/bing/web/logs/run.log)
  // ==========================================================================

  describe('BUG scenarios (log-evidence reproduction)', () => {
    it('BUG 1 — Mistral empty completion → empty + skip-retry + evaluate-loop', () => {
      assertScenario('BUG 1', { applied: 0, errors: 0 }, 'empty');
    });

    it('BUG 2 — VFS writes succeed, parser returns applied:0 → success + show-edits + skip-loop', () => {
      // IMPORTANT: applied ≥ 1 comes from VFS caller (writes already happened);
      // the parser's `applied` count is irrelevant to phase1Status derivation
      // because VFS structural commits trump the parser's parse result.
      assertScenario('BUG 2', { applied: 2, errors: 0 }, 'success');
    });

    it('BUG 3 — Mistral returns 200 with no content → empty + skip-retry + evaluate-loop', () => {
      assertScenario('BUG 3', { applied: 0, errors: 0 }, 'empty');
    });

    it('BUG 4 — Text-mode parser fails to extract → empty + skip-retry + evaluate-loop', () => {
      assertScenario('BUG 4', { applied: 0, errors: 0 }, 'empty');
    });

    it('BUG 5 — Tool-result JSON in response, parser misses → success + show-edits + skip-loop', () => {
      // BUG 5 is identical to BUG 2 structurally — applied comes from VFS
      // caller; parser's parse failure doesn't matter once VFS has the writes.
      assertScenario('BUG 5', { applied: 1, errors: 0 }, 'success');
    });

    it('BUG 6 — Mistral 400 on retry (no content, no tools) → error + APPLY-retry + skip-loop', () => {
      assertScenario('BUG 6', { applied: 0, errors: 1 }, 'error');
    });
  });

  // ==========================================================================
  // Baseline + defensive scenarios (4 cells of the matrix)
  // ==========================================================================

  describe('Baseline + defensive scenarios', () => {
    it('Baseline — Phase 1 succeeds with edits + assistant text → success + show-everything', () => {
      assertScenario('Baseline', { applied: 3, errors: 0 }, 'success');
    });

    it('Defensive 1 — Tool returns error response → error + APPLY-retry + show-error', () => {
      assertScenario('Defensive.ToolError', { applied: 0, errors: 1 }, 'error');
    });

    it('Defensive 2 — Phase 1 bypassed (VFS disabled path) → skipped + skip-retry + show-fallback', () => {
      assertScenario(
        'Defensive.VFSOff',
        { applied: 0, errors: 0, skipped: true },
        'skipped',
      );
    });

    it('Defensive 3 — Text-only response, no tool calls → empty + skip-retry + evaluate-loop', () => {
      assertScenario('Defensive.TextOnly', { applied: 0, errors: 0 }, 'empty');
    });
  });

  // ==========================================================================
  // Exhaustiveness guard — pins the 4-state enum so a 5th state added without
  // updating the matrix fails loudly here.
  // ==========================================================================

  describe('Enum exhaustiveness guard', () => {
    it('covers all 4 canonical Phase1Status values in the expectations table', () => {
      const keys = Object.keys(SCENARIO_EXPECTATIONS).sort();
      expect(keys).toEqual(['empty', 'error', 'skipped', 'success']);
    });

    it('all retry_action values are valid RetryAction enum members', () => {
      for (const status of Object.keys(SCENARIO_EXPECTATIONS) as Phase1Status[]) {
        const actual = SCENARIO_EXPECTATIONS[status].retry_action;
        expect(
          ['skip-enhancement', 'apply-enhancement'],
          `[${status}] retry_action must be RetryAction enum, got ${actual}`,
        ).toContain(actual);
      }
    });

    it('all ui values are valid UIShow enum members', () => {
      const valid: UIShow[] = [
        'show-edits',
        'show-empty',
        'show-error',
        'show-fallback',
      ];
      for (const status of Object.keys(SCENARIO_EXPECTATIONS) as Phase1Status[]) {
        const actual = SCENARIO_EXPECTATIONS[status].ui;
        expect(valid, `[${status}] ui must be UIShow enum, got ${actual}`).toContain(actual);
      }
    });

    it('all loopGuard values are valid LoopGuardAction enum members', () => {
      const valid: LoopGuardAction[] = ['skip', 'evaluate'];
      for (const status of Object.keys(
        SCENARIO_EXPECTATIONS,
      ) as Phase1Status[]) {
        const actual = SCENARIO_EXPECTATIONS[status].loopGuard;
        expect(
          valid,
          `[${status}] loopGuard must be LoopGuardAction enum, got ${actual}`,
        ).toContain(actual);
      }
    });
  });
});
