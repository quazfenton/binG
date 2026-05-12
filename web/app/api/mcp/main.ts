/**
 * MCP Server Route
 * 
 * Exposes VFS tools via the Model Context Protocol (MCP) over HTTP.
 * This allows remote MCP clients to access the Virtual File System
 * using structured, schema-enforced tools instead of fragile tag parsing.
 * 
 * MCP Protocol: https://modelcontextprotocol.io/
 * 
 * Endpoints:
 * - GET  /api/mcp - Server capabilities (JSON-RPC discover)
 * - POST /api/mcp - Tool calls (JSON-RPC)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { vfsTools, getVFSToolDefinitions, setToolContext, toolContextStore } from '@/lib/mcp/vfs-mcp-tools';
import { buildMem0MCPTools } from '@/lib/mcp/vfs-mcp-tools';
import { isMem0Configured } from '@/lib/powers/mem0-power';
import { createHTTPTransport, isValidMCPURL } from '@/lib/mcp/http-transport';
import { handleMCPHealthCheck } from '@/lib/mcp/health-check';
import { formatValueForMCPText } from '@/lib/mcp/result-format';
import { createLogger } from '@/lib/utils/logger';
import { buildCompositeSessionId, buildScopePath, extractSimpleSessionId } from '@/lib/identity';

const logger = createLogger('MCP-Server');

// Mem0 tools cache (initialized lazily)
let mem0MCPTools: Record<string, any> | null = null;

function parseBooleanFlag(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

async function getMem0Tools(): Promise<Record<string, any>> {
  if (mem0MCPTools !== null) return mem0MCPTools;
  if (!isMem0Configured()) {
    mem0MCPTools = {};
    return mem0MCPTools;
  }
  try {
    mem0MCPTools = await buildMem0MCPTools({});
    return mem0MCPTools;
  } catch {
    mem0MCPTools = {};
    return mem0MCPTools;
  }
}

/**
 * Create the MCP server with VFS tools
 */
function createMCPServer(): Server {
  const server = new Server(
    {
      name: 'bing-vfs',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = getVFSToolDefinitions();
    const mem0Tools = await getMem0Tools();

    const mem0ToolList = Object.entries(mem0Tools).map(([name, tool]: [string, any]) => ({
      name: `mem0_${name}`,
      description: tool.description,
      inputSchema: tool.parameters,
    }));

    return {
      tools: [
        ...tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          inputSchema: tool.function.parameters,
        })),
        ...mem0ToolList,
      ],
    };
  });

  // Tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.debug('MCP tool call', { tool: name, args: Object.keys(args || {}) });

    // Check if it's a mem0 tool
    if (name.startsWith('mem0_')) {
      const mem0Tools = await getMem0Tools();
      const mem0ToolName = name.replace('mem0_', '');
      const mem0Tool = mem0Tools[mem0ToolName];

      if (!mem0Tool) {
        return {
          content: [
            {
              type: 'text',
              text: `Unknown mem0 tool: ${mem0ToolName}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await mem0Tool.execute(args || {});
        const formatted = formatValueForMCPText(result);
        return {
          content: [
            {
              type: 'text',
              text: formatted.displayText,
            },
          ],
          isError: !(result as any).success,
        };
      } catch (error: any) {
        logger.error('Mem0 tool execution failed', { tool: name, error: error.message });
        return {
          content: [
            {
              type: 'text',
              text: `Mem0 tool error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // VFS tool
    const tool = vfsTools[name as keyof typeof vfsTools];

    if (!tool) {
      return {
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${name}`,
          },
        ],
        isError: true,
      };
    }

    try {
      // NOTE: Tool context is set by the POST handler directly.
      // This server request handler is only used for non-HTTP tool calls.
      // @ts-ignore - AI SDK tool execute signature
      const result = await tool.execute(args || {});
      const formatted = formatValueForMCPText(result);

      return {
        content: [
          {
            type: 'text',
            text: formatted.displayText,
          },
        ],
        isError: !(result as any).success,
      };
    } catch (error: any) {
      logger.error('MCP tool execution failed', { tool: name, error: error.message });

      return {
        content: [
          {
            type: 'text',
            text: `Tool execution error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// Singleton server instance
let mcpServer: Server | null = null;

/**
 * Get or create the MCP server instance
 */
function getMCPServer(): Server {
  if (!mcpServer) {
    mcpServer = createMCPServer();
    logger.info('MCP Server initialized');
  }
  return mcpServer;
}

/**
 * GET handler - Server capabilities discovery or health check
 * - GET /api/mcp?health=true - Returns health status
 * - GET /api/mcp - Returns MCP server capabilities
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    
    // Health check endpoint
    if (url.searchParams.get('health') === 'true') {
      const health = await handleMCPHealthCheck();
      return NextResponse.json(health, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    
    const server = getMCPServer();

    // Return server capabilities
    return NextResponse.json({
      schemaVersion: '1.0',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'bing-vfs',
        version: '1.0.0',
      },
      tools: getVFSToolDefinitions().map(t => ({
        name: t.function.name,
        description: t.function.description,
      })),
    });
  } catch (error: any) {
    logger.error('MCP GET handler error', { error: error.message });
    return NextResponse.json(
      { error: 'MCP server error' },
      { status: 500 }
    );
  }
}

/**
 * POST handler - Tool call execution
 * Accepts JSON-RPC requests and returns tool results
 */
export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const compact = parseBooleanFlag(url.searchParams.get('compact'), true);
    const body = await request.json();
    const { jsonrpc, method, params, id } = body;

    // Validate JSON-RPC version BEFORE any method handling
    if (jsonrpc !== '2.0') {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid JSON-RPC version',
          },
          id,
        },
        { status: 400 }
      );
    }

    // Handle tool call directly (bypass server request handler to preserve async context)
    if (method === 'tools/call' && params) {
      const { name, arguments: args } = params as { name: string; arguments?: Record<string, any> };

      // Extract session identity from cookies — same as resolveFilesystemOwner
      const cookie = request.cookies.get('anon-session-id');
      const rawSessionId = cookie?.value;
      // Strip anon_ prefix to get simple session ID (e.g., "001", "timestamp_random")
      const simpleSessionId = rawSessionId ? rawSessionId.replace(/^anon_/, '') : '';

      // CRITICAL FIX: Use composite session ID format (userId$sessionId) to match main chat flow
      // This ensures MCP tools write to the SAME workspace as the conversation
      // Format: "anon$sessionId" for anonymous users (uses $ separator, NOT colon)
      const compositeSessionId = simpleSessionId
        ? buildCompositeSessionId('anon', simpleSessionId)  // "anon$001"
        : 'anon$mcp-fallback';

      // userId for tool context is the anonymous user identifier
      const userId = 'anon';

      // Build scopePath from session ID — uses extractSimpleSessionId to handle
      // composite IDs correctly even if user added $ to their folder names
      const scopePath = buildScopePath(simpleSessionId || '000');

      const tool = vfsTools[name as keyof typeof vfsTools];
      if (!tool) {
        return NextResponse.json({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Unknown tool: ${name}` },
          id,
        }, { status: 400 });
      }

      logger.debug('MCP tool call', { tool: name, userId, simpleSessionId, compositeSessionId, scopePath, args: Object.keys(args || {}) });

      // Set tool context so files are written to the correct workspace
      let result: any;
      try {
        result = await toolContextStore.run(
          { userId, sessionId: compositeSessionId, scopePath },
          async () => {
            // @ts-ignore - AI SDK tool execute signature
            return await tool.execute(args || {});
          }
        );
      } catch (error: any) {
        logger.error('MCP tool execution failed', { tool: name, error: error.message });
        return NextResponse.json({
          jsonrpc: '2.0',
          result: {
            content: [{ type: 'text', text: `Tool execution error: ${error.message}` }],
            isError: true,
          },
          id,
        });
      }
      const formatted = formatValueForMCPText(result);

      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: compact ? formatted.displayText : formatted.rawText }],
          isError: !(result as any).success,
        },
        id,
      });
    }

    const server = getMCPServer();

    // Handle different JSON-RPC methods
    switch (method) {
      case 'initialize':
        // Handle client initialization
        return NextResponse.json({
          jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'bing-vfs',
              version: '1.0.0',
            },
          },
          id,
        });

      case 'tools/list':
        // List available tools — use our own VFS tool definitions
        const vfsToolDefs = getVFSToolDefinitions();
        return NextResponse.json({
          jsonrpc: '2.0',
          result: {
            tools: vfsToolDefs.map(tool => ({
              name: tool.function.name,
              description: tool.function.description,
              inputSchema: tool.function.parameters,
            })),
          },
          id,
        });

      case 'resources/list':
      case 'resources/read':
      case 'prompts/list':
      case 'prompts/get':
        // Unimplemented - return empty result
        return NextResponse.json({
          jsonrpc: '2.0',
          result: [],
          id,
        });

      default:
        return NextResponse.json(
          {
            jsonrpc: '2.0',
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
            id,
          },
          { status: 404 }
        );
    }
  } catch (error: any) {
    logger.error('MCP POST handler error', { 
      error: error.message, 
      stack: error.stack,
      name: error.name,
      cause: error.cause,
      url: request.url,
      method: request.method
    });
    // Don't leak internal error details to clients
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error: ' + error.message,
        },
      },
      { status: 500 }
    );
  }
}
