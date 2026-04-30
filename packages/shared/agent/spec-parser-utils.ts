/**
 * Spec Parser Utilities — shared JSON repair and extraction helpers.
 *
 * Extracted from web/lib/chat/spec-parser.ts so they can be reused by
 * first-response-routing.ts and other shared-agent modules without
 * importing from the web layer.
 */

/**
 * Remove trailing commas before ] or } — common LLM output issue.
 */
export function removeTrailingCommas(raw: string): string {
  return raw.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Strip single-line and multi-line comments from raw JSON.
 * Removes // line comments and block comments.
 * Safe for typical LLM outputs (won't strip inside strings).
 */
export function stripJsonComments(raw: string): string {
  return raw
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Apply cheap JSON fixups (strip comments + remove trailing commas).
 */
export function tryRepairJson(raw: string): string {
  let s = stripJsonComments(raw);
  s = removeTrailingCommas(s);
  return s;
}

/**
 * Extract the first top-level JSON object from a string.
 * Uses O(n) single-pass brace-depth tracking, correctly handling
 * escaped characters inside string literals.
 *
 * Returns the extracted substring (ready for JSON.parse) or null.
 */
export function extractFirstJsonObject(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
