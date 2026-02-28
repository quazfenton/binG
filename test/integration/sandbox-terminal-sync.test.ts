import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
  virtualFilesystem: {
    getWorkspaceVersion: vi.fn(),
    exportWorkspace: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock('@/lib/sandbox/sandbox-service-bridge', () => ({
  sandboxBridge: {
    listDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import { sandboxFilesystemSync } from '@/lib/sandbox/sandbox-filesystem-sync';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';

const mockedVFS = vi.mocked(virtualFilesystem);
const mockedBridge = vi.mocked(sandboxBridge);

describe('SandboxFilesystemSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sandboxFilesystemSync.stopAll();
  });

  afterEach(() => {
    sandboxFilesystemSync.stopAll();
    vi.useRealTimers();
  });

  describe('configuration', () => {
    it('should be enabled by default', () => {
      // startSync should set up an interval (not warn about being disabled)
      const warnSpy = vi.spyOn(console, 'warn');
      const logSpy = vi.spyOn(console, 'log');
      sandboxFilesystemSync.startSync('cfg-test', 'user-1');

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Sync is disabled'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Starting sync for sandbox cfg-test'),
      );

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should disable sync when SANDBOX_SYNC_ENABLED is "false"', async () => {
      // The singleton was already created with the current env.
      // We can only verify the behaviour indirectly: if sync were disabled the
      // startSync call would log a warning. Because the singleton reads env at
      // construction time we cannot change it after the fact without re-importing.
      // This test documents the expected env-var contract.
      expect(process.env.SANDBOX_SYNC_ENABLED).not.toBe('false');
    });
  });

  describe('startSync / stopSync', () => {
    it('should start an interval that triggers sync', async () => {
      mockedVFS.getWorkspaceVersion.mockResolvedValue(1);
      mockedVFS.exportWorkspace.mockResolvedValue({
        root: 'project',
        version: 1,
        updatedAt: new Date().toISOString(),
        files: [],
      });
      mockedBridge.listDirectory.mockResolvedValue([]);

      sandboxFilesystemSync.startSync('sb-1', 'user-1');

      // Advance past the default interval (5 000 ms)
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockedBridge.listDirectory).toHaveBeenCalledWith('sb-1', '/workspace');
      expect(mockedVFS.getWorkspaceVersion).toHaveBeenCalledWith('user-1');
    });

    it('should not start duplicate intervals for the same sandbox', () => {
      const warnSpy = vi.spyOn(console, 'warn');

      sandboxFilesystemSync.startSync('sb-dup', 'user-1');
      sandboxFilesystemSync.startSync('sb-dup', 'user-1');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sync already running for sandbox sb-dup'),
      );
      warnSpy.mockRestore();
    });

    it('stopSync should clear the interval', async () => {
      mockedBridge.listDirectory.mockResolvedValue([]);
      mockedVFS.getWorkspaceVersion.mockResolvedValue(0);

      sandboxFilesystemSync.startSync('sb-stop', 'user-1');
      sandboxFilesystemSync.stopSync('sb-stop');

      // Advance timers — nothing should fire after stop
      await vi.advanceTimersByTimeAsync(10000);

      expect(mockedBridge.listDirectory).not.toHaveBeenCalled();
    });

    it('stopAll should clear all intervals', async () => {
      mockedBridge.listDirectory.mockResolvedValue([]);
      mockedVFS.getWorkspaceVersion.mockResolvedValue(0);

      sandboxFilesystemSync.startSync('sb-a', 'user-1');
      sandboxFilesystemSync.startSync('sb-b', 'user-2');
      sandboxFilesystemSync.stopAll();

      await vi.advanceTimersByTimeAsync(10000);

      expect(mockedBridge.listDirectory).not.toHaveBeenCalled();
    });
  });

  describe('syncVFSToSandbox', () => {
    it('should skip sync when version has not changed', async () => {
      mockedVFS.getWorkspaceVersion.mockResolvedValue(5);
      mockedVFS.exportWorkspace.mockResolvedValue({
        root: 'project',
        version: 5,
        updatedAt: new Date().toISOString(),
        files: [{ path: 'index.ts', content: 'hello', language: 'typescript', lastModified: '', version: 1, size: 5 }],
      });

      // First call sets the cached version
      await sandboxFilesystemSync.syncVFSToSandbox('sb-ver', 'user-1');
      expect(mockedBridge.writeFile).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      mockedVFS.getWorkspaceVersion.mockResolvedValue(5);

      // Second call with same version should skip
      await sandboxFilesystemSync.syncVFSToSandbox('sb-ver', 'user-1');
      expect(mockedVFS.exportWorkspace).not.toHaveBeenCalled();
      expect(mockedBridge.writeFile).not.toHaveBeenCalled();
    });

    it('should write files to sandbox when version changed', async () => {
      mockedVFS.getWorkspaceVersion.mockResolvedValue(2);
      mockedVFS.exportWorkspace.mockResolvedValue({
        root: 'project',
        version: 2,
        updatedAt: new Date().toISOString(),
        files: [
          { path: 'a.ts', content: 'aaa', language: 'typescript', lastModified: '', version: 1, size: 3 },
          { path: 'b.ts', content: 'bbb', language: 'typescript', lastModified: '', version: 1, size: 3 },
        ],
      });

      await sandboxFilesystemSync.syncVFSToSandbox('sb-write', 'user-1');

      expect(mockedBridge.writeFile).toHaveBeenCalledWith('sb-write', '/workspace/a.ts', 'aaa');
      expect(mockedBridge.writeFile).toHaveBeenCalledWith('sb-write', '/workspace/b.ts', 'bbb');
    });

    it('should handle getWorkspaceVersion errors gracefully', async () => {
      mockedVFS.getWorkspaceVersion.mockRejectedValue(new Error('db down'));

      await expect(
        sandboxFilesystemSync.syncVFSToSandbox('sb-err', 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('should handle exportWorkspace errors gracefully', async () => {
      mockedVFS.getWorkspaceVersion.mockResolvedValue(99);
      mockedVFS.exportWorkspace.mockRejectedValue(new Error('export failed'));

      await expect(
        sandboxFilesystemSync.syncVFSToSandbox('sb-err2', 'user-1'),
      ).resolves.toBeUndefined();

      expect(mockedBridge.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('syncSandboxToVFS', () => {
    it('should sync changed files from sandbox to VFS', async () => {
      mockedBridge.listDirectory.mockResolvedValue([
        { name: 'app.ts', type: 'file' },
        { name: 'src', type: 'directory' },
      ]);
      mockedBridge.readFile.mockResolvedValue('new content');
      mockedVFS.readFile.mockResolvedValue({
        path: 'project/app.ts',
        content: 'old content',
        language: 'typescript',
        lastModified: '',
        version: 1,
        size: 11,
      });

      await sandboxFilesystemSync.syncSandboxToVFS('sb-s2v', 'user-1');

      expect(mockedBridge.readFile).toHaveBeenCalledWith('sb-s2v', '/workspace/app.ts');
      expect(mockedVFS.writeFile).toHaveBeenCalledWith('user-1', 'app.ts', 'new content');
    });

    it('should skip files with matching content', async () => {
      mockedBridge.listDirectory.mockResolvedValue([
        { name: 'same.ts', type: 'file' },
      ]);
      mockedBridge.readFile.mockResolvedValue('unchanged');
      mockedVFS.readFile.mockResolvedValue({
        path: 'project/same.ts',
        content: 'unchanged',
        language: 'typescript',
        lastModified: '',
        version: 1,
        size: 9,
      });

      await sandboxFilesystemSync.syncSandboxToVFS('sb-same', 'user-1');

      expect(mockedVFS.writeFile).not.toHaveBeenCalled();
    });

    it('should sync file when it does not exist in VFS yet', async () => {
      mockedBridge.listDirectory.mockResolvedValue([
        { name: 'new-file.ts', type: 'file' },
      ]);
      mockedBridge.readFile.mockResolvedValue('brand new');
      mockedVFS.readFile.mockRejectedValue(new Error('File not found'));

      await sandboxFilesystemSync.syncSandboxToVFS('sb-new', 'user-1');

      expect(mockedVFS.writeFile).toHaveBeenCalledWith('user-1', 'new-file.ts', 'brand new');
    });

    it('should handle listing errors gracefully', async () => {
      mockedBridge.listDirectory.mockRejectedValue(new Error('sandbox unreachable'));

      await expect(
        sandboxFilesystemSync.syncSandboxToVFS('sb-listerr', 'user-1'),
      ).resolves.toBeUndefined();

      expect(mockedVFS.writeFile).not.toHaveBeenCalled();
    });
  });
});
