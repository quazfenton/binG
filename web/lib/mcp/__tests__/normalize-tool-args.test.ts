import { describe, it, expect } from 'vitest';
import { normalizeToolArgs } from '../vfs-mcp-tools';
import { tolerantJsonParse } from '../../utils/json-tolerant';

describe('normalizeToolArgs', () => {
  describe('write_file', () => {
    it('maps field aliases: file→path, code→content', () => {
      const result = normalizeToolArgs('write_file', { file: 'app.ts', code: 'hello' });
      expect(result.path).toBe('app.ts');
      expect(result.content).toBe('hello');
    });

    it('maps camelCase tool name writeToFile', () => {
      const result = normalizeToolArgs('writeToFile', { filepath: 'x.ts', body: 'data' });
      expect(result.path).toBe('x.ts');
      expect(result.content).toBe('data');
    });

    it('unwraps code fences from content', () => {
      const result = normalizeToolArgs('write_file', {
        path: 'app.ts',
        content: '```typescript\nconst x = 1;\nexport default x;\n```',
      });
      expect(result.content).toBe('const x = 1;\nexport default x;');
    });

    it('unwraps code fences without language', () => {
      const result = normalizeToolArgs('write_file', {
        path: 'readme.md',
        content: '```\nhello world\n```',
      });
      expect(result.content).toBe('hello world');
    });

    it('passes through content without fences unchanged', () => {
      const result = normalizeToolArgs('write_file', { path: 'a.ts', content: 'plain text' });
      expect(result.content).toBe('plain text');
    });

    it('strips leading ./ from path', () => {
      const result = normalizeToolArgs('write_file', { path: './src/app.ts', content: 'x' });
      expect(result.path).toBe('src/app.ts');
    });

    it('strips leading / from path', () => {
      const result = normalizeToolArgs('write_file', { path: '/src/app.ts', content: 'x' });
      expect(result.path).toBe('src/app.ts');
    });

    it('strips .. segments from path', () => {
      const result = normalizeToolArgs('write_file', { path: '../src/app.ts', content: 'x' });
      expect(result.path).not.toContain('..');
    });
  });

  describe('apply_diff', () => {
    it('maps patch alias to diff', () => {
      const result = normalizeToolArgs('apply_diff', { path: 'x.ts', patch: '@@ -1 +1 @@\n-old\n+new' });
      expect(result.diff).toBe('@@ -1 +1 @@\n-old\n+new');
      expect(result.path).toBe('x.ts');
    });

    it('maps content alias to diff', () => {
      const result = normalizeToolArgs('apply_diff', { path: 'x.ts', content: 'some diff' });
      expect(result.diff).toBe('some diff');
    });

    it('unwraps code fences from diff', () => {
      const result = normalizeToolArgs('apply_diff', {
        path: 'x.ts',
        diff: '```diff\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n```',
      });
      expect(result.diff).toContain('--- a/x.ts');
      expect(result.diff).not.toContain('```');
    });
  });

  describe('read_file', () => {
    it('maps file alias to path', () => {
      const result = normalizeToolArgs('read_file', { file: 'src/app.ts' });
      expect(result.path).toBe('src/app.ts');
    });

    it('normalizes path', () => {
      const result = normalizeToolArgs('read_file', { path: './src/app.ts' });
      expect(result.path).toBe('src/app.ts');
    });
  });

  describe('list_files', () => {
    it('maps directory alias to path', () => {
      const result = normalizeToolArgs('list_files', { directory: 'src' });
      expect(result.path).toBe('src');
    });

    it('defaults path to / when empty', () => {
      const result = normalizeToolArgs('list_files', {});
      expect(result.path).toBe('/');
    });

    it('maps deep alias to recursive', () => {
      const result = normalizeToolArgs('list_files', { path: 'src', deep: true });
      expect(result.recursive).toBe(true);
    });
  });

  describe('delete_file', () => {
    it('maps target alias to path', () => {
      const result = normalizeToolArgs('delete_file', { target: 'old.ts' });
      expect(result.path).toBe('old.ts');
    });
  });

  describe('batch_write', () => {
    it('maps items alias to files', () => {
      const result = normalizeToolArgs('batch_write', {
        items: [{ file: 'a.ts', code: 'x' }],
      });
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('a.ts');
      expect(result.files[0].content).toBe('x');
    });
  });

  describe('edge cases', () => {
    it('returns null/undefined as-is', () => {
      expect(normalizeToolArgs('write_file', null)).toBeNull();
      expect(normalizeToolArgs('write_file', undefined)).toBeUndefined();
    });

    it('returns non-objects as-is', () => {
      expect(normalizeToolArgs('write_file', 'string')).toBe('string');
    });

    it('passes unknown tool names through', () => {
      const input = { foo: 'bar' };
      const result = normalizeToolArgs('unknown_tool', input);
      expect(result.foo).toBe('bar');
    });
  });
});

describe('tolerantJsonParse', () => {
  it('parses valid JSON', () => {
    expect(tolerantJsonParse('{"a": 1}')).toEqual({ a: 1 });
  });

  it('handles trailing commas', () => {
    expect(tolerantJsonParse('{"a": 1,}')).toEqual({ a: 1 });
  });

  it('handles single quotes', () => {
    expect(tolerantJsonParse("{'a': 1}")).toEqual({ a: 1 });
  });

  it('parses arrays', () => {
    expect(tolerantJsonParse('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('returns undefined for empty input', () => {
    expect(tolerantJsonParse('')).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(tolerantJsonParse(null as any)).toBeUndefined();
  });

  it('handles unescaped newlines in strings', () => {
    const result = tolerantJsonParse('{"content": "line1\nline2"}') as { content?: string } | undefined;
    expect(result).not.toBeNull();
    expect(result?.content).toContain('line1');
    expect(result?.content).toContain('line2');
  });
});
