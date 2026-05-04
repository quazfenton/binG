import { normalizeFilesystemPath } from '../app/api/filesystem/utils';

describe('normalizeFilesystemPath', () => {
  test('should normalize composite session IDs correctly', () => {
    expect(normalizeFilesystemPath('project/sessions/anon$006/src/file.ts'))
      .toBe('project/sessions/006/src/file.ts');
    expect(normalizeFilesystemPath('project/sessions/1$006/file.txt'))
      .toBe('project/sessions/006/file.txt');
    expect(normalizeFilesystemPath('project/sessions/user:006/config.json'))
      .toBe('project/sessions/006/config.json');
  });

  test('should leave simple session IDs untouched', () => {
    expect(normalizeFilesystemPath('project/sessions/006/file.ts'))
      .toBe('project/sessions/006/file.ts');
  });

  test('should ignore non-session paths', () => {
    expect(normalizeFilesystemPath('src/file.ts'))
      .toBe('src/file.ts');
    expect(normalizeFilesystemPath('project/other/file.ts'))
      .toBe('project/other/file.ts');
  });
});
