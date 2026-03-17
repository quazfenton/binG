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

import { createLogger } from '../utils/logger';

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

    return ready;
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
   * Cancel graph execution
   */
  cancelGraph(graph: ExecutionGraph): void {
    graph.status = 'cancelled';

    for (const node of graph.nodes.values()) {
      if (node.status === 'pending' || node.status === 'running') {
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
