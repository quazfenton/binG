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
  metadata?: {
    provider?: string;
    sourceAgent?: string;
    sourceSystem?: string;
    requestId?: string;
    conversationId?: string;
    rawState?: string;
  };
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
  const toolName = raw.toolName ?? raw.name ?? raw.tool ?? 'unknown';
  const timestamp = coerceTimestamp(raw.timestamp);
  const toolCallId = raw.toolCallId ?? raw.callId ?? `${toolName}-${timestamp}`;
  const state: ToolInvocation['state'] =
    raw.state === 'partial-call' || raw.state === 'call'
      ? raw.state
      : 'result';

  return {
    toolCallId,
    toolName,
    state,
    args: normalizeArgs(raw.args ?? raw.arguments ?? raw.input ?? undefined),
    result: raw.result ?? raw.output ?? undefined,
    timestamp,
    metadata: normalizeMetadata(raw, state),
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

function normalizeArgs(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function coerceTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function normalizeMetadata(
  raw: Record<string, any>,
  normalizedState: ToolInvocation['state'],
): ToolInvocation['metadata'] | undefined {
  const provider =
    raw.provider ??
    raw.authProvider ??
    raw.metadata?.provider ??
    raw.metadata?.authProvider ??
    undefined;
  const sourceAgent =
    raw.sourceAgent ??
    raw.agent ??
    raw.metadata?.sourceAgent ??
    raw.metadata?.agent ??
    undefined;
  const sourceSystem =
    raw.sourceSystem ??
    raw.source ??
    raw.metadata?.sourceSystem ??
    raw.metadata?.source ??
    undefined;
  const requestId =
    raw.requestId ??
    raw.metadata?.requestId ??
    undefined;
  const conversationId =
    raw.conversationId ??
    raw.metadata?.conversationId ??
    undefined;
  const rawState = typeof raw.state === 'string' && raw.state !== normalizedState
    ? raw.state
    : undefined;

  if (!provider && !sourceAgent && !sourceSystem && !requestId && !conversationId && !rawState) {
    return undefined;
  }

  return {
    provider: typeof provider === 'string' ? provider : undefined,
    sourceAgent: typeof sourceAgent === 'string' ? sourceAgent : undefined,
    sourceSystem: typeof sourceSystem === 'string' ? sourceSystem : undefined,
    requestId: typeof requestId === 'string' ? requestId : undefined,
    conversationId: typeof conversationId === 'string' ? conversationId : undefined,
    rawState,
  };
}
