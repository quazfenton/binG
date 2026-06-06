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

import { createLogger } from '@/lib/utils/logger';
import { virtualPidRegistry } from '@/lib/terminal/virtual-pid-registry';
import { workspaceServiceManager } from '@/lib/terminal/workspace-service-manager';
import { workspacePreviewRegistry } from '@/lib/terminal/workspace-preview-registry';
import { workspaceFSSnapshotService } from '@/lib/sandbox/workspacefs-snapshot-service';
import { workspaceImageRegistry } from '@/lib/sandbox/workspace-image-registry';

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
  | 'file';

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
  relatedNodeIds: string[];
  /** Category of the diagnostic */
  category: 'service_health' | 'port_availability' | 'process_state' | 'snapshot_status' | 'image_status' | 'general';
}

// ============================================================================
// Workspace Graph Service
// ============================================================================

export class WorkspaceGraphService {
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

    nodes.push(
      ...processNodes.nodes,
      ...serviceNodes.nodes,
      ...previewNodes.nodes,
      ...snapshotNodes.nodes,
      ...imageNodes.nodes,
    );

    edges.push(
      ...processNodes.edges,
      ...serviceNodes.edges,
      ...previewNodes.edges,
      ...snapshotNodes.edges,
      ...imageNodes.edges,
    );

    // Derive diagnostics
    diagnostics.push(
      ...this.deriveServiceDiagnostics(serviceNodes.nodes, previewNodes.nodes),
      ...this.deriveProcessDiagnostics(processNodes.nodes),
      ...this.deriveSnapshotDiagnostics(snapshotNodes.nodes),
    );

    // Build type breakdown
    const byType: Record<GraphNodeType, number> = {
      process: 0, service: 0, port: 0, preview: 0,
      snapshot: 0, image: 0, file: 0,
    };
    for (const node of nodes) {
      byType[node.type] = (byType[node.type] || 0) + 1;
    }

    const serviceNodeList = nodes.filter(n => n.type === 'service');
    const previewNodeList = nodes.filter(n => n.type === 'preview');

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
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceGraphService = new WorkspaceGraphService();
