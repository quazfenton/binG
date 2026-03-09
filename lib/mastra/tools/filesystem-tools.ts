/**
 * Filesystem Tools for LLM Agent
 *
 * Provides structured tool definitions for LLM to interact with the virtual filesystem.
 * LLM can call these tools directly to read, write, list, search, and delete files.
 *
 * @see lib/virtual-filesystem/virtual-filesystem-service.ts
 */

import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

export interface ToolCallResult {
  success: boolean;
  error?: string;
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

/**
 * Filesystem tools for LLM agent
 * Factory function that creates tools bound to a specific user ID for tenant/session isolation
 */
export function createFilesystemTools(userId: string): FilesystemTool[] {
  return [
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
          const file = await virtualFilesystem.readFile(userId, path);
          return {
            success: true,
            content: file.content,
            language: file.language,
            size: file.size,
            lastModified: file.lastModified,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to read file',
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
          const file = await virtualFilesystem.writeFile(userId, path, content, language);
          return {
            success: true,
            path: file.path,
            size: file.size,
            language: file.language,
            message: `File written: ${file.path} (${file.size} bytes)`,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to write file',
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
          const listing = await virtualFilesystem.listDirectory(userId, path);
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
          return {
            success: false,
            error: error.message || 'Failed to list directory',
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

          const results = snapshot.files.filter(f => {
            // Filter by base path if specified
            if (path && !f.path.startsWith(path)) {
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
      name: 'delete_file',
      description: 'Delete a file from the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to delete',
          },
        },
        required: ['path'],
      },
      execute: async ({ path }: { path: string }): Promise<ToolCallResult> => {
        try {
          await virtualFilesystem.deletePath(userId, path);
          return {
            success: true,
            message: `Deleted: ${path}`,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to delete file',
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
          // Try to read as file first
          try {
            await virtualFilesystem.readFile(userId, path);
            return { success: true, exists: true, type: 'file' };
          } catch (error: any) {
            if (!error.message?.includes('not found')) {
              throw error;  // Real error, not "not found"
            }
          }

          // File not found - check if it's a directory
          try {
            const listing = await virtualFilesystem.listDirectory(userId, path);
            return {
              success: true,
              exists: true,
              type: 'directory',
              entries: listing.nodes.length
            };
          } catch (error: any) {
            if (error.message?.includes('not found')) {
              return { success: true, exists: false };
            }
            throw error;
          }
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to check existence',
          };
        }
      },
    },
  ];
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
