/**
 * Strip JSON tool call/result objects from display content.
 *
 * When the LLM's tool execution results or calls leak into the text content
 * (instead of being routed through the toolInvocations metadata pipeline),
 * they appear as literal JSON in the chat UI:
 *
 *   {"type":"tool_result","tool":"write_file","success":true,"exitCode":0,
 *    "durationMs":46,"args":{"path":"web-terminal/README.md","content":"# Web..."}}
 *
 *   {"type":"tool-call","toolCallId":"...","toolName":"read_file","input":{...}}
 *
 *   {"tool":"write_file","arguments":{"path":"...","content":"..."}}
 *
 * This utility strips those objects from the text using balanced brace scanning
 * so nested JSON inside content/args fields is handled correctly.
 */

import { findBalancedJsonObject as findBalancedJson } from '../utils/json-tolerant';

/** Keys that identify a JSON object as a tool call/result to be stripped from display */
const TOOL_RESULT_SIGNATURE_RE = /"type"\s*:\s*"tool_result"/;
const TOOL_CALL_SIGNATURE_RE = /"type"\s*:\s*"tool-call"/;

/** Tool names that mean "this is a tool call object" regardless of type field */
const KNOWN_TOOL_NAMES = new Set([
  'write_file', 'write_files', 'batch_write', 'delete_file', 'apply_diff',
  'read_file', 'list_files', 'list_directory', 'search_files', 'read_url',
  'mkdir', 'create_file', 'create_files', 'writeToFile',
]);

/** Regex to extract the tool name value from a JSON string: "tool":"write_file" */
const TOOL_NAME_VALUE_RE = /"tool"\s*:\s*"([^"]+)"/;

/**
 * Check if a JSON string contains tool-related keys that should be stripped.
 *
 * Uses precise signature matching:
 * - {"type":"tool_result",...} or {"type":"tool-call",...} → always strip
 * - {"tool":"write_file",...} where the tool name VALUE is a known tool → strip
 *
 * Does NOT match tool names appearing as arbitrary string values elsewhere in the JSON,
 * only when the "tool" key's value is a known tool name.
 */
function isToolObject(jsonStr: string): boolean {
  // Check for tool_result / tool-call type markers (most specific)
  if (TOOL_RESULT_SIGNATURE_RE.test(jsonStr)) return true;
  if (TOOL_CALL_SIGNATURE_RE.test(jsonStr)) return true;

  // Check for raw JSON tool calls: extract the "tool" key's actual value
  const toolNameMatch = jsonStr.match(TOOL_NAME_VALUE_RE);
  if (toolNameMatch) {
    const toolName = toolNameMatch[1].toLowerCase();
    // Only strip if the tool name value is a known tool AND the JSON has
    // arguments/args/input — indicating it's a tool call, not just a config object
    if (KNOWN_TOOL_NAMES.has(toolName)) {
      const hasArgs = /"arguments"|"args"|"input"/.test(jsonStr);
      if (hasArgs) return true;
    }
  }

  return false;
}

/**
 * Strip JSON tool call/result objects from display content.
 *
 * Uses balanced brace scanning to correctly handle nested JSON
 * inside content/args fields (e.g., JSON file contents).
 *
 * @param content - Raw LLM text content that may contain tool JSON
 * @returns Content with tool JSON objects removed
 */
export function stripJsonToolObjects(content: string): string {
  if (!content) return '';
  if (!content.includes('{')) return content;

  const parts: string[] = [];
  let pos = 0;

  while (pos < content.length) {
    const braceIdx = content.indexOf('{', pos);
    if (braceIdx === -1) {
      // No more braces, keep the rest
      parts.push(content.slice(pos));
      break;
    }

    // Keep text before the brace
    parts.push(content.slice(pos, braceIdx));

    // Try to find the matching closing brace
    const endIdx = findBalancedJson(content, braceIdx);
    if (endIdx === -1) {
      // Unbalanced brace - keep as-is and continue
      parts.push(content.slice(braceIdx));
      break;
    }

    const jsonStr = content.slice(braceIdx, endIdx);

    if (isToolObject(jsonStr)) {
      // This is a tool call/result object - skip it (don't add to parts)
      // But preserve any whitespace/newlines that followed it
      // (the next loop iteration will add text up to the next brace)
    } else {
      // Not a tool object - keep it
      parts.push(jsonStr);
    }

    pos = endIdx;
  }

  // Clean up: remove lines that are now empty (just whitespace after stripping)
  let result = parts.join('');
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}
