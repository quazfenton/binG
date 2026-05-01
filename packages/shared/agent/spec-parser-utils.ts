/**
 * Spec Parser Utilities — shared JSON repair and extraction helpers.
 *
 * Extracted from web/lib/chat/spec-parser.ts so they can be reused by
 * first-response-routing.ts and other shared-agent modules without
 * importing from the web layer.
 */

/**
 * Remove trailing commas before ] or } — common LLM output issue.
 *
 * String-aware: skips content inside double-quoted strings so that
 * commas inside string values like "hello, }" are not removed.
 */
export function removeTrailingCommas(raw: string): string {
  // Walk the string character-by-character, building a result buffer.
  // When we encounter a comma followed by whitespace and ] or }, and we
  // are NOT inside a string, we drop the comma.
  let result = '';
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < raw.length) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      result += ch;
      i++;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      result += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      i++;
      continue;
    }

    // Outside a string: check for trailing comma pattern  ,  <whitespace>  ] or }
    if (!inString && ch === ',') {
      // Look ahead: skip whitespace, then check for ] or }
      let j = i + 1;
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) {
        j++;
      }
      if (j < raw.length && (raw[j] === '}' || raw[j] === ']')) {
        // Trailing comma — skip it and the whitespace we already scanned past
        // but preserve the whitespace between the removed comma and the closer
        result += raw.slice(i + 1, j);
        i = j;
        continue;
      }
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Strip single-line and multi-line comments from raw JSON.
 * Removes single-line and block-style comments.
 *
 * String-aware: skips content inside double-quoted strings so that
 * URLs like "https://example.com" are preserved intact.
 */
export function stripJsonComments(raw: string): string {
  // Unified single-pass: track inString/escape state the same way
  // removeTrailingCommas and extractFirstJsonObject do.
  let result = '';
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < raw.length) {
    if (escape) {
      escape = false;
      result += raw[i++];
      continue;
    }

    if (raw[i] === '\\' && inString) {
      escape = true;
      result += raw[i++];
      continue;
    }

    if (raw[i] === '"') {
      inString = !inString;
      result += raw[i++];
      continue;
    }

    // Only process comment markers when outside strings
    if (!inString) {
      // Single-line comment // — skip until end of line
      if (raw[i] === '/' && i + 1 < raw.length && raw[i + 1] === '/') {
        i += 2;
        while (i < raw.length && raw[i] !== '\n') i++;
        continue;
      }

      // Block comment /* … */ — skip until closing */
      if (raw[i] === '/' && i + 1 < raw.length && raw[i + 1] === '*') {
        i += 2;
        while (i < raw.length) {
          if (raw[i] === '*' && i + 1 < raw.length && raw[i + 1] === '/') {
            i += 2;
            break;
          }
          i++;
        }
        continue;
      }
    }

    result += raw[i++];
  }

  return result;
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
