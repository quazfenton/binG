/**
 * Composio MCP Integration
 * 
 * MCP (Model Context Protocol) is the RECOMMENDED way to integrate Composio
 * - Works with ANY LLM provider (Claude, GPT, Gemini, etc.)
 * - No provider-specific SDK dependencies
 * - Standardized protocol
 * - Better for multi-tenant deployments
 * 
 * Documentation: docs/sdk/composio-llms-full.txt
 */

import { Composio } from '@composio/core';

export interface ComposioMCPIntegration {
  mcpUrl: string;
  mcpHeaders: Record<string, string>;
  session: any;
  userId: string;
  toolsCount: number;
}

/**
 * Create Composio MCP integration for user
 */
export async function createComposioMCPIntegration(
  userId: string,
  opts: {
    apiKey?: string;
  } = {}
): Promise<ComposioMCPIntegration> {
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
    toolsCount: 0, // Tools count not available in new API
  };
}

/**
 * Get MCP server info
 */
export async function getComposioMCPServerInfo(userId: string) {
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
 * Get available MCP tools for user
 */
export async function getComposioMCPTools(userId: string) {
  const composio = new Composio();
  const session = await composio.create(userId);

  // New API doesn't expose tools directly
  return [];
}

/**
 * Search MCP tools
 */
export async function searchComposioMCPTools(
  userId: string,
  query: string,
  options?: { toolkit?: string }
) {
  const composio = new Composio();
  const session = await composio.create(userId);
  
  // New API doesn't expose tools directly
  return [];
}
