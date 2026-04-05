/**
 * MCP Client
 * 
 * Handles connections to MCP servers via various transports (stdio, SSE, websocket)
 * Implements the Model Context Protocol for tool, resource, and prompt access
 */

import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import * as MCPTypes from './types'
import { createNDJSONParser, type NDJSONParser } from '@/lib/utils/ndjson-parser';

const {
  MCP_PROTOCOL_VERSION,
  MCPConnectionError,
  MCPTimeoutError,
  MCPProtocolError,
  MCPResourceError,
  MCPServerError,
  MCPToolError,
} = MCPTypes

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
  MCPEventType,
} from './types'

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
  private ndjsonParser?: NDJSONParser
  private eventListeners: Map<string, Set<MCPEventListener>> = new Map()

  // Cached server data
  private serverInfo: MCPServerInfo | null = null
  private cachedTools: MCPTool[] = []
  private cachedResources: MCPResource[] = []
  private cachedPrompts: MCPPrompt[] = []

  // Resource subscription tracking
  private subscribedResources: Set<string> = new Set()

  constructor(config: MCPTransportConfig) {
    super()
    this.config = config
    this.connectionInfo = {
      state: 'disconnected',
      server: null,
    }
  }

  /**
   * Get currently subscribed resources
   */
  getSubscribedResources(): string[] {
    return Array.from(this.subscribedResources);
  }

  /**
   * Check if subscribed to a resource
   */
  isSubscribedToResource(uri: string): boolean {
    return this.subscribedResources.has(uri);
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
    try {
      // Finalize NDJSON parser to process any remaining buffered data
      if (this.ndjsonParser) {
        const remaining = this.ndjsonParser.finalize();
        // Process any remaining messages
        for (const message of remaining) {
          try {
            if ('id' in message) {
              this.handleResponse(message as MCPResponse);
            } else if ('method' in message) {
              this.handleNotification(message as MCPNotification);
            }
          } catch (error) {
            console.error('[MCPClient] Error processing final message:', error);
          }
        }
        this.ndjsonParser = undefined;
      }

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
   * Subscribe to a resource URI for updates
   */
  async subscribeResource(uri: string): Promise<void> {
    await this.ensureConnected()
    await this.request('resources/subscribe', { uri });
    this.subscribedResources.add(uri);
  }

  /**
   * Unsubscribe from a resource URI
   */
  async unsubscribeResource(uri: string): Promise<void> {
    await this.ensureConnected()
    await this.request('resources/unsubscribe', { uri });
    this.subscribedResources.delete(uri);
  }

  /**
   * Send progress notification for long-running operations
   */
  async sendProgress(token: string, progress: number, total: number = 100): Promise<void> {
    if (progress < 0 || progress > total) {
      throw new MCPProtocolError(`Progress must be between 0 and ${total}, got ${progress}`);
    }

    await this.notify('notifications/progress', {
      progressToken: token,
      progress,
      total,
    })
  }

  /**
   * Set logging level for server
   */
  async setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): Promise<void> {
    await this.notify('logging/setLevel', { level })
  }

  /**
   * Cancel a pending request
   */
  async cancelRequest(requestId: string): Promise<void> {
    await this.notify('notifications/cancelled', {
      requestId,
      reason: 'User cancelled',
    })
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
   * Connect to MCP server with OAuth support
   */
  async connectWithOAuth(options: {
    callbackUrl: string;
    clientMetadata?: any;
    onRedirect: (url: string) => void;
  }): Promise<void> {
    if (this.isConnected()) return;

    this.updateState('connecting');

    try {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const { UnauthorizedError } = await import('@modelcontextprotocol/sdk/client/auth.js');

      const clientMetadata = options.clientMetadata || {
        client_name: 'binG MCP Client',
        redirect_uris: [options.callbackUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'mcp:tools mcp:resources',
      };

      const oauthProvider: any = {
        redirectUrl: options.callbackUrl,
        clientMetadata,
        redirectToAuthorization: (url: URL) => options.onRedirect(url.toString()),
        saveCodeVerifier: (v: string) => { (this as any)._codeVerifier = v; },
        codeVerifier: () => (this as any)._codeVerifier,
      };

      const transport = new StreamableHTTPClientTransport(new URL(this.config.url!), {
        authProvider: oauthProvider,
      });

      const client = new Client(
        { name: 'bing-client', version: '1.0.0' },
        {
          capabilities: {
            experimental: {},
            sampling: {},
            elicitation: {},
            roots: {},
            tasks: {},
          } as any,
        }
      );

      try {
        await client.connect(transport);
        this.updateState('connected');
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          console.log('[MCPClient] OAuth redirection initiated');
        } else {
          throw error;
        }
      }

    } catch (error: any) {
      this.updateState('error', error.message);
      throw error;
    }
  }

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
        reject(new MCPConnectionError(`Failed to start process: ${error.message}`))
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

      const spawnTimeout = setTimeout(() => {
        this.process?.removeAllListeners('spawn')
        resolve()
      }, 100)

      this.process.on('spawn', () => {
        clearTimeout(spawnTimeout)
        resolve()
      })
    })
  }

  private async connectSSE(timeout: number): Promise<void> {
    if (!this.config.url) {
      throw new Error('SSE transport requires url')
    }

    return new Promise((resolve, reject) => {
      try {
        const url = new URL(this.config.url!);
        const eventSource = new EventSource(url.toString());

        eventSource.onopen = () => {
          console.log(`[MCPClient] SSE connection opened to ${url}`);
          resolve();
        };

        eventSource.onerror = (error) => {
          console.error('[MCPClient] SSE connection error:', error);
          reject(new Error(`SSE connection failed: ${JSON.stringify(error)}`));
        };

        eventSource.addEventListener('message', (event) => {
          if (event.data) {
            this.handleMessage(event.data);
          }
        });

        this.on('disconnected', () => {
          eventSource.close();
        });

      } catch (error: any) {
        reject(new Error(`Failed to initialize SSE: ${error.message}`));
      }
    });
  }

  private async connectWebSocket(timeout: number): Promise<void> {
    if (!this.config.wsUrl) {
      throw new Error('WebSocket transport requires wsUrl')
    }

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.config.wsUrl!);

        ws.onopen = () => {
          console.log(`[MCPClient] WebSocket connection opened to ${this.config.wsUrl}`);
          resolve();
        };

        ws.onerror = (error) => {
          console.error('[MCPClient] WebSocket error:', error);
          reject(new Error(`WebSocket connection failed`));
        };

        ws.onmessage = (event) => {
          if (typeof event.data === 'string') {
            this.handleMessage(event.data);
          } else if (event.data instanceof Buffer) {
            this.handleMessage(event.data.toString());
          }
        };

        ws.onclose = (event) => {
          this.updateState('disconnected');
          this.emitEvent({
            type: 'disconnected',
            data: { code: event.code, reason: event.reason },
            timestamp: new Date()
          });
        };

        this.on('disconnected', () => {
          ws.close();
        });

        this.sendRequest = (request: MCPRequest) => {
          ws.send(JSON.stringify(request));
        };

        this.sendNotification = (notification: MCPNotification) => {
          ws.send(JSON.stringify(notification));
        };

      } catch (error: any) {
        reject(new Error(`Failed to initialize WebSocket: ${error.message}`));
      }
    });
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
        reject(new MCPTimeoutError(`Request timeout: ${method}`, id))
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
    // Initialize parser on first use
    if (!this.ndjsonParser) {
      this.ndjsonParser = createNDJSONParser({
        maxBufferSize: 10 * 1024 * 1024, // 10MB
        maxLineLength: 1024 * 1024, // 1MB
        verbose: false,
      })
    }

    // Parse NDJSON with robust error handling for partial chunks
    const messages = this.ndjsonParser.parse(data)

    for (const message of messages) {
      try {
        const typedMessage: MCPResponse | MCPNotification = message

        if ('id' in typedMessage) {
          this.handleResponse(typedMessage as MCPResponse)
        } else if ('method' in typedMessage) {
          this.handleNotification(typedMessage as MCPNotification)
        }
      } catch (error) {
        console.error('[MCPClient] Failed to process message:', error)
      }
    }
  }

  private handleLogMessage(params: any): void {
    const { level, logger, data } = params
    const timestamp = new Date().toISOString()
    this.emitEvent({
      type: 'log',
      data: { level, logger, data, timestamp },
      timestamp: new Date()
    })
  }

  private handleResponse(response: MCPResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) return

    if (pending.timeout) {
      clearTimeout(pending.timeout)
    }
    this.pendingRequests.delete(response.id)

    if (response.error) {
      switch (response.error.code) {
        case -32000: pending.reject(new MCPServerError(response.error.message, response.error.code)); break
        case -32001: pending.reject(new MCPResourceError(response.error.message)); break
        case -32002: pending.reject(new MCPToolError(response.error.message)); break
        case -32600: pending.reject(new MCPProtocolError(response.error.message)); break
        case -32601: pending.reject(new MCPProtocolError(`Method not found: ${response.error.message}`)); break
        default: pending.reject(new Error(response.error.message))
      }
    } else {
      pending.resolve(response.result)
    }
  }

  private handleNotification(notification: MCPNotification): void {
    switch (notification.method) {
      case 'notifications/resources/list_changed': this.emitEvent({ type: 'resource_registered', timestamp: new Date() }); break
      case 'notifications/tools/list_changed': this.emitEvent({ type: 'tool_registered', timestamp: new Date() }); break
      case 'notifications/prompts/list_changed': this.emitEvent({ type: 'prompt_registered', timestamp: new Date() }); break
      case 'notifications/progress': this.emitEvent({ type: 'progress', data: notification.params, timestamp: new Date() }); break
      case 'notifications/message': this.handleLogMessage(notification.params); break
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
    this.emit('event', event)
  }
}
