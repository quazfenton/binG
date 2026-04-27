/**
 * Register Arcade Tools
 *
 * Auto-discovers and registers tools from Arcade when API key is configured.
 *
 * Features:
 * - Auto-discovery from Arcade API when ARCADE_API_KEY is set
 * - Dynamic tool registration
 * - Capability mapping
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Tools:Arcade-Bootstrap');

// Track if already initialized
let arcadeInitialized = false;

/**
 * Register Arcade tools when API key is configured
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerArcadeTools(registry: ToolRegistry, config: BootstrapConfig): Promise<number> {
  // Prevent duplicate initialization
  if (arcadeInitialized) {
    return 0;
  }

  // Check if explicitly disabled or no API key
  if (config.enableArcade === false) {
    logger.debug('Arcade explicitly disabled');
    return 0;
  }

  // Check if Arcade API key is configured
  const arcadeApiKey = process.env.ARCADE_API_KEY;
  if (!arcadeApiKey) {
    logger.debug('Arcade not configured (no ARCADE_API_KEY)');
    return 0;
  }

  let count = 0;

  try {
    // Import Arcade service
    const { getArcadeService } = await import('../../integrations/arcade-service');
    const arcadeService = getArcadeService();

    if (!arcadeService) {
      logger.debug('Arcade service not available');
      return 0;
    }

    // Get available tools from Arcade
    const tools = await arcadeService.getTools({ limit: 200 });

    if (!tools || tools.length === 0) {
      logger.warn('No tools returned from Arcade');
      return 0;
    }

    // Register each Arcade tool
    for (const tool of tools) {
      try {
        // Map Arcade tool to capability
        const capability = mapArcadeToolToCapability(tool.name, tool.toolkit);

        await registry.registerTool({
          name: `arcade:${tool.name}`,
          capability: capability,
          provider: 'arcade',
          handler: async (args: any, context: any) => {
            const userId = context?.userId || config.userId;
            const result = await arcadeService.executeTool(tool.name, args, userId);
            
            if (result.success) {
              return { success: true, output: result.output };
            } else {
              return { 
                success: false, 
                error: result.error,
                requiresAuth: result.requiresAuth,
                authUrl: result.authUrl,
              };
            }
          },
          metadata: {
            latency: 'medium',
            cost: 'medium',
            reliability: 0.92,
            tags: ['arcade', tool.toolkit, tool.name],
          },
          permissions: [`arcade:${tool.toolkit}`],
        });

        count++;
      } catch (error: any) {
        logger.warn(`Failed to register Arcade tool: ${tool.name}`, error.message);
      }
    }

    arcadeInitialized = true;
    logger.info(`Registered ${count} Arcade tools`);
  } catch (error: any) {
    logger.error('Failed to register Arcade tools', error);
  }

  return count;
}

/**
 * Map Arcade tool name to capability
 */
function mapArcadeToolToCapability(toolName: string, toolkit: string): string {
  const lowercaseName = toolName.toLowerCase();
  const lowercaseToolkit = (toolkit || '').toLowerCase();

  // GitHub toolkit
  if (lowercaseToolkit.includes('github')) {
    if (lowercaseName.includes('issue')) return 'repo.git';
    if (lowercaseName.includes('pr') || lowercaseName.includes('pull')) return 'repo.git';
    if (lowercaseName.includes('commit')) return 'repo.commit';
    if (lowercaseName.includes('file')) return 'file.read';
  }

  // Gmail toolkit
  if (lowercaseToolkit.includes('gmail') || lowercaseToolkit.includes('google')) {
    if (lowercaseName.includes('send') || lowercaseName.includes('create')) return 'automation.workflow';
    if (lowercaseName.includes('read') || lowercaseName.includes('list')) return 'automation.workflow';
  }

  // Slack toolkit
  if (lowercaseToolkit.includes('slack')) {
    if (lowercaseName.includes('send') || lowercaseName.includes('post')) return 'automation.workflow';
    if (lowercaseName.includes('read')) return 'automation.workflow';
  }

  // File operations
  if (lowercaseName.includes('read') && lowercaseName.includes('file')) {
    return 'file.read';
  }
  if (lowercaseName.includes('write') && lowercaseName.includes('file')) {
    return 'file.write';
  }

  // Default: generic workflow
  return 'automation.workflow';
}

/**
 * Unregister all Arcade tools
 */
export async function unregisterArcadeTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools();
  const arcadeTools = tools.filter(t => t.provider === 'arcade');

  for (const tool of arcadeTools) {
    await registry.unregisterTool(tool.name);
  }

  arcadeInitialized = false;
  logger.info(`Unregistered ${arcadeTools.length} Arcade tools`);
}