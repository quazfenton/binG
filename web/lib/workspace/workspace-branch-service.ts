/**
 * Workspace Branch Service (Gap #1 closure: Workspace Forking/Branching)
 *
 * Enables environment-level branching where an entire workspace (files, services,
 * processes, env vars, and database state) can be forked into a new branch that
 * diverges independently. Each branch retains a full lineage back to the root.
 *
 * Key operations:
 *   - forkWorkspace(): Deep-copy a workspace into a new named branch
 *   - getBranches(): List all branches for a root workspace
 *   - getLineage(): Trace the ancestor chain back to the root
 *
 * Branch workspaceId convention: parentWorkspaceId#branchName
 *   e.g., "user-123:conv-abc" forked to "feature-x" → "user-123:conv-abc#feature-x"
 *   Forks from forks produce nested segments: "user-123:conv-abc#feature-x#sub-feature"
 *   Root resolution is always done via DB root_workspace_id, not string parsing.
 *
 * @module workspace/workspace-branch-service
 */

import { getDatabase } from '@/lib/database/connection-shim';
import { execSchemaFile } from '@/lib/database/schema';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('WorkspaceBranch');

// ============================================================================
// Types
// ============================================================================

export type BranchStatus = 'active' | 'archived' | 'merged';

export interface WorkspaceBranch {
  id: number;
  workspaceId: string;
  branchName: string;
  parentWorkspaceId: string | null;
  rootWorkspaceId: string;
  userId: string;
  forkedFromSnapshotId: string | null;
  status: BranchStatus;
  createdAt: string;
  lastAccessedAt: string | null;
  metadata: string | null;
}

export interface ForkResult {
  success: boolean;
  branchWorkspaceId: string;
  branchName: string;
  parentWorkspaceId: string;
  error?: string;
}

export interface BranchList {
  branches: WorkspaceBranch[];
  root: WorkspaceBranch | null;
}

// ============================================================================
// Workspace Branch Service
// ============================================================================

export class WorkspaceBranchService {
  private initialized = false;

  ensureInitialized(): void {
    if (this.initialized) return;
    try {
      const db = getDatabase();
      if (!db) return;
      execSchemaFile(db, '022_workspace_branches');
      this.initialized = true;
      logger.info('Workspace branches table initialized');
    } catch (error: any) {
      logger.warn('Failed to initialize workspace branches table', { error: error.message });
    }
  }

  // ==========================================================================
  // Fork
  // ==========================================================================

  /**
   * Fork an existing workspace into a new named branch.
   *
   * Creates a copy of the workspace state including:
   * - Environment variables (copied from workspace_env table)
   * - Service metadata (copied with 'stopped' status — services don't auto-run in forks)
   *
   * File system forking is handled separately by the sandbox orchestor layer
   * (via workspaceFSSnapshotService), which has access to the active sandbox handle.
   *
   * @param sourceWorkspaceId - The workspace to fork from (e.g., "user-123:conv-abc")
   * @param branchName - Name for the new branch (e.g., "feature-x", "experiment")
   * @param userId - Owner of the fork
   * @param description - Optional description for the branch
   */
  async forkWorkspace(
    sourceWorkspaceId: string,
    branchName: string,
    userId: string,
    description?: string,
  ): Promise<ForkResult> {
    this.ensureInitialized();

    const db = getDatabase();
    if (!db) {
      return { success: false, branchWorkspaceId: '', branchName, parentWorkspaceId: sourceWorkspaceId, error: 'Database unavailable' };
    }

    // Validate branch name
    if (!branchName || !/^[a-zA-Z0-9_-]+$/.test(branchName)) {
      return { success: false, branchWorkspaceId: '', branchName, parentWorkspaceId: sourceWorkspaceId, error: 'Branch name must be alphanumeric (a-z, 0-9, _, -)' };
    }

    // Construct the new branch workspaceId
    const branchWorkspaceId = `${sourceWorkspaceId}#${branchName}`;

    // Check if branch already exists
    const existing = db.prepare(
      'SELECT id FROM workspace_branches WHERE workspace_id = ?'
    ).get(branchWorkspaceId);
    if (existing) {
      return { success: false, branchWorkspaceId, branchName, parentWorkspaceId: sourceWorkspaceId, error: `Branch "${branchName}" already exists` };
    }

    try {
      // Resolve root workspace: if source is itself a branch, trace to root
      const rootId = this.resolveRootWorkspace(sourceWorkspaceId);

      // 1. Copy workspace env vars to the new branch
      this.copyEnvVars(sourceWorkspaceId, branchWorkspaceId);

      // 2. Copy workspace service metadata to the new branch
      this.copyServiceMetadata(sourceWorkspaceId, branchWorkspaceId, userId);

      // 3. Register the branch in workspace_branches
      db.prepare(`
        INSERT INTO workspace_branches
          (workspace_id, branch_name, parent_workspace_id, root_workspace_id,
           user_id, status, metadata, last_accessed_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)
      `).run(
        branchWorkspaceId,
        branchName,
        sourceWorkspaceId,
        rootId,
        userId,
        description ? JSON.stringify({ description }) : null,
      );

      // Also ensure the root workspace is registered (if not already)
      this.ensureRootRegistered(rootId, userId);

      logger.info('Workspace forked successfully', {
        sourceWorkspaceId: sourceWorkspaceId.slice(0, 24),
        branchWorkspaceId: branchWorkspaceId.slice(0, 32),
        branchName,
        rootId: rootId.slice(0, 24),
      });

      return {
        success: true,
        branchWorkspaceId,
        branchName,
        parentWorkspaceId: sourceWorkspaceId,
      };
    } catch (error: any) {
      logger.error('Failed to fork workspace', {
        sourceWorkspaceId: sourceWorkspaceId.slice(0, 24),
        branchName,
        error: error.message,
      });
      return {
        success: false,
        branchWorkspaceId,
        branchName,
        parentWorkspaceId: sourceWorkspaceId,
        error: error.message,
      };
    }
  }

  // ==========================================================================
  // Query
  // ==========================================================================

  /**
   * Get all branches for a root workspace, including the root itself.
   */
  getBranches(workspaceId: string): BranchList {
    this.ensureInitialized();

    const db = getDatabase();
    if (!db) return { branches: [], root: null };

    try {
      const rootId = this.resolveRootWorkspace(workspaceId);

      const branches = db.prepare(`
        SELECT * FROM workspace_branches
        WHERE root_workspace_id = ? AND status = 'active'
        ORDER BY created_at DESC
      `).all(rootId) as WorkspaceBranch[];

      const root = branches.find(b => b.parentWorkspaceId === null) || null;

      return { branches, root };
    } catch (error: any) {
      logger.error('Failed to get branches', { workspaceId: workspaceId.slice(0, 24), error: error.message });
      return { branches: [], root: null };
    }
  }

  /**
   * Get a specific branch by workspaceId.
   */
  getBranch(workspaceId: string): WorkspaceBranch | null {
    this.ensureInitialized();

    const db = getDatabase();
    if (!db) return null;

    try {
      const row = db.prepare(
        'SELECT * FROM workspace_branches WHERE workspace_id = ?'
      ).get(workspaceId) as WorkspaceBranch | undefined;

      if (row) {
        // Touch last_accessed_at
        db.prepare(
          'UPDATE workspace_branches SET last_accessed_at = CURRENT_TIMESTAMP WHERE workspace_id = ?'
        ).run(workspaceId);
      }

      return row || null;
    } catch (error: any) {
      logger.warn('Failed to get branch', { workspaceId: workspaceId.slice(0, 32), error: error.message });
      return null;
    }
  }

  /**
   * Get the lineage (ancestor chain) for a workspace.
   */
  getLineage(workspaceId: string): WorkspaceBranch[] {
    this.ensureInitialized();

    const db = getDatabase();
    if (!db) return [];

    const lineage: WorkspaceBranch[] = [];
    let current: string | null = workspaceId;

    try {
      while (current) {
        const row = db.prepare(
          'SELECT * FROM workspace_branches WHERE workspace_id = ?'
        ).get(current) as WorkspaceBranch | undefined;

        if (!row) break;

        lineage.push(row);
        current = row.parentWorkspaceId;
      }
    } catch (error: any) {
      logger.warn('Failed to get lineage', { workspaceId: workspaceId.slice(0, 24), error: error.message });
    }

    return lineage;
  }

  // ==========================================================================
  // Branch State Management
  // ==========================================================================

  /**
   * Archive a branch (marks it inactive, doesn't delete data).
   */
  archiveBranch(workspaceId: string): boolean {
    this.ensureInitialized();

    const db = getDatabase();
    if (!db) return false;

    try {
      const result = db.prepare(
        `UPDATE workspace_branches SET status = 'archived' WHERE workspace_id = ? AND status = 'active'`
      ).run(workspaceId);

      if (result.changes > 0) {
        logger.info('Branch archived', { workspaceId: workspaceId.slice(0, 32) });
        return true;
      }
      return false;
    } catch (error: any) {
      logger.warn('Failed to archive branch', { workspaceId: workspaceId.slice(0, 32), error: error.message });
      return false;
    }
  }

  /**
   * Reactivate an archived branch.
   */
  reactivateBranch(workspaceId: string): boolean {
    this.ensureInitialized();

    const db = getDatabase();
    if (!db) return false;

    try {
      const result = db.prepare(
        `UPDATE workspace_branches SET status = 'active', last_accessed_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND status = 'archived'`
      ).run(workspaceId);

      if (result.changes > 0) {
        logger.info('Branch reactivated', { workspaceId: workspaceId.slice(0, 32) });
        return true;
      }
      return false;
    } catch (error: any) {
      logger.warn('Failed to reactivate branch', { workspaceId: workspaceId.slice(0, 32), error: error.message });
      return false;
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Resolve the root workspace ID for a given workspace.
   * If there's no '#' in the workspaceId, it's not a branch — return as-is.
   * Otherwise, query the DB for root_workspace_id.
   *
   * Handles nested branches: "user:conv#branch1#branch2" is resolved via DB lookup.
   */
  private resolveRootWorkspace(workspaceId: string): string {
    if (!workspaceId.includes('#')) return workspaceId;

    const db = getDatabase();
    if (!db) return workspaceId;

    const row = db.prepare(
      'SELECT root_workspace_id FROM workspace_branches WHERE workspace_id = ?'
    ).get(workspaceId) as { root_workspace_id: string } | undefined;

    return row?.root_workspace_id || workspaceId;
  }

  /**
   * Ensure the root workspace is registered in workspace_branches.
   * Called after a fork to make sure the parent is tracked.
   */
  private ensureRootRegistered(rootId: string, userId: string): void {
    const db = getDatabase();
    if (!db) return;

    const existing = db.prepare(
      'SELECT id FROM workspace_branches WHERE workspace_id = ?'
    ).get(rootId);

    if (!existing) {
      db.prepare(`
        INSERT OR IGNORE INTO workspace_branches
          (workspace_id, branch_name, parent_workspace_id, root_workspace_id,
           user_id, status)
        VALUES (?, 'main', NULL, ?, ?, 'active')
      `).run(rootId, rootId, userId);
    }
  }

  /**
   * Copy environment variables from source workspace to branch workspace.
   * Secret env vars (with __SB__ placeholder values) are copied as-is —
   * the fork shares the same owner and can resolve secrets through the same SecretBroker.
   */
  private copyEnvVars(sourceWorkspaceId: string, branchWorkspaceId: string): void {
    try {
      const db = getDatabase();
      if (!db) return;

      const rows = db.prepare(
        'SELECT key, value, is_secret FROM workspace_env WHERE workspace_id = ?'
      ).all(sourceWorkspaceId) as Array<{ key: string; value: string; is_secret: number }>;

      const insert = db.prepare(`
        INSERT OR IGNORE INTO workspace_env (workspace_id, key, value, is_secret, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      for (const row of rows) {
        insert.run(branchWorkspaceId, row.key, row.value, row.is_secret, now);
      }

      if (rows.length > 0) {
        logger.debug('Copied env vars for fork', {
          count: rows.length,
          source: sourceWorkspaceId.slice(0, 24),
          branch: branchWorkspaceId.slice(0, 32),
        });
      }
    } catch (error: any) {
      logger.warn('Failed to copy env vars for fork', {
        error: error.message,
      });
    }
  }

  /**
   * Copy service metadata from source workspace to branch workspace.
   * Services are copied with status 'stopped' — they don't run automatically in forks.
   * Fresh service IDs are generated using a branch-scoped counter to avoid collisions.
   */
  private copyServiceMetadata(sourceWorkspaceId: string, branchWorkspaceId: string, userId: string): void {
    try {
      const db = getDatabase();
      if (!db) return;

      const rows = db.prepare(
        'SELECT name, command, working_dir, auto_restart, env FROM workspace_services WHERE workspace_id = ?'
      ).all(sourceWorkspaceId) as Array<{
        name: string; command: string; working_dir: string;
        auto_restart: number; env: string | null;
      }>;

      if (rows.length === 0) return;

      // Generate unique service IDs for the fork using a counter
      const branchPrefix = branchWorkspaceId.slice(0, 8);
      let counter = 0;

      const insert = db.prepare(`
        INSERT OR IGNORE INTO workspace_services
          (id, workspace_id, user_id, name, command, working_dir, status,
           pid, provider, exit_code, auto_restart, env,
           sandbox_provider, sandbox_id, started_at, last_activity_at, logs)
        VALUES (?, ?, ?, ?, ?, ?, 'stopped', NULL, NULL, NULL, ?, ?,
                NULL, NULL, ?, ?, '[]')
      `);

      const now = Date.now();
      for (const row of rows) {
        counter++;
        const newServiceId = `svc-${branchPrefix}-${counter}`;

        insert.run(
          newServiceId,
          branchWorkspaceId,
          userId,
          row.name,
          row.command,
          row.working_dir,
          row.auto_restart,
          row.env,
          now,
          now,
        );
      }

      logger.debug('Copied service metadata for fork', {
        count: rows.length,
        source: sourceWorkspaceId.slice(0, 24),
      });
    } catch (error: any) {
      logger.warn('Failed to copy service metadata for fork', {
        error: error.message,
      });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceBranchService = new WorkspaceBranchService();
