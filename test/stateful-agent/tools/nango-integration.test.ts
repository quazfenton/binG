import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Nango SDK - define inline to avoid hoisting issues
vi.mock('@nangohq/node', () => {
  const mockGetConnection = vi.fn();
  const mockListConnections = vi.fn();
  const mockProxy = vi.fn();

  class MockNangoClass {
    constructor(options: any) {}
    getConnection = mockGetConnection;
    listConnections = mockListConnections;
    proxy = mockProxy;
  }

  return {
    Nango: MockNangoClass,
    // Export mock functions for test access
    __mocks: {
      mockGetConnection,
      mockListConnections,
      mockProxy,
    },
  };
});

import { NangoConnectionManager } from '@/lib/stateful-agent/tools/nango-connection';
import { NangoRateLimiter } from '@/lib/stateful-agent/tools/nango-rate-limit';

// Get mock functions from the mocked module
const mockedModule = vi.mocked(await import('@nangohq/node'));
const mockGetConnection = (mockedModule as any).__mocks.mockGetConnection;
const mockListConnections = (mockedModule as any).__mocks.mockListConnections;
const mockProxy = (mockedModule as any).__mocks.mockProxy;

describe('Nango Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockGetConnection.mockClear();
    mockListConnections.mockClear();
    mockProxy.mockClear();
  });

  describe('NangoConnectionManager', () => {
    let manager: NangoConnectionManager;

    beforeEach(() => {
      process.env.NANGO_SECRET_KEY = 'test-secret-key';
      manager = new NangoConnectionManager();
    });

    describe('constructor', () => {
      it('should create manager with secret key', () => {
        expect(manager).toBeDefined();
      });

      it('should use default cache TTL', () => {
        expect((manager as any).cacheTtlMs).toBe(300000); // 5 minutes
      });

      it('should warn when no secret key', () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.NANGO_SECRET_KEY;

        new NangoConnectionManager();

        expect(consoleWarn).toHaveBeenCalledWith(
          expect.stringContaining('NANGO_SECRET_KEY not configured')
        );
        consoleWarn.mockRestore();
      });
    });

    describe('getConnection', () => {
      it('should get connection from Nango', async () => {
        const mockConnection = { id: 'conn-123', provider: 'github' };
        mockGetConnection.mockResolvedValue(mockConnection);

        const result = await manager.getConnection('github', 'user-123');

        expect(mockGetConnection).toHaveBeenCalledWith('github', 'user-123');
        expect(result).toEqual(mockConnection);
      });

      it('should cache connections', async () => {
        const mockConnection = { id: 'conn-123' };
        mockGetConnection.mockResolvedValue(mockConnection);

        await manager.getConnection('github', 'user-123');
        await manager.getConnection('github', 'user-123');

        expect(mockGetConnection).toHaveBeenCalledTimes(1);
      });

      it('should respect cache TTL', async () => {
        const mockConnection = { id: 'conn-123' };
        mockGetConnection.mockResolvedValue(mockConnection);

        const shortTtlManager = new NangoConnectionManager(10);
        await shortTtlManager.getConnection('github', 'user-123');
        await new Promise(resolve => setTimeout(resolve, 20));
        await shortTtlManager.getConnection('github', 'user-123');

        expect(mockGetConnection).toHaveBeenCalledTimes(2);
      });

      it('should throw on connection error', async () => {
        mockGetConnection.mockRejectedValue(new Error('Connection failed'));

        await expect(manager.getConnection('github', 'user-123')).rejects.toThrow(
          'Failed to get Nango connection'
        );
      });
    });

    describe('listConnections', () => {
      it('should list all connections', async () => {
        const mockConnections = [
          { provider_config_key: 'github', connection_id: 'conn-1' },
          { provider_config_key: 'slack', connection_id: 'conn-2' },
        ];
        mockListConnections.mockResolvedValue(mockConnections);

        const result = await manager.listConnections();

        expect(result).toHaveLength(2);
        expect(result[0].provider).toBe('github');
        expect(result[1].provider).toBe('slack');
      });

      it('should return empty array on error', async () => {
        mockListConnections.mockRejectedValue(new Error('Failed'));
        const result = await manager.listConnections();
        expect(result).toEqual([]);
      });
    });

    describe('proxy', () => {
      it('should execute proxy request', async () => {
        mockProxy.mockResolvedValue({ data: { repos: [] } });

        const result = await manager.proxy({
          connectionId: 'user-1',
          method: 'GET',
          endpoint: '/user/repos',
        });

        expect(result.success).toBe(true);
      });

      it('should handle proxy errors', async () => {
        mockProxy.mockRejectedValue(new Error('API error'));

        const result = await manager.proxy({
          connectionId: 'user-1',
          method: 'GET',
          endpoint: '/user/repos',
        });

        expect(result.success).toBe(false);
      });
    });
  });

  describe('NangoRateLimiter', () => {
    let limiter: NangoRateLimiter;

    beforeEach(() => {
      limiter = new NangoRateLimiter();
    });

    describe('checkLimit', () => {
      it('should allow requests under limit', async () => {
        const result = await limiter.checkLimit('github');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(99);
      });

      it('should block requests over limit', async () => {
        for (let i = 0; i < 100; i++) {
          await limiter.checkLimit('github');
        }
        const result = await limiter.checkLimit('github');
        expect(result.allowed).toBe(false);
      });

      it('should reset after window expires', async () => {
        const shortLimiter = new NangoRateLimiter({
          test: { maxRequests: 2, windowMs: 100 },
        });

        await shortLimiter.checkLimit('test');
        await shortLimiter.checkLimit('test');
        let result = await shortLimiter.checkLimit('test');
        expect(result.allowed).toBe(false);

        await new Promise(resolve => setTimeout(resolve, 150));
        result = await shortLimiter.checkLimit('test');
        expect(result.allowed).toBe(true);
      });
    });

    describe('getStatus', () => {
      it('should return current status', () => {
        const status = limiter.getStatus('github');
        expect(status.limit).toBe(100);
        expect(status.remaining).toBe(100);
      });
    });

    describe('reset', () => {
      it('should reset all providers', async () => {
        await limiter.checkLimit('github');
        limiter.reset();
        expect(limiter.getStatus('github').remaining).toBe(100);
      });
    });
  });
});
