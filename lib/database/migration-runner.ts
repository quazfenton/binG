// Note: fs and path modules are lazy-loaded to avoid Edge Runtime issues
// They are only used at runtime, not at module load time

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
  private initialize(): void {
    if (this.initialized) return;
    
    // Dynamic import to avoid Node.js API usage at module load time
    // This prevents build failures in Edge Runtime and during Next.js builds
    const { getDatabase } = require('./connection');
    this.db = getDatabase();
    
    // Use process.cwd() only at runtime in Node.js environment
    // Not available in Edge Runtime - use a fallback path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasProcessCwd = typeof process !== 'undefined' && (process as any).cwd;
    if (hasProcessCwd) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { join } = require('path') as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.migrationsPath = join((process as any).cwd(), 'lib', 'database', 'migrations');
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
    const stmt = this.db.prepare('SELECT version FROM schema_migrations');
    const results = stmt.all();
    return new Set(results.map((row: any) => row.version));
  }

  private getMigrationFiles(): Migration[] {
    try {
      // Lazy-load fs and path modules at runtime, not at module load
      const { readdirSync, readFileSync } = require('fs');
      const { join } = require('path');
      
      const files = readdirSync(this.migrationsPath)
        .filter((file: string) => file.endsWith('.sql'))
        .sort();

      return files.map((filename: string) => {
        const version = filename.split('_')[0];
        const sql = readFileSync(join(this.migrationsPath, filename), 'utf-8');
        return { version, filename, sql };
      });
    } catch (error) {
      console.warn('Migrations directory not found, skipping migrations');
      return [];
    }
  }

  public runMigrationsSync(): void {
    this.initialize(); // Ensure lazy initialization before running migrations
    const executedMigrations = this.getExecutedMigrations();
    const migrationFiles = this.getMigrationFiles();

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

        // Execute migration in a transaction
        this.db.transaction(() => {
          // Double-check if migration was already executed (e.g. by another process)
          const alreadyExecuted = this.db.prepare(
            'SELECT 1 FROM schema_migrations WHERE version = ?'
          ).get(migration.version);

          if (alreadyExecuted) {
            console.log(`Migration ${migration.version} already executed, skipping`);
            return;
          }

          this.db.exec(migration.sql);

          // Record migration as executed
          const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO schema_migrations (version, filename)
            VALUES (?, ?)
          `);
          stmt.run(migration.version, migration.filename);
        })();

        console.log(`Migration ${migration.version} completed successfully`);
      } catch (error) {
        console.error(`Migration ${migration.version} failed:`, error);
        throw error;
      }
    }

    console.log('All migrations completed successfully');
  }

  public async runMigrations(): Promise<void> {
    // Delegate to synchronous implementation after lazy init
    this.initialize();
    this.runMigrationsSync();
  }

  public async rollbackMigration(version: string): Promise<void> {
    this.initialize(); // Ensure lazy initialization
    // Note: This is a basic rollback - in production you'd want proper rollback scripts
    console.warn(`Rollback requested for migration ${version}`);
    console.warn('Manual rollback required - check migration file for rollback instructions');
    
    // Remove from migrations table
    const stmt = this.db.prepare('DELETE FROM schema_migrations WHERE version = ?');
    stmt.run(version);
    
    console.log(`Migration ${version} marked as not executed`);
  }

  public getExecutedMigrationsList(): any[] {
    this.initialize(); // Ensure lazy initialization
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
