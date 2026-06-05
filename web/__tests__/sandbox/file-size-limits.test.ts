/**
 * Tests: File Size Limits
 *
 * Tests for MAX_WRITE_FILE_SIZE and MAX_READ_FILE_SIZE enforcement
 * in SandboxManager writeFile/readFile operations.
 *
 * IMPORTANT: SandboxManager.writeFile() and .readFile() both call
 * getSandbox() internally, which requires the sandbox to exist in
 * the manager's internal map. Tests MUST call createSandbox() first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SandboxManager } from '@/lib/sandbox/local-sandbox-manager';
import { existsSync, mkdirSync, statSync, createWriteStream, createReadStream } from 'fs';

// Mock fs operations to avoid actual filesystem access
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
    createWriteStream: vi.fn(),
    createReadStream: vi.fn(),
  };
});

vi.mock('@/lib/security/security-utils', () => ({
  safeJoin: vi.fn((base: string, ...paths: string[]) => `${base}/${paths.join('/')}`),
  isValidResourceId: vi.fn(() => true),
  validateRelativePath: vi.fn((p: string) => p),
  commandSchema: { parse: vi.fn() },
}));

vi.mock('@/lib/utils/crypto-random', () => ({
  secureRandomId: vi.fn(() => 'sandbox_test-id'),
}));

vi.mock('../backend/metrics', () => ({
  sandboxMetrics: {
    sandboxCreatedTotal: { inc: vi.fn(), dec: vi.fn() },
    sandboxActive: { inc: vi.fn(), dec: vi.fn() },
    sandboxCreationDuration: { observe: vi.fn() },
    commandExecutions: { inc: vi.fn() },
    commandExecutionDuration: { observe: vi.fn() },
  },
}));

describe('File Size Limits', () => {
  let manager: SandboxManager;
  const sandboxId = 'test-sb-001';

  const MAX_WRITE_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  const MAX_READ_FILE_SIZE = 50 * 1024 * 1024;   // 50 MB

  // Helper: set up a mock stream that calls the callback immediately
  function makeMockStream(): any {
    return {
      on: vi.fn().mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'finish' || event === 'end') setImmediate(cb);
        return this;
      }),
      write: vi.fn(),
      end: vi.fn(),
    };
  }

  // Helper: mock createReadStream to emit 'data' then 'end'
  function makeMockReadStream(content: string): any {
    return {
      on: vi.fn().mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'data') setImmediate(() => cb(content));
        if (event === 'end') setImmediate(cb);
        return this;
      }),
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(mkdirSync).mockImplementation(() => undefined as any);

    manager = new SandboxManager('/tmp/test-workspaces', '/tmp/test-snapshots');

    // Must create the sandbox first — writeFile/readFile call getSandbox() internally
    // which requires the sandbox to be in the manager's internal map
    await manager.createSandbox({ sandboxId });
  });

  describe('writeFile - MAX_WRITE_FILE_SIZE (10 MB)', () => {
    it('should accept files under 10 MB', async () => {
      // Mock createWriteStream for writeToFile
      const mockStream = makeMockStream();
      vi.mocked(createWriteStream).mockReturnValue(mockStream);
      vi.mocked(statSync).mockReturnValue({ size: 100 } as any);

      const data = 'x'.repeat(1024 * 1024); // 1 MB

      await expect(
        manager.writeFile(sandboxId, 'file.txt', data),
      ).resolves.toBeUndefined();
    });

    it('should reject files over 10 MB', async () => {
      const data = 'x'.repeat(MAX_WRITE_FILE_SIZE + 1); // 10 MB + 1 byte

      await expect(manager.writeFile(sandboxId, 'large.txt', data)).rejects.toThrow(
        'File too large',
      );
    });

    it('should include file size in error message', async () => {
      const data = 'x'.repeat(20 * 1024 * 1024); // 20 MB

      try {
        await manager.writeFile(sandboxId, 'huge.txt', data);
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('MB');
        expect(err.message).toContain('20.0 MB');
        expect(err.message).toContain('10 MB');
      }
    });

    it('should accept files exactly at the limit', async () => {
      const mockStream = makeMockStream();
      vi.mocked(createWriteStream).mockReturnValue(mockStream);
      vi.mocked(statSync).mockReturnValue({ size: MAX_WRITE_FILE_SIZE } as any);

      const data = 'x'.repeat(MAX_WRITE_FILE_SIZE); // exactly 10 MB

      await expect(
        manager.writeFile(sandboxId, 'exact.txt', data),
      ).resolves.toBeUndefined();
    });
  });

  describe('readFile - MAX_READ_FILE_SIZE (50 MB)', () => {
    it('should accept files under 50 MB', async () => {
      const mockStream = makeMockReadStream('file contents');
      vi.mocked(createReadStream).mockReturnValue(mockStream);
      vi.mocked(statSync).mockReturnValue({ size: 1024 } as any);

      const result = await manager.readFile(sandboxId, 'file.txt');
      expect(result).toBe('file contents');
    });

    it('should reject files over 50 MB', async () => {
      vi.mocked(statSync).mockReturnValue({
        size: MAX_READ_FILE_SIZE + 1,
      } as any);

      await expect(manager.readFile(sandboxId, 'huge-log.txt')).rejects.toThrow(
        'File too large to read',
      );
    });

    it('should include file size in read error message', async () => {
      vi.mocked(statSync).mockReturnValue({
        size: 100 * 1024 * 1024, // 100 MB
      } as any);

      try {
        await manager.readFile(sandboxId, 'big.log');
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('100.0 MB');
        expect(err.message).toContain('50 MB');
      }
    });

    it('should accept files exactly at the read limit', async () => {
      const mockStream = makeMockReadStream('contents');
      vi.mocked(createReadStream).mockReturnValue(mockStream);
      vi.mocked(statSync).mockReturnValue({
        size: MAX_READ_FILE_SIZE,
      } as any);

      const result = await manager.readFile(sandboxId, 'exact.bin');
      expect(result).toBe('contents');
    });

    it('should not throw when file does not exist (let ENOENT pass through)', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      vi.mocked(statSync).mockImplementation(() => {
        throw enoent;
      });

      // ENOENT is silently swallowed, then createReadStream handles it
      const mockStream = makeMockReadStream('');
      vi.mocked(createReadStream).mockReturnValue(mockStream);
      // Make the read stream emit an error
      mockStream.on = vi.fn().mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'error') setImmediate(() => cb(enoent));
        return this;
      });

      await expect(manager.readFile(sandboxId, 'missing.txt')).rejects.toThrow('ENOENT');
    });

    it('should re-throw permission errors from stat', async () => {
      const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      vi.mocked(statSync).mockImplementation(() => {
        throw eacces;
      });

      await expect(manager.readFile(sandboxId, 'protected.txt')).rejects.toThrow('EACCES');
    });
  });
});
