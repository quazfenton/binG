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

  it('converts tool plain-string content to tool-result part', () => {
    const msgs = [
      { role: 'user', content: 'write a file' },
      { role: 'tool', content: 'File written successfully', tool_call_id: 'call1' },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe('tool');
    expect(Array.isArray(out[1].content)).toBe(true);
    const part = (out[1].content as any[])[0];
    expect(part.type).toBe('tool-result');
    expect(part.toolCallId).toBe('call1');
    expect(part.output).toEqual({ type: 'text', value: 'File written successfully' });
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

  it('preserves tool_calls on assistant messages', () => {
    const toolCalls = [{ id: 'call1', type: 'function', function: { name: 'read_file', arguments: '{"path":"test.txt"}' } }];
    const msgs = [
      { role: 'user', content: 'read a file' },
      { role: 'assistant', content: '', tool_calls: toolCalls },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe('assistant');
    expect(out[1].tool_calls).toEqual(toolCalls);
  });

  it('preserves tool_call_id on tool messages', () => {
    const msgs = [
      { role: 'tool', content: 'File content here', tool_call_id: 'call1' },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('tool');
    expect(out[0].tool_call_id).toBe('call1');
  });

  it('filters out empty assistant messages without content or tool_calls', () => {
    const msgs = [
      { role: 'assistant', content: '' }, // no text, no tool_calls
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(0);
  });

  it('keeps assistant messages with toolCalls (camelCase) variant', () => {
    const toolCalls = [{ id: 'call1', type: 'function', function: { name: 'read_file', arguments: '{}' } }];
    const msgs = [
      { role: 'assistant', content: '', toolCalls: toolCalls },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].tool_calls).toEqual(toolCalls);
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
