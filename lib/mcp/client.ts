/**
 * MCP Client
 * 
 * Handles connections to MCP servers via various transports (stdio, SSE, websocket)
 * Implements the Model Context Protocol for tool, resource, and prompt access
 */

import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type {
  MCPTransportConfig,
  MCPConnectionState,
  MCPConnectionInfo,
  MCPServerInfo,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPToolResult,
  MCPListToolsResponse,
  MCPListResourcesResponse,
  MCPListPromptsResponse,
  MCPGetPromptRequest,
  MCPGetPromptResponse,
  MCPReadResourceRequest,
  MCPReadResourceResponse,
  MCPCallToolRequest,
  MCPEvent,
  MCPEventListener,
  MCPProgress,
  MCPLogMessage,
} from './types'
import { MCP_PROTOCOL_VERSION } from './types'

interface MCPRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: any
}

interface MCPResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

interface MCPNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}

/**
 * MCP Client class for connecting to and interacting with MCP servers
 */
export class MCPClient extends EventEmitter {
  private config: MCPTransportConfig
  private connectionInfo: MCPConnectionInfo
  private requestId: number = 0
  private pendingRequests: Map<number | string, {
    resolve: (result: any) => void
    reject: (error: Error) => void
    timeout?: NodeJS.Timeout
  }> = new Map()
  
  private process?: ChildProcess
  private messageBuffer: string = ''
  private eventListeners: Map<string, Set<MCPEventListener>> = new Map()
  
  // Cached server data
  private serverInfo: MCPServerInfo | null = null
  private cachedTools: MCPTool[] = []
  private cachedResources: MCPResource[] = []
  private cachedPrompts: MCPPrompt[] = []

  constructor(config: MCPTransportConfig) {
    super()
    this.config = config
    this.connectionInfo = {
      state: 'disconnected',
      server: null,
    }
  }

  /**
   * Get current connection info
   */
  getConnectionInfo(): MCPConnectionInfo {
    return { ...this.connectionInfo }
  }

  /**
   * Get server info if connected
   */
  getServerInfo(): MCPServerInfo | null {
    return this.serverInfo
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connectionInfo.state === 'connected'
  }

  /**
   * Connect to MCP server
   */
  async connect(timeout: number = 30000): Promise<void> {
    if (this.isConnected()) {
      return
    }

    this.updateState('connecting')

    try {
      if (this.config.type === 'stdio') {
        await this.connectStdio()
      } else if (this.config.type === 'sse') {
        await this.connectSSE(timeout)
      } else if (this.config.type === 'websocket') {
        await this.connectWebSocket(timeout)
      } else {
        throw new Error(`Unsupported transport type: ${this.config.type}`)
      }

      // Initialize connection
      await this.initialize(timeout)
      
      this.updateState('connected')
      this.emitEvent({ type: 'connected', timestamp: new Date() })
    } catch (error: any) {
      this.updateState('error', error.message)
      this.emitEvent({ 
        type: 'error', 
        data: { message: error.message },
        timestamp: new Date()
      })
      throw error
    }
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected()) {
      return
    }

    try {
      // Send shutdown notification
      await this.notify('notifications/initialized')
      
      // Close process if stdio
      if (this.process) {
        this.process.kill()
        this.process = undefined
      }
      
      // Clear pending requests
      for (const [id, request] of this.pendingRequests.entries()) {
        if (request.timeout) {
          clearTimeout(request.timeout)
        }
        request.reject(new Error('Connection closed'))
      }
      this.pendingRequests.clear()
    } catch (error) {
      console.error('[MCPClient] Disconnect error:', error)
    } finally {
      this.updateState('disconnected')
      this.emitEvent({ type: 'disconnected', timestamp: new Date() })
    }
  }

  /**
   * List available tools
   */
  async listTools(): Promise<MCPTool[]> {
    await this.ensureConnected()
    
    const response: MCPListToolsResponse = await this.request('tools/list', {})
    this.cachedTools = response.tools
    return response.tools
  }

  /**
   * Call a tool
   */
  async callTool(request: MCPCallToolRequest, timeout?: number): Promise<MCPToolResult> {
    await this.ensureConnected()
    
    const response = await this.request('tools/call', {
      name: request.name,
      arguments: request.arguments,
    }, timeout)
    
    return {
      toolCallId: request.name,
      content: response.content || [],
      isError: response.isError,
    }
  }

  /**
   * List available resources
   */
  async listResources(): Promise<MCPResource[]> {
    await this.ensureConnected()
    
    const response: MCPListResourcesResponse = await this.request('resources/list', {})
    this.cachedResources = response.resources
    return response.resources
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<MCPReadResourceResponse> {
    await this.ensureConnected()
    
    const response = await this.request('resources/read', { uri })
    return response
  }

  /**
   * List available prompts
   */
  async listPrompts(): Promise<MCPPrompt[]> {
    await this.ensureConnected()
    
    const response: MCPListPromptsResponse = await this.request('prompts/list', {})
    this.cachedPrompts = response.prompts
    return response.prompts
  }

  /**
   * Get a prompt
   */
  async getPrompt(request: MCPGetPromptRequest): Promise<MCPGetPromptResponse> {
    await this.ensureConnected()
    
    return await this.request('prompts/get', {
      name: request.name,
      arguments: request.arguments,
    })
  }

  /**
   * Subscribe to resource updates
   */
  async subscribeResource(uri: string): Promise<void> {
    await this.ensureConnected()
    await this.notify('resources/subscribe', { uri })
  }

  /**
   * Unsubscribe from resource updates
   */
  async unsubscribeResource(uri: string): Promise<void> {
    await this.ensureConnected()
    await this.notify('resources/unsubscribe', { uri })
  }

  /**
   * Send progress notification
   */
  async sendProgress(progressToken: string | number, progress: MCPProgress): Promise<void> {
    await this.notify('notifications/progress', {
      progressToken,
      ...progress,
    })
  }

  /**
   * Send log message
   */
  async sendLog(message: MCPLogMessage): Promise<void> {
    await this.notify('notifications/message', message)
  }

  /**
   * Add event listener
   */
  onEvent(type: MCPEventType, listener: MCPEventListener): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set())
    }
    this.eventListeners.get(type)!.add(listener)
  }

  /**
   * Remove event listener
   */
  offEvent(type: MCPEventType, listener: MCPEventListener): void {
    const listeners = this.eventListeners.get(type)
    if (listeners) {
      listeners.delete(listener)
    }
  }

  /**
   * Get cached tools
   */
  getCachedTools(): MCPTool[] {
    return [...this.cachedTools]
  }

  /**
   * Get cached resources
   */
  getCachedResources(): MCPResource[] {
    return [...this.cachedResources]
  }

  /**
   * Get cached prompts
   */
  getCachedPrompts(): MCPPrompt[] {
    return [...this.cachedPrompts]
  }

  // ==================== Private Methods ====================

  private async connectStdio(): Promise<void> {
    if (!this.config.command) {
      throw new Error('stdio transport requires command')
    }

    return new Promise((resolve, reject) => {
      this.process = spawn(this.config.command, this.config.args || [], {
        env: { ...process.env, ...this.config.env },
        cwd: this.config.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleMessage(data.toString())
      })

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error('[MCPClient] stderr:', data.toString())
      })

      this.process.on('error', (error) => {
        reject(new Error(`Failed to start process: ${error.message}`))
      })

      this.process.on('close', (code) => {
        if (this.isConnected()) {
          this.updateState('disconnected')
          this.emitEvent({ 
            type: 'disconnected', 
            data: { code },
            timestamp: new Date()
          })
        }
      })

      // Give process time to start
      setTimeout(resolve, 100)
    })
  }

  private async connectSSE(timeout: number): Promise<void> {
    if (!this.config.url) {
      throw new Error('SSE transport requires url')
    }

    // SSE connection would be implemented here
    // This is a placeholder for the full implementation
    throw new Error('SSE transport not yet fully implemented')
  }

  private async connectWebSocket(timeout: number): Promise<void> {
    if (!this.config.wsUrl) {
      throw new Error('WebSocket transport requires wsUrl')
    }

    // WebSocket connection would be implemented here
    // This is a placeholder for the full implementation
    throw new Error('WebSocket transport not yet fully implemented')
  }

  private async initialize(timeout: number): Promise<void> {
    const response = await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'binG MCP Client',
        version: '1.0.0',
      },
    }, timeout)

    this.serverInfo = {
      name: response.serverInfo?.name || 'Unknown',
      version: response.serverInfo?.version || '1.0.0',
      protocolVersion: response.protocolVersion || MCP_PROTOCOL_VERSION,
      capabilities: response.capabilities || {},
    }

    // Send initialized notification
    await this.notify('notifications/initialized', {})
  }

  private async request(
    method: string,
    params?: any,
    timeout: number = 30000
  ): Promise<any> {
    const id = ++this.requestId
    
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, timeout)

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout: timeoutId,
      })

      this.sendRequest(request)
    })
  }

  private async notify(method: string, params?: any): Promise<void> {
    const notification: MCPNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }
    this.sendNotification(notification)
  }

  private sendRequest(request: MCPRequest): void {
    if (!this.process?.stdin) {
      throw new Error('Not connected')
    }
    
    const message = JSON.stringify(request) + '\n'
    this.process.stdin.write(message)
  }

  private sendNotification(notification: MCPNotification): void {
    if (!this.process?.stdin) {
      throw new Error('Not connected')
    }
    
    const message = JSON.stringify(notification) + '\n'
    this.process.stdin.write(message)
  }

  private handleMessage(data: string): void {
    this.messageBuffer += data
    
    const lines = this.messageBuffer.split('\n')
    this.messageBuffer = lines.pop() || ''
    
    for (const line of lines) {
      if (!line.trim()) continue
      
      try {
        const message: MCPResponse | MCPNotification = JSON.parse(line)
        
        if ('id' in message) {
          // Response
          this.handleResponse(message as MCPResponse)
        } else if ('method' in message) {
          // Notification
          this.handleNotification(message as MCPNotification)
        }
      } catch (error) {
        console.error('[MCPClient] Failed to parse message:', error)
      }
    }
  }

  private handleResponse(response: MCPResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      console.warn('[MCPClient] Received response for unknown request:', response.id)
      return
    }

    if (pending.timeout) {
      clearTimeout(pending.timeout)
    }
    this.pendingRequests.delete(response.id)

    if (response.error) {
      pending.reject(new Error(response.error.message))
    } else {
      pending.resolve(response.result)
    }
  }

  private handleNotification(notification: MCPNotification): void {
    // Handle server-initiated notifications
    switch (notification.method) {
      case 'notifications/resources/list_changed':
        this.emitEvent({ type: 'resource_registered', timestamp: new Date() })
        break
      case 'notifications/tools/list_changed':
        this.emitEvent({ type: 'tool_registered', timestamp: new Date() })
        break
      case 'notifications/prompts/list_changed':
        this.emitEvent({ type: 'prompt_registered', timestamp: new Date() })
        break
      case 'notifications/progress':
        this.emitEvent({ 
          type: 'progress', 
          data: notification.params,
          timestamp: new Date()
        })
        break
      case 'notifications/message':
        this.emitEvent({ 
          type: 'log', 
          data: notification.params,
          timestamp: new Date()
        })
        break
    }
  }

  private updateState(state: MCPConnectionState, error?: string): void {
    this.connectionInfo = {
      ...this.connectionInfo,
      state,
      error,
      lastError: error ? new Date() : this.connectionInfo.lastError,
      connectedAt: state === 'connected' ? new Date() : this.connectionInfo.connectedAt,
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected()) {
      await this.connect()
    }
  }

  private emitEvent(event: MCPEvent): void {
    const listeners = this.eventListeners.get(event.type)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event)
        } catch (error) {
          console.error('[MCPClient] Event listener error:', error)
        }
      }
    }
    
    // Also emit via EventEmitter
    this.emit('event', event)
  }
}
