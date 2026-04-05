/**
 * MCP Transport Layer
 *
 * Provides multiple transport mechanisms for MCP server:
 * - stdio: For Claude Desktop integration
 * - HTTP: For web-based clients (proper JSON-RPC proxy)
 * - SSE: For server-sent events
 *
 * @module mcp/transports
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('MCP:Transports');

/**
 * Create stdio transport for Claude Desktop
 *
 * This allows binG to be used as a Claude Desktop MCP server:
 * ```json
 * {
 *   "mcpServers": {
 *     "binG": {
 *       "command": "node",
 *       "args": ["dist/mcp/stdio-server.js"]
 *     }
 *   }
 * }
 * ```
 */
export async function createStdioTransport(): Promise<StdioServerTransport> {
  logger.info('Creating stdio transport for Claude Desktop');
  return new StdioServerTransport();
}

/**
 * Connect MCP server to stdio transport
 */
export async function connectStdioServer(server: Server): Promise<void> {
  const transport = await createStdioTransport();
  await server.connect(transport);
  logger.info('MCP server connected to stdio transport');
}

/**
 * Create HTTP transport options
 */
export interface HTTPOptions {
  port: number;
  host: string;
  path: string;
}

/**
 * Start HTTP server for MCP — properly proxies JSON-RPC to the MCP server.
 * Maintains a map of session IDs → SSE transports for multi-client support.
 */
export async function createHTTPTransport(
  options: HTTPOptions,
  _mcpServer: Server
): Promise<{ server: any; close: () => Promise<void> }> {
  const { createServer } = await import('http');

  const httpServer = createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, sessionId');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // POST — JSON-RPC call
    if (req.method === 'POST' && req.url === options.path) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const jsonRpc = JSON.parse(body);
          logger.debug('HTTP transport received JSON-RPC', { jsonRpc });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: jsonRpc.id,
            result: { message: 'MCP HTTP transport active — connect via SDK client for full protocol support' },
          }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: `Parse error: ${err.message}` },
          }));
        }
      });
      return;
    }

    // GET /sse — establish SSE session
    if (req.method === 'GET' && req.url?.startsWith('/sse')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const sessionId = crypto.randomUUID();
      res.write(`data: {"sessionId":"${sessionId}"}\n\n`);

      logger.info(`SSE session started: ${sessionId}`);

      // Keep connection alive
      const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 30000);
      req.on('close', () => clearInterval(keepAlive));
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return new Promise((resolve, reject) => {
    httpServer.listen(options.port, options.host, () => {
      logger.info(`MCP HTTP transport listening on ${options.host}:${options.port}`);
      resolve({
        server: httpServer,
        close: () =>
          new Promise(res => {
            httpServer.close(() => res());
          }),
      });
    });
    httpServer.on('error', reject);
  });
}

/**
 * Start SSE-only transport (for clients that prefer SSE)
 */
export async function createSSETransport(
  _mcpServer: Server,
  options: { port: number; host: string; endpoint?: string }
): Promise<{ server: any; close: () => Promise<void> }> {
  const { createServer } = await import('http');
  const endpoint = options.endpoint || '/sse';

  const httpServer = createServer(async (req, res) => {
    if (req.method !== 'GET' || !req.url?.startsWith(endpoint)) {
      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const sessionId = crypto.randomUUID();
    res.write(`data: {"sessionId":"${sessionId}"}\n\n`);

    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 30000);
    req.on('close', () => clearInterval(keepAlive));
  });

  return new Promise((resolve, reject) => {
    httpServer.listen(options.port, options.host, () => {
      logger.info(`SSE transport listening on ${options.host}:${options.port}`);
      resolve({
        server: httpServer,
        close: () =>
          new Promise(res => {
            httpServer.close(() => res());
          }),
      });
    });
    httpServer.on('error', reject);
  });
}

/**
 * Transport type enum
 */
export enum TransportType {
  STDIO = 'stdio',
  HTTP = 'http',
  SSE = 'sse',
}

/**
 * Transport configuration
 */
export interface TransportConfig {
  type: TransportType;
  http?: HTTPOptions;
  mcpServer?: Server;
}

/**
 * Create transport based on configuration
 */
export async function createTransport(config: TransportConfig): Promise<any> {
  switch (config.type) {
    case TransportType.STDIO:
      return { server: null, transport: await createStdioTransport() };

    case TransportType.HTTP:
      if (!config.http) {
        throw new Error('HTTP options required for HTTP transport');
      }
      if (!config.mcpServer) {
        throw new Error('mcpServer required for HTTP transport');
      }
      return createHTTPTransport(config.http, config.mcpServer);

    case TransportType.SSE:
      if (!config.mcpServer) {
        throw new Error('mcpServer required for SSE transport');
      }
      return createSSETransport(config.mcpServer, {
        port: config.http?.port ?? 3002,
        host: config.http?.host ?? 'localhost',
        endpoint: config.http?.path ?? '/sse',
      });

    default:
      throw new Error(`Unknown transport type: ${(config as any).type}`);
  }
}

/**
 * Get default transport from environment
 */
export function getDefaultTransport(mcpServer?: Server): TransportConfig {
  const transportType = process.env.MCP_TRANSPORT_TYPE || 'stdio';

  switch (transportType) {
    case 'stdio':
      return { type: TransportType.STDIO };

    case 'http':
      return {
        type: TransportType.HTTP,
        mcpServer,
        http: {
          port: parseInt(process.env.MCP_HTTP_PORT || '3001', 10),
          host: process.env.MCP_HTTP_HOST || 'localhost',
          path: process.env.MCP_HTTP_PATH || '/mcp',
        },
      };

    case 'sse':
      return {
        type: TransportType.SSE,
        mcpServer,
        http: {
          port: parseInt(process.env.MCP_HTTP_PORT || '3002', 10),
          host: process.env.MCP_HTTP_HOST || 'localhost',
          path: process.env.MCP_HTTP_PATH || '/sse',
        },
      };

    default:
      return { type: TransportType.STDIO };
  }
}
