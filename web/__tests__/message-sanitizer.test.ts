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

  it('defaults invalid role to user', () => {
    const msgs = [{ role: 'invalid_role', content: 'test' } as any];
    const out = sanitizeMessages(msgs);
    expect(out[0].role).toBe('user');
  });
});
