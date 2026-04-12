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
import { tolerantJsonParse, sanitizeJsonString, findBalancedJsonObject } from '../utils/json-tolerant';

// Re-export for backwards compatibility (other modules may import from here)
export { tolerantJsonParse, sanitizeJsonString, findBalancedJsonObject };

const logger = createLogger('VFS-MCP-Tools');

// ============================================================================
// Tool Argument Normalization (Self-Healing for LLM Mistakes)
// ============================================================================

/**
 * Unwrap markdown code fences from content strings.
 * Some models wrap file content in ```lang ... ``` blocks.
 */
function unwrapCodeBlock(s: string): string {
  // Match fenced blocks: ```lang\ncontent\n```
  const match = s.match(/^```[\w.+-]*\n([\s\S]*?)```$/);
  if (match) return match[1].trim();
  // Also match without language: ```\ncontent\n```
  const match2 = s.match(/^```\n([\s\S]*?)```$/);
  if (match2) return match2[1].trim();
  // Match fenced with language and no trailing newline before close
  const match3 = s.match(/^```[\w.+-]*\n([\s\S]*?)\n?```$/);
  if (match3) return match3[1].trim();
  return s;
}

/**
 * Normalize a file path: strip leading `./`, reject `../`, handle absolute paths.
 */
function normalizeFilePath(inputPath: string): string {
  let p = inputPath;
  // Strip leading `./` (repeated)
  while (p.startsWith('./')) p = p.slice(2);
  // Reject directory traversal
  if (p.includes('..')) {
    // Best-effort: remove the traversal segments
    p = p.split('/').filter(s => s !== '..' && s !== '.').join('/');
  }
  // Strip leading `/` (absolute path → make relative)
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

/**
 * Normalize tool arguments before Zod validation.
 * Maps common LLM field-name mistakes to expected schema fields.
 * This dramatically improves success rates across different models.
 */
export function normalizeToolArgs(toolName: string, raw: unknown): any {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = { ...(raw as Record<string, unknown>) };

  const alias = (candidates: string[]): unknown => {
    for (const key of candidates) {
      if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    }
    return undefined;
  };

  switch (toolName.toLowerCase()) {
    case 'write_file':
    case 'create_file':
    case 'writetofile': {
      const path = alias(['path', 'file', 'filename', 'filepath', 'file_path', 'filePath', 'target']);
      let content = alias(['content', 'contents', 'code', 'text', 'body', 'data', 'source']);
      const commitMessage = alias(['commitMessage', 'commit_message', 'message', 'description']);
      // Unwrap code fences if LLM wrapped content in ``` blocks
      if (typeof content === 'string') content = unwrapCodeBlock(content);
      // Normalize path (strip ./, leading /, reject ../)
      const normalizedPath = typeof path === 'string' ? normalizeFilePath(path) : path;
      return { path: normalizedPath, content, commitMessage };
    }
    case 'apply_diff':
    case 'applydiff':
    case 'patch': {
      const path = alias(['path', 'file', 'filename', 'filepath', 'file_path', 'target']);
      let diff = alias(['diff', 'patch', 'content', 'changes', 'delta']);
      // Unwrap code fences if LLM wrapped diff in ``` blocks
      if (typeof diff === 'string') diff = unwrapCodeBlock(diff);
      const commitMessage = alias(['commitMessage', 'commit_message', 'message']);
      // Normalize path
      const normalizedPath = typeof path === 'string' ? normalizeFilePath(path) : path;
      return { path: normalizedPath, diff, commitMessage };
    }
    case 'read_file':
    case 'readfile': {
      const path = alias(['path', 'file', 'filename', 'filepath', 'file_path']);
      const normalizedPath = typeof path === 'string' ? normalizeFilePath(path) : path;
      return { path: normalizedPath };
    }
    case 'read_files':
    case 'readfiles': {
      let paths = alias(['paths', 'files', 'filenames', 'file_paths']);
      // Handle single path string
      if (typeof paths === 'string') paths = [normalizeFilePath(paths)];
      // Normalize each path
      if (Array.isArray(paths)) paths = paths.map(normalizeFilePath);
      return { paths };
    }
    case 'delete_file':
    case 'deletefile':
    case 'remove_file': {
      const path = alias(['path', 'file', 'filename', 'filepath', 'target']);
      const reason = alias(['reason', 'message', 'description']);
      const normalizedPath = typeof path === 'string' ? normalizeFilePath(path) : path;
      return { path: normalizedPath, reason };
    }
    case 'list_files':
    case 'listfiles':
    case 'ls': {
      const path = alias(['path', 'directory', 'dir', 'folder']);
      const recursive = alias(['recursive', 'recurse', 'deep']);
      const normalizedPath = typeof path === 'string' ? normalizeFilePath(path) : path;
      return { path: normalizedPath ?? '/', recursive };
    }
    case 'batch_write':
    case 'batchwrite':
    case 'write_files':
    case 'writefiles': {
      let files = alias(['files', 'items', 'operations', 'data', 'batch']);
      // Handle stringified JSON
      if (typeof files === 'string') {
        files = parseBatchWriteFiles(files);
      }
      // Handle top-level array
      if (!files && Array.isArray(raw)) files = raw;
      // Normalize each file's fields
      if (Array.isArray(files)) {
        files = files.filter(f => f && typeof f === 'object').map((f: any) => {
          const path = f.path ?? f.file ?? f.filename ?? f.filepath ?? f.file_path ?? f.target ?? f.name;
          let content = f.content ?? f.contents ?? f.code ?? f.text ?? f.body ?? f.data ?? f.source ?? f.value ?? f.body_content ?? f.file_content;
          // Unwrap markdown code fences if LLM wrapped content in ``` blocks
          if (typeof content === 'string') content = unwrapCodeBlock(content);
          // Normalize path
          const normalizedPath = typeof path === 'string' ? normalizeFilePath(path) : path;
          return { path: normalizedPath, content };
        });
      }
      const commitMessage = alias(['commitMessage', 'commit_message', 'message']);
      return { files, commitMessage };
    }
    case 'create_directory':
    case 'createdirectory':
    case 'mkdir': {
      const path = alias(['path', 'directory', 'dir', 'folder', 'name']);
      const normalizedPath = typeof path === 'string' ? normalizeFilePath(path) : path;
      return { path: normalizedPath };
    }
    case 'search_files':
    case 'searchfiles':
    case 'search': {
      const query = alias(['query', 'search', 'term', 'pattern', 'text']);
      const path = alias(['path', 'directory', 'dir', 'folder', 'scope']);
      const limit = alias(['limit', 'max', 'count', 'maxResults']);
      const normalizedPath = typeof path === 'string' ? normalizeFilePath(path) : path;
      return { query, path: normalizedPath, limit };
    }
    default:
      return obj;
  }
}

// tolerantJsonParse is now imported from ../utils/json-tolerant (shared utility)

// ============================================================================
// Central Tool Call Normalization Pipeline (Plan 6.1)
// ============================================================================

/**
 * Normalized tool call — the canonical shape after normalization.
 * All callers (MCP host, text parser, Vercel AI handler) should use this.
 */
export interface NormalizedToolCall {
  /** Canonical tool name (lowercase, e.g. 'write_file', 'batch_write') */
  tool: string;
  /** Arguments already normalized to expected schema shape */
  args: Record<string, unknown>;
  /** Whether normalization detected and corrected field-name aliases */
  hadAliasCorrections?: boolean;
}

/**
 * Tool name aliases — alternate names LLMs use for our canonical tool names.
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
  writetofile: 'write_file',
  create_file: 'write_file',
  writetotext: 'write_file',
  applydiff: 'apply_diff',
  patch: 'apply_diff',
  readfile: 'read_file',
  readfiles: 'read_files',
  listfiles: 'list_files',
  ls: 'list_files',
  searchfiles: 'search_files',
  search: 'search_files',
  batchwrite: 'batch_write',
  write_files: 'batch_write',
  writefiles: 'batch_write',
  deletefile: 'delete_file',
  remove_file: 'delete_file',
  createdirectory: 'create_directory',
  mkdir: 'create_directory',
};

/**
 * Central tool call normalization pipeline.
 *
 * Takes a raw tool call (from any source: MCP, text parser, Vercel AI handler)
 * and returns a normalized `NormalizedToolCall` or null on fatal problems.
 *
 * Steps:
 * 1. Normalize tool name (lowercase, resolve aliases)
 * 2. Normalize arguments via `normalizeToolArgs`
 * 3. Validate required fields are present
 *
 * @param raw - Raw tool call object with any field naming convention
 * @returns Normalized tool call or null if unparseable
 */
export function normalizeToolCall(raw: unknown): NormalizedToolCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // Step 1: Resolve tool name from any alias field
  const TOOL_FIELD_NAMES = ['tool', 'function', 'name', 'tool_name', 'type'];
  let rawToolName: string | undefined;
  for (const field of TOOL_FIELD_NAMES) {
    const val = obj[field];
    if (typeof val === 'string') { rawToolName = val; break; }
  }
  if (!rawToolName) return null;

  // Normalize and resolve aliases
  const lowerName = rawToolName.toLowerCase();
  const canonicalTool = TOOL_NAME_ALIASES[lowerName] || lowerName;

  // Step 2: Resolve args from any alias field
  const ARGS_FIELD_NAMES = ['arguments', 'args', 'parameters', 'input', 'data'];
  let rawArgs: unknown = {};
  for (const field of ARGS_FIELD_NAMES) {
    if (obj[field] !== undefined) { rawArgs = obj[field]; break; }
  }

  // Step 3: Normalize args via the per-tool normalizer
  const normalizedArgs = normalizeToolArgs(canonicalTool, rawArgs);
  if (!normalizedArgs || typeof normalizedArgs !== 'object') return null;

  // Step 4: Quick validation — check required fields for known tools
  const requiredFields: Record<string, string[]> = {
    write_file: ['path', 'content'],
    apply_diff: ['path', 'diff'],
    read_file: ['path'],
    delete_file: ['path'],
    create_directory: ['path'],
    batch_write: ['files'],
  };
  const required = requiredFields[canonicalTool];
  if (required) {
    for (const field of required) {
      const val = (normalizedArgs as Record<string, unknown>)[field];
      if (val === undefined || val === null) {
        // Missing required field — still return the result so the caller
        // can log and decide whether to retry, but flag it.
        return {
          tool: canonicalTool,
          args: normalizedArgs as Record<string, unknown>,
          hadAliasCorrections: true,
          _missingRequired: required.filter(f => (normalizedArgs as Record<string, unknown>)[f] === undefined || (normalizedArgs as Record<string, unknown>)[f] === null),
        };
      }
    }
  }

  return {
    tool: canonicalTool,
    args: normalizedArgs as Record<string, unknown>,
  };
}

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

  function parseAndValidate(text: string) {
    const parsed = tolerantJsonParse(text);
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
  // Use consistent default session matching MCP route defaults (project/sessions/000)
  return {
    userId: 'default',
    sessionId: undefined,
    scopePath: 'project/sessions/000',
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
  const scopePath = context.scopePath || 'project/sessions/000';  // Ensure scopePath defaults to session scope

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
    scopePath: scopePath || 'project/sessions/000',  // Default to session scope
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
  description: [
    'Create or overwrite a file in the VFS.',
    '',
    'Required arguments:',
    '  • path (string) — relative file path like "src/app.tsx" (no leading slash, no URL, no query string)',
    '  • content (string) — complete file contents, do not abbreviate or truncate',
    '',
    'Examples of correct usage:',
    '  write_file(path="hello.py", content="print(\'Hello, World!\')")',
    '  write_file(path="src/App.tsx", content="export default function App() { return <div>Hello</div>; }")',
    '  write_file(path="README.md", content="# My Project\\n\\nThis is a sample project.")',
    '',
    'Common mistakes to avoid:',
    '  ✗ create_file(...)          → Use write_file instead (wrong tool name)',
    '  ✗ writeFile(path=...)       → Use write_file (underscore, not camelCase)',
    '  ✗ write_file(file=...)      → Use path, not file or filename or filepath',
    '  ✗ write_file(path=..., code=...)  → Use content, not code or text or body',
    '  ✗ write_file(path="/src/app.tsx", ...)  → No leading slash, use "src/app.tsx"',
    '  ✗ write_file(path="https://example.com/src/app.tsx", ...)  → No URLs, use relative paths',
    '',
    'Workflow:',
    '  • For creating new files: use write_file for single file, batch_write for multiple files',
    '  • For modifying existing files: use apply_diff (surgical patch), NOT write_file (full rewrite)',
    '  • Always read existing files with read_file before editing them',
  ].join('\n'),
  parameters: z.preprocess(
    (raw) => normalizeToolArgs('write_file', raw),
    z.object({
      path: z.string().describe('Relative path like "src/app.tsx" (no URL, no query string, no leading slash)'),
      content: z.string().describe('Complete file contents — do not abbreviate or truncate'),
      commitMessage: z.string().optional().describe('Optional description of the change'),
    })
  ).passthrough(),
  execute: async ({ path, content, commitMessage = 'Write file via MCP tool' }) => {
    try {
  if (!path || typeof path !== 'string') {
    return { success: false, path, error: 'Path is required' };
  }
  if (content === undefined || content === null) {
    return { success: false, path, error: 'Content is required' };
  }
  // Unwrap code fences if LLM wrapped content in ``` blocks (safety net)
  if (typeof content === 'string') content = unwrapCodeBlock(content);
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

  // ENHANCED: Log VFS tool invocation with full context
  logger.info('[VFS-TOOL] writeFile invoked', {
    originalPath: path,
    contentLength: content?.length || 0,
    contentPreview: content?.slice(0, 100) || '(empty)',
    userId: context.userId,
    scopePath: context.scopePath,
    sessionId: context.sessionId,
    hasValidContext: context.userId !== 'default',
  });

  // Validate context — if userId is 'default', the tool context wasn't set properly
  if (context.userId === 'default') {
    logger.warn('[VFS-TOOL] WARNING: Using default context (toolContextStore.run() may be missing)', {
      path,
      contentLength: content.length,
    });
  }
  
  // Resolve path relative to session scope
  const scopedPath = resolveScopedPath(path);
  logger.info('[VFS-TOOL] Resolved scoped path', { originalPath: path, scopedPath, scopePath: context.scopePath });

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
  description: [
    'Apply a diff patch to modify an existing file.',
    '',
    'Required arguments:',
    '  • path (string) — relative file path like "src/app.tsx"',
    '  • diff (string) — unified diff format with --- and +++ headers',
    '',
    'Unified diff format:',
    '  --- a/src/file.ts',
    '  +++ b/src/file.ts',
    '  @@ -line,count +line,count @@',
    '   unchanged context line',
    '  -removed line',
    '  +added line',
    '   unchanged context line',
    '',
    'Examples of correct usage:',
    '  apply_diff(path="src/App.tsx", diff="--- a/src/App.tsx\\n+++ b/src/App.tsx\\n@@ -1,5 +1,5 @@\\n import React\\n-function OldName() {\\n+function NewName() {\\n   return <div>hello</div>',
    '',
    'Common mistakes to avoid:',
    '  ✗ apply_diff(path=..., patch=...)  → Use diff, not patch (wrong field name)',
    '  ✗ apply_diff(path=..., changes=...)  → Use diff, not changes',
    '  ✗ apply_diff(file=..., diff=...)  → Use path, not file',
    '  ✗ Diff missing --- or +++ headers  → Must include both --- a/path and +++ b/path',
    '  ✗ Diff with no context lines  → Include at least 2-3 unchanged lines around your changes',
    '',
    'When to use apply_diff vs write_file:',
    '  • apply_diff — modifying part of an existing file (PREFERRED)',
    '  • write_file — creating a brand new file, or completely rewriting an entire file',
    '  • Never use write_file to change just a few lines in an existing file — use apply_diff instead',
    '',
    'Workflow for editing existing files:',
    '  1. read_file(path) → review current content',
    '  2. apply_diff(path, diff) → apply surgical patch',
    '  3. Use multiple small apply_diff calls rather than one large rewrite',
  ].join('\n'),
  parameters: z.preprocess(
    (raw) => normalizeToolArgs('apply_diff', raw),
    z.object({
      path: z.string().describe('Relative path like "src/app.tsx" (the file to patch)'),
      diff: z.string().describe('Unified diff with --- +++ @@ format — include full context lines'),
      commitMessage: z.string().optional().describe('Optional description of the change'),
    })
  ).passthrough(),
  execute: async ({ path, diff, commitMessage = 'Applied diff via MCP tool' }) => {
    try {
  if (!path || typeof path !== 'string') {
    return { success: false, path, error: 'Path is required' };
  }
  if (!diff || typeof diff !== 'string') {
    return { success: false, path, error: 'Diff content is required' };
  }

  // Unwrap code fences if LLM wrapped diff in ``` blocks
  diff = unwrapCodeBlock(diff);

  // Auto-generate ---/+++ headers if LLM sent diff without them
  // Common failure: models send just @@ hunk lines without the file headers
  if (!diff.includes('--- ') && !diff.includes('+++ ')) {
    // Check if it looks like a diff (has @@ hunk headers)
    if (diff.includes('@@')) {
      diff = `--- a/${path}\n+++ b/${path}\n${diff}`;
    }
  }

  const context = getToolContext();
  const scopedPath = resolveScopedPath(path);
  
  // ENHANCED: Log VFS tool invocation with full context
  logger.info('[VFS-TOOL] applyDiff invoked', {
    originalPath: path,
    scopedPath,
    diffLength: diff.length,
    diffPreview: diff.slice(0, 200),
    userId: context.userId,
    scopePath: context.scopePath,
  });

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
 * Reverse-normalize a scoped VFS path back to the simple form the AI expects.
 * E.g. "project/sessions/001/src/app.ts" → "/src/app.ts" (if AI sent "/src/app.ts")
 * or "src/app.ts" (if AI sent "src/app.ts")
 */
function reverseNormalizePath(originalPath: string, scopedPath: string): string {
  const context = getToolContext();
  const scopePath = context.scopePath || 'project/sessions/000';

  // If scoped path starts with the scope, strip it to get the relative part
  if (scopedPath.startsWith(`${scopePath}/`)) {
    const relative = scopedPath.substring(scopePath.length + 1);
    return originalPath.startsWith('/') ? `/${relative}` : relative;
  }

  // Fallback: return original path unchanged
  return originalPath;
}

/**
 * read_file - Read the current content of a file
 * Critical for the agent to see what exists before editing
 */
export const readFileTool = (tool as any)({
  description: [
    'Read the content of a file. ALWAYS call this before editing an existing file.',
    '',
    'Required arguments:',
    '  • path (string) — relative file path like "src/app.tsx"',
    '',
    'Examples of correct usage:',
    '  read_file(path="src/App.tsx")',
    '  read_file(path="package.json")',
    '',
    'Common mistakes to avoid:',
    '  ✗ readFile(path=...)  → Use read_file (underscore, not camelCase)',
    '  ✗ read_file(file=...)  → Use path, not file or filename',
    '',
    'Workflow: Always read_file before applying a diff to an existing file.',
  ].join('\n'),
  parameters: z.preprocess(
    (raw) => normalizeToolArgs('read_file', raw),
    z.object({
      path: z.string().describe('Relative path like "src/app.tsx" (the file to read)'),
    })
  ).passthrough(),
  execute: async ({ path }) => {
    try {
  if (!path || typeof path !== 'string') {
    return { success: false, path, error: 'Path is required', exists: false };
  }
  const context = getToolContext();
  const scopedPath = resolveScopedPath(path);

  // ENHANCED: Log VFS tool invocation
  logger.info('[VFS-TOOL] readFile invoked', {
    originalPath: path,
    scopedPath,
    userId: context.userId,
    scopePath: context.scopePath,
  });

  const file = await virtualFilesystem.readFile(context.userId, scopedPath);
  const f = file as any;

  return {
    success: true,
    path: reverseNormalizePath(path, scopedPath),
    content: f.content,
    language: f.language,
    size: f.size,
    lastModified: f.lastModified,
    version: f.version ?? 1,
    exists: true,
  };
    } catch (error: any) {
  logger.error('readFile failed', { 
    path, 
    error: error.message,
    stack: error.stack,
    userId: getToolContext().userId 
  });
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
 * read_files - Read multiple files in one operation
 * Efficient for the AI to fetch several files at once without
 * multiple round-trips. Returns each file's content or error.
 */
export const readFilesTool = (tool as any)({
  description: 'Read multiple files at once from the Virtual File System. More efficient than calling read_file repeatedly when you need several files.',
  parameters: z.preprocess(
    (raw) => normalizeToolArgs('read_files', raw),
    z.object({
      paths: z.array(z.string()).min(1).max(20, 'Cannot read more than 20 files at once').describe('Array of file paths like ["src/a.ts", "src/b.ts"]'),
    })
  ).passthrough(),
  execute: async ({ paths }) => {
    try {
      const context = getToolContext();
      logger.info('[VFS-TOOL] readFiles invoked', {
        pathCount: paths.length,
        userId: context.userId,
        scopePath: context.scopePath,
      });

      const results = await Promise.all(paths.map(async (originalPath: string) => {
        try {
          if (!originalPath || typeof originalPath !== 'string') {
            return { path: originalPath, success: false, error: 'Path is required' } as any;
          }
          const scopedPath = resolveScopedPath(originalPath);
          const file = await virtualFilesystem.readFile(context.userId, scopedPath);
          const f = file as any;
          return {
            path: reverseNormalizePath(originalPath, scopedPath),
            content: f.content,
            language: f.language,
            size: f.size,
            version: f.version ?? 1,
            success: true,
          };
        } catch (err: any) {
          return { path: originalPath, success: false, error: err.message };
        }
      }));

      const successCount = results.filter((r: any) => r.success).length;
      return {
        success: successCount > 0,
        files: results,
        totalRequested: paths.length,
        totalRead: successCount,
      };
    } catch (error: any) {
      logger.error('readFiles failed', { error: error.message });
      return { success: false, error: error.message, files: [] };
    }
  },
});

/**
 * list_files - List files and directories in the VFS
 * Use for navigation and exploration
 */
export const listFilesTool = (tool as any)({
  description: [
    'List files and directories in the Virtual File System.',
    '',
    'Arguments:',
    '  • path (string, default: "/") — directory to list',
    '  • recursive (boolean, default: false) — whether to list recursively',
    '',
    'Examples of correct usage:',
    '  list_files(path="/")',
    '  list_files(path="src/", recursive=true)',
    '',
    'Common mistakes to avoid:',
    '  ✗ listFiles(path=...)  → Use list_files (underscore, not camelCase)',
    '  ✗ ls(path=...)  → Use list_files, not ls',
    '  ✗ list_files(directory=...)  → Use path, not directory or dir or folder',
  ].join('\n'),
  parameters: z.preprocess(
    (raw) => normalizeToolArgs('list_files', raw),
    z.object({
      path: z.string().default('/').describe('Directory path to list (default: root, like "/")'),
      recursive: z.boolean().optional().default(false).describe('Whether to list recursively (default: false)'),
    })
  ).passthrough(),
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
  description: [
    'Search across the Virtual File System for files containing specific text.',
    '',
    'Arguments:',
    '  • query (string) — search term or text pattern',
    '  • path (string, optional) — limit search to a directory like "src/"',
    '  • limit (number, default: 10) — maximum results',
    '',
    'Examples of correct usage:',
    '  search_files(query="TODO")',
    '  search_files(query="useState", path="src/", limit=20)',
    '',
    'Common mistakes to avoid:',
    '  ✗ searchFiles(query=...)  → Use search_files (underscore, not camelCase)',
    '  ✗ search_files(term=...)  → Use query, not term or pattern or text',
    '  ✗ search_files(search=...)  → Use query, not search',
  ].join('\n'),
  parameters: z.preprocess(
    (raw) => normalizeToolArgs('search_files', raw),
    z.object({
      query: z.string().describe('Search term or natural language description'),
      path: z.string().optional().describe('Optional path to search within (e.g. "src/")'),
      limit: z.number().optional().default(10).describe('Maximum number of results (default: 10)'),
    })
  ).passthrough(),
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
  description: [
    'Write multiple files at once in a single tool call.',
    '',
    'Required arguments:',
    '  • files (array) — array of {path, content} objects',
    '',
    'Optional arguments:',
    '  • commitMessage (string) — description of the batch change',
    '',
    'Examples of correct usage:',
    '  batch_write(files=[{path:"src/app.py", content:"from flask import Flask\\napp = Flask(__name__)"},{path:"requirements.txt", content:"flask\\ngunicorn"}])',
    '  batch_write(files=[{path:"src/App.tsx", content:"export default function App() {}"},{path:"src/App.css", content:".app { margin: 0 }"}])',
    '  batch_write(files=[{path:"README.md", content:"# Project"},{path:"LICENSE", content:"MIT"},{path:".gitignore", content:"node_modules/"}])',
    '',
    'Common mistakes to avoid:',
    '  ✗ batch_write(files="[{\\"path\\":...}]")  → Do NOT stringify the files array — pass as a proper JSON/array',
    '  ✗ batch_write(files={path:"a.py", content:"..."})  → files must be an ARRAY [...], not a single object {...}',
    '  ✗ batch_write(items=[...])  → Use files, not items or operations or data',
    '  ✗ write_file(path="a.py", ...) + write_file(path="b.py", ...)  → Use batch_write for 2+ files instead',
    '  ✗ batch_write with file= instead of path=  → Each entry needs path and content keys',
    '',
    'When to use batch_write vs write_file:',
    '  • batch_write — creating 2 or more files in one go',
    '  • write_file — creating a single new file',
    '',
    'Important rules:',
    '  • Maximum 50 files per batch',
    '  • Total content size limit: 50MB across all files',
    '  • Each file entry must have both "path" and "content" keys',
    '  • Parent directories are created automatically',
    '  • Use batch_write for NEW files only — for editing existing files, use apply_diff',
  ].join('\n'),
  parameters: z.preprocess(
    (raw) => normalizeToolArgs('batch_write', raw),
    z.object({
      files: z.array(z.object({
        path: z.string().describe('Relative file path like "src/utils.ts"'),
        content: z.string().describe('Complete file contents — do not abbreviate'),
      })).max(50, 'Cannot write more than 50 files').describe('Array of {path, content} objects — e.g. [{"path":"src/a.ts","content":"..."}]'),
      commitMessage: z.string().optional().describe('Optional description of the batch change'),
    })
  ).passthrough(),
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
  description: [
    'Delete a file or directory from the Virtual File System. Use with caution.',
    '',
    'Arguments:',
    '  • path (string) — relative file path like "src/old.ts"',
    '  • reason (string, optional) — why this file is being deleted',
    '',
    'Examples of correct usage:',
    '  delete_file(path="src/old.ts")',
    '  delete_file(path="temp/", reason="Temporary files no longer needed")',
    '',
    'Common mistakes to avoid:',
    '  ✗ deleteFile(path=...)  → Use delete_file (underscore, not camelCase)',
    '  ✗ delete_file(file=...)  → Use path, not file or filename',
    '  ✗ remove_file(path=...)  → Use delete_file, not remove_file',
  ].join('\n'),
  parameters: z.preprocess(
    (raw) => normalizeToolArgs('delete_file', raw),
    z.object({
      path: z.string().describe('Relative path like "src/old.ts" (the file or directory to delete)'),
      reason: z.string().optional().describe('Optional reason for deletion'),
    })
  ).passthrough(),
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
  description: [
    'Create a directory in the Virtual File System. Parent directories are created automatically.',
    '',
    'Arguments:',
    '  • path (string) — directory path to create like "src/components/utils"',
    '',
    'Examples of correct usage:',
    '  create_directory(path="src/components")',
    '  create_directory(path="tests/unit")',
    '',
    'Common mistakes to avoid:',
    '  ✗ createDirectory(path=...)  → Use create_directory (underscore, not camelCase)',
    '  ✗ mkdir(path=...)  → Use create_directory, not mkdir',
    '  ✗ create_directory(directory=...)  → Use path, not directory or dir or folder or name',
  ].join('\n'),
  parameters: z.preprocess(
    (raw) => normalizeToolArgs('create_directory', raw),
    z.object({
      path: z.string().describe('Directory path to create, like "src/components/utils"'),
    })
  ).passthrough(),
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
  read_files: readFilesTool as any as VFSExtendedTool,
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
  path: z.string().describe('Relative path like "src/app.tsx" (no URL, no query string, no leading slash)'),
  content: z.string().describe('Complete file contents — do not abbreviate or truncate'),
  commitMessage: z.string().optional().describe('Optional description of the change'),
    }).passthrough(),
  },
  apply_diff: {
    description: applyDiffTool.description,
    parameters: z.object({
  path: z.string().describe('Relative path like "src/app.tsx" (the file to patch)'),
  diff: z.string().describe('Unified diff with --- +++ @@ format — include full context lines'),
  commitMessage: z.string().optional().describe('Optional description of the change'),
    }).passthrough(),
  },
  read_file: {
    description: readFileTool.description,
    parameters: z.object({
  path: z.string().describe('Relative path like "src/app.tsx" (the file to read)'),
    }).passthrough(),
  },
  read_files: {
    description: readFilesTool.description,
    parameters: z.object({
  paths: z.array(z.string()).min(1).max(20).describe('Array of file paths like ["src/a.ts", "src/b.ts"]'),
    }).passthrough(),
  },
  list_files: {
    description: listFilesTool.description,
    parameters: z.object({
  path: z.string().default('/').describe('Directory path to list (default: root, like "/")'),
  recursive: z.boolean().optional().default(false).describe('Whether to list recursively (default: false)'),
    }).passthrough(),
  },
  search_files: {
    description: searchFilesTool.description,
    parameters: z.object({
  query: z.string().describe('Search term or natural language description'),
  path: z.string().optional().describe('Optional path to search within (e.g. "src/")'),
  limit: z.number().optional().default(10).describe('Maximum number of results (default: 10)'),
    }).passthrough(),
  },
  batch_write: {
    description: batchWriteTool.description,
    parameters: z.object({
  files: z.array(z.object({
    path: z.string().describe('Relative file path like "src/utils.ts"'),
    content: z.string().describe('Complete file contents — do not abbreviate'),
  })).max(50).describe('Array of {path, content} objects — e.g. [{"path":"src/a.ts","content":"..."}]'),
  commitMessage: z.string().optional().describe('Optional description of the batch change'),
    }).passthrough(),
  },
  delete_file: {
    description: deleteFileTool.description,
    parameters: z.object({
  path: z.string().describe('Relative path like "src/old.ts" (the file or directory to delete)'),
  reason: z.string().optional().describe('Optional reason for deletion'),
    }).passthrough(),
  },
  create_directory: {
    description: createDirectoryTool.description,
    parameters: z.object({
  path: z.string().describe('Directory path to create, like "src/components/utils"'),
    }).passthrough(),
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

// ============================================================================
// Mem0 Memory Tool Wrappers
// These wrap mem0-power actions for use through the MCP tool registry.
// They execute directly when the LLM calls mem0_* tools via function calling.
// ============================================================================

/**
 * Build Mem0 tool executor map for the MCP tool registry.
 * Each tool wraps the corresponding mem0-power action.
 */
export async function buildMem0MCPTools(context: { userId?: string; sessionId?: string } = {}): Promise<Record<string, { description: string; parameters: any; execute: (args: any) => Promise<any> }>> {
  const { isMem0Configured, mem0Add, mem0Search, mem0GetAll, mem0Update, mem0Delete, mem0DeleteAll } = await import('../powers/mem0-power');
  
  if (!isMem0Configured()) {
    return {};
  }

  const userId = context.userId || 'default-user';
  const sessionId = context.sessionId;

  return {
    mem0_add: {
      description: 'Store memories from a conversation for persistent context. Call after each user-agent interaction.',
      parameters: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          userId: { type: 'string', description: 'User identifier for scoping memories' },
        },
        required: ['messages'],
      },
      execute: async (args: any) => mem0Add(args, { userId, sessionId }),
    },
    mem0_search: {
      description: 'Search memories for relevant context before responding. Use to personalize responses based on user history.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          userId: { type: 'string', description: 'User identifier' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
      execute: async (args: any) => mem0Search(args, { userId, sessionId }),
    },
    mem0_get_all: {
      description: 'Retrieve all stored memories for a user.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User identifier' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
      execute: async (args: any) => mem0GetAll(args, { userId, sessionId }),
    },
    mem0_update: {
      description: 'Update an existing memory by ID.',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID to update' },
          text: { type: 'string', description: 'New memory text' },
        },
        required: ['memoryId', 'text'],
      },
      execute: async (args: any) => mem0Update(args, { userId, sessionId }),
    },
    mem0_delete: {
      description: 'Delete a specific memory by ID.',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID to delete' },
        },
        required: ['memoryId'],
      },
      execute: async (args: any) => mem0Delete(args, { userId, sessionId }),
    },
    mem0_delete_all: {
      description: 'Delete all memories for a user.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User identifier' },
        },
      },
      execute: async (args: any) => mem0DeleteAll(args, { userId, sessionId }),
    },
  };
}