/**
 * Tests: 4-tier ENCRYPTION_KEY resolver in web/lib/auth/totp.ts
 *
 * Verifies the resolver reaches the right tier, applies the right side effects
 * (chmod 0o600, atomic write), and keeps secrets round-tripping under every
 * branch. The fs module is fully mocked — no real on-disk key is touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoist the fs mock BEFORE totp.ts imports `from 'fs'`.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = await import('fs') as unknown as {
  existsSync: ReturnType<typeof vi.fn>;
  readFileSync: ReturnType<typeof vi.fn>;
  writeFileSync: ReturnType<typeof vi.fn>;
  mkdirSync: ReturnType<typeof vi.fn>;
  chmodSync: ReturnType<typeof vi.fn>;
  renameSync: ReturnType<typeof vi.fn>;
};

const totp = await import('@/lib/auth/totp');

const SECRET = 'JBSWY3DPEHPK3PXP'; // RFC 4648 base32 sample

describe('totp.getEncryptionKey() — 4-tier resolver', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_FILE;
    process.env.NODE_ENV = 'test';
    vi.clearAllMocks();
    fs.existsSync.mockImplementation(() => false);
    fs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    totp.__resetEncryptionKeyCacheForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('Tier 1 — process.env.ENCRYPTION_KEY wins, never touches FS', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    const enc = totp.encryptTotpSecret(SECRET);
    // IV = 12 bytes (24 hex chars), authTag = 16 bytes (32 hex), ciphertext = whatever
    expect(enc).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(totp.decryptTotpSecret(enc)).toBe(SECRET);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.existsSync).not.toHaveBeenCalled();
  });

  it('Tier 2 — existing 32-byte file on disk is reused (no write)', () => {
    process.env.ENCRYPTION_KEY_FILE = '/tmp/test-keyfile';
    const onDisk = Buffer.alloc(32, 0xcd);
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(onDisk);

    const enc = totp.encryptTotpSecret(SECRET);
    expect(totp.decryptTotpSecret(enc)).toBe(SECRET);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.readFileSync).toHaveBeenCalledWith('/tmp/test-keyfile');
  });

  it('Tier 2 — wrong-length file is treated as missing and regenerated', () => {
    process.env.ENCRYPTION_KEY_FILE = '/tmp/test-keyfile';
    fs.existsSync.mockImplementation((p: unknown) => p === '/tmp/test-keyfile' || p === '/tmp');
    fs.readFileSync.mockReturnValue(Buffer.alloc(16, 0xff)); // wrong length
    const enc = totp.encryptTotpSecret(SECRET);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(totp.decryptTotpSecret(enc)).toBe(SECRET);
  });

  it('Tier 3 — missing file → atomic generate-and-write to chmod 0o600', () => {
    process.env.ENCRYPTION_KEY_FILE = '/var/lib/bing/encryption.key';
    fs.existsSync.mockImplementation((p: unknown) => p === '/var/lib/bing');

    const enc = totp.encryptTotpSecret(SECRET);

    // Exactly one atomic write happened
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [tmpPath, payload, opts] = fs.writeFileSync.mock.calls[0];
    expect(tmpPath).toBe('/var/lib/bing/encryption.key.tmp');
    expect(Buffer.isBuffer(payload)).toBe(true);
    expect((payload as Buffer).length).toBe(32);
    expect(opts).toEqual(expect.objectContaining({ mode: 0o600 }));

    // chmod + rename landed
    expect(fs.chmodSync).toHaveBeenCalledWith('/var/lib/bing/encryption.key.tmp', 0o600);
    expect(fs.renameSync).toHaveBeenCalledWith(
      '/var/lib/bing/encryption.key.tmp',
      '/var/lib/bing/encryption.key',
    );
    // Roundtrip still works
    expect(totp.decryptTotpSecret(enc)).toBe(SECRET);
  });

  it('Tier 3 — missing parent dir → mkdirSync recursive with mode 0o700', () => {
    process.env.ENCRYPTION_KEY_FILE = '/var/lib/bing/encryption.key';
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockClear();
    fs.mkdirSync.mockImplementation(() => undefined);

    const enc = totp.encryptTotpSecret(SECRET);

    expect(fs.mkdirSync).toHaveBeenCalledTimes(1);
    const [dir, opts] = fs.mkdirSync.mock.calls[0];
    expect(dir).toBe('/var/lib/bing');
    expect(opts).toEqual(expect.objectContaining({ recursive: true, mode: 0o700 }));
    expect(totp.decryptTotpSecret(enc)).toBe(SECRET);
  });

  it('Tier 4 — write fails in production → throws (no silent dev fallback)', () => {
    process.env.ENCRYPTION_KEY_FILE = '/var/lib/bing/encryption.key';
    process.env.NODE_ENV = 'production';
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => totp.encryptTotpSecret(SECRET)).toThrow(
      /ENCRYPTION_KEY not set AND could not persist/,
    );
  });

  it('Tier 4 — write fails in non-production → ephemeral dev fallback (round-trips)', () => {
    process.env.ENCRYPTION_KEY_FILE = '/var/lib/bing/encryption.key';
    process.env.NODE_ENV = 'development';
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const enc = totp.encryptTotpSecret(SECRET);
    // Same dev key is used twice → still decryptable
    const enc2 = totp.encryptTotpSecret(SECRET);
    expect(totp.decryptTotpSecret(enc)).toBe(SECRET);
    expect(totp.decryptTotpSecret(enc2)).toBe(SECRET);
  });

  it('cache — warm-up call resolves the key; subsequent calls do not re-invoke any FS function', () => {
    process.env.ENCRYPTION_KEY_FILE = '/var/lib/bing/encryption.key';
    fs.existsSync.mockImplementation((p: unknown) => p === '/var/lib/bing');

    // First call: cold path, walks the resolver (Tier 3 generate+write path).
    totp.encryptTotpSecret('warm-up');
    const warm = fs.existsSync.mock.calls.length;
    const writeCount = fs.writeFileSync.mock.calls.length;

    // Subsequent calls: hot path, must hit the module-level cache.
    totp.encryptTotpSecret('two');
    totp.encryptTotpSecret('three');
    totp.encryptTotpSecret('four');

    expect(fs.existsSync.mock.calls.length).toBe(warm);
    expect(fs.writeFileSync.mock.calls.length).toBe(writeCount);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('__resetEncryptionKeyCacheForTests — cache clears, resolver re-walks', () => {
    // First call: env path. No FS.
    process.env.ENCRYPTION_KEY = 'c'.repeat(32);
    expect(totp.encryptTotpSecret('first')).toBeTruthy();
    expect(fs.readFileSync).not.toHaveBeenCalled();

    // Reset and switch to file-on-disk tier 2.
    totp.__resetEncryptionKeyCacheForTests();
    delete process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY_FILE = '/tmp/test-keyfile';
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(Buffer.alloc(32, 0xee));

    const enc = totp.encryptTotpSecret('second');
    expect(fs.readFileSync).toHaveBeenCalled();
    expect(totp.decryptTotpSecret(enc)).toBe('second');
  });

  it('migration — legacy dev-fallback row is decryptable when ENCRYPTION_KEY is set to legacy literal', () => {
    // Documents the migration path: existing user_mfa rows encrypted under
    // the static dev-fallback can be recovered by setting the env var to the
    // legacy literal (which gets padded to 32 bytes).
    process.env.ENCRYPTION_KEY = 'dev-fallback-key-not-for-production';
    const enc = totp.encryptTotpSecret(SECRET);
    expect(totp.decryptTotpSecret(enc)).toBe(SECRET);
  });
});
