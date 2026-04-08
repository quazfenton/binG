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
import { createHTTPTransport, isValidMCPURL } from '@/lib/mcp/http-transport';
import { handleMCPHealthCheck } from '@/lib/mcp/health-check';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('MCP-Server');

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
    
    return {
      tools: tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        inputSchema: tool.function.parameters,
      })),
    };
  });

  // Tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    logger.debug('MCP tool call', { tool: name, args: Object.keys(args || {}) });
    
    const tool = vfsTools[name as keyof typeof vfsTools];
    
    if (!tool) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: `Unknown tool: ${name}` }),
          },
        ],
        isError: true,
      };
    }

    try {
      // Execute the tool with the provided arguments
      // @ts-ignore - AI SDK tool execute signature
      const result = await tool.execute(args || {});

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
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
            text: JSON.stringify({ error: error.message }),
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
    const body = await request.json();
    const { jsonrpc, method, params, id } = body;

    // Validate JSON-RPC format
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

      case 'tools/call':
        // Extract user context from request headers or params
        // In production, this would come from auth tokens or session
        const userId = request.headers.get('x-user-id') ||
                       (params as any)?.userId ||
                       'default';
        const sessionId = request.headers.get('x-session-id') || undefined;
        const toolName = (params as any)?.name;
        const toolArgs = (params as any)?.arguments;

        // Find the requested VFS tool
        const targetTool = vfsTools[toolName as keyof typeof vfsTools];

        if (!targetTool) {
          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
              }],
              isError: true,
            },
            id,
          });
        }

        // Build session-scoped path: project/sessions/{sessionId} when available
        const scopePath = sessionId ? `project/sessions/${sessionId}` : 'project';

        // Run tool call inside request-scoped AsyncLocalStorage context.
        // This isolates the context per-request, preventing cross-user data leaks.
        // @ts-ignore - AI SDK tool execute takes different arg shapes
        const callResult = await toolContextStore.run(
          { userId, sessionId, scopePath },
          async () => targetTool.execute(toolArgs || {}, {
            messages: [],
            toolCallId: String(id || crypto.randomUUID()),
          })
        );

        return NextResponse.json({
          jsonrpc: '2.0',
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify(callResult),
            }],
            isError: !(callResult as any)?.success,
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
    logger.error('MCP POST handler error', { error: error.message });
    // Don't leak internal error details to clients
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
      },
      { status: 500 }
    );
  }
}