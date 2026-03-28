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

export interface FileEdit {
  path: string;
  content: string;
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
 * Extract JSON format: { "ws_action": "CREATE", "path": "...", "content": "..." }
 * This is an alternative format used by some LLMs
 */
export function extractWsActionEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Find JSON-like blocks by looking for ws_action pattern
  // Use a more careful regex that accounts for nested braces in strings
  // Match from ws_action backward to find the opening brace, then parse carefully
  const wsActionPattern = /"ws_action"\s*:\s*"CREATE"/gi;
  let match: RegExpExecArray | null;

  while ((match = wsActionPattern.exec(content)) !== null) {
    // Find the opening brace before this match
    const startIndex = content.lastIndexOf('{', match.index);
    if (startIndex === -1) continue;

    // Find the matching closing brace by counting braces AND brackets (accounting for strings)
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escape = false;
    let endIndex = -1;

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
          endIndex = i + 1;
          break;
        }
      }
    }

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

    // Find the matching closing brace by counting braces AND brackets (accounting for strings)
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escape = false;
    let endIndex = -1;

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
          endIndex = i + 1;
          break;
        }
      }
    }

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
 * Deduplicates by path (first occurrence wins) to handle cases where multiple
 * parsers might match the same file or LLM outputs duplicate edit blocks.
 * First wins is chosen because: if LLM shows the same file twice, the first
 * occurrence is typically the intended edit, and subsequent duplicates are
 * usually restatements or examples.
 */
export function extractFileEdits(content: string): FileEdit[] {
  const allEdits: FileEdit[] = [];

  // Only run parsers if their signature is detected (O(1) string check)
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
    // Remove compact format (handles both spaced and non-spaced variants)
    sanitized = sanitized.replace(/<file_edit\s*path=["'][^"']+["']\s*>[\s\S]*?<\/file_edit>/gi, '');
    // Remove multi-line format
    sanitized = sanitized.replace(/<file_edit>\s*<path>\s*[^\s<]+\s*<\/path>\s*[\s\S]*?\s*<\/file_edit>/gi, '');
  }

  if (sanitized.includes('<file_write')) {
    // Remove file_write format (handle both <file_write path="..."> and <file_writepath="...">)
    sanitized = sanitized.replace(/<file_write\s*path=["'][^"']+["']\s*>[\s\S]*?<\/file_write>/gi, '');
    sanitized = sanitized.replace(/<file_writepath=["'][^"']+["']\s*>[\s\S]*?<\/file_writepath>/gi, '');
  }

  if (sanitized.includes('ws_action')) {
    // Remove ws_action JSON format (with proper escaped string handling)
    sanitized = sanitized.replace(/\{[\s\S]*?"ws_action"\s*:\s*"CREATE"[\s\S]*?"path"\s*:\s*"(?:\\.|[^"\\])+"[\s\S]*?"content"\s*:\s*"(?:\\.|[^"\\])*"\s*\}/gi, '');
  }

  if (sanitized.includes('"file_edit"')) {
    // Remove simple JSON format: { "file_edit": "path", "content": "..." }
    sanitized = sanitized.replace(/\{[\s\S]*?"file_edit"\s*:\s*"(?:\\.|[^"\\])+"[\s\S]*?"content"\s*:\s*"(?:\\.|[^"\\])*"\s*\}/gi, '');
  }

  if (sanitized.includes('<folder_create')) {
    // Also handle folder_create tags
    sanitized = sanitized.replace(/<folder_create\s+path=["'][^"']+["']\s*\/>/gi, '');
  }

  if (sanitized.includes('<!--')) {
    // Remove HTML comment file paths AND their associated content blocks
    // Only match comments that look like file paths (contain / or . or file.ext pattern)
    // This avoids stripping legitimate comments like <!-- TODO: fix this -->
    sanitized = sanitized.replace(/<!--\s*[^\s<]*(?:[\/\.][^\s<]*|[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+)\s*-->\s*[\s\S]*?(?=<!--|$)/gi, '');
  }

  if (sanitized.includes('<path>')) {
    // Remove malformed format: <path>...</path> content <file Edit>
    // This handles cases where LLM outputs path tags without proper file_edit wrapping
    sanitized = sanitized.replace(/<path>\s*[^\s<]+\s*<\/path>\s*[\s\S]*?(?=<path>|<file\s*edit>|$)/gi, '');
    // Remove any remaining <file Edit> markers
    sanitized = sanitized.replace(/<file\s*edit\s*>?\s*/gi, '');
  }

  // Additional formats from api/chat/route.ts
  if (sanitized.includes('fs-actions')) {
    // Remove ```fs-actions ... ``` blocks
    sanitized = sanitized.replace(/```fs-actions\s*[\s\S]*?```/gi, '');
    // Remove <fs-actions>...</fs-actions> XML blocks
    sanitized = sanitized.replace(/<fs-actions>[\s\S]*?<\/fs-actions>/gi, '');
  }

  if (sanitized.includes('WRITE') || sanitized.includes('PATCH') || sanitized.includes('DELETE')) {
    // Remove heredoc command blocks - standard format with optional newlines
    sanitized = sanitized.replace(/(?:^|\n)\s*(WRITE|PATCH|APPLY_DIFF)\s+[^\n]+(?:\n\s*){0,3}<<<[\s\S]*?>>>(?=\n|$)/gim, '\n');
    // Handle cases where <<< is on same line as path
    sanitized = sanitized.replace(/^\s*(WRITE|PATCH|APPLY_DIFF)\s+[^\n]+<<<[\s\S]*?>>>/gim, '');
    // Remove DELETE commands
    sanitized = sanitized.replace(/^\s*DELETE\s+[^\n]+(?=\n|$)/gim, '\n');
  }

  if (sanitized.includes('apply_diff')) {
    // Remove apply_diff command blocks
    sanitized = sanitized.replace(/<apply_diff\b[\s\S]*?<\/apply_diff>/gi, '');
  }

  if (sanitized.includes('tool_call')) {
    // Remove LLM-generated tool_call XML tags that leak into visible output
    sanitized = sanitized.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
    // Remove orphaned closing tags
    sanitized = sanitized.replace(/<\/tool_call>/gi, '');
  }

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

// ---------------------------------------------------------------------------
// Incremental Parser - for progressive streaming
// ---------------------------------------------------------------------------

interface IncrementalParseState {
  /** Emitted file edits (path + content hash) to avoid duplicates */
  emittedEdits: Set<string>;
  /** Last processed position in buffer (for future optimization) */
  lastPosition: number;
}

/**
 * Create a new incremental parser state
 */
export function createIncrementalParser(): IncrementalParseState {
  return {
    emittedEdits: new Set<string>(),
    lastPosition: 0,
  };
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

  // Use the existing extractFileEdits to find all edits in the buffer
  const allEdits = extractFileEdits(buffer);

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

  // Update position to end of buffer
  // TODO Note: lastPosition tracking is available for future optimization
  // Currently we re-parse from 0 to handle cases where earlier content
  // changes affect later parsing (e.g., tag modifications mid-stream)
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
