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
 */
export function extractFileWriteEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  // Handle: <file_write path="...">content</file_write>
  const regex = /<file_write\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file_write>/gi;
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
 * Extract both compact and multi-line file_edit formats
 * Also extracts file_write and ws_action formats
 */
export function extractFileEdits(content: string): FileEdit[] {
  return [
    ...extractCompactFileEdits(content),
    ...extractMultiLineFileEdits(content),
    ...extractFileWriteEdits(content),
    ...extractWsActionEdits(content),
  ];
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
 * Sanitize message content by removing file edit tags for display
 * Used in client-side MessageBubble and server-side response cleaning
 */
export function sanitizeFileEditTags(content: string): string {
  let sanitized = content;

  // Remove compact format
  sanitized = sanitized.replace(/<file_edit\s+path=["'][^"']+["']\s*>[\s\S]*?<\/file_edit>/gi, '');

  // Remove multi-line format
  sanitized = sanitized.replace(/<file_edit>\s*<path>\s*[^\s<]+\s*<\/path>\s*[\s\S]*?\s*<\/file_edit>/gi, '');

  // Remove file_write format
  sanitized = sanitized.replace(/<file_write\s+path=["'][^"']+["']\s*>[\s\S]*?<\/file_write>/gi, '');

  // Remove ws_action JSON format (with proper escaped string handling)
  // Uses (?:\\.|[^"\\])* to match strings with escaped characters like \"
  sanitized = sanitized.replace(/\{[\s\S]*?"ws_action"\s*:\s*"CREATE"[\s\S]*?"path"\s*:\s*"(?:\\.|[^"\\])+"[\s\S]*?"content"\s*:\s*"(?:\\.|[^"\\])*"\s*\}/gi, '');

  // Also handle folder_create tags
  sanitized = sanitized.replace(/<folder_create\s+path=["'][^"']+["']\s*\/>/gi, '');

  return sanitized;
}
