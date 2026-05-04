// Note: fs and path modules are lazy-loaded to avoid Edge Runtime issues
// They are only used at runtime, not at module load time
// This file is server-only - do not import in Client Components
export const runtime = 'nodejs';

interface Migration {
  version: string;
  filename: string;
  sql: string;
}

export class MigrationRunner {
  private db: any;
  private migrationsPath: string;
  private initialized = false;

  constructor() {
    // Lazy initialization - don't access database or file system at construction time
    // This prevents Edge Runtime errors during build
    this.migrationsPath = '';
    this.db = null;
  }

  /**
   * Initialize the migration runner (lazy initialization)
   * Must be called before running migrations to avoid Edge Runtime issues
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Only run migrations in Node.js runtime
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      console.log('[MigrationRunner] Skipping initialization in Edge Runtime');
      this.migrationsPath = './lib/database/migrations';
      this.initialized = true;
      return;
    }

    // Dynamic import to avoid Node.js API usage at module load time
    // This prevents build failures in Edge Runtime and during Next.js builds
    const connectionModule = await import('./connection');
    this.db = await connectionModule.getDatabase();

    // Resolve migrations directory using the shared multi-strategy path resolver.
    // existsSync works on directories, so resolveSqlPath can find the migrations folder.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof process !== 'undefined' && (process as any).cwd && process.env.NEXT_RUNTIME === 'nodejs') {
      const { resolveSqlPath } = require('./schema/loader');
      const pathModule = require('path');
      const resolved = resolveSqlPath(['lib', 'database', 'migrations']);
      if (resolved) {
        this.migrationsPath = resolved;
      } else {
        // Fallback: construct the cwd-based path even if it doesn't exist yet
        this.migrationsPath = pathModule.join((process as any).cwd(), 'lib', 'database', 'migrations');
      }
    } else {
      // Fallback for Edge Runtime - this won't actually run migrations in Edge
      this.migrationsPath = './lib/database/migrations';
    }

    this.initializeMigrationsTable();
    this.initialized = true;
  }

  private initializeMigrationsTable() {
    // Create migrations tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  private getExecutedMigrations(): Set<string> {
    if (!this.db) {
      return new Set();
    }

    const stmt = this.db.prepare('SELECT version FROM schema_migrations');
    const results = stmt.all();
    return new Set(results.map((row: any) => row.version));
  }

  private async getMigrationFiles(): Promise<Migration[]> {
    // Only read migration files in Node.js runtime
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      console.log('[MigrationRunner] Skipping file read in Edge Runtime');
      return [];
    }
    
    try {
      // Use require instead of dynamic import to avoid Edge Runtime analysis
      const fsModule = require('fs');
      const pathModule = require('path');
      const readdirSync = fsModule.readdirSync;
      const readFileSync = fsModule.readFileSync;
      const join = pathModule.join;

      const files = readdirSync(this.migrationsPath)
        .filter((file: string) => file.endsWith('.sql'))
        .sort();

      return files.map((filename: string) => {
        // Extract version: handle both underscore and hyphen separators
        // e.g., "001_events.sql" → "001", "003-approval-requests.sql" → "003"
        const version = filename.split(/[_-]/)[0];
        const sql = readFileSync(join(this.migrationsPath, filename), 'utf-8');
        return { version, filename, sql };
      });
    } catch (error) {
      console.warn('Migrations directory not found, skipping migrations');
      return [];
    }
  }

  public async runMigrationsSync(): Promise<void> {
    await this.initialize(); // Ensure lazy initialization before running migrations
    if (!this.db) {
      return;
    }

    const executedMigrations = this.getExecutedMigrations();
    const migrationFiles = await this.getMigrationFiles();

    const pendingMigrations = migrationFiles.filter(
      migration => !executedMigrations.has(migration.version)
    );

    if (pendingMigrations.length === 0) {
      console.log('No pending migrations');
      return;
    }

    console.log(`Running ${pendingMigrations.length} pending migrations...`);

    for (const migration of pendingMigrations) {
      try {
        console.log(`Executing migration ${migration.version}: ${migration.filename}`);

        // Check if migration is already executed
        const alreadyExecuted = this.db.prepare(
          'SELECT 1 FROM schema_migrations WHERE version = ?'
        ).get(migration.version);

        if (alreadyExecuted) {
          console.log(`Migration ${migration.version} already executed, skipping`);
        } else {
          // Wrap migration execution in a transaction to ensure atomicity
          const transaction = this.db.transaction((sql: string) => {
            this.db.exec(sql);
          });

          try {
            transaction(migration.sql);
          } catch (err: any) {
            // Re-throw if transaction fails so outer loop catches and stops
            throw new Error(`Transaction failed: ${err.message}`);
          }

          // Record migration as executed
          const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO schema_migrations (version, filename)
            VALUES (?, ?)
          `);
          stmt.run(migration.version, migration.filename);

          console.log(`Migration ${migration.version} completed successfully`);
        }
      } catch (error) {
        console.error(`Migration ${migration.version} failed:`, error);
        throw error;
      }
    }

    console.log('All migrations completed successfully');
  }

  public async runMigrations(): Promise<void> {
    // Delegate to synchronous implementation after lazy init
    await this.initialize();
    await this.runMigrationsSync();
  }

  public async rollbackMigration(version: string): Promise<void> {
    await this.initialize(); // Ensure lazy initialization
    if (!this.db) {
      return;
    }

    // Note: This is a basic rollback - in production you'd want proper rollback scripts
    console.warn(`Rollback requested for migration ${version}`);
    console.warn('Manual rollback required - check migration file for rollback instructions');
    
    // Remove from migrations table
    const stmt = this.db.prepare('DELETE FROM schema_migrations WHERE version = ?');
    stmt.run(version);
    
    console.log(`Migration ${version} marked as not executed`);
  }

  public async getExecutedMigrationsList(): Promise<any[]> {
    await this.initialize(); // Ensure lazy initialization
    if (!this.db) {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT version, filename, executed_at 
      FROM schema_migrations 
      ORDER BY version
    `);
    return stmt.all();
  }
}

/**
 * Get MigrationRunner singleton instance
 * Uses lazy initialization to avoid Edge Runtime issues during build
 */
let migrationRunnerInstance: MigrationRunner | null = null;

export function getMigrationRunner(): MigrationRunner {
  if (!migrationRunnerInstance) {
    migrationRunnerInstance = new MigrationRunner();
  }
  return migrationRunnerInstance;
}

// Keep backward compatibility - but mark as deprecated
export const migrationRunner = {
  get instance() {
    return getMigrationRunner();
  },
  runMigrationsSync() {
    return getMigrationRunner().runMigrationsSync();
  },
  runMigrations() {
    return getMigrationRunner().runMigrations();
  },
  rollbackMigration(version: string) {
    return getMigrationRunner().rollbackMigration(version);
  },
  getExecutedMigrationsList() {
    return getMigrationRunner().getExecutedMigrationsList();
  },
};
