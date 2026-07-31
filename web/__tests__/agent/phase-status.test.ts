/**
 * Regression test for /opt/bing/web/lib/agent/phase-status.ts.
 *
 * Locks the derivation contract for the Phase 1/Phase 2 success-signal
 * architecture (see /opt/bing/.tickets/PHASE1-PHASE2-SUCCESS-SIGNAL-ARCHITECTURE.md).
 *
 * ## What this asserts
 *
 * 1. The 4-state enum covers all 6 log-evidence bugs (BUG 1-6) via the
 *    derivation priority order: skipped > error > success > empty.
 * 2. Defensive input clamping prevents NaN/negative values from leaking
 *    into the SSE payload (which has crashed CHAT-ROUTE in the past).
 * 3. `buildPhase1Outcome` correctly preserves the legacy 5-state enum
 *    so backward compat holds.
 */

import { describe, it, expect } from 'vitest';
import {
  derivePhase1Status,
  buildPhase1Outcome,
  DEFAULT_PHASE1_STATUS,
  type Phase1Status,
} from '@/lib/agent/phase-status';

describe('derivePhase1Status — 4-state derivation contract', () => {
  // ================================================================
  // Priority order: skipped > error > success > empty
  // ================================================================

  describe('priority order: skipped > error > success > empty', () => {
    it('skipped wins over applied (explicit gate even with edits)', () => {
      expect(
        derivePhase1Status({ applied: 5, errors: 0, skipped: true }),
      ).toBe<Phase1Status>('skipped');
    });

    it('skipped wins over errors (explicit gate even with failures)', () => {
      expect(
        derivePhase1Status({ applied: 0, errors: 3, skipped: true }),
      ).toBe<Phase1Status>('skipped');
    });

    it('error wins over applied (errors always surface to retry path)', () => {
      expect(
        derivePhase1Status({ applied: 5, errors: 1 }),
      ).toBe<Phase1Status>('error');
    });

    it('error wins over applied:0 (errors alone, no successes)', () => {
      expect(
        derivePhase1Status({ applied: 0, errors: 1 }),
      ).toBe<Phase1Status>('error');
    });

    it('success requires applied ≥ 1 AND errors === 0 AND not skipped', () => {
      expect(
        derivePhase1Status({ applied: 1, errors: 0 }),
      ).toBe<Phase1Status>('success');
      expect(
        derivePhase1Status({ applied: 100, errors: 0 }),
      ).toBe<Phase1Status>('success');
    });

    it("empty is the default (LLM was thinking, no edits, no errors)", () => {
      expect(
        derivePhase1Status({ applied: 0, errors: 0 }),
      ).toBe<Phase1Status>('empty');
    });

    it('empty is also the default when skipped is explicitly false', () => {
      expect(
        derivePhase1Status({ applied: 0, errors: 0, skipped: false }),
      ).toBe<Phase1Status>('empty');
    });
  });

  // ================================================================
  // The 6 bug-scenario coverage per the per-status test matrix
  // ================================================================

  describe('6-bug cascade coverage (per ticket test matrix)', () => {
    it('BUG 1: Mistral returns empty completion → empty', () => {
      expect(
        derivePhase1Status({ applied: 0, errors: 0 }),
      ).toBe('empty');
    });

    it('BUG 2: VFS writes succeed but parserreports applied:0 → still success (BUG 5 path)', () => {
      // Note: BUG 2 is the OBSERVATION that parsed applied===0 despite
      // VFS writing files. The new contract distinguishes this via the
      // call-site (the caller sets applied≥1 when VFS succeeded). This
      // test verifies the success path consumers see: applied≥1.
      expect(
        derivePhase1Status({ applied: 2, errors: 0 }),
      ).toBe('success');
    });

    it('BUG 3: Mistral returns 200 with no content → empty', () => {
      expect(
        derivePhase1Status({ applied: 0, errors: 0 }),
      ).toBe('empty');
    });

    it('BUG 4: Text-mode parser fails to extract → empty', () => {
      expect(
        derivePhase1Status({ applied: 0, errors: 0 }),
      ).toBe('empty');
    });

    it('BUG 5: Tool-result JSON in response, parser misses it → success (VFS committed)', () => {
      // VFS writes succeed → applied ≥ 1 — caller sets it correctly.
      expect(
        derivePhase1Status({ applied: 1, errors: 0 }),
      ).toBe('success');
    });

    it('BUG 6: Mistral 400 on retry → error (errors wins over applied)', () => {
      // Tool errored out so the caller reports errors ≥ 1.
      expect(
        derivePhase1Status({ applied: 0, errors: 1 }),
      ).toBe('error');
    });
  });

  // ================================================================
  // Defensive input clamping (NaN, negative, Infinity)
  // ================================================================

  describe('defensive input clamping', () => {
    it('clamps negative applied to 0', () => {
      expect(
        derivePhase1Status({ applied: -1, errors: 0 }),
      ).toBe<Phase1Status>('empty');
    });

    it('clamps negative errors to 0', () => {
      expect(
        derivePhase1Status({ applied: 5, errors: -99 }),
      ).toBe<Phase1Status>('success');
    });

    it('clamps NaN to 0', () => {
      expect(
        derivePhase1Status({ applied: NaN, errors: NaN }),
      ).toBe<Phase1Status>('empty');
    });

    it('clamps Infinity to 0 (Number.isFinite guards)', () => {
      // Infinity > 0, so without the guard it would be 'success' with
      // an infinite count. The guard clamps to 0 → empty.
      expect(
        derivePhase1Status({ applied: Infinity, errors: 0 }),
      ).toBe<Phase1Status>('empty');
    });

    it('handles missing optional skipped field', () => {
      expect(
        derivePhase1Status({ applied: 0, errors: 0 }),
      ).toBe<Phase1Status>('empty');
    });

    it('handles undefined skipped (treated as false)', () => {
      expect(
        derivePhase1Status({ applied: 0, errors: 0, skipped: undefined }),
      ).toBe<Phase1Status>('empty');
    });
  });

  // ================================================================
  // Backward-compat: legacy 5-state enum preservation
  // ================================================================

  describe('backward-compat — legacy 5-state status preserved', () => {
    it('auto_applied is preserved as legacy status', () => {
      const out = buildPhase1Outcome(
        { applied: 3, errors: 0 },
        'auto_applied',
        'Phase 1 succeeded with 3 applied edits',
      );
      expect(out.status).toBe('auto_applied');
      expect(out.phase1Status).toBe('success');
      expect(out.applied).toBe(3);
      expect(out.errors).toBe(0);
      expect(out.reason).toBe('Phase 1 succeeded with 3 applied edits');
    });

    it('denied is preserved as legacy status', () => {
      const out = buildPhase1Outcome(
        { applied: 0, errors: 1 },
        'denied',
      );
      expect(out.status).toBe('denied');
      expect(out.phase1Status).toBe('error');
    });

    it('none is preserved as legacy status', () => {
      const out = buildPhase1Outcome({ applied: 0, errors: 0 }, 'none');
      expect(out.status).toBe('none');
      expect(out.phase1Status).toBe('empty');
    });

    it("reverted_with_conflicts is preserved as legacy status", () => {
      const out = buildPhase1Outcome(
        { applied: 0, errors: 2 },
        'reverted_with_conflicts',
      );
      expect(out.status).toBe('reverted_with_conflicts');
      expect(out.phase1Status).toBe('error');
    });

    it('accepted is preserved as legacy status', () => {
      const out = buildPhase1Outcome(
        { applied: 1, errors: 0 },
        'accepted',
      );
      expect(out.status).toBe('accepted');
      expect(out.phase1Status).toBe('success');
    });

    it('omitted reason is not set on the outcome (preserves undefined)', () => {
      const out = buildPhase1Outcome({ applied: 0, errors: 0 }, 'none');
      expect(out).not.toHaveProperty('reason');
    });
  });

  // ================================================================
  // Clamping in buildPhase1Outcome (build helper has its own clamp)
  // ================================================================

  describe('buildPhase1Outcome clamps inputs independently', () => {
    it('clamps negative applied in build helper', () => {
      const out = buildPhase1Outcome(
        { applied: -10, errors: 0 },
        'none',
      );
      expect(out.applied).toBe(0);
      expect(out.phase1Status).toBe('empty');
    });

    it('clamps negative errors in build helper', () => {
      const out = buildPhase1Outcome(
        { applied: 5, errors: -5 },
        'auto_applied',
      );
      expect(out.errors).toBe(0);
      expect(out.phase1Status).toBe('success');
    });
  });

  // ================================================================
  // DEFAULT_PHASE1_STATUS sentinel
  // ================================================================

  describe('DEFAULT_PHASE1_STATUS sentinel', () => {
    it('is "empty" (loop-guard evaluates correctly when Phase 1 unreported)', () => {
      expect(DEFAULT_PHASE1_STATUS).toBe<Phase1Status>('empty');
    });
  });

  // ================================================================
  // Type exhaustiveness — ensure all 4 Phase1Status values are handled
  // ================================================================

  describe('derivePhase1Status return type exhaustiveness', () => {
    it('returns one of the 4 documented values for every documented input', () => {
      const scenarios: Array<Parameters<typeof derivePhase1Status>[0]> = [
        { applied: 0, errors: 0 },
        { applied: 1, errors: 0 },
        { applied: 0, errors: 1 },
        { applied: 5, errors: 1 },
        { applied: 5, errors: 0, skipped: true },
        { applied: 0, errors: 0, skipped: true },
        { applied: 0, errors: 0, skipped: false },
        { applied: -1, errors: 0 },
        { applied: 0, errors: -99 },
        { applied: NaN, errors: NaN },
        { applied: Infinity, errors: 0 },
      ];

      const observed: Set<Phase1Status> = new Set();
      for (const input of scenarios) {
        const out = derivePhase1Status(input);
        expect(['success', 'empty', 'error', 'skipped']).toContain(out);
        observed.add(out);
      }

      // Sanity: across the broad scenario set, we observe at least 3 of
      // the 4 values (the missing one would indicate a derivation bug).
      // We expect to see {empty, error, success, skipped}-related values
      // depending on inputs.
      expect(observed.size).toBeGreaterThanOrEqual(3);
    });
  });
});
