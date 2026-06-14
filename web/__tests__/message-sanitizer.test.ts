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

<<<<<<< Updated upstream
  it('converts tool plain-string content to tool-result part', () => {
    const msgs = [
      { role: 'user', content: 'write a file' },
      { role: 'tool', content: 'File written successfully', tool_call_id: 'call1' },
=======
  it('converts tool plain-string content to array format', () => {
    const msgs = [
      { role: 'user', content: 'write a file' },
      { role: 'tool', content: 'File written successfully' },
>>>>>>> Stashed changes
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe('tool');
    expect(Array.isArray(out[1].content)).toBe(true);
<<<<<<< Updated upstream
    const part = (out[1].content as any[])[0];
    expect(part.type).toBe('tool-result');
    expect(part.toolCallId).toBe('call1');
    expect(part.output).toEqual({ type: 'text', value: 'File written successfully' });
=======
    expect((out[1].content as any[])[0]).toEqual({ type: 'text', text: 'File written successfully' });
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
  it('normalizes OpenAI wire-format tool_calls to CoreToolCall on assistant messages', () => {
    const toolCalls = [{ id: 'call1', type: 'function', function: { name: 'read_file', arguments: '{"path":"test.txt"}' } }];
    const msgs = [
      { role: 'user', content: 'read a file' },
      { role: 'assistant', content: '', tool_calls: toolCalls },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe('assistant');
    // Should be normalized to CoreToolCall format
    expect(out[1].toolCalls).toEqual([
      { toolCallId: 'call1', toolName: 'read_file', args: { path: 'test.txt' } },
    ]);
  });

  it('passes through already-normalized CoreToolCall format unchanged', () => {
    const toolCalls = [{ toolCallId: 'call1', toolName: 'read_file', args: { path: 'test.txt' } }];
    const msgs = [
      { role: 'assistant', content: '', toolCalls: toolCalls },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].toolCalls).toEqual(toolCalls);
  });

  it('normalizes camelCase toolCalls in OpenAI wire format to CoreToolCall', () => {
    const toolCalls = [{ id: 'call1', type: 'function', function: { name: 'read_file', arguments: '{}' } }];
    const msgs = [
      { role: 'assistant', content: '', toolCalls: toolCalls },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].toolCalls).toEqual([
      { toolCallId: 'call1', toolName: 'read_file', args: {} },
    ]);
  });

  it('handles malformed arguments JSON in tool_calls gracefully', () => {
    const toolCalls = [{ id: 'call1', type: 'function', function: { name: 'read_file', arguments: '{invalid json}' } }];
    const msgs = [
      { role: 'assistant', content: '', tool_calls: toolCalls },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].toolCalls).toHaveLength(1);
    // Malformed JSON should not throw — falls back to {}
    expect(out[0].toolCalls[0].args).toEqual({});
  });

  it('handles null/undefined entries in tool_calls array', () => {
    const toolCalls = [null, { id: 'call2', type: 'function', function: { name: 'write_file', arguments: '{"path":"/tmp/test"}' } }];
    const msgs = [
      { role: 'assistant', content: '', tool_calls: toolCalls },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].toolCalls).toHaveLength(2);
    expect(out[0].toolCalls[0]).toBeNull(); // null passes through
    expect(out[0].toolCalls[1].toolName).toBe('write_file');
  });

  it('handles tool_calls with object-format arguments (not JSON string)', () => {
    const toolCalls = [{ id: 'call1', type: 'function', function: { name: 'execute_bash', arguments: { command: 'ls' } } }];
    const msgs = [
      { role: 'assistant', content: '', tool_calls: toolCalls },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].toolCalls[0].args).toEqual({ command: 'ls' });
  });

  it('preserves toolCallId on tool messages (camelCase, AI SDK format)', () => {
    const msgs = [
      { role: 'tool', content: 'File content here', tool_call_id: 'call1' },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('tool');
    // Sanitizer stores as toolCallId (camelCase) per AI SDK ModelMessage schema
    expect(out[0].toolCallId).toBe('call1');
  });

  it('filters out empty assistant messages without content or tool_calls', () => {
    const msgs = [
      { role: 'assistant', content: '' }, // no text, no tool_calls
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(0);
  });

=======
>>>>>>> Stashed changes
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
