/**
 * Coerce an LLM message-content value into a stable string per the
 * `UnifiedAgentResult.response: string` contract.
 *
 * ## Why this exists
 *
 * The TypeScript contract declares `UnifiedAgentResult.response: string`
 * (lib/orchestra/unified-agent-service.ts:746) and
 * `AgentExecuteResponse.response: string`
 * (lib/modal/modal-client.ts:33). At runtime, however, the Modal HTTP
 * wire layer at `/api/agent/execute` can return non-string shapes
 * (ContentPart arrays, `{role, parts, content}` objects, raw objects,
 * etc.) — TypeScript trusts the typed `this.post<T>(...)` cast and the
 * drift surfaces only when the chat route's emit paths call
 * `streamState.buffer + result.response` and forward through
 * `detectSingleFolderFromResponse` / `extractIncrementalFileEdits` /
 * `processUnifiedAgentRequest` at L1568 (and the 5 mode-handler
 * return sites L2067/L2149/L2223/L2272/L2318) — applies the coercion
 * at the service-layer return statement. A non-string shape silently coerces to
 * `'[object Object]'` (operator-precedence floor bug at route.ts:1889
 * — `+` binds tighter than `||`) and the user sees a stream with zero
 * content chunks despite 27.7s of pre-Response setup.
 *
 * This adapter normalizes any of the following shapes to a string:
 *
 *   - `string`                                  -> as-is
 *   - `null` / `undefined`                      -> `''`
 *   - `string[]`                                -> `arr.join('')`
 *   - `Array<{type:'text', text?:string}>`      -> text parts concatenated
 *   - `Array<{type?:string, text?:string, content?:string}>`
 *                                                -> text/content fall-through
 *   - `{content: string}`                       -> `value.content`
 *   - `{response: string}`                      -> `value.response`
 *   - `{parts: Array<{text?:string}>}`          -> `value.parts.*.text`
 *   - Anything else (object, primitive)         -> `JSON.stringify(value)`
 *                                                  — graceful "default",
 *                                                  NOT `'[object Object]'`
 *
 * The helper never throws. The shape-key audit at
 * `route.ts::shapeKeyOf(value)` is the dedicated discriminator for
 * deterministic types-of-types telemetry; this adapter never overlaps
 * with it (one is for diagnostics, the other is for coercion).
 *
 * ## Defense-in-depth call sites
 *
 *   1. `lib/modal/modal-client.ts::ModalClient.executeAgent` — wire layer.
 *   2. `lib/orchestra/unified-agent-service.ts` L1568 — service-layer
 *      `processUnifiedAgentRequest` modal-success return.
 *   3. `app/api/chat/route.ts` L1884 + L1889 — defensive route-layer

## Defense-in-depth ordering

The three call sites are layered from outermost to innermost. A regression
at any single layer is caught by the next layer, so the bug class stays
closed even if a single call site is removed in a future refactor:

- Layer 1 (outermost): modal wire layer — JSON response coerced before any caller sees it.
- Layer 2 (middle): service-layer returns — every `UnifiedAgentResult.response` assignment wrapped.
- Layer 3 (innermost, catch-all): route boundary — even if both upstream layers regress, the route's `iterContent` and `responseContent` capture non-string shapes before SSE emit.

Removing ANY single layer is a regression risk; the bug class is closed ONLY while all three layers are present.
 *      coercion over `streamState.buffer + result.response` (closes
 *      the `'[object Object]'` operator-precedence floor).
 *
 * Applying at all three sites means the `UnifiedAgentResult.response: string`
 * contract is enforced end-to-end and is no longer relying on a single
 * trust boundary that can drift.
 */

/**
 * Normalize arbitrary LLM message-content shapes to a string.
 *
 * Pure function. Never throws; never returns non-string. Always returns
 * at least `''` for `null`/`undefined` input — call sites that pass a
 * non-string must always end up with a usable string downstream.
 */
/**
 * BigInt-safe JSON.stringify replacer. Without it, `JSON.stringify({v: 1n})`
 * throws `TypeError: Do not know how to serialize a BigInt`. The replacer
 * converts BigInt to its string representation so the helper's contract
 * ("never throws") holds even for nested BigInt values.
 */
function bigIntSafeReplacer(_key: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

export function stringifyMessageContent(value: unknown): string {
  // null / undefined -> empty string (callers can append without
  // weird 'undefinedhello' / 'nullhello' artifacts).
  if (value === null || value === undefined) return '';

  // Strings are pass-through — this includes the canonical contract case
  // and avoids a `JSON.stringify` hop on the hot path.
  if (typeof value === 'string') return value;

  // Arrays: ContentPart shape (Vercel AI SDK / OpenAI / Anthropic).
  // Each element may be a string OR a typed part with `text` / `content`.
  if (Array.isArray(value)) {
    let out = '';
    for (const part of value) {
      if (typeof part === 'string') {
        out += part;
        continue;
      }
      if (part && typeof part === 'object') {
        const obj = part as Record<string, unknown>;
        // Prefer `text` (text part) over `content` (legacy Vercel shape).
        if (typeof obj.text === 'string') { out += obj.text; continue; }
        if (typeof obj.content === 'string') { out += obj.content; continue; }
        // Unknown part type — skip silently so a stray tool-call part
        // doesn't pollute the visible assistant text.
      }
    }
    return out;
  }

  // Plain objects. Probe the most common shapes first.
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Direct text field — covers `{content: string}` (StreamingResponse
    // shape) and `{response: string}` (nested result shape).
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.response === 'string') return obj.response;
    // Multi-part message: `{parts: Array<{text?: string}>}` (Anthropic).
    if (Array.isArray(obj.parts)) {
      return stringifyMessageContent(obj.parts);
    }
    // Last-resort: serialize via the BigInt-safe replacer so the user
    // sees SOMETHING meaningful, NOT `'[object Object]'`. The replacer
    // handles nested `BigInt` values cleanly (e.g., token counters from
    // provider SDKs that expose `tokens_used: 12345n`); without it the
    // call would throw and we'd fall through to `''`.
    try {
      return JSON.stringify(value, bigIntSafeReplacer);
    } catch {
      return '';
    }
  }

  // Other primitives (number, boolean, bigint, symbol).
  // String() never throws on these; symbol returns 'Symbol(...)'.
  // BigInt is intentionally handled here (top-level) AND at the array/object
  // boundaries so `{value: 1n}` also coerces correctly.
  return String(value);
}
