/**
 * Register OAuth Integration Tools
 *
 * Auto-registers OAuth integration capabilities:
 * - Connect providers (Arcade, Nango, Composio)
 * - List connections
 * - Revoke connections
 * - Execute tools with authorization
 * 
 * SECURITY: All handlers use context.userId exclusively to prevent IDOR attacks
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Tools:OAuth-Bootstrap');

/**
 * Register OAuth integration tools
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerOAuthTools(registry: ToolRegistry, config: BootstrapConfig): Promise<number> {
  let count = 0;

  // Register OAuth connect tool
  await registry.registerTool({
    name: 'oauth:connect',
    capability: 'integration.connect',
    provider: 'oauth',
    handler: async (args: any, context: any) => {
      // SECURITY: Use context.userId exclusively, ignore args.userId to prevent IDOR
      if (!context.userId) {
        return { success: false, error: 'Authentication required' };
      }
      const { oauthIntegration } = await import('../../oauth');
      return await oauthIntegration.connect(args.provider, context.userId);
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['oauth', 'connect', 'auth'],
    },
    permissions: ['oauth:connect'],
  });
  count++;

  // Register OAuth list connections tool
  await registry.registerTool({
    name: 'oauth:listConnections',
    capability: 'integration.list_connections',
    provider: 'oauth',
    handler: async (args: any, context: any) => {
      // SECURITY: Use context.userId exclusively, ignore args.userId to prevent IDOR
      if (!context.userId) {
        return { success: false, error: 'Authentication required' };
      }
      const { oauthIntegration } = await import('../../oauth');
      return await oauthIntegration.listConnections(context.userId, args.provider);
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['oauth', 'list', 'connections'],
    },
    permissions: ['oauth:read'],
  });
  count++;

  // Register OAuth revoke tool
  await registry.registerTool({
    name: 'oauth:revoke',
    capability: 'integration.revoke',
    provider: 'oauth',
    handler: async (args: any, context: any) => {
      // SECURITY: Use context.userId exclusively, ignore args.userId to prevent IDOR
      if (!context.userId) {
        return { success: false, error: 'Authentication required' };
      }
      const { oauthIntegration } = await import('../../oauth');
      return await oauthIntegration.revoke(args.provider, context.userId, args.connectionId);
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['oauth', 'revoke', 'disconnect'],
    },
    permissions: ['oauth:write'],
  });
  count++;

  // Register OAuth execute tool
  await registry.registerTool({
    name: 'oauth:execute',
    capability: 'integration.execute',
    provider: 'oauth',
    handler: async (args: any, context: any) => {
      // SECURITY: Use context.userId exclusively, ignore args.userId to prevent IDOR
      if (!context.userId) {
        return { success: false, error: 'Authentication required' };
      }
      const { oauthIntegration } = await import('../../oauth');
      return await oauthIntegration.execute(
        args.provider,
        args.action,
        args.params,
        context.userId,
        args.conversationId || context.conversationId
      );
    },
    metadata: {
      latency: 'medium',
      cost: 'medium',
      reliability: 0.95,
      tags: ['oauth', 'execute', 'tool'],
    },
    permissions: ['oauth:execute'],
  });
  count++;

  // Register OAuth search tools tool
  await registry.registerTool({
    name: 'oauth:searchTools',
    capability: 'integration.search_tools',
    provider: 'oauth',
    handler: async (args: any, context: any) => {
      // SECURITY: Use context.userId exclusively, ignore args.userId to prevent IDOR
      if (!context.userId) {
        return { success: false, error: 'Authentication required' };
      }
      const { oauthIntegration } = await import('../../oauth');
      const tools = await oauthIntegration.getAvailableTools(context.userId);
      return { success: true, tools };
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['oauth', 'search', 'tools'],
    },
    permissions: ['oauth:read'],
  });
  count++;

  logger.info(`Registered ${count} OAuth integration tools`);
  return count;
}

/**
 * Unregister all OAuth tools
 */
export async function unregisterOAuthTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools();
  const oauthTools = tools.filter(t => t.provider === 'oauth');

  for (const tool of oauthTools) {
    await registry.unregisterTool(tool.name);
  }

  logger.info(`Unregistered ${oauthTools.length} OAuth tools`);
}
