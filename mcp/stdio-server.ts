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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLogger } from '../utils/logger';
import { registerMultiAgentTools } from '@/lib/mcp/multi-agent-tools';

const logger = createLogger('MCP:StdioServer');

// Server information
const SERVER_NAME = 'binG';
const SERVER_VERSION = '1.0.0';

// Create MCP server instance
const server = new Server(
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
server.tool(
  'execute_command',
  'Execute shell commands in isolated sandbox',
  {
    command: { type: 'string', description: 'Command to execute' },
    workingDir: { type: 'string', description: 'Working directory' },
  },
  async ({ command, workingDir }) => {
    try {
      const { exec } = await import('child_process');
      
      return new Promise((resolve) => {
        exec(command, { cwd: workingDir || '/workspace', timeout: 30000 }, (error, stdout, stderr) => {
          resolve({
            content: [
              {
                type: 'text',
                text: error ? `Error: ${error.message}\n${stderr}` : stdout,
              },
            ],
            isError: !!error,
          });
        });
      });
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Execution failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'write_file',
  'Write files to sandbox workspace',
  {
    path: { type: 'string', description: 'File path' },
    content: { type: 'string', description: 'File content' },
  },
  async ({ path, content }) => {
    try {
      const { writeFile } = await import('fs/promises');
      await writeFile(path, content);
      
      return {
        content: [{ type: 'text', text: `Successfully wrote to ${path}` }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Write failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'read_file',
  'Read files from sandbox workspace',
  {
    path: { type: 'string', description: 'File path' },
  },
  async ({ path }) => {
    try {
      const { readFile } = await import('fs/promises');
      const content = await readFile(path, 'utf-8');
      
      return {
        content: [{ type: 'text', text: content }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Read failed: ${error.message}` }],
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
