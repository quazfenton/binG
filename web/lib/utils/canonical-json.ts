/**
 * Canonical JSON — stable stringifier with sorted keys at every depth.
 *
 * Same canonical-form rules originally inlined in
 * `lib/agents/contract.ts:stableStringify` and `lib/mcp/tool-sentinel.ts:stableStringify`.
 * Promoted to a shared utility so contract-hash computation and tool-result
 * sentinel-wrap can share one implementation (the earlier duplication was
 * flagged by the code-reviewer as SHOULD-CONSIDER S1).
 *
 * Canonical-form contract:
 *   - Object keys are sorted lexicographically at EVERY depth.
 *   - Array order is preserved (arrays are NOT sorted).
 *   - `null` and primitives pass through `JSON.stringify(value)` unchanged.
 *   - `undefined` values inside an object are dropped (matches `JSON.stringify`
 *     behavior; arrays preserve them as `null`).
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
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (hasCircularReference(value, new WeakSet())) {
    throw new RangeError('stableStringify: circular reference detected');
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}
