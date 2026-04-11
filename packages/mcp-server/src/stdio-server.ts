/**
 * binG MCP Server — stdio entry point
 *
 * Runs as a standalone process via `bing-mcp` CLI.
 * Connects to MCP clients (Claude Desktop, Cursor, etc.) via stdin/stdout.
 *
 * This server provides wired-up tools that interact with the local filesystem
 * and execute commands with proper error handling and path validation.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join, resolve, isAbsolute, normalize, sep } from 'path';
import { registerExtractedTools } from './tools/registry';

const execAsync = promisify(exec);

// ─── Configuration ───────────────────────────────────────────────

interface ServerConfig {
  /** Root workspace directory for file operations */
  workspaceRoot: string;
  /** Maximum command execution timeout in ms */
  maxCommandTimeout: number;
  /** Maximum file size for read operations (bytes) */
  maxReadFileSize: number;
  /** Enable command execution (disable for read-only mode) */
  enableCommandExecution: boolean;
}

const DEFAULT_WORKSPACE_ROOT = process.env.BING_WORKSPACE_ROOT || process.cwd();

// Safely parse numeric env vars — falls back to safe defaults when invalid (NaN, <= 0)
const parsePositiveInt = (envVal: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(envVal ?? String(fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_COMMAND_TIMEOUT = parsePositiveInt(process.env.BING_MAX_COMMAND_TIMEOUT, 30000);
const MAX_READ_FILE_SIZE = parsePositiveInt(process.env.BING_MAX_READ_FILE_SIZE, 1048576); // 1MB default
const ENABLE_COMMAND_EXECUTION = process.env.BING_ENABLE_COMMAND_EXECUTION !== 'false';

const config: ServerConfig = {
  workspaceRoot: resolve(DEFAULT_WORKSPACE_ROOT),
  maxCommandTimeout: MAX_COMMAND_TIMEOUT,
  maxReadFileSize: MAX_READ_FILE_SIZE,
  enableCommandExecution: ENABLE_COMMAND_EXECUTION,
};

// ─── Utilities ───────────────────────────────────────────────────

/**
 * Validate and resolve a file path to prevent directory traversal attacks.
 * Ensures the resolved path is within the workspace root.
 */
function validatePath(requestedPath: string): string {
  // Resolve the path (handles . and ..)
  const resolvedPath = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : join(config.workspaceRoot, requestedPath);

  // Normalize to consistent format
  const normalized = normalize(resolvedPath);
  const workspaceRoot = normalize(config.workspaceRoot);
  const workspacePrefix = workspaceRoot.endsWith(sep)
    ? workspaceRoot
    : `${workspaceRoot}${sep}`;

  // Check for directory traversal with boundary-safe prefix matching
  // Prevents prefix bypasses: /workspace-evil must NOT pass when workspace is /workspace
  if (normalized !== workspaceRoot && !normalized.startsWith(workspacePrefix)) {
    throw new Error(
      `Path traversal detected: "${requestedPath}" resolves outside workspace "${config.workspaceRoot}"`
    );
  }

  return normalized;
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    py: 'python',
    rb: 'ruby',
    java: 'java',
    go: 'go',
    rs: 'rust',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    txt: 'text',
  };
  return ext ? languageMap[ext] || 'text' : 'text';
}

// ─── Server setup ────────────────────────────────────────────────

const server = new McpServer({
  name: 'binG',
  version: '1.0.0',
});

// ─── File Operation Tools ────────────────────────────────────────

/**
 * read_file — Read file content from the workspace
 */
server.tool(
  'read_file',
  'Read files from sandbox workspace with size limits and path validation',
  {
    path: z.string().describe('File path (relative to workspace root)'),
  },
  async ({ path }) => {
    try {
      const validatedPath = validatePath(path);

      // Resolve the real path to prevent symlink escapes
      // e.g., a symlink inside the workspace pointing to /etc/passwd
      const realPath = normalize(await fs.realpath(validatedPath));
      const workspaceRoot = normalize(config.workspaceRoot);
      const workspacePrefix = workspaceRoot.endsWith(sep)
        ? workspaceRoot
        : `${workspaceRoot}${sep}`;

      // Re-check that the real path still stays inside the workspace root
      if (realPath !== workspaceRoot && !realPath.startsWith(workspacePrefix)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Path traversal detected: "${path}" resolves outside workspace`,
            },
          ],
          isError: true,
        };
      }

      // Check if file exists (use realPath to stat the actual target)
      const stat = await fs.stat(realPath);
      if (!stat.isFile()) {
        return {
          content: [{ type: 'text' as const, text: `Error: "${path}" is not a file` }],
          isError: true,
        };
      }

      // Check file size limit
      if (stat.size > config.maxReadFileSize) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: File too large (${formatFileSize(stat.size)}). Maximum allowed: ${formatFileSize(config.maxReadFileSize)}`,
            },
          ],
          isError: true,
        };
      }

      // Read file content from the resolved real path
      const content = await fs.readFile(realPath, 'utf-8');
      const language = detectLanguage(path);

      return {
        content: [
          {
            type: 'text' as const,
            text: content,
          },
        ],
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          content: [{ type: 'text' as const, text: `Error: File not found: ${path}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: `Error reading file: ${error.message}` }],
        isError: true,
      };
    }
  }
);

/**
 * write_file — Write content to a file in the workspace
 */
server.tool(
  'write_file',
  'Write files to sandbox workspace with automatic directory creation',
  {
    path: z.string().describe('File path (relative to workspace root)'),
    content: z.string().describe('File content'),
  },
  async ({ path, content }) => {
    try {
      const validatedPath = validatePath(path);

      // Resolve the real path to prevent symlink escapes
      // e.g., a symlink inside the workspace pointing outside the workspace
      const realPath = normalize(await fs.realpath(validatedPath));
      const workspaceRoot = normalize(config.workspaceRoot);
      const workspacePrefix = workspaceRoot.endsWith(sep)
        ? workspaceRoot
        : `${workspaceRoot}${sep}`;

      // Re-check that the real path still stays inside the workspace root
      if (realPath !== workspaceRoot && !realPath.startsWith(workspacePrefix)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Path traversal detected: "${path}" resolves outside workspace`,
            },
          ],
          isError: true,
        };
      }

      // Ensure parent directory exists
      const parentDir = realPath.substring(0, realPath.lastIndexOf(sep));
      if (parentDir) {
        await fs.mkdir(parentDir, { recursive: true });
      }

      // Write file to the resolved real path
      await fs.writeFile(realPath, content, 'utf-8');

      const language = detectLanguage(path);
      const size = Buffer.byteLength(content, 'utf-8');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully wrote ${path} (${formatFileSize(size)}, ${language})`,
          },
        ],
      };
    } catch (error: any) {
      if (error.code === 'EACCES') {
        return {
          content: [{ type: 'text' as const, text: `Error: Permission denied: ${path}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: `Error writing file: ${error.message}` }],
        isError: true,
      };
    }
  }
);

/**
 * list_directory — List directory contents with metadata
 */
server.tool(
  'list_directory',
  'List directory contents with file metadata (type, size)',
  {
    path: z.string().default('.').describe('Directory path (relative to workspace root)'),
  },
  async ({ path }) => {
    try {
      const validatedPath = validatePath(path);

      // Resolve the real path to prevent symlink escapes
      const realPath = normalize(await fs.realpath(validatedPath));
      const workspaceRoot = normalize(config.workspaceRoot);
      const workspacePrefix = workspaceRoot.endsWith(sep)
        ? workspaceRoot
        : `${workspaceRoot}${sep}`;

      // Re-check that the real path still stays inside the workspace root
      if (realPath !== workspaceRoot && !realPath.startsWith(workspacePrefix)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Path traversal detected: "${path}" resolves outside workspace`,
            },
          ],
          isError: true,
        };
      }

      // Check if path exists and is a directory
      const stat = await fs.stat(realPath);
      if (!stat.isDirectory()) {
        return {
          content: [{ type: 'text' as const, text: `Error: "${path}" is not a directory` }],
          isError: true,
        };
      }

      // Read directory
      const entries = await fs.readdir(realPath, { withFileTypes: true });

      // Get metadata for each entry
      const lines: string[] = [];
      for (const entry of entries) {
        // Skip hidden files/directories
        if (entry.name.startsWith('.')) continue;

        const entryPath = join(realPath, entry.name);
        try {
          const entryStat = await fs.stat(entryPath);
          const type = entry.isDirectory() ? 'dir' : 'file';
          const size = entry.isFile() ? formatFileSize(entryStat.size) : '-';
          const modified = entryStat.mtime.toISOString().split('T')[0];
          lines.push(`${type.padEnd(4)} ${size.padStart(8)} ${modified} ${entry.name}`);
        } catch {
          // Skip entries we can't stat
          lines.push(`     -        - ${entry.name}`);
        }
      }

      if (lines.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `Directory ${path} is empty or contains only hidden files` }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: lines.join('\n'),
          },
        ],
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          content: [{ type: 'text' as const, text: `Error: Directory not found: ${path}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: `Error listing directory: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ─── Command Execution Tool ──────────────────────────────────────

/**
 * execute_command — Execute shell commands with timeout and working directory
 */
server.tool(
  'execute_command',
  'Execute shell commands in workspace with timeout protection',
  {
    command: z.string().describe('Shell command to execute'),
    workingDir: z.string().optional().describe('Working directory (relative to workspace root)'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
  },
  async ({ command, workingDir, timeout }) => {
    // Check if command execution is enabled
    if (!config.enableCommandExecution) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Error: Command execution is disabled. Set BING_ENABLE_COMMAND_EXECUTION=true to enable.',
          },
        ],
        isError: true,
      };
    }

    try {
      // Validate working directory if provided
      let cwd = config.workspaceRoot;
      if (workingDir) {
        cwd = validatePath(workingDir);

        // Resolve the real path to prevent symlink escapes
        const realCwd = normalize(await fs.realpath(cwd));
        const workspaceRoot = normalize(config.workspaceRoot);
        const workspacePrefix = workspaceRoot.endsWith(sep)
          ? workspaceRoot
          : `${workspaceRoot}${sep}`;

        // Re-check that the real path still stays inside the workspace root
        if (realCwd !== workspaceRoot && !realCwd.startsWith(workspacePrefix)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Path traversal detected: "${workingDir}" resolves outside workspace`,
              },
            ],
            isError: true,
          };
        }
        cwd = realCwd;

        // Verify directory exists
        const stat = await fs.stat(cwd);
        if (!stat.isDirectory()) {
          return {
            content: [{ type: 'text' as const, text: `Error: "${workingDir}" is not a directory` }],
            isError: true,
          };
        }
      }

      // Clamp timeout to configured maximum
      const effectiveTimeout = Math.min(timeout || config.maxCommandTimeout, config.maxCommandTimeout);

      // Execute command
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: effectiveTimeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        killSignal: 'SIGTERM',
      });

      // Return output
      const output: string[] = [];
      if (stdout) output.push(stdout.trim());
      if (stderr) output.push(`stderr:\n${stderr.trim()}`);

      return {
        content: [
          {
            type: 'text' as const,
            text: output.join('\n\n') || '(command completed with no output)',
          },
        ],
      };
    } catch (error: any) {
      // Handle timeout errors
      if (error.killed || error.signal === 'SIGTERM') {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Command timed out after ${timeout || config.maxCommandTimeout}ms`,
            },
          ],
          isError: true,
        };
      }

      // Handle execution errors
      if (error.code !== undefined) {
        const output: string[] = [];
        if (error.stdout) output.push(error.stdout.trim());
        if (error.stderr) output.push(`stderr:\n${error.stderr.trim()}`);
        if (output.length === 0) output.push(`Exit code: ${error.code}`);

        return {
          content: [
            {
              type: 'text' as const,
              text: output.join('\n\n'),
            },
          ],
          isError: true,
        };
      }

      // Generic error
      return {
        content: [{ type: 'text' as const, text: `Command execution failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ─── Extracted Tools (Real Implementations) ──────────────────────
// Agent management, voice/TTS, and image generation tools with
// real implementations extracted from the binG web app.
registerExtractedTools(server);

// ─── Start server ────────────────────────────────────────────────

async function main() {
  // Log configuration
  console.error(`[binG MCP Server] Starting with configuration:`);
  console.error(`[binG MCP Server]   Workspace: ${config.workspaceRoot}`);
  console.error(`[binG MCP Server]   Max command timeout: ${config.maxCommandTimeout}ms`);
  console.error(`[binG MCP Server]   Max read file size: ${formatFileSize(config.maxReadFileSize)}`);
  console.error(`[binG MCP Server]   Command execution: ${config.enableCommandExecution ? 'enabled' : 'disabled'}`);

  // Verify workspace directory exists
  try {
    const stat = await fs.stat(config.workspaceRoot);
    if (!stat.isDirectory()) {
      console.error(`[binG MCP Server] Error: Workspace path is not a directory: ${config.workspaceRoot}`);
      process.exit(1);
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error(`[binG MCP Server] Error: Workspace directory does not exist: ${config.workspaceRoot}`);
      console.error(`[binG MCP Server] Create it or set BING_WORKSPACE_ROOT to an existing directory.`);
    } else {
      // Handle other filesystem errors (EACCES, etc.)
      console.error(`[binG MCP Server] Error: Cannot access workspace directory: ${error.message || error}`);
      console.error(`[binG MCP Server] Check permissions and ensure the path is accessible.`);
    }
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[binG MCP Server] Connected via stdio transport');
  console.error('[binG MCP Server] Ready to accept tool calls');
}

main().catch((err) => {
  console.error('[binG MCP Server] Fatal:', err);
  process.exit(1);
});

export { server, config };
