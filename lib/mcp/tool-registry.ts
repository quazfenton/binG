/**
 * MCP Tool Registry and Handler
 * 
 * Manages MCP tools from connected servers and provides integration
 * with the AI chat system for tool calling
 */

import { MCPClient } from './client'
import type {
  MCPTool,
  MCPToolResult,
  MCPServerConfig,
  MCPConnectionInfo,
  MCPEvent,
} from './types'

/**
 * Tool wrapper with server reference
 */
export interface MCPToolWrapper {
  tool: MCPTool
  serverId: string
  serverName: string
  enabled: boolean
}

/**
 * Tool call result
 */
export interface MCPToolCallResult {
  success: boolean
  toolName: string
  serverId: string
  content: string
  isError?: boolean
  duration?: number
}

/**
 * MCP Tool Registry
 * 
 * Manages tools from multiple MCP servers
 */
export class MCPToolRegistry {
  private clients: Map<string, MCPClient> = new Map()
  private serverConfigs: Map<string, MCPServerConfig> = new Map()
  private tools: Map<string, MCPToolWrapper> = new Map()
  private eventListeners: Set<(event: MCPRegistryEvent) => void> = new Set()

  /**
   * Register a server configuration
   */
  registerServer(config: MCPServerConfig): void {
    if (config.enabled === false) {
      return
    }

    this.serverConfigs.set(config.id, config)
    
    const client = new MCPClient(config.transport)
    this.clients.set(config.id, client)

    // Set up event listeners
    client.on('event', (event: MCPEvent) => {
      this.handleServerEvent(config.id, event)
    })

    this.emitEvent({
      type: 'server_registered',
      serverId: config.id,
      serverName: config.name,
      timestamp: new Date(),
    })
  }

  /**
   * Unregister a server
   */
  async unregisterServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client) {
      await client.disconnect()
      this.clients.delete(serverId)
      
      // Remove tools from this server
      for (const [key, wrapper] of this.tools.entries()) {
        if (wrapper.serverId === serverId) {
          this.tools.delete(key)
        }
      }
    }
    
    this.serverConfigs.delete(serverId)
    
    this.emitEvent({
      type: 'server_unregistered',
      serverId,
      timestamp: new Date(),
    })
  }

  /**
   * Connect to all registered servers
   */
  async connectAll(timeout: number = 30000): Promise<void> {
    const connections = Array.from(this.clients.entries()).map(async ([id, client]) => {
      try {
        await client.connect(timeout)
        
        // Load tools from server
        const tools = await client.listTools()
        for (const tool of tools) {
          const config = this.serverConfigs.get(id)
          if (config) {
            this.tools.set(`${id}:${tool.name}`, {
              tool,
              serverId: id,
              serverName: config.name,
              enabled: true,
            })
          }
        }
        
        this.emitEvent({
          type: 'server_connected',
          serverId: id,
          timestamp: new Date(),
        })
      } catch (error: any) {
        console.error(`[MCPRegistry] Failed to connect to server ${id}:`, error.message)
        this.emitEvent({
          type: 'server_error',
          serverId: id,
          error: error.message,
          timestamp: new Date(),
        })
      }
    })

    await Promise.all(connections)
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const disconnections = Array.from(this.clients.values()).map(client => 
      client.disconnect().catch(console.error)
    )
    await Promise.all(disconnections)
    
    this.emitEvent({
      type: 'all_disconnected',
      timestamp: new Date(),
    })
  }

  /**
   * Get all available tools
   */
  getAllTools(): MCPToolWrapper[] {
    return Array.from(this.tools.values()).filter(t => t.enabled)
  }

  /**
   * Get tools as AI SDK compatible format
   */
  getToolDefinitions(): Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: any
    }
  }> {
    return this.getAllTools().map(wrapper => ({
      type: 'function' as const,
      function: {
        name: this.getQualifiedToolName(wrapper),
        description: wrapper.tool.description,
        parameters: wrapper.tool.inputSchema,
      },
    }))
  }

  /**
   * Call a tool by qualified name
   */
  async callTool(
    qualifiedName: string,
    args: Record<string, any>,
    timeout?: number
  ): Promise<MCPToolCallResult> {
    const startTime = Date.now()
    const [serverId, toolName] = this.parseQualifiedToolName(qualifiedName)
    
    const wrapper = this.tools.get(qualifiedName)
    if (!wrapper) {
      return {
        success: false,
        toolName: qualifiedName,
        serverId,
        content: `Tool not found: ${qualifiedName}`,
        isError: true,
      }
    }

    const client = this.clients.get(serverId)
    if (!client) {
      return {
        success: false,
        toolName: qualifiedName,
        serverId,
        content: `Server not found: ${serverId}`,
        isError: true,
      }
    }

    try {
      const result: MCPToolResult = await client.callTool({
        name: toolName,
        arguments: args,
      }, timeout)

      const duration = Date.now() - startTime
      
      // Convert result content to string
      const content = result.content
        .map(c => {
          if (c.type === 'text') return c.text
          if (c.type === 'image') return `[Image: ${c.mimeType}]`
          if (c.type === 'resource') return `[Resource: ${c.resource.uri}]`
          return JSON.stringify(c)
        })
        .join('\n')

      return {
        success: !result.isError,
        toolName: qualifiedName,
        serverId,
        content,
        isError: result.isError,
        duration,
      }
    } catch (error: any) {
      const duration = Date.now() - startTime
      
      return {
        success: false,
        toolName: qualifiedName,
        serverId,
        content: error.message || 'Tool call failed',
        isError: true,
        duration,
      }
    }
  }

  /**
   * Get server connection info
   */
  getServerInfo(serverId: string): MCPConnectionInfo | null {
    const client = this.clients.get(serverId)
    if (!client) return null
    return client.getConnectionInfo()
  }

  /**
   * Get all server statuses
   */
  getAllServerStatuses(): Array<{
    id: string
    name: string
    info: MCPConnectionInfo
  }> {
    return Array.from(this.clients.entries()).map(([id, client]) => {
      const config = this.serverConfigs.get(id)
      return {
        id,
        name: config?.name || id,
        info: client.getConnectionInfo(),
      }
    })
  }

  /**
   * Enable/disable a tool
   */
  setToolEnabled(qualifiedName: string, enabled: boolean): void {
    const wrapper = this.tools.get(qualifiedName)
    if (wrapper) {
      wrapper.enabled = enabled
      this.emitEvent({
        type: 'tool_toggled',
        toolName: qualifiedName,
        enabled,
        timestamp: new Date(),
      })
    }
  }

  /**
   * Add event listener
   */
  onEvent(listener: (event: MCPRegistryEvent) => void): void {
    this.eventListeners.add(listener)
  }

  /**
   * Remove event listener
   */
  offEvent(listener: (event: MCPRegistryEvent) => void): void {
    this.eventListeners.delete(listener)
  }

  // ==================== Private Methods ====================

  private getQualifiedToolName(wrapper: MCPToolWrapper): string {
    return `${wrapper.serverId}:${wrapper.tool.name}`
  }

  private parseQualifiedToolName(qualifiedName: string): [string, string] {
    const parts = qualifiedName.split(':')
    if (parts.length !== 2) {
      throw new Error(`Invalid qualified tool name: ${qualifiedName}`)
    }
    return [parts[0], parts[1]]
  }

  private handleServerEvent(serverId: string, event: MCPEvent): void {
    const config = this.serverConfigs.get(serverId)
    
    this.emitEvent({
      type: 'server_event',
      serverId,
      serverName: config?.name,
      event,
      timestamp: new Date(),
    })

    // Handle tool changes
    if (event.type === 'tool_registered' || event.type === 'tool_unregistered') {
      this.refreshServerTools(serverId)
    }
  }

  private async refreshServerTools(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    const config = this.serverConfigs.get(serverId)
    
    if (!client || !config) return

    try {
      const tools = await client.listTools()
      
      // Remove old tools from this server
      for (const [key, wrapper] of this.tools.entries()) {
        if (wrapper.serverId === serverId) {
          this.tools.delete(key)
        }
      }
      
      // Add new tools
      for (const tool of tools) {
        this.tools.set(`${serverId}:${tool.name}`, {
          tool,
          serverId,
          serverName: config.name,
          enabled: true,
        })
      }
      
      this.emitEvent({
        type: 'tools_refreshed',
        serverId,
        toolCount: tools.length,
        timestamp: new Date(),
      })
    } catch (error: any) {
      console.error(`[MCPRegistry] Failed to refresh tools for ${serverId}:`, error.message)
    }
  }

  private emitEvent(event: MCPRegistryEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('[MCPRegistry] Event listener error:', error)
      }
    }
  }
}

/**
 * MCP Registry Event types
 */
export type MCPRegistryEventType =
  | 'server_registered'
  | 'server_unregistered'
  | 'server_connected'
  | 'server_disconnected'
  | 'server_error'
  | 'all_disconnected'
  | 'tool_toggled'
  | 'tools_refreshed'
  | 'server_event'

/**
 * MCP Registry Event
 */
export interface MCPRegistryEvent {
  type: MCPRegistryEventType
  serverId?: string
  serverName?: string
  toolName?: string
  enabled?: boolean
  toolCount?: number
  event?: MCPEvent
  error?: string
  timestamp: Date
}

/**
 * Singleton instance
 */
export const mcpToolRegistry = new MCPToolRegistry()
