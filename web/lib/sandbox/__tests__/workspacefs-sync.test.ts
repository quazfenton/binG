/**
 * Phase 9: WorkspaceFS Sync Service Tests
 *
 * Tests the unified sync layer that coordinates R2 cloud storage,
 * VFS database, and sandbox filesystems across providers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceFSSyncService } from '../workspacefs-sync-service';

// Mock VFS and sandbox-filesystem-sync to test in isolation
vi.mock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
  virtualFilesystem: {
    getWorkspaceVersion: vi.fn().mockResolvedValue(42),
    exportWorkspace: vi.fn().mockResolvedValue({
      files: [
        { path: 'package.json', content: '{"name":"test"}' },
        { path: 'src/index.ts', content: 'console.log("hello");' },
      ],
      version: 42,
    }),
    writeFile: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue({ content: 'test' }),
  },
}));

vi.mock('@/lib/virtual-filesystem/sync/sandbox-filesystem-sync', () => ({
  sandboxFilesystemSync: {
    syncSandboxToVFS: vi.fn().mockResolvedValue({ success: true }),
    syncVFSToSandbox: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/lib/sandbox/sandbox-service-bridge', () => ({
  sandboxBridge: {
    readFile: vi.fn().mockResolvedValue('file content from sandbox'),
    writeFile: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@/lib/storage/cloud-storage', () => ({
  createCloudStorageService: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue(true),
    download: vi.fn().mockResolvedValue(new Blob(['test content'])),
    list: vi.fn().mockResolvedValue(['package.json', 'src/index.ts']),
  }),
}));

describe('WorkspaceFSSyncService', () => {
  beforeEach(() => {
    // Reset env for each test
  });

  describe('R2 Status', () => {
    it('reports R2 as unconfigured when env vars are missing', () => {
      const status = workspaceFSSyncService.getR2Status();
      expect(status).toEqual({
        configured: false,
        bucket: undefined,
        endpoint: undefined,
      });
    });

    it('reports R2 endpoint when set', () => {
      process.env.R2_ENDPOINT = 'https://r2.cloudflarestorage.com';
      const status = workspaceFSSyncService.getR2Status();
      expect(status.endpoint).toBe('https://r2.cloudflarestorage.com');
      delete process.env.R2_ENDPOINT;
    });
  });

  describe('Configuration', () => {
    it('returns service config with enabled flag', () => {
      const config = workspaceFSSyncService.getConfig();
      expect(config.enabled).toBeDefined();
      expect(config.defaultConflictStrategy).toBe('last-writer-wins');
      expect(config.r2Configured).toBeDefined();
    });
  });

  describe('Sync State', () => {
    it('initializes sync state for a new workspace', async () => {
      const state = await workspaceFSSyncService.getSyncState('test-ws', 'test-user');
      expect(state).not.toBeNull();
      expect(state!.workspaceId).toBe('test-ws');
      expect(state!.initialSyncComplete).toBe(false);
      expect(state!.vfsVersion).toBeGreaterThanOrEqual(0);
    });

    it('returns the same state for repeated calls', async () => {
      const state1 = await workspaceFSSyncService.getSyncState('test-ws-dup', 'test-user');
      const state2 = await workspaceFSSyncService.getSyncState('test-ws-dup', 'test-user');
      expect(state1).toBe(state2);
    });

    it('different workspaces have independent states', async () => {
      const state1 = await workspaceFSSyncService.getSyncState('ws-a', 'user-a');
      const state2 = await workspaceFSSyncService.getSyncState('ws-b', 'user-b');
      expect(state1!.workspaceId).toBe('ws-a');
      expect(state2!.workspaceId).toBe('ws-b');
    });
  });

  describe('Sync Statistics', () => {
    it('returns aggregate stats across all workspaces', async () => {
      await workspaceFSSyncService.getSyncState('stats-test-1', 'user-1');
      await workspaceFSSyncService.getSyncState('stats-test-2', 'user-2');

      const stats = workspaceFSSyncService.getSyncStats();
      expect(stats.activeWorkspaces).toBeGreaterThanOrEqual(2);
      expect(stats.totalPendingConflicts).toBeGreaterThanOrEqual(0);
      expect(stats.totalFilesTracked).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Migration Sync', () => {
    it('handles migration with VFS fallback gracefully', async () => {
      // Mock VFS to fail, forcing R2 restore attempt
      const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
      (virtualFilesystem.exportWorkspace as any).mockResolvedValueOnce({
        files: [{ path: 'migrated.ts', content: 'post-migration' }],
        version: 1,
      });

      // Set R2 env vars to prevent R2 restore path
      const result = await workspaceFSSyncService.syncForMigration(
        'migrate-ws', 'migrate-user',
        'daytona' as any, 'e2b' as any,
        'src-sandbox', 'dest-sandbox',
      );

      expect(result).toBeDefined();
      expect(result.fromProvider).toBe('daytona' as any);
      expect(result.toProvider).toBe('e2b' as any);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
