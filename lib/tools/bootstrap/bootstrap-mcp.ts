/**
 * Register MCP Tools
 *
 * Auto-discovers and registers tools from MCP servers at runtime.
 *
 * Features:
 * - Auto-discovery from configured MCP servers
 * - Dynamic tool registration
 * - Capability mapping
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Tools:MCP-Bootstrap');

/**
 * Register MCP tools from configured servers
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerMCPTools(registry: ToolRegistry, config: BootstrapConfig): Promise<number> {
  let count = 0;

  try {
    // Check if MCP is configured
    const mcpGatewayUrl = process.env.MCP_GATEWAY_URL;
    const mcpCliPort = process.env.MCP_CLI_PORT;

    if (!mcpGatewayUrl && !mcpCliPort) {
      logger.debug('MCP not configured (no MCP_GATEWAY_URL or MCP_CLI_PORT)');
      return 0;
    }

    // Import MCP client
    const { MCPClient } = await import('../../mcp/client');

    // Try to connect to MCP gateway
    if (mcpGatewayUrl) {
      try {
        const client = new MCPClient({
          type: 'http',
          url: mcpGatewayUrl,
          authToken: process.env.MCP_GATEWAY_AUTH_TOKEN,
        });

        await client.connect();

        // List available tools
        const tools = await client.listTools();

        for (const tool of tools) {
          // Register tool with capability mapping
          const capability = mapMCPToolToCapability(tool.name);

          await registry.registerTool({
            name: `mcp:${tool.name}`,
            capability: capability,
            provider: 'mcp',
            handler: async (args: any, context: any) => {
              return await client.callTool(tool.name, args);
            },
            metadata: {
              latency: 'medium',
              cost: 'low',
              reliability: 0.95,
              tags: ['mcp', tool.name],
            },
            permissions: [`mcp:${tool.name}`],
          });

          count++;
          logger.debug(`Registered MCP tool: ${tool.name} → ${capability}`);
        }

        await client.disconnect();
        logger.info(`Registered ${count} MCP tools from gateway`);
      } catch (error: any) {
        logger.warn('Failed to connect to MCP gateway', error.message);
      }
    }

    // Try to connect to MCP CLI (local)
    if (mcpCliPort) {
      try {
        const client = new MCPClient({
          type: 'stdio',
          port: parseInt(mcpCliPort),
        });

        await client.connect();

        // List available tools
        const tools = await client.listTools();

        for (const tool of tools) {
          // Skip if already registered from gateway
          const toolKey = `mcp:${tool.name}`;
          const existingTool = registry.getTool(toolKey);
          if (existingTool) {
            continue;
          }

          // Register tool with capability mapping
          const capability = mapMCPToolToCapability(tool.name);

          await registry.registerTool({
            name: toolKey,
            capability: capability,
            provider: 'mcp-cli',
            handler: async (args: any, context: any) => {
              return await client.callTool(tool.name, args);
            },
            metadata: {
              latency: 'low',
              cost: 'low',
              reliability: 0.98,
              tags: ['mcp-cli', tool.name],
            },
            permissions: [`mcp:${tool.name}`],
          });

          count++;
          logger.debug(`Registered MCP CLI tool: ${tool.name} → ${capability}`);
        }

        await client.disconnect();
        logger.info(`Registered ${count} MCP CLI tools`);
      } catch (error: any) {
        logger.warn('Failed to connect to MCP CLI', error.message);
      }
    }
  } catch (error: any) {
    logger.error('Failed to register MCP tools', error);
  }

  return count;
}

/**
 * Map MCP tool name to capability
 *
 * @param toolName - MCP tool name
 * @returns Capability ID
 */
function mapMCPToolToCapability(toolName: string): string {
  const lowercaseName = toolName.toLowerCase();

  // File operations
  if (lowercaseName.includes('read') && lowercaseName.includes('file')) {
    return 'file.read';
  }
  if (lowercaseName.includes('write') && lowercaseName.includes('file')) {
    return 'file.write';
  }
  if (lowercaseName.includes('delete') && lowercaseName.includes('file')) {
    return 'file.delete';
  }
  if (lowercaseName.includes('list') && (lowercaseName.includes('dir') || lowercaseName.includes('directory'))) {
    return 'file.list';
  }
  if (lowercaseName.includes('search') && lowercaseName.includes('file')) {
    return 'file.search';
  }

  // Shell operations
  if (lowercaseName.includes('shell') || lowercaseName.includes('exec') || lowercaseName.includes('run')) {
    return 'sandbox.execute';
  }

  // Git operations
  if (lowercaseName.includes('git')) {
    return 'repo.git';
  }
  if (lowercaseName.includes('clone')) {
    return 'repo.clone';
  }
  if (lowercaseName.includes('commit')) {
    return 'repo.commit';
  }
  if (lowercaseName.includes('push')) {
    return 'repo.push';
  }
  if (lowercaseName.includes('pull')) {
    return 'repo.pull';
  }

  // Default: generic execution
  return 'sandbox.execute';
}

/**
 * Unregister all MCP tools
 *
 * @param registry - Tool registry instance
 */
export async function unregisterMCPTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools();
  const mcpTools = tools.filter(t => t.provider === 'mcp' || t.provider === 'mcp-cli');

  for (const tool of mcpTools) {
    await registry.unregisterTool(tool.name);
  }

  logger.info(`Unregistered ${mcpTools.length} MCP tools`);
}
