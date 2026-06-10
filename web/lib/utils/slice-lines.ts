/**
 * Slice file content to a line range (1-based, inclusive).
 *
 * Used by file.read providers (router.ts) and smart context generation
 * (smart-context.ts) to support partial file reads without rewriting
 * the entire file content.
 *
 * Previously duplicated in both files due to a perceived circular import
 * concern. Smart-context.ts does NOT import from router.ts (or vice versa),
 * so there is no circular dependency — extracting to a shared utility is safe.
 *
 * @param content   - Full file content as a string
 * @param startLine - First line to return (1-based, inclusive). Omit to read from line 1.
 * @param endLine   - Last line to return (1-based, inclusive). Omit to read to end.
 * @returns The sliced content string
 *
 * @example
 * sliceLines('line 1\nline 2\nline 3', 2, 3)  // → 'line 2\nline 3'
 * sliceLines('line 1\nline 2', 1)              // → 'line 1\nline 2'
 * sliceLines('line 1\nline 2\nline 3', undefined, 2) // → 'line 1\nline 2'
 */
export function sliceLines(content: string, startLine?: number, endLine?: number): string {
  if (startLine == null && endLine == null) return content;

  const lines = content.split('\n');

  // Clamp startLine to >= 1 to prevent JavaScript slice() wrap-around
  // (e.g. startLine=0 → start=-1 → slice(-1) returns the last element, not the first)
  const safeStartLine = startLine != null ? Math.max(1, startLine) : 1;
  const start = safeStartLine - 1;
  const end = endLine != null ? endLine : lines.length;

  return lines.slice(start, end).join('\n');
}
