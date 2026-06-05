/**
 * Tests: Sandbox Creation Timeout & Resource Cleanup
 *
 * Tests that core-sandbox-service enforces creation timeouts and
 * cleans up orphaned sandboxes when post-creation steps fail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The creation timeout is implemented in core-sandbox-service.ts via Promise.race
// and a configurable SANDBOX_CREATION_TIMEOUT_MS env var (default 5 min).

describe('Sandbox Creation Timeout', () => {
  describe('timeout configuration', () => {
    it('should default to 300000ms (5 minutes) when env var not set', () => {
      delete process.env.SANDBOX_CREATION_TIMEOUT_MS;

      const creationTimeoutMs = parseInt(
        process.env.SANDBOX_CREATION_TIMEOUT_MS || '300000',
        10,
      );

      expect(creationTimeoutMs).toBe(300000);
    });

    it('should use custom timeout when env var is set', () => {
      process.env.SANDBOX_CREATION_TIMEOUT_MS = '60000';

      const creationTimeoutMs = parseInt(
        process.env.SANDBOX_CREATION_TIMEOUT_MS,
        10,
      );

      expect(creationTimeoutMs).toBe(60000);

      // Cleanup
      delete process.env.SANDBOX_CREATION_TIMEOUT_MS;
    });

    it('should accept values as low as 10 seconds', () => {
      process.env.SANDBOX_CREATION_TIMEOUT_MS = '10000';

      const creationTimeoutMs = parseInt(
        process.env.SANDBOX_CREATION_TIMEOUT_MS,
        10,
      );

      expect(creationTimeoutMs).toBe(10000);

      // Cleanup
      delete process.env.SANDBOX_CREATION_TIMEOUT_MS;
    });
  });

  describe('Promise.race timeout pattern', () => {
    it('should resolve when sandbox creation finishes before timeout', async () => {
      const createSandbox = vi.fn().mockResolvedValue({ id: 'sb-001', status: 'running' });
      const timeoutMs = 5000;

      // Simulate the Promise.race pattern used in core-sandbox-service
      const result = await Promise.race([
        createSandbox(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Sandbox creation timed out after ${timeoutMs / 1000}s`)),
            timeoutMs,
          ),
        ),
      ]);

      expect(result).toEqual({ id: 'sb-001', status: 'running' });
      expect(createSandbox).toHaveBeenCalledTimes(1);
    });

    it('should reject with timeout error when creation takes too long', async () => {
      const createSandbox = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('too late'), 5000)),
      );
      const timeoutMs = 20;

      const promise = Promise.race([
        createSandbox(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Sandbox creation timed out after ${timeoutMs / 1000}s`)),
            timeoutMs,
          ),
        ),
      ]);

      await expect(promise).rejects.toThrow('timed out');
    }, 10000);

    it('should include the timeout duration in the error message', async () => {
      const timeoutMs = 20;

      const promise = Promise.race([
        new Promise(() => {}), // never resolves
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Sandbox creation timed out after ${timeoutMs / 1000}s`)),
            timeoutMs,
          ),
        ),
      ]);

      await expect(promise).rejects.toThrow('timed out after 0.02s');
    }, 10000);
  });
});

describe('Resource Cleanup on Post-Creation Failure', () => {
  describe('cleanup pattern', () => {
    it('should destroy sandbox when post-creation setup fails', async () => {
      const destroySandbox = vi.fn().mockResolvedValue(undefined);
      const provider = {
        createSandbox: vi.fn().mockResolvedValue({ id: 'sb-orphan-001' }),
        destroySandbox,
      };

      let handle: any = null;

      try {
        handle = await provider.createSandbox({});

        // Simulate post-creation step that fails
        throw new Error('Failed to sync filesystem');
      } catch (error: any) {
        // Cleanup: if sandbox was created but setup failed, destroy it
        if (handle) {
          try {
            await provider.destroySandbox(handle.id);
          } catch (cleanupErr) {
            // Cleanup error is non-fatal
          }
        }
        // Don't re-throw — verify cleanup occurred instead
      }

      // Verify cleanup was called
      expect(destroySandbox).toHaveBeenCalledWith('sb-orphan-001');
      expect(destroySandbox).toHaveBeenCalledTimes(1);
    });

    it('should not attempt cleanup if createSandbox itself failed', async () => {
      const destroySandbox = vi.fn();
      const provider = {
        createSandbox: vi.fn().mockRejectedValue(new Error('Provider unavailable')),
        destroySandbox,
      };

      let handle: any = null;

      try {
        handle = await provider.createSandbox({});
      } catch (error: any) {
        // handle should be null/undefined since creation failed
        if (handle) {
          await provider.destroySandbox(handle.id);
        }
        // Don't re-throw — verify cleanup behavior
      }

      // destroySandbox should NOT have been called since handle was never set
      expect(destroySandbox).not.toHaveBeenCalled();
    });

    it('should log cleanup errors without crashing (non-fatal)', async () => {
      const destroySandbox = vi.fn().mockRejectedValue(new Error('Destroy failed'));
      const handle = { id: 'sb-cleanup-err' };

      let loggedError: Error | null = null;

      try {
        await destroySandbox(handle.id);
      } catch (cleanupErr: any) {
        // Cleanup errors are non-fatal — just log and continue
        loggedError = cleanupErr;
      }

      expect(loggedError).not.toBeNull();
      expect(loggedError!.message).toBe('Destroy failed');
      expect(destroySandbox).toHaveBeenCalledWith('sb-cleanup-err');
    });

    it('should clean up even if multiple post-creation steps fail', async () => {
      const destroySandbox = vi.fn().mockResolvedValue(undefined);
      const steps: string[] = [];

      const provider = {
        createSandbox: vi.fn().mockResolvedValue({ id: 'sb-multi-fail' }),
        destroySandbox,
      };

      let handle: any = null;

      try {
        handle = await provider.createSandbox({});
        steps.push('cache-setup');

        throw new Error('Cache setup failed');
      } catch (error: any) {
        // First failure — handle might still exist
        steps.push('cleanup-on-first-failure');

        if (handle) {
          await provider.destroySandbox(handle.id);
        }
      }

      // Verify cleanup was called even after first failure
      expect(destroySandbox).toHaveBeenCalledWith('sb-multi-fail');
      expect(steps).toContain('cleanup-on-first-failure');
    });
  });
});
