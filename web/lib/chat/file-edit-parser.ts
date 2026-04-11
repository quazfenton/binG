/**
 * File Edit Parser
 *
 * PURPOSE: Parse LLM text responses to extract file edit commands.
 * This module is NOT for applying edits - only for extracting edit commands
 * from unstructured LLM output text.
 *
 * ARCHITECTURE LAYER: Response Parsing (LLM output → structured commands)
 *
 * USE CASES:
 * - Server-side (api/chat/route.ts): Extracts edits from LLM responses for
 *   server-side application and response sanitization
 * - Client-side (message-bubble.tsx, conversation-interface.tsx): Sanitizes display
 *   and detects file operations in responses
 *
 * NOT THIS MODULE'S JOB:
 * - tool-executor.ts: Applies structured diffs to VFS/sandbox (different layer)
 * - safe-diff-operations.ts: Enterprise validation of structured DiffOperation[]
 *   (receives structured objects, not LLM text)
 *
 * Supported formats:
 * - <file_edit path="...">content</file_edit> (compact)
 * - <file_edit>\n<path>...</path>\ncontent\n</file_edit> (multi-line)
 * - ```diff path\ncontent\n``` (fenced diff blocks)
 * - cat > file << 'EOF' ... EOF (bash heredoc)
 * - mkdir -p path, rm -rf path, sed -i 's/old/new/' path (bash commands)
 */

export { isFullFileContent } from './file-diff-utils';
export { stripHeredocBodies } from './bash-file-commands';
import { tolerantJsonParse, findBalancedJsonObject as findBalancedJson } from '../utils/json-tolerant';

// Import for local use
import { stripHeredocBodies as maskHeredocs } from './bash-file-commands';

/**
 * Check if a path segment looks like a CSS value (e.g., "0.3s", "10px")
 */
function looksLikeCssValueSegment(segment: string): boolean {
  // Match CSS values: "0.3s", "10px", "50%", "1.5rem", "0", "100"
  // Pattern: optional decimal number followed by optional CSS unit
  return /^(?:\d+(?:\.\d+)?[a-z%]+|\d+(?:\.\d+)?)$/i.test(segment);
}

/**
 * Validate file path - must be a valid filesystem path
 * CRITICAL: Prevents AI from generating malformed paths like 'project/sessions/003/{'
 * Also rejects CSS values, SCSS variables, and code snippets
 *
 * NOTE: Trailing slashes ARE allowed for directory paths (e.g., "src/", "components/")
 */
export function isValidFilePath(path: string, isFolder: boolean = false): boolean {
  if (!path || path.length === 0) return false;

  // CRITICAL: Check the last segment of the path (the actual filename)
  // This catches "project/sessions/002/0.3s" where "0.3s" is the invalid part
  const pathSegments = path.split('/');
  const lastSegment = pathSegments[pathSegments.length - 1] || path;

  // Reject paths that are clearly CSS values or code snippets (check last segment)
  if (looksLikeCssValueSegment(lastSegment)) return false;  // e.g., "0.3s", "10px"
  if (/^[,;:!?()\[\]{}\/]+$/.test(lastSegment)) return false;  // e.g., ",", "/", "("
  if (/^[+\-*/%&|^~<>]+$/.test(lastSegment)) return false;  // e.g., "=", "+", "-"

  // Paths should NOT contain JSON/object syntax
  if (path.includes('{') || path.includes('}') ||
      path.includes('[') || path.includes(']')) {
    return false;
  }

  // For files: should NOT end with special characters
  // For folders: trailing slash is OK (e.g., "src/", "components/")
  if (!isFolder) {
    if (path.endsWith('/') || path.endsWith(':') ||
        path.endsWith(',') || path.endsWith('{') ||
        path.endsWith('<') || path.endsWith('>')) {
      return false;
    }
  }

  // Paths should NOT start with special characters (except . for relative paths)
  // This rejects SCSS variables ($var), CSS selectors (.class, #id), decorators (@import), etc.
  if (path.startsWith('<') || path.startsWith('>') ||
      path.startsWith('{') || path.startsWith('}') ||
      path.startsWith('[') || path.startsWith(']') ||
      path.startsWith('$') ||  // SCSS/SASS variables like $transition-fast
      path.startsWith('@') ||  // CSS imports, decorators like @import
      path.startsWith('#')) {  // CSS IDs like #header
    return false;
  }

  // Must have valid path format (alphanumeric, dots, dashes, underscores, slashes)
  if (!/^[a-zA-Z0-9_./\-\\]+$/.test(path)) return false;

  return true;
}

export function sanitizeExtractedPath(
  rawPath: string,
  options: { isFolder?: boolean } = {},
): string | null {
  let path = (rawPath || '').trim();
  if (!path) return null;

  path = path
    .replace(/^path\s*[:=]\s*/i, '')
    .replace(/^['"`]+/, '')
    .replace(/['"`]+$/, '')
    .replace(/,+$/, '')
    .trim();

  if (!path) return null;

  if (options.isFolder) {
    path = path.replace(/\/+$/, '');
    return isValidFilePath(path, true) ? path : null;
  }

  return isValidExtractedPath(path) ? path : null;
}

export function parseStructuredPathList(
  rawList: string,
  options: { isFolder?: boolean } = {},
): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | '`' | null = null;

  for (let i = 0; i < rawList.length; i += 1) {
    const char = rawList[i];
    const previous = i > 0 ? rawList[i - 1] : '';

    if (quote) {
      if (char === quote && previous !== '\\') {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }

    if (char === ',' || char === '\n') {
      tokens.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    tokens.push(current);
  }

  const seen = new Set<string>();
  const paths: string[] = [];

  for (const token of tokens) {
    const path = sanitizeExtractedPath(token, options);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }

  return paths;
}

/**
 * Bash heredoc file edit extraction (inline to avoid module init issues)
 * Parses: cat > file << 'EOF' ... EOF
 */
interface BashFileEdit {
  path: string;
  content: string;
  mode: 'write' | 'append';
}

interface BashDirectoryEdit {
  path: string;
}

interface BashDeleteEdit {
  path: string;
}

interface BashPatchEdit {
  path: string;
  pattern: string;
  replacement: string;
  flags?: string;
}

function extractCatHeredocEdits(content: string): BashFileEdit[] {
  const edits: BashFileEdit[] = [];

  // Fast-path: check for heredoc signature
  if (!content.includes('<<') || !content.includes('cat')) {
    return edits;
  }

  // Match: cat > path << 'EOF' ... EOF  OR  cat >> path << 'EOF' ... EOF
  // Groups: 1=mode (> or >>), 2=path, 3=delimiter, 4=content
  const regex = /cat\s*(>>?)\s*([^\s<>&|]+)\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n?\3(?:\s|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    try {
      const mode = match[1] === '>>' ? 'append' : 'write';
      const path = match[2]?.trim();
      const fileContent = match[4] ?? '';

      if (!path || path.startsWith('-')) {
        continue;
      }

      edits.push({
        path,
        content: fileContent.trimEnd(),
        mode
      });
    } catch {
      // Skip invalid matches
    }
  }

  return edits;
}

/**
 * Extract mkdir commands: mkdir -p path
 */
function extractMkdirEdits(content: string): BashDirectoryEdit[] {
  const edits: BashDirectoryEdit[] = [];

  if (!content.includes('mkdir')) {
    return edits;
  }

  // SECURITY: Strip heredoc bodies to avoid false positives from commands inside heredocs
  const masked = maskHeredocs(content);

  // Match: mkdir [-p] path
  const regex = /mkdir\s+(-p\s+)?([^\s&|;<>]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(masked)) !== null) {
    try {
      const path = match[2]?.trim();

      // Skip if path looks like a flag or is empty
      if (!path || path.startsWith('-')) {
        continue;
      }

      edits.push({ path });
    } catch {
      // Skip invalid matches
    }
  }

  return edits;
}

/**
 * Extract rm commands: rm -rf path
 */
function extractRmEdits(content: string): BashDeleteEdit[] {
  const edits: BashDeleteEdit[] = [];

  if (!content.includes('rm ')) {
    return edits;
  }

  // SECURITY: Strip heredoc bodies to avoid false positives from commands inside heredocs
  const masked = maskHeredocs(content);

  // Match: rm [-rf] path
  const regex = /rm\s+(-[rf]+\s+)?([^\s&|;<>]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(masked)) !== null) {
    try {
      const path = match[2]?.trim();

      // Skip if path looks like a flag or is empty
      if (!path || path.startsWith('-')) {
        continue;
      }

      edits.push({ path });
    } catch {
      // Skip invalid matches
    }
  }

  return edits;
}

/**
 * Extract sed -i commands: sed -i 's/pattern/replacement/' path
 */
function extractSedEdits(content: string): BashPatchEdit[] {
  const edits: BashPatchEdit[] = [];

  if (!content.includes('sed')) {
    return edits;
  }

  // SECURITY: Strip heredoc bodies to avoid false positives from commands inside heredocs
  const masked = maskHeredocs(content);

  // Match: sed -i 's/pattern/replacement/' path
  const regex = /sed\s+-i\s+['"]s\/([^\/]+)\/([^\/]*)\/['"]\s+([^\s&|;<>]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(masked)) !== null) {
    try {
      const pattern = match[1] ?? '';
      const replacement = match[2] ?? '';
      const path = match[3]?.trim();

      if (!path || path.startsWith('-')) {
        continue;
      }

      edits.push({ path, pattern, replacement });
    } catch {
      // Skip invalid matches
    }
  }

  return edits;
}

function extractBashFileEdits(content: string): {
  writes: BashFileEdit[];
  directories: BashDirectoryEdit[];
  deletes: BashDeleteEdit[];
  patches: BashPatchEdit[];
} {
  return {
    writes: extractCatHeredocEdits(content),
    directories: extractMkdirEdits(content),
    deletes: extractRmEdits(content),
    patches: extractSedEdits(content),
  };
}

export interface FileEdit {
  path: string;
  content: string;
  action?: 'write' | 'delete' | 'patch' | 'mkdir'; // Optional action type for bash commands
  flags?: string; // For sed patches with flags (g, i, m)
  diff?: string; // Optional unified diff for patch operations
}

export interface DiffEdit {
  path: string;
  diff: string;
}

export interface DeleteEdit {
  path: string;
}

export interface PatchEdit {
  path: string;
  diff: string;
}

export interface ApplyDiffOperation {
  path: string;
  search: string;
  replace: string;
  thought?: string;
}

export interface ReasoningParseResult {
  reasoning: string;
  mainContent: string;
}

export interface ParsedFilesystemResponse {
  writes: FileEdit[];
  diffs: PatchEdit[];
  applyDiffs: ApplyDiffOperation[];
  deletes: string[];
  folders: string[];
}

function extractFencedBlocks(content: string, fenceName: string): string[] {
  const blocks: string[] = [];
  const opener = `\`\`\`${fenceName}`;
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const openIndex = content.indexOf(opener, searchFrom);
    if (openIndex === -1) break;

    const bodyStart = content.indexOf('\n', openIndex + opener.length);
    if (bodyStart === -1) break;

    const closeIndex = content.indexOf('```', bodyStart + 1);
    if (closeIndex === -1) break;

    blocks.push(content.slice(bodyStart + 1, closeIndex));
    searchFrom = closeIndex + 3;
  }

  return blocks;
}

function extractXmlBlocks(content: string, tagName: string): string[] {
  const blocks: string[] = [];
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const openIndex = content.indexOf(openTag, searchFrom);
    if (openIndex === -1) break;

    const bodyStart = openIndex + openTag.length;
    const closeIndex = content.indexOf(closeTag, bodyStart);
    if (closeIndex === -1) break;

    blocks.push(content.slice(bodyStart, closeIndex));
    searchFrom = closeIndex + closeTag.length;
  }

  return blocks;
}

/**
 * Extract HTML comment format: <!-- path -->content
 * Example: <!-- src/components/Card.vue --> ...content...
 * 
 * Only matches comments that look like file paths (contain path-like patterns)
 */
export function extractHtmlCommentFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  // Match: <!-- path/to/file -->content (stops at next <!-- or end)
  // Path must look like a file path: contains / OR . OR common file patterns
  // This avoids matching comments like <!-- TODO: fix this -->
  // FIX: Limit match scope to prevent catastrophic backtracking
  const regex = /<!--\s*([^\s\-]+(?:[\/\.][^\s\-]+)*|[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+)\s*-->\s*([\s\S]*?)(?=<!--|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const filePath = match[1]?.trim();
    const fileContent = match[2]?.trim() || '';
    if (!filePath || filePath.includes('-->')) continue;
    edits.push({ path: filePath, content: fileContent });
  }

  return edits;
}

/**
 * Extract <file_edit path="...">content</file_edit> compact format
 * Handles both with and without space: <file_edit path="..."> and <file_editpath="...">
 * 
 * IMPORTANT: Validates extracted paths to reject invalid patterns like CSS values,
 * Vue directives, and code snippets that may be mistakenly output as paths.
 */
export function extractCompactFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  // Use \s* to handle both spaced and non-spaced variants
  // FIX: Match ONLY complete <file_edit> blocks — require both opening and closing tags
  // The non-greedy ([\s\S]*?) matches all content including > characters (e.g. arrow functions)
  const regex = /<file_edit\s*path=["']([^"']+)["']\s*>([\s\S]*?)<\/file_edit>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const filePath = match[1]?.trim();
    const fileContent = match[2] ?? '';
    if (!filePath) continue;

    // CRITICAL: Validate path before adding
    // Rejects CSS values (0.3s,), Vue directives (@submit...), operators (=), etc.
    if (!isValidExtractedPath(filePath)) {
      continue;
    }

    // CRITICAL FIX: Skip edits with empty content - likely incomplete streaming tags
    // This prevents infinite loops from applying empty diffs
    if (!fileContent || fileContent.trim().length === 0) {
      continue;
    }

    edits.push({ path: filePath, content: fileContent.trim() });
  }

  return edits;
}

/**
 * Extract <file_write path="...">content</file_write> format
 * This is an alternative format used by some LLMs
 * Handles both with and without space: <file_write path="..."> and <file_writepath="...">
 * 
 * IMPORTANT: Validates extracted paths to reject invalid patterns.
 */
export function extractFileWriteEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  // Handle: <file_write path="...">content</file_write> OR <file_writepath="...">content</file_write>
  const regex = /<file_write\s*path=["']([^"']+)["']\s*>([\s\S]*?)<\/file_write>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const filePath = match[1]?.trim();
    let fileContent = match[2] ?? '';
    // Clean up leading/trailing whitespace
    fileContent = fileContent.replace(/^\n+/, '').replace(/\n+$/, '');
    if (!filePath) continue;

    // CRITICAL: Validate path before adding
    // Rejects CSS values, Vue directives, operators, and other non-path patterns
    if (!isValidExtractedPath(filePath)) {
      continue;
    }

    // CRITICAL FIX: Skip edits with empty content - likely incomplete streaming tags
    if (!fileContent || fileContent.trim().length === 0) {
      continue;
    }

    edits.push({ path: filePath, content: fileContent });
  }

  return edits;
}

/**
 * Extract multi-line <file_edit>\n<path>...</path>\ncontent\n</file_edit> format
 */
export function extractMultiLineFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  // Match: <file_edit>\n<path>\npath\n</path>\ncontent\n</file_edit>
  const regex = /<file_edit>\s*<path>\s*([^\s<]+)\s*<\/path>\s*([\s\S]*?)\s*<\/file_edit>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const filePath = match[1]?.trim();
    const fileContent = match[2] ?? '';
    if (!filePath) continue;

    // CRITICAL FIX: Validate path before adding
    // Skip paths with JSON/object syntax or ending with special chars
    if (filePath.includes('{') || filePath.includes('}') ||
        filePath.includes('[') || filePath.includes(']') ||
        filePath.endsWith('/') || filePath.endsWith(':') ||
        filePath.endsWith(',') || filePath.endsWith('{')) {
      continue;
    }

    // CRITICAL FIX: Skip edits with empty content - likely incomplete streaming tags
    if (!fileContent || fileContent.trim().length === 0) {
      continue;
    }

    edits.push({ path: filePath, content: fileContent.trim() });
  }

  return edits;
}

/**
 * Extract malformed file edit format where LLM outputs:
 * <path>...</path>
 * content
 * <file Edit> or <file_edit> (as closing marker)
 *
 * This handles cases where LLM doesn't properly wrap content in <file_edit> tags
 * 
 * CRITICAL: Skips <path> tags that appear to be SVG elements (inside <svg>...</svg>)
 * to prevent extracting SVG path data as file paths.
 */
export function extractMalformedFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Check if content contains SVG - if so, we need to be more careful
  const hasSvgContent = content.includes('<svg') && content.includes('</svg>');

  // Match: <path>path</path> followed by content, ending with <file_edit>
  // FIX: Require the closing <file_edit> marker — do NOT match at end of string ($)
  // to prevent extracting arbitrary XML content as file edits.
  // Handles: <file_edit>, <file edit>, <File_Edit>, <file_edit/>, <FILE_EDIT>
  const regex = /<path>\s*([^\s<]+?)\s*<\/path>\s*([\s\S]*?)<file[\s_]edit\s*\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const filePath = match[1]?.trim();
    let fileContent = match[2] ?? '';

    // Skip if path looks invalid or contains tags
    if (!filePath || filePath.includes('<') || filePath.includes('>')) continue;

    // CRITICAL FIX: Skip <path> tags that are inside SVG content
    // SVG <path> elements have d="..." attributes, not file paths
    if (hasSvgContent) {
      // Check if this <path> is likely inside an <svg> block
      const matchIndex = match.index;
      // Search from start of content for more accurate SVG detection
      const precedingContent = content.slice(0, matchIndex);
      const followingContent = content.slice(matchIndex);
      
      // If there's an <svg> tag before and </svg> after, skip this <path>
      const lastSvgOpen = precedingContent.lastIndexOf('<svg');
      const nextSvgClose = followingContent.indexOf('</svg>');
      if (lastSvgOpen !== -1 && nextSvgClose !== -1) {
        continue;
      }
      
      // Also skip if path looks like SVG path data (starts with M, L, C, Q, etc.)
      // SVG path commands: M(move), L(line), C(curve), Q(quad), S(smooth), H(horizontal), V(vertical), T(quad smooth), A(arc), Z(close)
      if (/^[MLCQSZHVTAmlcqs][0-9.\s,\-]*$/.test(filePath)) {
        continue;
      }
    }

    // CRITICAL FIX: Detect if <path> tag contains JSON/object instead of actual path
    // If content after </path> starts with { or [, the <path> tag was likely misused for JSON
    const trimmedContent = fileContent.trim();
    if (trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) {
      // This is JSON content, not a file path - skip entirely
      continue;
    }

    // CRITICAL FIX: Skip paths that contain JSON/object syntax
    // Valid file paths should NOT contain: { } [ ] : , (unless encoded)
    if (filePath.includes('{') || filePath.includes('}') ||
        filePath.includes('[') || filePath.includes(']')) {
      continue;
    }

    // Skip paths that end with special characters (likely parsing errors)
    if (filePath.endsWith('/') || filePath.endsWith(':') ||
        filePath.endsWith(',') || filePath.endsWith('{')) {
      continue;
    }

    // Remove trailing file edit markers from content (case insensitive)
    fileContent = fileContent.replace(/\s*<file\s*edit\s*>?\s*$/gi, '').trim();

    // Only add if there's actual content
    if (fileContent) {
      edits.push({ path: filePath, content: fileContent });
    }
  }

  return edits;
}

/**
 * Alias field names that LLMs use instead of the canonical "path" / "content".
 * Kept narrow to avoid misinterpreting unrelated fields.
 */
const PATH_ALIASES = ['path', 'file', 'filename', 'filepath', 'file_path', 'target'];
const CONTENT_ALIASES = ['content', 'contents', 'code', 'text', 'body'];

/**
 * Resolve a field from an object using a list of alias candidates.
 */
function resolveAlias(obj: Record<string, unknown>, aliases: string[]): unknown {
  for (const key of aliases) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

/**
 * Find the end of a balanced JSON object starting at `startIndex` (which should point to '{').
 * Accounts for string escaping, nested braces, and brackets.
 * Returns the exclusive end index, or -1 if no balanced object is found.
 *
 * Thin wrapper around the shared utility in json-tolerant.ts.
 */
function findBalancedJsonObject(content: string, startIndex: number): number {
  return findBalancedJson(content, startIndex);
}

/**
 * Extract JSON format: { "ws_action": "CREATE", "path": "...", "content": "..." }
 * This is an alternative format used by some LLMs
 */
export function extractWsActionEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Find JSON-like blocks by looking for ws_action pattern
  const wsActionPattern = /"ws_action"\s*:\s*"CREATE"/gi;
  let match: RegExpExecArray | null;

  while ((match = wsActionPattern.exec(content)) !== null) {
    // Find the opening brace before this match
    const startIndex = content.lastIndexOf('{', match.index);
    if (startIndex === -1) continue;

    const endIndex = findBalancedJsonObject(content, startIndex);
    if (endIndex === -1) continue;

    const jsonStr = content.substring(startIndex, endIndex);

    try {
      const obj = tolerantJsonParse(jsonStr) as { ws_action?: string; path?: string; content?: string };
      if (!obj || typeof obj !== 'object') continue;

      // Only process CREATE actions with valid path (must be string) and content
      if (obj.ws_action !== 'CREATE' || typeof obj.path !== 'string' || !obj.path.trim()) continue;

      // CRITICAL FIX: Skip edits with empty content
      if (!obj.content || obj.content.trim().length === 0) continue;

      edits.push({ path: obj.path.trim(), content: obj.content ?? '' });
    } catch {
      // Skip malformed JSON blocks
      continue;
    }
  }

  return edits;
}

/**
 * Extract simple JSON format: { "file_edit": "path/to/file", "content": "..." }
 * This is a simplified format for quick file edits
 */
export function extractSimpleJsonFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Look for "file_edit" key in JSON objects
  const fileEditPattern = /"file_edit"\s*:\s*"[^"]+"/gi;
  let match: RegExpExecArray | null;

  while ((match = fileEditPattern.exec(content)) !== null) {
    // Find the opening brace before this match
    const startIndex = content.lastIndexOf('{', match.index);
    if (startIndex === -1) continue;

    const endIndex = findBalancedJsonObject(content, startIndex);
    if (endIndex === -1) continue;

    const jsonStr = content.substring(startIndex, endIndex);

    try {
      const obj = tolerantJsonParse(jsonStr) as { file_edit?: string; content?: string };
      if (!obj || typeof obj !== 'object') continue;

      // Process if file_edit path exists and is a string
      if (typeof obj.file_edit !== 'string' || !obj.file_edit.trim()) continue;

      // CRITICAL FIX: Skip edits with empty content
      if (!obj.content || obj.content.trim().length === 0) continue;

      edits.push({ path: obj.file_edit.trim(), content: obj.content ?? '' });
    } catch {
      // Skip malformed JSON blocks
      continue;
    }
  }

  return edits;
}

/**
 * Extract files from markdown code blocks with filename hints
 * This handles LLMs that output code blocks with filename comments like:
 *
 * @deprecated Not currently used in the codebase.
 * Was created for a specific SSE vs. JSON response parsing issue that has been resolved.
 * Kept for potential future use or reference.
 *
 * @example
 * ```typescript
 * // src/app.tsx
 * export default function App() {...}
 * ```
 * Or:
 * ```
 * File: src/app.tsx
 * export default function App() {...}
 * ```
 */
export function extractMarkdownCodeBlockFiles(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Match code blocks with potential filename hints
  const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1] || '';
    const codeContent = match[2] || '';

    // Try to extract filename from first few lines
    const lines = codeContent.split('\n');
    let filePath: string | null = null;
    let contentStartLine = 0;

    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i].trim();

      // Pattern 1: // path/to/file.ts or # path/to/file.py
      const commentPathMatch = line.match(/^(?:\/\/|#)\s*([a-zA-Z0-9_./\-\\]+\.[a-zA-Z0-9]+)$/);
      if (commentPathMatch) {
        filePath = commentPathMatch[1].replace(/\\/g, '/');
        contentStartLine = i + 1;
        break;
      }

      // Pattern 2: File: path/to/file.ts or FILE: path/to/file.ts
      const filePrefixMatch = line.match(/^(?:File|FILE):\s*([a-zA-Z0-9_./\-\\]+\.[a-zA-Z0-9]+)$/i);
      if (filePrefixMatch) {
        filePath = filePrefixMatch[1].replace(/\\/g, '/');
        contentStartLine = i + 1;
        break;
      }
      // Note: Pattern 3 removed - redundant with Pattern 1 (same regex, Pattern 1 already matches paths without spaces)
    }

    // If we found a file path, extract the content
    if (filePath) {
      const fileContent = lines.slice(contentStartLine).join('\n').trim();
      if (fileContent) {
        edits.push({ path: filePath, content: fileContent });
      }
    }
  }

  return edits;
}

/**
 * Extract raw JSON tool calls from LLM text responses.
 *
 * FALLBACK: When function calling isn't supported (or the model ignores tools),
 * the LLM may output tool calls as plain JSON text like:
 *   { "tool": "batch_write", "arguments": { "files": [...] } }
 *   { "tool": "write_file", "arguments": { "path": "...", "content": "..." } }
 *
 * This parser catches those and converts them to FileEdit objects so the
 * legacy file-edit pipeline can still execute them.
 */
export function extractJsonToolCalls(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Fast-path: bail out if no JSON tool call signature present.
  // Check for multiple variants of tool-name and args field names.
  // Supports OpenAI ("tool"/"arguments"), Anthropic ("name"/"input"), and others.
  const hasToolField =
    content.includes('"tool"') ||
    content.includes('"function"') ||
    content.includes('"name"') ||
    content.includes('"tool_name"');
  const hasArgsField =
    content.includes('"arguments"') ||
    content.includes('"args"') ||
    content.includes('"parameters"') ||
    content.includes('"input"');
  if (!hasToolField || !hasArgsField) {
    return edits;
  }

  // Tool names that produce file edits
  const FILE_TOOLS = new Set(['write_file', 'write_files', 'batch_write', 'apply_diff', 'delete_file']);

  // Field name aliases (OpenAI, Anthropic, and other variants)
  const TOOL_FIELD_NAMES = ['tool', 'function', 'name', 'tool_name'];
  const ARGS_FIELD_NAMES = ['arguments', 'args', 'parameters', 'input'];

  // Scan for potential JSON objects — match any of the tool field name variants
  const toolPattern = /"(?:tool|function|name|tool_name)"\s*:\s*"([^"]+)"/gi;
  let match: RegExpExecArray | null;

  while ((match = toolPattern.exec(content)) !== null) {
    const toolName = match[1]?.toLowerCase();
    if (!FILE_TOOLS.has(toolName)) continue;

    // Find the enclosing JSON object for this match
    const toolIndex = match.index;
    const braceStart = content.lastIndexOf('{', toolIndex);
    if (braceStart === -1) continue;

    const endIndex = findBalancedJsonObject(content, braceStart);
    if (endIndex === -1) continue;

    const jsonStr = content.substring(braceStart, endIndex);

    // Use tolerant JSON parsing (handles trailing commas, single quotes, etc.)
    const obj = tolerantJsonParse(jsonStr);
    if (!obj || typeof obj !== 'object') continue;

    // Resolve tool name from any of the alias field names
    let resolvedToolName: string | undefined;
    for (const field of TOOL_FIELD_NAMES) {
      const val = (obj as Record<string, unknown>)[field];
      if (typeof val === 'string') { resolvedToolName = val.toLowerCase(); break; }
    }
    if (!resolvedToolName || !FILE_TOOLS.has(resolvedToolName)) continue;

    // Resolve args from any of the alias field names
    let args: Record<string, unknown> | undefined;
    for (const field of ARGS_FIELD_NAMES) {
      const val = (obj as Record<string, unknown>)[field];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        args = val as Record<string, unknown>;
        break;
      }
    }
    if (!args || typeof args !== 'object') continue;

    // Apply path/content alias resolution
    const path = resolveAlias(args, PATH_ALIASES);
    const contentField = resolveAlias(args, CONTENT_ALIASES);
    const diffField = resolveAlias(args, ['diff', 'patch', 'content', 'changes', 'delta']);
    const filesField = resolveAlias(args, ['files', 'items', 'operations']);

    if (resolvedToolName === 'write_file') {
      if (typeof path === 'string' && path.trim() && typeof contentField === 'string' && contentField.trim()) {
        if (isValidExtractedPath(path.trim())) {
          edits.push({ path: path.trim(), content: contentField });
        }
      }
    } else if (resolvedToolName === 'batch_write' || resolvedToolName === 'write_files') {
      if (Array.isArray(filesField)) {
        for (const file of filesField) {
          if (!file || typeof file !== 'object') continue;
          const fp = resolveAlias(file as Record<string, unknown>, PATH_ALIASES);
          const fc = resolveAlias(file as Record<string, unknown>, CONTENT_ALIASES);
          if (typeof fp === 'string' && fp.trim() && typeof fc === 'string' && fc.trim()) {
            if (isValidExtractedPath(fp.trim())) {
              edits.push({ path: fp.trim(), content: fc });
            }
          }
        }
      }
    } else if (resolvedToolName === 'apply_diff') {
      if (typeof path === 'string' && path.trim() && typeof diffField === 'string' && diffField.trim()) {
        if (isValidExtractedPath(path.trim())) {
          edits.push({ path: path.trim(), content: diffField, action: 'patch' });
        }
      }
    } else if (resolvedToolName === 'delete_file') {
      // Do NOT emit delete as a write-edit. Deletions must be handled through
      // a dedicated delete path — adding them to writes with empty content
      // causes downstream code to write an empty file instead of deleting.
      continue;
    }
  }

  return edits;
}

/**
 * Extract file edits from tool-name + fenced-code-block format.
 *
 * When the LLM can't do native function calling, it often outputs:
 *   batch_write
 *
 *   ```javascript
 *   [{ "path": "file.js", "content": "..." }]
 *   ```
 *
 * Or for single files:
 *   write_file
 *
 *   ```json
 *   { "path": "file.js", "content": "..." }
 *   ```
 *
 * This parser catches those patterns and converts them to FileEdit objects.
 */
function extractToolNameFencedBlocks(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Extract fenced code blocks — match ANY language tag (ts, tsx, python, etc.)
  // Non-JSON content is safely skipped by tolerantJsonParse returning undefined.
  const fencedRegex = /```[\w-]*\s*\n([\s\S]*?)```/gi;
  let fencedMatch: RegExpExecArray | null;

  while ((fencedMatch = fencedRegex.exec(content)) !== null) {
    const codeBlock = fencedMatch[1]?.trim();
    if (!codeBlock) continue;

    // Use tolerant JSON parsing (handles trailing commas, single quotes, unescaped newlines)
    const parsed = tolerantJsonParse(codeBlock);
    if (!parsed || typeof parsed !== 'object') continue;

    if (Array.isArray(parsed)) {
      // batch_write format: [{ path, content }, ...]
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const fp = resolveAlias(item as Record<string, unknown>, PATH_ALIASES);
        const fc = resolveAlias(item as Record<string, unknown>, CONTENT_ALIASES);
        if (typeof fp === 'string' && fp.trim() && typeof fc === 'string' && fc.trim()) {
          const trimmedPath = fp.trim();
          if (isValidExtractedPath(trimmedPath)) {
            edits.push({ path: trimmedPath, content: fc as string });
          }
        }
      }
    } else {
      // Single file format: { path, content } or { path, content, action? }
      const obj = parsed as Record<string, unknown>;
      const objPath = resolveAlias(obj, PATH_ALIASES);
      const objContent = resolveAlias(obj, CONTENT_ALIASES);

      if (typeof objPath === 'string' && typeof objContent === 'string') {
        const trimmedPath = objPath.trim();
        if (trimmedPath && isValidExtractedPath(trimmedPath)) {
          const action = (obj.action as string) || 'write';
          edits.push({ path: trimmedPath, content: objContent, action: action as FileEdit['action'] });
        }
      }
      // Also handle nested files array: { files: [...] }
      else if (Array.isArray(obj.files)) {
        for (const file of obj.files) {
          if (!file || typeof file !== 'object') continue;
          const fp = resolveAlias(file as Record<string, unknown>, PATH_ALIASES);
          const fc = resolveAlias(file as Record<string, unknown>, CONTENT_ALIASES);
          if (typeof fp === 'string' && fp.trim() && typeof fc === 'string' && fc.trim()) {
            const trimmedPath = fp.trim();
            if (isValidExtractedPath(trimmedPath)) {
              edits.push({ path: trimmedPath, content: fc as string });
            }
          }
        }
      }
    }
  }

  return edits;
}

/**
 * Extract both compact and multi-line file_edit formats
 * Also extracts file_write, ws_action, simple JSON formats, and raw JSON tool calls.
 * Uses conditional parsing - only runs regex if signature is detected
 *
 * NEW: Also extracts bash heredoc syntax (cat > file << 'EOF')
 *
 * Deduplicates by path (first occurrence wins) to handle cases where multiple
 * parsers might match the same file or LLM outputs duplicate edit blocks.
 * First wins is chosen because: if LLM shows the same file twice, the first
 * occurrence is typically the intended edit, and subsequent duplicates are
 * usually restatements or examples.
 */
export function extractFileEdits(content: string): FileEdit[] {
  // Fast-path: bail out if no file edit markers are present at all
  // Avoids running all individual extractors (and their sub-operations like maskHeredocs)
  // on content that contains no file edits — common in streaming parse windows
  const hasAnyMarker =
    content.includes('<file_edit') ||
    content.includes('<file_write') ||
    content.includes('ws_action') ||
    content.includes('"file_edit"') ||
    content.includes('<!--') ||
    content.includes('<path>') ||
    content.includes('<<') ||
    content.includes('cat') ||
    content.includes('mkdir') ||
    content.includes('rm ') ||
    content.includes('sed') ||
    content.includes('write_file(') ||
    content.includes('delete_file(') ||
    content.includes('apply_diff(') ||
    content.includes('batch_write(') ||
    content.includes('\nbatch_write') ||
    content.includes('\nwrite_file') ||
    content.startsWith('batch_write') ||
    content.startsWith('write_file') ||
    content.startsWith('write_files') ||
    content.startsWith('delete_file') ||
    content.startsWith('apply_diff') ||
    content.includes('\nwrite_files') ||
    content.includes('\ndelete_file') ||
    content.includes('\napply_diff') ||
    content.includes('```file:') ||
    content.includes('```diff') ||
    content.includes('```mkdir:') ||
    content.includes('```delete:') ||
    (content.includes('"tool"') && content.includes('"arguments"')) ||
    content.includes('<|tool_call_begin|>') ||
    (content.includes('```') && /\bbatch_write|write_files|create_files/i.test(content)) ||
    content.includes('```tool_call') ||
    content.includes('```tool-call') ||
    content.includes('```toolcall');

  if (!hasAnyMarker) {
    return [];
  }

  const allEdits: (FileEdit | DeleteEdit)[] = [];

  // Try bash heredoc syntax (writes, mkdir, deletes, patches)
  const bashEdits = extractBashFileEdits(content);

  // Process writes (default action is 'write')
  for (const write of bashEdits.writes) {
    allEdits.push({ 
      path: write.path, 
      content: write.content,
      action: 'write',
    });
  }

  // Process deletes with explicit action
  for (const del of bashEdits.deletes) {
    allEdits.push({ 
      path: del.path, 
      content: '',
      action: 'delete',
    });
  }

  // Process patches with explicit action
  for (const patch of bashEdits.patches) {
    allEdits.push({
      path: patch.path,
      content: `s/${patch.pattern}/${patch.replacement}/${patch.flags || ''}`,
      action: 'patch',
    });
  }

  // Process directories (mkdir) as write actions
  for (const dir of bashEdits.directories) {
    allEdits.push({
      path: dir.path,
      content: '',
      action: 'write',
    });
  }

  // Existing parsers (keep for backward compatibility)
  if (content.includes('<file_edit')) {
    allEdits.push(...extractCompactFileEdits(content));
    allEdits.push(...extractMultiLineFileEdits(content));
  }
  if (content.includes('<file_write')) {
    allEdits.push(...extractFileWriteEdits(content));
  }
  if (content.includes('ws_action')) {
    allEdits.push(...extractWsActionEdits(content));
  }
  if (content.includes('"file_edit"')) {
    allEdits.push(...extractSimpleJsonFileEdits(content));
  }

  // FALLBACK: Parse raw JSON tool calls (when LLM outputs tool calls as text
  // instead of using native function calling). Catches:
  //   { "tool": "batch_write", "arguments": { "files": [{ "path": ..., "content": ... }] } }
  //   { "tool": "write_file", "arguments": { "path": ..., "content": ... } }
  if (content.includes('"tool"') && content.includes('"arguments"')) {
    allEdits.push(...extractJsonToolCalls(content));
  }

  // FALLBACK: Parse tool-name + code-block format (common when LLM can't do FC).
  // Catches patterns like:
  //   batch_write
  //
  //   ```javascript
  //   [{ "path": "...", "content": "..." }]
  //   ```
  //   OR
  //   write_file
  //
  //   ```json
  //   { "path": "...", "content": "..." }
  //   ```
  // O(1) gate: only when a known tool name appears as plain text AND there's a code block
  const FILE_TOOL_NAMES = ['batch_write', 'write_file', 'write_files', 'delete_file', 'apply_diff', 'create_directory'];
  const hasToolName = FILE_TOOL_NAMES.some(t => new RegExp(`^${t}\\b`, 'mi').test(content));
  const hasFencedBlock = /```[\w-]*\s*\n/i.test(content); // Match ANY language tag (parser safely skips non-JSON)
  if (hasToolName && hasFencedBlock) {
    allEdits.push(...extractToolNameFencedBlocks(content));
  }

  // FALLBACK: Parse text-mode fenced file edits: ```file: path\ncontent\n```
  // Used when model doesn't support function calling — text-mode tool instructions
  // tell it to use this format for file creation/overwrite.
  if (content.includes('```file:')) {
    allEdits.push(...extractFencedFileEdits(content));
  }

  // FALLBACK: Parse text-mode fenced mkdir: ```mkdir: path\n```
  if (content.includes('```mkdir:')) {
    allEdits.push(...extractFencedMkdirEdits(content) as FileEdit[]);
  }

  // FALLBACK: Parse text-mode fenced delete: ```delete: path\n```
  if (content.includes('```delete:')) {
    allEdits.push(...extractFencedDeleteBlocks(content) as FileEdit[]);
  }

  // FALLBACK: Extract file edits from standard markdown code blocks with filename references
  // Catches: ```javascript // calculator.js or ```python # hello.py
  // This handles LLM output that uses standard code blocks instead of structured ```file: format
  if (/```(?:javascript|js|typescript|ts|python|py|json)/i.test(content)) {
    allEdits.push(...extractCodeBlockFileEdits(content));
  }

  // FALLBACK: Parse JavaScript-style MCP tool calls from ```javascript code blocks
  // Catches: write_file("path", "content"), delete_file("path"), mkdir("path"), apply_diff("path", "diff")
  // Only activates when there's a ```javascript/js block AND a tool call signature
  // This handles models that output JS function calls instead of native function calling
  // O(1) signature gate: only runs expensive regexes when both signatures are present
  const hasJsBlock = /```(?:javascript|js)/i.test(content);
  const hasToolSig = /(?:write_file|batch_write|delete_file|apply_diff|mkdir)\s*\(/i.test(content);
  if (hasJsBlock && hasToolSig) {
    const decodeEscapes = (s: string) => {
      // Single-pass replacement handles all escape sequences including \\ -> \
      // Order matters: \\ must be handled BEFORE \n, \t, etc.
      return s.replace(/\\([\\ntr'"0])/g, (_, esc) => {
        switch (esc) {
          case '\\': return '\\';
          case 'n': return '\n';
          case 't': return '\t';
          case 'r': return '\r';
          case "'": return "'";
          case '"': return '"';
          case '0': return '\0';
          default: return esc;
        }
      });
    };

    // Helper: extract calls like funcName("arg1", "arg2") with proper escape handling
    // Uses a non-greedy match between quotes to handle nested opposite quotes
    const extractJsToolCalls = (funcName: string, argCount: number): Array<string[]> => {
      const results: Array<string[]> = [];
      // Build pattern for N quoted string args
      // Double-quoted: "(?:[^"\\]|\\.)*" - matches string with escape sequences
      // Single-quoted: '(?:[^'\\]|\\.)*'
      const dq = '"(?:[^"\\\\]|\\\\.)*"';
      const sq = "'(?:[^'\\\\]|\\\\.)*'";

      // Build patterns for each arg count
      const dqPatterns: string[] = [];
      const sqPatterns: string[] = [];
      for (let i = 0; i < argCount; i++) {
        dqPatterns.push(`\\s*(${dq})\\s*`);
        sqPatterns.push(`\\s*(${sq})\\s*`);
      }

      const argsDq = dqPatterns.join(',');
      const argsSq = sqPatterns.join(',');
      const fullDq = new RegExp(`${funcName}\\s*\\(${argsDq}\\)`, 'gi');
      const fullSq = new RegExp(`${funcName}\\s*\\(${argsSq}\\)`, 'gi');

      for (const regex of [fullDq, fullSq]) {
        let m: RegExpExecArray | null;
        while ((m = regex.exec(content)) !== null) {
          // Strip surrounding quotes from each captured arg
          const args = m.slice(1).map(a => a?.slice(1, -1) ?? '');
          results.push(args);
        }
      }
      return results;
    };

    // write_file("path", "content")
    for (const [path, rawContent] of extractJsToolCalls('write_file', 2)) {
      const trimmedPath = path.trim();
      const fileContent = decodeEscapes(rawContent);
      if (trimmedPath && isValidExtractedPath(trimmedPath) && fileContent.trim()) {
        if (!allEdits.some(e => e.path === trimmedPath && 'content' in e && (e as FileEdit).content.trim() === fileContent.trim())) {
          allEdits.push({ path: trimmedPath, content: fileContent });
        }
      }
    }

    // delete_file("path")
    for (const [path] of extractJsToolCalls('delete_file', 1)) {
      const trimmedPath = path.trim();
      if (trimmedPath && isValidExtractedPath(trimmedPath)) {
        if (!allEdits.some(e => e.path === trimmedPath && 'action' in e && (e as FileEdit).action === 'delete')) {
          allEdits.push({ path: trimmedPath, content: '', action: 'delete' } as FileEdit);
        }
      }
    }

    // apply_diff("path", "diff")
    for (const [path, rawDiff] of extractJsToolCalls('apply_diff', 2)) {
      const trimmedPath = path.trim();
      const diff = decodeEscapes(rawDiff);
      if (trimmedPath && isValidExtractedPath(trimmedPath) && diff.trim()) {
        if (!allEdits.some(e => e.path === trimmedPath && 'action' in e && (e as FileEdit).action === 'patch')) {
          allEdits.push({ path: trimmedPath, content: diff, action: 'patch' });
        }
      }
    }

    // mkdir("path")
    for (const [path] of extractJsToolCalls('mkdir', 1)) {
      const trimmedPath = path.trim();
      if (trimmedPath && isValidExtractedPath(trimmedPath)) {
        if (!allEdits.some(e => e.path === trimmedPath && 'action' in e && (e as FileEdit).action === 'mkdir')) {
          allEdits.push({ path: trimmedPath, content: '', action: 'mkdir' });
        }
      }
    }

    // Handle JSON object format: write_file({ "path": "...", "content": "..." })
    // Also handles: create_file({ ... }), writeToFile({ ... }), delete_file({ ... }), apply_diff({ ... })
    allEdits.push(...extractTextToolCallEdits(content));

    // Handle batch_write([{ path: "...", content: "..." }, ...]) format
    // Common when LLM outputs multiple files in a single batch call
    allEdits.push(...extractBatchWriteEdits(content));
  }

  // Handle flat JSON tool calls: { "tool": "write_file", "path": "...", "content": "..." }
  // (no "arguments" wrapper — distinct from extractJsonToolCalls which expects nested "arguments")
  // Fast gate: must have both "tool" key and a file-edit tool name
  if (content.includes('"tool"') && /"write_file"|"create_file"|"write_files"|"batch_write"|"delete_file"|"apply_diff"|"mkdir"/i.test(content)) {
    allEdits.push(...extractFlatJsonToolCalls(content));
  }

  // Handle tool tag format: [Tool: write_file] { "path": "...", "content": "..." }
  if (content.includes('[Tool:')) {
    allEdits.push(...extractToolTagEdits(content));
  }

  // Format D: <function=tool_name> format (Mistral)
  if (content.includes('<function=')) {
    const funcs = content.match(/<function=(\w+)>[\s\S]*?<\/function>/gi) || [];
    for (const funcBlock of funcs) {
      const nameMatch = /<function=(\w+)>/i.exec(funcBlock);
      if (!nameMatch) continue;
      const name = nameMatch[1].toLowerCase();
      if (!['write_file','create_file','delete_file','apply_diff','mkdir'].includes(name)) continue;
      
      const pathMatch = /<parameter=path>([^<\n]+)/i.exec(funcBlock);
      if (!pathMatch) continue;
      const path = pathMatch[1].trim();
      if (!path || !isValidExtractedPath(path)) continue;
      
      let action: 'write' | 'delete' | 'patch' | 'mkdir' = name === 'delete_file' ? 'delete' : name === 'apply_diff' ? 'patch' : name === 'mkdir' ? 'mkdir' : 'write';
      let fileContent = '';
      
      if (action === 'write') {
        const contentMatch = /<parameter=content>([\s\S]*?)(?:<\/parameter>|$)/i.exec(funcBlock);
        fileContent = contentMatch ? contentMatch[1].trim() : '';
        if (!fileContent) continue;
      }
      
      allEdits.push({ path, content: fileContent, action });
    }
  }

  if (content.includes('<!--')) {
    allEdits.push(...extractHtmlCommentFileEdits(content));
  }
  // Handle malformed format where LLM outputs <path>...</path> without proper wrapping
  // Require both opening and closing tags to avoid false positives on SVG/XML content
  if (content.includes('<path>') && content.includes('</path>')) {
    allEdits.push(...extractMalformedFileEdits(content));
  }

  // Format A — Special-token tool calls (<|tool_call_begin|> ... <|tool_call_end|>)
  if (content.includes('<|tool_call_begin|>')) {
    allEdits.push(...extractSpecialTokenToolCalls(content));
  }

  // Format B — Fenced batch_write (```javascript\nbatch_write([...])\n```)
  if (content.includes('```') && /\bbatch_write|write_files|create_files/i.test(content)) {
    allEdits.push(...extractFencedBatchWrite(content));
  }

  // Format C — ```tool_call fenced blocks
  if (/```tool[-_]?call/i.test(content)) {
    allEdits.push(...extractToolCallFencedBlock(content));
  }

  // Deduplicate by path (first occurrence wins)
  // This handles cases where multiple parsers match the same file or LLM outputs duplicates
  const dedupedEdits = new Map<string, FileEdit>();
  for (const edit of allEdits) {
    // Only set if path not already in map (first wins)
    if (!dedupedEdits.has(edit.path) && 'content' in edit) {
      dedupedEdits.set(edit.path, edit as FileEdit);
    }
  }

  return Array.from(dedupedEdits.values());
}

/**
 * Extract fenced diff blocks: ```diff path\ncontent\n``` or ```diff: path\ncontent\n```
 *
 * FIX: Now correctly distinguishes between:
 * - ```diff path\n<unified diff content>``` (diff patch for a file)
 * - ```diff: path\n<unified diff content>``` (text-mode diff for non-FC models)
 * - ```diff\ndiff --git a/path b/path\n...``` (raw git diff output - should NOT be parsed as file edit)
 */
/**
 * Extract batch_write([{ path: "...", content: "..." }, ...]) format.
 *
 * Handles LLM output where multiple files are written in a single batch call:
 *   batch_write([{
 *     path: "package.json",
 *     content: `{...}`
 *   }, {
 *     path: "src/main.js",
 *     content: `...`
 *   }])
 *
 * Also handles: create_files(...), write_files(...), batch_create(...)
 */
export function extractBatchWriteEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Check for batch function patterns
  const batchPattern = /(batch_write|create_files|write_files|batch_create)\s*\(/gi;
  let batchMatch: RegExpExecArray | null;

  while ((batchMatch = batchPattern.exec(content)) !== null) {
    const startIdx = batchMatch.index + batchMatch[0].length;

    // Find the matching closing paren with balanced bracket tracking
    let bracketDepth = 0;
    let parenDepth = 1; // We're already inside the opening (
    let inString = false;
    let stringChar = '';
    let escapeNext = false;
    let endIdx = -1;

    for (let i = startIdx; i < content.length; i++) {
      const ch = content[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (inString) {
        if (ch === '\\') {
          escapeNext = true;
          continue;
        }
        if (ch === stringChar) {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
      }

      if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
      else if (ch === '(') parenDepth++;
      else if (ch === ')') {
        parenDepth--;
        if (parenDepth === 0 && bracketDepth <= 0) {
          endIdx = i;
          break;
        }
      }
    }

    if (endIdx === -1) continue;

    // Extract the array content
    const arrayContent = content.substring(startIdx, endIdx).trim();

    // Now parse individual { path, content } objects from the array
    // Use a state machine to handle nested objects with template literals
    const fileObjects = parseFileObjectsFromArray(arrayContent);

    for (const fileObj of fileObjects) {
      if (fileObj.path && isValidExtractedPath(fileObj.path)) {
        const fileContent = fileObj.content || fileObj.diff || '';
        if (fileContent.trim()) {
          const action = fileObj.diff ? 'patch' as const : 'write' as const;
          if (!edits.some(e => e.path === fileObj.path)) {
            edits.push({
              path: fileObj.path,
              content: fileContent,
              action,
            });
          }
        }
      }
    }
  }

  return edits;
}

/**
 * Parse { path: "...", content: "..." } objects from a JavaScript array string.
 * Handles both JSON-style ("key": "value") and JS-style (key: "value") objects.
 * Also handles template literals with backticks for multi-line content.
 */
function parseFileObjectsFromArray(arrayContent: string): Array<{ path?: string; content?: string; diff?: string }> {
  const objects: Array<{ path?: string; content?: string; diff?: string }> = [];

  let i = 0;
  while (i < arrayContent.length) {
    // Skip whitespace and commas
    while (i < arrayContent.length && /[\s,]/.test(arrayContent[i])) i++;
    if (i >= arrayContent.length) break;

    // Look for opening {
    if (arrayContent[i] !== '{') {
      i++;
      continue;
    }

    // Find matching }
    const objStart = i;
    let braceDepth = 0;
    let inString = false;
    let stringChar = '';
    let escapeNext = false;
    let objEnd = -1;

    for (let j = i; j < arrayContent.length; j++) {
      const ch = arrayContent[j];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (inString) {
        if (ch === '\\' && stringChar !== '`') {
          escapeNext = true;
          continue;
        }
        if (ch === stringChar) {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
      }

      if (ch === '{') braceDepth++;
      else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          objEnd = j;
          break;
        }
      }
    }

    if (objEnd === -1) break;

    // Extract and parse the object
    const objStr = arrayContent.substring(objStart, objEnd + 1);
    const parsed = parseSimpleFileObject(objStr);
    if (parsed && (parsed.path || parsed.content)) {
      objects.push(parsed);
    }

    i = objEnd + 1;
  }

  return objects;
}

/**
 * Parse a single { path: "...", content: "..." } object string.
 * Handles both quoted and unquoted keys, and template literal values.
 * Now supports field aliases (file->path, code->content, etc.) for LLM robustness.
 */
function parseSimpleFileObject(objStr: string): { path?: string; content?: string; diff?: string } | null {
  const result: { path?: string; content?: string; diff?: string } = {};

  // Extended key patterns to support common LLM mistakes
  // path aliases: path, file, filename, filepath, file_path, target
  // content aliases: content, contents, code, text, body, data, source
  // diff aliases: diff, patch, changes, delta
  const kvRegex = /(?:^|[,{\n])\s*["']?(path|file|filename|filepath|file_path|filePath|target|content|contents|code|text|body|data|source|diff|patch|changes|delta)["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/gis;
  let match: RegExpExecArray | null;

  while ((match = kvRegex.exec(objStr)) !== null) {
    const rawKey = match[1].toLowerCase();
    let value = match[2];

    // Strip surrounding quotes/backticks
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
      // Unescape
      value = value.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    } else if (value.startsWith('`') && value.endsWith('`')) {
      value = value.slice(1, -1);
    }

    // Map aliases to canonical fields (only set if not already set - first match wins)
    const pathAliases = ['path', 'file', 'filename', 'filepath', 'file_path', 'filePath', 'target'];
    const contentAliases = ['content', 'contents', 'code', 'text', 'body', 'data', 'source'];
    const diffAliases = ['diff', 'patch', 'changes', 'delta'];

    if (pathAliases.includes(rawKey) && !result.path) {
      result.path = value;
    } else if (contentAliases.includes(rawKey) && !result.content) {
      result.content = value;
    } else if (diffAliases.includes(rawKey) && !result.diff) {
      result.diff = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Extract tool-call-style file edits using balanced paren/brace scanning.
 *
 * Handles LLM output formats where models without function calling still
 * output tool-like text:
 * - write_file({ "path": "...", "content": "..." })
 * - create_file({ "path": "...", "content": "..." })
 * - writeToFile({ "path": "...", "content": "..." })
 * - delete_file({ "path": "..." })
 * - apply_diff({ "path": "...", "diff": "..." })
 * - mkdir({ "path": "..." })
 *
 * Uses balanced scanning to correctly handle nested braces, strings,
 * and escape sequences (same technique as ToolLoopAgent.parseTextToolCalls).
 */
export function extractTextToolCallEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Tool names that write/modify files
  const toolPatterns = [
    { name: 'write_file', args: ['path', 'content'], action: 'write' as const },
    { name: 'create_file', args: ['path', 'content'], action: 'write' as const },
    { name: 'writeToFile', args: ['path', 'content'], action: 'write' as const },
    { name: 'delete_file', args: ['path'], action: 'delete' as const },
    { name: 'apply_diff', args: ['path', 'diff'], action: 'patch' as const },
    { name: 'mkdir', args: ['path'], action: 'mkdir' as const },
  ];

  for (const tool of toolPatterns) {
    const pattern = new RegExp(`${tool.name}\\s*\\(`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      try {
        const startIdx = m.index + m[0].length;
        // Balanced scan: find the closing ) while tracking brace depth and string state
        let depth = 0, inString = false, escapeNext = false, endIdx = -1;
        for (let i = startIdx; i < content.length; i++) {
          const ch = content[i];
          if (escapeNext) { escapeNext = false; continue; }
          if (ch === '\\' && inString) { escapeNext = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === '{' || ch === '(') depth++;
          else if (ch === '}' || ch === ')') {
            if (depth <= 0 && ch === ')') { endIdx = i; break; }
            depth--;
          }
        }
        if (endIdx === -1) continue;

        const argText = content.substring(startIdx, endIdx).trim();
        const openBrace = argText.indexOf('{');
        const closeBrace = argText.lastIndexOf('}');
        if (openBrace === -1 || closeBrace === -1 || closeBrace <= openBrace) continue;

        const jsonStr = argText.substring(openBrace, closeBrace + 1);
        if (jsonStr.trim() === '{}') continue;

        const args = tolerantJsonParse(jsonStr);
        if (!args || typeof args !== 'object') continue;
        const pathVal = (args as Record<string, unknown>)[tool.args[0]];
        if (!pathVal) continue;

        const trimmedPath = String(pathVal).trim();
        if (!trimmedPath || !isValidExtractedPath(trimmedPath)) continue;

        // For write/create/writeToFile, content/diff is required
        if (tool.action === 'write' || tool.action === 'patch') {
          const contentVal = args[tool.args[1]];
          if (!contentVal || !String(contentVal).trim()) continue;
          if (!edits.some(e => e.path === trimmedPath)) {
            edits.push({
              path: trimmedPath,
              content: String(contentVal),
              action: tool.action,
            });
          }
        } else {
          // delete/mkdir — no content required
          if (!edits.some(e => e.path === trimmedPath)) {
            edits.push({ path: trimmedPath, content: '', action: tool.action });
          }
        }
      } catch {
        // Skip malformed JSON or parse errors
      }
    }
  }

  return edits;
}

/**
 * Extract flat JSON tool calls: { "tool": "write_file", "path": "...", "content": "..." }
 *
 * This handles the format where the LLM outputs a JSON object with a "tool" key
 * and the file-edit fields directly at the top level (no "arguments" wrapper).
 *
 * Distinct from extractJsonToolCalls which expects nested "arguments": {...}.
 *
 * Uses balanced brace scanning to correctly extract complete JSON objects
 * even when they contain nested braces (e.g., JSON content).
 */
export function extractFlatJsonToolCalls(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  const fileEditTools = ['write_file', 'create_file', 'writeToFile', 'write_files', 'batch_write', 'delete_file', 'apply_diff', 'mkdir'];
  const patternStart = /\{/g;
  let m: RegExpExecArray | null;

  while ((m = patternStart.exec(content)) !== null) {
    try {
      const openIdx = m.index;
      // Balanced scan to find matching }
      let depth = 0, inString = false, escapeNext = false, closeIdx = -1;
      for (let i = openIdx; i < content.length; i++) {
        const ch = content[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (ch === '\\' && inString) { escapeNext = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { closeIdx = i; break; } }
      }
      if (closeIdx === -1) continue;

      const jsonStr = content.substring(openIdx, closeIdx + 1);
      // Quick gate: must contain "tool" or "name" key
      if (!jsonStr.includes('"tool"') && !jsonStr.includes('"name"')) continue;

      const parsed = tolerantJsonParse(jsonStr);
      if (!parsed || typeof parsed !== 'object') continue;
      const obj = parsed as Record<string, unknown>;
      const toolName = String(obj.tool || obj.name || '').toLowerCase();
      if (!fileEditTools.includes(toolName)) continue;

      // Handle batch_write / write_files: { files: [{ path, content }, ...] }
      if (toolName === 'batch_write' || toolName === 'write_files') {
        const files = obj.files;
        if (Array.isArray(files)) {
          for (const file of files) {
            if (!file || typeof file !== 'object') continue;
            const f = file as Record<string, unknown>;
            const path = resolveAlias(f, PATH_ALIASES);
            const fileContent = resolveAlias(f, CONTENT_ALIASES);
            if (typeof path === 'string' && path.trim() && typeof fileContent === 'string' && fileContent.trim()) {
              const trimmedPath = path.trim();
              if (isValidExtractedPath(trimmedPath) && !edits.some(e => e.path === trimmedPath)) {
                edits.push({ path: trimmedPath, content: fileContent as string });
              }
            }
          }
        }
        continue;
      }

      const pathVal = resolveAlias(obj, PATH_ALIASES);
      if (!pathVal || !String(pathVal).trim()) continue;
      const trimmedPath = String(pathVal).trim();
      if (!isValidExtractedPath(trimmedPath)) continue;

      // Map tool name to action, resolve content with alias support
      let action: FileEdit['action'] = 'write';
      let contentVal = resolveAlias(obj, CONTENT_ALIASES) || '';
      if (toolName === 'delete_file') action = 'delete';
      else if (toolName === 'apply_diff') {
        action = 'patch';
        contentVal = resolveAlias(obj, ['diff', 'patch', 'content', 'changes', 'delta']) || '';
      }
      else if (toolName === 'mkdir') action = 'mkdir';

      // For write/patch actions, content/diff is required
      if ((action === 'write' || action === 'patch') && (!contentVal || !String(contentVal).trim())) continue;

      if (!edits.some(e => e.path === trimmedPath)) {
        edits.push({ path: trimmedPath, content: String(contentVal), action });
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return edits;
}

// ═══════════════════════════════════════════════════════════════════════════
// Format A — Special-token tool calls (<|tool_call_begin|> ... <|tool_call_end|>)
// Format B — Fenced batch_write (```javascript\nbatch_write([...])\n```)
// Format C — ```tool_call fenced blocks
// ═══════════════════════════════════════════════════════════════════════════

function findJsonEnd(text: string, start: number): number {
  const opening = text[start];
  if (opening !== '{' && opening !== '[') return -1;
  const closing = opening === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === opening) depth++;
    else if (ch === closing) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

function extractJsonString(source: string): { value: string; endOffset: number } | null {
  if (!source.startsWith('"')) return null;
  let i = 1, out = '', innerBrace = 0, innerBracket = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1];
      switch (next) {
        case 'n': out += '\n'; break; case 't': out += '\t'; break;
        case 'r': out += '\r'; break; case '"': out += '"'; break;
        case '\\': out += '\\'; break; case '/': out += '/'; break;
        default: out += next; break;
      }
      i += 2; continue;
    }
    if (ch === '\n') { out += '\n'; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '{') innerBrace++; else if (ch === '}') innerBrace--;
    else if (ch === '[') innerBracket++; else if (ch === ']') innerBracket--;
    if (ch === '"' && innerBrace === 0 && innerBracket === 0) return { value: out, endOffset: i + 1 };
    out += ch; i++;
  }
  return { value: out, endOffset: i };
}

function extractFilesRobust(body: string): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  const pathRe = /"path"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(body)) !== null) {
    const path = m[1].trim();
    if (!path) continue;
    const contentKeyIdx = body.indexOf('"content"', m.index + m[0].length);
    if (contentKeyIdx === -1) continue;
    const afterColon = body.slice(contentKeyIdx + '"content"'.length).trimStart();
    if (!afterColon.startsWith(':')) continue;
    const val = afterColon.slice(1).trimStart();
    let contentValue = '';
    if (val.startsWith('"')) {
      const extracted = extractJsonString(val);
      if (extracted) contentValue = extracted.value;
    } else if (val.startsWith('{') || val.startsWith('[')) {
      const end = findJsonEnd(val, 0);
      if (end !== -1) {
        try { contentValue = JSON.stringify(JSON.parse(val.slice(0, end)), null, 2); } catch { contentValue = val.slice(0, end); }
      }
    }
    if (contentValue) results.push({ path, content: contentValue });
  }
  return results;
}

function filesArrayToEdits(files: unknown[], out: FileEdit[], seenPaths: Set<string>): void {
  for (const file of files) {
    if (!file || typeof file !== 'object') continue;
    const f = file as Record<string, unknown>;
    const rawPath = f.path ?? f.file ?? f.filename;
    if (typeof rawPath !== 'string' || !rawPath.trim()) continue;
    const path = rawPath.trim();
    if (!isValidExtractedPath(path)) continue;
    if (seenPaths.has(path)) continue;
    const rawContent = f.content ?? f.data ?? f.body ?? f.text ?? f.source;
    let content: string;
    if (typeof rawContent === 'string') { content = rawContent; }
    else if (rawContent !== undefined && rawContent !== null) {
      try { content = JSON.stringify(rawContent, null, 2); } catch { continue; }
    } else { continue; }
    if (!content.trim()) continue;
    seenPaths.add(path);
    out.push({ path, content });
  }
}

export function extractSpecialTokenToolCalls(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  if (!content.includes('<|tool_call')) return edits;
  const blockRe = /<\|tool_call_begin\|>\s*([\w.:-]+)\s*(?:<\|tool_call_argument_begin\|>)?\s*([\s\S]*?)<\|tool_call_end\|>/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(content)) !== null) {
    const toolFull = block[1] ?? '';
    const toolName = toolFull.replace(/^[^.]+\./, '').replace(/:\d+$/, '');
    const body = (block[2] ?? '').trim();
    if (!body) continue;
    const firstBrace = body.search(/[{[]/);
    if (firstBrace === -1) continue;
    const seenPaths = new Set<string>();
    const endIdx = findJsonEnd(body, firstBrace);
    if (endIdx !== -1) {
      try {
        const parsed = tolerantJsonParse(body.slice(firstBrace, endIdx));
        if (!parsed || typeof parsed !== 'object') continue;
        const obj = parsed as Record<string, unknown>;
        const files = obj.files ?? obj.data ?? obj.items;
        if (Array.isArray(files)) { filesArrayToEdits(files, edits, seenPaths); continue; }
        if (typeof obj.path === 'string') { filesArrayToEdits([obj], edits, seenPaths); continue; }
        continue;
      } catch { /* fall through */ }
    }
    const robustFiles = extractFilesRobust(body.slice(firstBrace));
    for (const f of robustFiles) {
      if (!isValidExtractedPath(f.path) || seenPaths.has(f.path)) continue;
      seenPaths.add(f.path);
      edits.push({ path: f.path, content: f.content });
    }
  }
  return edits;
}

export function extractFencedBatchWrite(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  if (!content.includes('```')) return edits;
  const BATCH_TOOL_RE = /\b(batch_write|write_files?|create_files?|batch_create)\s*\(\s*/gi;
  if (!BATCH_TOOL_RE.test(content)) return edits;
  BATCH_TOOL_RE.lastIndex = 0;
  let pos = 0;
  const FENCE = '```';
  while (pos < content.length) {
    const openIdx = content.indexOf(FENCE, pos);
    if (openIdx === -1) break;
    const bodyStart = content.indexOf('\n', openIdx + FENCE.length);
    if (bodyStart === -1) break;
    const closeIdx = content.indexOf(FENCE, bodyStart + 1);
    if (closeIdx === -1) break;
    const blockBody = content.slice(bodyStart + 1, closeIdx);
    pos = closeIdx + FENCE.length;
    BATCH_TOOL_RE.lastIndex = 0;
    let callMatch: RegExpExecArray | null;
    while ((callMatch = BATCH_TOOL_RE.exec(blockBody)) !== null) {
      const afterParen = callMatch.index + callMatch[0].length;
      const firstChar = blockBody[afterParen];
      if (firstChar !== '[' && firstChar !== '{') continue;
      const endIdx = findJsonEnd(blockBody, afterParen);
      if (endIdx === -1) continue;
      const argSlice = blockBody.slice(afterParen, endIdx);
      let files: unknown[] | undefined;
      try {
        const parsed = JSON.parse(argSlice);
        if (Array.isArray(parsed)) files = parsed;
        else if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          const inner = obj.files ?? obj.data ?? obj.items;
          if (Array.isArray(inner)) files = inner;
        }
      } catch { /* skip */ }
      if (files && files.length > 0) filesArrayToEdits(files, edits, new Set());
    }
  }
  return edits;
}

export function extractToolCallFencedBlock(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  const TOOL_CALL_FENCE_RE = /```(?:tool[-_]?call|TOOL[-_]?CALL)\s*\n/gi;
  if (!TOOL_CALL_FENCE_RE.test(content)) return edits;
  TOOL_CALL_FENCE_RE.lastIndex = 0;
  const TOOL_NAME_KEYS = ['tool_name', 'toolName', 'name', 'tool', 'function', 'function_name'];
  const ARGS_KEYS = ['parameters', 'arguments', 'args', 'params', 'input'];
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = TOOL_CALL_FENCE_RE.exec(content)) !== null) {
    const bodyStart = fenceMatch.index + fenceMatch[0].length;
    const closeIdx = content.indexOf('```', bodyStart);
    if (closeIdx === -1) break;
    const blockBody = content.slice(bodyStart, closeIdx).trim();
    if (!blockBody.startsWith('{')) continue;
    const parsed = tolerantJsonParse(blockBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const obj = parsed as Record<string, unknown>;
    let toolName = '';
    for (const key of TOOL_NAME_KEYS) { if (typeof obj[key] === 'string') { toolName = obj[key] as string; break; } }
    if (!toolName) continue;
    let args: Record<string, unknown> = obj;
    for (const key of ARGS_KEYS) {
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        args = obj[key] as Record<string, unknown>; break;
      }
    }
    const rawFiles = args.files ?? args.items ?? args.data ?? resolveAlias(args, ['files', 'items', 'operations', 'batch']) ?? (typeof args.path === 'string' ? [args] : null);
    if (!rawFiles) continue;
    const fileList = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
    filesArrayToEdits(fileList, edits, new Set());
  }
  return edits;
}

/**
 * Extract tool tag format: [Tool: write_file] { "path": "...", "content": "..." }
 *
 * This handles the format where the LLM outputs a tool tag marker followed by
 * a JSON object with file-edit fields directly at the top level.
 *
 * Uses balanced brace scanning to correctly extract complete JSON objects.
 */




export function extractToolTagEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  const fileEditTools = ['write_file', 'create_file', 'writeToFile', 'write_files', 'batch_write', 'delete_file', 'apply_diff', 'mkdir'];
  const pattern = /\[\s*Tool:\s*(\w+)\s*\]/gi;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(content)) !== null) {
    const toolName = (m[1] || '').toLowerCase();
    if (!fileEditTools.includes(toolName)) continue;

    try {
      const tagEndIdx = m.index + m[0].length;
      const afterTag = content.substring(tagEndIdx);
      const openBrace = afterTag.indexOf('{');
      if (openBrace === -1) continue;

      // Balanced scan to find matching }
      let depth = 0, inString = false, escapeNext = false, closeIdx = -1;
      for (let i = openBrace; i < afterTag.length; i++) {
        const ch = afterTag[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (ch === '\\' && inString) { escapeNext = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { closeIdx = i; break; } }
      }
      if (closeIdx === -1) continue;

      const jsonStr = afterTag.substring(openBrace, closeIdx + 1);
      if (jsonStr.trim() === '{}') continue;

      const parsed = JSON.parse(jsonStr);
      if (jsonStr.trim() === '{}') continue;

      // Handle batch_write / write_files: { files: [{ path, content }, ...] }
      if (toolName === 'batch_write' || toolName === 'write_files') {
        const files = parsed.files;
        if (Array.isArray(files)) {
          for (const file of files) {
            const path = file.path;
            const fileContent = file.content;
            if (typeof path === 'string' && path.trim() && typeof fileContent === 'string' && fileContent.trim()) {
              const trimmedPath = path.trim();
              if (isValidExtractedPath(trimmedPath) && !edits.some(e => e.path === trimmedPath)) {
                edits.push({ path: trimmedPath, content: fileContent });
              }
            }
          }
        }
        continue;
      }

      const pathVal = parsed.path;
      if (!pathVal || !String(pathVal).trim()) continue;
      const trimmedPath = String(pathVal).trim();
      if (!isValidExtractedPath(trimmedPath)) continue;

      // Map tool name to action
      let action: FileEdit['action'] = 'write';
      let contentVal = parsed.content || '';
      if (toolName === 'delete_file') action = 'delete';
      else if (toolName === 'apply_diff') { action = 'patch'; contentVal = parsed.diff || ''; }
      else if (toolName === 'mkdir') action = 'mkdir';

      // For write/patch actions, content/diff is required
      if ((action === 'write' || action === 'patch') && (!contentVal || !String(contentVal).trim())) continue;

      if (!edits.some(e => e.path === trimmedPath)) {
        edits.push({ path: trimmedPath, content: String(contentVal), action });
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return edits;
}

export function extractFencedDiffEdits(content: string): DiffEdit[] {
  const edits: DiffEdit[] = [];

  // Fast-path signature check (consistent with other extractors)
  // Match both ```diff path and ```diff: path formats
  if (!/```diff/i.test(content)) return edits;

  // Match both ```diff path\n...``` and ```diff: path\n...```
  const regex = /```diff:?\s+([^\n]+)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const targetPath = match[1]?.trim();
    const diff = match[2] ?? '';

    if (!targetPath) continue;

    // CRITICAL FIX: Detect if the path itself is a raw git diff header
    // The LLM may output: ```diff\ndiff --git a/path b/path\n...``` instead of ```diff\npath\n...```
    // In this case, BOTH group 1 (targetPath) AND group 2 (diff content) contain "diff --git"
    // We need to check BOTH to properly detect raw git diff output
    const isRawGitDiff = /^diff --git/m.test(targetPath) || /^diff --git/m.test(diff);

    if (isRawGitDiff) {
      console.warn('[extractFencedDiffEdits] Skipping raw git diff output (should use diff parser):', targetPath);
      continue;
    }

    // CRITICAL FIX: Validate path to reject JSX/HTML fragments, CSS values, etc.
    // This prevents paths like "project/sessions/002/Input'" from being extracted
    if (!isValidExtractedPath(targetPath)) {
      console.warn('[extractFencedDiffEdits] Skipping invalid path:', targetPath);
      continue;
    }

    // CRITICAL FIX: Skip edits with empty diff content
    if (!diff || diff.trim().length === 0) continue;

    edits.push({ path: targetPath, diff: diff.trim() });
  }

  return edits;
}

/**
 * Extract text-mode fenced file edits: ```file: path\ncontent\n```
 * Used when the model doesn't support function calling — text-mode tool
 * instructions tell it to use this format for file creation/overwrite.
 */
export function extractFencedFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Guard: bail early if no file blocks (case-insensitive, handles whitespace)
  if (!/```\s*file\s*:/i.test(content)) return edits;

  // Extract all tracked paths to avoid duplicates across patterns
  const seenPaths = new Set<string>();

  /**
   * Helper: extract path + content from a match, handling edge cases:
   * - Whitespace around colon: ```file : path``` or ```file:   path```
   * - Uppercase: ```FILE: path```
   * - Extra inner language tags: ```file: path.ts\n```typescript\n...```
   *   (inner fence is kept as part of content per plan recommendation)
   *
   * Always adds valid paths to seenPaths on first attempt (even if content is empty),
   * so later patterns don't re-match the same path with different (incorrect) content.
   *
   * @returns true if an edit was added, false if rejected
   */
  function tryAddEdit(rawPath: string, rawContent: string): boolean {
    if (!rawPath) return false;
    const targetPath = rawPath.trim();
    if (!targetPath || !isValidExtractedPath(targetPath)) return false;
    if (seenPaths.has(targetPath)) return false; // already attempted

    let fileContent = rawContent.trimEnd();
    if (!fileContent || fileContent.trim().length === 0) {
      seenPaths.add(targetPath); // mark as attempted (was empty)
      return false;
    }

    seenPaths.add(targetPath);
    edits.push({ path: targetPath, content: fileContent });
    return true;
  }

  // Pattern 1: Standard ```file: path\ncontent\n``` (with optional whitespace around colon, case-insensitive)
  const regex1 = /```\s*file\s*:\s*([^\n`]+)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = regex1.exec(content)) !== null) {
    tryAddEdit(match[1], match[2] ?? '');
  }

  // Pattern 2: Handle ```file: path without closing ``` (end of content only)
  // Must NOT re-match paths already attempted by Pattern 1
  const regex2 = /```\s*file\s*:\s*([^\n`]+)\n([\s\S]*?)$/gi;
  while ((match = regex2.exec(content)) !== null) {
    const path = match[1]?.trim();
    if (!path || seenPaths.has(path)) continue; // skip if already attempted
    const fileContent = match[2] ?? '';
    if (fileContent.length >= 2) {
      tryAddEdit(match[1], fileContent);
    }
  }

  // Pattern 3: Handle malformed ```file: ```file: path (duplicate opening)
  const regex3 = /```\s*file\s*:\s*```\s*file\s*:\s*([^\n`]+)\n([\s\S]*?)```/gi;
  while ((match = regex3.exec(content)) !== null) {
    const path = match[1]?.trim();
    if (!path || seenPaths.has(path)) continue;
    tryAddEdit(match[1], match[2] ?? '');
  }

  return edits;
}

/**
 * Extract file edits from standard markdown code blocks that reference a filename.
 * Handles LLM output like: ```javascript // calculator.js or ```javascript\n// filename: x.js
 * Also handles: ```javascript file: utils.js (no newline after lang tag).
 * This is a fallback when the LLM doesn't use the structured ```file: format.
 *
 * O(1) guard: checks for ```javascript/js/ts/py/json etc before expensive regex.
 * Single combined filename regex instead of array iteration per block.
 */
export function extractCodeBlockFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // O(1) guard — bail out early if no code blocks exist
  if (!/```(?:javascript|js|typescript|ts|python|py|json|html|css|bash|sh|md)\b/i.test(content)) {
    return edits;
  }

  // Single combined regex for all filename patterns in first line
  // Matches: // calc.js, # calc.py, "calc.js", 'calc.js', /* calc.js */, // file: x.js, // filename: x.js
  const filenameRegex = /(?:\/\/|#)\s*(?:file(?:name)?[:\s]*)?([a-zA-Z0-9_\-/.]+\.[a-zA-Z]+)|["']([a-zA-Z0-9_\-/.]+\.[a-zA-Z]+)["']|\/\*\s*(?:file(?:name)?[:\s]*)?([a-zA-Z0-9_\-/.]+\.[a-zA-Z]+)\s*\*\//i;

  // Regex handles both:
  // - ```javascript\n// filename.js (lang tag, newline, then comment with filename)
  // - ```javascript file: filename.js\n (lang tag + space + filename hint on same line)
  // The langLine group only captures if it's NOT a comment (not starting with //, #, or /*)
  // Uses negative lookahead to skip comment lines
  const codeBlockRegex = /```(?:javascript|js|typescript|ts|jsx|tsx|python|py|json|html|css|bash|sh|markdown|md)(?:\s+(?!\/\/|#|\/\*)([^\n]+?))?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const langLine = (match[1] || '').trim();
    const blockContent = match[2] ?? '';

    // If the line after ```lang is a filename hint (e.g., "file: utils.js"), use it directly
    // This handles: ```javascript file: utils.js\nexport function...
    if (langLine && /^file[:\s]/i.test(langLine)) {
      const directPath = langLine.replace(/^file[:\s]+/i, '').trim();
      if (directPath && isValidExtractedPath(directPath) && blockContent.trim()) {
        edits.push({ path: directPath, content: blockContent.trimEnd() });
        continue;
      }
    }

    // Otherwise, look for filename in first line of blockContent
    const firstLine = blockContent.split('\n')[0]?.trim() || '';

    // O(1) combined filename check (was 4 separate regexes per block)
    const m = firstLine.match(filenameRegex);
    const targetPath = (m?.[1] || m?.[2] || m?.[3])?.trim();

    if (!targetPath || !isValidExtractedPath(targetPath)) continue;

    // Clean content: remove the first line if it's just a filename comment
    let cleanContent = blockContent.trimEnd();
    if (firstLine.startsWith('//') || firstLine.startsWith('#') || firstLine.startsWith('/*')) {
      cleanContent = blockContent.split('\n').slice(1).join('\n').trimEnd();
    }

    // Skip empty content
    if (!cleanContent || cleanContent.trim().length === 0) continue;

    edits.push({ path: targetPath, content: cleanContent });
  }

  return edits;
}

/**
 * Extract text-mode fenced mkdir: ```mkdir: path\n```
 */
export function extractFencedMkdirEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  if (!/```\s*mkdir\s*:/i.test(content)) return edits;

  // Match ```mkdir: path``` with optional whitespace, case-insensitive
  const regex = /```\s*mkdir\s*:\s+([^\s`]+)[\s\S]*?```/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const targetPath = match[1]?.trim();
    if (!targetPath) continue;
    if (!isValidExtractedPath(targetPath)) continue;

    edits.push({ path: targetPath, content: '', action: 'mkdir' });
  }

  return edits;
}

/**
 * Extract text-mode fenced delete: ```delete: path\n```
 * Handles optional whitespace and uppercase variants: ```DELETE: path```, ```delete : path```
 */
export function extractFencedDeleteBlocks(content: string): DeleteEdit[] {
  const deletes: DeleteEdit[] = [];
  if (!/```\s*delete\s*:/i.test(content)) return deletes;

  // Match ```delete: path``` with optional whitespace, case-insensitive
  const regex = /```\s*delete\s*:\s+([^\s`]+)[\s\S]*?```/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const targetPath = match[1]?.trim();
    if (!targetPath) continue;
    if (!isValidExtractedPath(targetPath)) continue;

    deletes.push({ path: targetPath });
  }

  return deletes;
}

/**
 * Validate path to reject invalid patterns
 * Rejects: paths with command names (WRITE, PATCH, etc.), JSON syntax, malformed paths,
 * CSS values, Vue directives, operators, and other non-path patterns.
 * 
 * EXPORTED for use in client-side validation (hooks/use-enhanced-chat.ts)
 */
export function isValidExtractedPath(path: string): boolean {
  if (!path || path.length === 0 || path.length > 300) return false;

  // CRITICAL: Reject control characters and null bytes (security)
  if (/[\0-\x1F\u202A-\u202E]/.test(path)) return false;

  // Reject single-character paths (except valid single-char filenames like 'a')
  if (path.length === 1 && !/^[a-zA-Z0-9_]$/.test(path)) return false;

  // Reject paths that are just operators or punctuation
  // NOTE: Removed : and . to allow valid paths like "./src/file.ts" or Windows "C:/path"
  if (/^[=+\-*/%<>!&|^~,;]+$/.test(path)) return false;

  // Reject paths containing command names (WRITE, PATCH, APPLY_DIFF, DELETE)
  if (/\b(?:WRITE|PATCH|APPLY_DIFF|DELETE)\b/i.test(path)) return false;

  // Reject paths with JSON/object syntax
  if (path.includes('{') || path.includes('}') ||
      path.includes('[') || path.includes(']')) return false;

  // Reject paths ending with special characters
  if (path.endsWith('/') || path.endsWith(':') ||
      path.endsWith(',') || path.endsWith('{') ||
      path.endsWith('<') || path.endsWith('>') ||
      path.endsWith('=') || path.endsWith(';')) return false;

  // Reject paths starting with special characters (except . for relative paths)
  // NOTE: Allow . for relative paths like "./src/file.ts"
  if (path.startsWith('<') || path.startsWith('>') ||
      path.startsWith('{') || path.startsWith('}') ||
      path.startsWith('@') || path.startsWith('=') ||
      path.startsWith('+') || path.startsWith('-') ||
      path.startsWith('*') || path.startsWith('#')) return false;

  // Reject paths with heredoc markers
  if (path.includes('<<<') || path.includes('>>>') || path.includes('===')) return false;

  // Reject paths that look like CSS classes or Vue directives
  if (/^(?:hover:|@|:|v-|:bind|@click|@submit|@keyup|@change|@input|@focus|@blur)/i.test(path)) return false;

  // Reject paths with colons (CSS classes like hover:scale-105)
  // Allow Windows drive letters like C:/ and URL protocols like https://
  if (path.includes(':') && !/^[a-zA-Z]:[\/\\]/.test(path) && !/^https?:\/\//.test(path)) return false;

  // Reject paths that look like CSS values (0.3s, 10px, etc.)
  if (looksLikeCssValueSegment(path)) return false;

  // Reject paths that look like event handlers or expressions
  if (/[=(].*[)]/.test(path)) return false;

  // Must have valid path format - start with alphanumeric or dot (for relative paths)
  if (!/^[a-zA-Z0-9._]/.test(path)) return false;

  // Must contain at least one path separator or file extension for multi-segment paths
  if (path.includes('/') && !/^[a-zA-Z0-9._\-\[\]]+(?:\/[a-zA-Z0-9._\-\[\]]+)*\/?$/.test(path)) return false;

  return true;
}

/**
 * Extract WRITE commands from fs-actions blocks and top-level
 * Format: WRITE path <<<content>>> or WRITE <path> <<<content>>> or ```fs-actions WRITE path <<<content>>>
 *
 * Case-insensitive matching to handle LLM output variations (WRITE, write, Write, etc.)
 */
export function extractFsActionWrites(content: string): FileEdit[] {
  const writes: FileEdit[] = [];

  // Check for WRITE (exact case) and heredoc markers to avoid false positives
  // "I'll write a function..." should not trigger this parser
  if (!content.includes('WRITE') && !content.includes('<<<') && !content.includes('fs-actions')) {
    return writes;
  }

  // Extract from ```fs-actions ... ``` code blocks
  const blockRegex = /```fs-actions\s*([\s\S]*?)```/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const blockContent = blockMatch[1] || '';
    // Updated regex to handle both: WRITE path <<<...>>> and WRITE <path> <<<...>>>
    const writeRegex = /WRITE\s*<?([^\s<>]+)>?\s*<<<\s*([\s\S]*?)\s*>>>/gi;
    let writeMatch: RegExpExecArray | null;
    while ((writeMatch = writeRegex.exec(blockContent)) !== null) {
      const path = writeMatch[1]?.trim();
      const fileContent = writeMatch[2] ?? '';
      if (!path) continue;
      // Validate path before adding
      if (!isValidExtractedPath(path)) {
        continue;
      }
      // CRITICAL FIX: Skip edits with empty content
      if (!fileContent || fileContent.trim().length === 0) {
        continue;
      }
      writes.push({ path, content: fileContent });
    }
  }

  // Extract from <fs-actions>...</fs-actions> XML tags
  const xmlBlockRegex = /<fs-actions>([\s\S]*?)<\/fs-actions>/gi;
  let xmlBlockMatch: RegExpExecArray | null;

  while ((xmlBlockMatch = xmlBlockRegex.exec(content)) !== null) {
    const blockContent = xmlBlockMatch[1] || '';
    // Updated regex to handle both: WRITE path <<<...>>> and WRITE <path> <<<...>>>
    const writeRegex = /WRITE\s*<?([^\s<>]+)>?\s*<<<\s*([\s\S]*?)\s*>>>/gi;
    let writeMatch: RegExpExecArray | null;
    while ((writeMatch = writeRegex.exec(blockContent)) !== null) {
      const path = writeMatch[1]?.trim();
      const fileContent = writeMatch[2] ?? '';
      if (!path) continue;
      // Validate path before adding
      if (!isValidExtractedPath(path)) continue;
      // CRITICAL FIX: Skip edits with empty content
      if (!fileContent || fileContent.trim().length === 0) continue;
      writes.push({ path, content: fileContent });
    }
  }

  // Extract top-level WRITE commands (```language ... ``` with WRITE prefix)
  // EXCLUDE fs-actions blocks which are already handled above
  // NOTE: Language identifier is optional to support unlabeled triple-backtick blocks
  // O(1) gate: only scan code blocks if WRITE + heredoc markers are present
  if (!content.includes('WRITE') && !content.includes('<<<')) {
    return writes;
  }

  const regularBlockRegex = /```(?:([a-zA-Z0-9_-]+)\s*)?([\s\S]*?)```/gi;
  let regularBlockMatch: RegExpExecArray | null;

  while ((regularBlockMatch = regularBlockRegex.exec(content)) !== null) {
    const lang = regularBlockMatch[1] || '';
    // Skip fs-actions blocks - already handled above
    if (lang === 'fs-actions') continue;
    // Capture group shifted: group 2 is now content when lang is present, group 1 when absent
    const blockContent = regularBlockMatch[2] || '';
    // Updated regex to handle both: WRITE path <<<...>>> and WRITE <path> <<<...>>>
    const writeRegex = /^WRITE\s*<?([^\s<>]+)>?\s*<<<\s*([\s\S]*?)\s*>>>$/gim;
    let writeMatch: RegExpExecArray | null;
    while ((writeMatch = writeRegex.exec(blockContent)) !== null) {
      const path = writeMatch[1]?.trim();
      const fileContent = writeMatch[2] ?? '';
      if (!path) continue;
      // Validate path before adding
      if (!isValidExtractedPath(path)) continue;
      // CRITICAL FIX: Skip edits with empty content
      if (!fileContent || fileContent.trim().length === 0) continue;
      // Deduplicate using trimmed content comparison
      if (!writes.some(w => w.path === path && w.content.trim() === fileContent.trim())) {
        writes.push({ path, content: fileContent });
      }
    }
  }

  return writes;
}

/**
 * Extract top-level WRITE commands outside code blocks
 * Format: WRITE path <<<content>>> or WRITE <path> <<<content>>>
 * 
 * IMPORTANT: Only extracts when BOTH opening (<<<) AND closing (>>>) markers are present
 * to avoid extracting incomplete content during streaming.
 */
export function extractTopLevelWrites(content: string): FileEdit[] {
  const writes: FileEdit[] = [];

  if (!content.includes('WRITE')) return writes;

  // Quick check: must have both <<< and >>> to proceed
  if (!content.includes('<<<') || !content.includes('>>>')) {
    return writes;
  }

  // CRITICAL FIX: Strip code blocks to avoid matching WRITE inside them
  // (fs-actions blocks are already handled by extractFsActionWrites)
  const contentWithoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');

  // Updated regex to handle both: WRITE path <<<...>>> and WRITE <path> <<<...>>>
  const topLevelWriteRegex = /^WRITE\s+<?([^\s<>]+)>?(?:\n\s*){0,2}<<<\s*\n([\s\S]*?)\s*>>>/gim;
  let match: RegExpExecArray | null;
  while ((match = topLevelWriteRegex.exec(contentWithoutCodeBlocks)) !== null) {
    const path = match[1]?.trim();
    const fileContent = match[2] ?? '';
    if (!path) continue;
    // Validate path before adding
    if (!isValidExtractedPath(path)) continue;
    // CRITICAL FIX: Skip edits with empty content
    if (!fileContent || fileContent.trim().length === 0) continue;
    // Deduplicate using trimmed content comparison
    if (!writes.some(w => w.path === path && w.content.trim() === fileContent.trim())) {
      writes.push({ path, content: fileContent });
    }
  }

  // Alternative regex for inline format: WRITE path <<<content>>> or WRITE <path> <<<content>>>
  const altWriteRegex = /^WRITE\s+<?([^\s<>]+)>?\s*<<<\s*([\s\S]*?)>>>/gim;
  while ((match = altWriteRegex.exec(contentWithoutCodeBlocks)) !== null) {
    const path = match[1]?.trim();
    const fileContent = match[2] ?? '';
    if (!path) continue;
    // Validate path before adding
    if (!isValidExtractedPath(path)) continue;
    // CRITICAL FIX: Skip edits with empty content
    if (!fileContent || fileContent.trim().length === 0) continue;
    if (!writes.some(w => w.path === path && w.content.trim() === fileContent.trim())) {
      writes.push({ path, content: fileContent });
    }
  }

  return writes;
}

/**
 * Extract DELETE commands from content
 * Format: DELETE path
 */
export function extractDeleteEdits(content: string): DeleteEdit[] {
  const deletes: DeleteEdit[] = [];
  
  if (!content.includes('DELETE')) return deletes;

  const deleteRegex = /^DELETE\s+([^\n]+)/gim;
  let match: RegExpExecArray | null;
  while ((match = deleteRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    if (path) deletes.push({ path });
  }

  return deletes;
}

/**
 * Extract PATCH commands from content
 * Format: PATCH path <<<diff>>> or PATCH <path> <<<diff>>>
 */
export function extractPatchEdits(content: string): PatchEdit[] {
  const patches: PatchEdit[] = [];

  if (!content.includes('PATCH')) return patches;

  // Updated regex to handle both: PATCH path <<<...>>> and PATCH <path> <<<...>>>
  const patchRegex = /^PATCH\s+<?([^\s<>]+)>?(?:\n\s*){0,2}<<<\s*\n([\s\S]*?)\s*>>>/gim;
  let match: RegExpExecArray | null;
  while ((match = patchRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    const diff = match[2] ?? '';
    if (!path) continue;
    // Validate path before adding
    if (!isValidExtractedPath(path)) continue;
    // CRITICAL FIX: Skip edits with empty diff content
    if (!diff || diff.trim().length === 0) continue;
    patches.push({ path, diff });
  }

  return patches;
}

/**
 * Extract DELETE commands from fs-actions blocks
 */
export function extractFsActionDeletes(content: string): string[] {
  const deletes: string[] = [];

  if (!content.includes('DELETE')) return deletes;

  for (const blockContent of extractFencedBlocks(content, 'fs-actions')) {
    const deleteRegex = /DELETE\s+([^\n]+)/gi;
    let deleteMatch: RegExpExecArray | null;
    while ((deleteMatch = deleteRegex.exec(blockContent)) !== null) {
      const path = deleteMatch[1]?.trim();
      if (path) deletes.push(path);
    }
  }

  for (const blockContent of extractXmlBlocks(content, 'fs-actions')) {
    const deleteRegex = /DELETE\s+([^\n]+)/gi;
    let deleteMatch: RegExpExecArray | null;
    while ((deleteMatch = deleteRegex.exec(blockContent)) !== null) {
      const path = deleteMatch[1]?.trim();
      if (path) deletes.push(path);
    }
  }

  return deletes;
}

/**
 * Extract PATCH commands from fs-actions blocks
 */
export function extractFsActionPatches(content: string): PatchEdit[] {
  const patches: PatchEdit[] = [];

  if (!content.includes('PATCH')) return patches;

  // Updated regex to handle both: PATCH path <<<...>>> and PATCH <path> <<<...>>>
  const patchRegex = /PATCH\s*<?([^\s<>]+)>?\s*<<<\s*([\s\S]*?)\s*>>>/gi;
  
  for (const blockContent of extractFencedBlocks(content, 'fs-actions')) {
    let patchMatch: RegExpExecArray | null;
    while ((patchMatch = patchRegex.exec(blockContent)) !== null) {
      const path = patchMatch[1]?.trim();
      const diff = patchMatch[2] ?? '';
      if (!path) continue;
      patches.push({ path, diff });
    }
  }

  for (const blockContent of extractXmlBlocks(content, 'fs-actions')) {
    let patchMatch: RegExpExecArray | null;
    while ((patchMatch = patchRegex.exec(blockContent)) !== null) {
      const path = patchMatch[1]?.trim();
      const diff = patchMatch[2] ?? '';
      if (!path) continue;
      patches.push({ path, diff });
    }
  }

  return patches;
}

/**
 * Extract apply_diff operations across supported formats.
 */
export function extractApplyDiffOperations(content: string): ApplyDiffOperation[] {
  const diffs: ApplyDiffOperation[] = [];

  if (!content.includes('APPLY_DIFF') && !content.includes('<apply_diff')) {
    return diffs;
  }

  // Updated regex to handle both: APPLY_DIFF path <<<...>>> and APPLY_DIFF <path> <<<...>>>
  const diffRegex = /APPLY_DIFF\s*<?([^\s<>]+)>?\s*<<<\s*([\s\S]*?)\s*===\s*([\s\S]*?)\s*>>>/gi;
  
  for (const blockContent of extractFencedBlocks(content, 'fs-actions')) {
    let diffMatch: RegExpExecArray | null;
    while ((diffMatch = diffRegex.exec(blockContent)) !== null) {
      const path = diffMatch[1]?.trim();
      const search = diffMatch[2] ?? '';
      const replace = diffMatch[3] ?? '';
      if (!path || !search) continue;
      diffs.push({ path, search, replace });
    }
  }

  for (const blockContent of extractXmlBlocks(content, 'fs-actions')) {
    let diffMatch: RegExpExecArray | null;
    while ((diffMatch = diffRegex.exec(blockContent)) !== null) {
      const path = diffMatch[1]?.trim();
      const search = diffMatch[2] ?? '';
      const replace = diffMatch[3] ?? '';
      if (!path || !search) continue;
      diffs.push({ path, search, replace });
    }
  }

  const xmlDiffRegex = /<apply_diff\s+path=["']([^"']+)["']\s*>\s*<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>\s*(?:<thought>([\s\S]*?)<\/thought>\s*)?<\/apply_diff>/gi;
  let xmlDiffMatch: RegExpExecArray | null;

  while ((xmlDiffMatch = xmlDiffRegex.exec(content)) !== null) {
    const path = xmlDiffMatch[1]?.trim();
    const search = xmlDiffMatch[2] ?? '';
    const replace = xmlDiffMatch[3] ?? '';
    const thought = xmlDiffMatch[4]?.trim();
    if (!path || !search) continue;
    diffs.push({ path, search, replace, thought });
  }

  // Updated regex to handle both: APPLY_DIFF path <<<...>>> and APPLY_DIFF <path> <<<...>>>
  const topLevelDiffRegex = /^\s*APPLY_DIFF\s*<?([^\s<>]+)>?\s*(?:\n\s*)?<<<\s*\n([\s\S]*?)\n===\s*\n([\s\S]*?)\n>>>/gim;
  let topLevelMatch: RegExpExecArray | null;
  while ((topLevelMatch = topLevelDiffRegex.exec(content)) !== null) {
    const path = topLevelMatch[1]?.trim();
    const search = topLevelMatch[2] ?? '';
    const replace = topLevelMatch[3] ?? '';
    if (!path || !search) continue;
    if (!diffs.some(d => d.path === path && d.search === search && d.replace === replace)) {
      diffs.push({ path, search, replace });
    }
  }

  return diffs;
}

/**
 * Extract bash heredoc file writes from fenced bash blocks.
 */
export function extractBashHereDocWrites(content: string): FileEdit[] {
  const writes: FileEdit[] = [];

  if (!content.includes('```bash') && !content.includes('cat')) return writes;

  for (const block of extractFencedBlocks(content, 'bash')) {
    const hereDocRegex = /cat\s*>\s*([^\s]+)\s*<<['"]?EOF['"]?\n([\s\S]*?)\nEOF/g;
    let hereDocMatch: RegExpExecArray | null;
    while ((hereDocMatch = hereDocRegex.exec(block)) !== null) {
      const path = hereDocMatch[1]?.trim();
      const fileContent = hereDocMatch[2] ?? '';
      if (!path) continue;
      // CRITICAL FIX: Skip edits with empty content
      if (!fileContent || fileContent.trim().length === 0) continue;
      writes.push({ path, content: fileContent });
    }
  }

  return writes;
}

/**
 * Extract code blocks with filename hints.
 */
export function extractFilenameHintCodeBlocks(content: string): FileEdit[] {
  const writes: FileEdit[] = [];

  if (!content.includes('```')) return writes;

  const regex = /```[^\n`]*\b(?:file|path|filename)\s*[:=]\s*([^\n]+)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const path = match[1]?.trim();
    let fileContent = match[2] ?? '';
    if (!path) continue;

    // CRITICAL FIX: Validate path before adding
    // Reject SCSS variables, CSS selectors, and other non-file paths
    if (!isValidFilePath(path)) {
      continue;
    }

    fileContent = stripHeredocMarkers(fileContent);
    // CRITICAL FIX: Skip edits with empty content
    if (!fileContent || fileContent.trim().length === 0) continue;
    writes.push({ path, content: fileContent });
  }

  return writes;
}

function extractFolderCreateEdits(content: string): string[] {
  const folders: string[] = [];

  if (!content.includes('<folder_create')) return folders;

  const folderCreateRegex = /<folder_create\s+path\s*=\s*["']([^"']+)["']\s*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = folderCreateRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    if (path) folders.push(path);
  }

  return folders;
}

// ---------------------------------------------------------------------------
// Folder Structure Detection (moved from mode-manager.ts for consolidation)
// ---------------------------------------------------------------------------

export interface DetectedFolderStructure {
  isSingleFolder: boolean
  folderName: string | null
  totalFiles: number
  filesInFolder: number
  filesOutsideFolder: string[]
  isNewProject: boolean
}

export interface FileOperation {
  type: 'create' | 'modify' | 'delete'
  path: string
  content?: string
  diff?: string
}

/** Minimum number of files in a folder for it to be treated as a new project. */
const NEW_PROJECT_MIN_FILES = parseInt(process.env.NEW_PROJECT_MIN_FILES || '2', 10)

/**
 * Detect folder structure from file operations
 * Moved from mode-manager.ts to consolidate all file parsing logic
 */
export function detectFolderStructure(fileOperations: FileOperation[]): DetectedFolderStructure {
  if (fileOperations.length === 0) {
    return {
      isSingleFolder: false,
      folderName: null,
      totalFiles: 0,
      filesInFolder: 0,
      filesOutsideFolder: [],
      isNewProject: false,
    }
  }

  const paths = fileOperations.map(op => op.path)
  const folderNames = new Set<string>()
  const filesOutsideAnyFolder: string[] = []

  for (const path of paths) {
    const parts = path.split('/').filter(Boolean)
    if (parts.length >= 2) {
      folderNames.add(parts[0])
    } else {
      filesOutsideAnyFolder.push(path)
    }
  }

  const folderNameArray = Array.from(folderNames)
  const isSingleFolder = folderNameArray.length === 1
  const singleFolderName = isSingleFolder ? folderNameArray[0] : null

  const filesInFolder =
    isSingleFolder && singleFolderName
      ? paths.filter(p => p.startsWith(singleFolderName + '/')).length
      : 0

  const isNewProject =
    isSingleFolder || (paths.length > 1 && filesOutsideAnyFolder.length === 0)

  return {
    isSingleFolder,
    folderName: singleFolderName,
    totalFiles: paths.length,
    filesInFolder,
    filesOutsideFolder: filesOutsideAnyFolder,
    isNewProject,
  }
}

/**
 * Detect if response indicates a new project with single folder structure
 * Moved from mode-manager.ts to consolidate all file parsing logic
 * 
 * @param content - LLM response content to analyze
 * @returns Folder name if a single-folder project structure is detected, null otherwise
 */
export function detectNewProjectFolder(content: string): string | null {
  const parsed = parseFilesystemResponse(content)
  
  // Build file operations from all detected edit types
  const fileOperations: FileOperation[] = [
    // <file_edit> tags and other XML-style edits (includes bash heredocs)
    ...parsed.writes.map(w => ({
      type: w.action === 'write' && w.content ? ('create' as const) : ('modify' as const),
      path: w.path,
      content: w.content
    })),
    // Diff-based edits
    ...parsed.diffs.map(d => ({ type: 'modify' as const, path: d.path, diff: d.diff })),
    // Folder creation (mkdir)
    ...parsed.folders.map(f => ({ type: 'create' as const, path: f })),
  ]

  const structure = detectFolderStructure(fileOperations)

  if (
    structure.isSingleFolder &&
    structure.folderName &&
    structure.filesInFolder >= NEW_PROJECT_MIN_FILES &&
    structure.filesOutsideFolder.length === 0
  ) {
    return structure.folderName
  }

  return null
}

// ---------------------------------------------------------------------------
// Additional Extractors (O(1) gated, Map-dedup compatible)
// ---------------------------------------------------------------------------

/**
 * Pattern 5b: Code blocks where first line is ONLY a filename.
 * Catches: ```javascript\nproject/file.js\nconst x = 42;\n```
 * Only matches when the first line is a pure path (no code on same line).
 * O(1) gate: skips unless ``` is present.
 */
export function extractCodeBlockFirstLineFilename(content: string): FileEdit[] {
  if (!content.includes('```')) return [];
  const edits: FileEdit[] = [];
  const regex = /```(?:\w+)?\s*\n([\w./\-]+\.\w+)\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    const path = m[1].trim();
    const fileContent = m[2].trim();
    // Reject if first line contains code (only accept pure path)
    if (!path.includes('(') && !path.includes('=') && path.includes('.') &&
        fileContent.length > 5 && isValidExtractedPath(path)) {
      edits.push({ path, content: fileContent });
    }
  }
  return edits;
}

/**
 * Pattern 11: Explicit creation commands — "create file called X with..." or
 * "save to X". O(1) gate: skips unless "create" or "save" is present.
 */
export function extractExplicitCreateCommands(content: string): FileEdit[] {
  const lower = content.toLowerCase();
  if (!lower.includes('create') && !lower.includes('save')) return [];
  const edits: FileEdit[] = [];
  const patterns = [
    /(?:create|write|make|add)\s+(?:file\s+)?(?:called|named)?\s*['"]?([\w./\-]+\.\w+)['"]?\s*(?:with|containing|:)?\s*\n?([\s\S]{1,5000})/gi,
    /(?:save|store)\s+(?:this\s+)?(?:to\s+)?(?:file\s+)?['"]?([\w./\-]+\.\w+)['"]?\s*\n?([\s\S]{1,5000})/gi
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      const path = m[1]?.trim();
      const fileContent = m[2]?.trim() || '';
      if (path && isValidExtractedPath(path) && fileContent.length > 5) {
        edits.push({ path, content: fileContent });
      }
    }
  }
  return edits;
}

/**
 * Pattern 12: JSON-like path: "file" content: "..." patterns.
 * O(1) gate: skips unless "path" and "content" keys are present.
 */
export function extractJsonLikePathContent(content: string): FileEdit[] {
  if (!content.includes('path') || !content.includes('content')) return [];
  const edits: FileEdit[] = [];
  const regex = /(?:path|file)\s*[:=]\s*['"]([\w./\-]+\.\w+)['"][\s\S]{0,80}(?:content|text|body)\s*[:=]\s*['"]([\s\S]{1,3000})['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    const path = m[1]?.trim();
    const fileContent = m[2]?.trim() || '';
    if (path && isValidExtractedPath(path) && fileContent.length > 5) {
      edits.push({ path, content: fileContent });
    }
  }
  return edits;
}

// ---------------------------------------------------------------------------
// Main Parser Function
// ---------------------------------------------------------------------------

export function parseFilesystemResponse(content: string, forceExtract: boolean = false): ParsedFilesystemResponse {
  const writes = new Map<string, FileEdit>();
  const diffs = new Map<string, PatchEdit>();
  const applyDiffs = new Map<string, ApplyDiffOperation>();
  const deletes = new Set<string>();
  const folders = new Set<string>();

  // When forceExtract is true, bypass deduplication to catch all edits
  // This is used for final parse after stream completes to catch any remaining edits
  const skipDeduplication = forceExtract;

  const addWrite = (edit: FileEdit) => {
    const key = `${edit.path}::${edit.content}`;
    // When forceExtract is true, always add (skip deduplication)
    if (skipDeduplication || !writes.has(key)) writes.set(key, edit);
  };
  const addDiff = (edit: PatchEdit) => {
    const key = `${edit.path}::${edit.diff}`;
    // When forceExtract is true, always add (skip deduplication)
    if (skipDeduplication || !diffs.has(key)) diffs.set(key, edit);
  };
  const addApplyDiff = (edit: ApplyDiffOperation) => {
    const key = `${edit.path}::${edit.search}::${edit.replace}`;
    // When forceExtract is true, always add (skip deduplication)
    if (skipDeduplication || !applyDiffs.has(key)) applyDiffs.set(key, edit);
  };

  for (const edit of extractFileEdits(content)) addWrite(edit);
  for (const edit of extractFsActionWrites(content)) addWrite(edit);
  for (const edit of extractTopLevelWrites(content)) addWrite(edit);
  for (const edit of extractBashHereDocWrites(content)) addWrite(edit);
  for (const edit of extractFilenameHintCodeBlocks(content)) addWrite(edit);
  for (const edit of extractFencedDiffEdits(content)) addDiff(edit);
  for (const edit of extractFencedFileEdits(content)) addWrite(edit);
  for (const edit of extractFencedMkdirEdits(content)) {
    if (edit.path) folders.add(edit.path);
  }
  for (const edit of extractFencedDeleteBlocks(content)) deletes.add(edit.path);
  for (const edit of extractFsActionPatches(content)) addDiff(edit);
  for (const edit of extractPatchEdits(content)) addDiff(edit);
  for (const edit of extractApplyDiffOperations(content)) addApplyDiff(edit);
  for (const edit of extractFsActionDeletes(content)) deletes.add(edit);
  for (const edit of extractDeleteEdits(content)) deletes.add(edit.path);
  for (const folder of extractFolderCreateEdits(content)) folders.add(folder);
  // New patterns — O(1) gated extractors with Map dedup
  for (const edit of extractCodeBlockFirstLineFilename(content)) addWrite(edit);
  for (const edit of extractExplicitCreateCommands(content)) addWrite(edit);
  for (const edit of extractJsonLikePathContent(content)) addWrite(edit);

  return {
    writes: Array.from(writes.values()),
    diffs: Array.from(diffs.values()),
    applyDiffs: Array.from(applyDiffs.values()),
    deletes: Array.from(deletes.values()),
    folders: Array.from(folders.values()),
  };
}

/**
 * Combined single-pass: extract edits AND sanitize for display.
 *
 * Replaces the redundant pattern of calling both parseFilesystemResponse()
 * and sanitizeAssistantDisplayContent() on the same raw string.
 *
 * Returns:
 *  - edits:    same shape as parseFilesystemResponse, with heredoc markers
 *              stripped from content (exactly what route.ts applies to VFS)
 *  - sanitized: display-safe string for the client
 */
export function extractAndSanitize(
  content: string,
  forceExtract: boolean = false,
): { edits: ParsedFilesystemResponse; sanitized: string } {
  // --- extraction (reuses existing extractors unchanged) ---
  const edits = parseFilesystemResponse(content, forceExtract);

  // Strip heredoc markers from write content — exactly what route.ts does
  // at line 3967: content: stripHeredocMarkers(edit.content)
  for (const w of edits.writes) {
    w.content = stripHeredocMarkers(w.content);
  }

  // --- sanitization (reuses existing sanitizer unchanged) ---
  const sanitized = sanitizeAssistantDisplayContent(content);

  return { edits, sanitized };
}

/**
 * Extract apply_diff blocks
 * Format: <apply_diff>...</apply_diff>
 */
export function extractApplyDiffEdits(content: string): PatchEdit[] {
  const patches: PatchEdit[] = [];

  if (!content.includes('apply_diff')) return patches;

  const regex = /<apply_diff\b[\s\S]*?<\/apply_diff>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const blockContent = match[0];
    // Try to extract path and diff from within the block
    const pathMatch = /path=["']([^"']+)["']/i.exec(blockContent);
    const diffMatch = /<diff>([\s\S]*?)<\/diff>/i.exec(blockContent);

    if (pathMatch && diffMatch) {
      // Only add if we have both path AND diff
      patches.push({
        path: pathMatch[1],
        diff: diffMatch[1]
      });
    }
    // Skip entries without proper <diff> tags - malformed input
  }

  return patches;
}

/**
 * Sanitize message content by removing file edit tags for display
 * Used in client-side MessageBubble and server-side response cleaning
 */
export function sanitizeFileEditTags(content: string): string {
  let sanitized = content;

  // Only run sanitizers if their signature is detected (O(1) string check)
  if (sanitized.includes('<file_edit')) {
    if (sanitized.includes('</file_edit>')) {
      // Remove compact format (handles both spaced and non-spaced variants)
      sanitized = sanitized.replace(/<file_edit\s*path=["'][^"']+["']\s*>[\s\S]*?<\/file_edit>/gi, '');
      // Remove multi-line format
      sanitized = sanitized.replace(/<file_edit>\s*<path>\s*[^\s<]+\s*<\/path>\s*[\s\S]*?\s*<\/file_edit>/gi, '');
    }
  }

  if (sanitized.includes('<file_write')) {
    if (sanitized.includes('</file_write>') || sanitized.includes('</file_writepath>')) {
      // Remove file_write format (handle both <file_write path="..."> and <file_writepath="...">)
      sanitized = sanitized.replace(/<file_write\s*path=["'][^"']+["']\s*>[\s\S]*?<\/file_write>/gi, '');
      sanitized = sanitized.replace(/<file_writepath=["'][^"']+["']\s*>[\s\S]*?<\/file_writepath>/gi, '');
    }
  }

  if (sanitized.includes('ws_action')) {
    // Remove ws_action JSON format (with proper escaped string handling)
    // FIX: Limit match scope to prevent catastrophic backtracking
    sanitized = sanitized.replace(/\{[\s\S]{0,10000}?"ws_action"\s*:\s*"CREATE"[\s\S]{0,10000}?"path"\s*:\s*"(?:\\.|[^"\\])+"[\s\S]{0,10000}?"content"\s*:\s*"(?:\\.|[^"\\])*"\s*\}/gi, '');
  }

  if (sanitized.includes('"file_edit"')) {
    // Remove simple JSON format: { "file_edit": "path", "content": "..." }
    // FIX: Limit match scope to prevent catastrophic backtracking
    sanitized = sanitized.replace(/\{[\s\S]{0,10000}?"file_edit"\s*:\s*"(?:\\.|[^"\\])+"[\s\S]{0,10000}?"content"\s*:\s*"(?:\\.|[^"\\])*"\s*\}/gi, '');
  }

  if (sanitized.includes('<folder_create')) {
    // Also handle folder_create tags
    sanitized = sanitized.replace(/<folder_create\s+path=["'][^"']+["']\s*\/>/gi, '');
  }

  if (sanitized.includes('<!--')) {
    // Remove HTML comment file paths AND their associated content blocks
    // Only match comments that look like file paths (contain / or . or file.ext pattern)
    // This avoids stripping legitimate comments like <!-- TODO: fix this -->
    // FIX: Use non-greedy match with limited scope to prevent catastrophic backtracking
    sanitized = sanitized.replace(/<!--\s*[^\s<]*(?:[\/\.][^\s<]*|[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+)\s*-->\s*(?:[\s\S]{0,5000}?)(?=<!--|$)/gi, '');
  }

  if (sanitized.includes('<path>')) {
    // Remove malformed format: <path>...</path> content <file Edit>
    // This handles cases where LLM outputs path tags without proper file_edit wrapping
    // FIX: Limit match scope to prevent catastrophic backtracking
    sanitized = sanitized.replace(/<path>\s*[^\s<]+\s*<\/path>\s*(?:[\s\S]{0,5000}?)(?=<path>|<file\s*edit>|$)/gi, '');
    // Remove any remaining <file Edit> markers
    sanitized = sanitized.replace(/<file\s*edit\s*>?\s*/gi, '');
  }

  // Additional formats from api/chat/route.ts
  if (sanitized.includes('fs-actions')) {
    // Remove ```fs-actions ... ``` blocks — guard: only if closing ``` exists after opening
    sanitized = sanitized.replace(/```fs-actions\s*[\s\S]*?```/gi, '');
    // Remove <fs-actions>...</fs-actions> XML blocks — guard on close tag
    if (sanitized.includes('</fs-actions>')) {
      sanitized = sanitized.replace(/<fs-actions>[\s\S]*?<\/fs-actions>/gi, '');
    }
  }

  if (sanitized.includes('WRITE') || sanitized.includes('PATCH') || sanitized.includes('DELETE')) {
    if (sanitized.includes('>>>')) {
      // Remove heredoc command blocks - standard format with optional newlines
      sanitized = sanitized.replace(/(?:^|\n)\s*(WRITE|PATCH|APPLY_DIFF)\s+[^\n]+(?:\n\s*){0,3}<<<[\s\S]*?>>>(?=\n|$)/gim, '\n');
      // Handle cases where <<< is on same line as path
      sanitized = sanitized.replace(/^\s*(WRITE|PATCH|APPLY_DIFF)\s+[^\n]+<<<[\s\S]*?>>>/gim, '');
    }
    // Remove DELETE commands (no close marker needed — single line)
    sanitized = sanitized.replace(/^\s*DELETE\s+[^\n]+(?=\n|$)/gim, '\n');
  }

  if (sanitized.includes('apply_diff') && sanitized.includes('</apply_diff>')) {
    // Remove apply_diff command blocks — guard on close tag
    sanitized = sanitized.replace(/<apply_diff\b[\s\S]*?<\/apply_diff>/gi, '');
  }

  if (sanitized.includes('tool_call')) {
    // Remove LLM-generated tool_call XML tags that leak into visible output
    if (sanitized.includes('</tool_call>')) {
      sanitized = sanitized.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
    }
    // Remove orphaned closing tags
    sanitized = sanitized.replace(/<\/tool_call>/gi, '');

  // Remove <function=tool_name> format (Mistral models)
  if (sanitized.includes('<function=')) {
    sanitized = sanitized.replace(/<function=[\s\S]*?<\/function>/gi, '');
  }
  }

  // Remove leaked project/artifact XML tags and continuation markers
  // Use lookahead (?=[\s/>]) to avoid matching hyphenated tag names like <artifact-link>
  // This preserves legitimate XML/code snippets in assistant responses
  sanitized = sanitized.replace(/<\/?project(?=[\s/>])[^>]*>/gi, '');
  sanitized = sanitized.replace(/<\/?artifact(?=[\s/>])[^>]*>/gi, '');
  sanitized = sanitized.replace(/\[CONTINUE_REQUESTED\]/gi, '');

  // Clean up leftover <<< and >>> markers
  sanitized = sanitized.replace(/^\s*<<<\s*$/gm, '');
  sanitized = sanitized.replace(/^\s*>>>\s*$/gm, '');

  // Remove bare heredoc blocks (<<<...>>>) without command prefix
  // Exclude git merge conflict markers (<<<<<<, >>>>>>)
  sanitized = sanitized.replace(/(?:^|\n)\s*<<<(?!<)[\s\S]*?>>>(?!>)\s*(?=\n|$)/gm, '\n');

  // Remove raw JSON tool calls (LLM outputs tool calls as text instead of function calling)
  // Catches: { "tool": "batch_write", "arguments": { "files": [...] } }
  // Strategy: find each "tool": marker, locate its enclosing { } via balanced brace
  // counting, then remove the entire JSON object. This avoids regex backtracking.
  if (sanitized.includes('"tool"') && sanitized.includes('"arguments"')) {
    const fileToolNames = ['write_file', 'write_files', 'batch_write', 'apply_diff', 'delete_file', 'read_file', 'list_files', 'search_files', 'create_directory', 'get_workspace_stats'];
    let searchFrom = 0;
    while (searchFrom < sanitized.length) {
      const toolIdx = sanitized.indexOf('"tool"', searchFrom);
      if (toolIdx === -1) break;

      // Find the opening brace before "tool"
      let bracePos = sanitized.lastIndexOf('{', toolIdx);
      if (bracePos === -1) { searchFrom = toolIdx + 6; continue; }

      // Find the matching closing brace using string-aware balancing
      let depth = 0;
      let endPos = -1;
      let inStr = false;
      let esc = false;
      for (let i = bracePos; i < sanitized.length; i++) {
        const ch = sanitized[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\' && inStr) { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{') depth++;
        if (ch === '}') { depth--; if (depth === 0) { endPos = i + 1; break; } }
      }
      if (endPos === -1) { searchFrom = toolIdx + 6; continue; }

      // Check if this JSON object contains a known file tool name
      const jsonObj = sanitized.substring(bracePos, endPos);
      const hasKnownTool = fileToolNames.some(name => jsonObj.includes(`"${name}"`));
      if (hasKnownTool) {
        sanitized = sanitized.substring(0, bracePos) + sanitized.substring(endPos);
        searchFrom = bracePos; // re-scan from where we removed
      } else {
        searchFrom = toolIdx + 6;
      }
    }
  }

  // Remove command envelope markers
  sanitized = sanitized.replace(/===\s*COMMANDS_START\s*===([\s\S]*?)===\s*COMMANDS_END\s*===/gi, '');

  // Normalize spacing
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n').trim();

  return sanitized;
}

/**
 * Sanitize assistant display content while preserving visible prose and reasoning.
 */
export function sanitizeAssistantDisplayContent(content: string): string {
  if (!content) return '';

  let next = sanitizeFileEditTags(content);

  if (next.includes('<thought>') && next.includes('</thought>')) {
    next = next.replace(/<thought>[\s\S]{0,5000}?<\/thought>/gi, '');
  }

  next = next.replace(/(?:^|\n)\s*<<<[\s\S]{0,5000}?>>>\s*(?=\n|$)/gim, '\n');
  next = next.replace(/\n{3,}/g, '\n\n').trim();

  return next;
}

/**
 * Split reasoning sections from visible assistant content.
 */
export function extractReasoningContent(content: string): ReasoningParseResult {
  if (!content) {
    return { reasoning: '', mainContent: '' };
  }

  const patterns = [
    { regex: /<think>([\s\S]*?)<\/think>/gi, label: '' },
    { regex: /\*\*Reasoning:\*\*([\s\S]*?)(?=\n\s*\n(?!\*\*)|\*\*|$)/gi, label: '**Reasoning:**' },
    { regex: /\*\*Thought:\*\*([\s\S]*?)(?=\n\s*\n(?!\*\*)|\*\*|$)/gi, label: '**Thought:**' },
  ] as const;

  let reasoning = '';
  let mainContent = content;

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(content)) !== null) {
      const body = match[1]?.trim();
      if (!body) continue;
      reasoning += `${pattern.label}${body}\n\n`;
      mainContent = mainContent.replace(match[0], '');
    }
  }

  return {
    reasoning: reasoning.trim(),
    mainContent: mainContent.trim(),
  };
}

export function stripHeredocMarkers(content: string): string {
  let cleaned = content;
  cleaned = cleaned.replace(/^\s*(?:WRITE|PATCH)\s+\S+\s*\n/, '');
  cleaned = cleaned.replace(/^\s*<<<\s*\n?/, '');
  cleaned = cleaned.replace(/\n?\s*>>>\s*$/, '');
  return cleaned;
}

// ---------------------------------------------------------------------------
// Incremental Parser - for progressive streaming
// ---------------------------------------------------------------------------

interface IncrementalParseState {
  /** Emitted file edits (path + content hash) to avoid duplicates */
  emittedEdits: Set<string>;
  /** Last processed position in buffer (for future optimization) */
  lastPosition: number;
  /**
   * Positions of unclosed opening tags detected in previous parses.
   * On the next parse, the window extends back to the earliest of these
   * so large edits (>12K chars) are found even when the closing tag
   * lands far from the opening tag.
   */
  unclosedPositions: Set<number>;
}

// Default overlap for cross-chunk boundary matching.
// Unclosed-tag tracking extends this dynamically when needed.
const INCREMENTAL_PARSE_OVERLAP_CHARS = 2000;

/**
 * How many chars from the tail of the parse window to scan for unclosed tags.
 * All supported opening markers are well under this length.
 */
const UNCLOSED_SCAN_TAIL_CHARS = 5000;

/**
 * Create a new incremental parser state
 */
export function createIncrementalParser(): IncrementalParseState {
  return {
    emittedEdits: new Set<string>(),
    lastPosition: 0,
    unclosedPositions: new Set<number>(),
  };
}

/**
 * Scan the tail of a parse window for opening markers that lack their
 * closing counterpart.  Returns buffer-relative start positions of
 * unclosed blocks.
 *
 * Cost: O(tailChars) — bounded constant, not proportional to buffer size.
 */
function detectUnclosedTags(
  windowText: string,
  windowStart: number,
  tailChars: number
): number[] {
  const scanStart = Math.max(0, windowText.length - tailChars);
  const tail = windowText.slice(scanStart);
  const positions: number[] = [];

  // <file_edit path="...">  or  <file_write path="...">  or  <apply_diff path="...">
  const tagNames = ['file_edit', 'file_write', 'apply_diff'];
  for (const tag of tagNames) {
    const openRe = new RegExp(`<${tag}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = openRe.exec(tail)) !== null) {
      const closeRe = new RegExp(`</${tag}>`, 'gi');
      closeRe.lastIndex = m.index + m[0].length;
      if (!closeRe.test(tail)) {
        positions.push(windowStart + scanStart + m.index);
      }
    }
  }

  // Incomplete opening tag at the very end of the buffer
  // e.g., "<file_edit path="src/"  or  "<file_write"  (no closing '>')
  if (/<(?:file_edit|file_write|apply_diff)\b[^>]*$/.test(tail)) {
    const m = tail.match(/(<(?:file_edit|file_write|apply_diff)\b[^>]*)$/);
    if (m) {
      const idx = tail.lastIndexOf(m[1]);
      if (idx !== -1) positions.push(windowStart + scanStart + idx);
    }
  }

  // <file_edit> (multi-line format, no path attr)
  if (/<file_edit>\s*$/.test(tail) || /<file_edit>\s*<path>\s*[^\s<]*$/.test(tail)) {
    const idx = tail.lastIndexOf('<file_edit>');
    if (idx !== -1 && !tail.includes('</file_edit>', idx)) {
      positions.push(windowStart + scanStart + idx);
    }
  }

  // <fs-actions> ... </fs-actions>
  if (/<fs-actions>/.test(tail)) {
    const idx = tail.lastIndexOf('<fs-actions>');
    if (idx !== -1 && !tail.includes('</fs-actions>', idx)) {
      positions.push(windowStart + scanStart + idx);
    }
  }

  // Heredoc:  WRITE|PATCH|APPLY_DIFF path  <<<  (open but no >>>)
  const heredocOpenRe = /^(?:WRITE|PATCH|APPLY_DIFF)\s+\S+/m;
  const hIdx = tail.search(heredocOpenRe);
  if (hIdx !== -1) {
    const after = tail.slice(hIdx);
    // Unclosed if <<< has no matching >>> after it
    if (/<<</.test(after) && !/>>>/.test(after)) {
      positions.push(windowStart + scanStart + hIdx);
    }
  }

  // cat > file << 'EOF'  (open but no closing delimiter on its own line)
  // Require newline after opening to match extractCatHeredocEdits behaviour
  const catMatch = tail.match(/cat\s*>>?\s*\S+\s*<<\s*['"]?(\w+)['"]?\s*\n/);
  if (catMatch) {
    const delimiter = catMatch[1];
    const matchEnd = catMatch.index! + catMatch[0].length;
    const afterMatch = tail.slice(matchEnd);
    // Closing delimiter must be on its own line (preceded by \n) or at start
    const closeRe = new RegExp(`(?:^|\\n)${delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
    if (!closeRe.test(afterMatch)) {
      positions.push(windowStart + scanStart + catMatch.index!);
    }
  }

  // ```fs-actions or ```bash  (open fence but no closing ```)
  const fenceRe = /```(?:fs-actions|bash)\s*\n?/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(tail)) !== null) {
    const after = tail.slice(fenceMatch.index + fenceMatch[0].length);
    if (!after.includes('```')) {
      positions.push(windowStart + scanStart + fenceMatch.index);
    }
  }

  // Generic ```  (open fence without close — for filename-hint blocks)
  const genericFenceRe = /```\w*\s*\n?/g;
  while ((fenceMatch = genericFenceRe.exec(tail)) !== null) {
    // Skip if this was already caught by the specific fence check above
    const after = tail.slice(fenceMatch.index + fenceMatch[0].length);
    if (!after.includes('```')) {
      // Avoid duplicate if already added by specific fence check
      const pos = windowStart + scanStart + fenceMatch.index;
      if (!positions.includes(pos)) {
        positions.push(pos);
      }
    }
  }

  // Raw JSON tool calls: detect incomplete/unclosed { "tool": "...", "arguments": {...} }
  // If we find "tool" near the end but no balanced closing brace, mark it unclosed
  if (tail.includes('"tool"') && tail.includes('"arguments"')) {
    // Find each "tool" marker and check if its enclosing JSON object is balanced
    const toolRe = /"tool"\s*:\s*"/gi;
    let toolMatch: RegExpExecArray | null;
    while ((toolMatch = toolRe.exec(tail)) !== null) {
      // Find the opening brace before this "tool" by scanning backward and counting
      let bracePos = tail.lastIndexOf('{', toolMatch.index);
      if (bracePos === -1) continue;

      // Check if braces are balanced from bracePos to end of tail using string-aware balancing
      let depth = 0;
      let balanced = false;
      let inStr = false;
      let esc = false;
      for (let i = bracePos; i < tail.length; i++) {
        const ch = tail[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\' && inStr) { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{') depth++;
        if (ch === '}') { depth--; if (depth === 0) { balanced = true; break; } }
      }
      if (!balanced) {
        positions.push(windowStart + scanStart + bracePos);
      }
    }
  }

  return positions;
}

/**
 * Remove unclosed positions that are inside the new parse window
 * (>= bufferPos) because they will be re-evaluated on this pass.
 * Positions before bufferPos remain — they extend the next window.
 */
function pruneStaleUnclosed(state: IncrementalParseState, bufferPos: number): void {
  if (state.unclosedPositions.size === 0) return;
  for (const pos of state.unclosedPositions) {
    if (pos >= bufferPos) {
      state.unclosedPositions.delete(pos);
    }
  }
}

/**
 * Return the earliest (smallest) value in a Set<number>, or Infinity if empty.
 */
function earliestPosition(positions: Set<number>): number {
  let min = Infinity;
  for (const pos of positions) {
    if (pos < min) min = pos;
  }
  return min;
}

/**
 * Extract new file edits from a streaming buffer since last check
 * This enables progressive UI updates as file edits are detected
 *
 * @param buffer - Accumulated response text so far
 * @param state - Parser state tracking what's been emitted
 * @returns New file edits detected since last call
 */
export function extractIncrementalFileEdits(
  buffer: string,
  state: IncrementalParseState
): FileEdit[] {
  const newEdits: FileEdit[] = [];

  if (buffer.length === state.lastPosition) {
    return newEdits;
  }

  // Determine parse window start:
  // 1. Default overlap for cross-chunk boundaries
  // 2. Extend to earliest unclosed tag position from previous passes
  //    (handles edits larger than the default overlap)
  let parseStart = Math.max(0, state.lastPosition - INCREMENTAL_PARSE_OVERLAP_CHARS);
  if (state.unclosedPositions.size > 0) {
    const earliest = earliestPosition(state.unclosedPositions);
    if (earliest < parseStart) parseStart = earliest;
  }
  const parseWindow = buffer.slice(parseStart);

  // Collect all edits from supported formats on the parse window.
  // Each extractor has its own fast-path check, so they bail out cheaply
  // when their markers aren't present.
  // NOTE: extractFileEdits already includes extractJsonToolCalls internally,
  // so no separate JSON tool call extraction needed here.
  const allEdits: FileEdit[] = [...extractFileEdits(parseWindow)];

  // fs-actions blocks (```fs-actions and <fs-actions>) with WRITE commands
  for (const edit of extractFsActionWrites(parseWindow)) {
    allEdits.push(edit);
  }

  // Top-level WRITE path <<<content>>> commands
  for (const edit of extractTopLevelWrites(parseWindow)) {
    allEdits.push(edit);
  }

  // Code blocks with filename hints (```typescript\n// path/to/file ...)
  for (const edit of extractFilenameHintCodeBlocks(parseWindow)) {
    allEdits.push(edit);
  }

  // NEW: Standard markdown code blocks with filename references (```javascript // calc.js)
  // This catches LLM output that uses standard code blocks instead of structured ```file: format
  for (const edit of extractCodeBlockFileEdits(parseWindow)) {
    // Only add if not already present (deduplicate)
    if (!allEdits.some(e => e.path === edit.path)) {
      allEdits.push(edit);
    }
  }

  // Fenced diff blocks (```diff path\n...``` or ```diff: path\n...```)
  for (const edit of extractFencedDiffEdits(parseWindow)) {
    allEdits.push({ path: edit.path, content: edit.diff });
  }

  // Text-mode fenced file edits (```file: path\n...```) — for non-FC models
  for (const edit of extractFencedFileEdits(parseWindow)) {
    allEdits.push(edit);
  }

  // Text-mode fenced mkdir (```mkdir: path```) — for non-FC models
  for (const edit of extractFencedMkdirEdits(parseWindow)) {
    allEdits.push({ path: edit.path, content: '', action: 'mkdir' });
  }

  // Text-mode fenced delete (```delete: path```) — for non-FC models
  for (const edit of extractFencedDeleteBlocks(parseWindow)) {
    allEdits.push({ path: edit.path, content: '', action: 'delete' });
  }

  // Bash heredoc writes inside fenced ```bash blocks
  for (const edit of extractBashHereDocWrites(parseWindow)) {
    allEdits.push(edit);
  }

  // DELETE commands (single-line)
  for (const edit of extractDeleteEdits(parseWindow)) {
    allEdits.push({ path: edit.path, content: '', action: 'delete' });
  }

  // PATCH commands (PATCH path <<<diff>>>)
  for (const edit of extractPatchEdits(parseWindow)) {
    allEdits.push({ path: edit.path, content: edit.diff, action: 'patch' });
  }

  // CRITICAL FIX: Detect unclosed tags BEFORE filtering/emitting edits
  // This prevents emitting incomplete edits during streaming
  const unclosed = detectUnclosedTags(parseWindow, parseStart, UNCLOSED_SCAN_TAIL_CHARS);

  // OPTIMIZATION: Pre-compute minimum unclosed position for O(1) lookup per edit
  // This reduces complexity from O(edits × unclosed) to O(unclosed + edits)
  const minUnclosedPos = unclosed.length > 0 ? Math.min(...unclosed) : Infinity;

  // Filter to only new edits we haven't emitted yet
  // Use path + content hash to handle same-file multiple edits
  for (const edit of allEdits) {
    // CRITICAL FIX: Skip edits with empty content (incomplete streaming tags)
    // Check both content and diff fields since some edits use diff
    // EXCEPTION: mkdir and delete actions legitimately have no content
    const editContent = edit.content || edit.diff || '';
    const isNonContentAction = edit.action === 'mkdir' || edit.action === 'delete';
    if (!isNonContentAction && (!editContent || editContent.trim().length === 0)) {
      continue;
    }

    // CRITICAL FIX: Skip edits from unclosed tag regions
    // If an opening tag exists without its closing tag, skip edits from that region
    // This prevents emitting incomplete edits during streaming
    if (unclosed.length > 0) {
      // Check if this edit's path appears after an unclosed tag position
      // If so, it's likely from an incomplete block - skip it
      const editPathInBuffer = buffer.indexOf(edit.path, parseStart);
      // OPTIMIZATION: O(1) comparison with pre-computed minimum instead of O(unclosed) array scan
      const isInUnclosedRegion = editPathInBuffer >= minUnclosedPos;
      if (isInUnclosedRegion) {
        continue;
      }
    }

    // Create unique key from path + simple content hash
    // Use full content for short files (< 100 chars), otherwise hash first/last 50 chars + length
    let contentSignature: string;
    if (editContent.length <= 100) {
      contentSignature = editContent;
    } else {
      contentSignature = `${editContent.length}-${editContent.slice(0, 50)}-${editContent.slice(-50)}`;
    }
    const editKey = `${edit.path}::${contentSignature}`;

    if (!state.emittedEdits.has(editKey)) {
      state.emittedEdits.add(editKey);
      newEdits.push(edit);
    }
  }

  // After parsing, detect any tags that are still open (no closing marker found).
  // On the next call, the parse window will extend back to these positions.
  pruneStaleUnclosed(state, parseStart);
  for (const pos of unclosed) {
    state.unclosedPositions.add(pos);
  }

  state.lastPosition = buffer.length;

  return newEdits;
}

/**
 * Extract new file edits from streaming buffer with additional metadata
 * Returns edits with status information for UI display
 */
export function extractIncrementalFileEditsWithStatus(
  buffer: string,
  state: IncrementalParseState
): Array<{ path: string; content: string; status: 'detected' }> {
  const newEdits = extractIncrementalFileEdits(buffer, state);
  return newEdits.map(edit => ({
    path: edit.path,
    content: edit.content,
    status: 'detected' as const,
  }));
}
