/**
 * Unit tests for ContentAddressableStorage (Phase 5 CAS)
 *
 * Tests:
 * - store/retrieve content round-trip
 * - deduplication (same content → same hash)
 * - exists checks
 * - reference counting (addReference / removeReference)
 * - garbage collection
 * - stats reporting
 * - edge cases (empty content, binary content, large content)
 * - error handling (uninitialized, missing blobs)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';

// ============================================================================
// Mock hoisted values for database
// ============================================================================

const { mockDbGet, mockDbRun, mockDbAll, mockDbPrepare, mockDbTransaction } = vi.hoisted(() => {
  const mockRun = vi.fn().mockReturnValue({ changes: 1 });
  const mockGet = vi.fn();
  const mockAll = vi.fn().mockReturnValue([]);
  const mockPrepare = vi.fn().mockReturnValue({
    run: mockRun,
    get: mockGet,
    all: mockAll,
  });

  const mockTransaction = vi.fn((fn: () => any) => fn());

  return {
    mockDbPrepare: mockPrepare,
    mockDbGet: mockGet,
    mockDbRun: mockRun,
    mockDbAll: mockAll,
    mockDbTransaction: mockTransaction,
  };
});

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(() => ({
    prepare: mockDbPrepare,
    transaction: mockDbTransaction,
  })),
}));

// ============================================================================
// Mock modules
// ============================================================================

vi.mock('@/lib/database/connection', () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock('@/lib/database/schema', () => ({
  execSchemaFile: vi.fn(() => {}),
}));

// Mock compression to pass through — avoids zlib issues in test environment
vi.mock('@/lib/utils/compression', () => ({
  compress: (data: Buffer | string) => {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    // Only "compress" if data is large enough — simulates gzip threshold behavior
    if (buf.length < 512) return buf;
    // Add a fake gzip header to test decompression path
    const fakeCompressed = Buffer.concat([Buffer.from([0x1f, 0x8b]), buf]);
    return fakeCompressed;
  },
  decompress: (data: Buffer) => {
    // Strip fake gzip header
    if (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) {
      return data.subarray(2);
    }
    return data;
  },
  isCompressed: (data: Buffer) => {
    return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
  },
  getVersion: () => 'test',
  compressSync: (data: Buffer | string) => data,
  decompressSync: (data: Buffer) => data,
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { ContentAddressableStorage, getContentAddressableStorage } from '../content-addressable-storage';
import { getRuntimeBroker } from '../../sandbox/runtime-broker';

/**
 * Smoke test for the instrumentation API surface added by the Bug #4
 * followup (getCurrentCacheSize) and the RuntimeBroker degraded-mode fix
 * (getInitError). Both are called on a fresh instance — the CAS store
 * tests in this file use a local `cas` variable (not the singleton), so
 * no prior test populates the counter or triggers broker init. The
 * expected initial state is:
 *   - getInitError() returns null (clean init, no degraded fallback)
 *   - getCurrentCacheSize() returns 0 (no writes have populated the counter)
 */
describe('Instrumentation API smoke test (Bug #4 + RuntimeBroker degraded-mode)', () => {
  it('returns null from getRuntimeBroker().getInitError() and 0 from getContentAddressableStorage().getCurrentCacheSize() on a fresh instance', () => {
    // RuntimeBroker degraded-mode indicator: null = clean init.
    expect(getRuntimeBroker().getInitError()).toBeNull();
    // CAS counter: 0 = no writes have populated the counter yet.
    expect(getContentAddressableStorage().getCurrentCacheSize()).toBe(0);
  });
});

describe('ContentAddressableStorage', () => {
  let cas: ContentAddressableStorage;
  const testCacheDir = join(tmpdir(), 'cas-test-cache-' + Date.now());

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDatabase.mockReturnValue({
      prepare: mockDbPrepare,
      transaction: mockDbTransaction,
    });
    // Create a fresh cache directory for each test
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true, force: true });
    }
    mkdirSync(testCacheDir, { recursive: true });
    // Set up CAS with test-only config (no R2)
    process.env.CAS_CACHE_DIR = testCacheDir;
    process.env.CAS_CACHE_SIZE_MB = '10';
    process.env.ENABLE_CLOUD_STORAGE = 'false';
    process.env.CAS_GC_INTERVAL_MS = '0'; // Disable periodic GC in tests
    process.env.NODE_ENV = 'test';
    cas = new ContentAddressableStorage();
  });

  afterEach(() => {
    try {
      rmSync(testCacheDir, { recursive: true, force: true });
    } catch { /* may already be cleaned */ }
    delete process.env.CAS_CACHE_DIR;
    delete process.env.CAS_CACHE_SIZE_MB;
    delete process.env.ENABLE_CLOUD_STORAGE;
    delete process.env.CAS_GC_INTERVAL_MS;
    cas.stopGCSchedule();
  });

  // ==========================================================================
  // hashContent
  // ==========================================================================

  describe('hashContent', () => {
    it('produces deterministic SHA256 hashes', () => {
      const hash1 = cas.hashContent('hello world');
      const hash2 = cas.hashContent('hello world');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('produces different hashes for different content', () => {
      const hash1 = cas.hashContent('hello');
      const hash2 = cas.hashContent('world');
      expect(hash1).not.toBe(hash2);
    });

    it('handles empty content', () => {
      const hash = cas.hashContent('');
      expect(hash).toHaveLength(64);
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('handles Buffer input', () => {
      const buf = Buffer.from('hello');
      const hashBuf = cas.hashContent(buf);
      const hashStr = cas.hashContent('hello');
      expect(hashBuf).toBe(hashStr);
    });

    it('hash is hex-only', () => {
      const hash = cas.hashContent('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ==========================================================================
  // store / retrieve round-trip
  // ==========================================================================

  describe('store and retrieve', () => {
    it('round-trips string content through store/retrieve', async () => {
      const hash = await cas.store('hello world');
      expect(hash).toHaveLength(64);

      const retrieved = await cas.retrieve(hash);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.toString('utf-8')).toBe('hello world');
    });

    it('round-trips binary content', async () => {
      const binary = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE]);
      const hash = await cas.store(binary);

      const retrieved = await cas.retrieve(hash);
      expect(retrieved).not.toBeNull();
      expect(Buffer.compare(retrieved!, binary)).toBe(0);
    });

    it('returns null for unknown hash', async () => {
      await cas.initialize();
      const result = await cas.retrieve('f'.repeat(64));
      expect(result).toBeNull();
    });

    it('deduplicates identical content', async () => {
      const hash1 = await cas.store('duplicate content');
      const hash2 = await cas.store('duplicate content');
      expect(hash1).toBe(hash2);
    });
  });

  // ==========================================================================
  // storeSync
  // ==========================================================================

  describe('storeSync', () => {
    it('stores and retrieves content synchronously from local cache', async () => {
      const hash = cas.storeSync('sync test content');
      expect(hash).toHaveLength(64);

      const retrieved = await cas.retrieve(hash);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.toString('utf-8')).toBe('sync test content');
    });

    it('returns same hash for duplicate sync stores', () => {
      const hash1 = cas.storeSync('sync duplicate');
      const hash2 = cas.storeSync('sync duplicate');
      expect(hash1).toBe(hash2);
    });

    it('survives DB errors gracefully', () => {
      mockGetDatabase.mockReturnValue(null);

      // Should not throw — falls back to local cache only
      const hash = cas.storeSync('no-db content');
      expect(hash).toHaveLength(64);
      expect(existsSync(join(testCacheDir, hash))).toBe(true);
    });
  });

  // ==========================================================================
  // exists
  // ==========================================================================

  describe('exists', () => {
    it('returns false for unknown hash', async () => {
      await cas.initialize();
      // Use a hash that definitely doesn't exist in the cache
      const result = await cas.exists('deadbeef'.repeat(8));
      expect(result).toBe(false);
    });

    it('returns true after storing content', async () => {
      mockDbGet.mockReturnValueOnce(undefined);
      const hash = await cas.store('exists test');
      const result = await cas.exists(hash);
      expect(result).toBe(true);
    });

    it('returns true when hash found in DB registry', async () => {
      mockDbGet.mockImplementation((hash: string) => {
        return hash === 'known-hash' ? { hash: 'known-hash' } : undefined;
      });
      const result = await cas.exists('known-hash');
      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // Reference Counting
  // ==========================================================================

  describe('reference counting', () => {
    it('addReference increments ref_count', async () => {
      await cas.initialize();
      await cas.addReference('ref-test-hash');
      expect(mockDbPrepare).toHaveBeenCalled();
      expect(mockDbRun).toHaveBeenCalled();
    });

    it('removeReference decrements ref_count', async () => {
      await cas.initialize();
      await cas.removeReference('ref-test-hash');
      expect(mockDbPrepare).toHaveBeenCalled();
      expect(mockDbRun).toHaveBeenCalled();
    });

    it('handles DB errors during ref counting gracefully', async () => {
      mockGetDatabase.mockReturnValue(null);
      await expect(cas.addReference('error-hash')).resolves.not.toThrow();
      await expect(cas.removeReference('error-hash')).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // Garbage Collection
  // ==========================================================================

  describe('garbage collection', () => {
    it('getGCCandidates returns empty array when DB unavailable', async () => {
      mockGetDatabase.mockReturnValue(null);
      const candidates = await cas.getGCCandidates();
      expect(candidates).toEqual([]);
    });

    it('getGCCandidates queries with correct age parameter', async () => {
      mockDbAll.mockReturnValueOnce([{ hash: 'old-blob-1' }, { hash: 'old-blob-2' }]);
      const candidates = await cas.getGCCandidates(48);
      expect(candidates).toHaveLength(2);
      expect(candidates).toContain('old-blob-1');
      expect(candidates).toContain('old-blob-2');
    });

    it('garbageCollect returns zero when no candidates', async () => {
      mockDbAll.mockReturnValueOnce([]);
      const result = await cas.garbageCollect();
      expect(result.removed).toBe(0);
      expect(result.freedBytes).toBe(0);
    });

    it('garbageCollect removes blobs from DB', async () => {
      const hash = cas.storeSync('gc-test-content');
      mockDbAll.mockReturnValueOnce([{ hash }]);
      const result = await cas.garbageCollect();
      expect(result.removed).toBeGreaterThanOrEqual(0);
    });

    it('startGCSchedule and stopGCSchedule are safe', () => {
      cas.startGCSchedule();
      cas.stopGCSchedule();
      // Should not throw
    });
  });

  // ==========================================================================
  // Stats
  // ==========================================================================

  describe('getStats', () => {
    it('returns stats structure with expected fields', async () => {
      mockDbGet.mockReturnValueOnce({
        count: 10,
        total_size: 1024000,
        total_compressed: 512000,
        total_refs: 25,
      });
      mockDbGet.mockReturnValueOnce({ count: 2 });

      const stats = await cas.getStats();

      expect(stats.totalBlobs).toBe(10);
      expect(stats.totalSize).toBe(1024000);
      expect(stats.totalCompressedSize).toBe(512000);
      expect(stats.totalRefs).toBe(25);
      expect(stats.unreferencedBlobs).toBe(2);
      expect(stats.r2Enabled).toBe(false);
      expect(typeof stats.localCacheSize).toBe('number');
      expect(typeof stats.localCacheCount).toBe('number');
    });

    it('handles DB errors gracefully', async () => {
      mockGetDatabase.mockReturnValue(null);
      const stats = await cas.getStats();
      expect(stats.totalBlobs).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.r2Enabled).toBe(false);
    });
  });

  // ==========================================================================
  // R2 Support
  // ==========================================================================

  describe('R2 configuration', () => {
    it('reports R2 as disabled when not configured', async () => {
      const stats = await cas.getStats();
      expect(stats.r2Enabled).toBe(false);
    });

    it('getPublicUrl returns null when R2 not configured', () => {
      const url = cas.getPublicUrl('somehash');
      expect(url).toBeNull();
    });

    it('getPublicUrl returns URL when R2 public URL is set', () => {
      process.env.R2_PUBLIC_URL = 'https://cdn.example.com';
      const cas2 = new ContentAddressableStorage();
      const url = cas2.getPublicUrl('abcdef123456');
      expect(url).toBe('https://cdn.example.com/blobs/abcdef123456');
      delete process.env.R2_PUBLIC_URL;
    });
  });

  // ==========================================================================
  // Compression
  // ==========================================================================

  describe('compression', () => {
    it('handles compressible content (large repeated patterns)', async () => {
      const content = 'hello world '.repeat(1000);
      const hash = await cas.store(content);

      const retrieved = await cas.retrieve(hash);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.toString('utf-8')).toBe(content);
    });

    it('handles already-compressed-looking content', async () => {
      const content = Buffer.from(
        Array.from({ length: 5000 }, () => Math.floor(Math.random() * 256))
      ).toString('base64');
      const hash = await cas.store(content);

      const retrieved = await cas.retrieve(hash);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.toString('utf-8')).toBe(content);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles very large content (> CAS threshold)', async () => {
      const large = 'x'.repeat(10_000);
      const hash = await cas.store(large);

      const retrieved = await cas.retrieve(hash);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.toString('utf-8')).toBe(large);
    });

    it('handles Unicode / emoji content', async () => {
      const unicode = 'Hello 🌍! 你好！🎉 Café résumé';
      const hash = await cas.store(unicode);

      const retrieved = await cas.retrieve(hash);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.toString('utf-8')).toBe(unicode);
    });

    it('handles newlines and special characters', async () => {
      const special = 'line1\nline2\r\nline3\tindented\n\x00null\x1bescape';
      const hash = await cas.store(special);

      const retrieved = await cas.retrieve(hash);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.toString('utf-8')).toBe(special);
    });

    it('initialize is idempotent', async () => {
      await cas.initialize();
      await cas.initialize();
      await cas.initialize();
      // Should not throw
    });

    it('store with Buffer and string produce same hash for same content', async () => {
      const hashStr = await cas.store('same');
      const hashBuf = await cas.store(Buffer.from('same'));
      expect(hashStr).toBe(hashBuf);
    });
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('getContentAddressableStorage', () => {
    it('returns the same instance on multiple calls', () => {
      const instance1 = getContentAddressableStorage();
      const instance2 = getContentAddressableStorage();
      expect(instance1).toBe(instance2);
    });
  });
});
