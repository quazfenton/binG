/**
 * MCP Transport Layer
 *
 * Provides multiple transport mechanisms for MCP server:
 * - stdio: For Claude Desktop integration
 * - HTTP: For web-based clients
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
  
  try {
    const transport = new StdioServerTransport();
    logger.info('Stdio transport created successfully');
    return transport;
  } catch (error: any) {
    logger.error('Failed to create stdio transport', { error: error.message });
    throw error;
  }
}

/**
 * Connect MCP server to stdio transport
 */
export async function connectStdioServer(server: Server): Promise<void> {
  try {
    const transport = await createStdioTransport();
    await server.connect(transport);
    logger.info('MCP server connected to stdio transport');
  } catch (error: any) {
    logger.error('Failed to connect MCP server to stdio', { error: error.message });
    throw error;
  }
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
 * Start HTTP server for MCP
 */
export async function createHTTPTransport(options: HTTPOptions): Promise<any> {
  const { createServer } = await import('http');
  
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === options.path) {
        let body = '';
        
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          // Handle MCP JSON-RPC request
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', result: 'ok' }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    
    server.listen(options.port, options.host, () => {
      logger.info(`MCP HTTP transport listening on ${options.host}:${options.port}`);
      resolve(server);
    });
    
    server.on('error', (error) => {
      logger.error('MCP HTTP transport error', { error: error.message });
      reject(error);
    });
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
}

/**
 * Create transport based on configuration
 */
export async function createTransport(config: TransportConfig): Promise<any> {
  switch (config.type) {
    case TransportType.STDIO:
      return createStdioTransport();
    
    case TransportType.HTTP:
      if (!config.http) {
        throw new Error('HTTP options required for HTTP transport');
      }
      return createHTTPTransport(config.http);
    
    case TransportType.SSE:
      // TODO: Implement SSE transport
      throw new Error('SSE transport not yet implemented');
    
    default:
      throw new Error(`Unknown transport type: ${(config as any).type}`);
  }
}

/**
 * Get default transport from environment
 */
export function getDefaultTransport(): TransportConfig {
  const transportType = process.env.MCP_TRANSPORT_TYPE || 'stdio';
  
  switch (transportType) {
    case 'stdio':
      return { type: TransportType.STDIO };
    
    case 'http':
      return {
        type: TransportType.HTTP,
        http: {
          port: parseInt(process.env.MCP_HTTP_PORT || '3001', 10),
          host: process.env.MCP_HTTP_HOST || 'localhost',
          path: process.env.MCP_HTTP_PATH || '/mcp',
        },
      };
    
    default:
      return { type: TransportType.STDIO };
  }
}
