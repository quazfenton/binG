/**
 * Tests for empty-workspace handling in the VFS snapshot gateway.
 *
 * History:
 * - Bug #14 (audit): originally returned 202 + typed WORKSPACE_NOT_READY
 *   error for anonymous users with empty workspaces, so the LLM could
 *   distinguish "initializing" from "genuinely empty" instead of
 *   hallucinating over an empty file list.
 * - Bug #2 (VFS polling-storm fix): the WORKSPACE_NOT_READY 202 response
 *   was making the client poll forever (12 `POLLING DETECTED` warnings
 *   per snapshot window in run.log). Replaced the FALLBACK path with a
 *   terminal 200 carrying `cooldownExpired: true` so the client can stop
 *   polling. The 202 WORKSPACE_NOT_READY is now ONLY emitted by the
 *   cooldown-active path (Path A) — a real "init pending" signal.
 *
 * Three response shapes for anonymous owner + empty workspace:
 * - Path A (cooldown active): 202 + errorCode WORKSPACE_NOT_READY (transient)
 * - Path B (no init available / init failed): 200 + cooldownExpired: true (terminal)
 * - Path C (already initialized): 200 + success: true + files: [] (terminal)
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
import { GET, __setEagerInitCooldownForTest } from '../gateway';

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
    it('returns 200 + cooldownExpired: true for anonymous owner with empty workspace (Bug #2 fix)', async () => {
      // Path B: no ensureWorkspace available in the mocked virtualFilesystem
      // AND no DB rows for this owner, so the gateway falls through to the
      // terminal empty-snapshot path. The client should stop polling when
      // it sees `cooldownExpired: true`.
      mockResolveFilesystemOwner.mockResolvedValue({
        ownerId: 'anon-123',
        source: 'anonymous',
      });

      const response = await GET(makeRequest('workspace/sessions') as any);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      // Bug #2: terminal empty-state signal — lets the client distinguish
      // from the 202 WORKSPACE_NOT_READY response in Path A (cooldown-active).
      expect(body.cooldownExpired).toBe(true);
      expect(body.data.files).toEqual([]);
      expect(body.data.path).toBe('workspace/sessions');
    });

    it('returns 200 + success for cookie-based owner with empty workspace (only anonymous sources get the empty-workspace handling)', async () => {
      // For non-anonymous sources (cookie, jwt, session, etc.) with an
      // empty workspace, the gateway falls through to the normal success
      // response. The Bug #2 fix targets the anonymous polling storm
      // specifically; non-anonymous sources never went through
      // WORKSPACE_NOT_READY — this test pins that behavior down.
      mockResolveFilesystemOwner.mockResolvedValue({
        ownerId: 'cookie-456',
        source: 'cookie',
      });

      const response = await GET(makeRequest('workspace/sessions') as any);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.files).toEqual([]);
      // The cooldownExpired: true flag is only set for anonymous owners;
      // non-anonymous sources get the normal success path.
      expect(body.cooldownExpired).toBeUndefined();
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

    it('returns cooldownExpired: true as the terminal empty-state signal (replaces the old error message)', async () => {
      // Bug #2 fix: the response no longer carries an `error` field
      // (it's a success response), but it carries `cooldownExpired: true`
      // so the client can distinguish a terminal empty state from a
      // transient WORKSPACE_NOT_READY and stop polling.
      mockResolveFilesystemOwner.mockResolvedValue({
        ownerId: 'anon-msg',
        source: 'anonymous',
      });

      const response = await GET(makeRequest('workspace/sessions') as any);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.cooldownExpired).toBe(true);
      // The data field is always present, even for empty workspaces.
      expect(body.data).toBeDefined();
      expect(body.data.files).toEqual([]);
    });

    it('returns 202 + WORKSPACE_NOT_READY + exponential backoffHint when eager-init cooldown is active (Path A)', async () => {
      // Path A: pre-populate the cooldown Map for this ownerId so the
      // gateway returns the transient 202 instead of falling through to
      // Path B/C. The new exponential backoffHint replaces the old
      // fixed-5s hint so the client can switch from fixed polling to
      // the server-recommended exponential schedule. The cooldown is
      // seeded as if it started 1s ago so currentMs is ~4000ms.
      const ownerId = 'anon-cooldown-test';
      mockResolveFilesystemOwner.mockResolvedValue({
        ownerId,
        source: 'anonymous',
      });
      __setEagerInitCooldownForTest(ownerId, Date.now() - 1_000);

      const response = await GET(makeRequest('workspace/sessions') as any);
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.errorCode).toBe('WORKSPACE_NOT_READY');
      // Exponential backoff shape replaces the old { strategy: 'fixed', delayMs: 5000 }.
      expect(body.backoffHint).toMatchObject({
        strategy: 'exponential',
        baseMs: 1_000,
        maxMs: 30_000,
      });
      expect(typeof body.backoffHint.currentMs).toBe('number');
      // currentMs should be the remaining cooldown: ~4000 (within tolerance
      // for the few ms that elapsed since the test set the timestamp).
      expect(body.backoffHint.currentMs).toBeGreaterThan(3_500);
      expect(body.backoffHint.currentMs).toBeLessThanOrEqual(5_000);
    });
  });
});
