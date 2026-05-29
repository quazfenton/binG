import { describe, it, expect } from 'vitest';
import { sanitizeMessages } from '../lib/chat/message-sanitizer';

describe('message-sanitizer', () => {
  it('sanitizes simple messages', () => {
    const msgs = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'ok' }];
    const out = sanitizeMessages(msgs);
    expect(out[0].role).toBe('user');
    expect(out[0].content).toBe('hello');
  });

  it('coerces object content to string', () => {
    const msgs = [{ role: 'user', content: { foo: 'bar' } } as any];
    const out = sanitizeMessages(msgs);
    expect(typeof out[0].content).toBe('string');
    expect(out[0].content).toContain('foo');
  });

  it('coerces invalid role to user (preserves context)', () => {
    const msgs = [{ role: 'invalid_role', content: 'test' } as any];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
    expect(out[0].content).toBe('test');
  });

  it('strips system-role messages entirely', () => {
    const msgs = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'system', content: 'Also be concise' },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('user');
    expect(out[1].role).toBe('assistant');
  });

  it('converts tool plain-string content to array format', () => {
    const msgs = [
      { role: 'user', content: 'write a file' },
      { role: 'tool', content: 'File written successfully' },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe('tool');
    expect(Array.isArray(out[1].content)).toBe(true);
    expect((out[1].content as any[])[0]).toEqual({ type: 'text', text: 'File written successfully' });
  });

  it('preserves already-array tool content', () => {
    const msgs = [
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: '1', toolName: 'read', output: {} }] },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(Array.isArray(out[0].content)).toBe(true);
    expect((out[0].content as any[])[0].type).toBe('tool-result');
  });

  it('filters out messages with no role at all', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      {}, // no role
      { content: 'bare' }, // no role
      { role: 'assistant', content: 'ok' },
    ];
    const out = sanitizeMessages(msgs);
    // Messages with no role are coerced to 'user' (preserves context)
    expect(out).toHaveLength(4);
    expect(out[0].role).toBe('user');
    expect(out[1].role).toBe('user');  // coerced
    expect(out[2].role).toBe('user');  // coerced
    expect(out[3].role).toBe('assistant');
  });
});
