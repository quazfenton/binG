/**
 * MCP Gateway Integration
 *
 * Registers tools from MCP gateway into ToolIntegrationManager.
 * Enables dynamic tool discovery and execution via gateway.
 * Also integrates with Agent Kernel for task execution and DAG workflows.
 *
 * Usage:
 * ```typescript
 * const gateway = new MCPGateway();
 * await gateway.registerGatewayTools('http://localhost:8080');
 * 
 * // Submit work to Agent Kernel
 * await gateway.submitKernelWork(agentId, payload);
 * 
 * // Execute DAG workflow
 * await gateway.executeDAG(dagConfig);
 * ```
 */

import { createLogger } from '../utils/logger';
import type { ToolIntegrationManager } from '../tools/tool-integration-system';

// Agent Kernel integration - lazy import to avoid circular deps
let agentKernel: any = null;

async function getAgentKernel() {
  if (!agentKernel) {
    try {
      const kernelModule = await import('../agent/agent-kernel');
      agentKernel = kernelModule.getAgentKernel();
    } catch (e) {
      console.warn('[Gateway] Agent Kernel not available:', e);
    }
  }
  return agentKernel;
}

const logger = createLogger('MCP:Gateway');

export interface GatewayTool {
  name: string;
  description: string;
  capability?: string;
  inputSchema?: any;
  outputSchema?: any;
  metadata?: {
    latency?: 'low' | 'medium' | 'high';
    cost?: 'low' | 'medium' | 'high';
    reliability?: number;
  };
}

export class MCPGateway {
  private gatewayUrl: string;
  private registeredTools = new Set<string>();

  constructor(gatewayUrl: string) {
    this.gatewayUrl = gatewayUrl;
  }

  /**
   * Register all tools from MCP gateway
   */
  async registerGatewayTools(toolManager: ToolIntegrationManager): Promise<number> {
    let count = 0;

    try {
      // Fetch tools from gateway
      const response = await fetch(`${this.gatewayUrl}/tools`);
      if (!response.ok) {
        throw new Error(`Gateway returned ${response.status}`);
      }

      const gatewayTools: GatewayTool[] = await response.json();
      logger.info(`Fetched ${gatewayTools.length} tools from gateway`);

      // Register each tool
      for (const tool of gatewayTools) {
        const toolKey = `gateway:${tool.name}`;

        // Skip if already registered
        if (this.registeredTools.has(toolKey)) {
          continue;
        }

        await toolManager.registerTool(toolKey, {
          provider: 'gateway' as any,
          toolName: tool.name,
          description: tool.description,
          category: tool.capability || 'integration',
          requiresAuth: false,
          inputSchema: tool.inputSchema,
        });

        this.registeredTools.add(toolKey);
        logger.debug(`Registered gateway tool: ${toolKey}`);
        count++;
      }

      logger.info(`Registered ${count} tools from MCP gateway`);
    } catch (error: any) {
      logger.error('Failed to register gateway tools', { error: error.message, gatewayUrl: this.gatewayUrl });
    }

    return count;
  }

  /**
   * Execute tool via gateway
   */
  async executeTool(
    toolName: string,
    args: Record<string, any>,
    context: { userId: string; conversationId?: string }
  ): Promise<any> {
    try {
      const response = await fetch(`${this.gatewayUrl}/tools/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: toolName,
          args,
          context,
        }),
      });

      if (!response.ok) {
        throw new Error(`Gateway returned ${response.status}`);
      }

      const result = await response.json();
      return {
        success: result.success ?? true,
        output: result.output || result,
        error: result.error,
      };
    } catch (error: any) {
      logger.error('Gateway tool execution failed', { toolName, error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get list of registered tools
   */
  getRegisteredTools(): string[] {
    return Array.from(this.registeredTools);
  }

  /**
   * Clear registered tools (for testing)
   */
  clearRegisteredTools(): void {
    this.registeredTools.clear();
  }

  // ============================================================================
  // Agent Kernel Integration
  // ============================================================================

  /**
   * Submit work to Agent Kernel for execution
   */
  async submitKernelWork(agentId: string, payload: any, priority: 'critical' | 'high' | 'normal' | 'low' = 'normal'): Promise<{ success: boolean; workId?: string; error?: string }> {
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

  /**
   * Spawn a new agent in the kernel
   */
  async spawnKernelAgent(config: {
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

      logger.info('Agent spawned via gateway', { agentId, type: config.type });
      return { success: true, agentId };
    } catch (error: any) {
      logger.error('Failed to spawn kernel agent', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get kernel agent status
   */
  async getKernelAgentStatus(agentId: string): Promise<any> {
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
   * Get kernel statistics
   */
  async getKernelStats(): Promise<any> {
    try {
      const kernel = await getAgentKernel();
      if (!kernel) return null;
      return kernel.getStats();
    } catch (error: any) {
      logger.error('Failed to get kernel stats', { error: error.message });
      return null;
    }
  }

  /**
   * Execute DAG workflow via kernel
   * Creates a chain of agents for multi-step workflows
   */
  async executeDAG(config: {
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
      const sortedNodes = this.topologicalSort(config.nodes);

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
   * Topological sort for DAG node ordering
   */
  private topologicalSort(nodes: Array<{ id: string; dependsOn?: string[] }>): Array<{ id: string; dependsOn?: string[] }> {
    const sorted: Array<{ id: string; dependsOn?: string[] }> = [];
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (node: { id: string; dependsOn?: string[] }) => {
      if (temp.has(node.id)) throw new Error('Circular dependency detected');
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
}

/**
 * Create MCP gateway instance
 */
export function createMCPGateway(gatewayUrl: string): MCPGateway {
  return new MCPGateway(gatewayUrl);
}
