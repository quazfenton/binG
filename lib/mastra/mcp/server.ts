/**
 * MCP (Model Context Protocol) Server
 *
 * Provider-agnostic tool server for Mastra workflows.
 * Exposes tools via MCP protocol for use by any AI model/provider.
 *
 * Features:
 * - Provider-agnostic tool execution
 * - Centralized tool management
 * - Tool versioning support
 * - Audit logging
 *
 * @see https://mastra.ai/docs/mcp/overview
 * @see https://spec.modelcontextprotocol.io/
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { VirtualFilesystemService } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { getSandboxProvider, type SandboxProvider } from '@/lib/sandbox/providers';

const vfs = new VirtualFilesystemService();

let _sandboxProvider: SandboxProvider | null = null;
async function getProvider(): Promise<SandboxProvider> {
  if (!_sandboxProvider) {
    _sandboxProvider = await getSandboxProvider();
  }
  return _sandboxProvider;
}

// ===========================================
// Tool Definitions
// ===========================================

interface MCPTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  handler: (args: any) => Promise<any>;
}

/**
 * MCP Tool Registry
 * All tools available via MCP protocol
 */
const mcpTools: MCPTool[] = [
  {
    name: 'WRITE_FILE',
    description: 'Write content to a file in the virtual filesystem',
    inputSchema: z.object({
      path: z.string().describe('File path relative to workspace root'),
      content: z.string().describe('Complete file content'),
      ownerId: z.string().describe('Workspace owner ID'),
    }),
    handler: async ({ path, content, ownerId }: any) => {
      // Validate path
      if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
        throw new Error('Invalid path: must be relative and not contain ".."');
      }

      const file = await vfs.writeFile(ownerId, path, content);
      return {
        success: true,
        path: file.path,
        version: file.version,
        size: content.length,
      };
    },
  },
  {
    name: 'READ_FILE',
    description: 'Read content from a file in the virtual filesystem',
    inputSchema: z.object({
      path: z.string().describe('File path relative to workspace root'),
      ownerId: z.string().describe('Workspace owner ID'),
    }),
    handler: async ({ path, ownerId }: any) => {
      if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
        throw new Error('Invalid path: must be relative and not contain ".."');
      }

      const file = await vfs.readFile(ownerId, path);
      return {
        content: file.content,
        language: file.language,
        size: file.content.length,
      };
    },
  },
  {
    name: 'LIST_FILES',
    description: 'List files and directories at the given path',
    inputSchema: z.object({
      path: z.string().optional().describe('Directory path (default: root)'),
      ownerId: z.string().describe('Workspace owner ID'),
    }),
    handler: async ({ path, ownerId }: any) => {
      if (path && (path.includes('..') || path.startsWith('/') || path.startsWith('\\'))) {
        throw new Error('Invalid path: must be relative and not contain ".."');
      }

      const files = await vfs.listFiles(ownerId, path || '/');
      return { files };
    },
  },
  {
    name: 'DELETE_PATH',
    description: 'Delete a file or directory from the virtual filesystem',
    inputSchema: z.object({
      path: z.string().describe('File or directory path'),
      ownerId: z.string().describe('Workspace owner ID'),
    }),
    handler: async ({ path, ownerId }: any) => {
      if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
        throw new Error('Invalid path: must be relative and not contain ".."');
      }

      const result = await vfs.deletePath(ownerId, path);
      return {
        deletedCount: result.deletedCount,
        success: true,
      };
    },
  },
  {
    name: 'EXECUTE_CODE',
    description: 'Execute code in a sandboxed environment. Supports Python, TypeScript, and JavaScript.',
    inputSchema: z.object({
      code: z.string().describe('Code to execute'),
      language: z.enum(['python', 'typescript', 'javascript']).describe('Programming language'),
      ownerId: z.string().describe('Workspace owner ID'),
    }),
    handler: async ({ code, language, ownerId }: any) => {
      // Security validation
      const dangerousPatterns = [
        /\bexec\s*\(/,
        /\beval\s*\(/,
        /\bsystem\s*\(/,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(code)) {
          throw new Error(`Code contains potentially dangerous pattern: ${pattern.source}`);
        }
      }

      const sandbox = await (await getProvider()).createSandbox({ ownerId });
       const command = language === 'python' ? 'python3' : 'node';
       const args = language === 'python' ? ['-c', code] : ['-e', code];

      const startTime = Date.now();
      const result = await sandbox.executeCommand(command, args);
      const executionTime = Date.now() - startTime;

      return {
        output: result.output || '',
        exitCode: result.exitCode,
        executionTime,
      };
    },
  },
  {
    name: 'RUN_TESTS',
    description: 'Run test suite for the project',
    inputSchema: z.object({
      ownerId: z.string().describe('Workspace owner ID'),
      testPattern: z.string().optional().describe('Optional test file pattern'),
    }),
    handler: async ({ ownerId, testPattern }: any) => {
      const sandbox = await (await getProvider()).createSandbox({ ownerId });
       const command = testPattern
        ? `npm test -- ${testPattern}`
        : 'npm test';

      const result = await sandbox.executeCommand(command);
      return {
        success: result.exitCode === 0,
        output: result.output || '',
        exitCode: result.exitCode,
      };
    },
  },
  {
    name: 'INSTALL_DEPS',
    description: 'Install package dependencies in the sandbox environment',
    inputSchema: z.object({
      packages: z.array(z.string()).describe('List of packages to install'),
      language: z.enum(['python', 'node']).describe('Package manager language'),
      ownerId: z.string().describe('Workspace owner ID'),
    }),
    handler: async ({ packages, language, ownerId }: any) => {
      // Validate package names
      const packageRegex = /^[a-zA-Z0-9@][a-zA-Z0-9._@/-]*$/;
      for (const pkg of packages) {
        if (!packageRegex.test(pkg)) {
          throw new Error(`Invalid package name: ${pkg}`);
        }
      }

      const sandbox = await (await getProvider()).createSandbox({ ownerId });
       const command = language === 'python' ? 'pip' : 'npm';
       const args = ['install', ...packages];

      const result = await sandbox.executeCommand(command, args);
      return {
        success: result.exitCode === 0,
        output: result.output || '',
        installedCount: packages.length,
      };
    },
  },
];

// ===========================================
// MCP Server Setup
// ===========================================

/**
 * Create MCP Server instance
 */
const server = new Server(
  {
    name: 'bing-agent-tools',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ===========================================
// MCP Request Handlers
// ===========================================

/**
 * Handle ListTools request
 * Returns all available tools to MCP clients
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.log('[MCP] Listing tools...');

  return {
    tools: mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

/**
 * Handle CallTool request
 * Executes the requested tool with provided arguments
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  console.log(`[MCP] Calling tool: ${name}`, args);

  // Find the requested tool
  const tool = mcpTools.find(t => t.name === name);

  if (!tool) {
    throw new Error(`Unknown tool: ${name}. Available tools: ${mcpTools.map(t => t.name).join(', ')}`);
  }

  try {
    // Validate arguments against schema
    const validatedArgs = tool.inputSchema.parse(args);

    // Execute tool handler
    const result = await tool.handler(validatedArgs);

    console.log(`[MCP] Tool ${name} completed successfully`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: false,
    };
  } catch (error) {
    console.error(`[MCP] Tool ${name} failed:`, error);

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
});

// ===========================================
// Server Lifecycle
// ===========================================

/**
 * Start MCP server with stdio transport
 * Listens for MCP protocol messages on stdin/stdout
 */
async function startMCPServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.log('[MCP] Server started successfully');
    console.log(`[MCP] Available tools: ${mcpTools.map(t => t.name).join(', ')}`);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('[MCP] Shutting down...');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('[MCP] Shutting down...');
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('[MCP] Failed to start server:', error);
    process.exit(1);
  }
}

// ===========================================
// MCP Client Helper Functions
// ===========================================

/**
 * MCP Client for connecting to the server
 * Can be used by workflows to call tools via MCP
 */
export class MCPClient {
  private serverUrl: string;

  constructor(serverUrl: string = 'http://localhost:3000/mcp') {
    this.serverUrl = serverUrl;
  }

  /**
   * Call a tool via MCP server
   */
  async callTool(toolName: string, args: Record<string, any>) {
    const response = await fetch(this.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error.message);
    }

    return result.result;
  }

  /**
   * List available tools
   */
  async listTools() {
    const response = await fetch(this.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/list',
      }),
    });

    const result = await response.json();
    return result.tools || [];
  }
}

// ===========================================
// Exports
// ===========================================

export { startMCPServer, server, mcpTools };

// Start server if run directly
if (process.argv[1]?.includes('mcp-server')) {
  startMCPServer();
}
