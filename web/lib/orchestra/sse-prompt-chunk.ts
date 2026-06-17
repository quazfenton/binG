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

// === Single-signature makeSseChunk (cascade Q-tightening) ===
//
// The prior pattern was 3 typed overload declarations + 1 `never[]` impl
// signature with `as [TupleType]` casts in each case body. This tightened
// single-signature pattern replaces it:
//
//   * Single generic-K signature uses conditional types to resolve both
//     the args tuple AND the return type per `kind`. No more overloads
//     and no more wildcard impl — both were redundant since the impl
//     was unreachable from outside the file (`never[]` idiom).
//   * Case-body destructures no longer need `as [TupleType]` casts:
//     `args` is already typed to its narrowed tuple via `_SseChunkArgs<K>`
//     conditional narrowing inside each switch case.
//   * Runtime shape guards (each `if (args.length !== N)`) are retained
//     as defense-in-depth — if a future contributor adds a new arg
//     without updating `_SseChunkArgs<K>`, the guard catches the drift
//     before the destructure executes.
//   * (f) Exhaustiveness check (`const _: never = kind;`) is retained;
//     if any SseChunkKind variant is added without a corresponding case,
//     TS surfaces a compile error AND the runtime throw fires.
//
// Per-kind arg tuples (single source of truth — now exported as the public
// `SseChunkArgs` type alias for IDE hover-documentation + external consumer
// reference; the declaration lives below the helper JSDoc):
//   * 'prompt'         → readonly [PromptSource, string | null]
//   * 'continuation'  → readonly [boolean, ContinuationReason | undefined, number]
//   * 'error'         → readonly [string, boolean]
//
// Per-kind return type (via `_SseChunkReturn<K>`):
//   * 'prompt'         → SsePromptChunk
//   * 'continuation'  → SseContinuationChunk
//   * 'error'         → SseErrorChunk

/**
 * Conditional type: maps each `SseChunkKind` literal to its narrowed
 * argument tuple. This is the single source of truth for the
 * `makeSseChunk` per-kind args surface — case bodies consume `args`
 * with this tuple type, eliminating the prior `as [TupleType]` casts.
 *
 * EXPORTED as the public `SseChunkArgs` type alias below so external
 * consumers (and IDE hover-documentation tools) can reference the
 * per-kind arg tuple contract by name. The internal `_SseChunkArgs`
 * helper has been renamed to drop the `_`-prefix and is `export`ed.
 * The shape is preserved verbatim.
 */
export type SseChunkArgs<K extends SseChunkKind> =
  K extends 'prompt' ? readonly [PromptSource, string | null] :
  K extends 'continuation' ? readonly [boolean, ContinuationReason | undefined, number] :
  K extends 'error' ? readonly [string, boolean] :
  readonly never[];

/**
 * Conditional type: maps each `SseChunkKind` literal to its specific
 * return-shape union member. Callers that pin `_SseChunkReturn<'prompt'>`
 * get `SsePromptChunk`, etc. — preserving the typed-discriminator contract
 * at call sites (e.g. `const x: SsePromptChunk = makeSseChunk('prompt', ...)`).
 */
type _SseChunkReturn<K extends SseChunkKind> =
  K extends 'prompt' ? SsePromptChunk :
  K extends 'continuation' ? SseContinuationChunk :
  K extends 'error' ? SseErrorChunk :
  SseChunk;

/**
 * Build a typed SSE chunk. Returns the structurally-matched variant for
 * the given `kind` discriminator.
 *
 * @example
 * ```ts
 * // 'prompt' kind — takes PromptSource + content
 * const promptChunk: SsePromptChunk = makeSseChunk(
 *   'prompt',
 *   PROMPT_SOURCE.OVERRIDE,
 *   'Hello, world!',
 * );
 *
 * // 'continuation' kind — takes shouldContinue + reason + iteration
 * const contChunk: SseContinuationChunk = makeSseChunk(
 *   'continuation',
 *   true,
 *   'single_step_read_pattern',
 *   1,
 * );
 *
 * // 'error' kind — takes message + recoverable
 * const errChunk: SseErrorChunk = makeSseChunk(
 *   'error',
 *   'Provider timeout',
 *   false,
 * );
 * ```
 *
 * @param kind - the discriminator literal (`'prompt'` | `'continuation'` | `'error'`).
 * @param args - the per-kind argument tuple. The shape is narrowed by TS
 *               via the `kind` literal through the exported `SseChunkArgs<K>`
 *               conditional type — no casts needed in the case bodies.
 * @returns The structurally-matched SSE chunk variant
 *          (`_SseChunkReturn<K>`): `SsePromptChunk` for `'prompt'`,
 *          `SseContinuationChunk` for `'continuation'`,
 *          `SseErrorChunk` for `'error'`.
 */
export function makeSseChunk<K extends SseChunkKind>(
  kind: K,
  ...args: SseChunkArgs<K>
): _SseChunkReturn<K> {
  switch (kind) {
    case 'prompt': {
      // Runtime shape guard: 'prompt' kind expects exactly 2 args.
      // Defense-in-depth against future drift if `_SseChunkArgs<'prompt'>`
      // is widened without updating this case body's destructure.
      if (args.length !== 2) {
        throw new Error(
          `makeSseChunk('prompt'): expected 2 args, got ${args.length}`,
        );
      }
      // args is typed as `readonly [PromptSource, string | null]` by
      // `SseChunkArgs<K>` conditional narrowing — no `as` cast.
      const [source, content] = args;
      return { type: 'prompt', source, content };
    }
    case 'continuation': {
      // Runtime shape guard: 'continuation' kind expects exactly 3 args.
      if (args.length !== 3) {
        throw new Error(
          `makeSseChunk('continuation'): expected 3 args, got ${args.length}`,
        );
      }
      // args is typed as `readonly [boolean, ContinuationReason | undefined, number]`.
      // (cascade Q6) The local destructure binds `shouldContinue` (NOT
      // `continue`) to avoid the reserved-keyword identifier rule; the
      // returned object literal uses `continue` (object-property rule).
      const [shouldContinue, reason, iteration] = args;
      return {
        type: 'continuation',
        continue: shouldContinue,
        reason,
        iteration,
      };
    }
    case 'error': {
      // Runtime shape guard: 'error' kind expects exactly 2 args.
      if (args.length !== 2) {
        throw new Error(
          `makeSseChunk('error'): expected 2 args, got ${args.length}`,
        );
      }
      // args is typed as `readonly [string, boolean]`.
      const [message, recoverable] = args;
      return { type: 'error', message, recoverable };
    }
    default: {
      // (f) Exhaustiveness check: assigning `kind` to `never` after all
      // listed cases handles TS narrowing correctly; if any SseChunkKind
      // variant is added without a corresponding case, TS surfaces a
      // compile error AND the runtime throw fires. `_` underscore
      // convention matches the user's literal spec for the unused-var idiom.
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
