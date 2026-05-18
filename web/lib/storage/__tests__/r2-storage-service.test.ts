import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockSend = vi.fn();
const mockGetSignedUrl = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = mockSend;
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    ListObjectsV2Command: vi.fn(),
    HeadObjectCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('webdav', () => ({
  createClient: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeFile(name = 'test.txt', size = 1024, type = 'text/plain'): File {
  const content = new ArrayBuffer(size);
  return new File([content], name, { type });
}

function makeBlob(content = 'file content', type = 'text/plain'): Blob {
  return new Blob([content], { type });
}

type R2Service = {
  upload: (file: File, path: string, userId?: string) => Promise<string>;
  download: (path: string, userId?: string) => Promise<Blob>;
  delete: (path: string, userId?: string) => Promise<void>;
  list: (prefix?: string, userId?: string) => Promise<string[]>;
  getSignedUrl: (path: string, expiresIn?: number, userId?: string) => Promise<string>;
  getUsage: (userId: string) => Promise<{ used: number; limit: number }>;
};

// ─── Snapshot original process.env for cleanup ────────────────────────────

const ORIG_ENV = { ...process.env };

afterAll(() => {
  // Restore original env after all tests
  process.env = { ...ORIG_ENV };
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Main tests (default env) ─────────────────────────────────────────────
// These run against one module import. Env-isolated tests are below.

let R2StorageService: new () => R2Service;

beforeAll(async () => {
  vi.stubEnv('ENABLE_CLOUD_STORAGE', 'true');
  vi.stubEnv('CLOUD_STORAGE_PROVIDER', 'r2');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test-access-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret-key');
  vi.stubEnv('R2_ENDPOINT', 'https://test-account.r2.cloudflarestorage.com');
  vi.stubEnv('R2_BUCKET', 'test-bucket');
  vi.stubEnv('CLOUD_STORAGE_PER_USER_LIMIT_BYTES', String(5 * 1024 * 1024 * 1024));
  vi.stubEnv('CLOUD_STORAGE_BUCKET', '');

  const mod = await import('../cloud-storage');
  R2StorageService = mod.R2StorageService;
});

// ─── Helpers for env-isolated tests ───────────────────────────────────────

async function withEnv<T>(
  env: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  // Clear module cache so the module re-evaluates with new env vars
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return fn();
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('R2StorageService', () => {
  describe('constructor validation', () => {
    it('throws when access key and secret key are missing', async () => {
      await withEnv(
        {
          ENABLE_CLOUD_STORAGE: 'true',
          R2_ACCESS_KEY_ID: '',
          R2_SECRET_ACCESS_KEY: '',
          R2_ENDPOINT: 'https://test.r2.dev',
          R2_BUCKET: 'bucket',
        },
        async () => {
          const mod = await import('../cloud-storage');
          expect(() => new mod.R2StorageService()).toThrow(
            'R2 storage requires R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to be set',
          );
        },
      );
    });

    it('throws when endpoint is missing', async () => {
      await withEnv(
        {
          ENABLE_CLOUD_STORAGE: 'true',
          R2_ACCESS_KEY_ID: 'key',
          R2_SECRET_ACCESS_KEY: 'secret',
          R2_ENDPOINT: '',
          R2_BUCKET: 'bucket',
        },
        async () => {
          const mod = await import('../cloud-storage');
          expect(() => new mod.R2StorageService()).toThrow(
            'R2 storage requires R2_ENDPOINT to be set',
          );
        },
      );
    });

    it('throws when bucket name is missing', async () => {
      await withEnv(
        {
          ENABLE_CLOUD_STORAGE: 'true',
          R2_ACCESS_KEY_ID: 'key',
          R2_SECRET_ACCESS_KEY: 'secret',
          R2_ENDPOINT: 'https://test.r2.dev',
          R2_BUCKET: '',
          CLOUD_STORAGE_BUCKET: '',
        },
        async () => {
          const mod = await import('../cloud-storage');
          expect(() => new mod.R2StorageService()).toThrow(
            'R2 storage requires either R2_BUCKET or CLOUD_STORAGE_BUCKET to be set',
          );
        },
      );
    });

    it('falls back to CLOUD_STORAGE_BUCKET when R2_BUCKET is not set', async () => {
      await withEnv(
        {
          ENABLE_CLOUD_STORAGE: 'true',
          R2_ACCESS_KEY_ID: 'key',
          R2_SECRET_ACCESS_KEY: 'secret',
          R2_ENDPOINT: 'https://test.r2.dev',
          R2_BUCKET: '',
          CLOUD_STORAGE_BUCKET: 'fallback-bucket',
        },
        async () => {
          const mod = await import('../cloud-storage');
          expect(() => new mod.R2StorageService()).not.toThrow();
        },
      );
    });
  });

  describe('upload', () => {
    it('uploads a file and returns the R2 public URL', async () => {
      mockSend.mockResolvedValueOnce({});
      const service = new R2StorageService();
      const file = makeFile();

      const url = await service.upload(file, 'path/to/file.txt', 'user-123');

      expect(url).toBe(
        'https://test-account.r2.cloudflarestorage.com/test-bucket/users/user-123/path/to/file.txt',
      );
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('uses R2_PUBLIC_URL when configured', async () => {
      await withEnv(
        {
          ENABLE_CLOUD_STORAGE: 'true',
          R2_ACCESS_KEY_ID: 'key',
          R2_SECRET_ACCESS_KEY: 'secret',
          R2_ENDPOINT: 'https://test.r2.dev',
          R2_BUCKET: 'bucket',
          R2_PUBLIC_URL: 'https://pub-test.r2.dev',
          CLOUD_STORAGE_PER_USER_LIMIT_BYTES: '5368709120',
        },
        async () => {
          mockSend.mockResolvedValueOnce({});
          const mod = await import('../cloud-storage');
          const service = new mod.R2StorageService();

          const url = await service.upload(makeFile(), 'docs/file.pdf', 'user-1');

          expect(url).toBe('https://pub-test.r2.dev/users/user-1/docs/file.pdf');
        },
      );
    });

    it('updates usage tracking after successful upload', async () => {
      mockSend.mockResolvedValueOnce({});
      const service = new R2StorageService();
      const file = makeFile('large.bin', 2048);

      await service.upload(file, 'large.bin', 'user-tracked');
      const usage = await service.getUsage('user-tracked');

      expect(usage.used).toBeGreaterThanOrEqual(2048);
    });

    it('throws when quota is exceeded', async () => {
      await withEnv(
        {
          ENABLE_CLOUD_STORAGE: 'true',
          R2_ACCESS_KEY_ID: 'key',
          R2_SECRET_ACCESS_KEY: 'secret',
          R2_ENDPOINT: 'https://test.r2.dev',
          R2_BUCKET: 'bucket',
          CLOUD_STORAGE_PER_USER_LIMIT_BYTES: '100',
        },
        async () => {
          const mod = await import('../cloud-storage');
          const service = new mod.R2StorageService();

          await expect(
            service.upload(makeFile('big.bin', 200), 'big.bin', 'quota-user'),
          ).rejects.toThrow('Storage limit exceeded');
        },
      );
    });

    it('wraps S3 errors with a descriptive message', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
      const service = new R2StorageService();

      await expect(
        service.upload(makeFile(), 'fail.txt', 'err-user'),
      ).rejects.toThrow('Failed to upload file to R2: AccessDenied');
    });

    it('throws when cloud storage is disabled', async () => {
      await withEnv(
        {
          ENABLE_CLOUD_STORAGE: 'false',
          R2_ACCESS_KEY_ID: 'key',
          R2_SECRET_ACCESS_KEY: 'secret',
          R2_ENDPOINT: 'https://test.r2.dev',
          R2_BUCKET: 'bucket',
          CLOUD_STORAGE_PER_USER_LIMIT_BYTES: '5368709120',
        },
        async () => {
          const mod = await import('../cloud-storage');
          const service = new mod.R2StorageService();

          await expect(service.upload(makeFile(), 'x.txt')).rejects.toThrow(
            'Cloud storage is disabled',
          );
        },
      );
    });
  });

  describe('download', () => {
    it('downloads a file and returns a Blob', async () => {
      const blobContent = 'hello world';
      mockSend.mockResolvedValueOnce({ Body: makeBlob(blobContent) });
      const service = new R2StorageService();

      const blob = await service.download('path/to/file.txt', 'user-1');

      expect(blob).toBeInstanceOf(Blob);
      const text = await blob.text();
      expect(text).toBe(blobContent);
    });

    it('throws when no body in response', async () => {
      mockSend.mockResolvedValueOnce({ Body: undefined });
      const service = new R2StorageService();

      await expect(service.download('missing.txt')).rejects.toThrow('No file content received');
    });

    it('wraps S3 errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('NoSuchKey'));
      const service = new R2StorageService();

      await expect(service.download('nope.txt')).rejects.toThrow(
        'Failed to download file from R2: NoSuchKey',
      );
    });
  });

  describe('delete', () => {
    it('deletes a file successfully', async () => {
      mockSend.mockResolvedValueOnce({ ContentLength: 512 }).mockResolvedValueOnce({});
      const service = new R2StorageService();

      await expect(service.delete('path/to/file.txt', 'user-1')).resolves.toBeUndefined();

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('still deletes when head request for usage tracking fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('NotFound')).mockResolvedValueOnce({});
      const service = new R2StorageService();

      await expect(service.delete('gone.txt', 'user-1')).resolves.toBeUndefined();

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('admits deletion without userId', async () => {
      mockSend.mockResolvedValueOnce({});
      const service = new R2StorageService();

      await expect(service.delete('orphan.txt')).resolves.toBeUndefined();

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    it('returns file keys for a given prefix', async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: 'users/user-1/docs/a.pdf' },
          { Key: 'users/user-1/docs/b.pdf' },
        ],
      });
      const service = new R2StorageService();

      const files = await service.list('docs/', 'user-1');

      expect(files).toEqual(['a.pdf', 'b.pdf']);
    });

    it('returns empty array when no files match', async () => {
      mockSend.mockResolvedValueOnce({ Contents: undefined });
      const service = new R2StorageService();

      const files = await service.list('empty/', 'user-1');

      expect(files).toEqual([]);
    });

    it('wraps S3 errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
      const service = new R2StorageService();

      await expect(service.list('docs/', 'user-1')).rejects.toThrow(
        'Failed to list files from R2: AccessDenied',
      );
    });
  });

  describe('getSignedUrl', () => {
    it('returns a signed URL for the object', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://signed.url/test.txt?token=abc');
      const service = new R2StorageService();

      const url = await service.getSignedUrl('path/to/file.txt', 3600, 'user-1');

      expect(url).toBe('https://signed.url/test.txt?token=abc');
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    });

    it('wraps presigner errors', async () => {
      mockGetSignedUrl.mockRejectedValueOnce(new Error('Credentials expired'));
      const service = new R2StorageService();

      await expect(service.getSignedUrl('fail.txt')).rejects.toThrow(
        'Failed to generate signed URL for R2: Credentials expired',
      );
    });
  });

  describe('getUsage', () => {
    it('returns zero usage when no files uploaded', async () => {
      const service = new R2StorageService();

      const usage = await service.getUsage('fresh-user');

      expect(usage).toEqual({ used: 0, limit: 5 * 1024 * 1024 * 1024 });
    });

    it('reflects accumulated uploads', async () => {
      mockSend.mockResolvedValue({});
      const service = new R2StorageService();

      await service.upload(makeFile('a.txt', 100), 'a.txt', 'accum-user');
      await service.upload(makeFile('b.txt', 200), 'b.txt', 'accum-user');
      const usage = await service.getUsage('accum-user');

      expect(usage.used).toBeGreaterThanOrEqual(300);
    });
  });
});
