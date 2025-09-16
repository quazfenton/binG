import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getDatabase } from './connection';

interface Migration {
  version: string;
  filename: string;
  sql: string;
}

export class MigrationRunner {
  private db: any;
  private migrationsPath: string;

  constructor() {
    this.db = getDatabase();
    this.migrationsPath = join(__dirname, 'migrations');
    this.initializeMigrationsTable();
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
      const files = readdirSync(this.migrationsPath)
        .filter(file => file.endsWith('.sql'))
        .sort();

      return files.map(filename => {
        const version = filename.split('_')[0];
        const sql = readFileSync(join(this.migrationsPath, filename), 'utf-8');
        return { version, filename, sql };
      });
    } catch (error) {
      console.warn('Migrations directory not found, skipping migrations');
      return [];
    }
  }

  public async runMigrations(): Promise<void> {
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
          this.db.exec(migration.sql);
          
          // Record migration as executed
          const stmt = this.db.prepare(`
            INSERT INTO schema_migrations (version, filename)
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

  public async rollbackMigration(version: string): Promise<void> {
    // Note: This is a basic rollback - in production you'd want proper rollback scripts
    console.warn(`Rollback requested for migration ${version}`);
    console.warn('Manual rollback required - check migration file for rollback instructions');
    
    // Remove from migrations table
    const stmt = this.db.prepare('DELETE FROM schema_migrations WHERE version = ?');
    stmt.run(version);
    
    console.log(`Migration ${version} marked as not executed`);
  }

  public getExecutedMigrationsList(): any[] {
    const stmt = this.db.prepare(`
      SELECT version, filename, executed_at 
      FROM schema_migrations 
      ORDER BY version
    `);
    return stmt.all();
  }
}

// Export singleton instance
export const migrationRunner = new MigrationRunner();

// Auto-run migrations on import (can be disabled with env var)
if (process.env.AUTO_RUN_MIGRATIONS !== 'false') {
  migrationRunner.runMigrations().catch(console.error);
}