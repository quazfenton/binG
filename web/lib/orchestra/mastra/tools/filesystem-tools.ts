/**
 * Filesystem Tools for LLM Agent
 *
 * Provides structured tool definitions for LLM to interact with the virtual filesystem.
 * LLM can call these tools directly to read, write, list, search, and delete files.
 *
 * @see lib/virtual-filesystem/virtual-filesystem-service.ts
 */

import { checkCommandSecurity } from '@/lib/terminal/security/terminal-security';
import { bashToolExecutor } from '@/lib/tools/tool-integration/bash-tool';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';

export interface ToolCallResult {
  success: boolean;
  error?: string | Record<string, any>;
  [key: string]: any;
}

export interface FilesystemTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      required?: boolean;
    }>;
    required: string[];
  };
  execute: (args: Record<string, any>) => Promise<ToolCallResult>;
}

export interface FilesystemToolOptions {
  sandboxId?: string;
  sandboxProvider?: string;
  workspacePath?: string;
}

/**
 * Resolve a file path relative to the workspace path.
 * If the path already starts with the workspace path, use it as-is.
 * Otherwise, prepend the workspace path to make it session-scoped.
 */
function resolveWorkspacePath(workspacePath: string, path: string): string {
  if (!path) return workspacePath;
  const cleanPath = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
  // Already scoped
  if (cleanPath === workspacePath || cleanPath.startsWith(`${workspacePath}/`)) {
    return cleanPath;
  }
  return `${workspacePath}/${cleanPath}`;
}

/**
 * Filesystem tools for LLM agent
 * Factory function that creates tools bound to a specific user ID for tenant/session isolation
 */
export function createFilesystemTools(
  userId: string,
  options: FilesystemToolOptions = {},
): FilesystemTool[] {
  const workspacePath = options.workspacePath || 'project';
  const tools: FilesystemTool[] = [
    {
      name: 'read_file',
      description: 'Read the contents of a file from the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (e.g., "workspace/toDoApp/src/app.js")',
          },
        },
        required: ['path'],
      },
      execute: async ({ path }: { path: string }): Promise<ToolCallResult> => {
        try {
          if (!path || typeof path !== 'string' || !path.trim()) {
            return {
              success: false,
              error: {
                code: 'INVALID_ARGS',
                message: 'Missing required argument: path',
                retryable: true,
                expectedFields: ['path'],
                suggestedNextAction: 'Call read_file with a valid file path string.',
              },
            };
          }
          const scopedPath = resolveWorkspacePath(workspacePath, path);
          const file = await virtualFilesystem.readFile(userId, scopedPath);
          return {
            success: true,
            content: file.content,
            language: file.language,
            size: file.size,
            lastModified: file.lastModified,
          };
        } catch (error: any) {
          const msg = error.message || 'Failed to read file';
          const isNotFound = /not found|enoent|does not exist/i.test(msg);

          // On not-found, suggest listing the parent directory
          if (isNotFound) {
            const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) || '/' : '/';
            // Try to list siblings for suggestions
            let suggestedPaths: string[] = [];
            try {
              const listing = await virtualFilesystem.listDirectory(userId, resolveWorkspacePath(workspacePath, parentPath));
              suggestedPaths = (listing.nodes as any[]).slice(0, 10).map((f: any) => f.name || f.path || String(f));
            } catch { /* parent may not exist either */ }

            return {
              success: false,
              error: {
                code: 'PATH_NOT_FOUND',
                message: `File "${path}" does not exist.`,
                retryable: true,
                attemptedPath: path,
                parentPath,
                suggestedPaths,
                suggestedNextAction: suggestedPaths.length > 0
                  ? `Try one of these paths: ${suggestedPaths.join(', ')}`
                  : `Call list_directory("${parentPath}") to see what exists.`,
              },
            };
          }

          return {
            success: false,
            error: {
              code: 'READ_ERROR',
              message: msg,
              retryable: false,
              attemptedPath: path,
            },
          };
        }
      },
    },

    {
      name: 'write_file',
      description: 'Create or update a file in the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file',
          },
          content: {
            type: 'string',
            description: 'File content',
          },
          language: {
            type: 'string',
            description: 'Programming language (e.g., "javascript", "python")',
          },
        },
        required: ['path', 'content'],
      },
      execute: async ({ path, content, language }: { path: string; content: string; language?: string }): Promise<ToolCallResult> => {
        try {
          if (!path || typeof path !== 'string' || !path.trim()) {
            return {
              success: false,
              error: {
                code: 'INVALID_ARGS',
                message: 'Missing required argument: path',
                retryable: true,
                expectedFields: ['path', 'content'],
                suggestedNextAction: 'Call write_file with a valid file path and content.',
              },
            };
          }
          if (content === undefined || content === null) {
            return {
              success: false,
              error: {
                code: 'INVALID_ARGS',
                message: 'Missing required argument: content',
                retryable: true,
                expectedFields: ['path', 'content'],
                suggestedNextAction: 'Call write_file with both path and content arguments.',
              },
            };
          }
          const scopedPath = resolveWorkspacePath(workspacePath, path);
          const file = await virtualFilesystem.writeFile(userId, scopedPath, content, language);

          // CRITICAL FIX Bug #4: Emit filesystem-updated event after V2 file write
          // This ensures components update after V2 agent writes files via tools
          emitFilesystemUpdated({
            path: file.path,
            paths: [file.path],
            type: 'create',
            source: 'v2-tool',
          });

          return {
            success: true,
            path: file.path,
            size: file.size,
            language: file.language,
            message: `File written: ${file.path} (${file.size} bytes)`,
          };
        } catch (error: any) {
          const msg = error.message || 'Failed to write file';
          const isNotFound = /not found|enoent|does not exist|no such/i.test(msg);
          if (isNotFound) {
            const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) || '/' : '/';
            return {
              success: false,
              error: {
                code: 'PARENT_NOT_FOUND',
                message: `Cannot write "${path}" — parent directory may not exist.`,
                retryable: true,
                attemptedPath: path,
                parentPath,
                suggestedNextAction: `Call create_directory("${parentPath}") first, then retry write_file.`,
              },
            };
          }
          return {
            success: false,
            error: {
              code: 'WRITE_ERROR',
              message: msg,
              retryable: false,
              attemptedPath: path,
            },
          };
        }
      },
    },

    {
      name: 'list_directory',
      description: 'List contents of a directory',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path (e.g., "workspace/toDoApp")',
          },
        },
        required: ['path'],
      },
      execute: async ({ path }: { path: string }): Promise<ToolCallResult> => {
        try {
          if (!path || typeof path !== 'string') {
            return {
              success: false,
              error: {
                code: 'INVALID_ARGS',
                message: 'Missing required argument: path',
                retryable: true,
                expectedFields: ['path'],
                suggestedNextAction: 'Call list_directory with a valid directory path string.',
              },
            };
          }
          const scopedPath = resolveWorkspacePath(workspacePath, path);
          const listing = await virtualFilesystem.listDirectory(userId, scopedPath);
          return {
            success: true,
            entries: listing.nodes.map(e => ({
              name: e.name,
              type: e.type,
              path: e.path,
            })),
            count: listing.nodes.length,
          };
        } catch (error: any) {
          const msg = error.message || 'Failed to list directory';
          const isNotFound = /not found|enoent|does not exist|no such/i.test(msg);
          if (isNotFound) {
            return {
              success: false,
              error: {
                code: 'PATH_NOT_FOUND',
                message: `Directory "${path}" does not exist.`,
                retryable: true,
                attemptedPath: path,
                suggestedNextAction: `Try list_directory("/") or list_directory("src") to see what directories exist.`,
              },
            };
          }
          return {
            success: false,
            error: {
              code: 'LIST_ERROR',
              message: msg,
              retryable: false,
              attemptedPath: path,
            },
          };
        }
      },
    },

    {
      name: 'create_directory',
      description: 'Create a new directory (including parent directories if needed)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to create (e.g., "src/components")',
          },
        },
        required: ['path'],
      },
      execute: async ({ path }: { path: string }): Promise<ToolCallResult> => {
        try {
          // Scope the path to workspace
          const scopedPath = resolveWorkspacePath(workspacePath, path);
          // Create directory by writing a .keep file (VFS creates parent dirs automatically)
          const keepFilePath = `${scopedPath}/.keep`;
          await virtualFilesystem.writeFile(userId, keepFilePath, '');
          return {
            success: true,
            path: scopedPath,
            message: `Directory created: ${scopedPath}`,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to create directory',
          };
        }
      },
    },

    {
      name: 'delete_file',
      description: 'Delete a file or empty directory',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to delete',
          },
        },
        required: ['path'],
      },
      execute: async ({ path }: { path: string }): Promise<ToolCallResult> => {
        try {
          if (!path || typeof path !== 'string' || !path.trim()) {
            return {
              success: false,
              error: {
                code: 'INVALID_ARGS',
                message: 'Missing required argument: path',
                retryable: true,
                expectedFields: ['path'],
                suggestedNextAction: 'Call delete_file with a valid file path string.',
              },
            };
          }
          const scopedPath = resolveWorkspacePath(workspacePath, path);
          const result = await virtualFilesystem.deletePath(userId, scopedPath);
          return {
            success: true,
            path: scopedPath,
            deletedCount: result.deletedCount,
            message: `Deleted: ${scopedPath}`,
          };
        } catch (error: any) {
          const msg = error.message || 'Failed to delete';
          const isNotFound = /not found|enoent|does not exist|no such/i.test(msg);
          if (isNotFound) {
            return {
              success: false,
              error: {
                code: 'PATH_NOT_FOUND',
                message: `File "${path}" does not exist.`,
                retryable: true,
                attemptedPath: path,
                suggestedNextAction: `Call list_directory to find the correct path, then retry delete_file.`,
              },
            };
          }
          return {
            success: false,
            error: {
              code: 'DELETE_ERROR',
              message: msg,
              retryable: false,
              attemptedPath: path,
            },
          };
        }
      },
    },

    {
      name: 'search_files',
      description: 'Search for files matching a pattern (grep-like search in filenames and content)',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (filename pattern or content)',
          },
          path: {
            type: 'string',
            description: 'Base directory to search in (optional, searches entire workspace if not specified)',
          },
        },
        required: ['query'],
      },
      execute: async ({ query, path }: { query: string; path?: string }): Promise<ToolCallResult> => {
        try {
          const snapshot = await virtualFilesystem.exportWorkspace(userId);
          // Scope the base path if provided
          const scopedBasePath = path ? resolveWorkspacePath(workspacePath, path) : workspacePath;

          const results = snapshot.files.filter(f => {
            // Filter by base path if specified — use exact match or strict prefix with trailing slash
            // to prevent cross-scope leakage (e.g. "/001" matching "/0012")
            if (scopedBasePath && f.path !== scopedBasePath && !f.path.startsWith(`${scopedBasePath}/`)) {
              return false;
            }
            // Search in filename or content
            return f.path.includes(query) || f.content?.includes(query);
          });

          return {
            success: true,
            matches: results.map(r => ({
              path: r.path,
              language: r.language,
              size: r.size,
              // Include a snippet of content if it's a content match
              snippet: r.content?.includes(query)
                ? r.content.substring(Math.max(0, r.content.indexOf(query) - 20), r.content.indexOf(query) + query.length + 20)
                : undefined,
            })),
            total: results.length,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to search files',
          };
        }
      },
    },

    {
      name: 'file_exists',
      description: 'Check if a file or directory exists at the given path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to check',
          },
        },
        required: ['path'],
      },
      execute: async ({ path }: { path: string }): Promise<ToolCallResult> => {
        try {
          if (!path || typeof path !== 'string' || !path.trim()) {
            return {
              success: false,
              error: {
                code: 'INVALID_ARGS',
                message: 'Missing required argument: path',
                retryable: true,
                expectedFields: ['path'],
                suggestedNextAction: 'Call file_exists with a valid file path string.',
              },
            };
          }
          const scopedPath = resolveWorkspacePath(workspacePath, path);
          // Try to read as file first
          try {
            await virtualFilesystem.readFile(userId, scopedPath);
            return { success: true, exists: true, type: 'file', path: scopedPath };
          } catch (error: any) {
            if (!error.message?.includes('not found')) {
              throw error;  // Real error, not "not found"
            }
          }

          // File not found - check if it's a directory
          try {
            const listing = await virtualFilesystem.listDirectory(userId, scopedPath);
            return {
              success: true,
              exists: true,
              type: 'directory',
              path: scopedPath,
              entries: listing.nodes.length
            };
          } catch (error: any) {
            if (error.message?.includes('not found')) {
              return { success: true, exists: false, path: scopedPath };
            }
            throw error;
          }
        } catch (error: any) {
          const msg = error.message || 'Failed to check existence';
          return {
            success: false,
            error: {
              code: 'CHECK_ERROR',
              message: msg,
              retryable: false,
              attemptedPath: path,
            },
          };
        }
      },
    },

    {
      name: 'context_pack',
      description: 'Generate a dense, LLM-friendly bundle of directory structure and file contents. Similar to Repomix or Gitingest. Use this to get a comprehensive view of a project structure with file contents in a single response.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Root directory path to pack (default: "/")',
          },
          format: {
            type: 'string',
            description: 'Output format: markdown, xml, json, or plain (default: markdown)',
            // @ts-ignore - enum is supported by JSON Schema
            enum: ['markdown', 'xml', 'json', 'plain'],
          },
          includeContents: {
            type: 'boolean',
            description: 'Include file contents (default: true)',
          },
          includeTree: {
            type: 'boolean',
            description: 'Include directory tree visualization (default: true)',
          },
          maxFileSize: {
            type: 'number',
            description: 'Maximum file size in bytes to include (default: 102400)',
          },
          maxLinesPerFile: {
            type: 'number',
            description: 'Maximum lines per file before truncation (default: 500)',
          },
          excludePatterns: {
            type: 'array',
            // @ts-ignore - items is supported by JSON Schema
            items: { type: 'string' },
            description: 'Glob patterns to exclude (e.g., ["node_modules/**", "*.log"])',
          },
        },
        required: [],
      },
      execute: async (args: Record<string, any>): Promise<ToolCallResult> => {
        try {
          const { contextPackService } = await import('@/lib/virtual-filesystem/context-pack-service');
          
          const result = await contextPackService.generateContextPack(
            userId,
            args.path || '/',
            {
              format: args.format || 'markdown',
              includeContents: args.includeContents !== false,
              includeTree: args.includeTree !== false,
              maxFileSize: args.maxFileSize || 102400,
              maxLinesPerFile: args.maxLinesPerFile || 500,
              excludePatterns: args.excludePatterns,
            }
          );
          
          return {
            success: true,
            bundle: result.bundle,
            fileCount: result.fileCount,
            directoryCount: result.directoryCount,
            totalSize: result.totalSize,
            estimatedTokens: result.estimatedTokens,
            hasTruncation: result.hasTruncation,
            warnings: result.warnings,
            format: result.format,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to generate context pack',
          };
        }
      },
    },
  ];

  if (options.sandboxId) {
    tools.push({
      name: 'execute_bash',
      description: 'Execute a bash command in the sandboxed workspace. Use for installs, tests, builds, and other CLI operations.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Bash command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory inside the sandbox workspace',
          },
          timeout: {
            type: 'number',
            description: 'Optional timeout in milliseconds',
          },
        },
        required: ['command'],
      },
      execute: async ({ command, cwd, timeout }: { command: string; cwd?: string; timeout?: number }): Promise<ToolCallResult> => {
        try {
          const security = checkCommandSecurity(command);
          if (!security.allowed) {
            return {
              success: false,
              error: security.reason || 'Command blocked by sandbox security policy',
              blocked: true,
              severity: security.severity,
            };
          }

          const result = await bashToolExecutor.execute({
            userId,
            sandboxId: options.sandboxId,
            sandboxProvider: options.sandboxProvider as any,
            params: {
              command,
              cwd: cwd || options.workspacePath,
              timeout,
              enableHealing: true,
            },
          });

          return {
            success: result.success,
            output: result.output,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            duration: result.duration,
            attempts: result.attempts,
            fixesApplied: result.fixesApplied,
          };
        } catch (error: any) {
          const { formatToolError } = await import('@/lib/orchestra/shared-agent-context');
          return {
            success: false,
            error: formatToolError('execute_bash', error, { command }),
          };
        }
      },
    });
  }

  return tools;
}

/**
 * Get all filesystem tools (legacy - returns tools for anonymous user)
 * @deprecated Use createFilesystemTools(userId) instead for proper tenant isolation
 */
export function getFilesystemTools(): FilesystemTool[] {
  return createFilesystemTools('anonymous');
}

/**
 * Get a specific filesystem tool by name (legacy - returns tool for anonymous user)
 * @deprecated Use createFilesystemTools(userId) instead for proper tenant isolation
 */
export function getFilesystemTool(name: string): FilesystemTool | undefined {
  const tools = createFilesystemTools('anonymous');
  return tools.find(t => t.name === name);
}
