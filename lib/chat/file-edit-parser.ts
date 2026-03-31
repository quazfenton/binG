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
 * - Client-side (message-bubble.tsx): Sanitizes display by removing edit tags
 * - Mode-aware processing (mode-manager.ts): Detects file operations in responses
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
 */

export { isFullFileContent } from './file-diff-utils';
export { stripHeredocBodies } from './bash-file-commands';

// Import for local use
import { stripHeredocBodies as maskHeredocs } from './bash-file-commands';

/**
 * Validate file path - must be a valid filesystem path
 * CRITICAL: Prevents AI from generating malformed paths like 'project/sessions/003/{'
 * 
 * NOTE: Trailing slashes ARE allowed for directory paths (e.g., "src/", "components/")
 */
export function isValidFilePath(path: string, isFolder: boolean = false): boolean {
  if (!path || path.length === 0) return false;
  
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
  if (path.startsWith('<') || path.startsWith('>') ||
      path.startsWith('{') || path.startsWith('}') ||
      path.startsWith('[') || path.startsWith(']')) {
    return false;
  }
  
  return true;
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
 */
export function extractCompactFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  // Use \s* to handle both spaced and non-spaced variants
  // FIX: Limit match scope to prevent catastrophic backtracking
  const regex = /<file_edit\s*path=["']([^"']+)["']\s*>([\s\S]*?)<\/file_edit>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const filePath = match[1]?.trim();
    const fileContent = match[2] ?? '';
    if (!filePath) continue;
    edits.push({ path: filePath, content: fileContent.trim() });
  }

  return edits;
}

/**
 * Extract <file_write path="...">content</file_write> format
 * This is an alternative format used by some LLMs
 * Handles both with and without space: <file_write path="..."> and <file_writepath="...">
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
 */
export function extractMalformedFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Match: <path>path</path> followed by content, ending with <file Edit> or <file_edit> or next <path>
  // Handles variations: <file Edit>, <file_edit>, <FILE_EDIT>, <File_Edit>, etc. (case insensitive)
  const regex = /<path>\s*([^\s<]+?)\s*<\/path>\s*([\s\S]*?)(?=<path>|<file\s*edit>|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const filePath = match[1]?.trim();
    let fileContent = match[2] ?? '';

    // Skip if path looks invalid or contains tags
    if (!filePath || filePath.includes('<') || filePath.includes('>')) continue;

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
 * Find the end of a balanced JSON object starting at `startIndex` (which should point to '{').
 * Accounts for string escaping, nested braces, and brackets.
 * Returns the exclusive end index, or -1 if no balanced object is found.
 */
function findBalancedJsonObject(content: string, startIndex: number): number {
  // Defensive: ensure startIndex points to an opening brace
  if (startIndex < 0 || startIndex >= content.length || content[startIndex] !== '{') {
    return -1;
  }

  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;

      if (braceCount === 0 && bracketCount === 0) {
        return i + 1;
      }
    }
  }

  return -1;
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
      const obj = JSON.parse(jsonStr) as { ws_action?: string; path?: string; content?: string };

      // Only process CREATE actions with valid path (must be string) and content
      if (obj.ws_action !== 'CREATE' || typeof obj.path !== 'string' || !obj.path.trim()) continue;

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
      const obj = JSON.parse(jsonStr) as { file_edit?: string; content?: string };

      // Process if file_edit path exists and is a string
      if (typeof obj.file_edit !== 'string' || !obj.file_edit.trim()) continue;

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
 * Extract both compact and multi-line file_edit formats
 * Also extracts file_write, ws_action, and simple JSON formats
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
  if (
    !content.includes('<file_edit') &&
    !content.includes('<file_write') &&
    !content.includes('ws_action') &&
    !content.includes('"file_edit"') &&
    !content.includes('<!--') &&
    !content.includes('<path>') &&
    !content.includes('<<') &&
    !content.includes('cat') &&
    !content.includes('mkdir') &&
    !content.includes('rm ') &&
    !content.includes('sed')
  ) {
    return [];
  }

  const allEdits: FileEdit[] = [];

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
  if (content.includes('<!--')) {
    allEdits.push(...extractHtmlCommentFileEdits(content));
  }
  // Handle malformed format where LLM outputs <path>...</path> without proper wrapping
  // Require both opening and closing tags to avoid false positives on SVG/XML content
  if (content.includes('<path>') && content.includes('</path>')) {
    allEdits.push(...extractMalformedFileEdits(content));
  }

  // Deduplicate by path (first occurrence wins)
  // This handles cases where multiple parsers match the same file or LLM outputs duplicates
  const dedupedEdits = new Map<string, FileEdit>();
  for (const edit of allEdits) {
    // Only set if path not already in map (first wins)
    if (!dedupedEdits.has(edit.path)) {
      dedupedEdits.set(edit.path, edit);
    }
  }

  return Array.from(dedupedEdits.values());
}

/**
 * Extract fenced diff blocks: ```diff path\ncontent\n```
 * 
 * FIX: Now correctly distinguishes between:
 * - ```diff path\n<unified diff content>``` (diff patch for a file)
 * - ```diff\ndiff --git a/path b/path\n...``` (raw git diff output - should NOT be parsed as file edit)
 */
export function extractFencedDiffEdits(content: string): DiffEdit[] {
  const edits: DiffEdit[] = [];

  // Fast-path signature check (consistent with other extractors)
  // Use case-insensitive regex to match the actual parser regex behavior
  if (!/```diff/i.test(content)) return edits;

  const regex = /```diff\s+([^\n]+)\n([\s\S]*?)```/gi;
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
    
    edits.push({ path: targetPath, diff: diff.trim() });
  }

  return edits;
}

/**
 * Extract WRITE commands from fs-actions blocks and top-level
 * Format: WRITE path <<<content>>> or ```fs-actions WRITE path <<<content>>>
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
    const writeRegex = /WRITE\s*([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>/gi;
    let writeMatch: RegExpExecArray | null;
    while ((writeMatch = writeRegex.exec(blockContent)) !== null) {
      const path = writeMatch[1]?.trim();
      const fileContent = writeMatch[2] ?? '';
      if (!path) continue;
      writes.push({ path, content: fileContent });
    }
  }

  // Extract from <fs-actions>...</fs-actions> XML tags
  const xmlBlockRegex = /<fs-actions>([\s\S]*?)<\/fs-actions>/gi;
  let xmlBlockMatch: RegExpExecArray | null;

  while ((xmlBlockMatch = xmlBlockRegex.exec(content)) !== null) {
    const blockContent = xmlBlockMatch[1] || '';
    const writeRegex = /WRITE\s*([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>/gi;
    let writeMatch: RegExpExecArray | null;
    while ((writeMatch = writeRegex.exec(blockContent)) !== null) {
      const path = writeMatch[1]?.trim();
      const fileContent = writeMatch[2] ?? '';
      if (!path) continue;
      writes.push({ path, content: fileContent });
    }
  }

  // Extract top-level WRITE commands (```language ... ``` with WRITE prefix)
  const regularBlockRegex = /```[a-zA-Z]*\s*([\s\S]*?)```/gi;
  let regularBlockMatch: RegExpExecArray | null;

  while ((regularBlockMatch = regularBlockRegex.exec(content)) !== null) {
    const blockContent = regularBlockMatch[1] || '';
    const writeRegex = /^WRITE\s*([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>$/gim;
    let writeMatch: RegExpExecArray | null;
    while ((writeMatch = writeRegex.exec(blockContent)) !== null) {
      const path = writeMatch[1]?.trim();
      const fileContent = writeMatch[2] ?? '';
      if (!path) continue;
      writes.push({ path, content: fileContent });
    }
  }

  return writes;
}

/**
 * Extract top-level WRITE commands outside code blocks
 * Format: WRITE path <<<content>>>
 */
export function extractTopLevelWrites(content: string): FileEdit[] {
  const writes: FileEdit[] = [];

  if (!content.includes('WRITE')) return writes;

  const topLevelWriteRegex = /^WRITE\s+([^\s<]+)(?:\n\s*){0,2}<<<\s*\n([\s\S]*?)\s*>>>/gim;
  let match: RegExpExecArray | null;
  while ((match = topLevelWriteRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    const fileContent = match[2] ?? '';
    if (!path) continue;
    // Deduplicate - check if we already have this exact edit
    if (!writes.some(w => w.path === path && w.content === fileContent)) {
      writes.push({ path, content: fileContent });
    }
  }

  const altWriteRegex = /^WRITE\s+([^\s<]+)\s*<<<\s*([\s\S]*?)>>>/gim;
  while ((match = altWriteRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    const fileContent = match[2] ?? '';
    if (!path) continue;
    if (!writes.some(w => w.path === path && w.content === fileContent)) {
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
 * Format: PATCH path <<<diff>>>
 */
export function extractPatchEdits(content: string): PatchEdit[] {
  const patches: PatchEdit[] = [];
  
  if (!content.includes('PATCH')) return patches;

  const patchRegex = /^PATCH\s+([^\s<]+)(?:\n\s*){0,2}<<<\s*\n([\s\S]*?)\s*>>>/gim;
  let match: RegExpExecArray | null;
  while ((match = patchRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    const diff = match[2] ?? '';
    if (!path) continue;
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

  for (const blockContent of extractFencedBlocks(content, 'fs-actions')) {
    const patchRegex = /PATCH\s+([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>/gi;
    let patchMatch: RegExpExecArray | null;
    while ((patchMatch = patchRegex.exec(blockContent)) !== null) {
      const path = patchMatch[1]?.trim();
      const diff = patchMatch[2] ?? '';
      if (!path) continue;
      patches.push({ path, diff });
    }
  }

  for (const blockContent of extractXmlBlocks(content, 'fs-actions')) {
    const patchRegex = /PATCH\s+([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>/gi;
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

  for (const blockContent of extractFencedBlocks(content, 'fs-actions')) {
    const diffRegex = /APPLY_DIFF\s+([^\s<]+)\s*<<<\s*([\s\S]*?)\s*===\s*([\s\S]*?)\s*>>>/gi;
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
    const diffRegex = /APPLY_DIFF\s+([^\s<]+)\s*<<<\s*([\s\S]*?)\s*===\s*([\s\S]*?)\s*>>>/gi;
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

  const topLevelDiffRegex = /^\s*APPLY_DIFF\s+([^\s<]+)\s*(?:\n\s*)?<<<\s*\n([\s\S]*?)\n===\s*\n([\s\S]*?)\n>>>/gim;
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
    if (!isValidFilePath(path)) continue;
    
    fileContent = stripHeredocMarkers(fileContent);
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

export function parseFilesystemResponse(content: string): ParsedFilesystemResponse {
  const writes = new Map<string, FileEdit>();
  const diffs = new Map<string, PatchEdit>();
  const applyDiffs = new Map<string, ApplyDiffOperation>();
  const deletes = new Set<string>();
  const folders = new Set<string>();

  const addWrite = (edit: FileEdit) => {
    const key = `${edit.path}::${edit.content}`;
    if (!writes.has(key)) writes.set(key, edit);
  };
  const addDiff = (edit: PatchEdit) => {
    const key = `${edit.path}::${edit.diff}`;
    if (!diffs.has(key)) diffs.set(key, edit);
  };
  const addApplyDiff = (edit: ApplyDiffOperation) => {
    const key = `${edit.path}::${edit.search}::${edit.replace}`;
    if (!applyDiffs.has(key)) applyDiffs.set(key, edit);
  };

  for (const edit of extractFileEdits(content)) addWrite(edit);
  for (const edit of extractFsActionWrites(content)) addWrite(edit);
  for (const edit of extractTopLevelWrites(content)) addWrite(edit);
  for (const edit of extractBashHereDocWrites(content)) addWrite(edit);
  for (const edit of extractFilenameHintCodeBlocks(content)) addWrite(edit);
  for (const edit of extractFencedDiffEdits(content)) addDiff(edit);
  for (const edit of extractFsActionPatches(content)) addDiff(edit);
  for (const edit of extractPatchEdits(content)) addDiff(edit);
  for (const edit of extractApplyDiffOperations(content)) addApplyDiff(edit);
  for (const edit of extractFsActionDeletes(content)) deletes.add(edit);
  for (const edit of extractDeleteEdits(content)) deletes.add(edit.path);
  for (const folder of extractFolderCreateEdits(content)) folders.add(folder);

  return {
    writes: Array.from(writes.values()),
    diffs: Array.from(diffs.values()),
    applyDiffs: Array.from(applyDiffs.values()),
    deletes: Array.from(deletes.values()),
    folders: Array.from(folders.values()),
  };
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

  // Fenced diff blocks (```diff path\n...```)
  for (const edit of extractFencedDiffEdits(parseWindow)) {
    allEdits.push({ path: edit.path, content: edit.diff });
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

  // Filter to only new edits we haven't emitted yet
  // Use path + content hash to handle same-file multiple edits
  for (const edit of allEdits) {
    // Create unique key from path + simple content hash
    // Use full content for short files (< 100 chars), otherwise hash first/last 50 chars + length
    let contentSignature: string;
    if (edit.content.length <= 100) {
      contentSignature = edit.content;
    } else {
      contentSignature = `${edit.content.length}-${edit.content.slice(0, 50)}-${edit.content.slice(-50)}`;
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
  const unclosed = detectUnclosedTags(parseWindow, parseStart, UNCLOSED_SCAN_TAIL_CHARS);
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
