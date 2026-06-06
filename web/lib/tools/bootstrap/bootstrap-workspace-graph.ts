/**
 * Register Workspace Graph Tools
 *
 * Registers workspace-graph tools as built-in capabilities:
 * - workspace.graph              — Full workspace graph with nodes, edges, diagnostics
 * - workspace.graph_diagnostic   — Focused service diagnostic trace
 * - workspace.graph_find_process — Search for processes by command pattern
 *
 * These expose the Phase 10 workspace graph service as queryable tools
 * that AI agents can call instead of scraping terminal output.
 *
 * CRITICAL: In addition to ToolRegistry registration, this bootstrap also
 * registers a 'workspace-graph' provider with the CapabilityRouter so that
 * capability execution via router.execute() can find it. Without this,
 * both the agent-loop and MCP-server execution paths would fail at runtime
 * because CapabilityRouter.initialize() only registers built-in providers
 * (VFS, ripgrep, terminal, etc.) — 'workspace-graph' is not one of them.
 */

import type { ToolRegistry, RegisteredTool } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '@/lib/utils/logger';
import { getCapabilityRouter } from '../router';

const logger = createLogger('Tools:WorkspaceGraph-Bootstrap');

/**
 * Register a provider for the CapabilityRouter so that
 * 'workspace.graph', 'workspace.graph_diagnostic', and
 * 'workspace.graph_find_process' capabilities can be resolved
 * at runtime via router.execute().
 *
 * The CapabilityRouter does NOT auto-discover providers from the
 * ToolRegistry — they must be explicitly registered via registerProvider().
 */
async function registerCapabilityRouterProvider(): Promise<void> {
  const router = getCapabilityRouter();

  // Ensure router is initialized before registering custom provider
  if (!(router as any).initialized) {
    await router.initialize();
  }

  await router.registerCustomProvider({
    id: 'workspace-graph',
    name: 'Workspace Graph',
    capabilities: [
      'workspace.graph',
      'workspace.graph_diagnostic',
      'workspace.graph_find_process',
    ],
    isAvailable: async () => {
      try {
        // Check if the workspace graph service can be loaded
        await import('@/lib/workspace/workspace-graph-service');
        return true;
      } catch {
        return false;
      }
    },
    execute: async (capabilityId: string, input: any, context: any) => {
      const { workspaceGraphService } = await import('@/lib/workspace/workspace-graph-service');
      const workspaceId = input.workspaceId || context?.sessionId || context?.userId || 'default';

      try {
        let output: any;
        switch (capabilityId) {
          case 'workspace.graph':
            output = workspaceGraphService.getWorkspaceGraph(workspaceId);
            break;
          case 'workspace.graph_diagnostic':
            if (!input.serviceId) {
              return { success: false, error: 'Missing required field: serviceId' };
            }
            output = workspaceGraphService.getServiceDiagnostic(workspaceId, input.serviceId);
            break;
          case 'workspace.graph_find_process':
            if (!input.pattern) {
              return { success: false, error: 'Missing required field: pattern' };
            }
            output = workspaceGraphService.findProcesses(workspaceId, input.pattern);
            break;
          default:
            return { success: false, error: `Unknown capability: ${capabilityId}` };
        }
        return { success: true, output, data: output };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  logger.info('Registered workspace-graph provider in CapabilityRouter');
}

/**
 * Register workspace graph tools
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerWorkspaceGraphTools(
  registry: ToolRegistry,
  config: BootstrapConfig,
): Promise<number> {
  let count = 0;

  const tools: Array<Omit<RegisteredTool, 'inputSchema' | 'outputSchema'>> = [
    {
      name: 'workspace-graph:graph',
      capability: 'workspace.graph',
      provider: 'workspace-graph',
      handler: async (args: any, context: any) => {
        const { workspaceGraphService } = await import('@/lib/workspace/workspace-graph-service');
        const workspaceId = args.workspaceId || context.sessionId || context.userId || 'default';
        return workspaceGraphService.getWorkspaceGraph(workspaceId);
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'graph', 'state', 'diagnostics'],
      },
      permissions: [],
    },
    {
      name: 'workspace-graph:diagnostic',
      capability: 'workspace.graph_diagnostic',
      provider: 'workspace-graph',
      handler: async (args: any, context: any) => {
        const { workspaceGraphService } = await import('@/lib/workspace/workspace-graph-service');
        const workspaceId = args.workspaceId || context.sessionId || context.userId || 'default';
        return workspaceGraphService.getServiceDiagnostic(workspaceId, args.serviceId);
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'service', 'diagnostic'],
      },
      permissions: [],
    },
    {
      name: 'workspace-graph:find-process',
      capability: 'workspace.graph_find_process',
      provider: 'workspace-graph',
      handler: async (args: any, context: any) => {
        const { workspaceGraphService } = await import('@/lib/workspace/workspace-graph-service');
        const workspaceId = args.workspaceId || context.sessionId || context.userId || 'default';
        return workspaceGraphService.findProcesses(workspaceId, args.pattern);
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'process', 'search'],
      },
      permissions: [],
    },
  ];

  for (const tool of tools) {
    await registry.registerTool(tool);
    count++;
  }

  // CRITICAL: Register provider with CapabilityRouter so that
  // router.execute() can resolve workspace-graph capabilities.
  // Without this, both agent-loop and MCP-server paths fail at runtime.
  try {
    await registerCapabilityRouterProvider();
  } catch (error: any) {
    logger.warn('Failed to register workspace-graph provider in CapabilityRouter', error.message);
  }

  logger.info(`Registered ${count} workspace graph tools/capabilities`);
  return count;
}

/**
 * Unregister workspace graph tools
 *
 * @param registry - Tool registry instance
 */
export async function unregisterWorkspaceGraphTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools().filter(t => t.provider === 'workspace-graph');
  for (const tool of tools) {
    await registry.unregisterTool(tool.name);
  }

  // Also unregister from CapabilityRouter
  try {
    const router = getCapabilityRouter();
    router.unregisterProvider('workspace-graph');
    logger.info('Unregistered workspace-graph provider from CapabilityRouter');
  } catch { /* skip */ }

  logger.info(`Unregistered ${tools.length} workspace graph tools`);
}
