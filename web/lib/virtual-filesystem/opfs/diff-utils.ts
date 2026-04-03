/**
 * Diff Utilities
 *
 * Client-compatible diff generation utilities
 */

/**
 * Generate unified diff between two strings
 */
export function generateUnifiedDiff(
  original: string | undefined,
  updated: string | undefined,
  filePath: string
): string {
  if (!original && !updated) return '';

  const oldLines = original?.split('\n') || [];
  const newLines = updated?.split('\n') || [];

  let result = `--- a/${filePath}\n+++ b/${filePath}\n`;

  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      result += ` ${oldLine || ''}\n`;
    } else if (oldLine === undefined) {
      result += `+${newLine}\n`;
    } else if (newLine === undefined) {
      result += `-${oldLine}\n`;
    } else {
      result += `-${oldLine}\n+${newLine}\n`;
    }
  }

  return result;
}
