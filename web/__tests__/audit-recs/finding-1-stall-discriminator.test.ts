/**
 * Finding #1 — shape-lock vitest that defends the SSE-stall discriminator
 * invariants from future regression. The audit identified a CRITICAL seam
 * defect: when the Rec #2 stall watchdog fires mid-stream, the HTTP status is
 * structurally locked at 200 (headers already flushed), so the client receives
 * a "watchdog fired + POST 200 + browser error" conflict. The fix adds an
 * `isStall` discriminator to:
 *
 *   1. route.ts `emitSseError(message, isStall?)` signature.
 *   2. route.ts fireStall call: `emitSseError(stallErr.message, true)`.
 *   3. route.ts override: `rawEmit(SSE_EVENT_TYPES.ERROR, { message, isStall })`.
 *   4. use-enhanced-chat.ts case 'error' detects `eventData.isStall === true`
 *      and renders unambiguous "Server timed out — please try again." UX.
 *
 * These four anchors MUST stay in sync. This test is a SHAPE-LOCK — it does
 * not exercise the runtime behavior (that would require React hook testing
 * with @testing-library/react-hooks, which is out of scope for a one-PR audit
 * fix). Instead it asserts the cross-file invariant surface so future refactors
 * don't silently drop the discriminator.
 *
 * If a future change fails one of these assertions, the fix is intentionally
 * intrusive: the discriminator IS the audit's resolution, and silently dropping
 * it would re-open the original CRITICAL seam defect.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Anchor source paths at the repo root via process.cwd() so the test isn't
// coupled to its own filesystem location (reorganizations silently break
// readFileSync otherwise).
//
// Cross-file invariant surface AFTER the F1 refactor that lifted the SSE
// stall discriminator to a pure helper at lib/chat/build-error-final-
// content.ts:
//   - route.ts (producer)        — anchors 1, 2, 3 — unchanged.
//   - hooks/use-enhanced-chat.ts (consumer) — anchors 4d (metadata
//     propagation). The inline discriminator reads (4a/4b/4c) were
//     extracted to the helper so this test now also reads HELPER_TS.
//   - lib/chat/build-error-final-content.ts (pure helper) — anchors 4a,
//     4b, 4c (the actual discriminator reads + rendering).
const ROOT = process.cwd();
const ROUTE_TS = readFileSync(join(ROOT, 'app', 'api', 'chat', 'route.ts'), 'utf-8');
const CLIENT_TS = readFileSync(join(ROOT, 'hooks', 'use-enhanced-chat.ts'), 'utf-8');
const HELPER_TS = readFileSync(join(ROOT, 'lib', 'chat', 'build-error-final-content.ts'), 'utf-8');

describe('Finding #1 — SSE stall discriminator cross-file invariant', () => {
  describe('route.ts (server) anchors', () => {
    it('emitSseError unassigned signature accepts isStall second arg', () => {
      // anchor 1: the placeholder no-op must have a 2-arg signature so fireStall
      // can pass `true` before rawEmit is wired up. Regex stops at the
      // closing `boolean)` of the signature — anything past (=> void = ...) is
      // downstream noise.
      expect(ROUTE_TS).toMatch(
        /let\s+emitSseError:\s*\(message:\s*string,\s*isStall\?:\s*boolean\)/,
      );
    });

    it('emitSseError override forwards isStall into the SSE ERROR payload', () => {
      // anchor 3: when streaming is active, rawEmit must spread isStall into
      // the payload so the client can read it from the SSE body (header may
      // be stripped by Vercel/Cloudflare proxying text/event-stream).
      expect(ROUTE_TS).toMatch(
        /emitSseError\s*=\s*\(message:\s*string,\s*isStall\?:\s*boolean\)\s*:\s*void\s*=>\s*\{[\s\S]{0,200}rawEmit\(\s*SSE_EVENT_TYPES\.ERROR\s*,\s*\{\s*message\s*,\s*isStall\s*\}/,
      );
    });

    it('fireStall passes isStall:true when emitting the stall error', () => {
      // anchor 2: the watchdog firing closure MUST mark the SSE error as a
      // stall. If this drops, the client gets the generic Stream-interrupted UX
      // for what is actually a server-side stall — re-opens the audit defect.
      expect(ROUTE_TS).toMatch(
        /emitSseError\(\s*stallErr\.message\s*,\s*true\s*\)/,
      );
    });

    it('fireStall is the ONLY site that passes isStall:true', () => {
      // Defensive: any other site passing isStall:true is a regression risk.
      // rejectOnAbort passes `false`/undefined (intentionally — user aborts
      // are NOT stalls for the non-streaming 524 contract). NOT specifying
      // silently lets user-aborts get conflated with watchdog stalls.
      const stallTrueMatches = ROUTE_TS.match(/emitSseError\([^)]*,\s*true\s*\)/g) ?? [];
      expect(stallTrueMatches).toHaveLength(1);
    });
  });

  describe('use-enhanced-chat.ts (client) anchors', () => {
    it('case \'error\' delegates discriminator read to the pure helper (no inline discriminator remains in the hook)', () => {
      // anchor 4: the case 'error' branch must use the helper. After the
      // F1 refactor, `eventData.isStall === true` was lifted into
      // lib/chat/build-error-final-content.ts so this test reads BOTH files:
      // - HELPER_TS hosts the discriminator read (anchor 4a)
      // - CLIENT_TS hosts the helper CALL (and previously would have hosted
      //   the inline read; refactor's invariant is the read moved).
      // The hook must NOT still contain the inline discriminator read —
      // that's the regression we'd want to catch if a future engineer
      // re-inlines the logic instead of calling the helper.
      expect(HELPER_TS).toMatch(/eventData\.isStall\s*===\s*true/);
      expect(CLIENT_TS).toMatch(/buildErrorFinalContent\s*\(\s*\{\s*accumulatedContent\s*,\s*eventData\s*\}\s*\)/);
      expect(CLIENT_TS).not.toMatch(/const\s+isStall\s*=\s*eventData\.isStall\s*===\s*true/);
    });

    it('server-timed-out copy surfaces in the helper (the only user-facing artifact of F1)', () => {
      // The UX string was the only observable user-facing artifact of
      // Finding #1 closing. After the refactor it lives in the helper;
      // the hook no longer contains it directly. Pinning HELPER_TS locks
      // the canonical string drift; pinning CLIENT_TS confirms the hook
      // is no longer the source of truth.
      expect(HELPER_TS).toContain('Server timed out — please try again');
      expect(CLIENT_TS).not.toContain('Server timed out — please try again');
    });

    it('stall detection forces canRetry to false (read from helper)', () => {
      // Audit invariant: a server-side timed-out request MUST NOT auto-retry.
      // After refactor, the `isStall ? false : (eventData.canRetry !== false)`
      // pattern lives in the helper. Pinning HELPER_TS locks the
      // stall-overrides-canRetry contract.
      expect(HELPER_TS).toMatch(/canRetry\s*=\s*isStall\s*\?\s*false\s*:/);
    });

    it('isStall propagated to message metadata (still in hook, helper-call destructure)', () => {
      // The metadata block in use-enhanced-chat.ts must include isStall so
      // downstream UI affordances (chat bubbles, retry buttons, analytics)
      // can read it without re-parsing the SSE event. After the F1
      // refactor, isStall reaches this site via the helper's destructure
      // (`const { isStall, ... } = buildErrorFinalContent(...)`).
      expect(CLIENT_TS).toMatch(/streamError:\s*errMsg,\s*\n\s*isStall,/);
    });
  });

  describe('end-to-end invariant', () => {
    it('route fireStall producer + client case \'error\' consumer + pure helper named in the same SSE-stall-discriminator reference', () => {
      // The three files should each reference "SSE-stall discriminator"
      // so a future engineer grepping any side finds the architectural
      // concept on the others. Concept name (not audit-id) is preferred so
      // the reference survives the audit being archived.
      expect(ROUTE_TS).toContain('SSE-stall discriminator');
      expect(CLIENT_TS).toContain('SSE-stall discriminator');
      expect(HELPER_TS).toContain('SSE-stall discriminator');
    });

    it('helper exposes the discriminator surface via a typed function (single source of truth)', () => {
      // Confirm the helper exposes a single exported function whose
      // signature carries the discriminator bundle. A refactor that
      // accidentally de-types the surface (e.g. flattens to `(any, any)`
      // or exports the discriminator inline) would fail this pinning.
      expect(HELPER_TS).toMatch(/export\s+function\s+buildErrorFinalContent\s*\(/);
      expect(HELPER_TS).toMatch(/isStall\?: boolean/);
      expect(HELPER_TS).toMatch(/canRetry\?: boolean/);
    });
  });
});
