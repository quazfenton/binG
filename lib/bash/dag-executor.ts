/**
 * DAG Executor - Execute bash pipelines with retries & parallelism
 *
 * @see bash.md - Bash-native agent execution patterns
 */

import { DAG, DAGNode, DAGExecutionResult, createDAG } from './bash-event-schema';
import { executeBashCommand } from './bash-tool';
import { virtualFilesystem } from '@/lib/virtual-filesystem/index.server';
import { createLogger } from '@/lib/utils/logger';
import { optimizeDAG, validateDAG } from './dag-compiler';

const logger = createLogger('Bash:DAGExecutor');

// ============================================================================
// Execution Context
// ============================================================================

export interface ExecutionContext {
  agentId: string;
  workingDir: string;
  env?: Record<string, string>;
  results: Record<string, any>;
  optimize?: boolean;
  parallel?: boolean;
}

// ============================================================================
// Single Node Execution
// ============================================================================

/**
 * Execute single DAG node
 */
export async function executeNode(
  node: DAGNode,
  ctx: ExecutionContext,
  inputs: any[] = []
): Promise<any> {
  const nodeType = node.type;
  
  logger.info('Executing DAG node', {
    id: node.id,
    type: nodeType,
    command: 'command' in node ? (node as any).command?.slice(0, 100) : undefined,
  });

  try {
    let result: any;

    // Type guard for bash nodes
    if (nodeType === 'bash') {
      const bashNode = node as any as {
        id: string;
        type: 'bash';
        command: string;
        dependsOn: string[];
        outputs?: string[];
        stdin?: string;
        metadata?: any;
      };
      // Combine stdin from previous node
      const stdin = inputs.length > 0 ? inputs[0]?.stdout : undefined;

      result = await executeBashCommand(bashNode.command, {
        workingDir: ctx.workingDir,
        env: ctx.env,
        stdin,
        timeout: 30000,
      });

      // Persist output to VFS if specified
      if (bashNode.outputs && bashNode.outputs.length > 0) {
        for (const outputPath of bashNode.outputs) {
          try {
            await virtualFilesystem.writeFile(
              ctx.agentId,
              outputPath,
              result.stdout
            );
            logger.debug('Persisted node output to VFS', { outputPath });
          } catch (error: any) {
            logger.warn('Failed to persist output', { outputPath, error: error.message });
          }
        }
      }
    } else if (nodeType === 'tool') {
      // Type guard for tool nodes
      const toolNode = node as any as {
        type: 'tool';
        tool: string;
        args?: any;
        command?: string;
      };
      // TODO: Route to structured tool
      logger.warn('Tool execution not yet implemented, falling back to bash');
      result = await executeBashCommand(toolNode.command || '', {
        workingDir: ctx.workingDir,
        env: ctx.env,
      });
    } else if (nodeType === 'container') {
      // Type guard for container nodes
      const containerNode = node as any as {
        type: 'container';
        command: string;
        args?: any;
      };
      // TODO: Route to sandbox provider (Daytona/E2B)
      logger.warn('Container execution not yet implemented, falling back to bash');
      result = await executeBashCommand(containerNode.command, {
        workingDir: ctx.workingDir,
        env: ctx.env,
      });
    } else {
      // Exhaustive check - this should never happen with proper typing
      const _exhaustive: never = nodeType;
      throw new Error(`Unknown node type: ${_exhaustive}`);
    }

    logger.debug('Node completed', { 
      id: node.id, 
      success: result.success,
      exitCode: result.exitCode,
    });

    return result;
  } catch (error: any) {
    logger.error('Node execution failed', { 
      id: node.id, 
      error: error.message,
    });
    throw error;
  }
}

// ============================================================================
// Sequential DAG Execution
// ============================================================================

/**
 * Execute complete DAG sequentially
 */
export async function executeDAG(
  dag: DAG,
  ctx: ExecutionContext
): Promise<DAGExecutionResult> {
  const startTime = Date.now();
  const results: Record<string, any> = {};
  const outputs: Record<string, string> = {};
  const errors: Array<{ nodeId: string; error: string; attempt: number }> = [];

  logger.info('Starting DAG execution', { 
    nodeId: dag.nodes.length,
    agentId: ctx.agentId,
    optimized: dag.metadata?.optimized,
  });

  // Validate DAG first
  const validation = validateDAG(dag);
  if (!validation.valid) {
    logger.error('DAG validation failed', validation.errors);
    return {
      success: false,
      nodeResults: {},
      outputs: {},
      duration: 0,
      errors: validation.errors.map(e => ({ nodeId: 'dag', error: e, attempt: 0 })),
    };
  }

  // Execute nodes respecting dependencies
  for (const node of dag.nodes) {
    try {
      // Check if all dependencies succeeded
      const failedDeps = node.dependsOn.filter(depId => {
        const depResult = results[depId];
        return !depResult || depResult.success === false;
      });

      if (failedDeps.length > 0) {
        // Skip this node - prerequisite dependencies failed
        logger.warn('Skipping node due to failed dependencies', {
          id: node.id,
          failedDeps,
        });
        
        errors.push({
          nodeId: node.id,
          error: `Dependency failed: ${failedDeps.join(', ')}`,
          attempt: 0,
        });
        continue; // Skip to next node
      }

      // Wait for dependencies
      const inputs = node.dependsOn.map(depId => results[depId]);

      // Execute node
      const result = await executeNode(node, ctx, inputs);
      results[node.id] = result;

      // Collect outputs
      if (node.outputs) {
        for (const outputPath of node.outputs) {
          try {
            const file = await virtualFilesystem.readFile(ctx.agentId, outputPath);
            outputs[outputPath] = file.content;
          } catch (error: any) {
            logger.debug('Output file not yet available', { outputPath });
          }
        }
      }

      logger.debug('Node completed', {
        id: node.id,
        success: result.success,
      });
    } catch (error: any) {
      logger.error('Node failed', {
        id: node.id,
        error: error.message,
      });

      errors.push({
        nodeId: node.id,
        error: error.message,
        attempt: node.metadata?.retryCount || 0,
      });

      // Continue execution if node is not critical
      // TODO: Add criticality metadata to nodes
    }
  }

  const duration = Date.now() - startTime;

  const success = errors.length === 0;

  logger.info('DAG execution completed', { 
    nodeId: dag.nodes.length,
    success,
    duration,
    errorCount: errors.length,
  });

  return {
    success,
    nodeResults: results,
    outputs,
    duration,
    errors,
  };
}

// ============================================================================
// Parallel DAG Execution
// ============================================================================

/**
 * Execute DAG with parallelism
 */
export async function executeDAGParallel(
  dag: DAG,
  ctx: ExecutionContext
): Promise<DAGExecutionResult> {
  const startTime = Date.now();
  const results: Record<string, any> = {};
  const outputs: Record<string, string> = {};
  const errors: Array<{ nodeId: string; error: string; attempt: number }> = [];
  const executed = new Set<string>();

  logger.info('Starting parallel DAG execution', { 
    nodeId: dag.nodes.length,
    agentId: ctx.agentId,
  });

  // Validate DAG first
  const validation = validateDAG(dag);
  if (!validation.valid) {
    logger.error('DAG validation failed', validation.errors);
    return {
      success: false,
      nodeResults: {},
      outputs: {},
      duration: 0,
      errors: validation.errors.map(e => ({ nodeId: 'dag', error: e, attempt: 0 })),
    };
  }

  // Optional optimization
  let optimizedDag = dag;
  if (ctx.optimize !== false) {
    optimizedDag = optimizeDAG(dag);
  }

  const optimizedValidation = validateDAG(optimizedDag);
  if (!optimizedValidation.valid) {
    logger.error('Optimized DAG validation failed', optimizedValidation.errors);
    return {
      success: false,
      nodeResults: {},
      outputs: {},
      duration: Date.now() - startTime,
      errors: optimizedValidation.errors.map(e => ({ nodeId: 'dag', error: e, attempt: 0 })),
    };
  }

  // Track failed nodes separately to prevent downstream execution
  const failed = new Set<string>();

  while (executed.size + failed.size < optimizedDag.nodes.length) {
    // Find ready nodes (all dependencies satisfied AND succeeded)
    const readyNodes = optimizedDag.nodes.filter(
      node =>
        !executed.has(node.id) &&
        !failed.has(node.id) &&
        node.dependsOn.every(dep => executed.has(dep) && results[dep]?.success === true)
    );

    if (readyNodes.length === 0) {
      // Check if remaining nodes are blocked by failures
      const remainingNodes = optimizedDag.nodes.filter(
        node => !executed.has(node.id) && !failed.has(node.id)
      );
      
      if (remainingNodes.length === 0) {
        break; // All nodes processed (either executed or failed)
      }
      
      // Remaining nodes are blocked by failed dependencies
      logger.warn('Nodes blocked by failed dependencies', {
        blockedCount: remainingNodes.length,
        blockedNodes: remainingNodes.map(n => n.id),
      });
      
      // Mark blocked nodes as failed
      for (const node of remainingNodes) {
        failed.add(node.id);
        errors.push({
          nodeId: node.id,
          error: 'Blocked by failed dependency',
          attempt: 0,
        });
      }
      break;
    }

    logger.debug('Executing parallel nodes', {
      count: readyNodes.length,
      nodes: readyNodes.map(n => n.id),
    });

    // Execute ready nodes in parallel
    const nodeResults = await Promise.allSettled(
      readyNodes.map(async (node, index) => {
        const inputs = node.dependsOn.map(depId => results[depId]);
        try {
          const result = await executeNode(node, ctx, inputs);
          return { nodeId: node.id, index, result };
        } catch (error: any) {
          // Attach nodeId and index so rejection handler can identify the failed node
          error.nodeId = node.id;
          error.index = index;
          throw error;
        }
      })
    );

    // Process results
    for (let i = 0; i < nodeResults.length; i++) {
      const settlement = nodeResults[i];
      const nodeId = readyNodes[i].id;

      if (settlement.status === 'fulfilled') {
        const { result } = settlement.value;
        results[nodeId] = result;
        
        if (result.success === true) {
          executed.add(nodeId);

          // Collect outputs
          const node = optimizedDag.nodes.find(n => n.id === nodeId);
          if (node?.outputs) {
            for (const outputPath of node.outputs) {
              try {
                const file = await virtualFilesystem.readFile(ctx.agentId, outputPath);
                outputs[outputPath] = file.content;
              } catch (error: any) {
                logger.debug('Output file not yet available', { outputPath });
              }
            }
          }
        } else {
          // Node executed but returned failure
          failed.add(nodeId);
          errors.push({
            nodeId,
            error: result.error || 'Node execution failed',
            attempt: 0,
          });
        }
      } else {
        // Handle rejection - use index to reliably identify the failed node
        failed.add(nodeId);
        errors.push({
          nodeId,
          error: settlement.reason?.message || 'Unknown error',
          attempt: 0,
        });
      }
    }
  }

  const duration = Date.now() - startTime;

  const success = errors.length === 0;

  logger.info('Parallel DAG execution completed', { 
    nodeId: optimizedDag.nodes.length,
    success,
    duration,
    errorCount: errors.length,
  });

  return {
    success,
    nodeResults: results,
    outputs,
    duration,
    errors,
  };
}

// ============================================================================
// Smart Execution (Auto-detect parallelism)
// ============================================================================

/**
 * Execute DAG with automatic optimization
 */
export async function executeDAGSmart(
  dag: DAG,
  ctx: ExecutionContext
): Promise<DAGExecutionResult> {
  // Check if DAG has parallelism opportunities
  const hasParallelism = dag.nodes.some(node => node.dependsOn.length > 1) ||
    dag.nodes.filter(n => n.dependsOn.length === 0).length > 1;

  if (hasParallelism && ctx.parallel !== false) {
    logger.info('Using parallel execution');
    return executeDAGParallel(dag, ctx);
  } else {
    logger.info('Using sequential execution');
    return executeDAG(dag, ctx);
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Execute DAG with retry on failure
 */
export async function executeDAGWithRetry(
  dag: DAG,
  ctx: ExecutionContext,
  maxRetries: number = 3
): Promise<DAGExecutionResult> {
  let lastResult: DAGExecutionResult | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await executeDAGSmart(dag, ctx);
      
      if (result.success) {
        return result;
      }

      lastResult = result;
      logger.warn(`DAG execution failed, attempt ${attempt}/${maxRetries}`, {
        errorCount: result.errors.length,
      });

      // TODO: Implement self-healing at DAG level
      // - Identify failed nodes
      // - Attempt command repair
      // - Retry failed nodes only
    } catch (error: any) {
      logger.error(`DAG execution error, attempt ${attempt}/${maxRetries}`, {
        error: error.message,
      });
      lastResult = {
        success: false,
        nodeResults: {},
        outputs: {},
        duration: 0,
        errors: [{ nodeId: 'dag', error: error.message, attempt }],
      };
    }
  }

  logger.error('DAG execution failed after all retries', {
    maxRetries,
    finalErrors: lastResult?.errors,
  });

  return lastResult!;
}
