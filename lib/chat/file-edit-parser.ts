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
 */
export function extractHtmlCommentFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  // Match: <!-- path -->content or <!-- path -->
  const regex = /<!--\s*([^\s\-]+(?:-[^\s]+)*)\s*-->\s*([\s\S]*?)(?=<!--\s*[^/]|$)/gi;
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
 */
export function extractCompactFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  const regex = /<file_edit\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file_edit>/gi;
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

    // Find the matching closing brace by counting braces (accounting for strings)
    let braceCount = 0;
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

        if (braceCount === 0) {
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

    // Find the matching closing brace by counting braces (accounting for strings)
    let braceCount = 0;
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

        if (braceCount === 0) {
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
      
      // Pattern 3: // src/app.tsx style (just a path in comment)
      const simplePathMatch = line.match(/^(?:\/\/|#)\s*([a-zA-Z0-9_./\-\\]+\.[a-zA-Z0-9]+)\s*$/);
      if (simplePathMatch && !line.includes(' ')) {
        filePath = simplePathMatch[1].replace(/\\/g, '/');
        contentStartLine = i + 1;
        break;
      }
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
 */
export function extractFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];

  // Only run parsers if their signature is detected (O(1) string check)
  if (content.includes('<file_edit')) {
    edits.push(...extractCompactFileEdits(content));
    edits.push(...extractMultiLineFileEdits(content));
  }
  if (content.includes('<file_write')) {
    edits.push(...extractFileWriteEdits(content));
  }
  if (content.includes('ws_action')) {
    edits.push(...extractWsActionEdits(content));
  }
  if (content.includes('"file_edit"')) {
    edits.push(...extractSimpleJsonFileEdits(content));
  }
  if (content.includes('<!--')) {
    edits.push(...extractHtmlCommentFileEdits(content));
  }

  return edits;
}

/**
 * Extract fenced diff blocks: ```diff path\ncontent\n```
 */
export function extractFencedDiffEdits(content: string): DiffEdit[] {
  const edits: DiffEdit[] = [];
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
 */
export function extractFsActionWrites(content: string): FileEdit[] {
  const writes: FileEdit[] = [];
  
  if (!content.includes('WRITE') && !content.includes('fs-actions')) return writes;

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
    writes.push({ path, content: fileContent });
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
    
    if (pathMatch) {
      patches.push({ 
        path: pathMatch[1], 
        diff: diffMatch ? diffMatch[1] : blockContent 
      });
    }
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
    // Remove compact format
    sanitized = sanitized.replace(/<file_edit\s+path=["'][^"']+["']\s*>[\s\S]*?<\/file_edit>/gi, '');
    // Remove multi-line format
    sanitized = sanitized.replace(/<file_edit>\s*<path>\s*[^\s<]+\s*<\/path>\s*[\s\S]*?\s*<\/file_edit>/gi, '');
  }

  if (sanitized.includes('<file_write')) {
    // Remove file_write format
    sanitized = sanitized.replace(/<file_write\s+path=["'][^"']+["']\s*>[\s\S]*?<\/file_write>/gi, '');
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
    // Remove HTML comment file paths: <!-- path -->content
    sanitized = sanitized.replace(/<!--\s*[^\s\-]+(?:-[^\s]+)*\s*-->\s*/gi, '');
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
  /** Emitted file paths to avoid duplicates */
  emittedPaths: Set<string>;
  /** Last processed position in buffer */
  lastPosition: number;
}

/**
 * Create a new incremental parser state
 */
export function createIncrementalParser(): IncrementalParseState {
  return {
    emittedPaths: new Set<string>(),
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
  for (const edit of allEdits) {
    if (!state.emittedPaths.has(edit.path)) {
      state.emittedPaths.add(edit.path);
      newEdits.push(edit);
    }
  }
  
  // Update position to end of buffer
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
