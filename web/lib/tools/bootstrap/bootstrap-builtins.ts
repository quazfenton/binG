/**
 * Register Built-in Capabilities
 *
 * Registers core capabilities that are always available:
 * - File operations (read, write, delete, list, search)
 * - Sandbox operations (execute, shell, session)
 * - Web operations (browse, search)
 * - Repo operations (search, git, clone, etc.)
 * - Memory operations (store, retrieve)
 * - Automation operations (Discord, Telegram, workflow)
 */

import type { ToolRegistry } from '../registry';
import {
  ALL_CAPABILITIES,
  FILE_READ_CAPABILITY,
  FILE_WRITE_CAPABILITY,
  FILE_APPEND_CAPABILITY,
  FILE_DELETE_CAPABILITY,
  FILE_LIST_CAPABILITY,
  FILE_SEARCH_CAPABILITY,
  SANDBOX_EXECUTE_CAPABILITY,
  SANDBOX_SHELL_CAPABILITY,
  SANDBOX_SESSION_CAPABILITY,
  WEB_BROWSE_CAPABILITY,
  WEB_SEARCH_CAPABILITY,
  REPO_SEARCH_CAPABILITY,
  REPO_GIT_CAPABILITY,
  REPO_CLONE_CAPABILITY,
  REPO_COMMIT_CAPABILITY,
  REPO_PUSH_CAPABILITY,
  REPO_PULL_CAPABILITY,
  REPO_SEMANTIC_SEARCH_CAPABILITY,
  REPO_ANALYZE_CAPABILITY,
  MEMORY_STORE_CAPABILITY,
  MEMORY_RETRIEVE_CAPABILITY,
  PROJECT_BUNDLE_CAPABILITY,
  WORKSPACE_GET_CHANGES_CAPABILITY,
  AUTOMATION_DISCORD_CAPABILITY,
  AUTOMATION_TELEGRAM_CAPABILITY,
  AUTOMATION_WORKFLOW_CAPABILITY,
  INTEGRATION_CONNECT_CAPABILITY,
  INTEGRATION_EXECUTE_CAPABILITY,
  INTEGRATION_LIST_CONNECTIONS_CAPABILITY,
  INTEGRATION_REVOKE_CAPABILITY,
  INTEGRATION_SEARCH_TOOLS_CAPABILITY,
  INTEGRATION_PROXY_CAPABILITY,
} from '../capabilities';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Tools:Bootstrap-Builtins');

/**
 * Register all built-in capabilities
 *
 * @param registry - Tool registry instance
 * @returns Number of capabilities registered
 */
export async function registerBuiltInCapabilities(registry: ToolRegistry): Promise<number> {
  let count = 0;

  // Register all capabilities from the capabilities module
  // These are the core capabilities that all providers can implement
  const capabilities = [
    FILE_READ_CAPABILITY,
    FILE_WRITE_CAPABILITY,
    FILE_APPEND_CAPABILITY,
    FILE_DELETE_CAPABILITY,
    FILE_LIST_CAPABILITY,
    FILE_SEARCH_CAPABILITY,
    SANDBOX_EXECUTE_CAPABILITY,
    SANDBOX_SHELL_CAPABILITY,
    SANDBOX_SESSION_CAPABILITY,
    WEB_BROWSE_CAPABILITY,
    WEB_SEARCH_CAPABILITY,
    REPO_SEARCH_CAPABILITY,
    REPO_GIT_CAPABILITY,
    REPO_CLONE_CAPABILITY,
    REPO_COMMIT_CAPABILITY,
    REPO_PUSH_CAPABILITY,
    REPO_PULL_CAPABILITY,
    REPO_SEMANTIC_SEARCH_CAPABILITY,
    REPO_ANALYZE_CAPABILITY,
    MEMORY_STORE_CAPABILITY,
    MEMORY_RETRIEVE_CAPABILITY,
    PROJECT_BUNDLE_CAPABILITY,
    WORKSPACE_GET_CHANGES_CAPABILITY,
    AUTOMATION_DISCORD_CAPABILITY,
    AUTOMATION_TELEGRAM_CAPABILITY,
    AUTOMATION_WORKFLOW_CAPABILITY,
    INTEGRATION_CONNECT_CAPABILITY,
    INTEGRATION_EXECUTE_CAPABILITY,
    INTEGRATION_LIST_CONNECTIONS_CAPABILITY,
    INTEGRATION_REVOKE_CAPABILITY,
    INTEGRATION_SEARCH_TOOLS_CAPABILITY,
    INTEGRATION_PROXY_CAPABILITY,
  ];

  for (const capability of capabilities) {
    await registry.registerCapability(capability);
    count++;
  }

  // Register context-pack as the provider for project.bundle capability
  try {
    const { contextPackService } = await import('@/lib/virtual-filesystem/context-pack-service');
    await registry.registerTool({
      name: 'context-pack:bundle',
      capability: 'project.bundle',
      provider: 'context-pack',
      handler: async (args: any, context: any) => {
        const ownerId = context.userId || 'anonymous';
        const rootPath = args.path || '/';
        return await contextPackService.generateContextPack(ownerId, rootPath, {
          format: args.format || 'markdown',
          maxFileSize: args.maxFileSize,
          maxTotalSize: args.maxTotalSize,
          includePatterns: args.includePatterns,
          excludePatterns: args.excludePatterns,
          includeContents: args.includeContents ?? true,
          includeTree: args.includeTree ?? true,
          maxLinesPerFile: args.maxLinesPerFile,
          lineNumbers: args.lineNumbers ?? false,
        });
      },
      metadata: {
        latency: 'medium',
        cost: 'low',
        reliability: 0.99,
        tags: ['context', 'bundle', 'repomix', 'project'],
      },
      permissions: ['file:read'],
    });
    count++;
  } catch (error: any) {
    logger.warn('Context-pack provider not available', error.message);
  }

  // ========================================================================
  // Register Arcade integration tools
  // ========================================================================
  try {
    if (process.env.ARCADE_API_KEY) {
      const { ArcadeService } = await import('@/lib/integrations/arcade-service');
      const arcade = new ArcadeService({ apiKey: process.env.ARCADE_API_KEY });

      // Dynamically discover all available Arcade tools and register them
      const toolkits = await arcade.getToolkits();
      let arcadeToolCount = 0;

      for (const toolkit of toolkits.slice(0, 15)) { // Limit to top 15 toolkits
        try {
          const tools = await arcade.getTools({ toolkit });
          for (const tool of tools.slice(0, 5)) { // Limit to 5 tools per toolkit
            await registry.registerTool({
              name: `arcade:${tool.name}`,
              capability: 'integration.execute',
              provider: 'arcade',
              handler: async (args: any, context: any) => {
                const userId = context.userId || 'anonymous';
                const result = await arcade.executeTool(tool.name, args, userId);
                if (result.requiresAuth && result.authUrl) {
                  return { success: false, requiresAuth: true, authUrl: result.authUrl, message: `Connect ${tool.toolkit} to use this tool` };
                }
                return { success: result.success, data: result.output, error: result.error };
              },
              metadata: {
                latency: 'medium',
                cost: 'low',
                reliability: 0.95,
                tags: ['arcade', toolkit.toLowerCase(), 'integration'],
              },
              permissions: ['integration:execute'],
            });
            arcadeToolCount++;
          }
        } catch (e: any) {
          logger.debug(`Failed to register tools for toolkit ${toolkit}`, e.message);
        }
      }

      if (arcadeToolCount > 0) {
        logger.info(`Auto-discovered and registered ${arcadeToolCount} Arcade tools from ${toolkits.length} toolkits`);
        count += arcadeToolCount;
      }
    }
  } catch (error: any) {
    logger.warn('Arcade integration not available', error.message);
  }

  // ========================================================================
  // Register Nango integration tools (proxy-based API access)
  // ========================================================================
  try {
    if (process.env.NANGO_SECRET_KEY) {
      const { NangoService } = await import('@/lib/integrations/nango-service');
      const nango = new NangoService({ secretKey: process.env.NANGO_SECRET_KEY });

      const nangoProviderMap: Record<string, string> = {
        github: 'github', gitlab: 'gitlab', notion: 'notion',
        dropbox: 'dropbox', salesforce: 'salesforce', hubspot: 'hubspot',
        stripe: 'stripe', zoom: 'zoom', linear: 'linear', jira: 'jira',
        confluence: 'confluence', asana: 'asana', airtable: 'airtable',
        slack: 'slack', discord: 'discord', gmail: 'google',
        googlecalendar: 'google-calendar', googledrive: 'google-drive',
        spotify: 'spotify', twitter: 'twitter', reddit: 'reddit',
        linkedin: 'linkedin', twilio: 'twilio', vercel: 'vercel',
      };

      for (const [provider, configKey] of Object.entries(nangoProviderMap)) {
        await registry.registerTool({
          name: `nango:${provider}:proxy`,
          capability: 'integration.proxy',
          provider: 'nango',
          handler: async (args: any, context: any) => {
            const { endpoint, method = 'GET', params, data } = args;
            const result = await nango.proxy({
              providerConfigKey: configKey,
              connectionId: context.userId || 'default',
              endpoint,
              method,
              params,
              data,
            });
            return { success: true, data: result.data, statusCode: result.status };
          },
          metadata: {
            latency: 'medium',
            cost: 'low',
            reliability: 0.95,
            tags: ['nango', provider, 'proxy'],
          },
          permissions: ['integration:proxy'],
        });
        count++;
      }
      logger.info(`Registered ${Object.keys(nangoProviderMap).length} Nango proxy tools`);
    }
  } catch (error: any) {
    logger.warn('Nango integration not available', error.message);
  }

  // ========================================================================
  // Register Composio MCP tools
  // ========================================================================
  try {
    if (process.env.COMPOSIO_API_KEY) {
      const { searchTools, getUserTools, composioSessionManager } = await import('@/lib/integrations/composio/composio-adapter');

      // Register Composio tool search
      await registry.registerTool({
        name: 'composio:search',
        capability: 'integration.search_tools',
        provider: 'composio',
        handler: async (args: any, context: any) => {
          const { query, limit = 10 } = args;
          const userId = context.userId || 'default';
          const tools = await searchTools(userId, query, { limit });
          return { success: true, data: tools };
        },
        metadata: {
          latency: 'low',
          cost: 'low',
          reliability: 0.99,
          tags: ['composio', 'search', 'tools'],
        },
        permissions: ['integration:search'],
      });
      count++;

      // Register Composio tool execution
      await registry.registerTool({
        name: 'composio:execute',
        capability: 'integration.execute',
        provider: 'composio',
        handler: async (args: any, context: any) => {
          const { toolName, params } = args;
          const userId = context.userId || 'default';
          const { executeToolCall } = await import('@/lib/integrations/composio/composio-adapter');
          const result = await executeToolCall(userId, toolName, params);
          return { success: true, data: result };
        },
        metadata: {
          latency: 'medium',
          cost: 'medium',
          reliability: 0.90,
          tags: ['composio', 'execute'],
        },
        permissions: ['integration:execute'],
      });
      count++;

      // Register Composio connection management
      await registry.registerTool({
        name: 'composio:connect',
        capability: 'integration.connect',
        provider: 'composio',
        handler: async (args: any, context: any) => {
          const { toolkit } = args;
          const userId = context.userId || 'default';
          const { connectToolAccount } = await import('@/lib/integrations/composio/composio-adapter');
          const result = await connectToolAccount(userId, toolkit);
          return result;
        },
        metadata: {
          latency: 'low',
          cost: 'low',
          reliability: 0.99,
          tags: ['composio', 'connect', 'oauth'],
        },
        permissions: ['integration:connect'],
      });
      count++;

      logger.info('Registered Composio MCP tools');
    }
  } catch (error: any) {
    logger.warn('Composio integration not available', error.message);
  }

  return count;
}

/**
 * Get list of built-in capability IDs
 */
export function getBuiltInCapabilityIds(): string[] {
  return ALL_CAPABILITIES.map(c => c.id);
}
