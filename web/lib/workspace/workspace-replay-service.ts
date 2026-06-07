/**
 * Workspace Replay Service (Gap #8 closure)
 *
 * Immutable append-only event-stream recording for full workspace session replay.
 * Records every command execution, file edit, and agent action in chronological
 * order so users can replay and audit their entire workspace session.
 *
 * Design:
 *   - Separate table (workspace_replay_events) from the async event bus (events table).
 *     Replay events are immutable records of what happened, not tasks to be processed.
 *   - Fire-and-forget recording — replay failures never block the main action.
 *   - Queryable by workspace, session, user, event type, file path, and time range.
 *   - Content hashing for output/file integrity verification on replay.
 *
 * @module workspace/workspace-replay-service
 */

import { getDatabase } from '@/lib/database/connection';
import { execSchemaFile } from '@/lib/database/schema';
import { createLogger } from '@/lib/utils/logger';
import { createHash } from 'crypto';

const logger = createLogger('WorkspaceReplay');

// ============================================================================
// Types
// ============================================================================

export type ReplayEventType = 'command_execution' | 'file_edit' | 'agent_action';

export interface ReplayEvent {
  id: number;
  event_type: ReplayEventType;
  phase: string | null;
  workspace_id: string;
  session_id: string | null;
  user_id: string;
  command: string | null;
  sandbox_id: string | null;
  provider: string | null;
  exit_code: number | null;
  output_preview: string | null;
  output_hash: string | null;
  duration_ms: number | null;
  file_path: string | null;
  edit_action: string | null;
  tool_name: string | null;
  content_hash: string | null;
  diff_summary: string | null;
  agent_tool: string | null;
  agent_model: string | null;
  agent_provider: string | null;
  agent_iteration: number | null;
  agent_success: number | null;
  agent_result_preview: string | null;
  metadata: string | null;
  timestamp_ms: number;
  created_at: string;
}

export interface CommandExecutionRecord {
  phase: 'started' | 'completed';
  workspaceId: string;
  sessionId?: string;
  userId: string;
  command: string;
  sandboxId: string;
  provider: string;
  exitCode?: number;
  output?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface FileEditRecord {
  workspaceId: string;
  sessionId?: string;
  userId: string;
  filePath: string;
  editAction: 'create' | 'update' | 'delete';
  toolName: 'write_file' | 'apply_diff' | 'batch_write' | 'delete_file';
  contentHash?: string;
  diffSummary?: string;
  metadata?: Record<string, any>;
}

export interface AgentActionRecord {
  workspaceId: string;
  sessionId?: string;
  userId: string;
  tool: string;
  model?: string;
  provider?: string;
  iteration?: number;
  success: boolean;
  resultPreview?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export interface ReplayQueryOptions {
  workspaceId: string;
  since?: number;            // timestamp_ms lower bound
  until?: number;            // timestamp_ms upper bound
  eventTypes?: ReplayEventType[];
  filePath?: string;         // filter by file path
  limit?: number;            // default 100
  offset?: number;           // for pagination
}

export interface ReplayTimeline {
  events: ReplayEvent[];
  total: number;
  hasMore: boolean;
  summary: {
    commandCount: number;
    fileEditCount: number;
    agentActionCount: number;
    timeRange: { start: number; end: number } | null;
  };
}

// ============================================================================
// Workspace Replay Service
// ============================================================================

export class WorkspaceReplayService {
  private initialized = false;
  private static readonly MAX_OUTPUT_PREVIEW = 500;  // Truncate output to this length
  private static readonly MAX_RESULT_PREVIEW = 300;  // Truncate agent results

  /**
   * Initialize the replay events table (idempotent — safe to call on every startup).
   */
  ensureInitialized(): void {
    if (this.initialized) return;

    try {
      const db = getDatabase();
      if (!db) return;

      execSchemaFile(db, '021_workspace_replay_events');
      this.initialized = true;
      logger.info('Workspace replay events table initialized');
    } catch (error: any) {
      logger.warn('Failed to initialize workspace replay events table', { error: error.message });
    }
  }

  // ==========================================================================
  // Recording
  // ==========================================================================

  /**
   * Record a command execution event.
   * Called before the command starts (phase: 'started') and after it completes (phase: 'completed').
   */
  recordCommandExecution(record: CommandExecutionRecord): void {
    this.ensureInitialized();

    try {
      const db = getDatabase();
      if (!db) return;

      const outputPreview = record.output
        ? record.output.slice(0, WorkspaceReplayService.MAX_OUTPUT_PREVIEW)
        : null;
      const outputHash = record.output
        ? createHash('sha256').update(record.output).digest('hex')
        : null;

      db.prepare(`
        INSERT INTO workspace_replay_events
          (event_type, phase, workspace_id, session_id, user_id,
           command, sandbox_id, provider, exit_code, output_preview,
           output_hash, duration_ms, metadata, timestamp_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'command_execution',
        record.phase,
        record.workspaceId,
        record.sessionId || null,
        record.userId,
        record.command.slice(0, 2000),
        record.sandboxId,
        record.provider,
        record.exitCode ?? null,
        outputPreview,
        outputHash,
        record.durationMs ?? null,
        record.metadata ? JSON.stringify(record.metadata) : null,
        Date.now(),
      );
    } catch (error: any) {
      // Best-effort — replay recording failures must never block the main action
      logger.debug('Failed to record command execution replay event', { error: error.message });
    }
  }

  /**
   * Record a file edit event.
   * Called after every write_file, apply_diff, batch_write, or delete_file operation.
   */
  recordFileEdit(record: FileEditRecord): void {
    this.ensureInitialized();

    try {
      const db = getDatabase();
      if (!db) return;

      db.prepare(`
        INSERT INTO workspace_replay_events
          (event_type, workspace_id, session_id, user_id,
           file_path, edit_action, tool_name, content_hash,
           diff_summary, metadata, timestamp_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'file_edit',
        record.workspaceId,
        record.sessionId || null,
        record.userId,
        record.filePath.slice(0, 1000),
        record.editAction,
        record.toolName,
        record.contentHash || null,
        record.diffSummary?.slice(0, 500) || null,
        record.metadata ? JSON.stringify(record.metadata) : null,
        Date.now(),
      );
    } catch (error: any) {
      logger.debug('Failed to record file edit replay event', { error: error.message });
    }
  }

  /**
   * Record an agent action event.
   * Called after each tool invocation in the agent loop.
   */
  recordAgentAction(record: AgentActionRecord): void {
    this.ensureInitialized();

    try {
      const db = getDatabase();
      if (!db) return;

      const resultPreview = record.resultPreview
        ? record.resultPreview.slice(0, WorkspaceReplayService.MAX_RESULT_PREVIEW)
        : null;

      db.prepare(`
        INSERT INTO workspace_replay_events
          (event_type, workspace_id, session_id, user_id,
           agent_tool, agent_model, agent_provider, agent_iteration,
           agent_success, agent_result_preview, duration_ms,
           metadata, timestamp_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'agent_action',
        record.workspaceId,
        record.sessionId || null,
        record.userId,
        record.tool.slice(0, 200),
        record.model?.slice(0, 100) || null,
        record.provider?.slice(0, 50) || null,
        record.iteration ?? null,
        record.success ? 1 : 0,
        resultPreview,
        record.durationMs ?? null,
        record.metadata ? JSON.stringify(record.metadata) : null,
        Date.now(),
      );
    } catch (error: any) {
      logger.debug('Failed to record agent action replay event', { error: error.message });
    }
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  /**
   * Get a chronological replay timeline for a workspace.
   * Returns all recorded events in order with summary statistics.
   */
  getReplayTimeline(options: ReplayQueryOptions): ReplayTimeline {
    const db = getDatabase();
    if (!db) {
      return {
        events: [],
        total: 0,
        hasMore: false,
        summary: { commandCount: 0, fileEditCount: 0, agentActionCount: 0, timeRange: null },
      };
    }

    try {
      const { workspaceId, since, until, eventTypes, filePath, limit = 100, offset = 0 } = options;

      // Build WHERE clause dynamically
      const conditions: string[] = ['workspace_id = ?'];
      const params: any[] = [workspaceId];

      if (since) {
        conditions.push('timestamp_ms >= ?');
        params.push(since);
      }
      if (until) {
        conditions.push('timestamp_ms <= ?');
        params.push(until);
      }
      if (eventTypes && eventTypes.length > 0) {
        conditions.push(`event_type IN (${eventTypes.map(() => '?').join(',')})`);
        params.push(...eventTypes);
      }
      if (filePath) {
        conditions.push('file_path = ?');
        params.push(filePath);
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countRow = db.prepare(
        `SELECT COUNT(*) as total FROM workspace_replay_events WHERE ${whereClause}`
      ).get(...params) as { total: number };

      // Get events (chronological order)
      const rows = db.prepare(
        `SELECT * FROM workspace_replay_events
         WHERE ${whereClause}
         ORDER BY timestamp_ms ASC, id ASC
         LIMIT ? OFFSET ?`
      ).all(...params, limit, offset) as ReplayEvent[];

      // Compute summary
      let commandCount = 0;
      let fileEditCount = 0;
      let agentActionCount = 0;

      for (const row of rows) {
        if (row.event_type === 'command_execution') commandCount++;
        else if (row.event_type === 'file_edit') fileEditCount++;
        else if (row.event_type === 'agent_action') agentActionCount++;
      }

      const timeRange = rows.length > 0
        ? { start: rows[0].timestamp_ms, end: rows[rows.length - 1].timestamp_ms }
        : null;

      return {
        events: rows,
        total: countRow.total,
        hasMore: offset + limit < countRow.total,
        summary: {
          commandCount,
          fileEditCount,
          agentActionCount,
          timeRange,
        },
      };
    } catch (error: any) {
      logger.error('Failed to query replay timeline', { error: error.message, options });
      return {
        events: [],
        total: 0,
        hasMore: false,
        summary: { commandCount: 0, fileEditCount: 0, agentActionCount: 0, timeRange: null },
      };
    }
  }

  /**
   * Get the command history for a workspace (convenience method).
   */
  getCommandHistory(workspaceId: string, limit = 50): ReplayEvent[] {
    return this.getReplayTimeline({
      workspaceId,
      eventTypes: ['command_execution'],
      limit,
    }).events;
  }

  /**
   * Get the file edit history for a specific file (convenience method).
   */
  getFileEditHistory(workspaceId: string, filePath: string, limit = 50): ReplayEvent[] {
    return this.getReplayTimeline({
      workspaceId,
      eventTypes: ['file_edit'],
      filePath,
      limit,
    }).events;
  }

  /**
   * Get recent agent actions for a workspace (convenience method).
   */
  getAgentActionHistory(workspaceId: string, limit = 50): ReplayEvent[] {
    return this.getReplayTimeline({
      workspaceId,
      eventTypes: ['agent_action'],
      limit,
    }).events;
  }

  /**
   * Get replay statistics for a workspace.
   */
  getReplayStats(workspaceId: string): {
    totalEvents: number;
    commands: number;
    fileEdits: number;
    agentActions: number;
    firstEventAt: number | null;
    lastEventAt: number | null;
    avgCommandDurationMs: number;
    fileEditTools: Record<string, number>;
    agentSuccessRate: number;
  } {
    const db = getDatabase();
    if (!db) {
      return {
        totalEvents: 0, commands: 0, fileEdits: 0, agentActions: 0,
        firstEventAt: null, lastEventAt: null, avgCommandDurationMs: 0,
        fileEditTools: {}, agentSuccessRate: 0,
      };
    }

    try {
      const counts = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN event_type = 'command_execution' THEN 1 ELSE 0 END) as commands,
          SUM(CASE WHEN event_type = 'file_edit' THEN 1 ELSE 0 END) as file_edits,
          SUM(CASE WHEN event_type = 'agent_action' THEN 1 ELSE 0 END) as agent_actions,
          MIN(timestamp_ms) as first_event,
          MAX(timestamp_ms) as last_event,
          AVG(CASE WHEN event_type = 'command_execution' THEN duration_ms END) as avg_cmd_duration,
          CAST(SUM(CASE WHEN event_type = 'agent_action' AND agent_success = 1 THEN 1 ELSE 0 END) AS FLOAT)
            / NULLIF(SUM(CASE WHEN event_type = 'agent_action' THEN 1 ELSE 0 END), 0) as agent_success_rate
        FROM workspace_replay_events
        WHERE workspace_id = ?
      `).get(workspaceId) as any;

      const toolCounts = db.prepare(`
        SELECT tool_name, COUNT(*) as cnt
        FROM workspace_replay_events
        WHERE workspace_id = ? AND event_type = 'file_edit' AND tool_name IS NOT NULL
        GROUP BY tool_name
      `).all(workspaceId) as Array<{ tool_name: string; cnt: number }>;

      const fileEditTools: Record<string, number> = {};
      for (const row of toolCounts) {
        fileEditTools[row.tool_name] = row.cnt;
      }

      return {
        totalEvents: counts.total || 0,
        commands: counts.commands || 0,
        fileEdits: counts.file_edits || 0,
        agentActions: counts.agent_actions || 0,
        firstEventAt: counts.first_event || null,
        lastEventAt: counts.last_event || null,
        avgCommandDurationMs: Math.round(counts.avg_cmd_duration || 0),
        fileEditTools,
        agentSuccessRate: counts.agent_success_rate || 0,
      };
    } catch (error: any) {
      logger.error('Failed to get replay stats', { error: error.message, workspaceId });
      return {
        totalEvents: 0, commands: 0, fileEdits: 0, agentActions: 0,
        firstEventAt: null, lastEventAt: null, avgCommandDurationMs: 0,
        fileEditTools: {}, agentSuccessRate: 0,
      };
    }
  }

  /**
   * Purge old replay events beyond a retention window.
   */
  purgeOldEvents(workspaceId: string, olderThanMs: number): number {
    const db = getDatabase();
    if (!db) return 0;

    try {
      const cutoff = Date.now() - olderThanMs;
      const result = db.prepare(`
        DELETE FROM workspace_replay_events
        WHERE workspace_id = ? AND timestamp_ms < ?
      `).run(workspaceId, cutoff);

      if (result.changes > 0) {
        logger.info('Purged old replay events', {
          workspaceId,
          purged: result.changes,
          olderThanMs,
        });
      }
      return result.changes;
    } catch (error: any) {
      logger.error('Failed to purge old replay events', { error: error.message });
      return 0;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceReplayService = new WorkspaceReplayService();
