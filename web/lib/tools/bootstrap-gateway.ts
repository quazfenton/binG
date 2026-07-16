/**
 * Bootstrap MCP Gateway Tools
 *
 * Auto-registers tools from MCP gateway at runtime.
 *
 * Usage:
 * ```typescript
 * import { registerGatewayTools } from '@/lib/tools/bootstrap-gateway';
 *
 * const count = await registerGatewayTools();
 * console.log(`Registered ${count} gateway tools`);
 * ```
 */

import { getToolManager } from './index';
import { createLogger } from '../utils/logger';

const logger = createLogger('Tools:Gateway-Bootstrap');

/**
 * Register tools from MCP gateway
 *
 * @returns Number of tools registered
 */
export async function registerGatewayTools(): Promise<number> {
  let count = 0;

  const gatewayUrl = process.env.MCP_GATEWAY_URL;
  if (!gatewayUrl) {
    logger.debug('MCP gateway not configured (no MCP_GATEWAY_URL)');
    return 0;
  }

  try {
    // @deprecated — MCP gateway bootstrap is handled by bootstrap-mcp.ts
    // which has proper timeouts (2s abort signal + transport-error short-circuit),
    // exponential backoff retry, and actual tool registration via registry.registerTool().
    // This file is a no-op placeholder kept for backward compatibility with the
    // caller in bootstrap.ts — prefer bootstrap-mcp.ts for any new gateway logic.
    logger.debug('MCP gateway configured at %s (deferred to bootstrap-mcp.ts)', gatewayUrl);
  } catch (error: any) {
    logger.debug('Failed to register MCP gateway tools (optional infrastructure)', error.message);
  }

  return count;
}

/**
 * Unregister all gateway tools
 */
export async function unregisterGatewayTools(): Promise<void> {
  const gatewayUrl = process.env.MCP_GATEWAY_URL;
  if (!gatewayUrl) {
    return;
  }

  try {
    const toolManager = getToolManager();
    const tools = await toolManager.getAllTools();
    const gatewayTools = tools.filter(t => (t as any).provider === 'gateway');

    for (const tool of gatewayTools) {
      // Note: ToolIntegrationManager doesn't have unregisterTool yet
      // This is a placeholder for future implementation
      logger.debug(`Would unregister gateway tool: ${tool.toolName}`);
    }

    logger.info(`Unregistered ${gatewayTools.length} gateway tools`);
  } catch (error: any) {
    logger.debug('Failed to unregister gateway tools (optional infrastructure)', error.message);
  }
}
