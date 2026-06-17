// Shared SSE chunk protocol surface for route.ts + selector emitters.
// Cross-kind factory dispatching on SseChunkKind with TypeScript narrowing at the
// consumer side. Replaces the previous single-purpose makeSsePromptChunk with a
// single makeSseChunk(kind, ...) overload that returns the structurally-matched
// chunk variant, so the SSE chunk protocol (prompt | continuation | error)
// shares one factory surface.

import type { PromptSource } from '@/lib/orchestra/unified-agent-service';
import type { ContinuationReason } from '@/lib/chat/llm-continuation';

// === Stage 3 unionization: SseChunkKind + SsePromptChunk + SseContinuationChunk + SseErrorChunk + SseChunk ===

// (a) cascade Q3/Q5 anchor: SseChunkKind narrowed to the user's literal 3-variant
// spec ('prompt' | 'continuation' | 'error'). The prior 'token-yield' 4th
// variant was DROPPED to align with the user's spec. If a future contributor
// re-introduces tokens, anchor the re-introduction with the marker
// @audit-SseChunkKind-extend-token-yield-pending so the resurrection is
// grep-detectable.
export type SseChunkKind = 'prompt' | 'continuation' | 'error';

/**
 * 'prompt' kind: chat-stream text the assistant emits to the client.
 * Consumers: chat UI, frontend route handlers.
 *
 * Field-level anchors (cascade Step 5):
 *   - `type`     — discriminator literal. Always 'prompt'. Consumers
 *                  narrow on `chunk.type === 'prompt'`.
 *   - `source`   — `PromptSource` ('override' | 'no-override') disc:
 *                  distinguishes caller-requested prompt overrides
 *                  from caller-skipped (null/empty). Single source
 *                  of truth lives in
 *                  `unified-agent-service.PROMPT_SOURCE`.
 *   - `content`  — the prompt text. May be null when a prompt emit is
 *                  requested for marker-side validation only.
 */
export interface SsePromptChunk {
  type: 'prompt';
  source: PromptSource;
  content: string | null;
}

/**
 * 'continuation' kind: auto-continue decision event emitted when the
 * route layer's do-while(false) band re-invokes the LLM.
 * Consumers: chat UI (continuation banner), SSE parser (event ordering).
 *
 * Field-level anchors (cascade Step 5):
 *   - `type`       — discriminator literal. Always 'continuation'.
 *   - `continue`   — RESERVED-KEYWORD FIELD NAME PRESERVED:
 *                      object-property names are not reserved-word-restricted
 *                      (only identifier usages like parameter/variable
 *                      names are). The related overload + case-body
 *                      destructure uses `shouldContinue` per the prior
 *                      keyword-fix turn (see makeSseChunk 'continuation'
 *                      overload signature + destructure below).
 *                    Per-event boolean: did this continuation dispatch?
 *                    Mirrors `AutoContinueDecision.continue`. SYNCHRONIZED
 *                    with the helper's typed `clearedCount + finalIteration`
 *                    metric via the SSE payload schema.
 *   - `reason`     — cascade Q3 retype: typed `ContinuationReason` union
 *                    (NOT `string`). Single source of truth lives in
 *                    `lib/chat/llm-continuation.ts`. Consumers narrowing
 *                    on `chunk.reason === 'single_step_read_pattern'` get
 *                    compile-time type-narrowing instead of stringly
 *                    typed checks; adding a new ContinuationReason literal
 *                    surfaces a TS error at all consumer sites.
 *   - `iteration` — 1-indexed iteration counter for this continuation
 *                    in the current request. Mirrors
 *                    `AutoContinueDecision.continuationsSoFar`.
 */
export interface SseContinuationChunk {
  type: 'continuation';
  // Field name `continue` is preserved: object-property names are not
  // reserved-word-restricted (only identifier usages like parameter/variable
  // names are). The related overload + case-body destructure uses
  // `shouldContinue` per the prior keyword-fix turn.
  continue: boolean;
  // (d) cascade Q3: retype from `string` to the canonical `ContinuationReason`
  // union from `@/lib/chat/llm-continuation` (single-source-of-truth). This
  // lets SSE payload schema + runV1ApiWithTools.test.ts's discriminator
  // checks compile against the typed enum (not against `string`), so:
  //   * `chunk.reason === 'single_step_read_pattern'` is type-narrowed.
  //   * Adding a new ContinuationReason literal without updating consumers
  //     is surfaced as a TS compile error instead of a silent string drift.
  reason?: ContinuationReason;
  iteration: number;
}

/**
 * 'error' kind: client-visible error event. Consumers: chat UI (error
 * banner), SSE parser (terminal-vs-recoverable semantics).
 *
 * Field-level anchors (cascade Step 5):
 *   - `type`        — discriminator literal. Always 'error'.
 *   - `message`     — human-readable error message. NOT user-localized;
 *                     renderers should append a localized suffix.
 *   - `recoverable` — whether the error is recoverable on next turn.
 *                     True = re-prompt may succeed; false = terminal
 *                     (e.g. invalid API key). Distinct from
 *                     `metadata.fallbackReason` (which is server-side
 *                     telemetry only).
 */
export interface SseErrorChunk {
  type: 'error';
  message: string;
  recoverable: boolean;
}

// Discriminated union of all chunk variants. Consumers narrow via `chunk.type`.
// (e) SseTokenYieldChunk was removed alongside the (a) SseChunkKind narrowing;
// its (former) `'token-yield'` discriminator matched the dropped 4th variant.
// Consumers that need token-yield chunks must re-introduce them through the
// @audit-SseChunkKind-extend-token-yield-pending anchor above.
export type SseChunk = SsePromptChunk | SseContinuationChunk | SseErrorChunk;

// === TypeScript-narrowed overloads for the unified makeSseChunk factory ===
// Each overload maps a `kind` literal to its specific chunk shape; TS selects
// the matching overload at the call site, narrowing return type accordingly.
// Rule: when caller switches on `return.type`, the union narrows cleanly.
//
// (b) The impl-signature uses `...args: never[]` (NOT `unknown[]`). The
// `never[]` idiom declares the impl signature as unreachable-only: callers
// cannot bypass the public overload chain with arbitrary positional args,
// and runtime shape drift is caught at compile time by the `(f)`
// exhaustiveness check below. The body uses `as [tupleType]` assertions to
// destructure the args — these are necessary because `never[]` indexing
// returns `never` (untyped).

export function makeSseChunk(
  kind: 'prompt',
  source: PromptSource,
  content: string | null,
): SsePromptChunk;
export function makeSseChunk(
  kind: 'continuation',
  shouldContinue: boolean,
  reason: ContinuationReason | undefined,
  iteration: number,
): SseContinuationChunk;
export function makeSseChunk(
  kind: 'error',
  message: string,
  recoverable: boolean,
): SseErrorChunk;
// (b) impl signature: never[] keeps the wildcard semantics while blocking
// runtime bypass via direct positional args. (f) exhaustiveness check in the
// default branch provides additional compile-time safety on the dispatch.
export function makeSseChunk(kind: SseChunkKind, ...args: never[]): SseChunk {
  switch (kind) {
    case 'prompt': {
      // (Q2 review-flag fix) runtime shape guard: 'prompt' overload expects
      // exactly 2 args (source, content). The `never[]` impl signature
      // enforces compile-time only; runtime validation catches cases where
      // the overload gains a parameter without the case body updating.
      if (args.length !== 2) {
        throw new Error(
          `makeSseChunk('prompt'): expected 2 args, got ${args.length}`,
        );
      }
      const [source, content] = args as [PromptSource, string | null];
      return { type: 'prompt', source, content };
    }
    case 'continuation': {
      // (Q2 review-flag fix) runtime shape guard: 'continuation' overload
      // expects exactly 3 args (shouldContinue, reason, iteration).
      if (args.length !== 3) {
        throw new Error(
          `makeSseChunk('continuation'): expected 3 args, got ${args.length}`,
        );
      }
      // (prior keyword-fix turn) renamed destructure too: `shouldContinue` matches the
      // 'continuation' overload parameter name; field `continue` is OK on the
      // returned object literal (object-property rule).
      const [shouldContinue, reason, iteration] = args as [
        boolean,
        ContinuationReason | undefined,
        number,
      ];
      return {
        type: 'continuation',
        continue: shouldContinue,
        reason,
        iteration,
      };
    }
    case 'error': {
      // (Q2 review-flag fix) runtime shape guard: 'error' overload expects
      // exactly 2 args (message, recoverable).
      if (args.length !== 2) {
        throw new Error(
          `makeSseChunk('error'): expected 2 args, got ${args.length}`,
        );
      }
      const [message, recoverable] = args as [string, boolean];
      return { type: 'error', message, recoverable };
    }
    default: {
      // (f) exhaustiveness check: assigning `kind` to `never` after all listed
      // cases handles the TS narrowing correctly; if any SseChunkKind variant
      // is added without a corresponding case, TS surfaces a compile error.
      // (Q5 review-flag fix) unused-var convention: `_` matches the user's
      // literal spec for the exhaustiveness check; the runtime throw is a
      // defense-in-depth fallback (the `never[]` impl signature keeps this
      // branch unreachable from outside the file).
      const _: never = kind;
      throw new Error(
        `makeSseChunk: unhandled SseChunkKind: ${String(_)}`,
      );
    }
  }
}

// === Backward-compat re-export of the original single-purpose helper ===
//
// (c) cascade Q3: makeSsePromptChunk marked @deprecated. Existing imports
// keep resolving without churn, but new callers should adopt
// `makeSseChunk('prompt', source, content)` for cascade-marker continuity.
/**
 * @deprecated Replaced by `makeSseChunk('prompt', source, content)`.
 *             Kept only for backward compat with existing imports. New
 *             callers should adopt the unified factory surface so the
 *             discriminator union (`SseChunk`) is the single narrowing path.
 */
export function makeSsePromptChunk(
  source: PromptSource,
  content: string | null,
): SsePromptChunk {
  return makeSseChunk('prompt', source, content);
}
