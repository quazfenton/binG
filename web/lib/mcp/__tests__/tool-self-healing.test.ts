import { describe, it, expect } from 'vitest';
import { normalizeToolArgs } from '../vfs-mcp-tools';
import { formatToolError, validateToolArgs } from '../../orchestra/shared-agent-context';

describe('Truncation detection patterns', () => {
  it('should detect "..." at end of content via normalizeToolArgs', () => {
    // Truncation is checked in the write_file execute handler, not normalizeToolArgs.
    // Here we verify that normalizeToolArgs doesn't strip the truncation marker.
    const result = normalizeToolArgs('write_file', {
      path: 'app.ts',
      content: 'function hello() {\n  // ...\n}',
    });
    expect(result.content).toContain('...');
  });
});

describe('Diff field aliases', () => {
  it('maps patch to diff', () => {
    const result = normalizeToolArgs('apply_diff', {
      path: 'x.ts',
      patch: '@@ -1 +1 @@\n-old\n+new',
    });
    expect(result.diff).toBe('@@ -1 +1 @@\n-old\n+new');
  });

  it('maps changes to diff', () => {
    const result = normalizeToolArgs('apply_diff', {
      path: 'x.ts',
      changes: '@@ -1 +1 @@\n-a\n+b',
    });
    expect(result.diff).toBe('@@ -1 +1 @@\n-a\n+b');
  });

  it('unwraps code-fenced diff', () => {
    const result = normalizeToolArgs('apply_diff', {
      path: 'x.ts',
      diff: '```diff\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n```',
    });
    expect(result.diff).not.toContain('```');
    expect(result.diff).toContain('--- a/x.ts');
  });
});

describe('formatToolError', () => {
  it('returns PATH_NOT_FOUND for not-found errors', () => {
    const err = formatToolError('read_file', 'File not found', { path: 'src/missing.ts' });
    expect(err.code).toBe('PATH_NOT_FOUND');
    expect(err.retryable).toBe(true);
    expect(err.attemptedPath).toBe('src/missing.ts');
    expect(err.suggestedNextAction).toBeDefined();
  });

  it('returns PERMISSION_DENIED for forbidden errors', () => {
    const err = formatToolError('write_file', 'Permission denied');
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.retryable).toBe(false);
  });

  it('returns generic TOOL_ERROR for unknown errors', () => {
    const err = formatToolError('read_file', 'Something went wrong');
    expect(err.code).toBe('TOOL_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('accepts Error objects', () => {
    const err = formatToolError('read_file', new Error('File does not exist'), { path: 'x.ts' });
    expect(err.code).toBe('PATH_NOT_FOUND');
  });
});

describe('validateToolArgs', () => {
  it('returns null when all required fields are present', () => {
    const err = validateToolArgs('write_file', { path: 'a.ts', content: 'hello' }, ['path', 'content']);
    expect(err).toBeNull();
  });

  it('returns INVALID_ARGS when fields are missing', () => {
    const err = validateToolArgs('write_file', { path: 'a.ts' }, ['path', 'content']);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('INVALID_ARGS');
    expect(err!.retryable).toBe(true);
    expect(err!.expectedFields).toContain('path');
    expect(err!.expectedFields).toContain('content');
    expect(err!.suggestedNextAction).toContain('content');
  });

  it('treats empty string as missing', () => {
    const err = validateToolArgs('write_file', { path: '', content: 'x' }, ['path', 'content']);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('INVALID_ARGS');
  });

  it('treats null as missing', () => {
    const err = validateToolArgs('write_file', { path: null, content: 'x' }, ['path', 'content']);
    expect(err).not.toBeNull();
  });
});
