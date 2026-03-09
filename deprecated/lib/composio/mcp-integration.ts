/**
 * Composio MCP (Model Context Protocol) Integration
 * 
 * Use Composio tools with ANY LLM provider (Claude, GPT, Gemini, etc.)
 * via the standardized Model Context Protocol.
 * 
 * Benefits:
 * - Works with any LLM provider
 * - No provider-specific SDK dependencies
 * - Standardized protocol
 * - Better for multi-tenant deployments
 * 
 * @see https://modelcontextprotocol.io MCP Specification
 * @see https://docs.composio.dev/mcp Composio MCP Docs
 */

import { composioSessionManager } from './session-manager';

/**
 * MCP Tool Server Configuration
 */
export interface ComposioMCPConfig {
  /**
   * Server label for MCP client
   */
  serverLabel: string;
  
  /**
   * Server description shown to users
   */
  serverDescription?: string;
  
  /**
   * Require approval for tool execution
   * - 'never': Execute without approval
   * - 'always': Require approval for all tools
   * - 'selective': Approve based on tool sensitivity
   */
  requireApproval?: 'never' | 'always' | 'selective';
}

/**
 * Create Composio MCP integration for user
 * 
 * @param userId - User identifier
 * @param config - MCP configuration
 * @returns MCP tool configuration for use with any LLM
 */
export async function createComposioMCPIntegration(
  userId: string,
  config: ComposioMCPConfig
): Promise<{
  mcpConfig: {
    type: 'mcp';
    server_label: string;
    server_url: string;
    headers: Record<string, string>;
    require_approval: string;
  };
  session: any;
  disconnect: () => Promise<void>;
}> {
  // Get user session
  const session = await composioSessionManager.getSession(userId);
  
  // Get MCP endpoint from session
  // Composio provides MCP server URL and auth headers
  const mcpUrl = session.session.mcp?.url;
  const mcpHeaders = session.session.mcp?.headers;
  
  if (!mcpUrl || !mcpHeaders) {
    throw new Error(
      'MCP not available for this Composio session. ' +
      'Ensure you are using Composio SDK v3+ with MCP support.'
    );
  }
  
  return {
    mcpConfig: {
      type: 'mcp',
      server_label: config.serverLabel,
      server_url: mcpUrl,
      headers: mcpHeaders,
      require_approval: config.requireApproval || 'never',
    },
    session: session.session,
    disconnect: async () => {
      await composioSessionManager.removeSession(userId);
    },
  };
}

/**
 * Create MCP tool configuration for Mastra
 * 
 * @param userId - User identifier
 * @param config - MCP configuration
 * @returns Mastra MCP tool
 */
export async function createComposioMastraTool(
  userId: string,
  config: ComposioMCPConfig
) {
  const { mcpConfig } = await createComposioMCPIntegration(userId, config);
  
  // Dynamic import to avoid hard dependency
  const { hostedMcpTool } = await import('@mastra/core');
  
  return hostedMcpTool({
    serverLabel: mcpConfig.server_label,
    serverUrl: mcpConfig.server_url,
    headers: mcpConfig.headers,
    requireApproval: mcpConfig.require_approval === 'always' ? 'always' : 'never',
  });
}

/**
 * Create MCP tool configuration for OpenAI Agents SDK
 * 
 * @param userId - User identifier
 * @param config - MCP configuration
 * @returns OpenAI MCP tool configuration
 */
export async function createComposioOpenAITool(
  userId: string,
  config: ComposioMCPConfig
) {
  const { mcpConfig } = await createComposioMCPIntegration(userId, config);
  
  return {
    type: 'mcp' as const,
    server_label: mcpConfig.server_label,
    server_url: mcpConfig.server_url,
    headers: mcpConfig.headers,
  };
}

/**
 * Create MCP tool configuration for Claude Agent SDK
 * 
 * @param userId - User identifier
 * @param config - MCP configuration
 * @returns Claude MCP tool configuration
 */
export async function createComposioClaudeTool(
  userId: string,
  config: ComposioMCPConfig
) {
  const { mcpConfig } = await createComposioMCPIntegration(userId, config);
  
  return {
    type: 'mcp' as const,
    serverLabel: mcpConfig.server_label,
    serverUrl: mcpConfig.server_url,
    headers: mcpConfig.headers,
  };
}

/**
 * List available tools via MCP
 * 
 * @param userId - User identifier
 * @returns Array of available tool names
 */
export async function listMCPTools(userId: string): Promise<string[]> {
  const session = await composioSessionManager.getSession(userId);
  
  // Get tools from session
  const tools = await session.session.tools.list();
  
  return tools.map((t: any) => t.name);
}

/**
 * Get tool schema via MCP
 * 
 * @param userId - User identifier
 * @param toolName - Tool name
 * @returns Tool schema
 */
export async function getMCPToolSchema(
  userId: string,
  toolName: string
): Promise<any> {
  const session = await composioSessionManager.getSession(userId);
  
  const tools = await session.session.tools.list();
  const tool = tools.find((t: any) => t.name === toolName);
  
  if (!tool) {
    throw new Error(`Tool not found: ${toolName}`);
  }
  
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

/**
 * Execute tool via MCP (for providers that don't support native MCP)
 * 
 * @param userId - User identifier
 * @param toolName - Tool name
 * @param params - Tool parameters
 * @returns Tool execution result
 */
export async function executeMCPTool(
  userId: string,
  toolName: string,
  params: Record<string, any>
) {
  return composioSessionManager.executeTool(userId, toolName, params);
}

/**
 * Middleware for MCP approval workflow
 * 
 * @param userId - User identifier
 * @param toolName - Tool being executed
 * @param params - Tool parameters
 * @returns Approval result
 */
export async function requireMCPApproval(
  userId: string,
  toolName: string,
  params: Record<string, any>
): Promise<{
  requiresApproval: boolean;
  approvalData?: {
    toolName: string;
    params: Record<string, any>;
    riskLevel: 'low' | 'medium' | 'high';
  };
}> {
  // Determine risk level based on tool
  const sensitiveTools = [
    'github_delete_repo',
    'slack_delete_message',
    'notion_delete_page',
    // Add more sensitive tools
  ];
  
  const isSensitive = sensitiveTools.some(t => toolName.includes(t));
  
  return {
    requiresApproval: isSensitive,
    approvalData: isSensitive ? {
      toolName,
      params,
      riskLevel: 'high',
    } : undefined,
  };
}

/**
 * Get Composio MCP server status
 * 
 * @param userId - User identifier
 * @returns Server status
 */
export async function getMCPStatus(userId: string): Promise<{
  available: boolean;
  url?: string;
  toolsCount?: number;
  connectionsCount?: number;
}> {
  try {
    const session = await composioSessionManager.getSession(userId);
    
    const tools = await session.session.tools.list();
    const accounts = await session.session.connectedAccounts.list();
    
    return {
      available: !!session.session.mcp?.url,
      url: session.session.mcp?.url,
      toolsCount: tools.length,
      connectionsCount: accounts.filter((a: any) => a.userId === userId).length,
    };
  } catch {
    return {
      available: false,
    };
  }
}
