/**
 * Test for Bug #14 (audit) — VFS snapshot returns typed WORKSPACE_NOT_READY
 * error for anonymous users with empty workspaces, instead of an empty file
 * list that the LLM hallucinates over.
 *
 * Fix: when `files.length === 0 && snapshot.files.length === 0` AND the
 * owner is not authenticated, return HTTP 202 with `{ success: false,
 * errorCode: 'WORKSPACE_NOT_READY', retryable: true, … }`. The LLM can
 * match on `errorCode` to know to wait/retry instead of acting on a
 * stale empty list.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoisted mocks so they're in place before the module under test imports.
const {
  mockVirtualFilesystem,
  mockFsBridge,
  mockResolveFilesystemOwner,
  mockWithAnonSessionCookie,
  mockStripWorkspacePrefixes,
  mockIsDesktopMode,
  mockIsUsingLocalFS,
  mockCreateLogger,
} = vi.hoisted(() => {
  // virtualFilesystem.exportWorkspace is the data path the gateway calls.
  // Default to an empty workspace — the test override flips it per case.
  const mockVirtualFilesystem = {
    exportWorkspace: vi.fn().mockResolvedValue({
      root: '/',
      version: 1,
      updatedAt: new Date().toISOString(),
      files: [],
    }),
    onSnapshotChange: vi.fn(),
  };

  const mockFsBridge = {
    exportWorkspace: vi.fn(),
  };

  const mockResolveFilesystemOwner = vi.fn();
  const mockWithAnonSessionCookie = vi.fn((response: any) => response);
  const mockStripWorkspacePrefixes = vi.fn((p: string) => p);
  const mockIsDesktopMode = vi.fn().mockReturnValue(false);
  const mockIsUsingLocalFS = vi.fn().mockReturnValue(false);
  const mockCreateLogger = vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });

  return {
    mockVirtualFilesystem,
    mockFsBridge,
    mockResolveFilesystemOwner,
    mockWithAnonSessionCookie,
    mockStripWorkspacePrefixes,
    mockIsDesktopMode,
    mockIsUsingLocalFS,
    mockCreateLogger,
  };
});

vi.mock('@bing/platform/env', () => ({
  isDesktopMode: mockIsDesktopMode,
}));

vi.mock('@bing/shared/FS/fs-bridge', () => ({
  fsBridge: mockFsBridge,
  isUsingLocalFS: mockIsUsingLocalFS,
}));

vi.mock('@/lib/virtual-filesystem/scope-utils', () => ({
  stripWorkspacePrefixes: mockStripWorkspacePrefixes,
}));

vi.mock('@/lib/virtual-filesystem/index.server', () => ({
  virtualFilesystem: mockVirtualFilesystem,
  resolveFilesystemOwner: mockResolveFilesystemOwner,
  withAnonSessionCookie: mockWithAnonSessionCookie,
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: mockCreateLogger,
}));

// Import the handler AFTER the mocks are in place.
import { GET } from '../gateway';

function makeRequest(path: string = 'workspace'): Request {
  return new Request(`http://localhost/api/filesystem/snapshot?path=${encodeURIComponent(path)}`);
}

describe('GET /api/filesystem/snapshot — Bug #14 (empty workspace on anonymous)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset exportWorkspace to default (empty workspace).
    mockVirtualFilesystem.exportWorkspace.mockResolvedValue({
      root: '/',
      version: 1,
      updatedAt: new Date().toISOString(),
      files: [],
    });
    mockWithAnonSessionCookie.mockImplementation((response: any) => response);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('WORKSPACE_NOT_READY typed error (Bug #14)', () => {
    it('returns 202 + errorCode WORKSPACE_NOT_READY for anonymous owner with empty workspace', async () => {
      mockResolveFilesystemOwner.mockResolvedValue({
        ownerId: 'anon-123',
        source: 'anonymous',
      });

      const response = await GET(makeRequest('workspace/sessions') as any);
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.errorCode).toBe('WORKSPACE_NOT_READY');
      expect(body.retryable).toBe(true);
      expect(body.ownerId).toBe('anon-123');
      expect(body.source).toBe('anonymous');
    });

    it('returns 202 + WORKSPACE_NOT_READY for cookie-based owner with empty workspace', async () => {
      // Any non-'authenticated' source should trigger the typed error.
      mockResolveFilesystemOwner.mockResolvedValue({
        ownerId: 'cookie-456',
        source: 'cookie',
      });

      const response = await GET(makeRequest('workspace/sessions') as any);
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.errorCode).toBe('WORKSPACE_NOT_READY');
    });

    it('does NOT trigger WORKSPACE_NOT_READY for authenticated owner with empty workspace', async () => {
      // Authenticated users with an empty workspace get a normal
      // success: true response with files: [] — the empty workspace
      // is a legitimate state, not a "not ready" state.
      mockResolveFilesystemOwner.mockResolvedValue({
        ownerId: 'auth-789',
        source: 'authenticated',
      });

      const response = await GET(makeRequest('workspace/sessions') as any);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.files).toEqual([]);
    });

    it('does NOT trigger WORKSPACE_NOT_READY when workspace has files (even for anonymous)', async () => {
      // If the workspace actually has files, return them normally.
      mockResolveFilesystemOwner.mockResolvedValue({
        ownerId: 'anon-with-files',
        source: 'anonymous',
      });
      mockVirtualFilesystem.exportWorkspace.mockResolvedValue({
        root: '/',
        version: 2,
        updatedAt: new Date().toISOString(),
        files: [
          { path: 'workspace/sessions/000/index.html', content: '<html></html>', size: 13, lastModified: Date.now() },
        ],
      });

      const response = await GET(makeRequest('workspace/sessions') as any);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.files).toHaveLength(1);
    });

    it('returns the typed error with a human-readable message', async () => {
      mockResolveFilesystemOwner.mockResolvedValue({
        ownerId: 'anon-msg',
        source: 'anonymous',
      });

      const response = await GET(makeRequest('workspace/sessions') as any);
      const body = await response.json();
      // The LLM can show this message verbatim to the user.
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
      expect(body.error.toLowerCase()).toContain('workspace');
    });
  });
});
