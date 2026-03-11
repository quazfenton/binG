/**
 * Canonical ToolInvocation type
 *
 * Single source of truth for the shape of tool invocation data exchanged
 * between backend agent pipelines and frontend UI components.
 *
 * All backend producers MUST use `normalizeToolInvocation` before emitting.
 * The frontend `ToolInvocationCard` component consumes this type directly.
 */

export interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  state: 'partial-call' | 'call' | 'result';
  args?: Record<string, unknown>;
  result?: unknown;
  timestamp?: number;
}

/**
 * Normalize any tool-result-like object into the canonical shape.
 *
 * Handles the various formats produced by different agent backends:
 * - Priority router: `{ name, result }`
 * - Mastra loop:    `{ toolCallId, toolName, state, args, result }`
 * - V2 executor:    `{ toolCallId, toolName, state, args, result, timestamp }`
 * - Unified handler: `{ toolName | name, result, ... }`
 */
export function normalizeToolInvocation(raw: Record<string, any>): ToolInvocation {
  const toolName = raw.toolName ?? raw.name ?? 'unknown';
  const toolCallId = raw.toolCallId ?? `${toolName}-${raw.timestamp ?? Date.now()}`;
  const state: ToolInvocation['state'] =
    raw.state === 'partial-call' || raw.state === 'call'
      ? raw.state
      : 'result';

  return {
    toolCallId,
    toolName,
    state,
    args: raw.args ?? raw.arguments ?? raw.input ?? undefined,
    result: raw.result ?? raw.output ?? undefined,
    timestamp: raw.timestamp ?? Date.now(),
  };
}

/**
 * Normalize an array of tool invocations, handling mixed formats.
 */
export function normalizeToolInvocations(
  rawList: Array<Record<string, any>> | undefined | null,
): ToolInvocation[] {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(normalizeToolInvocation);
}
