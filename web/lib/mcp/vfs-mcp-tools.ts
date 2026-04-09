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
 * Parse files argument for batch_write tool.
 * Handles various formats the LLM might send:
 * - Direct array: [{path, content}, ...]
 * - JSON string: '[{"path":..., "content":...}, ...]'
 * - files= format: 'files=[{path, content}, ...]'
 * - files: format: 'files:[{path, content}, ...]'
 * 
 * @param files - The files argument from LLM (may be array or string)
 * @returns Parsed array of {path, content} objects, or null if unparseable
 */
export function parseBatchWriteFiles(files: unknown): Array<{ path: string; content: string }> | null {
  // If already an array, validate and filter invalid entries
  if (Array.isArray(files)) {
    const valid = files.filter(item => item && typeof item === 'object' && !Array.isArray(item));
    return valid.length > 0 ? valid : (files.length === 0 ? [] : null);
  }

  // If not a string, can't parse
  if (typeof files !== 'string') {
    return null;
  }

  const trimmed = files.trim();

  // Empty or whitespace-only check
  if (!trimmed) {
    return null;
  }

  /** Sanitize raw control characters within JSON string values (LLMs often emit unescaped newlines). */
  function sanitizeJsonString(text: string): string {
    let result = ''; let inString = false; let escapeNext = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escapeNext) { result += ch; escapeNext = false; continue; }
      if (ch === '\\' && inString) { result += ch; escapeNext = true; continue; }
      if (ch === '"') { inString = !inString; result += ch; continue; }
      if (inString) {
        if (ch === '\n') result += '\\n';
        else if (ch === '\r') result += '\\r';
        else if (ch === '\t') result += '\\t';
        else if (ch === '\b') result += '\\b';
        else if (ch === '\f') result += '\\f';
        else result += ch;
      } else result += ch;
    }
    return result;
  }

  /** Try to parse JSON with fallbacks for trailing commas, single quotes, and raw control chars. */
  function tryParseJson(text: string, sanitize = false): unknown {
    try { return JSON.parse(text); } catch {}
    try { return JSON.parse(text.replace(/,\s*([}\]])/g, '$1')); } catch {}
    // LLMs often output single-quoted JSON — normalize to double quotes
    try { return JSON.parse(text.replace(/'/g, '"')); } catch {}
    if (sanitize) {
      try { return JSON.parse(sanitizeJsonString(text)); } catch {}
      try { return JSON.parse(sanitizeJsonString(text.replace(/,\s*([}\]])/g, '$1'))); } catch {}
      try { return JSON.parse(sanitizeJsonString(text.replace(/'/g, '"'))); } catch {}
    }
    return undefined;
  }

  function parseAndValidate(text: string) {
    const parsed = tryParseJson(text, true);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter(item => item && typeof item === 'object' && !Array.isArray(item));
      return valid.length > 0 ? valid : (parsed.length === 0 ? [] : null);
    }
    if (parsed && typeof parsed === 'object' && 'files' in parsed) {
      const extracted = (parsed as any).files;
      if (Array.isArray(extracted)) {
        const valid = extracted.filter(item => item && typeof item === 'object' && !Array.isArray(item));
        return valid.length > 0 ? valid : (extracted.length === 0 ? [] : null);
      }
    }
    return null;
  }

  let result = parseAndValidate(files);
  if (result) return result;

  // Format: object with files property
  try {
    const objMatch = trimmed.match(/\{[\s\S]*"files"[\s\S]*\}/i);
    if (objMatch) { result = parseAndValidate(objMatch[0]); if (result) return result; }
  } catch {}

  // Format: starts with [...]
  if (trimmed.startsWith('[')) {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (match) { result = parseAndValidate(match[0]); if (result) return result; }
  }

  // Format: files=... or files:... or filesArray=...
  for (const pattern of [
    /(?:files(?:Array)?|args|data|input|items)\s*[:=]\s*(\[[\s\S]*\])/i,
    /"(?:files|args|data|input|items)"\s*:\s*(\[[\s\S]*\])/i,
  ]) {
    const match = trimmed.match(pattern);
    if (match?.[1]) { result = parseAndValidate(match[1]); if (result) return result; }
  }

  // Last resort: any JSON array
  const anyArrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (anyArrayMatch) return parseAndValidate(anyArrayMatch[0]);

  return null;
}

/**
 * Tool execution context - user ID and scope path extracted from request
 */
export interface ToolContext {
  userId: string;
  sessionId?: string;
  scopePath: string;  // VFS scope path relative to workspace root (e.g., "project/sessions/001")
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
 * FALLBACK: Uses "project" as the default scope if none is set.
 */
function getToolContext(): ToolContext {
  const ctx = toolContextStore.getStore();
  if (ctx) return ctx;
  // Safe fallback — should only happen if tools are called outside
  // of a toolContextStore.run() wrapper (which indicates a caller bug).
  return {
    userId: 'default',
    sessionId: undefined,
    scopePath: 'project',
  };
}

/**
 * Resolve a file path relative to the session scope.
 *
 * The scopePath is always a VFS-relative path (e.g., "project/sessions/001"),
 * never an absolute filesystem path. The VFS layer handles mapping to actual
 * filesystem locations for both web and desktop modes.
 *
 * If the path is absolute (starts with /), strips the leading slash.
 * If the path is relative, prepends the scopePath.
 *
 * Examples:
 * - scopePath="project/sessions/001", path="src/app.ts" → "project/sessions/001/src/app.ts"
 * - scopePath="project/sessions/001", path="/src/app.ts" → "project/sessions/001/src/app.ts"
 * - scopePath="project", path="src/app.ts" → "project/src/app.ts"
 */
function resolveScopedPath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Path is required');
  }

  // Strip leading slash if present and normalize backslashes
  let cleanPath = inputPath.startsWith('/') ? inputPath.substring(1) : inputPath;
  cleanPath = cleanPath.replace(/\\/g, '/');  // Handle Windows paths
  cleanPath = cleanPath.replace(/\/+/g, '/'); // Collapse double slashes
  cleanPath = cleanPath.replace(/\/+$/, '');  // Strip trailing slashes

  // Reject path traversal attempts in the path itself
  const segments = cleanPath.split('/');
  if (segments.some(seg => seg === '..')) {
    logger.warn('Path traversal attempt detected in file path', { originalPath: inputPath, cleanPath });
    throw new Error('Path cannot contain directory traversal (..)');
  }

  // Reject empty paths
  if (!cleanPath || cleanPath.trim() === '') {
    throw new Error('Path cannot be empty');
  }

  const context = getToolContext();
  const scopePath = context.scopePath || 'project';  // Ensure scopePath is always defined

  // SECURITY: Validate scopePath itself doesn't contain traversal attempts
  if (scopePath.includes('..')) {
    logger.error('Invalid scopePath contains traversal', { scopePath });
    throw new Error('Invalid scope path configuration');
  }

  // If path already starts with the scope + "/" or equals the scope exactly, use as-is
  // This prevents "project/sessions/001" from matching "project/sessions/001-extended"
  if (cleanPath === scopePath || cleanPath.startsWith(`${scopePath}/`)) {
    return cleanPath;
  }

  // SECURITY: If path starts with "project/" but NOT our scopePath, log warning
  // This catches attempts to escape session scope (e.g., writing to project/shared when scoped to project/sessions/001)
  if (cleanPath.startsWith('project/')) {
    logger.warn('Path outside session scope - will be written to workspace root instead of session', {
  originalPath: inputPath,
  cleanPath,
  scopePath,
    });
    // Still allow it for now (could be intentional for shared files), but log for visibility
    return cleanPath;
  }

  // Prepend scope path to make it session-scoped
  return `${scopePath}/${cleanPath}`;
}

/**
 * Initialize VFS tools with user context and scope path.
 * Called from getAllTools to pass user context to VFS tools.
 * Uses AsyncLocalStorage for request-scoped isolation.
 * 
 * @param userId - The user/owner ID
 * @param sessionId - Optional session ID
 * @param scopePath - The VFS scope path relative to workspace root (e.g., "project/sessions/001")
 */
export function initializeVFSTools(userId: string, sessionId?: string, scopePath?: string): void {
  setToolContext({
    userId,
    sessionId,
    scopePath: scopePath || 'project',  // Default to workspace root if not provided
  });
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * write_file - Create or overwrite a file in the VFS
 * Use for new files or complete rewrites
 */
export const writeFileTool = (tool as any)({
  description: 'Create a new file or completely overwrite an existing file in the Virtual File System. Use this when the entire content is known or for new files.',
  parameters: z.object({
    path: z.string().describe('Full virtual path, e.g. "/src/components/Button.tsx" or "/app/page.tsx"'),
    content: z.string().describe('Complete file content as a string'),
    commitMessage: z.string().optional().describe('Optional description of the change for history/memory'),
  }),
  execute: async ({ path, content, commitMessage = 'Write file via MCP tool' }) => {
    try {
  if (!path || typeof path !== 'string') {
    return { success: false, path, error: 'Path is required' };
  }
  if (content === undefined || content === null) {
    return { success: false, path, error: 'Content is required' };
  }
  // Guard against extremely large content that could cause memory issues
  const MAX_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB
  if (content.length > MAX_CONTENT_SIZE) {
    return {
  success: false,
  path,
  error: `Content too large (${(content.length / 1024 / 1024).toFixed(1)}MB). Maximum is ${(MAX_CONTENT_SIZE / 1024 / 1024).toFixed(0)}MB.`,
    };
  }
  const context = getToolContext();

  // Validate context — if userId is 'default', the tool context wasn't set properly
  if (context.userId === 'default') {
    logger.warn('writeFile: tool context not set — ensure toolContextStore.run() is used', {
  path,
  contentLength: content.length,
    });
  }
  
  // Resolve path relative to session scope
  const scopedPath = resolveScopedPath(path);
  logger.debug('writeFile', { originalPath: path, scopedPath, contentLength: content.length, userId: context.userId });

  // Check if file exists for event type
  let existed = false;
  try {
    await virtualFilesystem.readFile(context.userId, scopedPath);
    existed = true;
  } catch {
    // File doesn't exist, this is a create
  }

  const result = await virtualFilesystem.writeFile(
    context.userId,
    scopedPath,
    content,
    undefined, // language - auto-detected
    { failIfExists: false }, // allow overwrite
    context.sessionId // pass sessionId for GitBackedVFS
  );

  // Emit file event for UI updates and session tracking
  await emitFileEvent({
    userId: context.userId,
    sessionId: context.sessionId,
    path: scopedPath,
    type: existed ? 'update' : 'create',
    content,
    source: 'mcp-tool',
  });

  return {
    success: true,
    path: (result as any).path || path,
    size: content.length,
    message: (result as any).message || `File written successfully`,
    version: (result as any).version ?? 1,
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
export const applyDiffTool = (tool as any)({
  description: 'Apply a unified diff patch to an existing file. Preferred for targeted edits to avoid overwriting unrelated code. Use standard git diff format (--- +++ @@ ...).',
  parameters: z.object({
    path: z.string().describe('Target file path'),
    diff: z.string().describe('Unified diff format (--- +++ @@ lines ...). Use standard git diff style.'),
    commitMessage: z.string().optional().describe('Optional description of the change'),
  }),
  execute: async ({ path, diff, commitMessage = 'Applied diff via MCP tool' }) => {
    try {
  if (!path || typeof path !== 'string') {
    return { success: false, path, error: 'Path is required' };
  }
  if (!diff || typeof diff !== 'string') {
    return { success: false, path, error: 'Diff content is required' };
  }
  const context = getToolContext();
  const scopedPath = resolveScopedPath(path);
  logger.debug('applyDiff', { originalPath: path, scopedPath, diffLength: diff.length, userId: context.userId });

  // First, read the current file to apply the diff
  const currentFile = await virtualFilesystem.readFile(context.userId, scopedPath);
  
  // Parse and apply the unified diff using existing file-diff-utils
  const { applyDiffToContent } = await import('../chat/file-diff-utils');
  const newContent = applyDiffToContent(currentFile.content, path, diff);
  
  if (newContent === null) {
    throw new Error('Failed to apply diff - the diff may not match the current file content');
  }
  
  // Write the modified content back (file exists, so allow overwrite)
  const result = await virtualFilesystem.writeFile(
    context.userId,
    scopedPath,
    newContent,
    currentFile.language,
    { failIfExists: false }
  );

  // Emit diff event for enhanced-diff-viewer
  await emitFileEvent({
    userId: context.userId,
    sessionId: context.sessionId,
    path: scopedPath,
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
export const readFileTool = (tool as any)({
  description: 'Read the full content of a file from the Virtual File System. Essential for viewing existing code before making edits.',
  parameters: z.object({
    path: z.string().describe('Full path to the file'),
  }),
  execute: async ({ path }) => {
    try {
  if (!path || typeof path !== 'string') {
    return { success: false, path, error: 'Path is required', exists: false };
  }
  const context = getToolContext();
  const scopedPath = resolveScopedPath(path);
  logger.debug('readFile', { originalPath: path, scopedPath, userId: context.userId });

  const file = await virtualFilesystem.readFile(context.userId, scopedPath);
  const f = file as any;

  return {
    success: true,
    path: f.path,
    content: f.content,
    language: f.language,
    size: f.size,
    lastModified: f.lastModified,
    version: f.version ?? 1,
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
export const listFilesTool = (tool as any)({
  description: 'List files and directories in the Virtual File System. Use to explore project structure and find files.',
  parameters: z.object({
    path: z.string().default('/').describe('Directory path to list (default: root)'),
    recursive: z.boolean().optional().default(false).describe('Whether to list recursively'),
  }),
  execute: async ({ path, recursive = false }) => {
    try {
  const context = getToolContext();
  const scopedPath = resolveScopedPath(path);
  logger.debug('listFiles', { originalPath: path, scopedPath, recursive, userId: context.userId });

  const listing = await virtualFilesystem.listDirectory(context.userId, scopedPath);
  
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
export const searchFilesTool = (tool as any)({
  description: 'Search across the Virtual File System for files containing specific text. Returns matching files and code snippets.',
  parameters: z.object({
    query: z.string().describe('Search term or natural language description'),
    path: z.string().optional().describe('Optional path to search within'),
    limit: z.number().optional().default(10).describe('Maximum number of results'),
  }),
  execute: async ({ query, path, limit = 10 }) => {
    try {
  if (!query || typeof query !== 'string') {
    return { success: false, query, error: 'Query is required', files: [], total: 0 };
  }
  const context = getToolContext();
  // Scope the path filter to the current session, just like other file tools
  const scopedPath = path ? resolveScopedPath(path) : undefined;
  logger.debug('searchFiles', { query, path: scopedPath, limit, userId: context.userId });

  const results = await virtualFilesystem.search(
    context.userId,
    query,
    { path: scopedPath, limit }
  );

  // Normalize: proxy may return array or { files: [...] }
  const files = Array.isArray(results) ? results : (results as any).files || [];

  return {
    success: true,
    query,
    files: files.map((file: any) => ({
  path: file.path,
  name: file.name,
  language: file.language,
  score: file.score,
  snippet: file.snippet,
  lastModified: file.lastModified,
    })),
    total: files.length,
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
export const batchWriteTool = (tool as any)({
  description: 'Write multiple files in one operation. Efficient for creating several related files at once (e.g., component files, config files).',
  parameters: z.object({
    files: z.array(z.object({
  path: z.string().describe('File path'),
  content: z.string().describe('File content'),
    })).max(50, 'Cannot write more than 50 files in a single batch').describe('Array of {path, content} objects'),    commitMessage: z.string().optional().describe('Optional description for all files'),
  }),
  execute: async ({ files, commitMessage = 'Batch write via MCP tool' }) => {
    try {
      const context = getToolContext();
      const startTime = Date.now();

      logger.info('batchWrite: entry', {
        userId: context.userId,
        scopePath: context.scopePath,
        commitMessage,
        sessionId: context.sessionId,
      });

      // Parse files argument - handles string format from LLM
      const filesArray = parseBatchWriteFiles(files);

      if (!filesArray || !Array.isArray(filesArray)) {
        logger.warn('batchWrite: failed to parse files array', { filesType: typeof files });
        return {
          success: false,
          error: 'Failed to parse files argument. Expected an array of {path, content} objects.',
          results: [],
        };
      }

      logger.debug('batchWrite: after parsing', {
        filesArrayType: typeof filesArray,
        filesArrayIsArray: Array.isArray(filesArray),
        filesArrayLength: filesArray?.length
      });

    // DEBUG: Log full context and args at entry
    logger.debug('batchWrite: entry details', {
  filesType: typeof files,
  filesIsArray: Array.isArray(filesArray),
  filesLength: filesArray?.length ?? 'null/undefined',
  userId: context.userId,
  scopePath: context.scopePath,
  firstFile: filesArray?.[0] ? { path: filesArray[0].path, contentLen: filesArray[0].content?.length } : 'none',
  rawFilesSample: typeof files === 'string' ? files.slice(0, 300) : 'not-string',
    });
    
    // Validate context - if userId is 'default', the tool context wasn't set properly
    if (context.userId === 'default') {
  logger.error('batchWrite: tool context not set - ensure toolContextStore.run() is used');
    }
  
    // Validate input
    if (!filesArray || !Array.isArray(filesArray) || filesArray.length === 0) {
    const errMsg = 'No files provided to batch_write';
    logger.error('batchWrite: ' + errMsg, { filesType: typeof files, filesValue: JSON.stringify(filesArray)?.slice(0, 200) });
    return {
  success: false,
  error: errMsg,
  results: [],
    };
  }

  // Enforce 50-file limit (Zod max() only validates AI SDK function calls, not direct MCP)
  if (filesArray.length > 50) {
    return {
  success: false,
  error: `Cannot write more than 50 files in a single batch (received ${filesArray.length})`,
  results: [],
    };
  }

  // Guard against extremely large total content (50 files * 5MB = 250MB max)
  const MAX_TOTAL_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB
  const totalSize = filesArray.reduce((sum: number, f: any) => sum + (f.content?.length || 0), 0);
  if (totalSize > MAX_TOTAL_CONTENT_SIZE) {
    return {
  success: false,
  error: `Total content too large (${(totalSize / 1024 / 1024).toFixed(1)}MB). Maximum is ${(MAX_TOTAL_CONTENT_SIZE / 1024 / 1024).toFixed(0)}MB.`,
  results: [],
    };
  }

  // Resolve all paths relative to session scope
  const scopedFiles = filesArray.map(file => {
    if (!file.path || typeof file.path !== 'string') {
  throw new Error('Each file entry requires a "path" property');
    }
    if (file.content === undefined || file.content === null) {
  throw new Error(`File "${file.path}" requires "content" property`);
    }
    return {
  ...file,
  scopedPath: resolveScopedPath(file.path),
    };
  });

  logger.debug('batchWrite', { fileCount: filesArray.length, userId: context.userId, scopePath: context.scopePath });

  // Track file existence for event type determination
  const fileStates = await Promise.all(
    scopedFiles.map(async (file) => {
  try {
    await virtualFilesystem.readFile(context.userId, file.scopedPath);
    return { path: file.scopedPath, existed: true };
  } catch {
    return { path: file.scopedPath, existed: false };
  }
    })
  );

  const results = await Promise.all(
    scopedFiles.map(async (file) => {
  try {
    const result = await virtualFilesystem.writeFile(
      context.userId,
      file.scopedPath,
      file.content,
      undefined,
      { failIfExists: false },
      context.sessionId // pass sessionId for GitBackedVFS
    );
    logger.debug('batchWrite: file written', {
      scopedPath: file.scopedPath,
      userId: context.userId,
      version: result?.version,
    });
    return { path: file.scopedPath, success: true, version: result.version };
  } catch (error: any) {
    logger.error('batchWrite: single file failed', {
      scopedPath: file.scopedPath,
      error: error.message,
      stack: error.stack,
    });
    return { path: file.scopedPath, success: false, error: error.message };
  }
    })
  );

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const durationMs = Date.now() - startTime;

  logger.info('batchWrite: completed', {
    userId: context.userId,
    scopePath: context.scopePath,
    total: filesArray.length,
    successCount,
    failCount,
    durationMs,
    scopedPaths: scopedFiles.map(f => f.scopedPath),
  });

  // Emit batch file events
  const filesWithContent = scopedFiles.map(f => {
    const state = fileStates.find(s => s.path === f.scopedPath);
    return {
  path: f.scopedPath,
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

  return {
    success: failCount === 0,
    results,
    total: files.length,
    successCount,
    failCount,
    message: `Wrote ${successCount} of ${files.length} files`,
  };
    } catch (error: any) {
  logger.error('batchWrite failed', {
    error: error.message,
    stack: error.stack,
    fileCount: files?.length,
  });
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
export const deleteFileTool = (tool as any)({
  description: 'Delete a file or directory from the Virtual File System. Use with caution - this operation cannot be undone.',
  parameters: z.object({
    path: z.string().describe('Path to delete'),
    reason: z.string().optional().describe('Reason for deletion'),
  }),
  execute: async ({ path, reason }) => {
    try {
  if (!path || typeof path !== 'string') {
    return { success: false, path, error: 'Path is required' };
  }
  const context = getToolContext();
  const scopedPath = resolveScopedPath(path);
  logger.debug('deleteFile', { originalPath: path, scopedPath, reason, userId: context.userId });

  const result = await virtualFilesystem.deletePath(context.userId, scopedPath);

  // Emit delete event
  await emitFileEvent({
    userId: context.userId,
    sessionId: context.sessionId,
    path: scopedPath,
    type: 'delete',
    source: 'mcp-tool',
  });

  return {
    success: true,
    path: scopedPath,
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
export const createDirectoryTool = (tool as any)({
  description: 'Create a directory in the Virtual File System. Creates parent directories as needed.',
  parameters: z.object({
    path: z.string().describe('Directory path to create'),
  }),
  execute: async ({ path }) => {
    try {
  if (!path || typeof path !== 'string') {
    return { success: false, path, error: 'Path is required' };
  }
  const context = getToolContext();

  // Resolve path relative to session scope
  const scopedPath = resolveScopedPath(path);
  logger.debug('createDirectory', { originalPath: path, scopedPath, userId: context.userId });

  const result = await virtualFilesystem.createDirectory(context.userId, scopedPath);

  // Emit create event for directory (type: 'create' for consistency)
  await emitFileEvent({
    userId: context.userId,
    sessionId: context.sessionId,
    path: scopedPath,
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
export const getWorkspaceStatsTool = (tool as any)({
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
 * Extended VFS tool definition with explicit metadata for MCP registry
 */
export interface VFSExtendedTool {
  name: string;
  description: string;
  parameters: z.ZodType;
  execute: (...args: any[]) => Promise<unknown>;
}

/**
 * All VFS MCP tools grouped together with explicit metadata
 * Can be registered with MCP server or used directly with AI SDK
 */
export const vfsTools = {
  write_file: writeFileTool as any as VFSExtendedTool,
  apply_diff: applyDiffTool as any as VFSExtendedTool,
  read_file: readFileTool as any as VFSExtendedTool,
  list_files: listFilesTool as any as VFSExtendedTool,
  search_files: searchFilesTool as any as VFSExtendedTool,
  batch_write: batchWriteTool as any as VFSExtendedTool,
  delete_file: deleteFileTool as any as VFSExtendedTool,
  create_directory: createDirectoryTool as any as VFSExtendedTool,
  get_workspace_stats: getWorkspaceStatsTool as any as VFSExtendedTool,
};

/**
 * Tool metadata map — source of truth for MCP tool definitions.
 * This decouples our MCP protocol layer from the AI SDK's internal tool type,
 * which changes frequently between versions.
 */
const TOOL_META: Record<string, { description: string; parameters: z.ZodType }> = {
  write_file: {
    description: writeFileTool.description,
    parameters: z.object({
  path: z.string().describe('Full virtual path'),
  content: z.string().describe('Complete file content'),
  commitMessage: z.string().optional(),
    }),
  },
  apply_diff: {
    description: applyDiffTool.description,
    parameters: z.object({
  path: z.string().describe('Target file path'),
  diff: z.string().describe('Unified diff format'),
  commitMessage: z.string().optional(),
    }),
  },
  read_file: {
    description: readFileTool.description,
    parameters: z.object({
  path: z.string().describe('Full path to the file'),
    }),
  },
  list_files: {
    description: listFilesTool.description,
    parameters: z.object({
  path: z.string().default('/'),
  recursive: z.boolean().optional().default(false),
    }),
  },
  search_files: {
    description: searchFilesTool.description,
    parameters: z.object({
  query: z.string().describe('Search term'),
  path: z.string().optional(),
  limit: z.number().optional().default(10),
    }),
  },
  batch_write: {
    description: batchWriteTool.description,
    parameters: z.object({
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })),
  commitMessage: z.string().optional(),
    }),
  },
  delete_file: {
    description: deleteFileTool.description,
    parameters: z.object({
  path: z.string(),
  reason: z.string().optional(),
    }),
  },
  create_directory: {
    description: createDirectoryTool.description,
    parameters: z.object({
  path: z.string(),
    }),
  },
  get_workspace_stats: {
    description: getWorkspaceStatsTool.description,
    parameters: z.object({}),
  },
};

/**
 * Get tool definitions in OpenAI format for tool registry.
 * Uses the explicit TOOL_META map instead of relying on the AI SDK's
 * internal Tool type (which has no stable name/parameters/public shape).
 */
export function getVFSToolDefinitions() {
  return Object.entries(TOOL_META).map(([name, meta]) => ({
    type: 'function' as const,
    function: {
  name,
  description: meta.description,
  parameters: meta.parameters,
    },
  }));
}

/**
 * Get VFS tool by name
 */
export function getVFSTool(name: string) {
  return vfsTools[name as keyof typeof vfsTools];
}