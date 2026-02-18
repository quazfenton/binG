/**
 * Database Migration Runner
 * 
 * Usage:
 *   pnpm migrate
 *   # or
 *   npm run migrate
 *   # or
 *   yarn migrate
 * 
 * This script runs all pending database migrations automatically.
 * Migrations are tracked in the `schema_migrations` table.
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('🔧 Running database migrations...\n');

try {
  // Run migrations using tsx (TypeScript executor) which is already a dependency
  execSync(
    `npx tsx -e "import { migrationRunner } from '../lib/database/migration-runner'; migrationRunner.runMigrations().then(() => console.log('\\n✅ Migrations complete')).catch(err => { console.error('\\n❌ Migration failed:', err); process.exit(1); })"`,
    {
      stdio: 'inherit',
      cwd: __dirname,
    }
  );
  console.log('\n✅ All migrations completed successfully!');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Migration failed. Check the error above.');
  console.error('\n💡 Tip: Make sure your database is accessible and migration files exist in lib/database/migrations/');
  process.exit(1);
}
