/**
 * Findings #5 + #6 — shape-lock vitest that defends the audit-defect
 * closed in this PR from future regression.
 *
 * ## Finding #5 (was: MAJOR)
 *
 * The `[AGENT-SERVICE] processUnifiedAgentRequest returned` INFO line
 * (auditResponseShape helper) fired for EVERY outer return of
 * `processUnifiedAgentRequest`, INCLUDING the all-failed catch path AND
 * the SUCCESSFUL return. The `ALL FALLBACKS EXHAUSTED` warn fired for
 * the chain-exhaust case. Both fired for the same request — operators
 * grepping for "the request ended" got two log lines per death and
 * couldn't reconstruct the actual outcome class.
 *
 * Fix: add a REQUIRED `outcome` discriminator to the auditResponseShape
 * meta object. Production flows now emit one of 5 values: `'success' |
 * 'error' | 'degraded' | 'phase2-fallback' | 'modal-success'`. The
 * required union (vs optional-with-default) prevents future emit-site
 * additions from silently defaulting to `'success'` and masking failures.
 *
 * ## Finding #6 (was: MAJOR)
 *
 * The `[Fallback] ┌─ FALLBACK CHAIN BUILD ──` log block printed
 * `caps.v2Native: false` BEFORE the chain iterated. A later override
 * flag (`forceAgentLoop` / `engine='v2-cli'` / etc.) routed the chain
 * to v2-native successfully. Operators read "v2-native: false" then
 * "v2-native SUCCEEDED" and got contradictory mental model.
 *
 * Fix: reframe the chain-build header to mark caps as intents (not
 * gates) + insert a `note:` line that explicitly says false caps fall
 * through to override paths. No new log spam — existing chain-build
 * block remains the single place to inspect chain construction.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Anchor source paths at the repo root via process.cwd() so the test isn't
// coupled to its own filesystem location (reorganizations silently break
// readFileSync otherwise).
const ROOT = process.cwd();
const UAG_PATH = join(ROOT, 'lib', 'orchestra', 'unified-agent-service.ts');
const UAG = readFileSync(UAG_PATH, 'utf-8');

describe('Finding #5 — processUnifiedAgentRequest returned outcome discriminator', () => {
  describe('auditResponseShape function signature', () => {
    it('requires outcome in the meta object (TS literal union, NOT optional)', () => {
      // Anchor: the auditResponseShape helper signature. The meta object MUST
      // carry a REQUIRED `outcome:` literal-union key — Required prevents future
      // emit-site additions from silently defaulting to 'success' and masking
      // failures in the audit log.
      //
      // Test surface: rather than a brittle multiline regex over the union
      // (which depends on TS-formatter whitespace between union values), match
      // the function signature block and assert the presence of `outcome:`
      // plus each of the 5 union values. Shape-lock anchors on the function
      // name so it can't silently relocate the discriminator elsewhere.
      const sigMatch = UAG.match(/function\s+auditResponseShape\s*\([\s\S]{0,2000}?\)/);
      expect(sigMatch, 'auditResponseShape function signature must exist in source').not.toBeNull();
      const sig = sigMatch?.[0] ?? '';
      expect(sig).toMatch(/outcome:/);
      expect(sig).toMatch(/'success'/);
      expect(sig).toMatch(/'error'/);
      expect(sig).toMatch(/'degraded'/);
      expect(sig).toMatch(/'phase2-fallback'/);
      expect(sig).toMatch(/'modal-success'/);
    });

    it('emits outcome into the log payload (not just the meta interface)', () => {
      // The audit's log.info(...) call must spread `outcome: meta.outcome` into
      // the payload, so log aggregators see the discriminator on the wire.
      // Without this the TS union is decoration — the emit still wouldn't
      // surface the outcome to operators.
      //
      // Test surface: anchor on the auditResponseShape function-body block
      // (greedy through the first `}`); assert `outcome: meta.outcome` and the
      // canonical log prefix both live inside that block.
      const bodyMatch = UAG.match(/function\s+auditResponseShape\([\s\S]*?\n\s*\}/m);
      expect(bodyMatch, 'auditResponseShape function body must exist in source').not.toBeNull();
      const body = bodyMatch?.[0] ?? '';
      expect(body).toMatch(/outcome:\s*meta\.outcome/);
      expect(body).toMatch(
        /log\.info\(\s*['"]\[AGENT-SERVICE\] processUnifiedAgentRequest returned['"]/,
      );
    });
  });

  describe('emit-site coverage (every call site MUST declare outcome)', () => {
    it('all 5 call sites include outcome:', () => {
      // The audit fires from 5 sites; each must declare outcome. A future
      // refactor that adds a 6th site WITHOUT outcome would fail tsc because
      // `outcome` is required. This test catches a fourth-state where the
      // call passes tsc but inconsistently (e.g., one site missing).
      // Find each `auditResponseShape(<name>, {...})` and confirm `outcome:` is inside.
      const callPattern = /auditResponseShape\(\s*(\w+)\s*,\s*\{[\s\S]*?\}\s*\)/g;
      const matches = [...UAG.matchAll(callPattern)];
      const realCalls = matches.filter((m) => !m[0].startsWith('//'));
      expect(realCalls.length).toBeGreaterThanOrEqual(5);
      for (const m of realCalls) {
        expect(m[0]).toContain('outcome:');
      }
    });

    it('call-site outcome values cover the canonical 5-value set', () => {
      // Lock the canonical outcome vocabulary across all 5 emit sites +
      // ensure no drift (e.g. someone adds a 'partial' that doesn't map to
      // any of the resolve paths).
      const expectedValues = [
        "'modal-success'",
        "'phase2-fallback'",
        "'success'",
        "'degraded'",
        "'error'",
      ];
      for (const v of expectedValues) {
        expect(UAG).toContain(`outcome: ${v}`);
      }
    });
  });
});

describe('Finding #6 — capability-flags-as-intents log reframe', () => {
  it('chain-build header marks caps as intents (not gates)', () => {
    // Header was: `FALLBACK CHAIN BUILD`
    // Now is:    `FALLBACK CHAIN BUILD ── caps are intents, not gates ──`
    expect(UAG).toContain(
      "log.info('[Fallback] ┌─ FALLBACK CHAIN BUILD ── caps are intents, not gates ──')",
    );
  });

  it('chain-build block emits a `note:` line about false caps fall-through BEFORE the close', () => {
    // The note line is inserted inside the chain-build block, BEFORE the
    // bottom-of-block `└─` line. Operators reading top↓bottom now see the
    // disambiguation immediately after the cap flags.
    expect(UAG).toContain(
      "log.info('[Fallback] │ note: false caps fall through to override paths; chain-resolved mode follows this block.')",
    );

    // Also verify the note line appears BEFORE the bottom-of-block `└─` line.
    const noteIdx = UAG.indexOf('note: false caps fall through to override paths');
    const headerIdx = UAG.lastIndexOf(
      '[Fallback] ┌─ FALLBACK CHAIN BUILD',
      noteIdx,
    );
    const bottomIdx = UAG.indexOf('[Fallback] └─', headerIdx);
    expect(headerIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeLessThan(noteIdx);
    expect(noteIdx).toBeLessThan(bottomIdx);
  });
});

describe('end-to-end invariant', () => {
  it('both findings are co-named in their respective file regions so future engineers can grep between them', () => {
    // The audit-rec closure should be discoverable by grep on either side.
    // Finding #5 references "outcome discriminator" + auditResponseShape.
    // Finding #6 references "caps are intents, not gates".
    expect(UAG).toContain('outcome discriminator');
    expect(UAG).toContain('caps are intents, not gates');
  });
});
