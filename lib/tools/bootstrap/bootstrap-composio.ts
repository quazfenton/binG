/**
 * Register Composio Tools
 *
 * Auto-discovers and registers tools from Composio toolkits at runtime.
 *
 * Features:
 * - Auto-discovery from configured Composio API
 * - Dynamic toolkit registration
 * - Capability mapping
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Tools:Composio-Bootstrap');

/**
 * Register Composio tools from configured toolkits
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerComposioTools(registry: ToolRegistry, config: BootstrapConfig): Promise<number> {
  let count = 0;

  try {
    // Check if Composio is configured
    const composioApiKey = process.env.COMPOSIO_API_KEY;

    if (!composioApiKey) {
      logger.debug('Composio not configured (no COMPOSIO_API_KEY)');
      return 0;
    }

    // Import Composio service
    const { getComposioService } = await import('../../integrations/composio-service');
    const composioService = getComposioService();

    if (!composioService) {
      logger.debug('Composio service not available');
      return 0;
    }

    // Get available toolkits
    const toolkits = await composioService.getAvailableToolkits();

    for (const toolkit of toolkits) {
      try {
        // Register toolkit tools
        const toolkitCount = await registerComposioToolkit(registry, toolkit.name, composioService);
        count += toolkitCount;
        logger.debug(`Registered ${toolkitCount} tools from Composio toolkit: ${toolkit.name}`);
      } catch (error: any) {
        logger.warn(`Failed to register Composio toolkit: ${toolkit.name}`, error.message);
      }
    }

    logger.info(`Registered ${count} Composio tools from ${toolkits.length} toolkits`);
  } catch (error: any) {
    logger.error('Failed to register Composio tools', error);
  }

  return count;
}

/**
 * Register tools from a single Composio toolkit
 */
async function registerComposioToolkit(
  registry: ToolRegistry,
  toolkitName: string,
  composioService: any
): Promise<number> {
  let count = 0;

  try {
    // Get tools for this toolkit
    const tools = await composioService.getToolsForToolkit(toolkitName);

    for (const tool of tools) {
      // Map Composio tool to capability
      const capability = mapComposioToolToCapability(tool.name, toolkitName);

      await registry.registerTool({
        name: `composio:${toolkitName}:${tool.name}`,
        capability: capability,
        provider: 'composio',
        handler: async (args: any, context: any) => {
          return await composioService.executeTool(tool.name, args, context.userId);
        },
        metadata: {
          latency: 'medium',
          cost: 'medium',
          reliability: 0.92,
          tags: ['composio', toolkitName, tool.name],
        },
        permissions: [`composio:${toolkitName}`],
      });

      count++;
    }
  } catch (error: any) {
    logger.warn(`Failed to get tools for Composio toolkit: ${toolkitName}`, error.message);
  }

  return count;
}

/**
 * Map Composio tool name to capability
 */
function mapComposioToolToCapability(toolName: string, toolkitName: string): string {
  const lowercaseName = toolName.toLowerCase();
  const lowercaseToolkit = toolkitName.toLowerCase();

  // Gmail toolkit
  if (lowercaseToolkit.includes('gmail')) {
    if (lowercaseName.includes('send')) return 'automation.workflow';
    if (lowercaseName.includes('read')) return 'automation.workflow';
    if (lowercaseName.includes('search')) return 'automation.workflow';
  }

  // Slack toolkit
  if (lowercaseToolkit.includes('slack')) {
    if (lowercaseName.includes('send') || lowercaseName.includes('post')) return 'automation.workflow';
    if (lowercaseName.includes('read')) return 'automation.workflow';
  }

  // GitHub toolkit
  if (lowercaseToolkit.includes('github')) {
    if (lowercaseName.includes('issue')) return 'repo.git';
    if (lowercaseName.includes('pr') || lowercaseName.includes('pull')) return 'repo.git';
    if (lowercaseName.includes('file')) return 'file.read';
  }

  // Google toolkit
  if (lowercaseToolkit.includes('google')) {
    if (lowercaseName.includes('calendar')) return 'automation.workflow';
    if (lowercaseName.includes('drive')) return 'file.read';
    if (lowercaseName.includes('docs')) return 'file.read';
    if (lowercaseName.includes('sheets')) return 'file.read';
  }

  // Default: generic workflow
  return 'automation.workflow';
}

/**
 * Unregister all Composio tools
 */
export async function unregisterComposioTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools();
  const composioTools = tools.filter(t => t.provider === 'composio');

  for (const tool of composioTools) {
    await registry.unregisterTool(tool.name);
  }

  logger.info(`Unregistered ${composioTools.length} Composio tools`);
}
