# CANONICAL-JSON-DRIFT-FIX — TODO Tracking Ticket

| Field | Value |
|---|---|
| **Ticket type** | Bug fix + test alignment |
| **Status** | 🟡 OPEN (recommendation ready; awaits implementation) |
| **Opened** | 2026-07-16 |
| **Severity** | Medium — silent behavior divergence from documented contract |
| **Unblocks** | STABLE-STRINGIFY-CANONICAL-MIGRATION (the 2 local-copy migrations in contract.ts + tool-sentinel.ts) |
| **Files affected** | `/opt/bing/web/lib/utils/canonical-json.ts` + `/opt/bing/web/__tests__/lib/utils/canonical-json.test.ts` |

## Summary

The `stableStringify` utility at `/opt/bing/web/lib/utils/canonical-json.ts` has a **docblock-vs-implementation drift** on `undefined`-value handling:

- **Docblock (L13-L15) claims:** `undefined` values inside objects are dropped (matching `JSON.stringify`); arrays preserve them as `null`.
- **Implementation (L56-L75) actually:** outputs the literal `undefined` string for objects (`{"b":undefined}`); emits empty entries for arrays (`[,1,]`).

Tests 7 + 8 in `canonical-json.test.ts` are written to assert the **CURRENT implementation behavior**, not the documented behavior — so the tests are aligned with the bug, not the contract.

### Why this matters

1. **Contract violation** — the utility's docblock IS the canonical contract. Consumers (contract-hash computation, sentinel-wrap boundary sanitization) reason about the documented behavior.
2. **Migration blocker** — `STABLE-STRINGIFY-CANONICAL-MIGRATION.md` is blocked on resolving this drift. Until the implementation matches the docblock, migrating the two local copies would silently change the contract for downstream callers.
3. **JSON.stringify divergence** — `JSON.stringify({a:1, b:undefined})` returns `'{"a":1}'` (key dropped). The current implementation returns `'{"a":1,"b":undefined}'`. Any caller reasoning against `JSON.stringify` semantics gets a surprise.

## Drift Details

### Docblock (verbatim from L13-L15)

```
 *   - `undefined` values inside an object are dropped (matches `JSON.stringify`
 *     behavior; arrays preserve them as `null`).
```

### Implementation (verbatim from L56-L75)

```typescript
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
```

### Drift surface

| Input | Docblock says | Implementation does | `JSON.stringify` reference |
|---|---|---|---|
| `{a:1, b:undefined}` | `{"a":1}` (b dropped) | `{"a":1,"b":undefined}` | `{"a":1}` ✓ docblock |
| `[undefined, 1, undefined]` | `[null,1,null]` (null preserved) | `[,1,]` (empty entries) | `[null,1,null]` ✓ docblock |

### Tests 7 + 8 (currently asserting the bug)

```typescript
it('7. undefined values inside an object serialize as the literal "undefined" string (CURRENT IMPL BEHAVIOR — see TODO)', () => {
  expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1,"b":undefined}');
});

it('8. undefined inside arrays emits empty entries (CURRENT IMPL BEHAVIOR — see TODO)', () => {
  expect(stableStringify([undefined, 1, undefined])).toBe('[,1,]');
});
```

The test names even call out the TODO — they know they're asserting the wrong contract.

## Decision Options

### Option (a) — Fix implementation to match docblock ⭐ RECOMMENDED

**Rationale:** The docblock already commits to JSON.stringify-compatible behavior. JSON.stringify is the de facto standard. Downstream consumers (contract-hash computation, sentinel-wrap boundary sanitization) reason about the documented behavior. Aligning the implementation with the docblock preserves the contract and is a strict improvement.

**Implementation changes** to `/opt/bing/web/lib/utils/canonical-json.ts` `stableStringify`:

```typescript
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (hasCircularReference(value, new WeakSet())) {
    throw new RangeError('stableStringify: circular reference detected');
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => v === undefined ? 'null' : stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}
```

**Test changes** to `/opt/bing/web/__tests__/lib/utils/canonical-json.test.ts`:
- Test 7: change assertion from `{"a":1,"b":undefined}` to `{"a":1}` (key dropped, matching JSON.stringify)
- Test 8: change assertion from `[,1,]` to `[null,1,null]` (null preserved, matching JSON.stringify)
- Drop the `(CURRENT IMPL BEHAVIOR — see TODO)` qualifier from both test names

### Option (b) — Update docblock to match implementation

**Rationale:** Could be argued if there are existing callers that depend on the literal-undefined-string behavior. But this is unlikely — `JSON.stringify` compatibility is the implicit standard for any utility named "canonical JSON stringifier."

**Docblock changes** to `/opt/bing/web/lib/utils/canonical-json.ts` L13-L15:

```
 *   - `undefined` values inside an object are serialized as the literal
 *     string "undefined" (NOT JSON.stringify-compatible; arrays emit
 *     empty entries for undefined values instead of `null`).
```

**No test changes** needed — tests 7 + 8 already assert the implementation behavior.

### Why option (a) is recommended

1. **Contract preservation** — the docblock is the canonical contract. Changing it would be a semantic shift downstream; changing the implementation preserves the contract.
2. **JSON.stringify compatibility** — any caller reasoning about `JSON.stringify` semantics (e.g., for cross-system hashing compatibility) gets the standard behavior.
3. **Unblocks the migration** — the `STABLE-STRINGIFY-CANONICAL-MIGRATION.md` ticket relies on the canonical utility behaving like the documented contract. Option (a) makes that migration safe; option (b) would make the local copies and canonical utility diverge permanently.
4. **Tests already flag the issue** — the test names explicitly say `(CURRENT IMPL BEHAVIOR — see TODO)`, so the maintainer already knew this was a known bug.

## Acceptance Criteria

### For Option (a)

- [ ] `/opt/bing/web/lib/utils/canonical-json.ts` `stableStringify` — object branch filters out keys with `undefined` values
- [ ] `/opt/bing/web/lib/utils/canonical-json.ts` `stableStringify` — array branch converts `undefined` entries to literal `'null'`
- [ ] `/opt/bing/web/__tests__/lib/utils/canonical-json.test.ts` test 7 — asserts `{"a":1}` for `{a:1, b:undefined}`
- [ ] `/opt/bing/web/__tests__/lib/utils/canonical-json.test.ts` test 8 — asserts `[null,1,null]` for `[undefined, 1, undefined]`
- [ ] Drop `(CURRENT IMPL BEHAVIOR — see TODO)` qualifier from both test names
- [ ] `cd /opt/bing/web && npx vitest run __tests__/lib/utils/canonical-json.test.ts` — all tests PASS (the other tests should be unaffected: primitives, nested objects, arrays of primitives, circular reference, etc.)
- [ ] `cd /opt/bing/web && timeout 90 npx tsc --noEmit -p tsconfig.json 2>&1 | grep canonical-json` — 0 errors
- [ ] `cd /opt/bing/web && node -e "console.log(require('./lib/utils/canonical-json.ts'))" 2>&1 || echo "(expected — TS not runnable via node directly)"` — manual smoke: confirm JSON.stringify parity for `{a:1, b:undefined}` and `[undefined, 1]`

### Cross-cutting validation (after fix)

- [ ] `/opt/bing/web/lib/agents/contract.ts` callers (contractHash computation) — re-run `__tests__/lib/agents/contract.test.ts` to confirm zero regression
- [ ] `/opt/bing/web/lib/mcp/tool-sentinel.ts` callers (wrapWithSentinel) — re-run `__tests__/mcp/tool-sentinel.test.ts` (if exists) to confirm zero regression
- [ ] STABLE-STRINGIFY-CANONICAL-MIGRATION.md — flip from 🟡 BLOCKED to 🟢 UNBLOCKED; ticket is now safe to execute

## Files Referenced

- **Implementation:** `/opt/bing/web/lib/utils/canonical-json.ts` (`stableStringify` at L56-L75)
- **Docblock:** `/opt/bing/web/lib/utils/canonical-json.ts` (L13-L15 — the contract)
- **Tests:** `/opt/bing/web/__tests__/lib/utils/canonical-json.test.ts` (tests 7 + 8 at L77-L92)
- **Downstream consumers:**
  - `/opt/bing/web/lib/agents/contract.ts:L209` (`stableStringify` for `computeContractHash`)
  - `/opt/bing/web/lib/mcp/tool-sentinel.ts:L113` (`stableStringify` for `wrapWithSentinel`)
- **Unblocking ticket:** `/opt/bing/.tickets/STABLE-STRINGIFY-CANONICAL-MIGRATION.md`
- **Local copies (parity check):** `/opt/bing/web/lib/agents/contract.ts:L175-L189` + `/opt/bing/web/lib/mcp/tool-sentinel.ts:L142-L154` — these share the same drift; migration is gated on this fix

## Closure Narrative

(Fill in when fix lands. Mirror the structure of UNWRAP-HELPER-MIGRATION.md closure narrative.)

### Implementation applied

- [ ] canonical-json.ts `stableStringify` object branch filters undefined keys
- [ ] canonical-json.ts `stableStringify` array branch converts undefined → 'null'

### Test alignment

- [ ] canonical-json.test.ts test 7 asserts `{"a":1}`
- [ ] canonical-json.test.ts test 8 asserts `[null,1,null]`
- [ ] Qualifier dropped from both test names

### Verification

- [ ] vitest canonical-json.test.ts — N/N PASS
- [ ] vitest contract.test.ts — N/N PASS (cross-cutting regression check)
- [ ] vitest tool-sentinel.test.ts — N/N PASS (cross-cutting regression check) or N/A if test file doesn't exist
- [ ] tsc — 0 errors on canonical-json.ts

### Downstream impact

- [ ] STABLE-STRINGIFY-CANONICAL-MIGRATION.md flipped to 🟢 UNBLOCKED — the migration can now proceed safely
- [ ] Contract-hash computation (`computeContractHash`) — note in the closure that hashes for contracts containing undefined-valued fields will change (if any test snapshot is hash-pinned, regenerate the snapshot)
- [ ] Sentinel-wrap boundary sanitization (`wrapWithSentinel`) — confirmed no behavior regression for typical tool results (which are JSON.stringify-compatible already)
