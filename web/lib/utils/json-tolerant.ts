import { jsonrepair } from 'jsonrepair';

/**
 * Tolerant JSON parser for malformed LLM output.
 * Uses jsonrepair to handle trailing commas, single quotes, unquoted keys,
 * unescaped control chars, comments, and other common LLM malformations.
 *
 * This is a shared utility used by both the VFS MCP tool layer
 * and the text-based file-edit parser to safely parse LLM JSON.
 */

/**
 * Sanitize unescaped control characters inside JSON string values.
 * LLMs often emit raw newlines/tabs inside strings — this escapes them.
 */
export function sanitizeJsonString(str: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escapeNext) {
      result += ch;
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && inString) {
      result += ch;
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      if (ch === '\n') result += '\\n';
      else if (ch === '\r') result += '\\r';
      else if (ch === '\t') result += '\\t';
      else if (ch === '\b') result += '\\b';
      else if (ch === '\f') result += '\\f';
      else result += ch;
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Attempt to parse JSON with fallbacks for common LLM malformations.
 *
 * Strategy:
 * 1. Prefix stripping (files=, filesArray=)
 * 2. jsonrepair (handles unquoted keys, single quotes, trailing commas, comments, etc.)
 * 3. Fallback: sanitize control chars then jsonrepair
 *
 * @param text - Raw string from LLM output
 * @param sanitize - Whether to attempt control-char sanitization (default: true)
 * @returns Parsed value or undefined if all attempts fail
 */
export function tolerantJsonParse(text: string, sanitize = true): unknown {
  if (!text || typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  let cleaned = trimmed;
  const prefixMatch = cleaned.match(/^(?:files\s*[=:]\s*|filesArray\s*[=:]\s*)/i);
  if (prefixMatch) {
    cleaned = cleaned.substring(prefixMatch[0].length);
  }

  try {
    const repaired = jsonrepair(cleaned);
    return JSON.parse(repaired);
  } catch {
    // fall through
  }

  if (sanitize) {
    try {
      const sanitized = sanitizeJsonString(cleaned);
      const repaired = jsonrepair(sanitized);
      return JSON.parse(repaired);
    } catch {
      // fall through
    }
  }

  return undefined;
}

/**
 * Find the end index of a balanced JSON object starting at braceStart.
 * Accounts for nested braces, brackets, strings, and escape sequences.
 *
 * @param text - The full text containing the JSON
 * @param braceStart - Index of the opening `{`
 * @returns Index just after the closing `}`, or -1 if unbalanced
 */
export function findBalancedJsonObject(text: string, braceStart: number): number {
  if (braceStart < 0 || braceStart >= text.length || text[braceStart] !== '{') {
    return -1;
  }

  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') braceCount++;
    else if (ch === '}') braceCount--;
    else if (ch === '[') bracketCount++;
    else if (ch === ']') bracketCount--;

    if (braceCount === 0 && bracketCount === 0) {
      return i + 1;
    }
  }
  return -1;
}
