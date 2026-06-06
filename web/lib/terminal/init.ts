/**
 * Workspace Runtime Initialization
 *
 * Single boot function that ensures all workspace-runtime database tables
 * (workspace_processes, workspace_services, workspace_ports, workspace_env)
 * are created before any of the runtime registries are used.
 *
 * Consolidates three identical initializeDatabase() calls that were previously
 * duplicated across VirtualPidRegistry, WorkspaceServiceManager, and
 * WorkspacePreviewRegistry into one shared function.
 *
 * Usage:
 *   import { initializeWorkspaceRuntime } from '@/lib/terminal/init';
 *
 *   // Call once at application startup (server-side only)
 *   initializeWorkspaceRuntime();
 *
 * The function is idempotent (uses CREATE TABLE IF NOT EXISTS) and safe
 * to call in environments without SQLite — failures are caught and logged.
 */

import { createLogger } from '@/lib/utils/logger';
import { execSchemaFile } from '@/lib/database/schema';
import { getDatabase } from '@/lib/database/connection';

const logger = createLogger('WorkspaceRuntimeInit');

/**
 * Ensure all workspace-runtime database tables exist.
 *
 * Creates the following tables (if they don't already exist):
 *   - workspace_processes  — Virtual PID mappings (provider-agnostic process table)
 *   - workspace_services   — Long-running daemon services (npm run dev, flask, etc.)
 *   - workspace_ports      — Detected ports with preview URLs
 *   - workspace_env        — Workspace-scoped environment variables
 *
 * @param db - Optional database instance. If omitted, uses the global default.
 *             This parameter exists for test injection where you may want
 *             to pass an isolated database connection.
 *
 * Idempotent — safe to call multiple times.
 * Safe to call in environments without SQLite (e.g. Edge runtime, tests) —
 * failures are caught and logged, not thrown.
 */
export function initializeWorkspaceRuntime(db?: any): void {
  try {
    const database = db || getDatabase();
    execSchemaFile(database, 'workspace-schema');
    logger.debug('Workspace runtime DB tables initialized');
  } catch (error: any) {
    logger.warn('Workspace runtime DB table init skipped', { reason: error?.message });
  }
}
