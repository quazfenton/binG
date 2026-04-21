/**
 * trackFileChange Helper Tests
 *
 * Validates deduplication, operation mapping, and edge-case handling
 * for the shared file-change tracking logic used by opencode-direct.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { trackFileChange, type FileChange } from '@bing/shared/agent/opencode-direct';

describe('trackFileChange', () => {
  let fileChanges: FileChange[];

  beforeEach(() => {
    fileChanges = [];
  });

  // ── Operation mapping ───────────────────────────────────────────────

  describe('operation mapping', () => {
    it('should map write_file → write', () => {
      trackFileChange('write_file', { path: '/foo.ts', content: 'hello' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0]).toEqual({ path: '/foo.ts', operation: 'write', content: 'hello' });
    });

    it('should map WriteFile → write', () => {
      trackFileChange('WriteFile', { path: '/bar.ts', content: 'world' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].operation).toBe('write');
    });

    it('should map write → write', () => {
      trackFileChange('write', { path: '/baz.ts', content: 'x' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].operation).toBe('write');
    });

    it('should map edit_file → patch', () => {
      trackFileChange('edit_file', { path: '/a.ts', content: 'patch' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].operation).toBe('patch');
    });

    it('should map EditFile → patch', () => {
      trackFileChange('EditFile', { path: '/b.ts', content: 'patch2' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].operation).toBe('patch');
    });

    it('should map patch → patch', () => {
      trackFileChange('patch', { path: '/c.ts', content: 'diff' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].operation).toBe('patch');
    });

    it('should map edit → patch', () => {
      trackFileChange('edit', { path: '/d.ts', content: 'edit-diff' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].operation).toBe('patch');
    });

    it('should map delete_file → delete', () => {
      trackFileChange('delete_file', { path: '/gone.ts' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0]).toEqual({ path: '/gone.ts', operation: 'delete', content: undefined });
    });

    it('should map DeleteFile → delete', () => {
      trackFileChange('DeleteFile', { path: '/bye.ts' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].operation).toBe('delete');
    });

    it('should map delete → delete', () => {
      trackFileChange('delete', { path: '/rm.ts' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].operation).toBe('delete');
    });

    it('should ignore unknown tool names', () => {
      trackFileChange('read_file', { path: '/read.ts' }, fileChanges);
      trackFileChange('list_files', { dir: '/src' }, fileChanges);
      trackFileChange('bash', { command: 'ls' }, fileChanges);
      expect(fileChanges).toHaveLength(0);
    });
  });

  // ── Path resolution (args.path, args.file, args.target) ────────────

  describe('path resolution', () => {
    it('should use args.path first', () => {
      trackFileChange('write_file', { path: '/primary.ts', file: '/secondary.ts', target: '/tertiary.ts', content: 'x' }, fileChanges);
      expect(fileChanges[0].path).toBe('/primary.ts');
    });

    it('should fall back to args.file if args.path is missing', () => {
      trackFileChange('write_file', { file: '/fallback.ts', target: '/tertiary.ts', content: 'x' }, fileChanges);
      expect(fileChanges[0].path).toBe('/fallback.ts');
    });

    it('should fall back to args.target if path and file are missing', () => {
      trackFileChange('write_file', { target: '/last-resort.ts', content: 'x' }, fileChanges);
      expect(fileChanges[0].path).toBe('/last-resort.ts');
    });

    it('should skip if no path-like arg is present', () => {
      trackFileChange('write_file', { content: 'orphan' }, fileChanges);
      expect(fileChanges).toHaveLength(0);
    });

    it('should skip if all path-like args are empty strings', () => {
      trackFileChange('write_file', { path: '', file: '', target: '', content: 'x' }, fileChanges);
      expect(fileChanges).toHaveLength(0);
    });
  });

  // ── Content handling ────────────────────────────────────────────────

  describe('content handling', () => {
    it('should store string content as-is for write operations', () => {
      trackFileChange('write_file', { path: '/a.ts', content: 'const x = 1;' }, fileChanges);
      expect(fileChanges[0].content).toBe('const x = 1;');
    });

    it('should JSON.stringify non-string content for write operations', () => {
      trackFileChange('write_file', { path: '/b.ts', content: { key: 'value' } }, fileChanges);
      expect(fileChanges[0].content).toBe('{"key":"value"}');
    });

    it('should set content to undefined when args.content is null for write', () => {
      trackFileChange('write_file', { path: '/c.ts', content: null }, fileChanges);
      expect(fileChanges[0].content).toBeUndefined();
    });

    it('should set content to undefined for delete operations even if content is provided', () => {
      trackFileChange('delete_file', { path: '/d.ts', content: 'ignored' }, fileChanges);
      expect(fileChanges[0].content).toBeUndefined();
    });

    it('should set content to undefined when args.content is missing for patch', () => {
      trackFileChange('edit_file', { path: '/e.ts' }, fileChanges);
      expect(fileChanges[0].content).toBeUndefined();
    });
  });

  // ── Deduplication ───────────────────────────────────────────────────

  describe('deduplication', () => {
    it('should replace existing entry for the same path (write → write)', () => {
      trackFileChange('write_file', { path: '/same.ts', content: 'first' }, fileChanges);
      trackFileChange('write_file', { path: '/same.ts', content: 'second' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].content).toBe('second');
    });

    it('should replace existing entry when operation changes (write → delete)', () => {
      trackFileChange('write_file', { path: '/same.ts', content: 'data' }, fileChanges);
      trackFileChange('delete_file', { path: '/same.ts' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].operation).toBe('delete');
      expect(fileChanges[0].content).toBeUndefined();
    });

    it('should replace existing entry when operation changes (patch → write)', () => {
      trackFileChange('edit_file', { path: '/same.ts', content: 'diff' }, fileChanges);
      trackFileChange('write_file', { path: '/same.ts', content: 'full' }, fileChanges);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].operation).toBe('write');
      expect(fileChanges[0].content).toBe('full');
    });

    it('should keep entries with different paths', () => {
      trackFileChange('write_file', { path: '/a.ts', content: 'aa' }, fileChanges);
      trackFileChange('write_file', { path: '/b.ts', content: 'bb' }, fileChanges);
      expect(fileChanges).toHaveLength(2);
    });
  });

  // ── Array mutation (splice behavior) ────────────────────────────────

  describe('array mutation', () => {
    it('should mutate the input array in place', () => {
      const arr: FileChange[] = [];
      trackFileChange('write_file', { path: '/x.ts', content: 'x' }, arr);
      expect(arr).toHaveLength(1);
      // Same reference
      expect(arr).toBe(arr);
    });

    it('should preserve order: replaced entry moves to end', () => {
      trackFileChange('write_file', { path: '/a.ts', content: 'first' }, fileChanges);
      trackFileChange('write_file', { path: '/b.ts', content: 'second' }, fileChanges);
      // Update /a.ts — should move to end
      trackFileChange('write_file', { path: '/a.ts', content: 'updated' }, fileChanges);
      expect(fileChanges).toHaveLength(2);
      expect(fileChanges[0].path).toBe('/b.ts');
      expect(fileChanges[1].path).toBe('/a.ts');
      expect(fileChanges[1].content).toBe('updated');
    });
  });
});
