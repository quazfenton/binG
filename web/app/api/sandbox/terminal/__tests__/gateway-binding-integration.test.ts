/**
 * Phase 1 wiring test — verify the gateway.ts hooks actually call the
 * RedisSandboxBindingService. The unit tests in
 * `lib/redis/__tests__/sandbox-binding-service.test.ts` cover the
 * service behavior in isolation; this test ensures the route integration
 * is intact (e.g., a future refactor that removes the helper call would
 * fail this test).
 */

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE imports so vi.mock hoisting replaces the modules.
// ---------------------------------------------------------------------------

const { upsertBindingSpy, deleteBindingSpy, getBindingSpy } = vi.hoisted(() => ({
  upsertBindingSpy: vi.fn().mockResolvedValue(undefined),
  deleteBindingSpy: vi.fn().mockResolvedValue(undefined),
  getBindingSpy: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/redis/sandbox-binding-service', () => ({
  getSandboxBindingService: vi.fn(() => ({
    isAvailable: vi.fn(() => true),
    upsertBinding: upsertBindingSpy,
    getBinding: getBindingSpy,
    deleteBinding: deleteBindingSpy,
  })),
}));

vi.mock('@/lib/sandbox/sandbox-service-bridge', () => ({
  sandboxBridge: {
    getSessionByUserId: vi.fn(),
    getOrCreateSession: vi.fn(),
    inferProviderFromSandboxId: vi.fn(() => 'daytona'),
    getProvider: vi.fn(),
    deleteSession: vi.fn(),
  },
}));

vi.mock('@/lib/terminal/terminal-manager', () => ({
  terminalManager: {
    killTerminal: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/auth/request-auth', () => ({
  resolveRequestAuth: vi.fn(),
}));

vi.mock('@/lib/utils/rate-limiter', () => ({
  sandboxCreationRateLimiter: { check: vi.fn(() => ({ allowed: true })) },
}));

// ---------------------------------------------------------------------------
// Imports (must come AFTER vi.mock calls so the mocks are in place).
// ---------------------------------------------------------------------------

import { POST, DELETE } from '../gateway';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { terminalManager } from '@/lib/terminal/terminal-manager';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

function makePostRequest(): Request {
  return new Request('http://localhost/api/sandbox/terminal', { method: 'POST' });
}

function makeDeleteRequest(sessionId: string): Request {
  return new Request('http://localhost/api/sandbox/terminal', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
}

// ---------------------------------------------------------------------------

describe('gateway.ts + RedisSandboxBindingService wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset spam-suppression tracker per test for deterministic isolation.
    delete (globalThis as any).__bindingCacheMissLastWarnAt__;
    // Default: no existing binding — forces the cache-miss path so the
    // existing-session test reliably exercises upsertBinding. Tests that
    // need a cache hit pre-seed getBindingSpy in their own setup.
    getBindingSpy.mockResolvedValue(null);
    vi.mocked(resolveRequestAuth).mockResolvedValue({
      success: true,
      userId: 'user-1',
      source: 'jwt',
    } as any);
  });

  // -------------------------------------------------------------------------
  describe('POST — existing-session verify path', () => {
    it('calls upsertBinding on cache miss', async () => {
      vi.mocked(sandboxBridge.getSessionByUserId).mockReturnValue({
        sessionId: 'sess-existing',
        sandboxId: 'sbx-existing',
      } as any);
      vi.mocked(sandboxBridge.getProvider).mockResolvedValue({
        getSandbox: vi.fn().mockResolvedValue({}),
      } as any);
      getBindingSpy.mockResolvedValueOnce(null);

      const res = await POST(makePostRequest() as any);
      expect(res.status).toBe(200);
      expect(getBindingSpy).toHaveBeenCalledWith('sess-existing');
      expect(upsertBindingSpy).toHaveBeenCalledTimes(1);

      const arg = upsertBindingSpy.mock.calls[0][0];
      expect(arg.sessionId).toBe('sess-existing');
      expect(arg.userId).toBe('user-1');
      expect(arg.sandboxId).toBe('sbx-existing');
      expect(arg.provider).toBe('daytona');
      expect(arg.status).toBe('active');
      expect(arg.wsUrl).toBe('/api/sandbox/terminal/stream?sessionId=sess-existing');
      expect(arg.expiresAt).toBeGreaterThan(arg.createdAt);
    });

    it('SKIPS upsertBinding on cache hit (steady-state optimization)', async () => {
      vi.mocked(sandboxBridge.getSessionByUserId).mockReturnValue({
        sessionId: 'sess-cached',
        sandboxId: 'sbx-cached',
      } as any);
      vi.mocked(sandboxBridge.getProvider).mockResolvedValue({
        getSandbox: vi.fn().mockResolvedValue({}),
      } as any);
      // Cache hit — getBinding returns a populated binding.
      getBindingSpy.mockResolvedValueOnce({
        sessionId: 'sess-cached',
        userId: 'user-1',
        sandboxId: 'sbx-cached',
        wsUrl: '/already/there',
        provider: 'daytona',
        createdAt: 1,
        expiresAt: 2,
        status: 'active',
      });

      const res = await POST(makePostRequest() as any);
      expect(res.status).toBe(200);
      expect(getBindingSpy).toHaveBeenCalledWith('sess-cached');
      // Critical: zero writes in the cache-hit path.
      expect(upsertBindingSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('POST — fresh-create path', () => {
    it('calls upsertBinding after getOrCreateSession', async () => {
      vi.mocked(sandboxBridge.getSessionByUserId).mockReturnValue(null);
      vi.mocked(sandboxBridge.getOrCreateSession).mockResolvedValue({
        sessionId: 'sess-new',
        sandboxId: 'sbx-new',
      } as any);

      const res = await POST(makePostRequest() as any);
      expect(res.status).toBe(201);
      expect(upsertBindingSpy).toHaveBeenCalledTimes(1);

      const arg = upsertBindingSpy.mock.calls[0][0];
      expect(arg.sessionId).toBe('sess-new');
      expect(arg.userId).toBe('user-1');
      expect(arg.sandboxId).toBe('sbx-new');
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE', () => {
    it('calls deleteBinding after killTerminal succeeds', async () => {
      vi.mocked(sandboxBridge.getSessionByUserId).mockReturnValue({
        sessionId: 'sess-del',
        sandboxId: 'sbx-del',
      } as any);
      vi.mocked(terminalManager.killTerminal).mockResolvedValue(undefined);

      const res = await DELETE(makeDeleteRequest('sess-del') as any);
      expect(res.status).toBe(200);
      expect(terminalManager.killTerminal).toHaveBeenCalledWith('sess-del');
      expect(deleteBindingSpy).toHaveBeenCalledWith('sess-del', 'user-1');
    });
  });

  // -------------------------------------------------------------------------
  describe('cache-miss spam-suppression (SHOULD-CONSIDER from code review)', () => {
    it('first miss in a 60s window passes the warn-emit gate', async () => {
      // Reset spam-suppression state for deterministic test isolation.
      delete (globalThis as any).__bindingCacheMissLastWarnAt__;
      vi.mocked(sandboxBridge.getSessionByUserId).mockReturnValue({
        sessionId: 'sess-spam-1',
        sandboxId: 'sbx-spam-1',
      } as any);
      vi.mocked(sandboxBridge.getProvider).mockResolvedValue({
        getSandbox: vi.fn().mockResolvedValue({}),
      } as any);
      getBindingSpy.mockResolvedValueOnce(null);

      expect((globalThis as any).__bindingCacheMissLastWarnAt__).toBeUndefined();
      await POST(makePostRequest() as any);

      // After the first miss, the LAST_BINDING_WARN_KEY should now be set
      // to a recent timestamp so the next miss within 60s is suppressed.
      const last = (globalThis as any).__bindingCacheMissLastWarnAt__;
      expect(typeof last).toBe('number');
      expect(Date.now() - last).toBeLessThan(1000);
    });

    it('second miss within 60s preserves the original timestamp (suppressed, not refreshed)', async () => {
      // Seed the tracker well inside the 60s window (~1s ago). Any value
      // strictly less than BINDING_WARN_SPAM_WINDOW_MS would exercise the
      // suppress path; 1s is the smallest reasonable margin that keeps the
      // intent (test suppress-branch, not window-expiry) unambiguous, and is
      // robust under slow CI because a stray delay of ~59s before POST is
      // implausible in practice (would itself surface as a separate flake).
      const seedTime = Date.now() - 1_000;
      (globalThis as any).__bindingCacheMissLastWarnAt__ = seedTime;
      vi.mocked(sandboxBridge.getSessionByUserId).mockReturnValue({
        sessionId: 'sess-spam-2',
        sandboxId: 'sbx-spam-2',
      } as any);
      vi.mocked(sandboxBridge.getProvider).mockResolvedValue({
        getSandbox: vi.fn().mockResolvedValue({}),
      } as any);
      getBindingSpy.mockResolvedValueOnce(null);

      await POST(makePostRequest() as any);
      // Stamp must be PRESERVED (not refreshed during suppression) — the
      // suppression branch returns false without touching globalThis, so the
      // window-expiry check uses the ORIGINAL stamp time.
      const last = (globalThis as any).__bindingCacheMissLastWarnAt__;
      expect(last).toBe(seedTime);
    });

    it('after 60s window expires, a fresh miss re-emits at warn-level (refreshes stamp)', async () => {
      // Seed the tracker with a stamp 65_000ms in the past — well past the 60s window.
      (globalThis as any).__bindingCacheMissLastWarnAt__ = Date.now() - 65_000;
      vi.mocked(sandboxBridge.getSessionByUserId).mockReturnValue({
        sessionId: 'sess-spam-3',
        sandboxId: 'sbx-spam-3',
      } as any);
      vi.mocked(sandboxBridge.getProvider).mockResolvedValue({
        getSandbox: vi.fn().mockResolvedValue({}),
      } as any);
      getBindingSpy.mockResolvedValueOnce(null);

      await POST(makePostRequest() as any);
      // Stamp should now be REFRESHED to a recent timestamp — the warn path
      // overwrites globalThis after passing the window check.
      const last = (globalThis as any).__bindingCacheMissLastWarnAt__;
      expect(Date.now() - last).toBeLessThan(1000);
    });
  });

  // -------------------------------------------------------------------------
  describe('early-exit paths skip Redis calls entirely', () => {
    it('POST skips upsertBinding when auth fails', async () => {
      vi.mocked(resolveRequestAuth).mockResolvedValue({
        success: false,
        userId: null,
        source: 'none',
      } as any);

      const res = await POST(makePostRequest() as any);
      expect(res.status).toBe(401);
      expect(upsertBindingSpy).not.toHaveBeenCalled();
      expect(getBindingSpy).not.toHaveBeenCalled();
    });

    it('POST skips upsertBinding when rate limited', async () => {
      const rateLimiter = await import('@/lib/utils/rate-limiter');
      vi.mocked(rateLimiter.sandboxCreationRateLimiter.check).mockReturnValueOnce({
        allowed: false,
        retryAfter: 60,
        blockedUntil: Date.now() + 60_000,
      });

      const res = await POST(makePostRequest() as any);
      expect(res.status).toBe(429);
      expect(upsertBindingSpy).not.toHaveBeenCalled();
    });

    it('DELETE skips deleteBinding when auth is missing', async () => {
      vi.mocked(resolveRequestAuth).mockResolvedValue({
        success: false,
        userId: null,
        source: 'none',
      } as any);

      const res = await DELETE(makeDeleteRequest('sess-x') as any);
      expect(res.status).toBe(401);
      expect(deleteBindingSpy).not.toHaveBeenCalled();
    });

    it('DELETE skips deleteBinding when session ownership fails', async () => {
      vi.mocked(sandboxBridge.getSessionByUserId).mockReturnValue({
        sessionId: 'sess-other-user',
        sandboxId: 'sbx-oth',
      } as any);

      const res = await DELETE(makeDeleteRequest('sess-not-mine') as any);
      expect(res.status).toBe(403);
      expect(deleteBindingSpy).not.toHaveBeenCalled();
    });
  });
});
