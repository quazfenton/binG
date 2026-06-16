/**
 * Unit tests for classifyResponseShape (Bug #91, Pass-6).
 *
 * Verifies the 4 response shapes:
 *   - `empty`      — neither text nor tool calls
 *   - `text`       — text present, no tool calls
 *   - `tools_only` — tool calls present, no text
 *   - `mixed`      — both text AND tool calls present
 *
 * Pure function, no mocks. The priority order matters for downstream
 * routing + billing + caching decisions:
 *   empty → text_only → tools_only → mixed
 */
import { describe, it, expect } from 'vitest';
import { classifyResponseShape, type ResponseShape } from '../unified-response-handler';

describe('classifyResponseShape (Bug #91)', () => {
  it('returns "empty" when response is undefined and no tool calls', () => {
    expect(classifyResponseShape({})).toBe<ResponseShape>('empty');
  });

  it('returns "empty" when response is an empty string and no tool calls', () => {
    expect(classifyResponseShape({ response: '' })).toBe<ResponseShape>('empty');
  });

  it('returns "empty" when response is whitespace-only and no tool calls', () => {
    expect(classifyResponseShape({ response: '   \n\t  ' })).toBe<ResponseShape>('empty');
  });

  it('returns "empty" when response is null and no tool calls', () => {
    expect(classifyResponseShape({ response: null })).toBe<ResponseShape>('empty');
  });

  it('returns "empty" when toolCalls is an empty array and no text', () => {
    expect(classifyResponseShape({ toolCalls: [] })).toBe<ResponseShape>('empty');
  });

  it('returns "text" when response has content and no tool calls', () => {
    expect(classifyResponseShape({ response: 'Hello world' })).toBe<ResponseShape>('text');
  });

  it('returns "text" when response is a long string with newlines', () => {
    expect(
      classifyResponseShape({ response: 'Line 1\nLine 2\nLine 3' })
    ).toBe<ResponseShape>('text');
  });

  it('returns "tools_only" when tool calls are present and response is undefined', () => {
    expect(
      classifyResponseShape({ toolCalls: [{ name: 'read_file', args: { path: '/foo' } }] })
    ).toBe<ResponseShape>('tools_only');
  });

  it('returns "tools_only" when tool calls are present and response is empty string', () => {
    expect(
      classifyResponseShape({ response: '', toolCalls: [{ name: 'list_files' }] })
    ).toBe<ResponseShape>('tools_only');
  });

  it('returns "tools_only" when tool calls are present and response is whitespace-only', () => {
    expect(
      classifyResponseShape({ response: '   ', toolCalls: [{ name: 'list_files' }] })
    ).toBe<ResponseShape>('tools_only');
  });

  it('returns "tools_only" with multiple tool calls and no text', () => {
    expect(
      classifyResponseShape({
        toolCalls: [
          { name: 'read_file', args: { path: '/a' } },
          { name: 'write_file', args: { path: '/b', content: 'x' } },
        ],
      })
    ).toBe<ResponseShape>('tools_only');
  });

  it('returns "mixed" when both text and tool calls are present', () => {
    expect(
      classifyResponseShape({
        response: 'I will read the file now.',
        toolCalls: [{ name: 'read_file', args: { path: '/foo' } }],
      })
    ).toBe<ResponseShape>('mixed');
  });

  it('returns "mixed" with multiple tool calls + text', () => {
    expect(
      classifyResponseShape({
        response: 'Reading and writing files in parallel.',
        toolCalls: [
          { name: 'read_file', args: { path: '/a' } },
          { name: 'write_file', args: { path: '/b', content: 'x' } },
        ],
      })
    ).toBe<ResponseShape>('mixed');
  });

  it('treats a non-string response (e.g. number) as no text', () => {
    // Defensive: a malformed upstream payload with `response: 42` should
    // not be classified as text. Only string-typed responses with content
    // count as "hasText".
    expect(
      classifyResponseShape({ response: 42 as any, toolCalls: [{ name: 'x' }] })
    ).toBe<ResponseShape>('tools_only');
  });

  it('treats a non-array toolCalls (e.g. null) as no tools', () => {
    // Defensive: upstream payloads sometimes set `toolCalls: null` instead
    // of omitting the field. Classification should still work.
    expect(
      classifyResponseShape({ response: 'just text', toolCalls: null as any })
    ).toBe<ResponseShape>('text');
  });

  it('priority: empty takes precedence over malformed inputs', () => {
    // Both fields missing/undefined → empty
    expect(classifyResponseShape({ response: undefined, toolCalls: undefined })).toBe('empty');
  });
});
