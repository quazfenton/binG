/**
 * Core Schema Loader
 *
 * Reads any .sql file from the schema/ directory at runtime with module-level caching.
 * All database table definitions live in .sql files here — never inline in TypeScript —
 * to prevent the kind of drift that caused the user_sessions / performance-indexes bug.
 *
 * Usage:
 *   import { getSqlFromFile } from './schema/loader';
 *   const schema = getSqlFromFile('events-schema');
 *   db.exec(schema);
 *
 * Returns empty string during build/Edge where fs access is unavailable.
 */

// Module-level cache — read each file once
const _cache: Record<string, string> = {};

function shouldSkipDbInit(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = typeof process !== 'undefined' ? (process as any).env : {};
  return (
    env.SKIP_DB_INIT === 'true' ||
    env.SKIP_DB_INIT === '1' ||
    env.NEXT_BUILD === 'true' ||
    env.NEXT_BUILD === '1' ||
    env.NEXT_PHASE === 'build' ||
    env.NEXT_PHASE === 'export' ||
    env.NEXT_PHASE === 'phase-production-build' ||
    env.NEXT_PHASE === 'phase-export'
  );
}

function isEdgeRuntime(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof (process as any)?.versions?.node === 'undefined';
}

/**
 * Load SQL content from a schema file, with module-level caching.
 *
 * @param name  Filename without .sql extension (e.g. 'events-schema', 'approval-requests')
 * @returns     The file contents, or empty string on build/Edge/fs error.
 */
export function getSqlFromFile(name: string): string {
  if (_cache[name] !== undefined) {
    return _cache[name];
  }

  // Guard: skip fs access during build or in Edge Runtime
  if (shouldSkipDbInit() || isEdgeRuntime()) {
    _cache[name] = '';
    return _cache[name];
  }

  // Guard: skip if require/fs are unavailable
  if (typeof require === 'undefined' || typeof process === 'undefined') {
    _cache[name] = '';
    return _cache[name];
  }

  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const cwd = process.cwd?.() ?? '.';
    const sqlPath = join(cwd, 'lib', 'database', 'schema', `${name}.sql`);
    _cache[name] = readFileSync(sqlPath, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[DB Schema] Could not read ${name}.sql: ${msg}`);
    _cache[name] = '';
  }

  return _cache[name];
}

/**
 * Execute a schema SQL file against the given database instance.
 * Convenience wrapper that calls getSqlFromFile() then db.exec().
 *
 * @param db    An initialized better-sqlite3 database instance
 * @param name  Filename without .sql extension
 */
export function execSchemaFile(db: any, name: string): void {
  const sql = getSqlFromFile(name);
  if (sql) {
    db.exec(sql);
  }
}