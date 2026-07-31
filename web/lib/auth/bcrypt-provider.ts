/**
 * bcrypt-provider.ts
 *
 * Thin adapter that lazily selects bcryptjs (pure-JS, portable) or native bcrypt
 * (C++ addon, ~15× faster) based on the BCRYPT_NATIVE_ENABLED env variable.
 *
 * ## Why an adapter, not a direct swap
 *
 * The native `bcrypt` package compiles a C++ addon (`node-gyp-build`). In CI,
 * serverless, or container environments without a C++ toolchain, the native
 * addon may fail to build. The pure-JS `bcryptjs` fallback ensures login
 * always works — albeit slower — even when native compilation is unavailable.
 *
 * ## Feature flag (BCRYPT_NATIVE_ENABLED)
 *
 *   - `unset` or `false` → use bcryptjs (pure-JS, ~4200ms verify at cost-12)
 *   - `true`           → use native bcrypt (~250ms verify at cost-12)
 *
 * Default is `false` for the first 24 hours post-deployment so rollback is a
 * single env var flip + worker restart. After verification, ops can flip to
 * `true` with no code changes.
 *
 * ## API surface
 *
 * Exports the same `hash`, `compare`, `genSalt` signatures as both bcryptjs
 * and native bcrypt. All callers migrate from `import * as bcrypt from 'bcryptjs'`
 * to `import { hash, compare, genSalt } from '@/lib/auth/bcrypt-provider'`.
 *
 * ## Pre-warm pattern
 *
 * The native binding pre-warm lives in instrumentation.ts and server.ts
 * (mirroring the better-sqlite3 `__betterSqlite3Warmed__` pattern), NOT here.
 * This adapter remains stateless — the pre-warm is a boot-time optimization
 * that calls `hash('warmup-payload', 4)` to JIT the native addon.
 */
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Auth:BcryptProvider');

type BcryptModule = {
  hash(data: string, saltOrRounds: string | number): Promise<string>;
  compare(data: string, encrypted: string): Promise<boolean>;
  genSalt(rounds?: number): Promise<string>;
};

let cachedModule: BcryptModule | null = null;

/**
 * Lazy-load the chosen bcrypt implementation. Cached after first call so
 * subsequent invocations skip the dynamic import overhead (sub-ms once
 * the module is in the require cache).
 */
async function getBcrypt(): Promise<BcryptModule> {
  if (cachedModule) return cachedModule;

  const useNative = process.env.BCRYPT_NATIVE_ENABLED === 'true';

  if (useNative) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nativeBcrypt = require('bcrypt') as BcryptModule;
      logger.info('[BcryptProvider] Using native bcrypt (BCRYPT_NATIVE_ENABLED=true)');
      cachedModule = nativeBcrypt;
      return cachedModule;
    } catch (err) {
      // Native module failed to load (missing compiler toolchain, incompatible
      // glibc, etc.). Fall back to bcryptjs and warn so ops knows why the
      // cold path is still slow.
      logger.warn(
        '[BcryptProvider] Native bcrypt failed to load — falling back to bcryptjs',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jsBcrypt = require('bcryptjs') as BcryptModule;
  if (!useNative) {
    logger.info('[BcryptProvider] Using bcryptjs (BCRYPT_NATIVE_ENABLED not set)');
  }
  cachedModule = jsBcrypt;
  return cachedModule;
}

/**
 * Hash a password with the selected bcrypt implementation.
 * saltRounds is preserved at 12 to match the pre-migration auth-service.ts
 * invariant — switching to native bcrypt does NOT reduce security margins.
 */
export async function hash(password: string, saltOrRounds: string | number): Promise<string> {
  const bcrypt = await getBcrypt();
  return bcrypt.hash(password, saltOrRounds);
}

/**
 * Verify a password against a bcrypt hash.
 */
export async function compare(password: string, hash: string): Promise<boolean> {
  const bcrypt = await getBcrypt();
  return bcrypt.compare(password, hash);
}

/**
 * Generate a salt for bcrypt hashing.
 */
export async function genSalt(rounds: number = 10): Promise<string> {
  const bcrypt = await getBcrypt();
  return bcrypt.genSalt(rounds);
}
