/**
 * Regression tests for the session id loss rename guard.
 *
 * Bug #26: A rename that replaces the session id segment under
 * `workspace/sessions/` with a non-session-id value (e.g. a project
 * name like `ai_terminal`) was previously accepted. The session
 * boundary was silently broken — every subsequent tool call scoped
 * to `workspace/sessions/<id>` would fail to find the session files,
 * and a stray project folder would replace the real session.
 *
 * The fix adds `wouldLoseSessionId` and a guard in `safeRename` that
 * rejects such renames, logs `[CRITICAL]`, and invalidates the
 * cached scopePath.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks must be declared before the module under test is imported.
const { virtualFilesystemMock, cacheMock, loggerMock } = vi.hoisted(() => ({
  virtualFilesystemMock: {
    readFile: vi.fn(),
    listDirectory: vi.fn(),
    writeFile: vi.fn(),
    deletePath: vi.fn(),
    getWorkspaceVersion: vi.fn(),
  },
  cacheMock: {
    delete: vi.fn(),
    keys: vi.fn(() => [] as string[]),
  },
  loggerMock: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../virtual-filesystem-service', () => ({
  virtualFilesystem: virtualFilesystemMock,
}));

vi.mock('../sync/sync-events', () => ({
  emitFilesystemUpdated: vi.fn(),
}));

vi.mock('@/lib/utils/cache', () => ({
  toolResultCache: cacheMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => loggerMock,
}));

import {
  safeRename,
  checkRenameConflicts,
  validateRenamePath,
  wouldLoseSessionId,
} from '../rename-utils';
import { wouldLoseSessionId as wouldLoseSessionIdFromScopeUtils } from '../scope-utils';

// Helper: configure readFile to succeed only for the source path and reject
// for the destination (so conflict detection falls through to "no conflict").
function mockSourceFileExists(
  sourcePath: string,
  content = 'export const x = 1;',
) {
  virtualFilesystemMock.readFile.mockImplementation(async (_owner: string, filePath: string) => {
    if (filePath === sourcePath) {
      return {
        path: filePath,
        content,
        size: content.length,
        version: 1,
        lastModified: new Date().toISOString(),
      };
    }
    // Destination does not exist → conflict check falls through to listDirectory.
    throw new Error(`File not found: ${filePath}`);
  });
  virtualFilesystemMock.listDirectory.mockImplementation(async () => {
    throw new Error('directory does not exist');
  });
  virtualFilesystemMock.writeFile.mockResolvedValue({} as any);
  virtualFilesystemMock.deletePath.mockResolvedValue({ deletedCount: 1 });
  virtualFilesystemMock.getWorkspaceVersion.mockResolvedValue(7);
}

// Reset between tests so mock call counts don't leak.
beforeEach(() => {
  vi.clearAllMocks();
  cacheMock.keys.mockReturnValue([]);
});

describe('wouldLoseSessionId (pure helper)', () => {
  it('returns the session id when source session is replaced with a project name', () => {
    expect(
      wouldLoseSessionId(
        'workspace/sessions/001',
        'workspace/sessions/ai_terminal',
      ),
    ).toBe('001');
  });

  it('returns the session id for a nested rename that drops the session prefix', () => {
    expect(
      wouldLoseSessionId(
        'workspace/sessions/alpha-1/src',
        'workspace/sessions/portfolio-app/src',
      ),
    ).toBe('alpha-1');
  });

  it('returns null for a no-op rename (same id)', () => {
    expect(
      wouldLoseSessionId(
        'workspace/sessions/001/src',
        'workspace/sessions/001/lib',
      ),
    ).toBeNull();
  });

  it('returns null for a cross-session move (both ids are valid)', () => {
    expect(
      wouldLoseSessionId(
        'workspace/sessions/001/src',
        'workspace/sessions/002/src',
      ),
    ).toBeNull();
  });

  it('returns null for renames outside workspace/sessions/', () => {
    expect(
      wouldLoseSessionId(
        'workspace/shared/001',
        'workspace/shared/ai_terminal',
      ),
    ).toBeNull();
  });

  it('tolerates trailing slashes and backslashes', () => {
    expect(
      wouldLoseSessionId(
        'workspace\\sessions\\001/',
        'workspace/sessions/ai_terminal',
      ),
    ).toBe('001');
  });

  it('tolerates a leading slash on either side', () => {
    expect(
      wouldLoseSessionId(
        '/workspace/sessions/001',
        '/workspace/sessions/ai_terminal',
      ),
    ).toBe('001');
  });

  it('does not flag renames where the dest is also a valid session id', () => {
    expect(
      wouldLoseSessionId(
        'workspace/sessions/001',
        'workspace/sessions/002',
      ),
    ).toBeNull();
  });

  it('re-exports identically from scope-utils (single source of truth)', () => {
    expect(wouldLoseSessionId).toBe(wouldLoseSessionIdFromScopeUtils);
  });

  it('returns null for empty or non-string input', () => {
    expect(wouldLoseSessionId('', 'workspace/sessions/foo')).toBeNull();
    expect(wouldLoseSessionId('workspace/sessions/001', '')).toBeNull();
    expect(wouldLoseSessionId(null as any, 'workspace/sessions/foo')).toBeNull();
  });
});

describe('safeRename — session id loss guard (#26)', () => {
  it('rejects a rename that drops the session id segment and emits [CRITICAL]', async () => {
    const result = await safeRename({
      ownerId: 'anon:test',
      sourcePath: 'workspace/sessions/001',
      destinationPath: 'workspace/sessions/ai_terminal',
      sessionId: '001',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/would lose session id/i);
    expect(result.error).toMatch(/001/);

    // [CRITICAL] log must be emitted via logger.error.
    expect(loggerMock.error).toHaveBeenCalled();
    const criticalCall = loggerMock.error.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('[CRITICAL]'),
    );
    expect(criticalCall, 'expected a [CRITICAL] log line').toBeTruthy();
    const data = criticalCall?.[1] as { lostSessionId?: string; sourcePath?: string; destinationPath?: string };
    expect(data?.lostSessionId).toBe('001');
    expect(data?.sourcePath).toBe('workspace/sessions/001');
    expect(data?.destinationPath).toBe('workspace/sessions/ai_terminal');

    // No filesystem mutation may have happened.
    expect(virtualFilesystemMock.writeFile).not.toHaveBeenCalled();
    expect(virtualFilesystemMock.deletePath).not.toHaveBeenCalled();
  });

  it('invalidates the cached scopePath so the next read does not see stale data', async () => {
    cacheMock.keys.mockReturnValue([
      'anon:test:workspace/sessions/001',
      'search:anon:test:foo:workspace/sessions/001',
      'other-owner:workspace/sessions/001', // must not be touched
    ]);

    await safeRename({
      ownerId: 'anon:test',
      sourcePath: 'workspace/sessions/001',
      destinationPath: 'workspace/sessions/ai_terminal',
      sessionId: '001',
      scopePath: 'workspace/sessions/001',
    });

    // The scopePath cache entry for the affected owner must be deleted.
    expect(cacheMock.delete).toHaveBeenCalledWith('anon:test:workspace/sessions/001');

    // Search cache entries for the same owner must be cleared.
    expect(cacheMock.delete).toHaveBeenCalledWith('search:anon:test:foo:workspace/sessions/001');

    // Other owners' entries must remain untouched.
    const deletedKeys = cacheMock.delete.mock.calls.map((c) => c[0]);
    expect(deletedKeys).not.toContain('other-owner:workspace/sessions/001');
  });

  it('still allows a normal within-session rename', async () => {
    mockSourceFileExists('workspace/sessions/001/src/app.ts');

    const result = await safeRename({
      ownerId: 'anon:test',
      sourcePath: 'workspace/sessions/001/src/app.ts',
      destinationPath: 'workspace/sessions/001/lib/app.ts',
      sessionId: '001',
    });

    expect(result.success).toBe(true);
    expect(result.sourcePath).toBe('workspace/sessions/001/src/app.ts');
    expect(result.destinationPath).toBe('workspace/sessions/001/lib/app.ts');
    // The guard must NOT have logged [CRITICAL] for legitimate renames.
    const criticalCall = loggerMock.error.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('[CRITICAL]'),
    );
    expect(criticalCall).toBeUndefined();
  });

  it('still allows a cross-session move (both sides are valid session ids)', async () => {
    mockSourceFileExists('workspace/sessions/001/file.txt', 'hello');

    const result = await safeRename({
      ownerId: 'anon:test',
      sourcePath: 'workspace/sessions/001/file.txt',
      destinationPath: 'workspace/sessions/002/file.txt',
      sessionId: '001',
    });

    expect(result.success).toBe(true);
    // No [CRITICAL] log for legitimate cross-session renames.
    const criticalCall = loggerMock.error.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('[CRITICAL]'),
    );
    expect(criticalCall).toBeUndefined();
  });

  it('treats a no-op rename (source == dest) as success and never fires the guard', async () => {
    const result = await safeRename({
      ownerId: 'anon:test',
      sourcePath: 'workspace/sessions/001/src',
      destinationPath: 'workspace/sessions/001/src',
    });

    expect(result.success).toBe(true);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });
});

describe('checkRenameConflicts — session id loss is NOT a conflict (guard handles it separately)', () => {
  it('does not throw or report a conflict for the lossy rename — it is rejected upstream by safeRename', async () => {
    // The destination does not exist yet, so conflict detection should pass
    // and the upstream guard in safeRename is responsible for rejecting it.
    virtualFilesystemMock.readFile.mockRejectedValue(new Error('not found'));
    virtualFilesystemMock.listDirectory.mockRejectedValue(new Error('not found'));

    const result = await checkRenameConflicts(
      'anon:test',
      'workspace/sessions/001',
      'workspace/sessions/ai_terminal',
    );

    expect(result.hasConflict).toBe(false);
    expect(result.canProceed).toBe(true);
  });
});

describe('validateRenamePath — unchanged (regression: existing validations must still work)', () => {
  it('rejects path traversal', () => {
    const result = validateRenamePath('workspace/sessions/001/../etc/passwd');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/traversal/i);
  });

  it('accepts a normal session-scoped path', () => {
    const result = validateRenamePath('workspace/sessions/001/src/app.ts');
    expect(result.valid).toBe(true);
  });
});
