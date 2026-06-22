/**
 * `lib/chat/shape-helpers.ts` — standalone inspector helpers for LLM response shapes.
 *
 * Originally defined inline in `app/api/chat/route.ts` (L132 / L176, prior audit).
 * Extracted in this turn so they can be unit-tested in isolation (no live LLM
 * required) and reused from other routes that ingest `UnifiedAgentResult` shapes
 * (e.g. the agent gateway path, the v1/v2 fallback routes).
 *
 * The chat route itself imports the helpers back from here; behavior is
 * preserved verbatim with no contract changes.
 *
 * Implementation note: the 1 MiB constant is exported internally as
 * `ONE_MIB_CAP` (was the literal `1_048_576` inline). The literal still
 * appears in JSDocs for grep-parity with prior review comments — if you
 * archaeology for the cap via `rg '1_048_576'`, both forms will surface.
 */

const ONE_MIB_CAP = 1_048_576;

/**
 * Cheap discriminator for `result.response` shape.
 *
 * The chat route's emit paths all assume `result.response` is a string of
 * assistant text (e.g., `Buffer + result.response`, then forwarded to
 * `detectSingleFolderFromResponse` / `extractIncrementalFileEdits` /
 * `decideAutoContinue`). A non-string shape silently coerces those derived
 * strings to `'[object Object]'` (operator-precedence bug at L1889) which
 * blocks every TOKEN/FILE_EDIT/FILESYSTEM emit — the user sees an empty
 * SSE stream with only the 2 STEP lifecycle events and no content.
 *
 * This helper makes the offending shape visible at INFO level so the next
 * occurrence is surfaced in production without LOG_LEVEL=debug toggling.
 *
 *   typeof string             -> 'string'
 *   null / undefined          -> 'null' | 'undefined'
 *   Array<{type: ...}>        -> 'array[ContentPart]'
 *   {content, isComplete}     -> 'object{StreamingResponse}'  (Vercel AI SDK / OpenAI per-token chunks)
 *   {role, parts:[...]}       -> 'object{role,parts}'
 *   {role, content:...}       -> 'object{role,content}'
 *   anything else             -> 'unknown<' + typeof + '>'
 */
export function shapeKeyOf(value: unknown): string {
  const t = typeof value;
  if (t === 'string') return 'string';
  if (value === null) return 'null';
  if (t === 'undefined') return 'undefined';
  if (Array.isArray(value)) {
    const sample = value[0];
    if (sample && typeof sample === 'object' && 'type' in (sample as Record<string, unknown>)) {
      return 'array[ContentPart]';
    }
    return 'array';
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    // Reviewer item #1: StreamingResponse fast-path. Vercel AI SDK /
    // OpenAI per-token flushes arrive as {content: string, isComplete: boolean}.
    // These are structurally similar to {role, content} but semantically a
    // streaming-accumulation chunk (per-token emission, NOT a final message).
    // Bucketing them distinctly lets the audit log tell a streaming-in-
    // progress emit apart from a fully-shaped message — important when
    // investigating tokens-arrived-but-message-didn't-refresh cases.
    // Ordered BEFORE the {role, content} check because StreamingResponse
    // has `content` without `role`, so it would otherwise never match.
    if ('content' in obj && 'isComplete' in obj) return 'object{StreamingResponse}';
    if ('role' in obj && Array.isArray(obj.parts)) return 'object{role,parts}';
    if ('role' in obj && 'content' in obj) return 'object{role,content}';
    return 'object';
  }
  return `unknown<${t}>`;
}

/**
 * Cheap length metric for `result.response` payload. Strings return their
 * `.length`; non-strings return the JSON.stringify length, capped at 1 MiB
 * (1_048_576 bytes). Returns -2 if the serialized form exceeds the cap
 * (truncation sentinel — lets ops flag runaway payloads without paying the
 * carriage cost of a multi-MiB string in the audit log), and -1 if the value
 * cannot be serialized at all (e.g., circular reference). Used to surface
 * how much text essence the LLM actually produced regardless of the
 * response shape (e.g., `serializableTextLength` of a ContentPart array
 * stays >0 to confirm SOMETHING was returned even when the shape broke the
 * route-side text coercion).
 */
export function serializableTextLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  // Reviewer item #3: bound the JSON.stringify output. Without a cap, an
  // unexpectedly huge ContentPart array or deeply-nested provider blob could
  // return a string 100+ MiB long, which downstream log sinks + SSE buffers
  // can't safely carry. The 1 MiB cap is generous enough for legitimate
  // streaming accumulations (long file-diff payloads, multi-pronged code
  // blocks) while still flagging runaway shapes. -2 is the truncation
  // sentinel (paired with -1 = "could not serialize" — distinct so ops can
  // triage the two failure modes).
  try {
    const s = JSON.stringify(value);
    return s.length > ONE_MIB_CAP ? -2 : s.length;
  } catch {
    return -1;
  }
}
