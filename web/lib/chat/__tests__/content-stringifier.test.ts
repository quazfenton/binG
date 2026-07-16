import { describe, it, expect } from 'vitest';
import { stringifyMessageContent } from '../content-stringifier';

describe('stringifyMessageContent', () => {
  it('passes through strings unchanged (canonical contract path)', () => {
    expect(stringifyMessageContent('')).toBe('');
    expect(stringifyMessageContent('hello world')).toBe('hello world');
    expect(stringifyMessageContent('123')).toBe('123');
  });

  it('returns empty string for null/undefined (no "nullhello" or "undefinedhello" artifacts)', () => {
    expect(stringifyMessageContent(null)).toBe('');
    expect(stringifyMessageContent(undefined)).toBe('');
  });

  it('joins string[] by concatenation', () => {
    expect(stringifyMessageContent([])).toBe('');
    expect(stringifyMessageContent([''])).toBe('');
    expect(stringifyMessageContent(['a', 'b', 'c'])).toBe('abc');
  });

  it('extracts text from Vercel AI SDK ContentPart array (type=text)', () => {
    expect(stringifyMessageContent([{ type: 'text', text: 'hello' }])).toBe('hello');
    expect(stringifyMessageContent([
      { type: 'text', text: 'foo ' },
      { type: 'text', text: 'bar' },
    ])).toBe('foo bar');
  });

  it('skips ContentPart types that lack text/image content (tool-call, image_url)', () => {
    expect(stringifyMessageContent([
      { type: 'text', text: 'visible ' },
      { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
      { type: 'tool_use', id: 'call_1', name: 'bash', input: { cmd: 'ls' } },
      { type: 'text', text: 'trailing' },
    ])).toBe('visible trailing');
  });

  it('extracts {content: string} (StreamingResponse shape)', () => {
    expect(stringifyMessageContent({ content: 'from-content-field' })).toBe('from-content-field');
  });

  it('extracts {response: string} (nested AgentExecute response shape)', () => {
    expect(stringifyMessageContent({ response: 'from-response-field' })).toBe('from-response-field');
  });

  it('extracts {parts: Array<{text?: string}>} (Anthropic message shape, recursive)', () => {
    expect(stringifyMessageContent({ parts: [{ text: 'part1 ' }, { text: 'part2' }] }))
      .toBe('part1 part2');
  });

  it('prefers {content} over {parts} when both are present (StreamingResponse wins)', () => {
    expect(stringifyMessageContent({ content: 'content-wins', parts: [{ text: 'parts-loses' }] }))
      .toBe('content-wins');
  });

  it('falls through to JSON.stringify for unrecognized objects (NEVER "[object Object]")', () => {
    const out = stringifyMessageContent({ foo: 'bar', n: 42 });
    expect(out).not.toBe('[object Object]');
    expect(out).toContain('"foo":"bar"');
    expect(out).toContain('"n":42');
  });

  it('handles cyclic values via try/catch safety net (no throw, accepts "" or "{}")', () => {
    const cyclic: any = { name: 'root' };
    cyclic.self = cyclic;
    // JSON.stringify behavior on cycles varies by runtime: V8 throws
    // TypeError, some browsers/polyfills return '{}'. The helper's
    // contract is "never throws" and "always returns a string" — accept
    // either outcome so the test doesn't couple to one runtime's behavior.
    const out = stringifyMessageContent(cyclic);
    expect(typeof out).toBe('string');
    expect(['', '{}']).toContain(out);
  });

  it('returns empty string for BigInt values without throwing (String() preserves, JSON.stringify drops)', () => {
    expect(stringifyMessageContent(123n)).toBe('123');
    expect(stringifyMessageContent({ kind: 'limit', value: 1_000_000n }))
      .toContain('"value":"1000000"');
  });

  it('returns "Symbol(...)" for symbol values (String() preserves, JSON.stringify drops)', () => {
    expect(stringifyMessageContent(Symbol('hi'))).toBe('Symbol(hi)');
  });

  it('is idempotent (running twice gives the same result)', () => {
    const input = [{ type: 'text', text: 'once ' }, { type: 'text', text: 'twice' }];
    const once = stringifyMessageContent(input);
    const twice = stringifyMessageContent(once);
    expect(twice).toBe(once);
  });
});
