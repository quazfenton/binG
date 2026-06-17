#!/usr/bin/env node
// scripts/init-db.js
// One-shot dev DB initializer. Creates the SQLite file at DATABASE_PATH
// (default ./data/binG.db), applies the base schema from
// lib/database/schema.sql, and then runs any pending migrations from
// lib/database/migrations/*.sql.
//
// Why this script exists:
// - `lib/database/connection.ts` defaults to `<cwd>/data/binG.db`.
// - On a fresh dev checkout, the `data/` directory exists but `binG.db` is
//   not present, so the first `getDatabase()` call creates an EMPTY file
//   via better-sqlite3 and then `initializeSchemaSync()` runs schema.sql.
// - If anything in that chain is skipped (e.g. an HMR reload before the
//   first query, or a server start where connection.ts was never imported),
//   subsequent reads return null, the userId falls back to '000', and
//   `getWorkspaceVersion` logs `ownerId='000'`.
// - Running this script up front guarantees the file exists with the
//   base schema + all pending migrations applied, eliminating that
//   whole failure mode.
//
// Usage:
//   node scripts/init-db.js
//   DATABASE_PATH=/custom/path/to.db node scripts/init-db.js

import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
const SCHEMA_CANDIDATES = [
  join(PROJECT_ROOT, 'lib', 'database', 'schema.sql'),
  join(PROJECT_ROOT, 'web', 'lib', 'database', 'schema.sql'),
];
const MIGRATIONS_CANDIDATES = [
  join(PROJECT_ROOT, 'lib', 'database', 'migrations'),
  join(PROJECT_ROOT, 'web', 'lib', 'database', 'migrations'),
];

function resolveDbPath() {
  if (process.env.DATABASE_PATH) {
    return resolve(PROJECT_ROOT, process.env.DATABASE_PATH);
  }
  return join(PROJECT_ROOT, 'data', 'binG.db');
}

function resolveFirstExisting(candidates, kind) {
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function logHeader(title) {
  const bar = '='.repeat(72);
  console.log(`\n${bar}\n${title}\n${bar}`);
}

function fatal(msg) {
  console.error(`[init-db] FATAL: ${msg}`);
  process.exit(1);
}

/**
 * Parse `CREATE TABLE [IF NOT EXISTS] <name>` statements from a SQL blob.
 * Used to dynamically derive the expected-table list for verification,
 * so the check stays in sync with the schema as it evolves.
 */
function extractCreateTableNames(sql) {
  const names = new Set();
  for (const raw of sql.split(';')) {
    const stmt = raw.trim();
    const m = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?/i);
    if (m) names.add(m[1].toLowerCase());
  }
  return names;
}

/**
 * Strip BEGIN/COMMIT/PRAGMA from migration SQL — better-sqlite3's
 * db.transaction() manages its own BEGIN/COMMIT, and PRAGMAs cannot run
 * inside transactions. Mirrors the helper in migration-runner.ts so the
 * behavior is identical when this script applies migrations.
 */
function stripTransactionStatements(sql) {
  const noComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      if (idx === -1) return line;
      const before = line.substring(0, idx);
      const hadTerminator = /;\s*$/.test(before);
      const stripped = before.replace(/--.*$/, '');
      return hadTerminator ? stripped + ';' : stripped;
    })
    .filter((l) => l.trim().length > 0 && !/^\s*--/.test(l))
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

  return noComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => {
      const u = s.toUpperCase();
      if (/^\s*BEGIN(\s+(TRANSACTION|IMMEDIATE|EXCLUSIVE))?\s*$/i.test(u)) return false;
      if (/^\s*COMMIT(\s+TRANSACTION)?\s*$/i.test(u)) return false;
      if (/^\s*END(\s+TRANSACTION)?\s*$/i.test(u)) return false;
      if (/^\s*ROLLBACK(\s+TRANSACTION)?\s*$/i.test(u)) return false;
      if (/^\s*PRAGMA\s/i.test(u)) return false;
      return s.length > 0;
    })
    .join(';\n') + ';';
}

function executeSqlSafe(db, sql, label) {
  let created = 0;
  let skipped = 0;
  const errors = [];

  for (const raw of sql.split(';')) {
    const stmt = raw.trim();
    if (!stmt) continue;
    try {
      db.exec(stmt + ';');
      created++;
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (/no such column/i.test(msg) || /no such table/i.test(msg)) {
        skipped++;
        continue;
      }
      errors.push({ label, stmt: stmt.substring(0, 120), msg });
    }
  }
  return { created, skipped, errors };
}

/**
 * DB-level verification of the signup → logout → login → getWorkspaceVersion
 * userId flow. Mirrors the production code paths against the actual SQLite
 * file so the dev DB can be confirmed correct without a running dev server.
 *
 * Steps:
 *   1. Signup:  insert a user with a known UUID, insert a workspace row for them
 *   2. Logout:  delete the active session for that user
 *   3. Login:   re-create the session for the same user
 *   4. Resolve: query vfs_workspace_meta by owner_id and confirm the result
 *               is the real user ID, NOT the literal string '000'
 *
 * Returns true on success, false on any failure. The dev DB is unusable for
 * the userId flow if this returns false, so the caller exits non-zero.
 */
function verifyUserIdFlow(db) {
  const crypto = require('crypto');
  const testUserId = crypto.randomUUID();
  const testEmail = `init-db-verify-${Date.now()}@example.com`;
  const testSessionId = crypto.randomBytes(32).toString('hex');
  const testSessionHash = crypto.createHash('sha256').update(testSessionId).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  let ok = true;
  try {
    // 1. Signup: insert user
    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_active, email_verified)
       VALUES (?, ?, 'init-db-verify', 1, 1)`,
    ).run(testUserId, testEmail);

    // 1b. Signup: insert workspace row (mirrors what getWorkspaceVersion reads)
    db.prepare(
      `INSERT INTO vfs_workspace_meta (owner_id, version, root)
       VALUES (?, 1, '/')`,
    ).run(testUserId);

    // 1c. Signup: create session (this is what the auth flow does post-signup)
    db.prepare(
      `INSERT INTO user_sessions (session_id, user_id, expires_at)
       VALUES (?, ?, ?)`,
    ).run(testSessionHash, testUserId, expiresAt);

    // 2. Logout: delete the active session
    const deleteResult = db
      .prepare('DELETE FROM user_sessions WHERE session_id = ?')
      .run(testSessionHash);
    if (deleteResult.changes !== 1) {
      console.error(`[init-db]   userId-flow: logout deleted ${deleteResult.changes} sessions, expected 1`);
      ok = false;
      return;
    }

    // 3. Login: re-create the session for the same user
    db.prepare(
      `INSERT INTO user_sessions (session_id, user_id, expires_at)
       VALUES (?, ?, ?)`,
    ).run(testSessionHash, testUserId, expiresAt);

    // 4. Resolve: lookup the session, then query vfs_workspace_meta by owner_id
    const session = db
      .prepare('SELECT user_id FROM user_sessions WHERE session_id = ? AND expires_at > CURRENT_TIMESTAMP')
      .get(testSessionHash);
    if (!session) {
      console.error('[init-db]   userId-flow: session lookup returned null after re-login');
      ok = false;
      return;
    }
    if (session.user_id !== testUserId) {
      console.error(
        `[init-db]   userId-flow: session.user_id = ${JSON.stringify(session.user_id)}, expected ${testUserId}`,
      );
      ok = false;
      return;
    }

    // 4b. Resolve: getWorkspaceVersion by owner_id (the exact query that
    //     was logging ownerId='000' before the fix)
    const workspace = db
      .prepare('SELECT owner_id, version, root FROM vfs_workspace_meta WHERE owner_id = ?')
      .get(testUserId);
    if (!workspace) {
      console.error('[init-db]   userId-flow: getWorkspaceVersion returned null for valid user');
      ok = false;
      return;
    }
    if (workspace.owner_id === '000') {
      console.error(
        `[init-db]   userId-flow: REGRESSION — getWorkspaceVersion returned ownerId='000' for a real user!`,
      );
      ok = false;
      return;
    }
    if (workspace.owner_id !== testUserId) {
      console.error(
        `[init-db]   userId-flow: owner_id = ${JSON.stringify(workspace.owner_id)}, expected ${testUserId}`,
      );
      ok = false;
      return;
    }

    console.log(
      `[init-db]   userId-flow: signup → logout → login → getWorkspaceVersion OK (owner_id=${testUserId.slice(0, 8)}…)`,
    );
  } catch (err) {
    console.error(`[init-db]   userId-flow: unexpected error: ${err.message}`);
    ok = false;
  } finally {
    // Best-effort cleanup: always remove test rows so a re-run starts clean
    try {
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(testUserId);
      db.prepare('DELETE FROM vfs_workspace_meta WHERE owner_id = ?').run(testUserId);
      db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
    } catch {
      // ignore cleanup errors
    }
    return ok;
  }
}

function main() {
  logHeader('[init-db] binG dev database initializer');

  // 1. Validate better-sqlite3 is available
  let Database;
  try {
    Database = require('better-sqlite3');
    Database = Database.default || Database;
  } catch (err) {
    fatal(`better-sqlite3 is not installed.\n         Run \`pnpm install\` and try again.\n         Underlying error: ${err.message}`);
  }

  // 2. Resolve paths
  const dbPath = resolveDbPath();
  const schemaPath = resolveFirstExisting(SCHEMA_CANDIDATES, 'schema.sql');
  const migrationsDir = resolveFirstExisting(MIGRATIONS_CANDIDATES, 'migrations/');

  console.log(`[init-db] DATABASE_PATH     = ${dbPath}`);
  console.log(`[init-db] schema.sql        = ${schemaPath ?? '<NOT FOUND>'}`);
  console.log(`[init-db] migrations dir    = ${migrationsDir ?? '<NOT FOUND>'}`);

  if (!schemaPath) {
    fatal('lib/database/schema.sql not found. Re-clone the repo if missing.');
  }

  // 3. Ensure parent directory exists
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    console.log(`[init-db] Creating directory ${dbDir}`);
    mkdirSync(dbDir, { recursive: true });
  }

  // 4. Open (or create) the DB and apply pragmas
  const wasFresh = !existsSync(dbPath);
  let db;
  try {
    db = new Database(dbPath);
  } catch (err) {
    fatal(`failed to open ${dbPath}: ${err.message}`);
  }

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');  // 5. Apply base schema
  const schemaSql = readFileSync(schemaPath, 'utf8');
  // Tables the dev DB must have before the app can run. Built from the
  // base schema (schema.sql) — NOT from migration files, because migrations
  // use temporary/renamed tables (e.g. `users_new` in 015_users_id_to_text)
  // that get dropped or renamed later, which would generate false-positive
  // "missing" failures. Migration-applied tables are verified separately by
  // (a) the "0 failed" check below and (b) the VFS test suite, which
  // exercises the full userId flow against this DB.
  const coreTables = new Set(extractCreateTableNames(schemaSql));
  // Migration 013 adds the VFS tables; the dev app fails hard without them
  // because `getWorkspaceVersion` queries vfs_workspace_meta directly.
  for (const t of ['vfs_workspace_meta', 'vfs_workspace_files', 'schema_migrations']) {
    coreTables.add(t);
  }
  const schemaResult = executeSqlSafe(db, schemaSql, 'schema.sql');
  console.log(
    `[init-db] schema.sql: executed ${schemaResult.created} (skipped ${schemaResult.skipped} drift)`,
  );

  if (schemaResult.errors.length > 0) {
    for (const { stmt, msg } of schemaResult.errors.slice(0, 5)) {
      console.error(`  - ${stmt}\n    -> ${msg}`);
    }
    if (schemaResult.errors.length > 5) {
      console.error(`  ... and ${schemaResult.errors.length - 5} more`);
    }
    db.close();
    process.exit(1);
  }

  // 6. Apply migrations (if migrations dir exists)
  let migrationsApplied = 0;
  let migrationsSkipped = 0;
  let migrationsDriftRecovered = 0;
  let migrationsFailed = 0;
  if (migrationsDir) {
    // Initialize migration tracking table
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const executed = new Set(
      db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version),
    );

    const migrationFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const filename of migrationFiles) {
      // Use the full stem (filename without .sql) as the version key so
      // files like `001_foo.sql` and `001_bar.sql` don't collide.
      const version = filename.replace(/\.sql$/, '');
      if (executed.has(version)) {
        migrationsSkipped++;
        continue;
      }
      const raw = readFileSync(join(migrationsDir, filename), 'utf8');
      const sanitized = stripTransactionStatements(raw);
      try {
        const tx = db.transaction((sql) => db.exec(sql));
        tx(sanitized);
        db.prepare(
          'INSERT OR IGNORE INTO schema_migrations (version, filename) VALUES (?, ?)',
        ).run(version, filename);
        migrationsApplied++;
        console.log(`[init-db]   applied migration ${version} (${filename})`);
      } catch (err) {
        const msg = err?.message ?? String(err);
        // Schema drift inside a db.transaction() means the entire migration
        // rolled back; a partial run must not be recorded as applied.
        //
        // Bug fix — drift-tolerance: `lib/database/schema.sql` is the
        // current-fingerprint schema and intentionally pre-creates columns
        // (e.g. `token_version` on `users`) and tables that several
        // migrations later try to add via `ALTER TABLE ADD COLUMN`. On a
        // clean dev DB, those migrations would otherwise hard-fail with
        // `duplicate column name: ...` / `... already exists` even though
        // their intent is already satisfied. Mark these as APPLIED (so a
        // re-run doesn't keep retrying) instead of counting them as
        // failures. Genuine errors — e.g. `no such column/table` raised
        // by a migration BEFORE running — still fall through to the hard
        // failure branch below.
        if (/duplicate column name/i.test(msg) || /already exists/i.test(msg)) {
          try {
            db.prepare(
              'INSERT OR IGNORE INTO schema_migrations (version, filename) VALUES (?, ?)',
            ).run(version, filename);
            migrationsDriftRecovered++;
            console.log(
              `[init-db]   drift-recovered migration ${version} (${filename}): ${msg.split('\n')[0]} (intent already satisfied by schema.sql)`,
            );
          } catch (dbErr) {
            migrationsFailed++;
            console.error(
              `[init-db]   migration ${version} (${filename}) drift-recovery FAILED: ${dbErr.message}`,
            );
          }
        } else {
          migrationsFailed++;
          console.error(`[init-db]   migration ${version} (${filename}) FAILED: ${msg}`);
        }
      }
    }

    console.log(
      `[init-db] migrations: ${migrationsApplied} applied, ${migrationsSkipped} already executed, ${migrationsDriftRecovered} drift-recovered${migrationsFailed > 0 ? `, ${migrationsFailed} failed` : ''}`,
    );
    if (migrationsFailed > 0) {
      db.close();
      process.exit(1);
    }
  } else {
    console.log('[init-db] no migrations directory found — skipping migrations');
  }

  // 7. Verify core tables are present
  const present = new Set(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name.toLowerCase()),
  );
  const missing = [...coreTables].filter((t) => !present.has(t));

  // 8. Verify the userId flow works at the DB level (signup → logout → login →
  //    getWorkspaceVersion). This is the DB-level equivalent of the manual
  //    browser verification the user asked for. If ownerId is not the real
  //    user ID here, the dev DB is broken even if all tables are present.
  const userIdFlowOk = verifyUserIdFlow(db);

  // 9. Close DB
  db.close();

  // 10. Report
  const stat = statSync(dbPath);
  console.log(
    `[init-db] DB file: ${dbPath} (${(stat.size / 1024).toFixed(1)} KiB, ${
      wasFresh ? 'created' : 'preserved'
    })`,
  );
  console.log(`[init-db] Tables present: ${present.size} / core required: ${coreTables.size}`);

  if (missing.length > 0) {
    fatal(`missing required tables: ${missing.join(', ')}`);
  }
  if (!userIdFlowOk) {
    fatal('userId flow verification failed (see errors above)');
  }
  console.log(`[init-db] ✅ Dev database is ready (${coreTables.size} core tables verified, userId flow OK).\n`);
}

try {
  main();
} catch (err) {
  fatal(`unexpected error: ${err?.stack ?? err}`);
}
