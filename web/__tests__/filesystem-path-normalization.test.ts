import { normalizeFilesystemPath } from '../app/api/filesystem/utils';

describe('normalizeFilesystemPath', () => {
  test('should normalize composite session IDs correctly', () => {
    expect(normalizeFilesystemPath('workspace/sessions/anon$006/src/file.ts'))
      .toBe('workspace/sessions/006/src/file.ts');
    expect(normalizeFilesystemPath('workspace/sessions/1$006/file.txt'))
      .toBe('workspace/sessions/006/file.txt');
    expect(normalizeFilesystemPath('workspace/sessions/user:006/config.json'))
      .toBe('workspace/sessions/006/config.json');
  });

  test('should leave simple session IDs untouched', () => {
    expect(normalizeFilesystemPath('workspace/sessions/006/file.ts'))
      .toBe('workspace/sessions/006/file.ts');
  });

  test('should ignore non-session paths', () => {
    expect(normalizeFilesystemPath('src/file.ts'))
      .toBe('src/file.ts');
    expect(normalizeFilesystemPath('workspace/other/file.ts'))
      .toBe('workspace/other/file.ts');
  });

  test('should handle edge cases and malformed input gracefully', () => {
    expect(normalizeFilesystemPath('')).toBe('');
    expect(() => normalizeFilesystemPath(null as any)).toThrow();
    expect(() => normalizeFilesystemPath(undefined as any)).toThrow();
    expect(normalizeFilesystemPath('workspace/sessions/anon$006$extra/file.ts'))
      .toBe('workspace/sessions/006$extra/file.ts');
  });
});
