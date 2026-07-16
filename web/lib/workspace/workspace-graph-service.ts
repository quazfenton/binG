/**
 * Phase 10: AI-Native Workspace Graph
 *
 * A structured, queryable graph of workspace state that AI agents can use
 * instead of scraping terminal output. Aggregates state from all workspace
 * registries into a unified graph with typed nodes, relationship edges,
 * and derived diagnostics.
 *
 * Instead of asking AI to parse `ps aux` output, agents call:
 *   getWorkspaceGraph("workspace-123")
 *   → { processes: [...], services: [...], ports: [...], diagnostics: [...] }
 *
 * The graph enables queries like:
 *   - "Why is my app down?" → check service → port → logs → error
 *   - "What's running on port 3000?" → find preview → trace to service
 *   - "Is Postgres healthy?" → check service status + port + process
 *
 * @see lib/terminal/virtual-pid-registry.ts — Process state
 * @see lib/terminal/workspace-service-manager.ts — Service state
 * @see lib/terminal/workspace-preview-registry.ts — Preview/port state
 * @see lib/sandbox/workspacefs-snapshot-service.ts — Snapshot state
 * @see lib/sandbox/workspace-image-registry.ts — Image state
 */

import { EventEmitter } from 'events';
import { createLogger } from '@/lib/utils/logger';
import { virtualPidRegistry } from '@/lib/terminal/virtual-pid-registry';
import { workspaceServiceManager } from '@/lib/terminal/workspace-service-manager';
import { workspacePreviewRegistry } from '@/lib/terminal/workspace-preview-registry';
import { workspaceFSSnapshotService } from '@/lib/sandbox/workspacefs-snapshot-service';
import { workspaceImageRegistry } from '@/lib/sandbox/workspace-image-registry';
import { serviceHealthMonitor } from '@/lib/terminal/service-health-monitor';
import { workspaceJobManager } from '@/lib/terminal/workspace-job-manager';
import type BetterSqlite3 from 'better-sqlite3';
import { execSchemaFile } from '@/lib/database/schema';

const logger = createLogger('Phase10:WorkspaceGraph');

// ============================================================================
// Types
// ============================================================================

/** Node types in the workspace graph */
export type GraphNodeType =
  | 'process'
  | 'service'
  | 'port'
  | 'preview'
  | 'snapshot'
  | 'image'
  | 'file'
  | 'job';

/** A single node in the workspace graph */
export interface GraphNode {
  /** Unique ID within the workspace */
  id: string;
  /** Node type */
  type: GraphNodeType;
  /** Human-readable label */
  label: string;
  /** Current status (type-specific semantics) */
  status?: string;
  /** Additional properties */
  properties: Record<string, any>;
  /** When this node was last updated */
  updatedAt: number;
}

/** Edge types defining relationships between nodes */
export type GraphEdgeType =
  | 'owns'            // service → process
  | 'exposes'         // service → port
  | 'preview_of'      // preview → port
  | 'snapshot_of'     // snapshot → service
  | 'image_of'        // image → service
  | 'child_process'   // process → child process (inferred)
  | 'related_service'; // cross-service dependency (inferred)

/** A directed edge between two graph nodes */
export interface GraphEdge {
  /** Source node ID */
  sourceId: string;
  /** Target node ID */
  targetId: string;
  /** Relationship type */
  type: GraphEdgeType;
  /** Optional label */
  label?: string;
}

/**
 * Complete workspace graph for a single workspace.
 * This is the primary return type that AI agents query.
 */
export interface WorkspaceGraph {
  /** Workspace identifier */
  workspaceId: string;
  /** All nodes in the graph */
  nodes: GraphNode[];
  /** All edges connecting nodes */
  edges: GraphEdge[];
  /** High-level summary */
  summary: {
    /** Total nodes in the graph */
    totalNodes: number;
    /** Breakdown by node type */
    byType: Record<GraphNodeType, number>;
    /** Services that are running */
    runningServices: number;
    /** Services that have crashed or stopped */
    stoppedServices: number;
    /** Active preview URLs */
    activePreviews: number;
    /** Total processes tracked */
    totalProcesses: number;
    /** Running background jobs */
    runningJobs: number;
    /** Failed background jobs */
    failedJobs: number;
  };
  /** Diagnostic messages — derived state that AI can act on */
  diagnostics: GraphDiagnostic[];
  /** When this graph was generated */
  generatedAt: number;
}

/**
 * A diagnostic message about workspace health.
 * These are derived from the graph state, not raw data.
 */
export interface GraphDiagnostic {
  /** Severity level */
  level: 'info' | 'warning' | 'error';
  /** Human-readable message */
  message: string;
  /** Which node IDs are involved */
  relatedNodeIds: string[];    /** Category of the diagnostic */
  category: 'service_health' | 'port_availability' | 'process_state' | 'snapshot_status' | 'image_status' | 'health_check' | 'job_health' | 'general';
}

// ============================================================================
// Workspace Graph Service
// ============================================================================

export class WorkspaceGraphService extends EventEmitter {
  // ==========================================================================
  // Graph History (Phase 10 gap closure)
  // ==========================================================================

  private historyDb: BetterSqlite3.Database | null = null;
  private historyInitialized = false;
  private historyStmtInsert: BetterSqlite3.Statement | null = null;
  private historyStmtQuery: BetterSqlite3.Statement | null = null;
  private historyStmtRecent: BetterSqlite3.Statement | null = null;
  private historyStmtPrune: BetterSqlite3.Statement | null = null;
  private historyStmtCount: BetterSqlite3.Statement | null = null;
  private historyRecordingTimer: ReturnType<typeof setInterval> | null = null;
  private historyPruneTimer: ReturnType<typeof setInterval> | null = null;
  private autoRecordWorkspaces = new Set<string>();

  /** How often to auto-record snapshots for active workspaces */
  private static readonly HISTORY_RECORD_INTERVAL_MS = 60_000; // 1 minute
  /** How often to prune old snapshots */
  private static readonly HISTORY_PRUNE_INTERVAL_MS = 60 * 60_000; // 1 hour
  /** Max age of snapshots before pruning (keep 7 days) */
  private static readonly HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
  /** Max snapshots per workspace before evicting oldest */
  private static readonly HISTORY_MAX_PER_WORKSPACE = 1000;

  private initHistory(): void {
    if (this.historyInitialized && this.historyDb) return;
    try {
      const { getDatabase } = require('@/lib/database/connection-shim');
      this.historyDb = getDatabase();
      if (!this.historyDb) return;

      execSchemaFile(this.historyDb, '024_workspace_graph_history');

      this.historyStmtInsert = this.historyDb.prepare(`
        INSERT INTO workspace_graph_history
          (workspace_id, snapshot_data, summary_json, diagnostic_count,
           running_services, active_previews, total_nodes, recorded_at, change_reason)
        VALUES
          (@workspaceId, @snapshotData, @summaryJson, @diagnosticCount,
           @runningServices, @activePreviews, @totalNodes, @recordedAt, @changeReason)
      `);

      this.historyStmtQuery = this.historyDb.prepare(`
        SELECT * FROM workspace_graph_history
        WHERE workspace_id = ?
        ORDER BY recorded_at DESC
        LIMIT ?
      `);

      this.historyStmtRecent = this.historyDb.prepare(`
        SELECT * FROM workspace_graph_history
        WHERE workspace_id = ? AND recorded_at > ?
        ORDER BY recorded_at DESC
      `);

      this.historyStmtPrune = this.historyDb.prepare(`
        DELETE FROM workspace_graph_history
        WHERE workspace_id = ? AND recorded_at < ?
      `);

      this.historyStmtCount = this.historyDb.prepare(`
        SELECT COUNT(*) as count FROM workspace_graph_history WHERE workspace_id = ?
      `);

      // Start timers
      this.historyRecordingTimer = setInterval(
        () => this.recordAllActiveWorkspaces(),
        WorkspaceGraphService.HISTORY_RECORD_INTERVAL_MS,
      );
      this.historyRecordingTimer.unref?.();

      this.historyPruneTimer = setInterval(
        () => this.pruneOldSnapshots(),
        WorkspaceGraphService.HISTORY_PRUNE_INTERVAL_MS,
      );
      this.historyPruneTimer.unref?.();

      // Auto-record on graph changes for workspaces with active subscribers
      this.on('graph:changed', (workspaceId: string) => {
        this.autoRecordWorkspaces.add(workspaceId);
      });

      this.historyInitialized = true;
      logger.info('Workspace graph history initialized');
    } catch (err: any) {
      logger.warn('Workspace graph history unavailable', { error: err.message });
    }
  }

  /**
   * Record a snapshot of the workspace graph for historical comparison.
   *
   * @param workspaceId - The workspace to snapshot
   * @param changeReason - Why the snapshot was recorded (manual, periodic, on_change)
   */
  recordGraphSnapshot(workspaceId: string, changeReason: string = 'manual'): number | null {
    this.initHistory();
    if (!this.historyDb || !this.historyStmtInsert) return null;

    try {
      const graph = this.getWorkspaceGraph(workspaceId);
      const snapshotData = JSON.stringify({ nodes: graph.nodes, edges: graph.edges });
      const summaryJson = JSON.stringify(graph.summary);
      const now = Date.now();

      this.historyStmtInsert.run({
        workspaceId,
        snapshotData,
        summaryJson,
        diagnosticCount: graph.diagnostics.length,
        runningServices: graph.summary.runningServices,
        activePreviews: graph.summary.activePreviews,
        totalNodes: graph.summary.totalNodes,
        recordedAt: now,
        changeReason,
      });

      // Evict oldest if over max per workspace
      const countRow = this.historyStmtCount?.get(workspaceId) as any;
      if (countRow && countRow.count > WorkspaceGraphService.HISTORY_MAX_PER_WORKSPACE) {
        const oldestRow = this.historyDb.prepare(
          'SELECT id, recorded_at FROM workspace_graph_history WHERE workspace_id = ? ORDER BY recorded_at ASC LIMIT 1'
        ).get(workspaceId) as any;
        if (oldestRow) {
          this.historyDb.prepare('DELETE FROM workspace_graph_history WHERE id = ?').run(oldestRow.id);
        }
      }

      return now;
    } catch (err: any) {
      logger.warn('Failed to record graph snapshot', { workspaceId, error: err.message });
      return null;
    }
  }

  /**
   * Get graph history snapshots for a workspace.
   *
   * @param workspaceId - The workspace
   * @param options - since (timestamp), until (timestamp), limit (max results)
   */
  getGraphHistory(workspaceId: string, options?: {
    since?: number;
    until?: number;
    limit?: number;
  }): Array<{
    id: number;
    workspaceId: string;
    summary: WorkspaceGraph['summary'];
    diagnosticCount: number;
    runningServices: number;
    activePreviews: number;
    totalNodes: number;
    recordedAt: number;
    changeReason: string;
  }> {
    this.initHistory();
    if (!this.historyDb) return [];

    try {
      let rows: any[];

      if (options?.since && this.historyStmtRecent) {
        rows = this.historyStmtRecent.all(workspaceId, options.since) as any[];
      } else if (this.historyStmtQuery) {
        rows = this.historyStmtQuery.all(workspaceId, options?.limit || 100) as any[];
      } else {
        return [];
      }

      return rows
        .filter((r: any) => !options?.until || r.recorded_at <= options.until)
        .map((r: any) => {
          let summary: WorkspaceGraph['summary'] | undefined;
          try {
            summary = JSON.parse(r.summary_json);
          } catch { /* skip */ }

          return {
            id: r.id,
            workspaceId: r.workspace_id,
            summary: summary!,
            diagnosticCount: r.diagnostic_count,
            runningServices: r.running_services,
            activePreviews: r.active_previews,
            totalNodes: r.total_nodes,
            recordedAt: r.recorded_at,
            changeReason: r.change_reason,
          };
        });
    } catch (err: any) {
      logger.warn('Failed to query graph history', { workspaceId, error: err.message });
      return [];
    }
  }

  /**
   * Compare two graph snapshots and return what changed.
   *
   * Returns a diff showing added/removed/changed nodes and summary deltas.
   */
  getGraphDiff(workspaceId: string, fromId: number, toId: number): {
    from: { id: number; recordedAt: number };
    to: { id: number; recordedAt: number };
    summaryDelta: Record<string, { from: number; to: number; delta: number }>;
    nodesAdded: number;
    nodesRemoved: number;
    newServices: string[];
    stoppedServices: string[];
    newPreviews: string[];
  } | null {
    this.initHistory();
    if (!this.historyDb) return null;

    try {
      const fromRow = this.historyDb.prepare(
        'SELECT * FROM workspace_graph_history WHERE id = ?'
      ).get(fromId) as any;
      const toRow = this.historyDb.prepare(
        'SELECT * FROM workspace_graph_history WHERE id = ?'
      ).get(toId) as any;

      if (!fromRow || !toRow) return null;

      const fromSummary: WorkspaceGraph['summary'] = JSON.parse(fromRow.summary_json);
      const toSummary: WorkspaceGraph['summary'] = JSON.parse(toRow.summary_json);

      // Build summary delta
      const summaryKeys = ['totalNodes', 'runningServices', 'stoppedServices', 'activePreviews', 'totalProcesses', 'runningJobs', 'failedJobs'];
      const summaryDelta: Record<string, { from: number; to: number; delta: number }> = {};
      for (const key of summaryKeys) {
        const fromVal = (fromSummary as any)[key] || 0;
        const toVal = (toSummary as any)[key] || 0;
        summaryDelta[key] = { from: fromVal, to: toVal, delta: toVal - fromVal };
      }

      // Parse node lists for service/preview name comparison
      let fromData: any, toData: any;
      try { fromData = JSON.parse(fromRow.snapshot_data); } catch { return null; }
      try { toData = JSON.parse(toRow.snapshot_data); } catch { return null; }

      const fromNodeIds = new Set<string>((fromData.nodes || []).map((n: any) => n.id));
      const toNodeIds = new Set<string>((toData.nodes || []).map((n: any) => n.id));

      const nodesAdded = (toData.nodes || []).filter((n: any) => !fromNodeIds.has(n.id));
      const nodesRemoved = (fromData.nodes || []).filter((n: any) => !toNodeIds.has(n.id));

      return {
        from: { id: fromId, recordedAt: fromRow.recorded_at },
        to: { id: toId, recordedAt: toRow.recorded_at },
        summaryDelta,
        nodesAdded: nodesAdded.length,
        nodesRemoved: nodesRemoved.length,
        newServices: nodesAdded.filter((n: any) => n.type === 'service').map((n: any) => n.label),
        stoppedServices: nodesRemoved.filter((n: any) => n.type === 'service').map((n: any) => n.label),
        newPreviews: nodesAdded.filter((n: any) => n.type === 'preview').map((n: any) => n.label),
      };
    } catch (err: any) {
      logger.warn('Failed to compute graph diff', { workspaceId, fromId, toId, error: err.message });
      return null;
    }
  }

  /**
   * Prune old graph snapshots beyond the max age.
   */
  pruneOldSnapshots(maxAgeMs: number = WorkspaceGraphService.HISTORY_MAX_AGE_MS): number {
    this.initHistory();
    if (!this.historyDb) return 0;

    try {
      const cutoff = Date.now() - maxAgeMs;
      const result = this.historyDb.prepare(
        'DELETE FROM workspace_graph_history WHERE recorded_at < ?'
      ).run(cutoff);
      const deleted = (result as any).changes || 0;
      if (deleted > 0) {
        logger.debug(`Pruned ${deleted} old graph history snapshots`);
      }
      return deleted;
    } catch {
      return 0;
    }
  }

  /**
   * Record snapshots for all workspaces with recent graph activity.
   * Called periodically by the recording timer.
   */
  private recordAllActiveWorkspaces(): void {
    const workspaceIds = Array.from(this.autoRecordWorkspaces);
    for (const workspaceId of workspaceIds) {
      try {
        this.recordGraphSnapshot(workspaceId, 'periodic');
      } catch {
        // Best-effort per workspace
      }
    }
    // Reset — will be re-populated by next graph:changed events
    this.autoRecordWorkspaces.clear();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get the complete workspace graph for a workspace.
   * Aggregates state from all registries and derives diagnostics.
   *
   * This is the primary method AI agents should call to understand
   * workspace state without scraping terminal output.
   */
  getWorkspaceGraph(workspaceId: string): WorkspaceGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const diagnostics: GraphDiagnostic[] = [];

    // Collect nodes from each registry
    const processNodes = this.collectProcessNodes(workspaceId);
    const serviceNodes = this.collectServiceNodes(workspaceId);
    const previewNodes = this.collectPreviewNodes(workspaceId);
    // Pass service nodes to avoid redundant listServices() call
    const snapshotNodes = this.collectSnapshotNodes(workspaceId, serviceNodes.nodes);
    const imageNodes = this.collectImageNodes(workspaceId);
    const jobNodes = this.collectJobNodes(workspaceId);

    // Infer cross-service dependency edges (Phase 10: service dependency graph)
    const dependencyEdges = this.inferServiceDependencyEdges(workspaceId, serviceNodes.nodes);

    nodes.push(
      ...processNodes.nodes,
      ...serviceNodes.nodes,
      ...previewNodes.nodes,
      ...snapshotNodes.nodes,
      ...imageNodes.nodes,
      ...jobNodes.nodes,
    );

    edges.push(
      ...processNodes.edges,
      ...serviceNodes.edges,
      ...previewNodes.edges,
      ...snapshotNodes.edges,
      ...imageNodes.edges,
      ...jobNodes.edges,
      ...dependencyEdges,
    );

    // Derive diagnostics
    diagnostics.push(
      ...this.deriveServiceDiagnostics(serviceNodes.nodes, previewNodes.nodes),
      ...this.deriveProcessDiagnostics(processNodes.nodes),
      ...this.deriveSnapshotDiagnostics(snapshotNodes.nodes),
      ...this.deriveHealthDiagnostics(workspaceId, serviceNodes.nodes),
      ...this.deriveJobDiagnostics(jobNodes.nodes),
      ...this.deriveDependencyDiagnostics(serviceNodes.nodes, dependencyEdges),
    );

    // Build type breakdown
    const byType: Record<GraphNodeType, number> = {
      process: 0, service: 0, port: 0, preview: 0,
      snapshot: 0, image: 0, file: 0, job: 0,
    };
    for (const node of nodes) {
      byType[node.type] = (byType[node.type] || 0) + 1;
    }

    const serviceNodeList = nodes.filter(n => n.type === 'service');
    const previewNodeList = nodes.filter(n => n.type === 'preview');
    const jobNodeList = nodes.filter(n => n.type === 'job');

    const graph: WorkspaceGraph = {
      workspaceId,
      nodes,
      edges,
      summary: {
        totalNodes: nodes.length,
        byType,
        runningServices: serviceNodeList.filter(n => n.status === 'running').length,
        stoppedServices: serviceNodeList.filter(
          n => n.status === 'stopped' || n.status === 'crashed'
        ).length,
        activePreviews: previewNodeList.filter(n => n.status === 'active').length,
        totalProcesses: processNodes.nodes.length,
        runningJobs: jobNodeList.filter(n => n.status === 'running').length,
        failedJobs: jobNodeList.filter(n => n.status === 'failed').length,
      },
      diagnostics,
      generatedAt: Date.now(),
    };

    return graph;
  }

  /**
   * Get a focused diagnostic for a specific service.
   * Traces the service → port → preview → process chain to find issues.
   *
   * Accepts both bare service IDs ("svc-1") and prefixed IDs ("service:svc-1").
   */
  getServiceDiagnostic(workspaceId: string, serviceId: string): GraphDiagnostic[] {
    const graph = this.getWorkspaceGraph(workspaceId);

    // Normalize: accept bare service IDs without the 'service:' prefix
    const nodeId = serviceId.startsWith('service:') ? serviceId : `service:${serviceId}`;

    // Find the service node
    const serviceNode = graph.nodes.find(
      n => n.type === 'service' && n.id === nodeId
    );
    if (!serviceNode) {
      return [{
        level: 'warning',
        message: `Service "${serviceId}" not found in workspace`,
        relatedNodeIds: [],
        category: 'service_health',
      }];
    }

    // Trace all edges from this service (edges use prefixed node IDs)
    const relatedNodeIds = new Set<string>();
    const outgoingEdges = graph.edges.filter(e => e.sourceId === nodeId);
    const incomingEdges = graph.edges.filter(e => e.targetId === nodeId);

    for (const edge of [...outgoingEdges, ...incomingEdges]) {
      relatedNodeIds.add(edge.sourceId);
      relatedNodeIds.add(edge.targetId);
    }

    const relatedNodes = graph.nodes.filter(n => relatedNodeIds.has(n.id));
    const relatedDiagnostics = graph.diagnostics.filter(
      d => d.relatedNodeIds.includes(nodeId)
    );

    // Build traces
    const traces: string[] = [];
    for (const edge of outgoingEdges) {
      const target = graph.nodes.find(n => n.id === edge.targetId);
      if (target) {
        traces.push(`Service "${serviceNode.label}" → ${edge.type} → "${target.label}" (${target.status || 'unknown'})`);
      }
    }

    const diagnostics: GraphDiagnostic[] = [
      ...relatedDiagnostics,
      {
        level: serviceNode.status === 'running' ? 'info'
             : serviceNode.status === 'crashed' ? 'error'
             : 'warning',
        message: `Service "${serviceNode.label}" is ${serviceNode.status}` +
          (traces.length > 0 ? `. Traces: ${traces.join('; ')}` : ''),
        relatedNodeIds: [nodeId, ...Array.from(relatedNodeIds)],
        category: 'service_health',
      },
    ];

    // Add port-specific diagnostics
    const portEdges = outgoingEdges.filter(e => e.type === 'exposes' || e.type === 'preview_of');
    for (const edge of portEdges) {
      const portNode = graph.nodes.find(n => n.id === edge.targetId);
      if (portNode && portNode.status !== 'active') {
        diagnostics.push({
          level: 'error',
          message: `Service "${serviceNode.label}" exposes port but it's not reachable (${portNode.status || 'unknown'})`,
          relatedNodeIds: [nodeId, edge.targetId],
          category: 'port_availability',
        });
      }
    }

    return diagnostics;
  }

  /**
   * Search for processes by command pattern across a workspace.
   * Returns matching graph nodes with their relationships.
   */
  findProcesses(workspaceId: string, pattern: string): {
    processes: GraphNode[];
    relatedNodes: GraphNode[];
    edges: GraphEdge[];
  } {
    const graph = this.getWorkspaceGraph(workspaceId);
    const lowerPattern = pattern.toLowerCase();

    const matching = graph.nodes.filter(n => {
      if (n.type !== 'process') return false;
      const cmd = (n.properties.command || '').toLowerCase();
      const label = n.label.toLowerCase();
      return cmd.includes(lowerPattern) || label.includes(lowerPattern);
    });

    const matchingIds = new Set(matching.map(n => n.id));
    const relatedIds = new Set<string>();
    const relatedEdges = graph.edges.filter(e =>
      matchingIds.has(e.sourceId) || matchingIds.has(e.targetId)
    );

    for (const edge of relatedEdges) {
      relatedIds.add(edge.sourceId);
      relatedIds.add(edge.targetId);
    }

    const relatedNodes = graph.nodes.filter(n =>
      relatedIds.has(n.id) && !matchingIds.has(n.id)
    );

    return {
      processes: matching,
      relatedNodes,
      edges: relatedEdges,
    };
  }

  // ==========================================================================
  // Node Collectors
  // ==========================================================================

  private collectProcessNodes(workspaceId: string): {
    nodes: GraphNode[]; edges: GraphEdge[];
  } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const idSet = new Set<string>();

    try {
      const processes = virtualPidRegistry.getProcessList(workspaceId);
      for (const p of processes) {
        const nodeId = `process:${p.vPid}`;
        idSet.add(nodeId);

        nodes.push({
          id: nodeId,
          type: 'process',
          label: `PID ${p.vPid} — ${p.command.slice(0, 60)}`,
          status: Date.now() - p.lastConfirmedAt < 120_000 ? 'alive' : 'stale',
          properties: {
            vPid: p.vPid,
            realPid: p.realPid,
            provider: p.provider,
            sandboxId: p.sandboxId,
            command: p.command,
            user: p.user,
            registeredAt: p.registeredAt,
            lastConfirmedAt: p.lastConfirmedAt,
            isService: p.isService,
            serviceId: p.serviceId,
          },
          updatedAt: p.lastConfirmedAt,
        });

        // Edge: service → process (if this process belongs to a service)
        if (p.serviceId) {
          edges.push({
            sourceId: `service:${p.serviceId}`,
            targetId: nodeId,
            type: 'owns',
            label: `owns process ${p.vPid}`,
          });
        }
      }
    } catch (err: any) {
      logger.debug('Failed to collect process nodes', { workspaceId, error: err.message });
    }

    return { nodes, edges };
  }

  private collectServiceNodes(workspaceId: string): {
    nodes: GraphNode[]; edges: GraphEdge[];
  } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    try {
      const services = workspaceServiceManager.listServices(workspaceId);
      for (const s of services) {
        const nodeId = `service:${s.id}`;

        // Collect health status for this service
        const health = serviceHealthMonitor.getServiceHealth(s.id);

        nodes.push({
          id: nodeId,
          type: 'service',
          label: s.name,
          status: s.status,
          properties: {
            serviceId: s.id,
            command: s.command,
            workingDir: s.workingDir,
            pid: s.pid,
            provider: s.provider,
            ports: s.ports.map(p => ({ port: p.port, protocol: p.protocol })),
            startedAt: s.startedAt,
            lastActivityAt: s.lastActivityAt,
            exitCode: s.exitCode,
            autoRestart: s.autoRestart,
            sandboxProvider: s.sandboxProvider,
            sandboxId: s.sandboxId,
            // Health check data (from service-health-monitor)
            health: health ? {
              healthy: health.healthy,
              consecutiveFailures: health.consecutiveFailures,
              lastCheckedAt: health.lastCheckedAt,
              lastError: health.lastError,
            } : null,
          },
          updatedAt: s.lastActivityAt,
        });

        // Edge: service → port (for each detected port)
        for (const port of s.ports) {
          const portId = `port:${s.id}:${port.port}`;
          edges.push({
            sourceId: nodeId,
            targetId: portId,
            type: 'exposes',
            label: `port ${port.port} (${port.protocol})`,
          });
        }
      }
    } catch (err: any) {
      logger.debug('Failed to collect service nodes', { workspaceId, error: err.message });
    }

    return { nodes, edges };
  }

  private collectPreviewNodes(workspaceId: string): {
    nodes: GraphNode[]; edges: GraphEdge[];
  } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    try {
      const previews = workspacePreviewRegistry.getWorkspacePreviews(workspaceId);
      for (const p of previews) {
        const nodeId = `preview:${p.id}`;
        const portId = `port:${p.serviceId}:${p.port}`;

        nodes.push({
          id: nodeId,
          type: 'preview',
          label: `${p.serviceName} (${p.url || `port ${p.port}`})`,
          status: p.status,
          properties: {
            previewId: p.id,
            serviceId: p.serviceId,
            serviceName: p.serviceName,
            port: p.port,
            protocol: p.protocol,
            url: p.url,
            provider: p.provider,
            sandboxId: p.sandboxId,
            confidence: p.confidence,
            framework: p.framework,
            registeredAt: p.registeredAt,
            lastReachableAt: p.lastReachableAt,
          },
          updatedAt: p.lastReachableAt || p.registeredAt,
        });

        // Edge: preview → port (preview covers a specific port)
        edges.push({
          sourceId: nodeId,
          targetId: portId,
          type: 'preview_of',
          label: `preview of port ${p.port}`,
        });

        // Edge: service → preview
        edges.push({
          sourceId: `service:${p.serviceId}`,
          targetId: nodeId,
          type: 'exposes',
          label: `preview at ${p.url}`,
        });
      }
    } catch (err: any) {
      logger.debug('Failed to collect preview nodes', { workspaceId, error: err.message });
    }

    return { nodes, edges };
  }

  private collectSnapshotNodes(workspaceId: string, existingServiceNodes?: GraphNode[]): {
    nodes: GraphNode[]; edges: GraphEdge[];
  } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    try {
      const snapshot = workspaceFSSnapshotService.getSnapshot(workspaceId);
      if (snapshot) {
        const nodeId = `snapshot:${workspaceId}`;
        nodes.push({
          id: nodeId,
          type: 'snapshot',
          label: `Workspace FS snapshot`,
          status: 'active',
          properties: {
            sourceProvider: snapshot.sourceProvider,
            sourceSandboxId: snapshot.sourceSandboxId,
            workspaceDir: snapshot.workspaceDir,
            createdAt: snapshot.createdAt,
            hasCheckpoint: !!snapshot.checkpointId,
            vfsVersion: snapshot.vfsVersion,
            fileCount: snapshot.fileCount,
            lockFiles: snapshot.lockFiles,
            estimatedCacheSizeBytes: snapshot.estimatedCacheSizeBytes,
          },
          updatedAt: snapshot.createdAt,
        });

        // Edge: snapshot → service (for services matching detected lockfile tools)
        const tools = [
          ...(snapshot.lockFiles.node || []),
          ...(snapshot.lockFiles.python || []),
        ];
        const services = existingServiceNodes || [];
        for (const svcNode of services) {
          for (const tool of tools) {
            edges.push({
              sourceId: svcNode.id,
              targetId: nodeId,
              type: 'snapshot_of',
              label: `snapshot captures deps for ${tool}`,
            });
          }
        }
      }
    } catch (err: any) {
      logger.debug('Failed to collect snapshot nodes', { workspaceId, error: err.message });
    }

    return { nodes, edges };
  }

  private collectImageNodes(workspaceId?: string): {
    nodes: GraphNode[]; edges: GraphEdge[];
  } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    try {
      const stats = workspaceImageRegistry.getStats();
      if (stats.totalImages > 0) {
        const nodeId = workspaceId ? `image:${workspaceId}` : 'image:registry';
        nodes.push({
          id: nodeId,
          type: 'image',
          label: `Workspace image cache (${stats.activeImages} active)`,
          status: stats.activeImages > 0 ? 'active' : 'empty',
          properties: {
            totalImages: stats.totalImages,
            activeImages: stats.activeImages,
            nodeImages: stats.nodeImages,
            pythonImages: stats.pythonImages,
            totalUseCount: stats.totalUseCount,
            totalEstimatedSizeMb: stats.totalEstimatedSizeMb,
            enabled: stats.enabled,
          },
          updatedAt: Date.now(),
        });
      }
    } catch { /* skip */ }

    return { nodes, edges };
  }

  private collectJobNodes(workspaceId: string): {
    nodes: GraphNode[]; edges: GraphEdge[];
  } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    try {
      const jobs = workspaceJobManager.listJobs(workspaceId);
      for (const job of jobs) {
        const nodeId = `job:${job.id}`;

        nodes.push({
          id: nodeId,
          type: 'job',
          label: job.description || job.command.slice(0, 60),
          status: job.status,
          properties: {
            jobId: job.id,
            command: job.command,
            args: job.args,
            sandboxId: job.sandboxId,
            sessionId: job.sessionId,
            intervalSec: job.intervalSec,
            timeoutSec: job.timeoutSec,
            tags: job.tags,
            quotaCategory: job.quotaCategory,
            maxExecutions: job.maxExecutions,
            stopCondition: job.stopCondition,
            createdAt: job.createdAt,
            lastExecutedAt: job.lastExecutedAt,
            lastError: job.lastError,
            executionCount: job.executionCount,
          },
          updatedAt: job.lastExecutedAt || job.createdAt,
        });
      }
    } catch (err: any) {
      logger.debug('Failed to collect job nodes', { workspaceId, error: err.message });
    }

    return { nodes, edges };
  }

  // ==========================================================================
  // Service Dependency Inference (Phase 10 gap closure)
  // ==========================================================================

  /** Frontend dev server port ranges */
  private static readonly FRONTEND_PORTS = new Set([3000, 3001, 4200, 5173, 8080, 8081]);
  /** Backend API port ranges */
  private static readonly BACKEND_PORTS = new Set([3002, 4000, 5000, 8000, 9000]);
  /** Database/service port ranges */
  private static readonly DATABASE_PORTS = new Set([3306, 5432, 6379, 27017, 9092, 9200]);

  /**
   * Infer cross-service dependency edges by scanning each service's logs
   * for references to other services' ports.
   *
   * If service A's logs contain references to service B's port (e.g. "localhost:8000"),
   * a `related_service` edge A → B is created, indicating A depends on B.
   */
  private inferServiceDependencyEdges(
    workspaceId: string,
    serviceNodes: GraphNode[],
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const seen = new Set<string>(); // dedup key: "sourceId:targetId"

    // Build a map of port → service for quick lookup
    const portToService = new Map<number, GraphNode>();
    for (const node of serviceNodes) {
      const ports = (node.properties?.ports as Array<{ port: number }>) || [];
      for (const p of ports) {
        portToService.set(p.port, node);
      }
    }

    // For each service, scan its logs for references to other services' ports
    for (const sourceNode of serviceNodes) {
      const sourcePorts = (sourceNode.properties?.ports as Array<{ port: number }>) || [];
      const sourcePortSet = new Set(sourcePorts.map(p => p.port));

      // Get the service's logs from the service manager
      const serviceId = sourceNode.properties?.serviceId as string | undefined;
      if (!serviceId) continue;

      let logs: string[] = [];
      try {
        logs = workspaceServiceManager.getServiceLogs(serviceId, workspaceId, 200);
      } catch {
        // Logs may not be available — skip
      }

      // Scan logs for port references like "localhost:8000", ":5432", "0.0.0.0:6379"
      if (logs.length > 0) {
        const logText = logs.join(' ');
        const portPattern = /(?:\d{1,3}\.){3}\d{1,3}:(\d{3,5})|localhost:(\d{3,5})|:\s*(\d{3,5})/g;
        let match: RegExpExecArray | null;
        while ((match = portPattern.exec(logText)) !== null) {
          const portStr = match[1] || match[2] || match[3];
          const port = parseInt(portStr, 10);
          if (!isNaN(port) && portToService.has(port) && !sourcePortSet.has(port)) {
            const targetNode = portToService.get(port)!;
            if (targetNode.id !== sourceNode.id) {
              const key = `${sourceNode.id}:${targetNode.id}`;
              if (!seen.has(key)) {
                seen.add(key);
                edges.push({
                  sourceId: sourceNode.id,
                  targetId: targetNode.id,
                  type: 'related_service',
                  label: `depends on port ${port}`,
                });
              }
            }
          }
        }
      }

      // Port-based heuristic: frontend ports → first backend port
      // If log analysis didn't find anything for a service on a frontend port,
      // infer it may depend on a backend service (common monorepo pattern).
      // Only infer ONE dependency to avoid false positives.
      if (!edges.some(e => e.sourceId === sourceNode.id)) {
        for (const sp of sourcePorts) {
          if (WorkspaceGraphService.FRONTEND_PORTS.has(sp.port)) {
            for (const [bPort, backendNode] of portToService.entries()) {
              if (WorkspaceGraphService.BACKEND_PORTS.has(bPort) && backendNode.id !== sourceNode.id) {
                const key = `${sourceNode.id}:${backendNode.id}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  edges.push({
                    sourceId: sourceNode.id,
                    targetId: backendNode.id,
                    type: 'related_service',
                    label: `inferred frontend→backend (ports ${sp.port}→${bPort})`,
                  });
                  break; // Only one inferred dependency per frontend service
                }
              }
            }
          }
        }
      }
    }

    return edges;
  }

  /**
   * Derive diagnostics from inferred service dependencies.
   * Warns when a service depends on another that is unhealthy.
   */
  private deriveDependencyDiagnostics(
    serviceNodes: GraphNode[],
    dependencyEdges: GraphEdge[],
  ): GraphDiagnostic[] {
    const diagnostics: GraphDiagnostic[] = [];

    if (dependencyEdges.length === 0) return diagnostics;

    // Build label + status lookup for services
    const nodeMap = new Map<string, { label: string; status: string }>();
    for (const node of serviceNodes) {
      nodeMap.set(node.id, { label: node.label, status: node.status || 'unknown' });
    }

    // Check each dependency edge
    for (const edge of dependencyEdges) {
      if (edge.type !== 'related_service') continue;

      const target = nodeMap.get(edge.targetId);
      const sourceLabel = nodeMap.get(edge.sourceId)?.label ?? edge.sourceId;

      // Warn if a dependency is crashed or stopped
      if (target?.status === 'crashed') {
        diagnostics.push({
          level: 'error',
          message: `Service "${sourceLabel}" depends on "${target.label}" which is crashed`,
          relatedNodeIds: [edge.sourceId, edge.targetId],
          category: 'service_health',
        });
      } else if (target?.status === 'stopped') {
        diagnostics.push({
          level: 'warning',
          message: `Service "${sourceLabel}" depends on "${target.label}" which is stopped`,
          relatedNodeIds: [edge.sourceId, edge.targetId],
          category: 'service_health',
        });
      }
    }

    // Info: summarize discovered dependencies
    if (dependencyEdges.length > 0) {
      diagnostics.push({
        level: 'info',
        message: `Discovered ${dependencyEdges.length} service dependency edge(s) in workspace`,
        relatedNodeIds: dependencyEdges.flatMap(e => [e.sourceId, e.targetId]),
        category: 'general',
      });
    }

    return diagnostics;
  }

  // ==========================================================================
  // Diagnostic Derivation
  // ==========================================================================

  private deriveServiceDiagnostics(
    serviceNodes: GraphNode[],
    previewNodes: GraphNode[],
  ): GraphDiagnostic[] {
    const diagnostics: GraphDiagnostic[] = [];

    for (const svc of serviceNodes) {
      // Running service with no active preview (only warn if service actually exposes ports)
      if (svc.status === 'running') {
        const svcPorts = svc.properties?.ports as Array<{ port: number }> | undefined;
        const hasPorts = svcPorts && svcPorts.length > 0;
        if (hasPorts) {
          const hasActivePreview = previewNodes.some(
            p => p.properties?.serviceId === svc.properties?.serviceId
              && p.status === 'active'
          );
          if (!hasActivePreview) {
            diagnostics.push({
              level: 'info',
              message: `Service "${svc.label}" exposes ports but no active preview URL yet`,
              relatedNodeIds: [svc.id],
              category: 'port_availability',
            });
          }
        }
      }

      // Crashed service
      if (svc.status === 'crashed') {
        const exitCode = svc.properties?.exitCode;
        diagnostics.push({
          level: 'error',
          message: `Service "${svc.label}" crashed` +
            (exitCode !== undefined ? ` with exit code ${exitCode}` : ''),
          relatedNodeIds: [svc.id],
          category: 'service_health',
        });
      }

      // Long-running starting state
      if (svc.status === 'starting') {
        const startedAt = svc.properties?.startedAt as number | undefined;
        if (startedAt && Date.now() - startedAt > 30_000) {
          diagnostics.push({
            level: 'warning',
            message: `Service "${svc.label}" has been in "starting" state for ${Math.round((Date.now() - startedAt) / 1000)}s`,
            relatedNodeIds: [svc.id],
            category: 'service_health',
          });
        }
      }
    }

    return diagnostics;
  }

  private deriveProcessDiagnostics(processNodes: GraphNode[]): GraphDiagnostic[] {
    const diagnostics: GraphDiagnostic[] = [];

    const staleProcesses = processNodes.filter(n => n.status === 'stale');
    if (staleProcesses.length > 0) {
      diagnostics.push({
        level: 'warning',
        message: `${staleProcesses.length} process(es) have not been confirmed alive recently`,
        relatedNodeIds: staleProcesses.map(n => n.id),
        category: 'process_state',
      });
    }

    return diagnostics;
  }

  private deriveSnapshotDiagnostics(snapshotNodes: GraphNode[]): GraphDiagnostic[] {
    const diagnostics: GraphDiagnostic[] = [];

    for (const snap of snapshotNodes) {
      const age = Date.now() - snap.updatedAt;
      if (age > 30 * 60 * 1000) {
        diagnostics.push({
          level: 'warning',
          message: `Workspace FS snapshot is ${Math.round(age / 60000)} minutes old — consider refreshing`,
          relatedNodeIds: [snap.id],
          category: 'snapshot_status',
        });
      }
    }

    return diagnostics;
  }

  /**
   * Derive diagnostics from service health check data.
   * Surfaces health monitor state so AI agents can act on unhealthy services.
   */
  private deriveHealthDiagnostics(
    workspaceId: string,
    serviceNodes: GraphNode[],
  ): GraphDiagnostic[] {
    const diagnostics: GraphDiagnostic[] = [];

    // Collect health for all services in the workspace.
    // Only generate diagnostics for running services — crashed/stopped services
    // are already covered by deriveServiceDiagnostics().
    const runningNodeIds = new Set(
      serviceNodes.filter(n => n.status === 'running').map(n => n.properties?.serviceId),
    );
    const allHealth = serviceHealthMonitor.getWorkspaceHealth(workspaceId);

    for (const health of allHealth) {
      // Skip non-running services (already diagnosed by deriveServiceDiagnostics)
      if (!runningNodeIds.has(health.serviceId)) continue;

      const svcNode = serviceNodes.find(
        n => n.properties?.serviceId === health.serviceId,
      );

      if (!health.healthy && health.consecutiveFailures > 0) {
        if (health.consecutiveFailures >= 3) {
          diagnostics.push({
            level: 'error',
            message: `Service "${svcNode?.label ?? health.serviceId}" failed ${health.consecutiveFailures} consecutive health checks` +
              (health.lastError ? ` (${health.lastError})` : ''),
            relatedNodeIds: svcNode ? [svcNode.id] : [],
            category: 'health_check',
          });
        } else {
          diagnostics.push({
            level: 'warning',
            message: `Service "${svcNode?.label ?? health.serviceId}" failed ${health.consecutiveFailures} health check(s)`,
            relatedNodeIds: svcNode ? [svcNode.id] : [],
            category: 'health_check',
          });
        }
      }
    }

    // Warn only if running services exist but haven't been health-checked yet
    const runningNodes = serviceNodes.filter(n => n.status === 'running');
    if (allHealth.length === 0 && runningNodes.length > 0) {
      diagnostics.push({
        level: 'info',
        message: `${runningNodes.length} service(s) running but health monitor hasn't checked them yet (first cycle may be pending)`,
        relatedNodeIds: runningNodes.map(n => n.id),
        category: 'health_check',
      });
    }

    return diagnostics;
  }

  /**
   * Derive diagnostics from workspace background jobs.
   * Surfaces failed, stalled, and long-running jobs so AI agents can act.
   */
  private deriveJobDiagnostics(
    jobNodes: GraphNode[],
  ): GraphDiagnostic[] {
    const diagnostics: GraphDiagnostic[] = [];

    for (const job of jobNodes) {
      if (job.status === 'failed') {
        diagnostics.push({
          level: 'error',
          message: `Background job "${job.label}" failed` +
            (job.properties?.lastError ? `: ${job.properties.lastError}` : ''),
          relatedNodeIds: [job.id],
          category: 'job_health',
        });
      }

      if (job.status === 'running') {
        const createdAt = job.properties?.createdAt as number | undefined;
        const lastExecutedAt = job.properties?.lastExecutedAt as number | undefined;
        const executionCount = job.properties?.executionCount as number | undefined;
        if (createdAt && executionCount === 0 && (Date.now() / 1000 - createdAt) > 300) {
          diagnostics.push({
            level: 'warning',
            message: `Background job "${job.label}" has been running for ${Math.round((Date.now() / 1000 - createdAt) / 60)}min with no executions yet`,
            relatedNodeIds: [job.id],
            category: 'job_health',
          });
        }
        if (lastExecutedAt && executionCount && executionCount > 0) {
          const elapsed = Date.now() / 1000 - lastExecutedAt;
          const intervalSec = job.properties?.intervalSec as number | undefined;
          if (intervalSec && elapsed > intervalSec * 3) {
            diagnostics.push({
              level: 'warning',
              message: `Background job "${job.label}" may be stalled — last execution was ${Math.round(elapsed / 60)}min ago (interval: ${intervalSec}s)`,
              relatedNodeIds: [job.id],
              category: 'job_health',
            });
          }
        }
      }
    }

    return diagnostics;
  }
  // ==========================================================================
  // Change Notification (Phase 10: real-time graph updates)
  // ==========================================================================

  /**
   * Notify listeners that the workspace graph has changed.
   * This enables real-time push-based updates via WebSocket instead of polling.
   */
  notifyGraphChanged(workspaceId: string): void {
    this.emit('graph:changed', workspaceId);
  }

  /**
   * Subscribe to graph changes for a workspace.
   * Returns an unsubscribe function.
   */
  onGraphChanged(workspaceId: string, listener: () => void): () => void {
    const handler = (changedId: string) => {
      if (changedId === workspaceId) listener();
    };
    this.on('graph:changed', handler);
    return () => this.off('graph:changed', handler);
  }

  /** Track graph summary hashes per workspace for change detection. Size-bound to prevent unbounded growth. */
  private lastGraphHashes = new Map<string, string>();
  /** Maximum number of workspace hash entries before eviction */
  private static readonly MAX_HASH_ENTRIES = 1000;

  /**
   * Get the current graph only if it has changed since last call for this workspace.
   * Returns null if no change detected. Used by the WebSocket broadcaster.
   */
  getWorkspaceGraphIfChanged(workspaceId: string): WorkspaceGraph | null {
    const graph = this.getWorkspaceGraph(workspaceId);
    const hash = JSON.stringify(graph.summary);
    const prev = this.lastGraphHashes.get(workspaceId);

    // Evict oldest entry if at capacity and adding a new key
    if (!this.lastGraphHashes.has(workspaceId) && this.lastGraphHashes.size >= WorkspaceGraphService.MAX_HASH_ENTRIES) {
      const oldestKey = this.lastGraphHashes.keys().next().value;
      if (oldestKey) this.lastGraphHashes.delete(oldestKey);
    }
    this.lastGraphHashes.set(workspaceId, hash);

    return hash !== prev ? graph : null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceGraphService = new WorkspaceGraphService();
