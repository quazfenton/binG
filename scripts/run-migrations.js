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

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Change to project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
process.chdir(projectRoot);

console.log('🔧 Running database migrations from:', projectRoot, '\n');

try {
  // Run migrations using tsx to execute the TypeScript migration runner
  execSync(
    'npx tsx scripts/run-migrations.ts',
    {
      stdio: 'inherit',
      cwd: projectRoot,
    }
  );
  console.log('\n✅ All migrations completed successfully!');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Migration failed. Check the error above.');
  console.error('\n💡 Tip: Make sure your database is accessible and migration files exist in lib/database/migrations/');
  process.exit(1);
}
