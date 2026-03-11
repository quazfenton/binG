/**
 * Canonical SSE Event Schema
 *
 * Single source of truth for Server-Sent Event types exchanged between
 * backend streaming routes and frontend hooks (useEnhancedChat).
 *
 * All backend routes MUST use `sseEncode` to emit events.
 * All frontend consumers SHOULD use the `SSEEventType` union to
 * discriminate incoming events.
 */

// ---------------------------------------------------------------------------
// Event type constants
// ---------------------------------------------------------------------------

export const SSE_EVENT_TYPES = {
  /** Streaming text token */
  TOKEN: 'token',
  /** Tool invocation lifecycle */
  TOOL_INVOCATION: 'tool_invocation',
  /** Processing step update */
  STEP: 'step',
  /** Step-level metric */
  STEP_METRIC: 'step_metric',
  /** Filesystem mutation notification */
  FILESYSTEM: 'filesystem',
  /** Reasoning / chain-of-thought */
  REASONING: 'reasoning',
  /** Stream completed */
  DONE: 'done',
  /** Stream error */
  ERROR: 'error',
  /** Heartbeat / keep-alive */
  HEARTBEAT: 'heartbeat',
} as const;

export type SSEEventTypeName = typeof SSE_EVENT_TYPES[keyof typeof SSE_EVENT_TYPES];

// ---------------------------------------------------------------------------
// Payload shapes (one per event type)
// ---------------------------------------------------------------------------

export interface SSETokenPayload {
  content: string;
  timestamp: number;
}

export interface SSEToolInvocationPayload {
  toolCallId: string;
  toolName: string;
  state: 'partial-call' | 'call' | 'result';
  args?: Record<string, unknown>;
  result?: unknown;
  timestamp: number;
}

export interface SSEStepPayload {
  step: string;
  status: 'started' | 'completed' | 'failed';
  stepIndex: number;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  result?: unknown;
}

export interface SSEStepMetricPayload {
  [key: string]: unknown;
  timestamp: number;
}

export interface SSEFilesystemPayload {
  scopePath?: string;
  applied?: unknown;
  errors?: unknown;
  [key: string]: unknown;
}

export interface SSEReasoningPayload {
  reasoning: string;
}

export interface SSEDonePayload {
  success: boolean;
  content: string;
  messageMetadata?: Record<string, unknown>;
  data?: unknown;
}

export interface SSEErrorPayload {
  message: string;
  details?: string;
}

// ---------------------------------------------------------------------------
// Discriminated union (useful on the consumer side)
// ---------------------------------------------------------------------------

export type SSEEvent =
  | { type: typeof SSE_EVENT_TYPES.TOKEN; data: SSETokenPayload }
  | { type: typeof SSE_EVENT_TYPES.TOOL_INVOCATION; data: SSEToolInvocationPayload }
  | { type: typeof SSE_EVENT_TYPES.STEP; data: SSEStepPayload }
  | { type: typeof SSE_EVENT_TYPES.STEP_METRIC; data: SSEStepMetricPayload }
  | { type: typeof SSE_EVENT_TYPES.FILESYSTEM; data: SSEFilesystemPayload }
  | { type: typeof SSE_EVENT_TYPES.REASONING; data: SSEReasoningPayload }
  | { type: typeof SSE_EVENT_TYPES.DONE; data: SSEDonePayload }
  | { type: typeof SSE_EVENT_TYPES.ERROR; data: SSEErrorPayload }
  | { type: typeof SSE_EVENT_TYPES.HEARTBEAT; data: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Encoder helpers (backend)
// ---------------------------------------------------------------------------

/**
 * Encode an SSE event into the wire format.
 *
 * Always emits both `event:` and `data:` fields so consumers can rely on
 * the named-event protocol rather than inspecting `data.type`.
 *
 * @example
 *   controller.enqueue(encoder.encode(sseEncode('token', { content: 'hi', timestamp: Date.now() })));
 */
export function sseEncode(eventType: SSEEventTypeName, payload: Record<string, unknown>): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Create a pre-bound SSE emitter for use inside ReadableStream controllers.
 *
 * @example
 *   const emit = createSSEEmitter(controller);
 *   emit('token', { content: 'Hello', timestamp: Date.now() });
 */
export function createSSEEmitter(controller: ReadableStreamDefaultController<Uint8Array>) {
  const encoder = new TextEncoder();
  return function emit(eventType: SSEEventTypeName, payload: Record<string, unknown>) {
    controller.enqueue(encoder.encode(sseEncode(eventType, payload)));
  };
}

// ---------------------------------------------------------------------------
// Standard response headers
// ---------------------------------------------------------------------------

export const SSE_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};
