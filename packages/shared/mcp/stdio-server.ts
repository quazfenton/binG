#!/usr/bin/env node

/**
 * binG MCP Server — stdio Entry Point (Phase 1)
 *
 * Runs binG as an MCP server for external clients (Claude Desktop, Ollama,
 * LM Studio, etc.) via stdin/stdout.
 *
 * Delegates ALL operations through the app's existing capability system:
 *
 *   External MCP Client ──stdio──► stdio-server.ts ──► CapabilityRouter ──► providers
 *                                                                        ├─ VFS
 *                                                                        ├─ Sandbox (Daytona/E2B/...)
 *                                                                        ├─ Terminal / PTY
 *                                                                        ├─ Project Analysis
 *                                                                        └─ ...
 *
 * USER ID ISOLATION:
 * - Desktop / standalone: uses MCP_STDIO_USER_ID env var (single user)
 * - Web mode: userId is extracted from the request context by the calling
 *   code (e.g., the chat route passes userId through executeCapability).
 *   The stdio server itself is single-user; multi-user isolation is handled
 *   at the CapabilityRouter/VFS layer via the userId parameter.
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
 *
 * Or run directly:
 *   npx tsx packages/shared/mcp/stdio-server.ts
 *
 * Environment variables:
 *   MCP_STDIO_USER_ID   — User ID for file/sandbox operations (default: 'mcp-stdio-user')
 *   MCP_STDIO_LOG_LEVEL — Log level: debug, info, warn, error (default: 'info')
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';

// Override log level from env
if (process.env.MCP_STDIO_LOG_LEVEL) {
  process.env.LOG_LEVEL = process.env.MCP_STDIO_LOG_LEVEL;
}

const logger = createLogger('MCP:StdioServer');

// ============================================================================
// Server Information
// ============================================================================

const SERVER_NAME = 'binG';
const SERVER_VERSION = '1.0.0';

// ============================================================================
// User Context
// ============================================================================
// MCP stdio connections don't have per-request auth (unlike HTTP).
// The user ID is configured once at startup via env var.
//
// For web mode multi-user isolation, the calling code (e.g., chat route)
// should set MCP_STDIO_USER_ID before spawning the stdio process.
// Alternatively, use the HTTP-based MCP server (mcp-http-server.ts) which
// has per-request auth via Bearer tokens.

const MCP_USER_ID = process.env.MCP_STDIO_USER_ID || 'mcp-stdio-user';
logger.info('MCP stdio server user context', { userId: MCP_USER_ID });

// ============================================================================
// Capability Router Proxy
// ============================================================================
// All tools delegate through the capability router, which handles:
// - Provider selection (VFS, sandbox, terminal, project-analysis, etc.)
// - Input validation against Zod schemas
// - Provider failover if primary fails
// - Agency learning (tracks success rates for adaptive routing)

interface CapabilityCall {
  capabilityId: string;
  input: Record<string, unknown>;
  userId: string;
}

async function executeCapability(call: CapabilityCall): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const toolName = call.capabilityId;
  logger.debug('Executing capability via router', { tool: toolName, userId: call.userId });

  try {
    const { getCapabilityRouter } = await import('@/lib/tools/router');
    const router = getCapabilityRouter();

    // Initialize router if not already done
    if (!(router as any).initialized) {
      await router.initialize();
    }

    const result = await router.execute(call.capabilityId, call.input, {
      userId: call.userId,
      conversationId: 'mcp-stdio',
    } as any);

    if (!result.success) {
      logger.warn('Capability execution failed', {
        tool: toolName,
        error: result.error,
        userId: call.userId,
      });
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${result.error || 'Unknown error'}`,
        }],
        isError: true,
      };
    }

    logger.debug('Capability executed successfully', { tool: toolName });

    // Format result as text for MCP
    const data = (result as any).data || result;
    const text = typeof data === 'string'
      ? data
      : typeof data === 'object'
        ? JSON.stringify(data, null, 2)
        : String(data);

    return {
      content: [{ type: 'text' as const, text }],
    };
  } catch (error: any) {
    logger.error('Capability router error', {
      tool: toolName,
      error: error.message,
      stack: error.stack,
    });
    return {
      content: [{ type: 'text' as const, text: `Router error: ${error.message}` }],
      isError: true,
    };
  }
}

// ============================================================================
// Helper: format structured result
// ============================================================================

function formatResult(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === null || data === undefined) return '(no data)';
  return JSON.stringify(data, null, 2);
}

function formatSuccess(data: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    // Prefer 'message' field for human-readable output
    if (typeof obj.message === 'string') {
      return { content: [{ type: 'text' as const, text: obj.message }] };
    }
    // Fall back to 'output' field
    if (typeof obj.output === 'string') {
      return { content: [{ type: 'text' as const, text: obj.output }] };
    }
  }
  return { content: [{ type: 'text' as const, text: formatResult(data) }] };
}

// ============================================================================
// WebSocket Failure Logging
// ============================================================================
// Log when WebSocket connections to terminal sessions fail,
// which indicates the terminal subsystem may be unhealthy.

async function logWebSocketHealth(): Promise<void> {
  try {
    const { webSocketTerminalServer } = await import('@/lib/terminal/websocket-terminal-server');
    if (webSocketTerminalServer) {
      const status = (webSocketTerminalServer as any).getStatus?.();
      if (status) {
        logger.info('WebSocket terminal server status', status);
      }
    }
  } catch (error: any) {
    logger.warn('WebSocket terminal server status check failed', error.message);
  }
}

// ============================================================================
// Create MCP Server
// ============================================================================

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// ============================================================================
// 1. FILE OPERATIONS (delegates to VFSProvider / LocalFilesystemProvider)
// ============================================================================

server.registerTool(
  'file.read',
  {
    description: 'Read the contents of a file from the workspace. ' +
      'Use this to inspect source code, config files, logs, etc.',
    inputSchema: {
      path: z.string().describe('File path relative to workspace root'),
      encoding: z.enum(['utf-8', 'base64', 'binary']).optional().default('utf-8'),
      maxBytes: z.number().optional().default(100000).describe('Maximum bytes to read'),
    },
  },
  async ({ path, encoding, maxBytes }) => {
    logger.debug('file.read requested', { path });
    const result = await executeCapability({
      capabilityId: 'file.read',
      input: { path, encoding, maxBytes },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : { content: result.content };
  }
);

server.registerTool(
  'file.write',
  {
    description: 'Create or overwrite a file in the workspace. ' +
      'Parent directories are created automatically.',
    inputSchema: {
      path: z.string().describe('File path relative to workspace root'),
      content: z.string().describe('Complete file content'),
    },
  },
  async ({ path, content }) => {
    logger.debug('file.write requested', { path, contentLength: content.length });
    const result = await executeCapability({
      capabilityId: 'file.write',
      input: { path, content },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : { content: [{ type: 'text' as const, text: `Successfully wrote ${path}` }] };
  }
);

server.registerTool(
  'file.list',
  {
    description: 'List files and directories at a given path in the workspace.',
    inputSchema: {
      path: z.string().optional().default('.').describe('Directory path (default: workspace root)'),
    },
  },
  async ({ path }) => {
    logger.debug('file.list requested', { path });
    const result = await executeCapability({
      capabilityId: 'file.list',
      input: { path },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : result;
  }
);

server.registerTool(
  'file.delete',
  {
    description: 'Delete a file from the workspace.',
    inputSchema: {
      path: z.string().describe('File path to delete'),
    },
  },
  async ({ path }) => {
    logger.debug('file.delete requested', { path });
    const result = await executeCapability({
      capabilityId: 'file.delete',
      input: { path },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : { content: [{ type: 'text' as const, text: `Deleted ${path}` }] };
  }
);

server.registerTool(
  'file.search',
  {
    description: 'Search files by name pattern or content pattern.',
    inputSchema: {
      path: z.string().optional().default('.').describe('Directory to search in'),
      namePattern: z.string().optional().describe('Glob pattern for file names (e.g., "*.ts")'),
      contentPattern: z.string().optional().describe('Regex pattern to search within files'),
      maxResults: z.number().optional().default(20),
    },
  },
  async ({ path, namePattern, contentPattern, maxResults }) => {
    logger.debug('file.search requested', { path, namePattern, contentPattern });
    const result = await executeCapability({
      capabilityId: 'file.search',
      input: { path, namePattern, contentPattern, maxResults },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : result;
  }
);

// ============================================================================
// 2. SHELL EXECUTION (delegates to OpenCodeV2Provider / sandbox)
// ============================================================================

server.registerTool(
  'sandbox.shell',
  {
    description: 'Execute a shell command in the sandbox workspace. ' +
      'Use for installing packages, running scripts, compiling code, or any CLI operation. ' +
      'Commands run in an isolated sandbox with VFS sync.',
    inputSchema: {
      command: z.string().describe('The shell command to execute'),
      cwd: z.string().optional().describe('Working directory (default: workspace root)'),
      timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    },
  },
  async ({ command, cwd, timeout }) => {
    logger.debug('sandbox.shell requested', { command, cwd });
    const result = await executeCapability({
      capabilityId: 'sandbox.shell',
      input: { command, cwd, timeout },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : result;
  }
);

server.registerTool(
  'sandbox.execute',
  {
    description: 'Execute code in the sandbox. ' +
      'Use for running code snippets in a specific language (javascript, typescript, python, bash, rust, go).',
    inputSchema: {
      code: z.string().describe('Code to execute'),
      language: z.enum(['javascript', 'typescript', 'python', 'bash', 'rust', 'go']).default('javascript'),
      timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    },
  },
  async ({ code, language, timeout }) => {
    logger.debug('sandbox.execute requested', { language });
    const result = await executeCapability({
      capabilityId: 'sandbox.execute',
      input: { code, language, timeout },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : result;
  }
);

// ============================================================================
// 3. TERMINAL / PTY (delegates to TerminalProvider)
// ============================================================================

server.registerTool(
  'terminal.create_session',
  {
    description: 'Create a new interactive terminal session. ' +
      'Use for interactive tasks: running dev servers, navigating TUIs, monitoring long-running processes. ' +
      'Returns a session ID for subsequent send_input/get_output calls.',
    inputSchema: {
      cols: z.number().optional().default(120),
      rows: z.number().optional().default(30),
      cwd: z.string().optional().describe('Initial working directory'),
    },
  },
  async ({ cols, rows, cwd }) => {
    logger.debug('terminal.create_session requested', { cols, rows, cwd });
    const result = await executeCapability({
      capabilityId: 'terminal.create_session',
      input: { cols, rows, cwd },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

server.registerTool(
  'terminal.send_input',
  {
    description: 'Send keystrokes or input to an active terminal session. ' +
      'Use for interactive programs: answering prompts, navigating menus, sending Ctrl+C.',
    inputSchema: {
      sessionId: z.string().describe('Terminal session ID (from create_session)'),
      input: z.string().describe('Input to send (include \\n for Enter)'),
    },
  },
  async ({ sessionId, input }) => {
    logger.debug('terminal.send_input requested', { sessionId });
    const result = await executeCapability({
      capabilityId: 'terminal.send_input',
      input: { sessionId, input },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

server.registerTool(
  'terminal.get_output',
  {
    description: 'Read recent output from a terminal session. ' +
      'Can wait for a specific pattern to appear (e.g., "listening on port 3000").',
    inputSchema: {
      sessionId: z.string().describe('Terminal session ID'),
      lines: z.number().optional().default(100).describe('Number of recent lines to retrieve'),
      waitForPattern: z.string().optional().describe('Wait until this pattern appears in output'),
      timeoutMs: z.number().optional().default(30000).describe('Max wait time for pattern (ms)'),
    },
  },
  async ({ sessionId, lines, waitForPattern, timeoutMs }) => {
    logger.debug('terminal.get_output requested', { sessionId, lines, waitForPattern });
    const result = await executeCapability({
      capabilityId: 'terminal.get_output',
      input: { sessionId, lines, waitForPattern, timeoutMs },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

server.registerTool(
  'terminal.resize',
  {
    description: 'Resize a terminal session.',
    inputSchema: {
      sessionId: z.string().describe('Terminal session ID'),
      cols: z.number().describe('New width in columns'),
      rows: z.number().describe('New height in rows'),
    },
  },
  async ({ sessionId, cols, rows }) => {
    logger.debug('terminal.resize requested', { sessionId, cols, rows });
    const result = await executeCapability({
      capabilityId: 'terminal.resize',
      input: { sessionId, cols, rows },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

server.registerTool(
  'terminal.close_session',
  {
    description: 'Close/terminate an active terminal session.',
    inputSchema: {
      sessionId: z.string().describe('Terminal session ID to close'),
    },
  },
  async ({ sessionId }) => {
    logger.debug('terminal.close_session requested', { sessionId });
    const result = await executeCapability({
      capabilityId: 'terminal.close_session',
      input: { sessionId },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

server.registerTool(
  'terminal.list_sessions',
  {
    description: 'List all active terminal sessions.',
    inputSchema: z.object({}).passthrough().optional(),
  },
  async () => {
    logger.debug('terminal.list_sessions requested');
    const result = await executeCapability({
      capabilityId: 'terminal.list_sessions',
      input: {},
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

// ============================================================================
// 4. PROCESS MANAGEMENT (delegates to TerminalProvider / sandbox)
// ============================================================================

server.registerTool(
  'process.start',
  {
    description: 'Start a background process in the sandbox. ' +
      'Use for non-interactive long-running tasks: dev servers, build watchers, databases.',
    inputSchema: {
      command: z.string().describe('Command to execute'),
      cwd: z.string().optional().describe('Working directory'),
      env: z.record(z.string(), z.string()).optional().describe('Environment variables'),
      timeout: z.number().optional().default(60000).describe('Execution timeout in ms'),
    },
  },
  async ({ command, cwd, env, timeout }) => {
    logger.debug('process.start requested', { command });
    const result = await executeCapability({
      capabilityId: 'terminal.start_process',
      input: { command, cwd, env, timeout },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

server.registerTool(
  'process.stop',
  {
    description: 'Stop a running process by PID.',
    inputSchema: {
      pid: z.number().describe('Process ID to stop'),
      signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGINT']).optional().default('SIGTERM'),
    },
  },
  async ({ pid, signal }) => {
    logger.debug('process.stop requested', { pid, signal });
    const result = await executeCapability({
      capabilityId: 'terminal.stop_process',
      input: { pid, signal },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

server.registerTool(
  'process.list',
  {
    description: 'List running processes with PID, user, CPU, memory, and command.',
    inputSchema: {
      filter: z.string().optional().describe('Filter by process name'),
    },
  },
  async ({ filter }) => {
    logger.debug('process.list requested', { filter });
    const result = await executeCapability({
      capabilityId: 'terminal.list_processes',
      input: { filter },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

// ============================================================================
// 5. PORT STATUS (delegates to TerminalProvider)
// ============================================================================

server.registerTool(
  'port.status',
  {
    description: 'Check which ports are listening and what processes own them.',
    inputSchema: {
      port: z.number().optional().describe('Specific port to check (omit for all)'),
    },
  },
  async ({ port }) => {
    logger.debug('port.status requested', { port });
    const result = await executeCapability({
      capabilityId: 'terminal.get_port_status',
      input: { port },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

// ============================================================================
// 6. PROJECT ANALYSIS (delegates to project-analysis provider)
// ============================================================================

server.registerTool(
  'project.analyze',
  {
    description: 'Deep analysis of a project: detects framework, package manager, ' +
      'entry points, configuration files, dependencies, and generates recommended ' +
      'commands for install/run/test/build. Returns structured JSON.',
    inputSchema: {
      includeDependencies: z.boolean().optional().default(false)
        .describe('Include full dependency list'),
    },
  },
  async ({ includeDependencies }) => {
    logger.debug('project.analyze requested', { includeDependencies });
    const result = await executeCapability({
      capabilityId: 'project.analyze',
      input: { includeDependencies },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

server.registerTool(
  'project.list_scripts',
  {
    description: 'List all runnable scripts/tasks in the project. ' +
      'Includes npm scripts, Makefile targets, pyproject.toml tasks, deno tasks, ' +
      'cargo commands, go tasks, turbo and nx tasks.',
    inputSchema: z.object({}).passthrough().optional(),
  },
  async () => {
    logger.debug('project.list_scripts requested');
    const result = await executeCapability({
      capabilityId: 'project.list_scripts',
      input: {},
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

server.registerTool(
  'project.dependencies',
  {
    description: 'List installed dependencies and detect issues like missing packages, ' +
      'version conflicts, missing lock files.',
    inputSchema: z.object({}).passthrough().optional(),
  },
  async () => {
    logger.debug('project.dependencies requested');
    const result = await executeCapability({
      capabilityId: 'project.dependencies',
      input: {},
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

server.registerTool(
  'project.structure',
  {
    description: 'Get the file tree of the project with semantic understanding.',
    inputSchema: {
      maxDepth: z.number().optional().default(5),
      summaryOnly: z.boolean().optional().default(false)
        .describe('Return only text summary, not full tree'),
    },
  },
  async ({ maxDepth, summaryOnly }) => {
    logger.debug('project.structure requested', { maxDepth, summaryOnly });
    const result = await executeCapability({
      capabilityId: 'project.structure',
      input: { maxDepth, summaryOnly },
      userId: MCP_USER_ID,
    });
    return result.isError
      ? { content: result.content, isError: true }
      : formatSuccess((result as any).data || result);
  }
);

// ============================================================================
// 7. MULTI-AGENT TOOLS (existing registrations)
// ============================================================================

try {
  const { registerMultiAgentTools } = await import('./multi-agent-tools');
  registerMultiAgentTools(server);
  logger.info('Registered multi-agent tools');
} catch (error: any) {
  logger.warn('Multi-agent tools not available', error.message);
}

// ============================================================================
// Start Server
// ============================================================================

async function main() {
  logger.info('Starting binG MCP stdio server...', {
    userId: MCP_USER_ID,
    version: SERVER_VERSION,
  });

  // Log WebSocket health on startup
  await logWebSocketHealth();

  // Log WebSocket health periodically
  const healthInterval = setInterval(async () => {
    await logWebSocketHealth();
  }, 60 * 1000); // every 60 seconds
  healthInterval.unref(); // Don't prevent process exit

  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('binG MCP stdio server connected — waiting for client requests on stdin/stdout');

    // Log all registered tools
    const toolCount = (server as any).registeredTools?.size ?? 'unknown';
    logger.info('MCP server ready', { toolCount });

    // Keep process alive
    process.on('SIGINT', () => {
      logger.info('Shutting down MCP server (SIGINT)...');
      clearInterval(healthInterval);
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('Shutting down MCP server (SIGTERM)...');
      clearInterval(healthInterval);
      process.exit(0);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception in MCP stdio server', error.message);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection in MCP stdio server', String(reason));
    });
  } catch (error: any) {
    logger.error('Failed to start MCP stdio server', { error: error.message });
    process.exit(1);
  }
}

main();
