/**
 * DAG Executor - Execute bash pipelines with retries & parallelism
 * 
 * @see bash.md - Bash-native agent execution patterns
 */

import { DAG, DAGNode, DAGExecutionResult, createDAG } from './bash-event-schema';
import { executeBashCommand } from './bash-tool';
import { virtualFilesystem } from '@/lib/virtual-filesystem';
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
  logger.info('Executing DAG node', { 
    id: node.id, 
    type: node.type,
    command: node.command?.slice(0, 100),
  });

  try {
    let result: any;

    if (node.type === 'bash') {
      // Combine stdin from previous node
      const stdin = inputs.length > 0 ? inputs[0]?.stdout : undefined;
      
      result = await executeBashCommand(node.command!, {
        workingDir: ctx.workingDir,
        env: ctx.env,
        stdin,
        timeout: 30000,
      });

      // Persist output to VFS if specified
      if (node.outputs && node.outputs.length > 0) {
        for (const outputPath of node.outputs) {
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
    } else if (node.type === 'tool') {
      // TODO: Route to structured tool
      logger.warn('Tool execution not yet implemented, falling back to bash');
      result = await executeBashCommand(node.command!, { 
        workingDir: ctx.workingDir,
        env: ctx.env,
      });
    } else if (node.type === 'container') {
      // TODO: Route to sandbox provider (Daytona/E2B)
      logger.warn('Container execution not yet implemented, falling back to bash');
      result = await executeBashCommand(node.command!, { 
        workingDir: ctx.workingDir,
        env: ctx.env,
      });
    } else {
      throw new Error(`Unknown node type: ${node.type}`);
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

  const success = errors.length === 0 || 
    dag.nodes.filter(n => !errors.find(e => e.nodeId === n.id)).length > 0;

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

  while (executed.size < optimizedDag.nodes.length) {
    // Find ready nodes (all dependencies satisfied)
    const readyNodes = optimizedDag.nodes.filter(
      node => 
        !executed.has(node.id) &&
        node.dependsOn.every(dep => executed.has(dep))
    );

    if (readyNodes.length === 0) {
      logger.error('Deadlock detected: no ready nodes but execution incomplete');
      throw new Error('DAG execution deadlock');
    }

    logger.debug('Executing parallel nodes', { 
      count: readyNodes.length,
      nodes: readyNodes.map(n => n.id),
    });

    // Execute ready nodes in parallel
    const nodeResults = await Promise.allSettled(
      readyNodes.map(async node => {
        const inputs = node.dependsOn.map(depId => results[depId]);
        const result = await executeNode(node, ctx, inputs);
        return { nodeId: node.id, result };
      })
    );

    // Process results
    for (const settlement of nodeResults) {
      if (settlement.status === 'fulfilled') {
        const { nodeId, result } = settlement.value;
        results[nodeId] = result;
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
        // Handle rejection
        const nodeId = readyNodes.find(n => 
          settlement.reason?.nodeId === n.id
        )?.id || 'unknown';
        
        errors.push({
          nodeId,
          error: settlement.reason?.message || 'Unknown error',
          attempt: 0,
        });
        
        executed.add(nodeId); // Mark as executed to avoid infinite loop
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

// ============================================================================
// Exports
// ============================================================================

export {
  executeDAG as executeDAGSequential,
  executeDAGParallel,
  executeDAGSmart,
  executeDAGWithRetry,
};
