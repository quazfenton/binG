import { migrationRunner } from '../web/lib/database/migration-runner';

migrationRunner
  .runMigrations()
  .then(() => {
    console.log('\n✅ Migrations complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  });
