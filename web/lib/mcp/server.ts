/**
 * MCP (Model Context Protocol) Tool Server
 *
 * Exposes existing virtual filesystem tools via MCP standard.
 * Allows ANY LLM provider (Claude, GPT, Gemini) to use binG tools.
 *
 * @see {@link https://modelcontextprotocol.io} MCP Specification
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  readFileTool,
  listFilesTool,
  writeFileTool,
  applyDiffTool,
  batchWriteTool,
  deleteFileTool,
  createDirectoryTool,
  searchFilesTool,
  getWorkspaceStatsTool,
  toolContextStore,
} from './vfs-mcp-tools';
import { virtualFilesystem } from '../virtual-filesystem/virtual-filesystem-service';

const allTools: Record<string, any> = {
  applyDiffTool,
  readFileTool,
  listFilesTool,
  createFileTool: writeFileTool,
};

export interface MCPServerOptions {
  port?: number;
  sandboxHandle?: any;
}

/**
 * Create and start MCP tool server
 *
 * @param options - Server options
 * @returns MCP server instance
 *
 * @example
 * ```typescript
 * const server = await createMCPToolServer({
 *   port: 3001,
 *   sandboxHandle,
 * });
 * ```
 */
export async function createMCPToolServer(options: MCPServerOptions = {}) {
  const port = options.port || 3001;
  const sandboxHandle = options.sandboxHandle;

  // Create MCP server (using Server from MCP SDK)
  const server = new Server({
    name: 'bing-virtual-fs',
    version: '1.0.0',
  } as any) as any;

  // Register existing tools as MCP tools

  // WRITE tool (applyDiff)
  (server as any).tool(
    'WRITE',
    'Surgically edit a file by replacing specific code blocks. Use for existing files.',
    {
      path: {
        type: 'string',
        description: 'File path to edit',
      },
      search: {
        type: 'string',
        description: 'Exact code to find and replace (include context)',
      },
      replace: {
        type: 'string',
        description: 'New code to insert',
      },
      thought: {
        type: 'string',
        description: 'Explain WHY this change is needed',
      },
    },
    async (params) => {
      try {
        const result = await toolContextStore.run(
          { userId: 'mcp-server', sessionId: undefined },
          async () => applyDiffTool.execute(params, {
            messages: [],
            toolCallId: crypto.randomUUID(),
          }) as any
        );

        return {
          content: [{
            type: 'text',
            text: result.success
              ? `Successfully edited ${params.path}`
              : `Failed to edit ${params.path}: ${result.error}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );

  // READ tool
  (server as any).tool(
    'READ',
    'Read the contents of a file in the sandbox workspace.',
    {
      path: {
        type: 'string',
        description: 'File path relative to workspace root',
      },
    },
    async (params) => {
      try {
        const result = await toolContextStore.run(
          { userId: 'mcp-server', sessionId: undefined },
          async () => readFileTool.execute(params, {
            messages: [],
            toolCallId: crypto.randomUUID(),
          }) as any
        );

        return {
          content: [{
            type: 'text',
            text: result.content || result.output || 'File is empty',
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );

  // LIST tool
  (server as any).tool(
    'LIST',
    'List files and directories at the given path.',
    {
      path: {
        type: 'string',
        description: 'Directory path (default: root)',
        optional: true,
      },
      pattern: {
        type: 'string',
        description: 'Glob pattern to filter files',
        optional: true,
      },
    },
    async (params) => {
      try {
        const result = await toolContextStore.run(
          { userId: 'mcp-server', sessionId: undefined },
          async () => listFilesTool.execute(params, {
            messages: [],
            toolCallId: crypto.randomUUID(),
          }) as any
        );

        return {
          content: [{
            type: 'text',
            text: result.content || result.output || 'Directory is empty',
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );

  // CREATE tool
  (server as any).tool(
    'CREATE',
    'Create a NEW file in the sandbox workspace. Only use for NEW files.',
    {
      path: {
        type: 'string',
        description: 'File path where the new file will be created',
      },
      content: {
        type: 'string',
        description: 'Complete file content',
      },
    },
    async (params) => {
      try {
        const result = await toolContextStore.run(
          { userId: 'mcp-server', sessionId: undefined },
          async () => writeFileTool.execute(params, {
            messages: [],
            toolCallId: crypto.randomUUID(),
          })
        );

        return {
          content: [{
            type: 'text',
            text: `Successfully created ${params.path}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error creating file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );

  // EXEC tool — shell execution requires a sandbox provider, not available in pure VFS mode
  (server as any).tool(
    'EXEC',
    'Execute a shell command in the sandbox. Note: requires sandbox provider, not available in pure VFS mode.',
    {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
        optional: true,
      },
    },
    async () => ({
      content: [{
        type: 'text',
        text: 'EXEC tool requires a sandbox provider (E2B, Blaxel, etc.) — not available in pure VFS mode',
      }],
      isError: true,
    })
  );

  // LIST_RESOURCES tool
  (server as any).tool(
    'LIST_RESOURCES',
    'List available data resources (files, docs, DB tables) from the MCP server.',
    {},
    async () => {
      try {
        const result = await toolContextStore.run(
          { userId: 'mcp-server', sessionId: undefined },
          async () => listFilesTool.execute({ path: '.' }, {
            messages: [],
            toolCallId: crypto.randomUUID(),
          }) as any
        );

        return {
          content: [{
            type: 'text',
            text: result.output || 'No resources available',
          }],
        };
      } catch {
        return { content: [{ type: 'text', text: 'Error listing resources' }], isError: true };
      }
    }
  );

  // GET_PROMPT tool
  (server as any).tool(
    'GET_PROMPT',
    'Retrieve a pre-configured system prompt template by name.',
    {
      name: { type: 'string', description: 'Name of the prompt to retrieve' },
      arguments: { type: 'object', description: 'Arguments for the prompt template', optional: true },
    },
    async (params) => {
      // For now, return the basic system prompt
      return {
        content: [{
          type: 'text',
          text: `Executing prompt: ${params.name}. Context: ${JSON.stringify(params.arguments || {})}`,
        }],
      };
    }
  );

  // Start HTTP transport
  const transport = new StreamableHTTPServerTransport({
    port,
  } as any);

  // Enable capabilities per Smithery docs
  (server as any).onListTools(async () => ({ tools: [] }));
  (server as any).onListResources(async () => ({ resources: [] }));
  (server as any).onListPrompts(async () => ({ prompts: [] }));

  await (server as any).connect(transport);

  console.log(`\n🔌 MCP Tool Server running on http://localhost:${port}`);
  console.log('📦 Available tools: WRITE, READ, LIST, CREATE, EXEC\n');

  return server;
}

/**
 * Stop MCP tool server
 */
export async function stopMCPToolServer(server: Server) {
  await (server as any).close();
  console.log('MCP Tool Server stopped');
}
