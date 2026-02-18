# Database Migrations

This project uses a migration system to manage database schema changes. Migrations are automatically applied on app startup, but can also be run manually.

## Automatic Migrations

By default, migrations run automatically when the app starts. This is controlled by the `AUTO_RUN_MIGRATIONS` environment variable:

```bash
# Enable auto-migrations (default)
AUTO_RUN_MIGRATIONS=true

# Disable auto-migrations
AUTO_RUN_MIGRATIONS=false
```

## Manual Migration

To run migrations manually:

```bash
# Using pnpm
pnpm migrate

# Using npm
npm run migrate

# Using yarn
yarn migrate
```

## Creating New Migrations

1. Create a new SQL file in `lib/database/migrations/`
2. Name it with format: `NNN_description.sql` (e.g., `004_add_user_preferences.sql`)
3. The migration will be automatically detected and run on next startup

Example migration file:

```sql
-- Migration 004: Add user preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  preference_key TEXT NOT NULL,
  preference_value TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, preference_key)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id 
ON user_preferences(user_id);
```

## Migration Files

Current migrations:

- `001_user_authentication.sql` - Users and sessions tables
- `002_oauth_integration.sql` - OAuth connections and sessions
- `003_quota_tracking.sql` - Provider quota tracking

## Troubleshooting

### Migration fails with "table already exists"

This is normal - the migrations use `CREATE TABLE IF NOT EXISTS`. The migration runner tracks which migrations have been applied in the `schema_migrations` table.

### Migration fails with "no such table"

Make sure previous migrations have run. Check the `schema_migrations` table:

```sql
SELECT * FROM schema_migrations ORDER BY version;
```

### Reset migrations

To reset and re-run all migrations:

```sql
-- WARNING: This will delete all migration tracking
DROP TABLE IF EXISTS schema_migrations;
```

Then run: `pnpm migrate`

## Production Deployment

In production, you have several options:

### Option 1: Auto-migrate on startup (Recommended for small apps)
```bash
# .env.production
AUTO_RUN_MIGRATIONS=true
```

### Option 2: Manual migration before deploy
```bash
# In your CI/CD pipeline:
npm run migrate
npm start
```

### Option 3: Separate migration job
```bash
# Run migrations as a separate step
node scripts/run-migrations.js && npm start
```

## Database Location

The SQLite database is stored at:
- Development: `data/binG.db` (in project root)
- Production: Configured via `DATABASE_PATH` environment variable

```bash
# Custom database path
DATABASE_PATH=/var/lib/myapp/database.db
```
