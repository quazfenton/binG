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

// ============================================================================
// Node.js EventSource Polyfill (uses built-in fetch for SSE)
// ============================================================================

/**
 * A minimal EventSource-compatible implementation for Node.js.
 * Uses the built-in `fetch` API (available in Node 18+) to connect to
 * Server-Sent Events endpoints when the browser `EventSource` global is
 * not available.
 *
 * Implements the subset of the EventSource API used by connectSSE:
 *   onopen, onerror, onmessage, addEventListener, close()
 */
class NodeEventSource {
  private url: string;
  private controller: AbortController;
  private listeners: Map<string, Set<(event: any) => void>> = new Map();

  onopen: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;

  /** @internal exposed for testing */
  CONNECTING = 0;
  OPEN = 1;
  CLOSED = 2;
  readyState: number = 0;

  constructor(url: string) {
    this.url = url;
    this.controller = new AbortController();
    this.connect();
  }

  private async connect(): Promise<void> {
    try {
      const response = await fetch(this.url, {
        signal: this.controller.signal,
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        const err = new Error(`SSE HTTP ${response.status}: ${response.statusText}`);
        this.onerror?.(err);
        return;
      }

      this.readyState = 1; // OPEN
      this.onopen?.();

      const reader = response.body?.getReader();
      if (!reader) {
        this.onerror?.(new Error('SSE response has no readable body'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let lastEventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE parser: split on double-newline (event boundary)
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;

          let data = '';
          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              lastEventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              data += line.slice(6) + '\n';
            } else if (line.startsWith('data:')) {
              data += line.slice(5) + '\n';
            } else if (line === '') {
              // blank line within event — preserve
              data += '\n';
            }
          }

          if (data.endsWith('\n')) {
            data = data.slice(0, -1);
          }

          if (data) {
            const event = { data, type: lastEventType || 'message' };
            // Dispatch to type-specific listeners (addEventListener)
            const specificListeners = this.listeners.get(event.type);
            if (specificListeners) {
              for (const listener of specificListeners) {
                listener(event);
              }
            }
            // Dispatch to onmessage for 'message' type events
            if (event.type === 'message' || !event.type) {
              this.onmessage?.(event);
            }
            lastEventType = '';
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.onerror?.(err);
      }
    } finally {
      this.readyState = 2; // CLOSED
    }
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  close(): void {
    this.controller.abort();
    this.readyState = 2; // CLOSED
  }
}

// ============================================================================
// Simple HTTP fetch helper for SSE-based POST requests
// ============================================================================

/**
 * Send a JSON-RPC message to an MCP server via HTTP POST (used for SSE transport).
 */
async function ssePost(
  endpointUrl: string,
  body: string,
  authToken?: string,
  timeout: number = 10000,
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`SSE POST returned HTTP ${response.status}: ${response.statusText}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// MCP Client
// ============================================================================

/**
 * MCP Client class for connecting to and interacting with MCP servers
 */
export class MCPClient extends EventEmitter {
  private eventSourceInstance: { close: () => void } | null = null;
  private sseEndpoint: string = '';
  private config: MCPTransportConfig
  private connectionInfo: MCPConnectionInfo
  private requestId: number = 0
  private pendingRequests: Map<number | string, {
    resolve: (result: any) => void
    reject: (error: Error) => void
    timeout?: NodeJS.Timeout
  }> = new Map()

  private autoReconnect: boolean = true
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 3
  private reconnectDelay: number = 1000
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
   * Health check for MCP connection
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; details?: string }> {
    const start = Date.now()

    if (!this.isConnected()) {
      return { healthy: false, latency: Date.now() - start, details: 'Not connected' }
    }

    // Check stdio process health
    if (this.config.type === 'stdio' && this.process) {
      try {
        this.process.kill(0) // Signal 0 checks if process exists
        return { healthy: true, latency: Date.now() - start, details: 'Process running' }
      } catch {
        return { healthy: false, latency: Date.now() - start, details: 'Process not responding' }
      }
    }

    return { healthy: true, latency: Date.now() - start, details: 'Connected' }
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
          // Auto-reconnect for stdio transport
          if (this.autoReconnect && this.config.type === 'stdio' && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect()
          }
        }
      })

      const spawnTimeout = setTimeout(() => {
        this.process?.removeAllListeners('spawn')
        reject(new MCPTimeoutError(`Process spawn timeout after ${this.config.timeout || 5000}ms`))
      }, this.config.timeout || 5000)

      this.process.on('spawn', () => {
        clearTimeout(spawnTimeout)
        resolve()
      })
    })
  }

  /**
   * Schedule reconnection after process death
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    console.log(`[MCPClient] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`)

    setTimeout(async () => {
      try {
        await this.connect(this.config.timeout || 10000)
        console.log(`[MCPClient] Reconnected successfully after ${this.reconnectAttempts} attempt(s)`)
        this.reconnectAttempts = 0
      } catch (error) {
        console.error(`[MCPClient] Reconnect attempt failed:`, error)
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect()
        } else {
          console.error(`[MCPClient] Max reconnection attempts reached`)
        }
      }
    }, delay)
  }

  private async connectSSE(timeout: number): Promise<void> {
    if (!this.config.url) {
      throw new Error('SSE transport requires url')
    }

    return new Promise((resolve, reject) => {
      try {
        const url = new URL(this.config.url!);

        // Create EventSource — use the native browser API if available,
        // otherwise fall back to the Node.js fetch-based polyfill.
        const eventSource: any =
          typeof EventSource !== 'undefined'
            ? new EventSource(url.toString())
            : new NodeEventSource(url.toString());

        let isConnected = false;
        eventSource.onopen = () => {
          console.log(`[MCPClient] SSE connection opened to ${url}`);
          isConnected = true;
          resolve();
        };

        eventSource.onerror = (error: any) => {
          if (!isConnected) {
            // Initial connection failed — reject so the caller can retry
            reject(new Error(`SSE connection failed: ${error?.message || JSON.stringify(error)}`));
            return;
          }
          // Stream error after successful connection — just warn (server may reconnect)
          console.warn('[MCPClient] SSE stream error — will attempt reconnect');
        };

        // Listen for the MCP 'endpoint' event which tells us where to POST
        // JSON-RPC requests. Standard SSE MCP transport sends this as the
        // very first event after connecting.
        eventSource.addEventListener('endpoint', (event: any) => {
          if (event.data) {
            const endpointUrl = event.data.trim();
            if (endpointUrl) {
              // Resolve relative URLs against the SSE base URL
              try {
                this.sseEndpoint = new URL(endpointUrl, url).toString();
              } catch {
                this.sseEndpoint = endpointUrl;
              }
              console.log(`[MCPClient] SSE endpoint discovered: ${this.sseEndpoint}`);
            }
          }
        });

        eventSource.addEventListener('message', (event: any) => {
          if (event.data) {
            this.handleMessage(event.data);
          }
        });

        this.eventSourceInstance = eventSource;

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

        this._wsSendRequest = (request: MCPRequest) => {
          ws.send(JSON.stringify(request));
        };

        this._wsSendNotification = (notification: MCPNotification) => {
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

      this.sendRequest(request).catch((err) => {
        clearTimeout(timeoutId)
        this.pendingRequests.delete(id)
        reject(err)
      })
    })
  }

  private async notify(method: string, params?: any): Promise<void> {
    const notification: MCPNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }
    await this.sendNotification(notification)
  }

  /** WebSocket send override — set by connectWebSocket */
  private _wsSendRequest: ((request: MCPRequest) => void) | null = null;
  private _wsSendNotification: ((notification: MCPNotification) => void) | null = null;

  private async sendRequest(request: MCPRequest): Promise<void> {
    if (this._wsSendRequest) {
      // WebSocket transport
      this._wsSendRequest(request);
    } else if (this.config.type === 'sse' && this.sseEndpoint) {
      // SSE transport: POST JSON-RPC to the discovered endpoint
      await ssePost(
        this.sseEndpoint,
        JSON.stringify(request) + '\n',
        this.config.authToken,
        this.config.timeout,
      );
    } else if (this.process?.stdin) {
      // stdio transport: write to stdin
      const message = JSON.stringify(request) + '\n';
      this.process.stdin.write(message);
    } else {
      throw new Error('Not connected');
    }
  }

  private async sendNotification(notification: MCPNotification): Promise<void> {
    if (this._wsSendNotification) {
      // WebSocket transport
      this._wsSendNotification(notification);
    } else if (this.config.type === 'sse' && this.sseEndpoint) {
      // SSE transport: POST JSON-RPC to the discovered endpoint
      await ssePost(
        this.sseEndpoint,
        JSON.stringify(notification) + '\n',
        this.config.authToken,
        this.config.timeout,
      );
    } else if (this.process?.stdin) {
      // stdio transport: write to stdin
      const message = JSON.stringify(notification) + '\n';
      this.process.stdin.write(message);
    } else {
      throw new Error('Not connected');
    }
  }

  private handleMessage(data: string): void {
    // Buffer incomplete lines for partial NDJSON messages
    this.messageBuffer += data

    // Check for complete lines (newline-terminated)
    const lines = this.messageBuffer.split('\n')
    this.messageBuffer = lines.pop() || '' // Keep incomplete line in buffer

    // Initialize parser on first use
    if (!this.ndjsonParser) {
      this.ndjsonParser = createNDJSONParser({
        maxBufferSize: 10 * 1024 * 1024, // 10MB
        maxLineLength: 1024 * 1024, // 1MB
        verbose: false,
      })
    }

    // Process each complete line
    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine) continue

      // Parse NDJSON with robust error handling for partial chunks
      const messages = this.ndjsonParser.parse(trimmedLine + '\n')

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
