/**
 * Unit tests for RedisSandboxBindingService (Phase 1).
 *
 * Mocks `ioredis` entirely so no live Redis is required. Each test resets
 * the singletons to keep test order independence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ioredis-backed getRedisClient + isRedisEnabled so the service can run
// without a real connection. Per-test `vi.mocked(isRedisEnabled).mockReturnValue(...)`
// toggles the feature gate.
// ---------------------------------------------------------------------------

const redisMock = {
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn(),
  del: vi.fn().mockResolvedValue(1),
  sadd: vi.fn().mockResolvedValue(1),
  srem: vi.fn().mockResolvedValue(1),
  smembers: vi.fn(),
  expire: vi.fn().mockResolvedValue(1),
  pipeline: vi.fn(),
};

vi.mock('../client', () => ({
  getRedisClient: vi.fn(() => redisMock),
  isRedisEnabled: vi.fn(() => true),
  RedisDisabledError: class RedisDisabledError extends Error {},
}));

import {
  getSandboxBindingService,
  _resetSandboxBindingServiceForTests,
  type SandboxBinding,
} from '../sandbox-binding-service';
import { isRedisEnabled } from '../client';

const baseBinding: SandboxBinding = {
  sessionId: 'sess-1',
  userId: 'user-1',
  sandboxId: 'sbx-abc',
  wsUrl: '/api/sandbox/terminal/stream?sessionId=sess-1',
  provider: 'daytona',
  createdAt: 1_700_000_000_000,
  expiresAt: 1_700_086_400_000,
  status: 'active',
};

// ---------------------------------------------------------------------------

describe('RedisSandboxBindingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSandboxBindingServiceForTests();
    vi.mocked(isRedisEnabled).mockReturnValue(true);
  });

  afterEach(() => {
    _resetSandboxBindingServiceForTests();
  });

  // -------------------------------------------------------------------------
  describe('isAvailable', () => {
    it('reflects isRedisEnabled()', () => {
      expect(getSandboxBindingService().isAvailable()).toBe(true);
      vi.mocked(isRedisEnabled).mockReturnValue(false);
      expect(getSandboxBindingService().isAvailable()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('upsertBinding', () => {
    it('writes SET + SADD + EXPIRE with default 24h TTL', async () => {
      await getSandboxBindingService().upsertBinding(baseBinding);

      expect(redisMock.set).toHaveBeenCalledWith(
        'sandbox:binding:sess-1',
        JSON.stringify(baseBinding),
        'EX',
        24 * 60 * 60,
      );
      expect(redisMock.sadd).toHaveBeenCalledWith(
        'sandbox:user:user-1:bindings',
        'sess-1',
      );
      expect(redisMock.expire).toHaveBeenCalledWith(
        'sandbox:user:user-1:bindings',
        24 * 60 * 60,
      );
    });

    it('honors a custom TTL passed as the second argument', async () => {
      await getSandboxBindingService().upsertBinding(baseBinding, 120);

      expect(redisMock.set).toHaveBeenCalledWith(
        'sandbox:binding:sess-1',
        JSON.stringify(baseBinding),
        'EX',
        120,
      );
      expect(redisMock.expire).toHaveBeenCalledWith(
        'sandbox:user:user-1:bindings',
        120,
      );
    });

    it('is a no-op when Redis is disabled', async () => {
      vi.mocked(isRedisEnabled).mockReturnValue(false);
      await getSandboxBindingService().upsertBinding(baseBinding);

      expect(redisMock.set).not.toHaveBeenCalled();
      expect(redisMock.sadd).not.toHaveBeenCalled();
      expect(redisMock.expire).not.toHaveBeenCalled();
    });

    it('fail-open: swallows Redis errors and does not throw', async () => {
      redisMock.set.mockRejectedValueOnce(new Error('connection lost'));
      await expect(
        getSandboxBindingService().upsertBinding(baseBinding),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('getBinding', () => {
    it('returns the parsed binding on cache hit', async () => {
      redisMock.get.mockResolvedValueOnce(JSON.stringify(baseBinding));
      const result = await getSandboxBindingService().getBinding('sess-1');
      expect(result).toEqual(baseBinding);
    });

    it('returns null on cache miss', async () => {
      redisMock.get.mockResolvedValueOnce(null);
      const result = await getSandboxBindingService().getBinding('sess-1');
      expect(result).toBeNull();
    });

    it('returns null when Redis is disabled', async () => {
      vi.mocked(isRedisEnabled).mockReturnValue(false);
      // Important: .get must NOT be touched when disabled.
      const result = await getSandboxBindingService().getBinding('sess-1');
      expect(result).toBeNull();
      expect(redisMock.get).not.toHaveBeenCalled();
    });

    it('returns null (fail-soft) on Redis error', async () => {
      redisMock.get.mockRejectedValueOnce(new Error('connection lost'));
      const result = await getSandboxBindingService().getBinding('sess-1');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('getUserBindings', () => {
    it('returns the parsed bindings from a pipelined batch', async () => {
      redisMock.smembers.mockResolvedValueOnce(['sess-1', 'sess-2']);
      const pipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValueOnce([
          [null, JSON.stringify(baseBinding)],
          [
            null,
            JSON.stringify({ ...baseBinding, sessionId: 'sess-2', sandboxId: 'sbx-def' }),
          ],
        ]),
      };
      redisMock.pipeline.mockReturnValueOnce(pipeline);

      const result = await getSandboxBindingService().getUserBindings('user-1');
      expect(result).toHaveLength(2);
      expect(result[0].sessionId).toBe('sess-1');
      expect(result[1].sessionId).toBe('sess-2');
      expect(result[1].sandboxId).toBe('sbx-def');
    });

    it('skips malformed entries in the pipeline silently', async () => {
      redisMock.smembers.mockResolvedValueOnce(['sess-1', 'sess-bad']);
      const pipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValueOnce([
          [null, JSON.stringify(baseBinding)],
          [null, 'not-json-{'],
        ]),
      };
      redisMock.pipeline.mockReturnValueOnce(pipeline);

      const result = await getSandboxBindingService().getUserBindings('user-1');
      expect(result).toEqual([baseBinding]);
    });

    it('returns [] when SMEMBERS is empty', async () => {
      redisMock.smembers.mockResolvedValueOnce([]);
      const result = await getSandboxBindingService().getUserBindings('user-1');
      expect(result).toEqual([]);
    });

    it('returns [] on Redis error (graceful degradation)', async () => {
      redisMock.smembers.mockRejectedValueOnce(new Error('connection lost'));
      const result = await getSandboxBindingService().getUserBindings('user-1');
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('deleteBinding', () => {
    it('removes both the binding key and the user set member', async () => {
      await getSandboxBindingService().deleteBinding('sess-1', 'user-1');

      expect(redisMock.del).toHaveBeenCalledWith('sandbox:binding:sess-1');
      expect(redisMock.srem).toHaveBeenCalledWith(
        'sandbox:user:user-1:bindings',
        'sess-1',
      );
    });

    it('is a no-op when Redis is disabled', async () => {
      vi.mocked(isRedisEnabled).mockReturnValue(false);
      await getSandboxBindingService().deleteBinding('sess-1', 'user-1');

      expect(redisMock.del).not.toHaveBeenCalled();
      expect(redisMock.srem).not.toHaveBeenCalled();
    });

    it('fail-open: swallows Redis errors', async () => {
      redisMock.del.mockRejectedValueOnce(new Error('connection lost'));
      await expect(
        getSandboxBindingService().deleteBinding('sess-1', 'user-1'),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('round-trip', () => {
    it('write then read returns the same payload', async () => {
      // First call (upsert) writes the JSON via SET.
      // Second call (get) reads it back via GET.
      redisMock.get.mockResolvedValueOnce(JSON.stringify(baseBinding));
      await getSandboxBindingService().upsertBinding(baseBinding);
      const result = await getSandboxBindingService().getBinding('sess-1');
      expect(result).toEqual(baseBinding);
    });
  });

  // -------------------------------------------------------------------------
  describe('singleton lifecycle', () => {
    it('returns the same instance across calls', () => {
      const a = getSandboxBindingService();
      const b = getSandboxBindingService();
      expect(a).toBe(b);
    });

    it('reset_for_tests makes the next call return a fresh instance', () => {
      const a = getSandboxBindingService();
      _resetSandboxBindingServiceForTests();
      const b = getSandboxBindingService();
      expect(a).not.toBe(b);
    });
  });
});
