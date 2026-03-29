/**
 * DAG Execution Handler - Pipeline workflow execution
 *
 * Executes Directed Acyclic Graph (DAG) workflows with:
 * - Parallel execution of independent nodes
 * - Dependency tracking
 * - Checkpoint boundaries
 * - Error recovery
 *
 * @module events/handlers/dag-execution
 */

import { EventRecord } from '../../store';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:DAGExecutor');

/**
 * DAG Node
 */
export interface DAGNode {
  id: string;
  type: 'bash' | 'tool' | 'container';
  command?: string;
  tool?: string;
  args?: any;
  dependsOn: string[];
  outputs?: string[];
}

/**
 * DAG Execution Result
 */
export interface DAGResult {
  success: boolean;
  results: Record<string, any>;
  errors: Record<string, string>;
  executionOrder: string[];
  parallelGroups: string[][];
}

/**
 * Execute DAG workflow
 */
export async function executeDAG(dag: { nodes: DAGNode[] }, context: any): Promise<DAGResult> {
  logger.info('Executing DAG', { nodeCount: dag.nodes.length });

  const results: Record<string, any> = {};
  const errors: Record<string, string> = {};
  const executionOrder: string[] = [];

  // Topological sort for execution order
  const sorted = topologicalSort(dag.nodes);
  const parallelGroups = groupByParallelExecution(dag.nodes, sorted);

  logger.info('DAG execution plan', {
    executionOrder: sorted.map((n) => n.id),
    parallelGroups: parallelGroups.map((g) => g.map((n) => n.id)),
  });

  // Execute nodes in parallel groups
  for (const group of parallelGroups) {
    const groupPromises = group.map(async (node) => {
      try {
        executionOrder.push(node.id);

        // Get inputs from dependencies
        const inputs = node.dependsOn.map((depId) => results[depId]);

        // Execute node
        const result = await executeNode(node, inputs, context);

        results[node.id] = result;

        logger.info('Node completed', { nodeId: node.id });
      } catch (error: any) {
        errors[node.id] = error.message;
        logger.error('Node failed', { nodeId: node.id, error: error.message });
        throw error; // Fail the group
      }
    });

    // Wait for all nodes in group to complete
    try {
      await Promise.all(groupPromises);
    } catch (error: any) {
      // Continue to next group with partial results
      logger.warn('Group failed, continuing with partial results', {
        group: group.map((n) => n.id),
      });
    }
  }

  return {
    success: Object.keys(errors).length === 0,
    results,
    errors,
    executionOrder,
    parallelGroups: parallelGroups.map((g) => g.map((n) => n.id)),
  };
}

/**
 * Execute a single node
 */
async function executeNode(node: DAGNode, inputs: any[], context: any): Promise<any> {
  logger.debug('Executing node', { nodeId: node.id, type: node.type });

  switch (node.type) {
    case 'bash':
      return await executeBashNode(node, inputs, context);
    case 'tool':
      return await executeToolNode(node, inputs, context);
    case 'container':
      return await executeContainerNode(node, inputs, context);
    default:
      throw new Error(`Unknown node type: ${node.type}`);
  }
}

/**
 * Execute bash node
 */
async function executeBashNode(node: DAGNode, inputs: any[], context: any): Promise<any> {
  if (!node.command) {
    throw new Error('Bash node missing command');
  }

  // Substitute inputs into command
  let command = node.command;
  inputs.forEach((input, index) => {
    if (typeof input === 'string') {
      command = command.replace(new RegExp(`\\$\\{input${index}\\}`, 'g'), input);
    }
  });

  logger.info('Executing bash command', { command });

  // Placeholder - integrate with sandbox
  return {
    command,
    stdout: '',
    stderr: '',
    exitCode: 0,
  };
}

/**
 * Execute tool node
 */
async function executeToolNode(node: DAGNode, inputs: any[], context: any): Promise<any> {
  if (!node.tool) {
    throw new Error('Tool node missing tool name');
  }

  logger.info('Executing tool', { tool: node.tool, args: node.args });

  // Placeholder - integrate with tool registry
  return {
    tool: node.tool,
    args: node.args,
    result: 'tool result',
  };
}

/**
 * Execute container node
 */
async function executeContainerNode(node: DAGNode, inputs: any[], context: any): Promise<any> {
  logger.info('Executing container node', { nodeId: node.id });

  // Placeholder - integrate with sandbox provider
  return {
    container: 'container-id',
    output: 'container output',
  };
}

/**
 * Topological sort of DAG nodes
 */
function topologicalSort(nodes: DAGNode[]): DAGNode[] {
  const sorted: DAGNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(node: DAGNode): void {
    if (visited.has(node.id)) {
      return;
    }

    if (visiting.has(node.id)) {
      throw new Error(`Circular dependency detected: ${node.id}`);
    }

    visiting.add(node.id);

    // Visit dependencies first
    const dependencies = nodes.filter((n) => node.dependsOn.includes(n.id));
    for (const dep of dependencies) {
      visit(dep);
    }

    visiting.delete(node.id);
    visited.add(node.id);
    sorted.push(node);
  }

  for (const node of nodes) {
    visit(node);
  }

  return sorted;
}

/**
 * Group nodes into parallel execution groups
 */
function groupByParallelExecution(nodes: DAGNode[], sorted: DAGNode[]): DAGNode[][] {
  const groups: DAGNode[][] = [];
  const nodeMap = new Map<string, DAGNode>();
  const nodeLevel = new Map<string, number>();

  // Create node map
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Calculate level for each node (longest path from root)
  for (const node of sorted) {
    let maxDepLevel = -1;

    for (const depId of node.dependsOn) {
      const depLevel = nodeLevel.get(depId) ?? 0;
      maxDepLevel = Math.max(maxDepLevel, depLevel);
    }

    nodeLevel.set(node.id, maxDepLevel + 1);
  }

  // Group by level
  const levelMap = new Map<number, DAGNode[]>();
  for (const node of sorted) {
    const level = nodeLevel.get(node.id) ?? 0;
    const group = levelMap.get(level) ?? [];
    group.push(node);
    levelMap.set(level, group);
  }

  // Convert to array of groups
  for (const [, group] of levelMap) {
    groups.push(group);
  }

  return groups;
}

/**
 * Handler for DAG execution events
 */
export async function handleDAGExecution(event: EventRecord): Promise<any> {
  logger.info('Processing DAG execution', { eventId: event.id });

  const { dag, agentId, sessionId } = event.payload;

  try {
    const context = {
      agentId,
      sessionId,
      eventId: event.id,
    };

    const result = await executeDAG(dag, context);

    return {
      success: result.success,
      results: result.results,
      errors: result.errors,
      executionOrder: result.executionOrder,
      parallelGroups: result.parallelGroups,
    };
  } catch (error: any) {
    logger.error('DAG execution failed', { error: error.message });
    throw error;
  }
}

/**
 * Create DAG from bash pipeline
 */
export function createDAGFromPipeline(pipeline: string): { nodes: DAGNode[] } {
  const steps = pipeline.split('|').map((s) => s.trim());

  const nodes: DAGNode[] = steps.map((step, index) => ({
    id: `step-${index}`,
    type: 'bash',
    command: step,
    dependsOn: index === 0 ? [] : [`step-${index - 1}`],
    outputs: [],
  }));

  return { nodes };
}

/**
 * Validate DAG structure
 */
export function validateDAG(dag: { nodes: DAGNode[] }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for duplicate IDs
  const ids = new Set<string>();
  for (const node of dag.nodes) {
    if (ids.has(node.id)) {
      errors.push(`Duplicate node ID: ${node.id}`);
    }
    ids.add(node.id);
  }

  // Check for missing dependencies
  for (const node of dag.nodes) {
    for (const depId of node.dependsOn) {
      if (!ids.has(depId)) {
        errors.push(`Node ${node.id} depends on non-existent node: ${depId}`);
      }
    }
  }

  // Check for circular dependencies
  try {
    topologicalSort(dag.nodes);
  } catch (error: any) {
    errors.push(error.message);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
