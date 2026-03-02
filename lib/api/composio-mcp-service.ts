/**
 * Composio MCP Integration
 *
 * Provides Model Context Protocol (MCP) integration for Composio tools.
 * Allows any MCP-compatible client to access 800+ Composio tools.
 *
 * Features:
 * - MCP server for Composio tools
 * - Session-based tool discovery
 * - Dynamic tool registration
 * - OAuth authentication handling
 * - Tool execution with context management
 *
 * @see https://docs.composio.dev/
 * @see https://modelcontextprotocol.io/
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { z } from 'zod'

export interface ComposioMCPConfig {
  apiKey: string
  serverName?: string
  serverVersion?: string
  port?: number
}

export interface ComposioMCPSession {
  id: string
  userId: string
  tools: any[]
  mcp: {
    url: string
    headers: Record<string, string>
  }
}

/**
 * Composio MCP Server
 */
export class ComposioMCPServer {
  private server: Server
  private config: ComposioMCPConfig
  private sessions: Map<string, ComposioMCPSession> = new Map()
  private composioClient?: any

  constructor(config: ComposioMCPConfig) {
    this.config = {
      serverName: 'composio-tools',
      serverVersion: '1.0.0',
      port: 3001,
      ...config,
    }

    this.server = new Server({
      name: this.config.serverName!,
      version: this.config.serverVersion!,
      capabilities: {
        tools: {},
      },
    })
  }

  /**
   * Initialize Composio client
   */
  private async ensureComposioClient(): Promise<void> {
    if (this.composioClient) return

    try {
      const { Composio } = await import('@composio/core')
      this.composioClient = new Composio({
        apiKey: this.config.apiKey,
      })
    } catch (error: any) {
      throw new Error(
        `Composio SDK not available. Install with: pnpm add @composio/core. Error: ${error.message}`
      )
    }
  }

  /**
   * Create a new MCP session for a user
   */
  async createSession(userId: string): Promise<ComposioMCPSession> {
    await this.ensureComposioClient()

    // Create Composio session
    const session = await this.composioClient.create(userId)
    const tools = await session.tools()

    // Get MCP config from session
    const mcpConfig = {
      url: session.mcp?.url || `http://localhost:${this.config.port}/mcp`,
      headers: session.mcp?.headers || {},
    }

    const composioSession: ComposioMCPSession = {
      id: session.id || session.sessionId,
      userId,
      tools,
      mcp: mcpConfig,
    }

    this.sessions.set(userId, composioSession)

    // Register tools with MCP server
    await this.registerTools(tools)

    return composioSession
  }

  /**
   * Get session for a user
   */
  getSession(userId: string): ComposioMCPSession | undefined {
    return this.sessions.get(userId)
  }

  /**
   * Register Composio tools with MCP server
   */
  private async registerTools(tools: any[]): Promise<void> {
    for (const tool of tools) {
      const toolName = tool.slug || tool.name || tool.toolSlug
      const toolDescription = tool.description || `Tool ${toolName}`

      // Build parameter schema from tool input parameters
      const paramsSchema: Record<string, z.ZodType> = {}
      const inputParams = tool.inputParameters || tool.input_parameters || tool.parameters || {}
      const properties = inputParams.properties || {}

      for (const [paramName, paramDef] of Object.entries(properties)) {
        let zodType: z.ZodType = z.string()
        const pd = paramDef as any

        if (pd.type === 'number' || pd.type === 'integer') {
          zodType = z.number()
        } else if (pd.type === 'boolean') {
          zodType = z.boolean()
        } else if (pd.type === 'object') {
          zodType = z.record(z.string(), z.any())
        } else if (pd.type === 'array') {
          zodType = z.array(z.string())
        }

        // Make optional if not in required list
        if (!inputParams.required?.includes(paramName)) {
          zodType = zodType.optional()
        }

        paramsSchema[paramName] = zodType
      }

      // Register tool with MCP server
      this.server.tool(
        toolName,
        toolDescription,
        paramsSchema,
        async (params: Record<string, any>) => {
          try {
            // Execute tool via Composio
            const result = await this.composioClient.execute(toolName, params)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          } catch (error: any) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error executing ${toolName}: ${error.message}`,
                },
              ],
              isError: true,
            }
          }
        }
      )
    }
  }

  /**
   * Start MCP server
   */
  async start(): Promise<void> {
    // Start HTTP transport
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    )

    const transport = new StreamableHTTPServerTransport()

    await this.server.connect(transport)

    console.log(
      `[ComposioMCP] Server started on http://localhost:${this.config.port}/mcp`
    )
  }

  /**
   * Stop MCP server
   */
  async stop(): Promise<void> {
    await this.server.close()
    console.log('[ComposioMCP] Server stopped')
  }

  /**
   * Get MCP server info
   */
  getServerInfo(): {
    name: string
    version: string
    port: number
    sessions: number
  } {
    return {
      name: this.config.serverName!,
      version: this.config.serverVersion!,
      port: this.config.port!,
      sessions: this.sessions.size,
    }
  }
}

/**
 * Create and start Composio MCP server
 */
export async function createComposioMCPServer(
  config: ComposioMCPConfig
): Promise<ComposioMCPServer> {
  const server = new ComposioMCPServer(config)
  await server.start()
  return server
}

/**
 * Get Composio MCP session metadata for a user
 */
export async function getComposioMCPSession(
  userId: string,
  apiKey: string
): Promise<{
  url: string
  headers: Record<string, string>
  tools: any[]
} | null> {
  try {
    const { Composio } = await import('@composio/core')
    const composio = new Composio({ apiKey })

    const session = await composio.create(userId)
    const tools = await session.tools()

    return {
      url: session.mcp?.url || 'http://localhost:3001/mcp',
      headers: session.mcp?.headers || {},
      tools,
    }
  } catch (error: any) {
    console.error('[ComposioMCP] Failed to get session:', error)
    return null
  }
}
