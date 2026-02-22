/**
 * MCP Configuration and Provider System
 * 
 * Manages MCP server configurations and provides
 * easy integration with the application
 * 
 * Note: This module automatically loads .env.mcp if MCP_ENABLED=true
 * Uses Next.js built-in env loading - just ensure .env.mcp exists
 */

import { mcpToolRegistry, MCPToolRegistry } from './tool-registry'
import { MCPClient } from './client'
import type {
  MCPServerConfig,
  MCPTransportConfig,
  MCPTool,
  MCPToolResult,
} from './types'

/**
 * Parse MCP server configurations from environment variables
 */
export function parseMCPServerConfigs(): MCPServerConfig[] {
  const configs: MCPServerConfig[] = []
  
  // Parse MCP_SERVERS environment variable (JSON array)
  const serversEnv = process.env.MCP_SERVERS
  if (serversEnv) {
    try {
      const parsed = JSON.parse(serversEnv)
      if (Array.isArray(parsed)) {
        configs.push(...parsed)
      }
    } catch (error) {
      console.error('[MCP Config] Failed to parse MCP_SERVERS:', error)
    }
  }

  // Parse individual server configs from MCP_*_COMMAND variables
  // Format: MCP_<NAME>_COMMAND, MCP_<NAME>_ARGS, MCP_<NAME>_ENABLED
  const mcpPrefix = 'MCP_'
  const commandSuffix = '_COMMAND'
  
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(mcpPrefix) && key.endsWith(commandSuffix)) {
      const serverId = key
        .slice(mcpPrefix.length, -commandSuffix.length)
        .toLowerCase()

      const argsEnv = process.env[`MCP_${serverId.toUpperCase()}_ARGS`]
      const enabledEnv = process.env[`MCP_${serverId.toUpperCase()}_ENABLED`]
      const timeoutEnv = process.env[`MCP_${serverId.toUpperCase()}_TIMEOUT`]

      // Parse args with error handling to prevent crash on malformed JSON
      let args: any[] = []
      if (argsEnv) {
        try {
          args = JSON.parse(argsEnv)
        } catch (error) {
          console.warn(`[MCP] Invalid JSON in MCP_${serverId.toUpperCase()}_ARGS: ${argsEnv}. Using empty args.`)
        }
      }

      const config: MCPServerConfig = {
        id: serverId,
        name: serverId,
        enabled: enabledEnv !== 'false',
        timeout: timeoutEnv ? parseInt(timeoutEnv, 10) : 30000,
        transport: {
          type: 'stdio',
          command: value,
          args,
        },
      }

      configs.push(config)
    }
  }

  return configs
}

/**
 * Initialize MCP with configurations from environment
 */
export async function initializeMCP(): Promise<MCPToolRegistry> {
  const configs = parseMCPServerConfigs()
  
  for (const config of configs) {
    mcpToolRegistry.registerServer(config)
  }
  
  if (configs.length > 0) {
    console.log(`[MCP] Connecting to ${configs.length} server(s)...`)
    await mcpToolRegistry.connectAll()
  }
  
  return mcpToolRegistry
}

/**
 * Shutdown MCP connections
 */
export async function shutdownMCP(): Promise<void> {
  await mcpToolRegistry.disconnectAll()
}

/**
 * Create stdio transport config
 */
export function createStdioTransport(
  command: string,
  args: string[] = [],
  env?: Record<string, string>,
  cwd?: string
): MCPTransportConfig {
  return {
    type: 'stdio',
    command,
    args,
    env,
    cwd,
  }
}

/**
 * Create SSE transport config
 */
export function createSSETransport(url: string): MCPTransportConfig {
  return {
    type: 'sse',
    url,
  }
}

/**
 * Create WebSocket transport config
 */
export function createWebSocketTransport(wsUrl: string): MCPTransportConfig {
  return {
    type: 'websocket',
    wsUrl,
  }
}

/**
 * Common MCP server presets
 */
export const MCPServerPresets = {
  /**
   * Filesystem server for local file access
   */
  filesystem: (rootPath: string): MCPServerConfig => ({
    id: 'filesystem',
    name: 'Filesystem',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', rootPath],
    },
  }),

  /**
   * Git server for git operations
   */
  git: (repositoryPath: string): MCPServerConfig => ({
    id: 'git',
    name: 'Git',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-git', repositoryPath],
    },
  }),

  /**
   * GitHub server for GitHub API access
   */
  github: (token: string): MCPServerConfig => ({
    id: 'github',
    name: 'GitHub',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: token,
      },
    },
  }),

  /**
   * PostgreSQL server for database access
   */
  postgresql: (connectionString: string): MCPServerConfig => ({
    id: 'postgresql',
    name: 'PostgreSQL',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', connectionString],
    },
  }),

  /**
   * SQLite server for SQLite database access
   */
  sqlite: (databasePath: string): MCPServerConfig => ({
    id: 'sqlite',
    name: 'SQLite',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite', databasePath],
    },
  }),

  /**
   * Puppeteer server for browser automation
   */
  puppeteer: (): MCPServerConfig => ({
    id: 'puppeteer',
    name: 'Puppeteer',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  }),

  /**
   * Fetch server for web content retrieval
   */
  fetch: (): MCPServerConfig => ({
    id: 'fetch',
    name: 'Fetch',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-fetch'],
    },
  }),

  /**
   * Memory server for persistent memory
   */
  memory: (): MCPServerConfig => ({
    id: 'memory',
    name: 'Memory',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
  }),
}

/**
 * Tool call helper for use in chat/agent systems
 */
export async function callMCPTool(
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const result = await mcpToolRegistry.callTool(toolName, args)
    
    return {
      success: result.success,
      output: result.content,
      error: result.isError ? result.content : undefined,
    }
  } catch (error: any) {
    return {
      success: false,
      output: '',
      error: error.message || 'Tool call failed',
    }
  }
}

/**
 * Get all available tools as AI SDK format
 */
export function getMCPTools(): Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}> {
  return mcpToolRegistry.getToolDefinitions()
}

/**
 * Get server statuses for health monitoring
 */
export function getMCPServerStatuses() {
  return mcpToolRegistry.getAllServerStatuses()
}

/**
 * Check if MCP is available and has tools
 */
export function isMCPAvailable(): boolean {
  const tools = mcpToolRegistry.getAllTools()
  return tools.length > 0
}

/**
 * Get count of available tools
 */
export function getMCPToolCount(): number {
  return mcpToolRegistry.getAllTools().length
}
