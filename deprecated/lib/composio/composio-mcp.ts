/**
 * Composio MCP Integration (DEPRECATED)
 *
 * This file is deprecated. Use the new implementation in:
 * lib/mcp/architecture-integration.ts
 *
 * The new implementation provides:
 * - Multi-strategy tool loading (tools.get, tools.list, session.tools, getRawComposioTools)
 * - Toolkit filtering
 * - Proper error handling and logging
 * - AI SDK compatible tool format
 *
 * @deprecated Use getComposioMCPTools() from lib/mcp/architecture-integration.ts
 */

// Re-export from new implementation for backward compatibility
export { getComposioMCPTools } from '../../lib/mcp/architecture-integration'

// Keep old exports for backward compatibility but mark as deprecated
import { Composio } from '@composio/core';

export interface ComposioMCPIntegration {
  mcpUrl: string;
  mcpHeaders: Record<string, string>;
  session: any;
  userId: string;
  toolsCount: number;
}

/**
 * @deprecated Use getComposioMCPTools() from lib/mcp/architecture-integration.ts
 */
export async function createComposioMCPIntegration(
  userId: string,
  opts: {
    apiKey?: string;
  } = {}
): Promise<ComposioMCPIntegration> {
  console.warn('[ComposioMCP] createComposioMCPIntegration is deprecated. Use getComposioMCPTools() from lib/mcp/architecture-integration.ts')
  
  const composio = new Composio({
    apiKey: opts.apiKey || process.env.COMPOSIO_API_KEY,
  });

  const session = await composio.create(userId);

  // Get MCP config from session
  const mcpConfig = (session as any).mcp || { url: '', headers: {} };

  return {
    mcpUrl: mcpConfig.url,
    mcpHeaders: mcpConfig.headers || {},
    session,
    userId,
    toolsCount: 0,
  };
}

/**
 * @deprecated Use getComposioMCPTools() from lib/mcp/architecture-integration.ts
 */
export async function getComposioMCPServerInfo(userId: string) {
  console.warn('[ComposioMCP] getComposioMCPServerInfo is deprecated. Use getComposioMCPTools() from lib/mcp/architecture-integration.ts')
  
  const composio = new Composio();
  const session = await composio.create(userId);

  const mcpConfig = (session as any).mcp || { url: '', headers: {} };

  return {
    url: mcpConfig.url,
    headers: mcpConfig.headers || {},
    toolsCount: 0,
    provider: 'composio',
    description: 'Composio Tools - 1000+ integrations (GitHub, Slack, Notion, Gmail, etc.)',
  };
}

/**
 * @deprecated Use getComposioMCPTools() from lib/mcp/architecture-integration.ts
 */
export async function searchComposioMCPTools(
  userId: string,
  query: string,
  options?: { toolkit?: string }
) {
  console.warn('[ComposioMCP] searchComposioMCPTools is deprecated. Use getComposioMCPTools() with toolkit filter from lib/mcp/architecture-integration.ts')
  
  // Delegate to new implementation with toolkit filter
  const toolkits = options?.toolkit ? [options.toolkit] : undefined
  return getComposioMCPTools(userId, toolkits)
}
