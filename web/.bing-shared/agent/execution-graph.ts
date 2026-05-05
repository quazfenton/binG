/**
 * Execution Graph Engine
 * 
 * Manages task execution graphs for complex multi-step operations.
 * Supports parallel execution, dependency tracking, and failure recovery.
 * 
 * Features:
 * - Directed Acyclic Graph (DAG) for task dependencies
 * - Parallel execution of independent tasks
 * - Real-time status tracking
 * - Automatic retry on failure
 * - Progress reporting
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Execution:Graph');

/**
 * Execution node types
 */
export type ExecutionNodeType =
  | 'agent_step'      // Agent reasoning/action
  | 'tool_call'       // Tool execution
  | 'sandbox_action'  // Sandbox operation
  | 'preview_task'    // Preview generation
  | 'git_operation';  // Git operation

/**
 * Node status in execution graph
 */
export type NodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

/**
 * Execution node in graph
 */
export interface ExecutionNode {
  id: string;
  type: ExecutionNodeType;
  name: string;
  description?: string;
  dependencies: string[];  // Node IDs that must complete first
  status: NodeStatus;
  result?: any;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  maxRetries: number;
  metadata?: Record<string, any>;
  /** Abort controller for cancelling in-flight operations */
  abortController?: AbortController;
}

/**
 * Execution graph for tracking task progress
 */
export interface ExecutionGraph {
  id: string;
  sessionId: string;
  nodes: Map<string, ExecutionNode>;
  edges: Map<string, Set<string>>;  // from -> to (dependencies)
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, any>;
}

/**
 * Graph execution result
 */
export interface GraphExecutionResult {
  success: boolean;
  nodeId?: string;
  result?: any;
  error?: string;
  duration: number;
}

/**
 * Execution Graph Manager
 */
export class ExecutionGraphEngine {
  private graphs = new Map<string, ExecutionGraph>();
  private readonly DEFAULT_MAX_RETRIES = 3;
  // MED-1 fix: Limit concurrent node execution to prevent resource exhaustion
  private readonly MAX_CONCURRENT_NODES = (() => {
    const parsed = parseInt(process.env.EXECUTION_GRAPH_MAX_CONCURRENCY || '10', 10);
    if (Number.isNaN(parsed)) return 10;
    return Math.max(1, parsed);
  })();
  // Max graph size to prevent runaway graphs
  private readonly MAX_NODES_PER_GRAPH = 100;

  /**
   * Create new execution graph
   */
  createGraph(sessionId: string, id?: string): ExecutionGraph {
    const graphId = id || `graph-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    const graph: ExecutionGraph = {
      id: graphId,
      sessionId,
      nodes: new Map(),
      edges: new Map(),
      status: 'pending',
      createdAt: Date.now(),
    };

    this.graphs.set(graphId, graph);
    logger.info('Execution graph created', { graphId, sessionId });

    return graph;
  }

  /**
   * Get existing graph
   */
  getGraph(graphId: string): ExecutionGraph | null {
    return this.graphs.get(graphId) || null;
  }

  /**
   * Add node to graph
   */
  addNode(
    graph: ExecutionGraph,
    node: Omit<ExecutionNode, 'status' | 'retryCount' | 'maxRetries'>
  ): ExecutionNode {
    // Validate graph size limit
    if (graph.nodes.size >= this.MAX_NODES_PER_GRAPH) {
      throw new Error(`Graph exceeds maximum node limit (${this.MAX_NODES_PER_GRAPH}). Reduce the number of tasks or split into subgraphs.`);
    }

    // Self-dependency check
    if (node.dependencies.includes(node.id)) {
      throw new Error(`Node "${node.id}" has a self-dependency (cycle). Remove the self-reference.`);
    }

    // Validate that all dependencies exist in the graph
    for (const depId of node.dependencies) {
      if (!graph.nodes.has(depId)) {
        throw new Error(`Dependency node "${depId}" does not exist in the graph. Add all dependencies before referencing them.`);
      }
    }

    const newNode: ExecutionNode = {
      ...node,
      status: node.dependencies.length === 0 ? 'pending' : 'blocked',
      retryCount: 0,
      maxRetries: this.DEFAULT_MAX_RETRIES,
    };

    graph.nodes.set(node.id, newNode);

    // Add edges for dependencies
    for (const depId of node.dependencies) {
      this.addEdge(graph, depId, node.id);
    }

    // Cycle detection: validate that adding this node doesn't create a cycle
    if (this.hasCycle(graph)) {
      // Rollback: remove the node and its edges
      graph.nodes.delete(node.id);
      for (const depId of node.dependencies) {
        const edges = graph.edges.get(depId);
        if (edges) {
          edges.delete(node.id);
          if (edges.size === 0) graph.edges.delete(depId);
        }
      }
      throw new Error(`Adding node "${node.id}" would create a cycle in the execution graph. Check dependencies for circular references.`);
    }

    logger.debug('Node added to graph', {
      graphId: graph.id,
      nodeId: node.id,
      type: node.type,
      dependencies: node.dependencies,
    });

    return newNode;
  }

  /**
   * Add edge (dependency) between nodes
   */
  addEdge(graph: ExecutionGraph, fromId: string, toId: string): void {
    if (!graph.edges.has(fromId)) {
      graph.edges.set(fromId, new Set());
    }
    graph.edges.get(fromId)!.add(toId);

    // Update dependent node status to blocked
    const toNode = graph.nodes.get(toId);
    if (toNode && toNode.status === 'pending') {
      toNode.status = 'blocked';
    }

    logger.debug('Edge added', {
      graphId: graph.id,
      from: fromId,
      to: toId,
    });
  }

  /**
   * Get nodes ready for execution (all dependencies met)
   */
  getReadyNodes(graph: ExecutionGraph): ExecutionNode[] {
    const ready: ExecutionNode[] = [];

    for (const node of graph.nodes.values()) {
      if (node.status !== 'pending') continue;

      // Check if all dependencies are completed
      const allDepsComplete = node.dependencies.every(depId => {
        const depNode = graph.nodes.get(depId);
        return depNode?.status === 'completed';
      });

      if (allDepsComplete) {
        ready.push(node);
        logger.debug('Node ready for execution', {
          graphId: graph.id,
          nodeId: node.id,
          type: node.type,
          dependencyCount: node.dependencies.length,
        });
      }
    }

    if (ready.length > 0) {
      logger.info('Ready nodes found', {
        graphId: graph.id,
        readyCount: ready.length,
        canParallelize: ready.length > 1,
      });
    }

    // Enforce concurrency limit — only return up to MAX_CONCURRENT_NODES ready nodes
    return ready.slice(0, this.MAX_CONCURRENT_NODES);
  }

  /**
   * Check if graph can be parallelized
   */
  canParallelize(graph: ExecutionGraph): boolean {
    const readyNodes = this.getReadyNodes(graph);
    const canParallelize = readyNodes.length > 1;
    
    logger.debug('Parallelization check', {
      graphId: graph.id,
      readyNodes: readyNodes.length,
      canParallelize,
    });
    
    return canParallelize;
  }

  /**
   * Mark node as running
   */
  markRunning(graph: ExecutionGraph, nodeId: string): void {
    const node = graph.nodes.get(nodeId);
    if (!node) {
      logger.warn('Attempted to mark non-existent node as running', { graphId: graph.id, nodeId });
      return;
    }

    node.status = 'running';
    node.startedAt = Date.now();
    // FIX (Bug 12): Create abort controller for this node so it can be
    // cancelled later via cancelGraph()
    node.abortController = new AbortController();

    if (graph.status === 'pending') {
      graph.status = 'running';
      graph.startedAt = Date.now();
      logger.info('Graph execution started', { graphId: graph.id });
    }

    logger.debug('Node marked as running', {
      graphId: graph.id,
      nodeId,
      type: node.type,
      startedAt: node.startedAt,
    });
  }

  /**
   * Mark node as completed
   */
  markComplete(graph: ExecutionGraph, nodeId: string, result: any): void {
    const node = graph.nodes.get(nodeId);
    if (!node) {
      logger.warn('Attempted to mark non-existent node as complete', { graphId: graph.id, nodeId });
      return;
    }

    node.status = 'completed';
    node.result = result;
    node.completedAt = Date.now();
    // Clean up abort controller — no longer needed
    node.abortController = undefined;
    const duration = node.completedAt - (node.startedAt || node.completedAt);

    logger.debug('Node marked as complete', {
      graphId: graph.id,
      nodeId,
      type: node.type,
      duration,
    });

    // Unblock dependent nodes
    const dependents = graph.edges.get(nodeId);
    if (dependents) {
      let unblockedCount = 0;
      for (const depId of dependents) {
        const depNode = graph.nodes.get(depId);
        if (depNode && depNode.status === 'blocked') {
          // Check if all dependencies are now complete
          const allDepsComplete = depNode.dependencies.every(dId => {
            const dNode = graph.nodes.get(dId);
            return dNode?.status === 'completed';
          });

          if (allDepsComplete) {
            depNode.status = 'pending';
            unblockedCount++;
            logger.debug('Node unblocked', {
              graphId: graph.id,
              nodeId: depId,
              unblockedBy: nodeId,
            });
          }
        }
      }
      
      if (unblockedCount > 0) {
        logger.info('Dependent nodes unblocked', {
          graphId: graph.id,
          completedNodeId: nodeId,
          unblockedCount,
        });
      }
    }

    // Check if graph is complete
    this.checkGraphComplete(graph);
  }

  /**
   * Mark node as failed
   */
  markFailed(graph: ExecutionGraph, nodeId: string, error: string): void {
    const node = graph.nodes.get(nodeId);
    if (!node) return;

    node.status = 'failed';
    node.error = error;
    node.completedAt = Date.now();
    // Clean up abort controller — no longer needed
    node.abortController = undefined;

    // Mark all dependent nodes as blocked
    this.markDependentsBlocked(graph, nodeId);

    // Check if graph has failed
    this.checkGraphFailed(graph);

    logger.warn('Node marked as failed', {
      graphId: graph.id,
      nodeId,
      error,
    });
  }

  /**
   * Retry failed node
   */
  retryNode(graph: ExecutionGraph, nodeId: string): boolean {
    const node = graph.nodes.get(nodeId);
    if (!node || node.status !== 'failed') return false;

    if (node.retryCount >= node.maxRetries) {
      logger.warn('Max retries exceeded', {
        graphId: graph.id,
        nodeId,
        retryCount: node.retryCount,
      });
      return false;
    }

    node.retryCount++;
    node.status = 'pending';
    node.error = undefined;
    node.startedAt = undefined;
    node.completedAt = undefined;

    logger.info('Node retry scheduled', {
      graphId: graph.id,
      nodeId,
      retryCount: node.retryCount,
    });

    return true;
  }

  /**
   * Get graph progress
   */
  getProgress(graph: ExecutionGraph): {
    total: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
    percent: number;
  } {
    const nodes = Array.from(graph.nodes.values());
    const total = nodes.length;
    const completed = nodes.filter(n => n.status === 'completed').length;
    const failed = nodes.filter(n => n.status === 'failed').length;
    const running = nodes.filter(n => n.status === 'running').length;
    const pending = nodes.filter(n => n.status === 'pending' || n.status === 'blocked').length;

    return {
      total,
      completed,
      failed,
      running,
      pending,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  /**
   * Get execution timeline
   */
  getTimeline(graph: ExecutionGraph): Array<{
    nodeId: string;
    type: ExecutionNodeType;
    status: NodeStatus;
    duration?: number;
    startedAt?: number;
    completedAt?: number;
  }> {
    return Array.from(graph.nodes.values())
      .filter(n => n.startedAt)
      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
      .map(n => ({
        nodeId: n.id,
        type: n.type,
        status: n.status,
        duration: n.completedAt && n.startedAt ? n.completedAt - n.startedAt : undefined,
        startedAt: n.startedAt,
        completedAt: n.completedAt,
      }));
  }

  /**
   * Cancel graph execution, aborting any in-flight operations.
   * FIX (Bug 12): Creates and triggers abort signals for running nodes
   * so that downstream operations can clean up properly.
   */
  cancelGraph(graph: ExecutionGraph): void {
    graph.status = 'cancelled';

    for (const node of graph.nodes.values()) {
      if (node.status === 'running') {
        // FIX: Abort in-flight operations via abort controller
        if (node.abortController) {
          node.abortController.abort('Graph cancelled');
          node.abortController = undefined;
        }
        node.status = 'cancelled';
        node.completedAt = Date.now();
        node.error = 'Cancelled by graph';
      } else if (node.status === 'pending' || node.status === 'blocked') {
        node.status = 'cancelled';
      }
    }

    logger.info('Graph cancelled', { graphId: graph.id });
  }

  private markDependentsBlocked(graph: ExecutionGraph, nodeId: string): void {
    const dependents = graph.edges.get(nodeId);
    if (!dependents) return;

    for (const depId of dependents) {
      const depNode = graph.nodes.get(depId);
      if (depNode && depNode.status !== 'completed') {
        depNode.status = 'blocked';
      }
      // Recursively mark dependents
      this.markDependentsBlocked(graph, depId);
    }
  }

  private checkGraphComplete(graph: ExecutionGraph): void {
    const nodes = Array.from(graph.nodes.values());
    const allComplete = nodes.every(n => n.status === 'completed');
    const allFinished = nodes.every(n => 
      n.status === 'completed' || n.status === 'failed' || n.status === 'cancelled'
    );

    if (allComplete) {
      graph.status = 'completed';
      graph.completedAt = Date.now();
      logger.info('Graph completed', { graphId: graph.id });
    } else if (allFinished) {
      graph.status = 'failed';
      graph.completedAt = Date.now();
      logger.warn('Graph finished with failures', { graphId: graph.id });
    }
  }

  /**
   * Detect cycles in the graph using DFS.
   * Returns true if a cycle exists (graph is not a valid DAG).
   */
  private hasCycle(graph: ExecutionGraph): boolean {
    const WHITE = 0; // unvisited
    const GRAY = 1;  // in current DFS path
    const BLACK = 2; // fully processed

    const color = new Map<string, number>();
    for (const nodeId of graph.nodes.keys()) {
      color.set(nodeId, WHITE);
    }

    const dfs = (nodeId: string): boolean => {
      color.set(nodeId, GRAY);
      const neighbors = graph.edges.get(nodeId);
      if (neighbors) {
        for (const neighbor of neighbors) {
          const neighborColor = color.get(neighbor);
          if (neighborColor === GRAY) {
            // Back edge found — cycle detected
            return true;
          }
          if (neighborColor === WHITE && dfs(neighbor)) {
            return true;
          }
        }
      }
      color.set(nodeId, BLACK);
      return false;
    };

    for (const nodeId of graph.nodes.keys()) {
      if (color.get(nodeId) === WHITE) {
        if (dfs(nodeId)) return true;
      }
    }
    return false;
  }

  private checkGraphFailed(graph: ExecutionGraph): void {
    const nodes = Array.from(graph.nodes.values());
    const hasPending = nodes.some(n => n.status === 'pending' || n.status === 'running');

    if (!hasPending) {
      graph.status = 'failed';
      graph.completedAt = Date.now();
      logger.warn('Graph failed', { graphId: graph.id });
    }
  }
}

// Singleton instance
export const executionGraphEngine = new ExecutionGraphEngine();
