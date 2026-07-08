/**
 * default-scripts.test.ts
 *
 * Snapshot test for `web/lib/orchestra/prompt-orchestrator/default-scripts.ts`.
 *
 * This is a SHAPE-LEVEL snapshot lock for the canonical source-of-truth for
 * the 2 per-call-site default PromptScripts. The static audit
 * (`unified-agent-prompt-orchestrator-audit.test.ts` Test 2c) also locks
 * the shape via a text-pass on the file — this test is the vitest-native
 * counterpart, giving nicer diff output when the shape drifts.
 *
 * Why both?
 *   - Test 2c catches accidental file-level edits (someone renames a const,
 *     adds a field, removes a const).
 *   - This snapshot test catches ACCIDENTAL semantic drift (same const
 *     names, different shape) — e.g., someone changes `steps: []` to
 *     `steps: [{...}]` and then later removes the step, but forgets to
 *     update the shape lock — the snapshot diff makes that visible.
 *
 * ## Maintenance
 *
 * - Adding a 3rd const → add a new `it()` for it (copy the existing pattern).
 *   Snapshots auto-create on first run; commit them.
 * - Changing a const's shape (e.g., adding a field) → UPDATE the snapshot
 *   with `vitest -u` AFTER manually verifying the new shape is intentional.
 * - Removing a const → delete the corresponding `it()` + delete the snapshot
 *   file for it.
 *
 * The promptId + empty-steps shape is the audit contract; this snapshot
 * locks it from the vitest side. Both locks together = defense in depth.
 */
import { describe, it, expect } from 'vitest';
import {
  PO_UNIFIED_AGENT_SCRIPT,
  PO_MARKER_TAIL_SCRIPT,
} from '../default-scripts';

describe('default-scripts.ts canonical shape (Tier 8 step 8 audit-trail)', () => {
  // Parametrized shape lock for EACH const — `toMatchSnapshot()` is the
  // primary lock (catches structural drift); the explicit `promptId` +
  // `steps: []` assertions are belt-and-suspenders (catch the most
  // likely drift — someone accidentally adds a step to the empty-steps
  // contract). The 4th (empty-length) case from the v1 version of this
  // test was folded INTO the per-const assertion set (covered by
  // `toEqual([])`). The disjoint invariant is kept as its own case
  // because it locks a RELATION between two consts (not a property of
  // one) — different failure mode.
  it.each([
    { name: 'PO_UNIFIED_AGENT_SCRIPT', promptId: 'unified-agent-entry', constRef: PO_UNIFIED_AGENT_SCRIPT },
    { name: 'PO_MARKER_TAIL_SCRIPT', promptId: 'marker-tail-poll', constRef: PO_MARKER_TAIL_SCRIPT },
  ])('$name — shape locked: promptId="$promptId", steps=[]', ({ name: _name, promptId, constRef }) => {
    // `_name` prefix on the destructure is the canonical TS signal for
    // "intentionally unused" (the test name above uses `$name` to render
    // the parameterized test name — the value is consumed by vitest, not
    // by the test body). `promptId` is consumed by the `constRef.promptId
    // === promptId` assertion + the snapshot test-name render. Keeping
    // `name` underscore-prefixed makes the unused-var intent explicit.
    expect(constRef).toMatchSnapshot();
    expect(constRef.promptId).toBe(promptId);
    expect(constRef.steps).toEqual([]);
  });

  it('observability attribution: distinct promptIds keep the 2 call sites split in /api/orchestra/prompt-orchestrator/metrics', () => {
    // The 2 promptIds become Prometheus labels on `prompt_injection_total`
    // and `prompt_apply_duration_seconds` (see observability.ts). If a
    // future PR collapses them to one promptId, the 2 call sites' metric
    // series mesh together, hiding per-call-site attribution. This test
    // locks the DISJOINT promptId invariant.
    expect(PO_UNIFIED_AGENT_SCRIPT.promptId).not.toBe(PO_MARKER_TAIL_SCRIPT.promptId);
  });
});
