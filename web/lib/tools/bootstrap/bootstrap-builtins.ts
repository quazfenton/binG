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

  return count;
}

/**
 * Get list of built-in capability IDs
 */
export function getBuiltInCapabilityIds(): string[] {
  return ALL_CAPABILITIES.map(c => c.id);
}
