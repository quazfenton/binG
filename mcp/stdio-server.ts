#!/usr/bin/env node

/**
 * binG MCP Server - stdio Entry Point
 *
 * Runs binG as an MCP server for Claude Desktop integration.
 * 
 * Usage in Claude Desktop config:
 * ```json
 * {
 *   "mcpServers": {
 *     "binG": {
 *       "command": "node",
 *       "args": ["path/to/binG/dist/mcp/stdio-server.js"]
 *     }
 *   }
 * }
 * ```
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLogger } from '@/lib/utils/logger';
import { registerMultiAgentTools } from '@/lib/mcp/multi-agent-tools';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';

const logger = createLogger('MCP:StdioServer');

// Server information
const SERVER_NAME = 'binG';
const SERVER_VERSION = '1.0.0';

// Create MCP server instance using McpServer (high-level API)
const server = new McpServer(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// Register standard tools
// ... existing tool registrations ...

// Register multi-agent tools
registerMultiAgentTools(server);

// Register tools
server.registerTool(
  'execute_command',
  {
    description: 'Execute shell commands in isolated sandbox',
    inputSchema: {
      command: { type: 'string', description: 'Command to execute' },
      workingDir: { type: 'string', description: 'Working directory' },
    } as unknown as AnySchema,
  },
  async ({ command, workingDir }) => {
    try {
      const { exec } = await import('child_process');

      return new Promise((resolve) => {
        exec(command, { cwd: workingDir || '/workspace', timeout: 30000 }, (error, stdout, stderr) => {
          resolve({
            content: [
              {
                type: 'text' as const,
                text: error ? `Error: ${error.message}\n${stderr}` : stdout,
              },
            ],
            isError: !!error,
          });
        });
      });
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Execution failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'write_file',
  {
    description: 'Write files to sandbox workspace',
    inputSchema: {
      path: { type: 'string', description: 'File path' },
      content: { type: 'string', description: 'File content' },
    } as unknown as AnySchema,
  },
  async ({ path, content }) => {
    try {
      const { writeFile } = await import('fs/promises');
      await writeFile(path, content);

      return {
        content: [{ type: 'text' as const, text: `Successfully wrote to ${path}` }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Write failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'read_file',
  {
    description: 'Read files from sandbox workspace',
    inputSchema: {
      path: { type: 'string', description: 'File path' },
    } as unknown as AnySchema,
  },
  async ({ path }) => {
    try {
      const { readFile } = await import('fs/promises');
      const content = await readFile(path, 'utf-8');

      return {
        content: [{ type: 'text' as const, text: content }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Read failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'list_directory',
  'List directory contents',
  {
    path: { type: 'string', description: 'Directory path' },
  },
  async ({ path }) => {
    try {
      const { readdir } = await import('fs/promises');
      const files = await readdir(path);
      
      return {
        content: [{ type: 'text', text: files.join('\n') }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `List failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Start server
async function main() {
  try {
    logger.info('Starting binG MCP server...');
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    logger.info('binG MCP server connected to stdio transport');
    
    // Keep process alive
    process.on('SIGINT', () => {
      logger.info('Shutting down MCP server...');
      process.exit(0);
    });
  } catch (error: any) {
    logger.error('Failed to start MCP server', { error: error.message });
    process.exit(1);
  }
}

main();
