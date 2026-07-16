/**
 * Orchestrator structured-error unwrap helper.
 *
 * Extracts a structured-error LLM-facing hint from any tool result.
 * Used by the active /api/chat route's `config.executeTool` closure.
 *
 * Caller contract
 * ---------------
 * Pass any `unknown` (typically `result.error` from
 * `callMCPToolFromAI_SDK`). The helper detects the VFS/MCP structured
 * error shape `{ message: string; code?: string; retryable?: boolean;
 * correctedExample?: string }` and returns a formatted LLM-facing block
 * the LLM can read for self-correction. Returns `null` when the input
 * does not match \u2014 callers fall through to their generic WARN path.
 *
 * Output format
 * -------------
 *   [ORCHESTRATOR-UNWRAP]: <message>
 *   [error.code=<code>] [retryable=<bool>]
 *   \u2192 <correctedExample>     (omitted when undefined)
 *
 * The string literal is locked at this format so consumers and tests
 * can match it without regex parsing.
 *
 * Migration history
 * -----------------
 * Extracted from the inline 16-line build at
 * /opt/bing/web/app/api/chat/route.ts:L1968-L1990 after the type-guard
 * `isStructuredMcpError` (architecture-integration.ts:L740+) tightened
 * the cast at that site. Future V2-path migration + chat-helpers.ts
 * tool-result surfacing SHOULD reuse this helper rather than
 * copy-pasting the format block \u2014 keeping the `[ORCHESTRATOR-UNWRAP]`
 * literal in one place is the small-but-meaningful invariant this file
 * protects.
 */

import { isStructuredMcpError } from './architecture-integration';

/**
 * Returns the formatted LLM-facing orchestrator hint, or `null` if the
 * input does not match the structured-error shape.
 *
 * @param raw - The candidate error blob (typically `result.error` from
 *              `callMCPToolFromAI_SDK`).
 * @returns The formatted hint string when the type-guard passes, or
 *          `null` when the input is null / non-object / a primitive /
 *          function / an object without a non-empty `message`.
 */
export function unwrapStructuredToolError(raw: unknown): string | null {
  if (!isStructuredMcpError(raw)) return null;
  const e = raw; // narrowed by guard to { message: string; code?: string; retryable?: boolean; correctedExample?: string }
  const retryable = typeof e.retryable === 'boolean' ? e.retryable : false;
  const code = e.code ?? 'UNKNOWN';
  const exampleLine = e.correctedExample ? `\n\u2192 ${e.correctedExample}` : '';
  return `[ORCHESTRATOR-UNWRAP]: ${e.message}\n[error.code=${code}] [retryable=${retryable}]${exampleLine}`;
}
