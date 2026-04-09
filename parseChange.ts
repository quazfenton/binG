/**
 * batch-tool-extractors.ts
 *
 * Three new extractors for LLM batch-write output formats that
 * file-edit-parser.ts does not currently handle:
 *
 *   Format A  Special-token envelope
 *             <|tool_call_begin|> functions.batch_write:0
 *             <|tool_call_argument_begin|>
 *             {"files":[{"path":"pkg.json","content":"…"},…]}
 *             <|tool_call_end|>
 *
 *   Format B  Fenced code block containing a bare function call
 *             ```javascript
 *             batch_write([{ "path":"…", "content":"…" }, …])
 *             ```
 *
 *   Format C  ```tool_call fenced block
 *             ```tool_call
 *             { "tool_name":"batch_write",
 *               "parameters":{ "files":[{ "path":"…","content":{…} }] } }
 *             ```
 *
 * INTEGRATION — add to extractFileEdits() in file-edit-parser.ts:
 *
 *   1. hasAnyMarker — append:
 *        content.includes('<|tool_call') ||
 *        /batch_write|write_files|create_files|batch_create/i.test(content) ||
 *        content.includes('```tool_call') || content.includes('tool_name')
 *
 *   2. After the extractJsonToolCalls block:
 *        if (content.includes('<|tool_call'))
 *          allEdits.push(...extractSpecialTokenToolCalls(content));
 *        if (content.includes('```') &&
 *            /batch_write|write_files|create_files|batch_create/i.test(content))
 *          allEdits.push(...extractFencedBatchWrite(content));
 *        if (/```tool[-_]?call/i.test(content))
 *          allEdits.push(...extractToolCallFencedBlock(content));
 *
 *   3. sanitizeFileEditTags() — append:
 *        if (content.includes('<|tool_call_begin|>'))
 *          sanitized = sanitized.replace(/<\|tool_call_begin\|>[\s\S]*?<\|tool_call_end\|>/gi,'');
 *        if (/```tool[-_]?call/i.test(content))
 *          sanitized = sanitized.replace(/```tool[-_]?call[\s\S]*?```/gi,'');
 */

import type { FileEdit } from './file-edit-parser';
import { isValidExtractedPath } from './file-edit-parser';

// ─── Shared utilities ───────────────────────────────────────────────────────

/**
 * Find the exclusive end-index of the balanced JSON value (object or array)
 * starting at `start` (which must be `{` or `[`).
 * Returns -1 when no balanced close is found.
 */
function findJsonEnd(text: string, start: number): number {
  const opening = text[start];
  if (opening !== '{' && opening !== '[') return -1;
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc)        { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === opening) depth++;
    else if (ch === closing) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/**
 * Extract a JSON string value from `source` (which must start with `"`),
 * tolerating:
 *   • literal (unescaped) newlines / tabs inside the string  ← common LLM output
 *   • nested JSON objects embedded in the string value
 *     (the depth tracker prevents a `"` inside a nested value from
 *      prematurely closing the outer string)
 *
 * Returns `{ value, endOffset }` where `endOffset` is the index AFTER the
 * closing `"` in `source`, or null if `source` doesn't start with `"`.
 */
function extractJsonString(source: string): { value: string; endOffset: number } | null {
  if (!source.startsWith('"')) return null;

  let i = 1; // skip opening "
  let out = '';
  let innerBrace = 0;
  let innerBracket = 0;

  while (i < source.length) {
    const ch = source[i];

    // Standard JSON escape sequence
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1];
      switch (next) {
        case 'n':  out += '\n'; break;
        case 't':  out += '\t'; break;
        case 'r':  out += '\r'; break;
        case '"':  out += '"';  break;
        case '\\': out += '\\'; break;
        case '/':  out += '/';  break;
        default:   out += next; break;
      }
      i += 2;
      continue;
    }

    // Literal control characters — malformed but common from LLMs
    if (ch === '\n') { out += '\n'; i++; continue; }
    if (ch === '\r') { i++; continue; }

    // Track depth of nested JSON structures within the string
    if      (ch === '{') innerBrace++;
    else if (ch === '}') innerBrace--;
    else if (ch === '[') innerBracket++;
    else if (ch === ']') innerBracket--;

    // End of outer string when " appears and we're not inside a nested structure
    if (ch === '"' && innerBrace === 0 && innerBracket === 0) {
      return { value: out, endOffset: i + 1 };
    }

    out += ch;
    i++;
  }

  return { value: out, endOffset: i }; // unclosed string — return what we have
}

/**
 * Extract file objects from a JSON body that may be malformed.
 *
 * Handles the common LLM failure mode where `content` string values contain
 * literal newlines and/or unescaped double-quotes (`"`) — making the
 * overall payload invalid JSON that `JSON.parse` rejects.
 *
 * Algorithm:
 *   • Scan for every `"path": "value"` occurrence with a simple regex
 *     (paths are almost always short identifiers with no tricky chars)
 *   • After each path, locate the following `"content":` key and use
 *     `extractJsonString` / `findJsonEnd` to robustly pull the value
 */
function extractFilesRobust(body: string): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];

  // Simple path extraction: paths themselves never contain unescaped "
  const pathRe = /"path"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;

  while ((m = pathRe.exec(body)) !== null) {
    const path = m[1].trim();
    if (!path) continue;

    // Locate "content": after this path match
    const contentKeyIdx = body.indexOf('"content"', m.index + m[0].length);
    if (contentKeyIdx === -1) continue;

    const afterKey = body.slice(contentKeyIdx + '"content"'.length).trimStart();
    if (!afterKey.startsWith(':')) continue;

    const afterColon = afterKey.slice(1).trimStart();
    let contentValue = '';

    if (afterColon.startsWith('"')) {
      const extracted = extractJsonString(afterColon);
      if (extracted) contentValue = extracted.value;
    } else if (afterColon.startsWith('{') || afterColon.startsWith('[')) {
      // Nested object/array — find end then stringify
      const end = findJsonEnd(afterColon, 0);
      if (end !== -1) {
        try {
          contentValue = JSON.stringify(JSON.parse(afterColon.slice(0, end)), null, 2);
        } catch {
          contentValue = afterColon.slice(0, end);
        }
      }
    }

    if (contentValue !== undefined && path) {
      results.push({ path, content: contentValue });
    }
  }

  return results;
}

/**
 * Normalise a files array from any batch format into FileEdit objects.
 * Handles:
 *   • content as JSON string  → used verbatim
 *   • content as nested object → re-serialised to string (e.g. package.json)
 */
function filesArrayToEdits(
  files: unknown[],
  out: FileEdit[],
  seenPaths: Set<string>,
): void {
  for (const file of files) {
    if (!file || typeof file !== 'object') continue;
    const f = file as Record<string, unknown>;

    const rawPath = f.path ?? f.file ?? f.filename;
    if (typeof rawPath !== 'string' || !rawPath.trim()) continue;
    const path = rawPath.trim();
    if (!isValidExtractedPath(path)) continue;
    if (seenPaths.has(path)) continue;

    let content: string;
    const rawContent = f.content ?? f.data ?? f.body ?? f.text ?? f.source;

    if (typeof rawContent === 'string') {
      content = rawContent;
    } else if (rawContent !== undefined && rawContent !== null) {
      // Nested object (e.g. package.json content sent as a real JSON object)
      try { content = JSON.stringify(rawContent, null, 2); } catch { continue; }
    } else {
      continue;
    }

    if (!content.trim()) continue;
    seenPaths.add(path);
    out.push({ path, content });
  }
}

// Tool names that produce file writes
const WRITE_TOOL_RE =
  /^(?:batch_write|write_files?|create_files?|write_file|put_file|save_file|batch_create|create_and_write)$/i;

// ═══════════════════════════════════════════════════════════════════════════
// Format A — <|tool_call_begin|> … <|tool_call_end|>
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract file edits from Mistral/local-model style special-token tool calls:
 *
 *   <|tool_call_begin|> functions.batch_write:0 <|tool_call_argument_begin|>
 *   {"files":[{"path":"…","content":"…"},…]}
 *   <|tool_call_end|>
 *
 * Tolerates:
 *   • optional <|tool_call_argument_begin|> delimiter
 *   • function namespace prefix (functions.batch_write → batch_write)
 *   • sequence number suffix (batch_write:0)
 *   • malformed JSON content values (literal newlines / unescaped quotes)
 */
export function extractSpecialTokenToolCalls(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  if (!content.includes('<|tool_call')) return edits;

  // Each block: <|tool_call_begin|> TOOLNAME[:N] [<|tool_call_argument_begin|>] BODY <|tool_call_end|>
  const blockRe =
    /<\|tool_call_begin\|>\s*([\w.:-]+)\s*(?:<\|tool_call_argument_begin\|>)?\s*([\s\S]*?)<\|tool_call_end\|>/gi;
  let block: RegExpExecArray | null;

  while ((block = blockRe.exec(content)) !== null) {
    const toolFull = block[1] ?? '';
    // Strip namespace prefix (functions.) and sequence suffix (:0)
    const toolName = toolFull.replace(/^[^.]+\./, '').replace(/:\d+$/, '');

    const body = (block[2] ?? '').trim();
    if (!body) continue;

    // Find the first { or [ in the argument body
    const firstBrace = body.search(/[{[]/);
    if (firstBrace === -1) continue;

    const seenPaths = new Set<string>();

    // Attempt standard JSON.parse first (fast path)
    const endIdx = findJsonEnd(body, firstBrace);
    if (endIdx !== -1) {
      try {
        const parsed = JSON.parse(body.slice(firstBrace, endIdx)) as Record<string, unknown>;

        if (WRITE_TOOL_RE.test(toolName)) {
          const files = parsed.files ?? parsed.data ?? parsed.items;
          if (Array.isArray(files)) { filesArrayToEdits(files, edits, seenPaths); continue; }
          if (typeof parsed.path === 'string') { filesArrayToEdits([parsed], edits, seenPaths); continue; }
        }
        if (/write_file|create_file|put_file|save_file/i.test(toolName)) {
          filesArrayToEdits([parsed], edits, seenPaths); continue;
        }
        // Check for files key regardless of tool name (LLMs sometimes use wrong name)
        const files2 = parsed.files ?? parsed.data ?? parsed.items;
        if (Array.isArray(files2)) { filesArrayToEdits(files2, edits, seenPaths); continue; }

        continue;
      } catch {
        // JSON.parse failed — fall through to robust extraction below
      }
    }

    // Robust fallback: handles literal newlines / unescaped quotes in content values
    const robustFiles = extractFilesRobust(body.slice(firstBrace));
    for (const f of robustFiles) {
      if (!isValidExtractedPath(f.path) || seenPaths.has(f.path)) continue;
      seenPaths.add(f.path);
      edits.push({ path: f.path, content: f.content });
    }
  }

  return edits;
}

// ═══════════════════════════════════════════════════════════════════════════
// Format B — fenced code block containing batch_write([…]) call
// ═══════════════════════════════════════════════════════════════════════════

const BATCH_TOOL_NAMES_RE =
  /\b(batch_write|write_files?|create_files?|batch_create)\s*\(\s*/gi;

/**
 * Extract file edits from fenced code blocks containing bare batch-write calls:
 *
 *   ```javascript
 *   batch_write([
 *     { "path": "package.json", "content": "…" },
 *     { "path": "src/main.js",  "content": "…" }
 *   ])
 *   ```
 *
 * Also handles:
 *   • batch_write({ files: […] })  — object wrapping the array
 *   • write_files([…])  /  create_files([…])  /  batch_create([…])
 *   • JS-object syntax (unquoted keys, template literals) via loose parser
 */
export function extractFencedBatchWrite(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  if (!content.includes('```')) return edits;
  if (!BATCH_TOOL_NAMES_RE.test(content)) return edits;
  BATCH_TOOL_NAMES_RE.lastIndex = 0;

  // Linear scan for fenced blocks — avoids [\s\S]*? catastrophic backtracking
  let pos = 0;
  const FENCE = '```';

  while (pos < content.length) {
    const openIdx = content.indexOf(FENCE, pos);
    if (openIdx === -1) break;

    // Skip fence + optional language tag to find body start
    const bodyStart = content.indexOf('\n', openIdx + FENCE.length);
    if (bodyStart === -1) break;

    const closeIdx = content.indexOf(FENCE, bodyStart + 1);
    if (closeIdx === -1) break;

    const blockBody = content.slice(bodyStart + 1, closeIdx);
    pos = closeIdx + FENCE.length;

    if (!BATCH_TOOL_NAMES_RE.test(blockBody)) continue;
    BATCH_TOOL_NAMES_RE.lastIndex = 0;

    // Find each tool call inside this block
    let callMatch: RegExpExecArray | null;
    while ((callMatch = BATCH_TOOL_NAMES_RE.exec(blockBody)) !== null) {
      const afterParen = callMatch.index + callMatch[0].length;
      const firstChar = blockBody[afterParen];
      if (firstChar !== '[' && firstChar !== '{') continue;

      const endIdx = findJsonEnd(blockBody, afterParen);
      if (endIdx === -1) continue;

      const argSlice = blockBody.slice(afterParen, endIdx);
      let files: unknown[] | undefined;

      try {
        const parsed = JSON.parse(argSlice);
        if (Array.isArray(parsed)) {
          files = parsed;
        } else if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          const inner = obj.files ?? obj.data ?? obj.items;
          if (Array.isArray(inner)) files = inner;
        }
      } catch {
        // JS-object / template-literal syntax — use loose parser
        files = parseLooseFileArray(argSlice);
      }

      if (!files || files.length === 0) continue;
      filesArrayToEdits(files, edits, new Set());
    }
  }

  return edits;
}

// ═══════════════════════════════════════════════════════════════════════════
// Format C — ```tool_call fenced block
// ═══════════════════════════════════════════════════════════════════════════

// All key names an LLM might use for the tool name / arguments wrapper
const TOOL_NAME_KEYS  = ['tool_name', 'toolName', 'name', 'tool', 'function', 'function_name'] as const;
const ARGS_KEYS       = ['parameters', 'arguments', 'args', 'params', 'input']                as const;

const TOOL_CALL_FENCE_RE = /```(?:tool[-_]?call|TOOL[-_]?CALL)\s*\n/gi;

/**
 * Extract file edits from ```tool_call fenced blocks:
 *
 *   ```tool_call
 *   {
 *     "tool_name": "batch_write",
 *     "parameters": {
 *       "files": [
 *         { "path": "package.json",
 *           "content": { "name": "vue-app", … } },  ← nested object OK
 *         { "path": "src/main.js",
 *           "content": "import …" }
 *       ]
 *     }
 *   }
 *   ```
 *
 * Tolerates:
 *   • fence labels: tool_call / tool-call / toolcall / TOOL_CALL
 *   • tool key:     tool_name / toolName / name / tool / function / function_name
 *   • args wrapper: parameters / arguments / args / params / input
 *   • content as string or nested JSON object
 *   • trailing commas (repaired before JSON.parse)
 */
export function extractToolCallFencedBlock(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  if (!TOOL_CALL_FENCE_RE.test(content)) return edits;
  TOOL_CALL_FENCE_RE.lastIndex = 0;

  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = TOOL_CALL_FENCE_RE.exec(content)) !== null) {
    const bodyStart = fenceMatch.index + fenceMatch[0].length;
    const closeIdx  = content.indexOf('```', bodyStart);
    if (closeIdx === -1) break;

    const blockBody = content.slice(bodyStart, closeIdx).trim();
    if (!blockBody.startsWith('{')) continue;

    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(blockBody) as Record<string, unknown>;
    } catch {
      // Attempt repair: trailing commas are common in LLM JSON
      try {
        parsed = JSON.parse(blockBody.replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
      } catch { continue; }
    }

    if (!parsed || Array.isArray(parsed)) continue;

    // Resolve tool name
    let toolName = '';
    for (const key of TOOL_NAME_KEYS) {
      if (typeof parsed[key] === 'string') { toolName = parsed[key] as string; break; }
    }
    if (!toolName) continue;

    // Resolve the arguments wrapper (may be absent — top-level is the args)
    let args: Record<string, unknown> = parsed;
    for (const key of ARGS_KEYS) {
      if (parsed[key] && typeof parsed[key] === 'object' && !Array.isArray(parsed[key])) {
        args = parsed[key] as Record<string, unknown>;
        break;
      }
    }

    // Resolve files list
    const rawFiles =
      args.files   ??
      args.items   ??
      args.data    ??
      // Single-file shorthand: { path, content } at args level
      (typeof args.path === 'string' ? [args] : null);

    if (!rawFiles) continue;
    const fileList = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
    filesArrayToEdits(fileList, edits, new Set());
  }

  return edits;
}

// ─── Loose JS-object array parser (shared by Format B fallback) ─────────────

/**
 * Parse a JS-style array of file objects that may use:
 *   • unquoted keys  (path: "…")
 *   • template literals  (content: `…`)
 *   • trailing commas
 *
 * Returns plain `{ path?, content? }` objects.
 */
function parseLooseFileArray(
  arrayBody: string,
): Array<{ path?: string; content?: string }> {
  const results: Array<{ path?: string; content?: string }> = [];
  let i = 0;

  while (i < arrayBody.length) {
    while (i < arrayBody.length && arrayBody[i] !== '{') i++;
    if (i >= arrayBody.length) break;

    const objStart = i;
    let braceDepth = 0;
    let inStr = false;
    let strCh = '';
    let esc = false;
    let objEnd = -1;

    for (let j = objStart; j < arrayBody.length; j++) {
      const ch = arrayBody[j];
      if (esc)  { esc = false; continue; }
      if (inStr) {
        if (ch === '\\' && strCh !== '`') { esc = true; continue; }
        if (ch === strCh) inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strCh = ch; continue; }
      if (ch === '{') braceDepth++;
      else if (ch === '}') { braceDepth--; if (braceDepth === 0) { objEnd = j; break; } }
    }

    if (objEnd === -1) break;

    const obj = parseLooseObject(arrayBody.slice(objStart, objEnd + 1));
    if (obj) results.push(obj);
    i = objEnd + 1;
  }

  return results;
}

/**
 * Extract `path` and `content` from a single JS/JSON object string.
 * Handles quoted and unquoted keys, all three string delimiters.
 */
function parseLooseObject(
  objStr: string,
): { path?: string; content?: string } | null {
  const result: { path?: string; content?: string } = {};

  // Match: (optional comma/brace/newline) "key" or key : "value" | 'value' | `value`
  const kvRe =
    /(?:^|[,{\n])\s*["']?(path|content)["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/gs;
  let m: RegExpExecArray | null;

  while ((m = kvRe.exec(objStr)) !== null) {
    const key = m[1];
    const rawVal = m[2];
    let val = rawVal.slice(1, -1); // strip delimiters

    if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
      val = val
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");
    }
    // Template literals: keep as-is

    if (key === 'path')    result.path    = val;
    if (key === 'content') result.content = val;
  }

  return (result.path || result.content) ? result : null;
}
