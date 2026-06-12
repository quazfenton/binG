/**
 * Bug #36 regression test — VFS Startup Fingerprint log.
 *
 * The fingerprint log lives in `virtual-filesystem-service.ts` at the
 * bottom of the file, right after the singleton export. It runs at
 * module load and emits `[VFS Startup Fingerprint]` with the proxy
 * class name and the method-presence flags.
 *
 * This test lives in its OWN file (not in `vfs-snapshot-fingerprint.test.ts`)
 * so the `vi.mock('@/lib/utils/logger')` doesn't contaminate the
 * method-presence tests in the other file (which use a plain import
 * to verify the runtime shape of the singleton).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures the mock factory runs BEFORE the module under
// test is imported, mirroring the production import order.
const mockInfo = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: mockInfo,
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Bug #36 — VFS Startup Fingerprint log', () => {
  beforeEach(() => {
    mockInfo.mockClear();
    mockWarn.mockClear();
    // Force a fresh module load BEFORE each test so the top-level
    // fingerprint block runs against the mocked logger.
    vi.resetModules();
  });

  it('emits a [VFS Startup Fingerprint] log call on module load with the expected shape', async () => {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/index.server');
    expect(virtualFilesystem).toBeDefined();

    // Find the fingerprint call (the module also emits other logs from
    // other top-level statements, so we filter for the bug #36 marker).
    const fpCall = mockInfo.mock.calls.find(
      (call) => call[0] === '[VFS Startup Fingerprint]'
    );
    expect(fpCall).toBeDefined();
    const payload = fpCall?.[1] ?? {};
    expect(payload).toMatchObject({
      buildArtifact: 'virtualFilesystemService',
      hasGetCurrentVersionSync: true,
      hasForOwner: true,
      hasUnderlying: true,
    });
    // Class name should be the proxy (GitBackedVFSProxy) since the
    // singleton wraps the underlying service.
    expect(typeof payload.proxyClass).toBe('string');
    expect(payload.pid).toBeTypeOf('number');
  });

  it('does NOT emit a MISSING warning when the method is present', async () => {
    await import('@/lib/virtual-filesystem/index.server');
    const missingWarn = mockWarn.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('getCurrentVersionSync is MISSING')
    );
    expect(missingWarn).toBeUndefined();
  });
});
