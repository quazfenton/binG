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
export { INIT_PROBE_TIMEOUT_MS } from './timeouts';
import { INIT_PROBE_TIMEOUT_MS } from './timeouts';

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
 *
 * @param options.signal Optional external AbortSignal. When provided, each
 *   transport's listTools() inherits it, so a hung tool-discovery fetch is
 *   aborted within microseconds of the signal flipping. The whole Promise.all
 *   is then bounded by `min(internalBackendTimeout, externalSignal)` rather
 *   than `internalBackendTimeout × transportCount`.
 */
export async function getRemoteMCPTools(
  forceRefresh = false,
  options?: { signal?: AbortSignal },
): Promise<Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}>> {
  const now = Date.now();

  logger.debug('getRemoteMCPTools called', {
    forceRefresh,
    hasCached: !!cachedRemoteTools,
    cacheAge: cachedRemoteTools ? now - lastToolFetch : null,
    transportCount: connectedTransports.size,
    transportNames: Array.from(connectedTransports.keys())
  });

  // Return cached tools if still valid
  if (!forceRefresh && cachedRemoteTools && (now - lastToolFetch) < TOOL_CACHE_TTL) {
    logger.debug('Returning cached remote tools', { count: cachedRemoteTools.length });
    return cachedRemoteTools;
  }

  // NEW-C1 (doc/async-parallelization-opportunities.md §NEW-1 followup-c):
  // each transport's listTools() in PA so the wallclock is max-of-N rather
  // than sum-of-N. Per-transport try/catch isolates failures: a single
  // failing transport returns [] without denying tool definitions from
  // healthy siblings. 60s TTL cache at L79-L82 unchanged.
  // Chat-hang-fix Step B: thread options.signal into each transport.listTools()
  // so the chat route's watchdog AbortSignal bounded the tool-discovery
  // wallclock instead of leaving it to the per-transport 30s timeout.
  const transportResults = await Promise.all(
    Array.from(connectedTransports).map(async ([serverName, transport]) => {
      try {
        const result = await transport.listTools({ signal: options?.signal });
        const tools = result?.tools || [];
        logger.debug(`Loaded ${tools.length} tools from remote MCP server: ${serverName}`);
        return tools.map((tool: any) => ({
          type: 'function' as const,
          function: {
            name: `${serverName}_${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_'),
            description: tool.description || `Remote MCP tool: ${tool.name}`,
            parameters: tool.inputSchema || { type: 'object', properties: {} },
          },
        }));
      } catch (error: any) {
        logger.warn(`Failed to get tools from remote MCP server ${serverName}:`, error.message);
        return [] as Array<{ type: 'function'; function: { name: string; description?: string; parameters: any } }>;
      }
    })
  );
  const allTools = transportResults.flat();

  // Update cache — BUT only if the discovery wasn't aborted mid-flight.
  // Review comment #23: an aborted discovery (caller's timeout/turn watchdog
  // firing while some transports were still resolving) would poison the
  // shared TTL cache with partial results, causing later NON-aborted turns to
  // lose remote tools until the cache expired. Skip cache write + reset the
  // freshness timestamp on abort so the next call re-discovers cleanly.
  if (options?.signal?.aborted) {
    cachedRemoteTools = null;
    lastToolFetch = 0;
    return allTools;
  }
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
 * Unregister all HTTP transports. Useful for hot-reload (dev) and as a
 * test-isolation helper — production code does not generally call this.
 */
export function clearAllHTTPTransports(): void {
  connectedTransports.clear();
  clearRemoteToolsCache();
}

/**
 * Per-server ceiling for the initializeMCPForArchitecture1 probe loop.
 * Each HTTP transport's listTools() probe gets an AbortSignal.timeout(INIT_PROBE_TIMEOUT_MS)
 * so a single dead server no longer holds init open for the full
 * transport.timeout (30000ms). Was unbounded per-server before; with N
 * dead servers in a sequential loop the cumulative worst case was
 * N × 30s = 270s+ for N=9. With this constant + parallel probes, the
 * worst case is INIT_PROBE_TIMEOUT_MS regardless of N.
 */

/**
 * Call a remote MCP tool by name
 * Name format: serverName_toolName (e.g., myserver_readFile)
 *
 * @param options.signal Optional external AbortSignal (default: timeout-only).
 *   When provided, aborts the underlying HTTP fetch within ≤100ms of an
 *   external abort (e.g. chat route's `agentTurnSignal` watchdog). Additive:
 *   when omitted, behavior matches the pre-fix implementation exactly.
 */
export async function callRemoteMCPTool(
  toolName: string,
  args: Record<string, any>,
  options?: { signal?: AbortSignal }
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
    const result = await transport.callTool(remoteToolName, args, { signal: options?.signal });
    
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
  const hasServers = connectedTransports.size > 0;
  logger.debug('hasRemoteMCPServers check', { 
    size: connectedTransports.size, 
    hasServers,
    serverNames: Array.from(connectedTransports.keys())
  });
  return hasServers;
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
   * Make JSON-RPC request to MCP server.
   *
   * @param options.signal Optional external AbortSignal. When provided, the
   *   combined signal (timeout + external) flips on EITHER source, the
   *   in-flight fetch aborts within ≤100ms, AND the retry loop is broken
   *   out of immediately on external-abort (no internal-retry swallow).
   *   Additive: when omitted, behavior matches the pre-fix implementation
   *   exactly (timeout-driven aborts, retry-on-transient-error).
   */
  async request(method: string, params?: any, options?: { signal?: AbortSignal }): Promise<any> {
    const { url, timeout, maxRetries } = this.config;
    const externalSignal = options?.signal;

    for (let attempt = 0; attempt < (maxRetries || 1); attempt++) {
      // Pre-attempt bailout: the watchdog (agentTurnSignal) may have fired
      // before we got here — never even start the fetch (T1).
      if (externalSignal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        // Combine internal timeout abort with external watchdog signal so
        // fetch rejects on either source (T2). AbortSignal.any is the
        // canonical ES2022 / Node 18+ combiner.
        const combinedSignal = externalSignal
          ? AbortSignal.any([controller.signal, externalSignal])
          : controller.signal;

        const response = await fetch(url, {
          method: 'POST',
          headers: this.baseHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params: params || {},
          }),
          signal: combinedSignal,
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
        // Mid-retry-cycle bailout (T3): if the watchdog fired during this
        // attempt, propagate immediately rather than swallowing through
        // retries. Preserves the original `maxRetries` exhausted rethrow
        // path when no external signal is provided (T6 regression).
        if (externalSignal?.aborted) {
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }
        if (attempt === (maxRetries || 1) - 1) {
          throw error;
        }
      }
    }
  }

  /**
   * Handle SSE stream response — accumulates events until a complete JSON-RPC
   * response is received.
   *
   * Fixes three bugs in the prior implementation:
   *   1. Returned on the FIRST `data:` line, missing progress/intermediate events
   *      and returning premature partial results.
   *   2. Split on `\n` (single newline) instead of `\n\n` (double newline, the
   *      SSE event boundary), which broke multi-line data fields.
   *   3. Ignored the `event:` type field — progress events were treated the same
   *      as result/message events.
   *
   * This implementation:
   *   - Splits on `\n\n` to correctly identify SSE event boundaries.
   *   - Parses `event:` and `data:` fields per event.
   *   - Accumulates multi-line `data:` values (each `data:` line is appended
   *     with a newline separator per the SSE spec).
   *   - Only returns a complete JSON-RPC response from an `event: message`
   *     (or bare data: with no event type). Progress and other intermediate
   *     events are parsed but discarded.
   *   - If the stream ends without finding a matching response, returns null.
   */
  private async handleSSEStream(body: any): Promise<any> {
    const reader = body?.getReader();
    if (!reader) {
      throw new Error('Failed to get SSE reader');
    }

    const decoder = new TextDecoder();
    // Buffer holds partial data that hasn't formed a complete SSE event yet.
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Stream ended without finding a complete response.
        // Try to parse whatever is left in the buffer as a last resort.
        if (buffer.trim().length > 0) {
          const lastResort = buffer.trim();
          if (lastResort.startsWith('{')) {
            try { return JSON.parse(lastResort); } catch { /* ignore */ }
          }
        }
        return null;
      }

      buffer += decoder.decode(value, { stream: true });

      // SSE events are delimited by double newline (\n\n).
      // Split on this boundary to extract complete events.
      let eventEndIndex: number;
      while ((eventEndIndex = buffer.indexOf('\n\n')) >= 0) {
        const eventBlock = buffer.slice(0, eventEndIndex);
        buffer = buffer.slice(eventEndIndex + 2);

        if (!eventBlock.trim()) continue;

        // Parse the event block into (eventType, dataString).
        const lines = eventBlock.split('\n');
        let eventType = '';
        let dataString = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            // Per the SSE spec, multiple data: lines in the same event
            // should be joined with a newline separator.
            const dataContent = line.slice(6);
            if (dataString.length > 0) {
              dataString += '\n';
            }
            dataString += dataContent;
          }
        }

        if (!dataString) continue;

        // Only process 'message' events or bare data: (no event type).
        // Progress, ping, and other intermediate events are discarded.
        // Per the MCP SSE transport spec, the final JSON-RPC response
        // is delivered as an `event: message` with a `data:` containing
        // the complete JSON-RPC response object.
        const isMessageEvent = eventType === '' || eventType === 'message';
        if (!isMessageEvent) {
          logger.debug('[SSE] Skipping intermediate event', { eventType, dataLength: dataString.length });
          continue;
        }

        try {
          const parsed = JSON.parse(dataString);
          // If the parsed object has an `id` field matching the request
          // and either a `result` or `error` field, it's a complete
          // JSON-RPC response — return it immediately.
          // Bare `data: {}` without id/result/error is treated as a
          // notification and skipped.
          if ('result' in parsed || 'error' in parsed) {
            return parsed;
          }
          // Notifications (id-less messages) are silently skipped so
          // the loop continues to the next event.
        } catch {
          logger.warn('[SSE] Failed to parse data as JSON, skipping event', {
            eventType,
            dataPreview: dataString.slice(0, 200),
          });
        }
      }
    }
  }

  /**
   * List available tools
   */
  async listTools(options?: { signal?: AbortSignal }): Promise<any> {
    return this.request('tools/list', undefined, options);
  }

  /**
   * Call a specific tool
   */
  async callTool(name: string, args: any, options?: { signal?: AbortSignal }): Promise<any> {
    return this.request('tools/call', { name, arguments: args }, options);
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
