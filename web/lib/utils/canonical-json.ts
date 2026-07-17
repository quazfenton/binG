/**
 * Canonical JSON — stable stringifier with sorted keys at every depth.
 *
 * Same canonical-form rules originally inlined in
 * `lib/agents/contract.ts:stableStringify` and `lib/mcp/tool-sentinel.ts:stableStringify`.
 * Promoted to a shared utility so contract-hash computation and tool-result
 * sentinel-wrap can share one implementation (the earlier duplication was
 * flagged by the code-reviewer as SHOULD-CONSIDER S1).
 *
 * Canonical-form contract (aligned with JSON.stringify):
 *   - Object keys are sorted lexicographically at EVERY depth.
 *   - Array order is preserved (arrays are NOT sorted).
 *   - `null` and primitives pass through `JSON.stringify(value)` unchanged.
 *   - `undefined` values inside an object are DROPPED (matches `JSON.stringify`).
 *   - `undefined` inside an array becomes `null` (matches `JSON.stringify`).
 *   - Functions and Symbols are DROPPED inside objects; become `null` in arrays.
 *   - Returns `string | undefined` — top-level `undefined` mirrors `JSON.stringify(undefined)`.
 *   - Throws on circular references. `JSON.stringify` already throws on
 *     cycles for objects/arrays; the explicit cycle-detection here is
 *     defense-in-depth so callers can rely on a `RangeError` rather than
 *     the stack-overflow style failure `JSON.stringify` produces on
 *     some Node versions.
 *
 * Used by:
 *   - `lib/agents/contract.ts`: `computeContractHash` (contractHash sha256)
 *   - `lib/mcp/tool-sentinel.ts`: `wrapWithSentinel` (boundary sentinel body)
 */

/**
 * Detect circular references early so callers get a stable `RangeError`
 * instead of relying on `JSON.stringify`'s implementation-defined behavior.
 */
function hasCircularReference(value: unknown, seen: WeakSet<object>): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value as object)) return true;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (hasCircularReference(item, seen)) return true;
    }
  } else {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (hasCircularReference(obj[key], seen)) return true;
    }
  }
  seen.delete(value as object);
  return false;
}

/**
 * Stable JSON serializer: sorts keys at every depth.
 *
 * Throws RangeError on circular references. Throws TypeError on
 * non-serializable values (e.g., BigInt) — same behavior as
 * `JSON.stringify` on the same input.
 *
 * Returns `string | undefined`:
 *   - `undefined` (the primitive) at top-level matches `JSON.stringify(undefined)`.
 *   - `undefined` / functions / Symbols inside an object are DROPPED.
 *   - `undefined` / functions / Symbols inside an array become `null`.
 *
 * Callers that need a guaranteed string (e.g., for `createHash().update()`)
 * should coalesce with `?? ''` at the call site — passing `undefined` to
 * `update()` throws TypeError in Node's crypto module.
 */
export function stableStringify(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') {
    // Pass-through: primitives are not transformed by stableStringify.
    // Note: JSON.stringify(undefined) === undefined; JSON.stringify(function)
    // === undefined. We return undefined in both cases so callers can
    // distinguish "intentional undefined" from a serialized string.
    return JSON.stringify(value);
  }
  if (hasCircularReference(value, new WeakSet())) {
    throw new RangeError('stableStringify: circular reference detected');
  }
  if (Array.isArray(value)) {
    // Array preservation: keep order, but coerce undefined/functions/Symbols
    // to `null` to match JSON.stringify behavior.
    return (
      '[' +
      value
        .map((item) => {
          const serialized = stableStringify(item);
          return serialized === undefined ? 'null' : serialized;
        })
        .join(',') +
      ']'
    );
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .filter((k) => {
        // Drop undefined/functions/Symbols at every depth — matches JSON.stringify.
        const v = obj[k];
        return v !== undefined && typeof v !== 'function' && typeof v !== 'symbol';
      })
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}