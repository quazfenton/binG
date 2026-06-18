/**
 * Database Resilience Layer
 *
 * Attempts to connect to local DB; if failing, pulls encrypted backup
 * and restores it to local.
 *
 * SEV-11 (2026-06-18 fix): The previous code used bare
 * `require('better-sqlite3')` at two sites. That is fine in a CJS file, but
 * this file is loaded from a path that runs under the project's
 * `"type": "module"` package where `require` is NOT a global. In pure ESM
 * contexts (Node 24 strict ESM, vitest forks pool, Next.js / turbopack
 * server-only paths) the call throws `ReferenceError: require is not
 * defined` BEFORE better-sqlite3's native binding even gets a chance to
 * load — the resulting warn line in `classifySqliteFailure` for
 * TerminalSessionManager was misleading operators with
 * `kind: 'unknown', hint: 'rebuild better-sqlite3'` even though no
 * rebuild would ever fix it.
 *
 * Replace both bare-require sites with a guarded `await import()` that
 * mirrors the dynamic-import wrapper pattern used in lib/tools/tool-call-tracker.ts.
 * The wrapper guards against ALL failure modes, classifies any error via
 * the same SEV-8/SEV-9 diagnostic taxonomy in lib/storage/session-store.ts,
 * and returns the actual constructor (or null on failure) so callers can
 * fall through gracefully.
 */

import { DatabaseBackupService } from './backup-service';
import fs from 'fs';
import { classifySqliteFailure } from '@/lib/database/sqlite-failure';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Database:ResilienceLayer');

async function loadBetterSqlite(): Promise<any | null> {
  try {
    const mod = await import('better-sqlite3');
    // better-sqlite3 is CJS — Node's ESM import wraps the default export.
    return (mod as any).default ?? mod;
  } catch (err) {
    logger.warn(
      '[Database] better-sqlite3 dynamic import failed – using fallback',
      classifySqliteFailure(err),
    );
    return null;
  }
}

export async function getDatabaseConnection() {
  const DB_PATH = process.env.DATABASE_PATH || './database.sqlite';

  try {
    // Attempt local access
    if (fs.existsSync(DB_PATH)) {
      const Database = await loadBetterSqlite();
      if (!Database) throw new Error('better-sqlite3 unavailable');
      return new Database(DB_PATH);
    }
    throw new Error('Local database missing');
  } catch (e) {
    console.warn('[Database] Local DB failed, attempting external recovery...');

    // Recovery flow
    const backupService = new DatabaseBackupService();
    // 1. Download latest from S3 (pseudocode)
    // 2. Decrypt
    await backupService.decryptLocal('./backup.sqlite.enc', DB_PATH);

    const Database = await loadBetterSqlite();
    if (!Database) throw new Error('better-sqlite3 unavailable after recovery');
    return new Database(DB_PATH);
  }
}
