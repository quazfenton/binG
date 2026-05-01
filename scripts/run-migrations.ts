import { migrationRunner } from '../web/lib/database/migration-runner';

migrationRunner
  .runMigrations()
  .then(async () => {
    console.log('\n✅ Migrations complete');
    // Ensure logs are flushed
    await new Promise(resolve => setTimeout(resolve, 100));
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Migration failed:', err instanceof Error ? err.stack : JSON.stringify(err));
    process.exit(1);
  });
