/**
 * VFS MCP Tools
 * 
 * Provides structured, schema-enforced MCP tools for filesystem operations.
 * This replaces fragile tag-parsing with structured tool calls that the LLM
 * must follow exactly - dramatically improving reliability.
 * 
 * These tools connect directly to the existing VirtualFilesystemService
 * and work identically in Desktop mode (via initializeDesktopMCP) and
 * Web mode (via the /api/mcp route).
 * 
 * Tools:
 * - write_file: Create or overwrite a file
 * - apply_diff: Apply a unified diff patch to a file
 * - read_file: Read file content
 * - list_files: List directory contents
 * - search_files: Search across files
 * - batch_write: Write multiple files at once
 * - delete_file: Delete a file
 * - create_directory: Create a directory
 */

import { z } from 'zod';
import { tool } from 'ai';
import { AsyncLocalStorage } from 'node:async_hooks';
import { virtualFilesystem } from '../virtual-filesystem/virtual-filesystem-service';
import { emitFileEvent, emitBatchFileEvents } from '../virtual-filesystem/file-events';
import { createLogger } from '../utils/logger';

const logger = createLogger('VFS-MCP-Tools');

/**
 * Tool execution context - user ID extracted from request
 */
export interface ToolContext {
  userId: string;
  sessionId?: string;
}

// Request-scoped context storage using AsyncLocalStorage.
// This is SAFE for concurrent requests — each async execution chain gets
// its own isolated context, preventing cross-user data leaks.
export const toolContextStore = new AsyncLocalStorage<ToolContext>();

/**
 * Set the tool execution context for the current async scope.
 * Unlike the old global mutable approach, this is request-scoped and
 * cannot be corrupted by concurrent requests.
 */
export function setToolContext(context: ToolContext): void {
  toolContextStore.enterWith(context);
}

/**
 * Get the current tool execution context.
 * Returns the request-scoped context or a safe fallback.
 */
function getToolContext(): ToolContext {
  return toolContextStore.getStore() || {
    userId: 'default',
    sessionId: undefined,
  };
}

/**
 * Initialize VFS tools with user context
 * Called from getAllTools to pass user context to VFS tools.
 * Uses AsyncLocalStorage for request-scoped isolation.
 */
export function initializeVFSTools(userId: string, sessionId?: string): void {
  setToolContext({ userId, sessionId });
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * write_file - Create or overwrite a file in the VFS
 * Use for new files or complete rewrites
 */
export const writeFileTool = tool({
  description: 'Create a new file or completely overwrite an existing file in the Virtual File System. Use this when the entire content is known or for new files.',
  parameters: z.object({
    path: z.string().describe('Full virtual path, e.g. "/src/components/Button.tsx" or "/app/page.tsx"'),
    content: z.string().describe('Complete file content as a string'),
    commitMessage: z.string().optional().describe('Optional description of the change for history/memory'),
  }),
  execute: async ({ path, content, commitMessage = 'Write file via MCP tool' }) => {
    try {
      const context = getToolContext();
      logger.debug('writeFile', { path, contentLength: content.length, userId: context.userId });
      
      // Check if file exists for event type
      let existed = false;
      try {
        await virtualFilesystem.readFile(context.userId, path);
        existed = true;
      } catch {
        // File doesn't exist, this is a create
      }

      const result = await virtualFilesystem.writeFile(
        context.userId,
        path,
        content,
        undefined, // language - auto-detected
        { failIfExists: false } // allow overwrite
      );

      // Emit file event for UI updates and session tracking
      await emitFileEvent({
        userId: context.userId,
        sessionId: context.sessionId,
        path,
        type: existed ? 'update' : 'create',
        content,
        source: 'mcp-tool',
      });

      return {
        success: true,
        path: result.path,
        size: content.length,
        message: result.message || `File written successfully`,
        version: result.version,
      };
    } catch (error: any) {
      logger.error('writeFile failed', { path, error: error.message });
      return {
        success: false,
        path,
        error: error.message,
      };
    }
  },
});

/**
 * apply_diff - Apply a unified diff patch to an existing file
 * Preferred for targeted edits - much more reliable than full rewrite
 */
export const applyDiffTool = tool({
  description: 'Apply a unified diff patch to an existing file. Preferred for targeted edits to avoid overwriting unrelated code. Use standard git diff format (--- +++ @@ ...).',
  parameters: z.object({
    path: z.string().describe('Target file path'),
    diff: z.string().describe('Unified diff format (--- +++ @@ lines ...). Use standard git diff style.'),
    commitMessage: z.string().optional().describe('Optional description of the change'),
  }),
  execute: async ({ path, diff, commitMessage = 'Applied diff via MCP tool' }) => {
    try {
      const context = getToolContext();
      logger.debug('applyDiff', { path, diffLength: diff.length, userId: context.userId });
      
      // First, read the current file to apply the diff
      const currentFile = await virtualFilesystem.readFile(context.userId, path);
      
      // Parse and apply the unified diff using existing file-diff-utils
      const { applyDiffToContent } = await import('../chat/file-diff-utils');
      const newContent = applyDiffToContent(currentFile.content, path, diff);
      
      if (newContent === null) {
        throw new Error('Failed to apply diff - the diff may not match the current file content');
      }
      
      // Write the modified content back (file exists, so allow overwrite)
      const result = await virtualFilesystem.writeFile(
        context.userId,
        path,
        newContent,
        currentFile.language,
        { failIfExists: false }
      );

      // Emit diff event for enhanced-diff-viewer
      await emitFileEvent({
        userId: context.userId,
        sessionId: context.sessionId,
        path,
        type: 'update',
        content: newContent,
        previousContent: currentFile.content,
        source: 'mcp-tool-diff',
        metadata: { diff },
      });

      return {
        success: true,
        path: result.path,
        message: 'Diff applied successfully',
        version: result.version,
      };
    } catch (error: any) {
      logger.error('applyDiff failed', { path, error: error.message });
      return {
        success: false,
        path,
        error: error.message,
      };
    }
  },
});

/**
 * read_file - Read the current content of a file
 * Critical for the agent to see what exists before editing
 */
export const readFileTool = tool({
  description: 'Read the full content of a file from the Virtual File System. Essential for viewing existing code before making edits.',
  parameters: z.object({
    path: z.string().describe('Full path to the file'),
  }),
  execute: async ({ path }) => {
    try {
      const context = getToolContext();
      logger.debug('readFile', { path, userId: context.userId });
      
      const file = await virtualFilesystem.readFile(context.userId, path);
      
      return {
        success: true,
        path: file.path,
        content: file.content,
        language: file.language,
        size: file.size,
        lastModified: file.lastModified,
        exists: true,
      };
    } catch (error: any) {
      logger.error('readFile failed', { path, error: error.message });
      return {
        success: false,
        path,
        error: error.message,
        exists: false,
      };
    }
  },
});

/**
 * list_files - List files and directories in the VFS
 * Use for navigation and exploration
 */
export const listFilesTool = tool({
  description: 'List files and directories in the Virtual File System. Use to explore project structure and find files.',
  parameters: z.object({
    path: z.string().default('/').describe('Directory path to list (default: root)'),
    recursive: z.boolean().optional().default(false).describe('Whether to list recursively'),
  }),
  execute: async ({ path, recursive = false }) => {
    try {
      const context = getToolContext();
      logger.debug('listFiles', { path, recursive, userId: context.userId });
      
      const listing = await virtualFilesystem.listDirectory(context.userId, path);
      
      return {
        success: true,
        path: listing.path,
        nodes: listing.nodes.map(node => ({
          type: node.type,
          name: node.name,
          path: node.path,
          language: node.language,
          size: node.size,
          lastModified: node.lastModified,
        })),
        count: listing.nodes.length,
      };
    } catch (error: any) {
      logger.error('listFiles failed', { path, error: error.message });
      return {
        success: false,
        path,
        error: error.message,
        nodes: [],
      };
    }
  },
});

/**
 * search_files - Search across the VFS
 * Helps the agent find where to make changes
 */
export const searchFilesTool = tool({
  description: 'Search across the Virtual File System for files containing specific text. Returns matching files and code snippets.',
  parameters: z.object({
    query: z.string().describe('Search term or natural language description'),
    path: z.string().optional().describe('Optional path to search within'),
    limit: z.number().optional().default(10).describe('Maximum number of results'),
  }),
  execute: async ({ query, path, limit = 10 }) => {
    try {
      const context = getToolContext();
      logger.debug('searchFiles', { query, path, limit, userId: context.userId });
      
      const results = await virtualFilesystem.search(
        context.userId,
        query,
        { path, limit }
      );

      return {
        success: true,
        query,
        files: results.files.map(file => ({
          path: file.path,
          name: file.name,
          language: file.language,
          score: file.score,
          snippet: file.snippet,
          lastModified: file.lastModified,
        })),
        total: results.files.length,
      };
    } catch (error: any) {
      logger.error('searchFiles failed', { query, error: error.message });
      return {
        success: false,
        query,
        error: error.message,
        files: [],
      };
    }
  },
});

/**
 * batch_write - Write multiple files in one operation
 * Efficient for creating several related files at once
 */
export const batchWriteTool = tool({
  description: 'Write multiple files in one operation. Efficient for creating several related files at once (e.g., component files, config files).',
  parameters: z.object({
    files: z.array(z.object({
      path: z.string().describe('File path'),
      content: z.string().describe('File content'),
    })).max(50, 'Cannot write more than 50 files in a single batch').describe('Array of {path, content} objects'),
    commitMessage: z.string().optional().describe('Optional description for all files'),
  }),
  execute: async ({ files, commitMessage = 'Batch write via MCP tool' }) => {
    try {
      const context = getToolContext();
      logger.debug('batchWrite', { fileCount: files.length, userId: context.userId });
      
      // Track file existence for event type determination
      const fileStates = await Promise.all(
        files.map(async (file) => {
          try {
            await virtualFilesystem.readFile(context.userId, file.path);
            return { path: file.path, existed: true };
          } catch {
            return { path: file.path, existed: false };
          }
        })
      );

      const results = await Promise.all(
        files.map(async (file) => {
          try {
            const result = await virtualFilesystem.writeFile(
              context.userId,
              file.path,
              file.content,
              undefined,
              { failIfExists: false }
            );
            return { path: file.path, success: true, version: result.version };
          } catch (error: any) {
            return { path: file.path, success: false, error: error.message };
          }
        })
      );

      // Emit batch file events
      const filesWithContent = files.map(f => {
        const state = fileStates.find(s => s.path === f.path);
        return {
          path: f.path,
          type: (state?.existed ? 'update' : 'create') as 'create' | 'update',
          content: f.content,
        };
      });

      await emitBatchFileEvents({
        userId: context.userId,
        sessionId: context.sessionId,
        files: filesWithContent,
        source: 'mcp-tool',
      });

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      return {
        success: failCount === 0,
        results,
        total: files.length,
        successCount,
        failCount,
        message: `Wrote ${successCount} of ${files.length} files`,
      };
    } catch (error: any) {
      logger.error('batchWrite failed', { error: error.message });
      return {
        success: false,
        error: error.message,
        results: [],
      };
    }
  },
});

/**
 * delete_file - Delete a file or directory from the VFS
 */
export const deleteFileTool = tool({
  description: 'Delete a file or directory from the Virtual File System. Use with caution - this operation cannot be undone.',
  parameters: z.object({
    path: z.string().describe('Path to delete'),
    reason: z.string().optional().describe('Reason for deletion'),
  }),
  execute: async ({ path, reason }) => {
    try {
      const context = getToolContext();
      logger.debug('deleteFile', { path, reason, userId: context.userId });
      
      const result = await virtualFilesystem.deletePath(context.userId, path);

      // Emit delete event
      await emitFileEvent({
        userId: context.userId,
        sessionId: context.sessionId,
        path,
        type: 'delete',
        source: 'mcp-tool',
      });

      return {
        success: true,
        path,
        deletedCount: result.deletedCount,
        message: `Deleted: ${reason || 'MCP tool request'}`,
      };
    } catch (error: any) {
      logger.error('deleteFile failed', { path, error: error.message });
      return {
        success: false,
        path,
        error: error.message,
      };
    }
  },
});

/**
 * create_directory - Create a directory in the VFS
 */
export const createDirectoryTool = tool({
  description: 'Create a directory in the Virtual File System. Creates parent directories as needed.',
  parameters: z.object({
    path: z.string().describe('Directory path to create'),
  }),
  execute: async ({ path }) => {
    try {
      const context = getToolContext();
      logger.debug('createDirectory', { path, userId: context.userId });
      
      const result = await virtualFilesystem.createDirectory(context.userId, path);

      // Emit create event for directory (type: 'create' for consistency)
      await emitFileEvent({
        userId: context.userId,
        sessionId: context.sessionId,
        path,
        type: 'create',
        source: 'mcp-tool-directory',
      });

      return {
        success: true,
        path: result.path,
        createdAt: result.createdAt,
        message: `Directory created: ${path}`,
      };
    } catch (error: any) {
      logger.error('createDirectory failed', { path, error: error.message });
      return {
        success: false,
        path,
        error: error.message,
      };
    }
  },
});

/**
 * get_workspace_stats - Get workspace statistics
 * Useful for understanding workspace usage and limits
 */
export const getWorkspaceStatsTool = tool({
  description: 'Get statistics about the Virtual File System workspace, including total size, file count, and quota usage.',
  parameters: z.object({}),
  execute: async () => {
    try {
      const context = getToolContext();
      logger.debug('getWorkspaceStats', { userId: context.userId });
      
      const stats = await virtualFilesystem.getWorkspaceStats(context.userId);

      return {
        success: true,
        ...stats,
      };
    } catch (error: any) {
      logger.error('getWorkspaceStats failed', { error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

// ============================================================================
// Export all tools as a single object (for MCP server registration)
// ============================================================================

/**
 * All VFS MCP tools grouped together
 * Can be registered with MCP server or used directly with AI SDK
 */
export const vfsTools = {
  write_file: writeFileTool,
  apply_diff: applyDiffTool,
  read_file: readFileTool,
  list_files: listFilesTool,
  search_files: searchFilesTool,
  batch_write: batchWriteTool,
  delete_file: deleteFileTool,
  create_directory: createDirectoryTool,
  get_workspace_stats: getWorkspaceStatsTool,
};

/**
 * Get tool definitions in OpenAI format for tool registry
 */
export function getVFSToolDefinitions() {
  return Object.values(vfsTools).map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Get VFS tool by name
 */
export function getVFSTool(name: string) {
  return vfsTools[name as keyof typeof vfsTools];
}