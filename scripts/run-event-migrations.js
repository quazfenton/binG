#!/usr/bin/env node

/**
 * Database Migration Runner for Event System
 *
 * Runs all pending migrations for the event system tables.
 * Usage: node scripts/run-event-migrations.js
 */

const { getDatabase } = require('../lib/database/connection');
const { readFileSync } = require('fs');
const { join } = require('path');

const MIGRATIONS = [
  {
    name: '001-events-table',
    file: join(__dirname, '..', 'lib', 'database', 'migrations', '001-events-table.sql'),
  },
  {
    name: '002-scheduled-tasks',
    file: join(__dirname, '..', 'lib', 'database', 'migrations', '002-scheduled-tasks.sql'),
  },
  {
    name: '003-approval-requests',
    file: join(__dirname, '..', 'lib', 'database', 'migrations', '003-approval-requests.sql'),
  },
  {
    name: '004-event-healing-log',
    file: join(__dirname, '..', 'lib', 'database', 'migrations', '004-event-healing-log.sql'),
  },
];

async function runMigrations() {
  console.log('🚀 Running event system migrations...\n');

  const db = getDatabase();

  // Create migrations tracking table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      run_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  let completed = 0;
  let skipped = 0;
  let errors = 0;

  for (const migration of MIGRATIONS) {
    try {
      // Check if already run
      const exists = db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(migration.name);

      if (exists) {
        console.log(`⏭️  ${migration.name} (already run)`);
        skipped++;
        continue;
      }

      // Read and run migration
      console.log(`📝 Running ${migration.name}...`);
      const sql = readFileSync(migration.file, 'utf-8');

      // Split by semicolons and run each statement
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        db.prepare(statement).run();
      }

      // Mark as complete
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);

      console.log(`✅ ${migration.name} completed`);
      completed++;
    } catch (error) {
      console.error(`❌ ${migration.name} failed:`, error.message);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Completed: ${completed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log('='.repeat(50));

  if (errors > 0) {
    console.error('\n⚠️  Some migrations failed. Please fix the errors and re-run.');
    process.exit(1);
  } else {
    console.log('\n✨ All migrations completed successfully!');
  }
}

// Run migrations
runMigrations().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
