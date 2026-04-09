/**
 * MCP Configuration and Provider System
 *
 * Manages MCP server configurations and provides
 * easy integration with the application
 *
 * Supports two configuration methods:
 * 1. JSON config file (mcp.config.json) - Recommended
 * 2. Environment variables (MCP_SERVERS, MCP_*_COMMAND)
 *
 * Note: This module automatically loads .env.mcp if MCP_ENABLED=true
 * Uses Next.js built-in env loading - just ensure .env.mcp exists
 */

import { mcpToolRegistry, MCPToolRegistry } from './registry'
import { MCPClient } from './client'
import type {
  MCPServerConfig,
  MCPTransportConfig,
  MCPTool,
  MCPToolResult,
} from './types'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Load MCP configuration from JSON file
 *
 * Supports two file formats:
 * 1. mcp.config.json — stdio servers (command/args, desktop mode)
 * 2. mcp.web.json — HTTP/SSE remote servers (URL-based, web + desktop)
 *
 * Server format:
 *   stdio:  { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-foo"] }
 *   http:   { "transport": { "type": "http", "url": "https://..." } }
 *   sse:    { "transport": { "type": "sse", "url": "https://.../sse" } }
 *
 * Auth (http/sse only):
 *   { "transport": { "type": "http", "url": "...", "apiKey": "...", "bearerToken": "..." } }
 */
export function loadMCPConfigFromJSON(configPath?: string): {
  servers: MCPServerConfig[]
  settings: MCPSettings
} | null {
  const servers: MCPServerConfig[] = []

  // Try the default path first, then mcp.web.json if not found
  const path = configPath || join(process.cwd(), 'mcp.config.json')
  const webPath = join(process.cwd(), 'mcp.web.json')

  for (const filePath of [path, webPath]) {
    if (!existsSync(filePath)) continue

    try {
      const content = readFileSync(filePath, 'utf-8')
      const config = JSON.parse(content)

      const parsed = Object.entries(config.mcpServers || {})
        .map(([id, server]: [string, any]): MCPServerConfig | null => {
          // Detect transport type
          if (server.transport?.type === 'http' || server.transport?.type === 'sse') {
            // HTTP / SSE transport — web compatible
            return {
              id,
              name: server.description || id,
              enabled: server.enabled !== false,
              timeout: server.timeout || 30000,
              transport: {
                type: server.transport.type as MCPTransportType,
                url: server.transport.url,
                apiKey: server.transport.apiKey,
                bearerToken: server.transport.bearerToken,
                headers: server.transport.headers,
              } as MCPTransportConfig,
            }
          }

          if (server.command) {
            // stdio transport — desktop only
            return {
              id,
              name: server.description || id,
              enabled: server.enabled !== false,
              timeout: server.timeout || 30000,
              transport: {
                type: 'stdio',
                command: server.command,
                args: server.args || [],
                env: server.env,
              } as MCPTransportConfig,
            }
          }

          // Legacy: assume stdio if only 'url' is present without transport.type
          if (server.url) {
            return {
              id,
              name: server.description || id,
              enabled: server.enabled !== false,
              timeout: server.timeout || 30000,
              transport: {
                type: 'http',
                url: server.url,
              } as MCPTransportConfig,
            }
          }

          return null
        })
        .filter((s): s is MCPServerConfig => s !== null)

      servers.push(...parsed)
      if (parsed.length > 0) {
        console.log(`[MCP Config] Loaded ${parsed.length} server(s) from ${filePath}`)
      }

      // Load settings from the first file that has them
      if (config.mcpSettings && Object.keys(globalSettings).length === 0) {
        globalSettings = config.mcpSettings
      }
    } catch (error) {
      console.error(`[MCP Config] Failed to load config file: ${filePath}`, error)
    }
  }

  if (servers.length === 0) return null

  return {
    servers,
    settings: globalSettings,
  }
}

export interface MCPSettings {
  autoConnect?: boolean
  connectionTimeout?: number
  toolCallTimeout?: number
  logging?: {
    level?: string
    file?: string
  }
  security?: {
    allowFileSystemAccess?: boolean
    allowedPaths?: string[]
    blockedCommands?: string[]
    requireApprovalFor?: string[]
  }
}

// Global settings
let globalSettings: MCPSettings = {}

/**
 * Get MCP settings
 */
export function getMCPSettings(): MCPSettings {
  return globalSettings
}

/**
 * Parse MCP server configurations from environment variables
 */
export function parseMCPServerConfigs(): MCPServerConfig[] {
  const configs: MCPServerConfig[] = []

  // First, try to load from JSON config
  const jsonConfig = loadMCPConfigFromJSON()
  if (jsonConfig) {
    globalSettings = jsonConfig.settings
    configs.push(...jsonConfig.servers)
    console.log(`[MCP Config] Loaded ${configs.length} server(s) from mcp.config.json`)
  }

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
 *
 * SAFETY: In web mode, stdio (npx) servers are skipped.
 * Only remote HTTP servers are connected in web mode.
 */
export async function initializeMCP(): Promise<MCPToolRegistry> {
  const isDesktop = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';
  const configs = parseMCPServerConfigs()

  // Filter out stdio servers in web mode
  const filteredConfigs = configs.filter(config => {
    if (config.transport?.type === 'stdio' && !isDesktop) {
      console.log(`[MCP] Skipping stdio server in web mode: ${config.name}`)
      return false
    }
    return true
  })

  for (const config of filteredConfigs) {
    mcpToolRegistry.registerServer(config)
  }

  if (filteredConfigs.length > 0) {
    console.log(`[MCP] Connecting to ${filteredConfigs.length} server(s)...`)
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
/**
 * Default MCP server configurations
 * Added: Blaxel MCP server per docs/sdk/blaxel-llms.txt
 */
export const defaultMcpServers: Record<string, MCPServerConfig> = {
  'e2b-mcp': {
    id: 'e2b-mcp',
    name: 'E2B MCP Server',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@e2b-dev/mcp-server'],
      env: {
        E2B_API_KEY: process.env.E2B_API_KEY || '',
      },
    },
    enabled: true,
  },
  'blaxel-mcp-server': {
    id: 'blaxel-mcp-server',
    name: 'Blaxel MCP Server',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'blaxel-mcp-server'],
      env: {
        BLAXEL_API_KEY: process.env.BLAXEL_API_KEY || '',
      },
    },
    enabled: true,
  },
  'arcade-mcp': {
    id: 'arcade-mcp',
    name: 'Arcade MCP Gateway',
    transport: {
      type: 'sse',
      url: process.env.ARCADE_MCP_URL || 'https://mcp.arcade.dev',
    },
    enabled: !!process.env.ARCADE_API_KEY,
  },
}

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
