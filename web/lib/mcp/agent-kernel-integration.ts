/**
 * Agent Kernel Integration for MCP Gateway
 *
 * Provides Agent Kernel task submission, agent lifecycle management,
 * and DAG workflow execution. Extracted from the old MCP gateway.
 *
 * Usage:
 * ```typescript
 * import { submitKernelWork, spawnKernelAgent, executeDAG } from '@/lib/mcp/agent-kernel-integration';
 *
 * // Submit work to an existing agent
 * await submitKernelWork('agent_123', { task: '...' }, 'high');
 *
 * // Spawn a new agent
 * const { agentId } = await spawnKernelAgent({ type: 'ephemeral', userId: 'user_1', goal: '...' });
 *
 * // Execute a DAG workflow (chain of agents)
 * await executeDAG({ userId: 'user_1', nodes: [
 *   { id: 'plan', type: 'ephemeral', goal: 'Plan the architecture' },
 *   { id: 'build', type: 'worker', goal: 'Build the app', dependsOn: ['plan'] },
 * ]});
 * ```
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('MCP:AgentKernel');

// Agent Kernel singleton — lazy imported to avoid circular deps
let agentKernel: any = null;

async function getAgentKernel() {
  if (!agentKernel) {
    try {
      const kernelModule = await import('@bing/shared/agent/agent-kernel');
      agentKernel = kernelModule.getAgentKernel();
    } catch (e) {
      logger.warn('Agent Kernel not available:', e);
    }
  }
  return agentKernel;
}

// ============================================================================
// Kernel Work Submission
// ============================================================================

/**
 * Submit work to an Agent Kernel agent for execution.
 *
 * @param agentId - Target agent ID
 * @param payload - Work payload (task data)
 * @param priority - Execution priority
 */
export async function submitKernelWork(
  agentId: string,
  payload: any,
  priority: 'critical' | 'high' | 'normal' | 'low' = 'normal'
): Promise<{ success: boolean; workId?: string; error?: string }> {
  try {
    const kernel = await getAgentKernel();
    if (!kernel) {
      return { success: false, error: 'Agent Kernel not available' };
    }

    const workId = await kernel.submitWork(agentId, payload, priority);
    logger.info('Work submitted to kernel', { agentId, workId });
    return { success: true, workId };
  } catch (error: any) {
    logger.error('Failed to submit kernel work', { agentId, error: error.message });
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Agent Lifecycle Management
// ============================================================================

/**
 * Spawn a new agent in the Agent Kernel.
 */
export async function spawnKernelAgent(config: {
  type: 'ephemeral' | 'persistent' | 'daemon' | 'worker';
  userId: string;
  goal: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  schedule?: string;
  maxIterations?: number;
}): Promise<{ success: boolean; agentId?: string; error?: string }> {
  try {
    const kernel = await getAgentKernel();
    if (!kernel) {
      return { success: false, error: 'Agent Kernel not available' };
    }

    const agentId = await kernel.spawnAgent({
      type: config.type,
      userId: config.userId,
      goal: config.goal,
      priority: config.priority || 'normal',
      schedule: config.schedule,
      maxIterations: config.maxIterations,
    });

    logger.info('Agent spawned', { agentId, type: config.type });
    return { success: true, agentId };
  } catch (error: any) {
    logger.error('Failed to spawn kernel agent', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get the current status of a kernel agent.
 */
export async function getKernelAgentStatus(agentId: string): Promise<any> {
  try {
    const kernel = await getAgentKernel();
    if (!kernel) return null;
    return kernel.getAgentStatus(agentId);
  } catch (error: any) {
    logger.error('Failed to get kernel agent status', { agentId, error: error.message });
    return null;
  }
}

/**
 * Get Agent Kernel statistics.
 */
export async function getKernelStats(): Promise<any> {
  try {
    const kernel = await getAgentKernel();
    if (!kernel) return null;
    return kernel.getStats();
  } catch (error: any) {
    logger.error('Failed to get kernel stats', { error: error.message });
    return null;
  }
}

// ============================================================================
// DAG Workflow Execution
// ============================================================================

/**
 * Execute a DAG (Directed Acyclic Graph) workflow via the Agent Kernel.
 * Spawns a chain of agents respecting dependency ordering.
 *
 * @param config - DAG configuration with nodes and userId
 */
export async function executeDAG(config: {
  nodes: Array<{
    id: string;
    type: 'ephemeral' | 'persistent' | 'worker';
    goal: string;
    dependsOn?: string[];
  }>;
  userId: string;
}): Promise<{ success: boolean; agentIds?: string[]; error?: string }> {
  try {
    const kernel = await getAgentKernel();
    if (!kernel) {
      return { success: false, error: 'Agent Kernel not available' };
    }

    const agentIds: string[] = [];
    const nodeMap = new Map<string, string>(); // nodeId -> agentId

    // Topologically sort nodes by dependencies
    const sortedNodes = topologicalSort(config.nodes);

    for (const node of sortedNodes) {
      // Get parent agent IDs for context
      const parentAgents = node.dependsOn?.map(id => nodeMap.get(id)).filter(Boolean) || [];

      const agentId = await kernel.spawnAgent({
        type: node.type,
        userId: config.userId,
        goal: node.goal,
        priority: 'normal',
        context: {
          parentAgentId: parentAgents[0],
          dagId: config.nodes[0]?.id,
          dependsOn: parentAgents,
        },
      });

      nodeMap.set(node.id, agentId);
      agentIds.push(agentId);
    }

    logger.info('DAG workflow executed', { agentCount: agentIds.length });
    return { success: true, agentIds };
  } catch (error: any) {
    logger.error('Failed to execute DAG', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Topological sort for DAG node ordering.
 * Throws on circular dependencies.
 */
function topologicalSort<T extends { id: string; dependsOn?: string[] }>(
  nodes: T[]
): T[] {
  const sorted: T[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  const visit = (node: T) => {
    if (temp.has(node.id)) throw new Error(`Circular dependency detected: ${node.id}`);
    if (visited.has(node.id)) return;

    temp.add(node.id);

    if (node.dependsOn) {
      for (const depId of node.dependsOn) {
        const depNode = nodes.find(n => n.id === depId);
        if (depNode) visit(depNode);
      }
    }

    temp.delete(node.id);
    visited.add(node.id);
    sorted.push(node);
  };

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      visit(node);
    }
  }

  return sorted;
}
