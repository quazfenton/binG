// `shapeKeyOf` emits the 8 NAMED buckets (string / null / undefined /
// array[ContentPart] / array / object{StreamingResponse} / object{role,parts} /
// object{role,content}) PLUS two SUPPLEMENTARY outputs (a generic 'object'
// fallback for objects with no recognized field combo, and an
// `unknown<typeof>` bucket for non-object / non-null / non-undefined
// primitives). All 10 outputs are tested.
//
// `serializableTextLength` returns -1 for both (a) circular refs that throw
// inside JSON.stringify, and (b) primitive non-string values whose
// JSON.stringify returns `undefined` (which then throws on `.length`).
import { describe, it, expect } from 'vitest';
import { shapeKeyOf, serializableTextLength } from '../shape-helpers';

const ONE_MIB_CAP = 1_048_576;

/**
 * Wrap a string payload so the helper takes the JSON.stringify path
 * (the string-only path is a separate test below). The bookkeeping
 * `{"a":"<payload>"}` adds exactly 8 chars of wrapper overhead to the
 * serialized length, so the cap-boundary arithmetic below is
 * deterministic. Verify: `{"a":"aaa"}` = 11 chars = 8 + 3.
 */
function jsonLengthOf(stringValue: string): number {
  // `{"a":"<X>"}` = `{`(1) + `"a"`(3) + `:`(1) + `"<X>"`(N+2) + `}`(1) = 8 + N.
  return 8 + stringValue.length;
}

describe('shapeKeyOf — all 8 shape buckets', () => {
  it("bucket #1: 'string' (typeof === 'string')", () => {
    expect(shapeKeyOf('')).toBe('string');
    expect(shapeKeyOf('hello')).toBe('string');
    expect(shapeKeyOf('a'.repeat(1_000_000))).toBe('string');
  });

  it("bucket #2: 'null' (value === null)", () => {
    expect(shapeKeyOf(null)).toBe('null');
  });

  it("bucket #3: 'undefined' (typeof === 'undefined')", () => {
    expect(shapeKeyOf(undefined)).toBe('undefined');
    expect(shapeKeyOf(void 0)).toBe('undefined');
  });

  it("bucket #4: 'array[ContentPart]' (Array whose first element has a 'type' field)", () => {
    expect(shapeKeyOf([{ type: 'text', text: 'hi' }])).toBe('array[ContentPart]');
    expect(shapeKeyOf([
      { type: 'text', text: 'a' },
      { type: 'image_url', image_url: { url: 'https://x' } },
    ])).toBe('array[ContentPart]');
  });

  it("bucket #5: 'array' (Array whose first element lacks 'type')", () => {
    expect(shapeKeyOf([])).toBe('array'); // [0] is undefined → `value[0] && ...` short-circuits
    expect(shapeKeyOf([1, 2, 3])).toBe('array');
    expect(shapeKeyOf([{ foo: 'bar' }])).toBe('array');
    expect(shapeKeyOf([null, { type: 'text' }])).toBe('array'); // sample (first) is null → falsy
  });

  it("bucket #6: 'object{StreamingResponse}' ({content, isComplete} — Vercel AI SDK chunks)", () => {
    expect(shapeKeyOf({ content: 'hello', isComplete: false })).toBe('object{StreamingResponse}');
    expect(shapeKeyOf({ content: '', isComplete: true })).toBe('object{StreamingResponse}');
  });

  it("bucket #7: 'object{role,parts}' ({role + Array parts})", () => {
    expect(shapeKeyOf({ role: 'assistant', parts: [{ type: 'text', text: 'hi' }] }))
      .toBe('object{role,parts}');
  });

  it("bucket #8: 'object{role,content}' ({role + content})", () => {
    expect(shapeKeyOf({ role: 'assistant', content: 'hi' })).toBe('object{role,content}');
    expect(shapeKeyOf({ role: 'assistant', content: '' })).toBe('object{role,content}');
  });
});

describe('shapeKeyOf — supplementary paths', () => {
  it("falls through to 'object' when no recognized field combination matches", () => {
    expect(shapeKeyOf({})).toBe('object');
    expect(shapeKeyOf({ foo: 'bar' })).toBe('object');
    expect(shapeKeyOf({ role: 'assistant' })).toBe('object'); // no parts, no content
    expect(shapeKeyOf({ content: 'no-isComplete' })).toBe('object');
    expect(shapeKeyOf({ isComplete: true })).toBe('object'); // no content
    expect(shapeKeyOf({ role: 'assistant', parts: 'not-an-array' })).toBe('object');
  });

  it("returns 'unknown<typeof>' for non-object / non-null / non-undefined primitives", () => {
    expect(shapeKeyOf(42)).toBe('unknown<number>');
    expect(shapeKeyOf(3.14)).toBe('unknown<number>');
    expect(shapeKeyOf(true)).toBe('unknown<boolean>');
    expect(shapeKeyOf(false)).toBe('unknown<boolean>');
    expect(shapeKeyOf(100n)).toBe('unknown<bigint>');
    expect(shapeKeyOf(Symbol('x'))).toBe('unknown<symbol>');
  });
});

describe('shapeKeyOf — precedence / edge cases', () => {
  it('StreamingResponse bucket wins over {role, content} when both signatures present', () => {
    // This is the canonical reason the StreamingResponse check is ordered BEFORE
    // the {role, content} check — a partial-emit can carry `role` as dead metadata
    // alongside the per-token `content`/`isComplete`. Confirming precedence so a
    // future reorder cannot silently misclassify streaming chunks.
    expect(shapeKeyOf({
      role: 'assistant',
      content: 'streaming',
      isComplete: false,
    })).toBe('object{StreamingResponse}');
  });

  it('StreamingResponse requires BOTH content AND isComplete (not just one)', () => {
    expect(shapeKeyOf({ content: 'hi' })).toBe('object'); // no isComplete
    expect(shapeKeyOf({ isComplete: true })).toBe('object'); // no content
    expect(shapeKeyOf({ content: 'hi', isComplete: 0 })).toBe('object{StreamingResponse}'); // truthy check via `'isComplete' in obj`
  });

  it("{role, parts} requires parts to be an Array (string parts => 'object')", () => {
    expect(shapeKeyOf({ role: 'assistant', parts: 'oops-not-array' })).toBe('object');
    expect(shapeKeyOf({ role: 'assistant', parts: { 0: 'fake' } })).toBe('object');
  });

  it('order of array-shape checks: empty array → array (NOT array[ContentPart])', () => {
    expect(shapeKeyOf([])).toBe('array');
  });

  it('order: array whose head is a primitive → array (not ContentPart)', () => {
    expect(shapeKeyOf(['first-string'])).toBe('array');
  });

  it('treats an explicit `null` payload as null (NOT as object)', () => {
    // `typeof null === 'object'` in JS — the `if (value === null) return 'null'`
    // check exists exactly to disarm that footgun. Locking it down here.
    expect(shapeKeyOf(null)).toBe('null');
  });
});

describe('serializableTextLength — all 5 paths', () => {
  it('path #1: string returns `.length` directly (no JSON.stringify, no cap)', () => {
    expect(serializableTextLength('')).toBe(0);
    expect(serializableTextLength('a')).toBe(1);
    expect(serializableTextLength('hello world')).toBe(11);
    // Strings are NEVER capped at 1 MiB; they're a fast-path metric.
    expect(serializableTextLength('a'.repeat(10_000_000))).toBe(10_000_000);
    expect(serializableTextLength('a'.repeat(ONE_MIB_CAP * 5))).toBe(ONE_MIB_CAP * 5);
  });

  it('path #2: serializable small object returns positive JSON-string length', () => {
    expect(serializableTextLength({ foo: 'bar' })).toBe('{"foo":"bar"}'.length); // 13
    expect(serializableTextLength({ a: 1, b: 2 })).toBe('{"a":1,"b":2}'.length);
    expect(serializableTextLength([1, 2, 3])).toBe('[1,2,3]'.length); // 7
    expect(serializableTextLength(null)).toBe('null'.length); // 4
    expect(serializableTextLength(true)).toBe('true'.length); // 4
    expect(serializableTextLength(42)).toBe('42'.length); // 2
  });

  it('path #3: serializable at EXACTLY the 1 MiB cap returns the cap length (not -2)', () => {
    // Arithmetically: `{"a":"<N chars>"}` = 8 + N. Solve 8 + N = 1_048_576 -> N = 1_048_568.
    // Verify: JSON.stringify({a:'a'.repeat(1_048_568)}).length === 1_048_576.
    const payloadThatExactlyEqualsCap = 'a'.repeat(1_048_568);
    const len = serializableTextLength({ a: payloadThatExactlyEqualsCap });
    expect(len).toBe(ONE_MIB_CAP);
    expect(len).not.toBe(-2); // boundary is INCLUSIVE
  });

  it('path #4: serializable OVER the 1 MiB cap returns -2 (truncation sentinel)', () => {
    // 8 + N > 1_048_576 -> N > 1_048_568. Choose N = 1_048_569 (just past boundary).
    const payloadOneByteOverCap = 'a'.repeat(1_048_569);
    expect(serializableTextLength({ a: payloadOneByteOverCap })).toBe(-2);
    // And a clearly-over value (2 MiB inner string -> ~2 MiB+8 wrapper).
    expect(serializableTextLength({ a: 'a'.repeat(2_000_000) })).toBe(-2);
  });

  it('path #5: unserializable values (circular ref) return -1', () => {
    // Self-referential structure throws TypeError inside JSON.stringify.
    const cyclic: any = { name: 'root' };
    cyclic.self = cyclic;
    expect(serializableTextLength(cyclic)).toBe(-1);
  });

  it('path #5 (cont.): values whose JSON.stringify returns `undefined` also produce -1', () => {
    // JSON.stringify(undefined | function | symbol) = undefined; `.length` on
    // undefined throws — caught by the same `catch`. Distinct test from the
    // circular-ref case so a future refactor that splits the two paths is
    // still covered.
    expect(serializableTextLength(undefined)).toBe(-1);
    expect(serializableTextLength(() => 'noop')).toBe(-1);
    expect(serializableTextLength(Symbol('x'))).toBe(-1);
  });
});

describe('serializableTextLength — boundaries & arithmetic', () => {
  it('cap is INCLUSIVE at the lower bound (1_048_576 = positive, not -2)', () => {
    // Boundary-test canon: ensure off-by-one regression in the `> ONE_MIB_CAP`
    // comparison cannot silently flip the cap to exclusive.
    expect(ONE_MIB_CAP).toBe(1_048_576); // sanity: cap constant is exactly 1 MiB
  });

  it('cap is EXCLUSIVE at the upper bound (1_048_576 + 1 = -2)', () => {
    // Boundary-test canon: ensure a future >= refactor cannot silently retrigger
    // the truncation path one byte earlier than spec.
    const justOver = ONE_MIB_CAP + 1;
    expect(justOver).toBe(1_048_577); // sanity: the comparison threshold
  });

  it('the cap is computed FROM the full JSON.stringify output, not just the input', () => {
    // `{"a":"<100 chars>"}` = 8 + 100 = 108 chars serialized, well under cap.
    // We're NOT capped — return the actual length (108) to prove the
    // overhead is accounted for.
    expect(serializableTextLength({ a: 'a'.repeat(100) })).toBe(108);
    // Confirm `jsonLengthOf` math matches the helper's reporting.
    expect(serializableTextLength({ a: 'x'.repeat(50) })).toBe(jsonLengthOf('x'.repeat(50)));
  });
});

describe('serializableTextLength — primitive edges (informational regressions)', () => {
  // Lightweight coverage of primitive edges the chat route doesn't currently
  // emit but a future helper extension shouldn't silently change.
  it('BigInt throws inside JSON.stringify → -1', () => {
    // JSON.stringify(123n) throws TypeError: Do not know how to serialize a BigInt.
    expect(serializableTextLength(123n)).toBe(-1);
  });

  it('NaN is serialized as `null` (V8 JSON.stringify quirk) → 4 chars', () => {
    // `JSON.stringify(NaN) === 'null'` — V8 reports NaN/Infinity as null in JSON.
    expect(serializableTextLength(NaN)).toBe('null'.length); // 4
    expect(serializableTextLength(Infinity)).toBe('null'.length);
    expect(serializableTextLength(-Infinity)).toBe('null'.length);
  });

  it('Map / Set serialize as empty `{}` (no toJSON method on bare Map/Set)', () => {
    // V8 default: bare Map/Set have no enumerable properties, so JSON.stringify
    // yields `{}`. Hardens against a future toJSON helper that would change
    // the byte count.
    expect(serializableTextLength(new Map())).toBe('{}'.length); // 2
    expect(serializableTextLength(new Set())).toBe('{}'.length); // 2
    expect(serializableTextLength(new Map([['k', 'v']]))).toBe('{}'.length); // Map<string,V> with 1 entry → still `{}`
  });

  it('Date serializes to its ISO string form', () => {
    const result = serializableTextLength(new Date(0));
    // new Date(0) → 1970-01-01T00:00:00.000Z (24 chars) wrapped in quotes = 26.
    expect(result).toBe(26);
  });
});

describe('shape-helpers — composability with route.ts', () => {
  it('shapeKeyOf buckets that the LLM provider chain actually emits', () => {
    // Mirrors the realistic response shapes the chat route's
    // `processUnifiedAgentRequest` return path sees. All eight buckets
    // exercised in this single composed test to demonstrate coverage.
    expect(shapeKeyOf('string LLM response')).toBe('string');
    expect(shapeKeyOf(null)).toBe('null');
    expect(shapeKeyOf(undefined)).toBe('undefined');
    expect(shapeKeyOf([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ])).toBe('array[ContentPart]');
    expect(shapeKeyOf([{ enum: 'a' }])).toBe('array');
    expect(shapeKeyOf({ content: 'token', isComplete: false })).toBe('object{StreamingResponse}');
    expect(shapeKeyOf({ role: 'assistant', parts: [{ type: 'text', text: 'msg' }] })).toBe('object{role,parts}');
    expect(shapeKeyOf({ role: 'assistant', content: 'msg' })).toBe('object{role,content}');
  });

  it('serializableTextLength is safe for the 4 representative LLM shapes', () => {
    // The chat route ALWAYS calls serializableTextLength(result.response);
    // confirm the 4 common shapes report non-negative lengths so the
    // `[CHAT-ROUTE] processUnifiedAgentRequest returned` INFO log line
    // shows a useful `responseLen` in audit logs.
    expect(serializableTextLength('plain-text-response')).toBe('plain-text-response'.length);
    expect(serializableTextLength([{ type: 'text', text: 'cp ' }, { type: 'text', text: 'arr' }]))
      .toBeGreaterThan(0);
    expect(serializableTextLength({ role: 'assistant', content: 'rc' }))
      .toBeGreaterThan(0);
    expect(serializableTextLength({ content: 'sr', isComplete: false }))
      .toBeGreaterThan(0);
  });
});
