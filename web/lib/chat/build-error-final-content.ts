/**
 * buildErrorFinalContent — pure helper, extracted from
 * `use-enhanced-chat.ts` `case 'error'` (the SSE error branch) so the
 * discriminator logic is unit-testable WITHOUT React hook setup.
 *
 * ## Why a pure helper, not a shape-lock vitest alone
 *
 * Finding #1 (SSE-stall discriminator) was previously defended by a
 * shape-lock vitest at
 * `__tests__/audit-recs/finding-1-stall-discriminator.test.ts`. That
 * shape-lock catches REFACTOR REGRESSIONS (someone dropping the
 * `eventData.isStall === true` read from the case 'error' block) but it
 * cannot catch BEHAVIORAL regressions — for example the wrong suffix
 * being rendered for the `(canRetry:false, !hadContent)` corner of the
 * disambiguator table.
 *
 * This helper is the second primary defense. A behavioral vitest
 * (`__tests__/chat/build-error-final-content.test.ts`) directly exercises
 * every branch of the discriminator without booting React, so a corner
 * regression trips the test on the next CI run.
 *
 * ## Behavior contract — VERBATIM from `use-enhanced-chat.ts`
 *
 *  1. `isStall` is a STRICT `=== true` — not truthy. The SSR producer
 *     (`route.ts emitSseError(message, isStall?: boolean)`) emits `true`
 *     only when the Rec #2 stall watchdog fires. Number 1 / string 'true'
 *     are NOT stalls.
 *
 *  2. `errMsg` resolves as `eventData.message || eventData.error ||
 *     'Streaming error'`. Empty-string `message` falls through to
 *     `error`; both missing falls through to the default.
 *
 *  3. `canRetry`: a stall ALWAYS forces `false` (retrying hits the same
 *     already-timed-out request). Non-stall with `canRetry:undefined`
 *     defaults to `true`; non-stall with `canRetry:false` propagates.
 *
 *  4. `hadContent` is whitespace-trim — a request that streamed only
 *     `"\n  \t"` is treated as no-streamed-content.
 *
 *  5. `finalContent` rendering — 6 partitions (with asymmetric
 *     italic styling — see matrix below):
 *
 *      ┌─────────┬───────────┬──────────────────────────────────────┐
 *      │ isStall │ canRetry? │ finalContent                         │
 *      ├─────────┼───────────┼──────────────────────────────────────┤
 *      │ true    │ n/a       │ '⚠️ _Server timed out — please try...'│
 *      │ true    │ n/a + pfx │ pfx + '\n\n⚠️ _Server timed out...'│
 *      │ false   │ true     │ pfx + '\n\n⚠️ _Stream interrupted:'  │
 *      │         │           │              ${errMsg}. You can retry._│
 *      │ false   │ true     │ '⚠️ ${errMsg} Please retry your…'      │
 *      │         │ (content │   (NO \n\n, NO underscores)          │
 *      │         │  missing)│                                       │
 *      │ false   │ false    │ '⚠️ ${errMsg}' (NO suffix)            │
 *      │         │ (content │   (NO \n\n, NO underscores)          │
 *      │         │  missing)│                                       │
 *      │ false   │ false    │ pfx + '\n\n⚠️ _${errMsg}_'              │
 *      │         │           │   (italics around errMsg)            │
 *      └─────────┴───────────┴──────────────────────────────────────┘
 *
 *     Note the asymmetry: WITH-content uses Markdown-italic underscores
 *     (`_..._`) AND a `\n\n` separator; WITHOUT-content is plain-text
 *     because the chat bubble is empty so italic markup would be the only
 *     visible content (italicizing an entire bubble looks wrong). The
 *     asymmetric style is INTENTIONAL and a regression would be
 *     user-visible — the behavioral vitest pins each partition.
 *
 * Bundle note: `isStall`, `canRetry`, `errMsg` are returned alongside
 * `finalContent` so the React consumer (`use-enhanced-chat.ts`) can
 * destructure flat and pass each flag to its downstream metadata
 * propagation WITHOUT re-checking inputs. `hadContent` is computed
 * INTERNALLY (used only to select the with-content/without-content
 * partition) and is NOT returned — keeping the API surface to what
 * the hook actually consumes.
 */

// SSE-stall discriminator input shapes — minimum contract the React
// consumer must satisfy. Index signature lets unknown SSE fields pass
// through without needing a `Record<string, unknown>` cast at call sites.
//
// `accumulatedContent` is OPTIONAL on the public surface so the helper
// self-documents its own defensive default (`'')`. Production callers
// (use-enhanced-chat.ts case 'error') always pass a string; the optional
// signature is for vitest coverage of the missing-input path.
export interface BuildErrorFinalContentInput {
  accumulatedContent?: string;
  eventData?: {
    isStall?: boolean;
    message?: string;
    error?: string;
    canRetry?: boolean;
    [key: string]: unknown;
  };
}

export interface BuildErrorFinalContentOutput {
  /** Bubbling contents string to set on the SSE-error chat bubble. */
  finalContent: string;
  /** SSE-stall discriminator flag (Rec #2 watchdog fired). */
  isStall: boolean;
  /** Whether the UI may show a Retry affordance. False on stall. */
  canRetry: boolean;
  /** Resolved error message: eventData.message || eventData.error || default. */
  errMsg: string;
}

export function buildErrorFinalContent(
  input: BuildErrorFinalContentInput,
): BuildErrorFinalContentOutput {
  // Defensive defaults — a SHAPE-LOCK vitest pins the helper signature so
  // a future refactor that drops these defaults fails the test suite.
  const accumulatedContent = input?.accumulatedContent ?? '';
  const eventData = input?.eventData ?? {};

  // 1. SSE-stall discriminator — strict `=== true`, not truthy.
  const isStall = eventData.isStall === true;

  // 2. errMsg — explicit message > explicit error > default.
  const errMsg = eventData.message || eventData.error || 'Streaming error';

  // 3. canRetry — stall overrides to false; non-stall defaults to true.
  const canRetry = isStall ? false : (eventData.canRetry !== false);

  // 4. hadContent — whitespace-trim so a request streaming only "\n  \t"
  //    is treated as no-streamed-content. Used INTERNALLY for branch
  //    selection only; not part of the public bundle.
  const hadContent = !!accumulatedContent.trim();

  // 5. finalContent rendering — VERBATIM 6 partitions from
  //    use-enhanced-chat.ts case 'error'.
  //
  //    Preserve the EXACT Unicode arrows (`⚠️`) and copy text so a
  //    behavioral vitest can pin each partition byte-for-byte.
  //    See the matrix above for the 6 partitions.
  let finalContent: string;
  if (isStall) {
    // Stall path: copy is constant; does not interpolate errMsg.
    finalContent = hadContent
      ? accumulatedContent + '\n\n⚠️ _Server timed out — please try again._'
      : '⚠️ _Server timed out — please try again._';
  } else {
    // Non-stall path: copy interpolates errMsg. Italic styling and the
    // \n\n separator are asymmetric across the (with/without)-content
    // partition — see the matrix docblock for why.
    const errorSuffix = canRetry
      ? `\n\n⚠️ _Stream interrupted: ${errMsg}. You can retry._`
      : `\n\n⚠️ _${errMsg}_`;
    finalContent = hadContent
      ? accumulatedContent + errorSuffix
      : `⚠️ ${errMsg}${canRetry ? ' Please retry your request.' : ''}`;
  }

  return {
    finalContent,
    isStall,
    canRetry,
    errMsg,
  };
}
