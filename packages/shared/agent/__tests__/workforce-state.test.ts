/**
 * Workforce State Unit Tests
 *
 * Covers:
 * - loadState happy path (valid YAML with tasks array)
 * - loadState ENOENT fallback (file not found → initializes new state)
 * - loadState YAML parse error rethrow (malformed YAML → rethrows)
 * - loadState invalid content fallback (valid YAML but missing tasks array)
 * - saveState yaml.dump error propagation
 * - saveState writeFile error propagation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock setup
// ---------------------------------------------------------------------------
async function setupMocks() {
  vi.resetModules();

  const readFile = vi.fn();
  const writeFile = vi.fn().mockResolvedValue(undefined);

  vi.doMock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
    virtualFilesystem: { readFile, writeFile },
  }));
  vi.doMock('@/lib/virtual-filesystem/scope-utils', () => ({
    normalizeSessionId: vi.fn().mockReturnValue('001'),
  }));
  vi.doMock('@/lib/utils/logger', () => ({
    createLogger: vi.fn().mockReturnValue({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  }));

  const mod = await import('../workforce-state');
  return { loadState: mod.loadState, saveState: mod.saveState, vfs: { readFile, writeFile } };
}

describe('WorkforceState — loadState', () => {
  // -------------------------------------------------------------------------
  // Happy path — valid STATE.yaml exists and is parseable
  // -------------------------------------------------------------------------
  it('returns parsed state when STATE.yaml exists and is valid', async () => {
    const { loadState, vfs } = await setupMocks();

    vfs.readFile.mockResolvedValue({
      content: `version: 1\nupdatedAt: '2025-01-01T00:00:00.000Z'\ntasks:\n  - id: task-1\n    title: Test task\n    description: desc\n    agent: opencode\n    status: pending\n`,
    });

    const result = await loadState('user1', 'conversation1');

    expect(result.version).toBe(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('task-1');
  });

  // -------------------------------------------------------------------------
  // ENOENT fallback — file not found → creates DEFAULT_STATE
  // -------------------------------------------------------------------------
  it('initializes new state and saves DEFAULT_STATE when file does not exist (ENOENT)', async () => {
    const { loadState, vfs } = await setupMocks();

    const notFoundError = new Error('File not found') as any;
    notFoundError.code = 'ENOENT';
    vfs.readFile.mockRejectedValue(notFoundError);

    const result = await loadState('user1', 'conversation1');

    expect(result.version).toBe(1);
    expect(result.tasks).toEqual([]);
    expect(vfs.writeFile).toHaveBeenCalled();
  });

  it('initializes new state when error message contains \"not found\" (non-ENOENT path)', async () => {
    const { loadState, vfs } = await setupMocks();
    vfs.readFile.mockRejectedValue(new Error('stream蓋率葬 Error: file not found in storage'));

    const result = await loadState('user1', 'conversation1');

    expect(result.version).toBe(1);
    expect(result.tasks).toEqual([]);
  });

  it('initializes new state when error message contains \"ENOENT\"', async () => {
    const { loadState, vfs } = await setupMocks();
    vfs.readFile.mockRejectedValue(new Error('path validation failed: ENOENT'));

    const result = await loadState('user1', 'conversation1');

    expect(result.version).toBe(1);
    expect(result.tasks).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // YAML parse error rethrow — malformed YAML should propagate
  // -------------------------------------------------------------------------
  it('rethrows YAML parse errors (malformed YAML)', async () => {
    const { loadState, vfs } = await setupMocks();

    vfs.readFile.mockResolvedValue({ content: 'invalid: yaml: content: [\n' });

    await expect(loadState('user1', 'conversation1')).rejects.toThrow();
  });

  it('rethrows non-ENOENT errors from VFS (e.g. permission denied)', async () => {
    const { loadState, vfs } = await setupMocks();

    const permError = new Error('Permission denied') as any;
    permError.code = 'EACCES';
    vfs.readFile.mockRejectedValue(permError);

    await expect(loadState('user1', 'conversation1')).rejects.toThrow('Permission denied');
  });

  // -------------------------------------------------------------------------
  // Invalid content fallback — valid YAML but missing/invalid tasks array
  // -------------------------------------------------------------------------
  it('returns DEFAULT_STATE when parsed state has no tasks array', async () => {
    const { loadState, vfs } = await setupMocks();
    vfs.readFile.mockResolvedValue({ content: 'version: 1\nupdatedAt: now\ntasks: null' });

    const result = await loadState('user1', 'conversation1');

    expect(result.version).toBe(1);
    expect(Array.isArray(result.tasks)).toBe(true);
    expect(result.tasks).toEqual([]);
  });
});

describe('WorkforceState — saveState', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rethrows yaml.dump serialization errors with context', async () => {
    // Mock yaml.dump to throw
    vi.doMock('js-yaml', () => ({
      default: {
        load: vi.fn(),
        dump: vi.fn().mockImplementation(() => {
          throw new Error('circular reference');
        }),
      },
    }));

    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
      virtualFilesystem: { readFile: vi.fn(), writeFile },
    }));
    vi.doMock('@/lib/virtual-filesystem/scope-utils', () => ({
      normalizeSessionId: vi.fn().mockReturnValue('001'),
    }));
    vi.doMock('@/lib/utils/logger', () => ({
      createLogger: vi.fn().mockReturnValue({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() }),
    }));

    const { saveState } = await import('../workforce-state');

    await expect(saveState('user1', 'conversation1', { version: 1, updatedAt: '', tasks: [] }))
      .rejects.toThrow('Failed to serialize state: circular reference');
  });

  it('rethrows writeFile I/O errors with original error message', async () => {
    vi.doMock('js-yaml', () => ({
      default: {
        load: vi.fn(),
        dump: vi.fn().mockReturnValue('version: 1\ntasks: []'),
      },
    }));

    const writeFile = vi.fn().mockRejectedValue(new Error('disk full'));
    vi.doMock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
      virtualFilesystem: { readFile: vi.fn(), writeFile },
    }));
    vi.doMock('@/lib/virtual-filesystem/scope-utils', () => ({
      normalizeSessionId: vi.fn().mockReturnValue('001'),
    }));
    vi.doMock('@/lib/utils/logger', () => ({
      createLogger: vi.fn().mockReturnValue({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() }),
    }));

    const { saveState } = await import('../workforce-state');

    // The original error is rethrown as-is (throw err at line 88)
    await expect(saveState('user1', 'conversation1', { version: 1, updatedAt: '', tasks: [] }))
      .rejects.toThrow('disk full');
  });
});