/**
 * HTTP Transport for MCP Servers
 * 
 * Enables connecting to remote MCP servers via HTTP/HTTPS transport.
 * Used in web mode to connect to remote MCP servers instead of local stdio.
 * 
 * Supports:
 * - Basic HTTP transport
 * - Streamable HTTP (recommended for production)
 * - SSE (Server-Sent Events) for streaming
 * - Authentication (API keys, Bearer tokens)
 */

import { createLogger } from '../utils/logger';
import { flattenToolResultContent } from './result-format';

const logger = createLogger('MCP-HTTP-Transport');

// Registry of connected HTTP transports for tool discovery and execution
const connectedTransports = new Map<string, HTTPTransport>();

// Cached remote tool definitions (refreshed periodically)
let cachedRemoteTools: Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}> | null = null;

let lastToolFetch = 0;
const TOOL_CACHE_TTL = 60000; // 1 minute cache

/**
 * Register a connected HTTP transport
 */
export function registerHTTPTransport(name: string, transport: HTTPTransport): void {
  connectedTransports.set(name, transport);
  logger.info(`Registered HTTP transport: ${name}`);
}

/**
 * Get a registered HTTP transport by name
 */
export function getHTTPTransport(name: string): HTTPTransport | undefined {
  return connectedTransports.get(name);
}

/**
 * Get all registered HTTP transport names
 */
export function getHTTPTransportNames(): string[] {
  return Array.from(connectedTransports.keys());
}

/**
 * Get all registered HTTP transports
 */
export function getAllHTTPTransports(): Map<string, HTTPTransport> {
  return connectedTransports;
}

/**
 * Get tool definitions from all registered HTTP transports
 * Returns tools in AI SDK format for use in getMCPToolsForAI_SDK
 * Uses caching to avoid fetching on every call
 */
export async function getRemoteMCPTools(forceRefresh = false): Promise<Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}>> {
  const now = Date.now();
  
  // Return cached tools if still valid
  if (!forceRefresh && cachedRemoteTools && (now - lastToolFetch) < TOOL_CACHE_TTL) {
    return cachedRemoteTools;
  }

  const allTools: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: any
    }
  }> = [];

  for (const [serverName, transport] of connectedTransports) {
    try {
      const result = await transport.listTools();
      const tools = result?.tools || [];
      
      for (const tool of tools) {
        allTools.push({
          type: 'function',
          function: {
            name: `${serverName}_${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_'),
            description: tool.description || `Remote MCP tool: ${tool.name}`,
            parameters: tool.inputSchema || { type: 'object', properties: {} },
          },
        });
      }
      
      logger.debug(`Loaded ${tools.length} tools from remote MCP server: ${serverName}`);
    } catch (error: any) {
      logger.warn(`Failed to get tools from remote MCP server ${serverName}:`, error.message);
    }
  }

  // Update cache
  cachedRemoteTools = allTools;
  lastToolFetch = now;

  return allTools;
}

/**
 * Clear the remote tools cache (force refresh on next call)
 */
export function clearRemoteToolsCache(): void {
  cachedRemoteTools = null;
  lastToolFetch = 0;
}

/**
 * Call a remote MCP tool by name
 * Name format: serverName_toolName (e.g., myserver_readFile)
 */
export async function callRemoteMCPTool(
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; output: string; error?: string }> {
  // Extract server name and tool name from toolName
  const underscoreIndex = toolName.indexOf('_');
  if (underscoreIndex === -1) {
    return {
      success: false,
      output: '',
      error: `Invalid remote MCP tool name format: ${toolName}. Expected: serverName_toolName`,
    };
  }

  const serverName = toolName.substring(0, underscoreIndex);
  const remoteToolName = toolName.substring(underscoreIndex + 1);

  const transport = connectedTransports.get(serverName);
  if (!transport) {
    return {
      success: false,
      output: '',
      error: `Unknown remote MCP server: ${serverName}`,
    };
  }

  try {
    const result = await transport.callTool(remoteToolName, args);
    
    // Handle MCP tool result format
    const content = result?.content;
    if (content && Array.isArray(content) && content[0]) {
      const formatted = flattenToolResultContent({
        toolCallId: remoteToolName,
        content,
        isError: result?.isError === true,
      });
      const text = formatted.displayText;
      const isError = result?.isError === true;
      
      return {
        success: !isError,
        output: text,
        error: isError ? text : undefined,
      };
    }

    return {
      success: true,
      output: JSON.stringify(result),
    };
  } catch (error: any) {
    return {
      success: false,
      output: '',
      error: error.message || 'Remote MCP tool call failed',
    };
  }
}

/**
 * Check if there are any connected HTTP transports
 */
export function hasRemoteMCPServers(): boolean {
  return connectedTransports.size > 0;
}

/**
 * HTTP transport configuration options
 */
export interface HTTPTransportConfig {
  /** Server URL (http or https) */
  url: string;
  /** Transport type: 'http', 'streamable-http', or 'sse' */
  transportType?: 'http' | 'streamable-http' | 'sse';
  /** API key for authentication */
  apiKey?: string;
  /** Bearer token for authentication */
  bearerToken?: string;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Maximum retries */
  maxRetries?: number;
}

/**
 * MCP HTTP Transport client
 */
export class HTTPTransport {
  private config: HTTPTransportConfig;
  private baseHeaders: Record<string, string>;

  constructor(config: HTTPTransportConfig) {
    this.config = {
      transportType: 'streamable-http',
      timeout: 30000,
      maxRetries: 3,
      ...config,
    };

    this.baseHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...config.headers,
    };

    if (config.apiKey) {
      this.baseHeaders['X-API-Key'] = config.apiKey;
    }
    if (config.bearerToken) {
      this.baseHeaders['Authorization'] = `Bearer ${config.bearerToken}`;
    }
  }

  /**
   * Make JSON-RPC request to MCP server
   */
  async request(method: string, params?: any): Promise<any> {
    const { url, timeout, maxRetries } = this.config;
    
    for (let attempt = 0; attempt < (maxRetries || 1); attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method: 'POST',
          headers: this.baseHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params: params || {},
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('text/event-stream')) {
          // SSE response - return stream handler
          return this.handleSSEStream(response.body);
        }

        const data = await response.json();
        
        if (data.error) {
          throw new Error(data.error.message || 'MCP error');
        }
        
        return data.result;
      } catch (error: any) {
        logger.debug('HTTP transport request attempt', { attempt, error: error.message });
        if (attempt === (maxRetries || 1) - 1) {
          throw error;
        }
      }
    }
  }

  /**
   * Handle SSE stream response
   */
  private async handleSSEStream(body: any): Promise<any> {
    const reader = body?.getReader();
    if (!reader) {
      throw new Error('Failed to get SSE reader');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            return JSON.parse(line.slice(6));
          } catch {
            // Continue parsing
          }
        }
      }
    }

    return null;
  }

  /**
   * List available tools
   */
  async listTools(): Promise<any> {
    return this.request('tools/list');
  }

  /**
   * Call a specific tool
   */
  async callTool(name: string, args: any): Promise<any> {
    return this.request('tools/call', { name, arguments: args });
  }

  /**
   * Get server capabilities
   */
  async getCapabilities(): Promise<any> {
    return this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'bing-web', version: '1.0.0' },
    });
  }
}

/**
 * Create HTTP transport from config
 */
export function createHTTPTransport(config: HTTPTransportConfig): HTTPTransport {
  return new HTTPTransport(config);
}

/**
 * Create multiple HTTP transports from server configs
 */
export function createHTTPTransports(servers: Array<{ name: string; config: HTTPTransportConfig }>): Map<string, HTTPTransport> {
  const transports = new Map<string, HTTPTransport>();
  
  for (const { name, config } of servers) {
    transports.set(name, createHTTPTransport(config));
  }
  
  return transports;
}

/**
 * Parse MCP server URL - add protocol if missing
 */
export function parseMCPURL(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

/**
 * Validate MCP server URL
 */
export function isValidMCPURL(url: string): boolean {
  try {
    const parsed = new URL(parseMCPURL(url));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
