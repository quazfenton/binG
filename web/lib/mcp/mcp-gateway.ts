/**
 * MCP Gateway Integration
 *
 * Centralized gateway for discovering and invoking MCP (Model Context Protocol) servers.
 * Provides unified interface for accessing tools from multiple MCP servers.
 *
 * Features:
 * - Centralized MCP server management
 * - Tool discovery across servers
 * - Automatic tool routing
 * - Health checking
 * - Load balancing
 *
 * @example
 * ```typescript
 * import { createMCPGateway } from './mcp-gateway'
 *
 * const gateway = createMCPGateway({
 *   servers: [
 *     { url: 'http://localhost:8261/mcp', name: 'local' },
 *     { url: 'https://mcp.example.com/mcp', name: 'remote', authToken: '...' },
 *   ],
 * })
 *
 * await gateway.connect()
 *
 * // List all available tools
 * const tools = await gateway.listTools()
 *
 * // Call a tool
 * const result = await gateway.callTool('filesystem/read_file', { path: '/test.txt' })
 * ```
 */

export interface MCPServerConfig {
  url: string
  name: string
  /** Bearer token for authenticating requests to this server (preferred). */
  bearerToken?: string
  /**
   * @deprecated Use `bearerToken` instead. Kept for back-compat with existing
   * configs that pre-date the rename. If both are set, `bearerToken` wins.
   */
  authToken?: string
  enabled?: boolean
  timeout?: number
  headers?: Record<string, string>
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema: Record<string, any>
  serverName: string
  serverUrl: string
}

export interface MCPGatewayConfig {
  servers: MCPServerConfig[]
  defaultTimeout?: number
  healthCheckInterval?: number
  autoReconnect?: boolean
}

export interface GatewayConnectionResult {
  success: boolean
  connectedServers: string[]
  failedServers: Array<{ name: string; error: string }>
}

export interface GatewayToolCallResult {
  success: boolean
  result?: any
  error?: string
  serverName?: string
  duration?: number
}

export interface MCPGateway {
  /**
   * Connect to all configured MCP servers
   */
  connect(): Promise<GatewayConnectionResult>

  /**
   * Disconnect from all servers
   */
  disconnect(): Promise<void>

  /**
   * List all available tools from all servers
   */
  listTools(): Promise<MCPTool[]>

  /**
   * Get tools from a specific server
   */
  getServerTools(serverName: string): Promise<MCPTool[]>

  /**
   * Call a tool by name
   */
  callTool(toolName: string, args: Record<string, any>): Promise<GatewayToolCallResult>

  /**
   * Check server health
   */
  checkHealth(): Promise<HealthStatus[]>

  /**
   * Add a new server
   */
  addServer(config: MCPServerConfig): void

  /**
   * Remove a server
   */
  removeServer(serverName: string): boolean

  /**
   * Get connected server count
   */
  getConnectedCount(): number

  /**
   * Check if gateway is connected
   */
  isConnected(): boolean
}

interface HealthStatus {
  serverName: string
  healthy: boolean
  responseTime?: number
  error?: string
  toolCount?: number
}

interface ServerConnection {
  config: MCPServerConfig
  connected: boolean
  tools: MCPTool[]
  lastHealthCheck?: number
  healthStatus?: HealthStatus
}

class MCPGatewayImpl implements MCPGateway {
  private servers: Map<string, ServerConnection> = new Map()
  private config: Required<Omit<MCPGatewayConfig, 'servers'>>
  private connected: boolean = false
  private healthCheckTimer?: NodeJS.Timeout

  constructor(config: MCPGatewayConfig) {
    this.config = {
      defaultTimeout: config.defaultTimeout || 30000,
      healthCheckInterval: config.healthCheckInterval || 60000,
      autoReconnect: config.autoReconnect ?? true,
    }

    // Initialize servers
    for (const serverConfig of config.servers) {
      if (serverConfig.enabled !== false) {
        this.servers.set(serverConfig.name, {
          config: serverConfig,
          connected: false,
          tools: [],
        })
      }
    }
  }

  async connect(): Promise<GatewayConnectionResult> {
    const connectedServers: string[] = []
    const failedServers: Array<{ name: string; error: string }> = []

    for (const [name, connection] of this.servers) {
      try {
        await this.connectToServer(name)
        connectedServers.push(name)
      } catch (error: any) {
        failedServers.push({ name, error: error.message })
      }
    }

    this.connected = connectedServers.length > 0

    // Start health checks
    if (this.config.healthCheckInterval > 0) {
      this.startHealthChecks()
    }

    return {
      success: connectedServers.length > 0,
      connectedServers,
      failedServers,
    }
  }

  private async connectToServer(serverName: string): Promise<void> {
    const connection = this.servers.get(serverName)
    if (!connection) {
      throw new Error(`Server not found: ${serverName}`)
    }

    const timeout = connection.config.timeout || this.config.defaultTimeout

    try {
      // Fetch tools from MCP server using standard JSON-RPC HTTP transport
      // (http-transport.ts) instead of raw GET /tools which is non-standard.
      const tools = await this.fetchServerToolsViaJSONRPC(connection.config, timeout)
      connection.tools = tools
      connection.connected = true
      connection.lastHealthCheck = Date.now()
      connection.healthStatus = {
        serverName,
        healthy: true,
        toolCount: tools.length,
      }
    } catch (error: any) {
      connection.connected = false
      connection.healthStatus = {
        serverName,
        healthy: false,
        error: error.message,
      }
      throw error
    }
  }

  /**
   * Fetch tools from an MCP server using standard JSON-RPC over HTTP POST.
   *
   * Uses the same protocol as http-transport.ts (the proper MCP HTTP client):
   *   POST {url}  Content-Type: application/json
   *   {"jsonrpc":"2.0","id":...,"method":"tools/list","params":{}}
   *
   * This replaces the prior raw-GET-{"url}/tools` path which is non-standard
   * and incompatible with real MCP HTTP servers (causing the SSE connection
   * failures observed in 2026-07).
   *
   * @param config - Server connection config (url can include path suffix
   *   like "/mcp" for tunnel-based MCP access)
   * @param timeout - Per-request timeout in ms
   */
  private async fetchServerToolsViaJSONRPC(config: MCPServerConfig, timeout: number): Promise<MCPTool[]> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }

      const authToken = config.bearerToken ?? config.authToken
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`
      }
      if (config.headers) {
        Object.assign(headers, config.headers)
      }

      // Standard JSON-RPC request for tools/list
      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/list',
          params: {},
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      // Standard JSON-RPC response format: { jsonrpc, id, result: { tools: [...] } }
      if (data.error) {
        throw new Error(data.error.message || 'MCP JSON-RPC error')
      }

      const tools = data.result?.tools || []

      return tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        serverName: config.name,
        serverUrl: config.url,
      }))
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async disconnect(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = undefined
    }

    for (const connection of this.servers.values()) {
      connection.connected = false
      connection.tools = []
    }

    this.connected = false
  }

  async listTools(): Promise<MCPTool[]> {
    const allTools: MCPTool[] = []

    for (const connection of this.servers.values()) {
      if (connection.connected) {
        allTools.push(...connection.tools)
      }
    }

    return allTools
  }

  async getServerTools(serverName: string): Promise<MCPTool[]> {
    const connection = this.servers.get(serverName)
    if (!connection) {
      return []
    }
    return connection.tools
  }

  async callTool(toolName: string, args: Record<string, any>): Promise<GatewayToolCallResult> {
    const startTime = Date.now()

    // Find which server has this tool
    let targetServer: ServerConnection | undefined
    let targetTool: MCPTool | undefined

    for (const connection of this.servers.values()) {
      if (connection.connected) {
        const tool = connection.tools.find(t => t.name === toolName)
        if (tool) {
          targetServer = connection
          targetTool = tool
          break
        }
      }
    }

    if (!targetServer || !targetTool) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`,
      }
    }

    try {
      const timeout = targetServer.config.timeout || this.config.defaultTimeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        }

        const authToken = targetServer.config.bearerToken ?? targetServer.config.authToken
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`
        }

        // Standard JSON-RPC request for tools/call
        const response = await fetch(targetServer.config.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: args,
            },
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()

        if (data.error) {
          throw new Error(data.error.message || 'MCP JSON-RPC error')
        }

        // Defensive fallback: use data.result (standard MCP JSON-RPC), but
        // fall back to the full data object for servers that return results
        // at the top level (e.g. older non-standard implementations).
        const callResult = data.result ?? data;

        return {
          success: true,
          result: callResult,
          serverName: targetServer.config.name,
          duration: Date.now() - startTime,
        }
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        serverName: targetServer.config.name,
        duration: Date.now() - startTime,
      }
    }
  }

  async checkHealth(): Promise<HealthStatus[]> {
    const healthStatuses: HealthStatus[] = []

    for (const [name, connection] of this.servers) {
      try {
        const startTime = Date.now()

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000)

        try {
          const headers: HeadersInit = {
            'Content-Type': 'application/json',
          }

          // Prefer canonical `bearerToken`; fall back to the legacy `authToken`
          // alias for back-compat with existing server configs (deprecated).
          const authToken = connection.config.bearerToken ?? connection.config.authToken
          if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`
          }

          const response = await fetch(`${connection.config.url}/ping`, {
            method: 'GET',
            headers,
            signal: controller.signal,
          })

          const responseTime = Date.now() - startTime

          connection.healthStatus = {
            serverName: name,
            healthy: response.ok,
            responseTime,
            toolCount: connection.tools.length,
          }
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error: any) {
        connection.healthStatus = {
          serverName: name,
          healthy: false,
          error: error.message,
          toolCount: connection.tools.length,
        }
      }

      if (connection.healthStatus) {
        healthStatuses.push(connection.healthStatus)
      }
    }

    return healthStatuses
  }

  private startHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.checkHealth()

      // Auto-reconnect to failed servers
      if (this.config.autoReconnect) {
        for (const [name, connection] of this.servers) {
          if (!connection.connected) {
            try {
              await this.connectToServer(name)
            } catch {
              // Will retry on next health check
            }
          }
        }
      }
    }, this.config.healthCheckInterval)
  }

  addServer(config: MCPServerConfig): void {
    if (config.enabled !== false) {
      this.servers.set(config.name, {
        config,
        connected: false,
        tools: [],
      })
    }
  }

  removeServer(serverName: string): boolean {
    return this.servers.delete(serverName)
  }

  getConnectedCount(): number {
    let count = 0
    for (const connection of this.servers.values()) {
      if (connection.connected) count++
    }
    return count
  }

  isConnected(): boolean {
    return this.connected
  }
}

/**
 * Create MCP Gateway instance
 */
export function createMCPGateway(config: MCPGatewayConfig): MCPGateway {
  return new MCPGatewayImpl(config)
}

/**
 * Create MCP Gateway from environment configuration
 */
export function createGatewayFromEnv(): MCPGateway {
  const servers: MCPServerConfig[] = []

  // Parse MCP_SERVERS env var (comma-separated list of server configs)
  // Format: name1|url1|token1,name2|url2|token2
  const serversEnv = process.env.MCP_SERVERS || ''
  
  if (serversEnv) {
    const serverEntries = serversEnv.split(',').filter(s => s.trim())

    for (const entry of serverEntries) {
      const [name, url, authToken] = entry.split('|')
      if (name && url) {
        servers.push({
          name: name.trim(),
          url: url.trim(),
          // MCP_SERVERS env pipe-format uses the legacy `authToken` slot;
          // map it onto the canonical `bearerToken` field.
          bearerToken: authToken?.trim(),
          enabled: true,
        })
      }
    }
  }

  // Add default local MCP gateway if configured via env var
  if (process.env.MCP_GATEWAY_ENABLED === 'true' && process.env.MCP_GATEWAY_URL) {
    servers.push({
      name: 'gateway',
      url: process.env.MCP_GATEWAY_URL,
      // MCP_GATEWAY_AUTH_TOKEN is the legacy env var; map it onto the
      // canonical `bearerToken` field. New deployments should set
      // MCP_GATEWAY_BEARER_TOKEN instead.
      bearerToken: process.env.MCP_GATEWAY_BEARER_TOKEN ?? process.env.MCP_GATEWAY_AUTH_TOKEN,
      timeout: parseInt(process.env.MCP_GATEWAY_TIMEOUT_MS || '15000', 10),
      enabled: true,
    })
  }

  // Fallback: if no servers were configured via env vars AND no gateway
  // was explicitly configured, try defaults that work in common setups:
  //   1. Local MCP server on port 8261 (default blaxel-mcp port)
  //   2. CF tunnel /mcp path (if the MCP server is accessible via the
  //      same Cloudflare tunnel as BACKEND_URL, add a /mcp path to the
  //      Caddyfile — see bing/Caddyfile for reference)
  //
  // These defaults only activate when NO servers were explicitly
  // configured, so explicit env config always takes precedence.
  if (servers.length === 0) {
    const localUrl = process.env.MCP_LOCAL_URL || 'http://localhost:8261/mcp';
    const tunnelUrl = process.env.MCP_TUNNEL_URL || (process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/mcp` : '');

    // Try local first (fastest, no network overhead)
    servers.push({
      name: 'local',
      url: localUrl,
      enabled: true,
      timeout: 5000,
    });

    // Also add tunnel URL if available (fallback if local is unreachable)
    if (tunnelUrl) {
      servers.push({
        name: 'tunnel',
        url: tunnelUrl,
        enabled: true,
        timeout: 15000,
      });
    }
  }

  return createMCPGateway({
    servers,
    defaultTimeout: parseInt(process.env.MCP_DEFAULT_TIMEOUT_MS || '30000', 10),
    healthCheckInterval: parseInt(process.env.MCP_HEALTH_CHECK_INTERVAL_MS || '60000', 10),
    autoReconnect: process.env.MCP_AUTO_RECONNECT !== 'false',
  })
}

/**
 * Call MCP tool via API route helper
 */
export async function callMCPTool(
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    const gateway = createGatewayFromEnv()
    const result = await gateway.connect()

    if (!result.success) {
      return {
        success: false,
        error: `No MCP servers available. Connected: ${result.connectedServers.join(', ')}. Failed: ${result.failedServers.map(s => `${s.name}: ${s.error}`).join(', ')}`,
      }
    }

    const callResult = await gateway.callTool(toolName, args)
    return callResult
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * List all available MCP tools
 */
export async function listMCPTools(): Promise<{ success: boolean; tools?: MCPTool[]; error?: string }> {
  try {
    const gateway = createGatewayFromEnv()
    const result = await gateway.connect()

    if (!result.success) {
      return {
        success: false,
        error: `No MCP servers available`,
      }
    }

    const tools = await gateway.listTools()
    return { success: true, tools }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    }
  }
}
