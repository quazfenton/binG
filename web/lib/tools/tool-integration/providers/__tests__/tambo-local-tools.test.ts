/**
 * Unit Tests for tamboLocalTools — readFile / strReplace validation
 *
 * Run: npx vitest run web/lib/tools/tool-integration/providers/__tests__/tambo-local-tools.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the virtual filesystem before importing the module under test
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockListDirectory = vi.fn();
const mockDeletePath = vi.fn();
const mockSearch = vi.fn();

vi.mock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
  virtualFilesystem: {
    readFile: (...args: any[]) => mockReadFile(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
    listDirectory: (...args: any[]) => mockListDirectory(...args),
    deletePath: (...args: any[]) => mockDeletePath(...args),
    search: (...args: any[]) => mockSearch(...args),
  },
}));

// Mock crypto.randomUUID for getSecureOwner
// Use standalone stub without spread to avoid ReferenceError when crypto isn't globally available
vi.stubGlobal('crypto', { randomUUID: () => 'mock-uuid-1234-5678' });

import { tamboLocalTools } from '../tambo-local-tools';

describe('tamboLocalTools - readFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw on empty path', async () => {
    await expect(tamboLocalTools.readFile({ path: '' }))
      .rejects.toThrow('path is required');
  });

  it('should throw on null path', async () => {
    await expect(tamboLocalTools.readFile({ path: null as any }))
      .rejects.toThrow('path is required');
  });

  it('should reject non-string path', async () => {
    await expect(tamboLocalTools.readFile({ path: 123 as any }))
      .rejects.toThrow('path is required');
  });

  it('should throw on missing path', async () => {
    await expect(tamboLocalTools.readFile({} as any))
      .rejects.toThrow('path is required');
  });

  it('should read full file when no line range is specified', async () => {
    mockReadFile.mockResolvedValue({
      path: '/test/file.ts',
      content: 'line 1\nline 2\nline 3\nline 4\nline 5',
      language: 'typescript',
      version: 1,
    });

    const result = await tamboLocalTools.readFile({ path: 'file.ts' });

    expect(result.content).toBe('line 1\nline 2\nline 3\nline 4\nline 5');
    expect(result.totalLines).toBeUndefined();
    expect(result.lineRangeRequested).toBeUndefined();
  });

  it('should slice file content when startLine is specified', async () => {
    mockReadFile.mockResolvedValue({
      path: '/test/file.ts',
      content: 'line 1\nline 2\nline 3\nline 4\nline 5',
      language: 'typescript',
      version: 1,
    });

    const result = await tamboLocalTools.readFile({ path: 'file.ts', startLine: 2 });

    expect(result.content).toBe('line 2\nline 3\nline 4\nline 5');
    expect(result.totalLines).toBe(5);
    expect(result.lineRangeRequested).toBe(true);
  });

  it('should slice file content when startLine and endLine are specified', async () => {
    mockReadFile.mockResolvedValue({
      path: '/test/file.ts',
      content: 'line 1\nline 2\nline 3\nline 4\nline 5',
      language: 'typescript',
      version: 1,
    });

    const result = await tamboLocalTools.readFile({ path: 'file.ts', startLine: 2, endLine: 4 });

    expect(result.content).toBe('line 2\nline 3\nline 4');
    expect(result.totalLines).toBe(5);
    expect(result.lineRangeRequested).toBe(true);
  });

  it('should handle startLine=1 (inclusive first line)', async () => {
    mockReadFile.mockResolvedValue({
      path: '/test/file.ts',
      content: 'line 1\nline 2\nline 3',
      language: 'typescript',
      version: 1,
    });

    const result = await tamboLocalTools.readFile({ path: 'file.ts', startLine: 1, endLine: 1 });

    expect(result.content).toBe('line 1');
    expect(result.totalLines).toBe(3);
  });

  it('should handle endLine only (read from start to endLine)', async () => {
    mockReadFile.mockResolvedValue({
      path: '/test/file.ts',
      content: 'line 1\nline 2\nline 3\nline 4',
      language: 'typescript',
      version: 1,
    });

    const result = await tamboLocalTools.readFile({ path: 'file.ts', endLine: 2 });

    expect(result.content).toBe('line 1\nline 2');
    expect(result.totalLines).toBe(4);
  });
});

describe('tamboLocalTools - strReplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw on empty path', async () => {
    await expect(tamboLocalTools.strReplace({
      path: '',
      oldString: 'hello',
      newString: 'world',
    })).rejects.toThrow('path is required');
  });

  it('should throw on null path', async () => {
    await expect(tamboLocalTools.strReplace({
      path: null as any,
      oldString: 'hello',
      newString: 'world',
    })).rejects.toThrow('path is required');
  });

  it('should throw when oldString is missing', async () => {
    await expect(tamboLocalTools.strReplace({
      path: 'file.ts',
      oldString: undefined as any,
      newString: 'world',
    })).rejects.toThrow('oldString is required');
  });

  it('should throw when oldString is null', async () => {
    await expect(tamboLocalTools.strReplace({
      path: 'file.ts',
      oldString: null as any,
      newString: 'world',
    })).rejects.toThrow('oldString is required');
  });

  it('should allow empty string oldString (deletion)', async () => {
    mockReadFile.mockResolvedValue({
      path: '/test/file.ts',
      content: 'hello world',
      language: 'typescript',
    });
    // Empty oldString with non-empty content means 0 occurrences found
    // The split('') creates an array of characters, so occurrences = content.length - 1 > 1
    // This is an edge case — we just verify it doesn't throw on validation

    const result = await tamboLocalTools.strReplace({
      path: 'file.ts',
      oldString: '',
      newString: 'replaced',
    });

    // With empty oldString, content.split('') produces ['h','e','l','l','o',' ','w','o','r','l','d']
    // occurrences = 10, allowMultiple defaults to false → error
    expect(result.success).toBe(false);
    expect(result.replacements).toBe(0);
  });

  it('should replace a single occurrence', async () => {
    mockReadFile.mockResolvedValue({
      path: '/test/file.ts',
      content: 'hello world',
      language: 'typescript',
    });
    mockWriteFile.mockResolvedValue({
      path: '/test/file.ts',
      size: 20,
      version: 1,
      language: 'typescript',
    });

    const result = await tamboLocalTools.strReplace({
      path: 'file.ts',
      oldString: 'world',
      newString: 'everyone',
    });

    expect(result.success).toBe(true);
    expect(result.replacements).toBe(1);
    expect(result.content).toBe('hello everyone');
  });

  it('should reject non-unique match when allowMultiple is false', async () => {
    mockReadFile.mockResolvedValue({
      path: '/test/file.ts',
      content: 'hello hello hello',
      language: 'typescript',
    });

    const result = await tamboLocalTools.strReplace({
      path: 'file.ts',
      oldString: 'hello',
      newString: 'hi',
    });

    expect(result.success).toBe(false);
    expect(result.replacements).toBe(0);
    expect(result.error).toContain('Found 3 occurrences');
  });

  it('should replace all occurrences when allowMultiple is true', async () => {
    mockReadFile.mockResolvedValue({
      path: '/test/file.ts',
      content: 'hello hello hello',
      language: 'typescript',
    });
    mockWriteFile.mockResolvedValue({
      path: '/test/file.ts',
      size: 30,
      version: 1,
      language: 'typescript',
    });

    const result = await tamboLocalTools.strReplace({
      path: 'file.ts',
      oldString: 'hello',
      newString: 'hi',
      allowMultiple: true,
    });

    expect(result.success).toBe(true);
    expect(result.replacements).toBe(3);
    expect(result.content).toBe('hi hi hi');
  });

  it('should report error when string is not found', async () => {
    mockReadFile.mockResolvedValue({
      path: '/test/file.ts',
      content: 'hello world',
      language: 'typescript',
    });

    const result = await tamboLocalTools.strReplace({
      path: 'file.ts',
      oldString: 'nonexistent',
      newString: 'replacement',
    });

    expect(result.success).toBe(false);
    expect(result.replacements).toBe(0);
    expect(result.error).toContain('String not found');
  });
});
