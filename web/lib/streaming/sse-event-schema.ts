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
  /** Git-style diffs for client sync */
  DIFFS: 'diffs',
  /** Reasoning / chain-of-thought */
  REASONING: 'reasoning',
  /** Sandbox output (stdout/stderr) */
  SANDBOX_OUTPUT: 'sandbox_output',
  /** Progressive file edit detected during streaming */
  FILE_EDIT: 'file_edit',
  /** Primary response completed (stream still open for background tasks) */
  PRIMARY_DONE: 'primary_done',
  /** Stream completed (all background tasks finished) */
  DONE: 'done',
  /** Stream error */
  ERROR: 'error',
  /** Heartbeat / keep-alive */
  HEARTBEAT: 'heartbeat',
  /** Spec amplification lifecycle event */
  SPEC_AMPLIFICATION: 'spec_amplification',
  /** Spec section refinement progress */
  SPEC_REFINEMENT: 'spec_refinement',
  /** DAG task execution status */
  DAG_TASK_STATUS: 'dag_task_status',
  /** Initialization event */
  INIT: 'init',
  /** Orchestration progress update (agent nodes, steps, HITL, etc.) */
  ORCHESTRATION_PROGRESS: 'orchestration_progress',
  /** Auto-continue: LLM requested more turns or stopped after tool call */
  AUTO_CONTINUE: 'auto-continue',
  /** Next nudge: LLM stopped after list_files, prompt to proceed */
  NEXT: 'next',
  /** Progressive build loop iteration progress */
  PROGRESSIVE_BUILD: 'progressive_build',
  /** Bug #41: loop-guard abort — emitted when the 3-consecutive-tool-failures
   *  kill fires. UI surfaces this as a banner with the categorized reason. */
  LOOP_ABORT: 'loop_abort',
  /** Tool execution summary: total calls, succeeded, failed, duration */
  TOOL_SUMMARY: 'tool_summary',
  /** Single tool call result emitted for client-side display */
  TOOL_RESULT: 'tool_result',
  /** Auto-continuation progress: iteration, reason, requestId */
  CONTINUATION: 'continuation',
  /** Cap exhaustion: continuation limit reached, result is incomplete */
  CONTINUATION_EXHAUSTED: 'continuation_exhausted',
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

export interface SSEDiffsPayload {
  /** Array of file diffs */
  files: Array<{
    /** File path relative to workspace */
    path: string;
    /** Unified diff format string */
    diff: string;
    /** Type of change: create, update, delete */
    changeType: 'create' | 'update' | 'delete';
  }>;
  /** Number of files changed */
  count?: number;
  /** Request ID for tracking */
  requestId?: string;
  [key: string]: unknown;
}

export interface SSEReasoningPayload {
  reasoning: string;
}

export interface SSESandboxOutputPayload {
  stream: 'stdout' | 'stderr';
  chunk: string;
  toolCallId?: string;
  timestamp: number;
}

export interface SSEFileEditPayload {
  /** File path */
  path: string;
  /** Status: detected = LLM generated edit, applied = saved to filesystem */
  status: 'detected' | 'applied' | 'error';
  /** File operation type */
  operation?: 'write' | 'patch' | 'delete';
  /** Error message if status is error */
  error?: string;
  /** Timestamp */
  timestamp: number;
  /** New content for write/patch operations (for diff viewer) */
  content?: string;
  /** Unified diff string (alternative to content) */
  diff?: string;
}

export interface SSESpecAmplificationPayload {
  /** Amplification stage: started, spec_generated, refining, task_complete, complete, error */
  stage: 'started' | 'spec_generated' | 'refining' | 'task_complete' | 'complete' | 'error' | 'complete_with_timeouts';
  /** Fast model used for spec generation */
  fastModel?: string;
  /** Spec quality score (1-10) */
  specScore?: number;
  /** Number of sections generated */
  sectionsGenerated?: number;
  /** Current refinement iteration */
  currentIteration?: number;
  /** Total iterations planned */
  totalIterations?: number;
  /** Current section being refined */
  currentSection?: string;
  /** Task ID for task_complete stage */
  taskId?: string;
  /** Task title for task_complete stage */
  taskTitle?: string;
  /** Refined content for task_complete stage (to be displayed as assistant message) */
  content?: string;
  /** Error message if stage is error */
  error?: string;
  /** Timestamp */
  timestamp: number;
  /** Refined output (on complete stage) */
  refinedContent?: string;
  /** Filesystem edits detected */
  filesystem?: {
    status: 'detected' | 'applied';
    applied?: Array<{ path: string; operation: string; timestamp: number }>;
  };
  /** File writes detected */
  fileWrites?: Array<{ path: string; operation: string }>;
  /** Has file writes */
  hasFilewrites?: boolean;
  /** Timed out tasks (for complete_with_timeouts stage) */
  timedOutTasks?: string[];
}

export interface SSESpecRefinementPayload {
  /** Section title being refined */
  section: string;
  /** Tasks in this section */
  tasks: string[];
  /** Refinement progress: 0-100 */
  progress: number;
  /** Refined content chunk (streaming) */
  content?: string;
  /** Timestamp */
  timestamp: number;
}

export interface DAGTaskStatus {
  /** Task ID */
  taskId: string;
  /** Task title/description */
  title: string;
  /** Status: pending, running, complete, error */
  status: 'pending' | 'running' | 'complete' | 'error';
  /** Dependencies (task IDs that must complete first) */
  dependencies: string[];
  /** Error message if status is error */
  error?: string;
  /** Start timestamp */
  startedAt?: number;
  /** Complete timestamp */
  completedAt?: number;
}

export interface SSEDAGTaskStatusPayload {
  /** All tasks with their status */
  tasks: DAGTaskStatus[];
  /** Overall DAG progress: 0-100 */
  overallProgress: number;
  /** Currently executing tasks */
  activeTasks: string[];
  /** Timestamp */
  timestamp: number;
}

export interface SSEDonePayload {
  success: boolean;
  content: string;
  /** Bug #16 (audit): Reasoning/thinking tokens from the final response,
   *  accumulated during streaming and emitted in the done event so client
   *  consumers (e.g. the UI diff viewer, log pipelines) can access the full
   *  reasoning trace after the stream closes. Models that do not emit
   *  reasoning (e.g. non-reasoning models) will omit this field entirely. */
  reasoningContent?: string;
  messageMetadata?: Record<string, unknown> & {
    /** Routing metadata from first-response parsing (when present, enables multi-step auto-continue) */
    routing?: {
      /** The role the LLM chose for this request */
      primaryRole?: string;
      /** Confidence score 0–1 */
      confidence?: number;
      /** Whether a review cycle was triggered */
      reviewTriggered?: boolean;
      /** Auto-re-prompt message for the next plan step (client should send as follow-up user message) */
      stepReprompt?: string;
      /** Whether the routing plan has remaining steps */
      requiresAutoReprompt?: boolean;
      /** Estimated total steps in the plan */
      estimatedSteps?: number;
    };
  };
  data?: unknown;
}

export interface SSEErrorPayload {
  message: string;
  details?: string;
}

export interface SSEInitPayload {
  /** Session/request ID */
  requestId?: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Orchestration progress event — real-time updates from agent execution.
 * All fields except type/timestamp are optional — only emit what's available.
 */
export interface SSEOrchestrationProgressPayload {
  mode?: string;                                // Orchestration mode name
  nodeId?: string;                              // Current agent/node ID
  nodeRole?: string;                            // Role (planner, coder, reviewer, etc.)
  nodeModel?: string;                           // Model name
  nodeProvider?: string;                        // Provider (opencode, codex, amp, etc.)

  // Plan/step tracking
  steps?: Array<{
    id?: string;
    title?: string;
    description?: string;
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  }>;
  currentStepIndex?: number;
  totalSteps?: number;

  currentAction?: string;                       // Human-readable "what's happening now"
  phase?: 'planning' | 'acting' | 'verifying' | 'responding' | 'idle';

  // Multi-agent topology
  nodes?: Array<{
    id?: string;
    role?: string;
    model?: string;
    provider?: string;
    status?: 'idle' | 'working' | 'waiting' | 'failed';
  }>;

  // Inter-node communication
  nodeCommunication?: {
    from?: string;
    to?: string;
    content?: string;
    type?: 'delegation' | 'response' | 'review' | 'consensus' | 'relay';
  };

  // Errors/retries
  errors?: Array<{
    nodeId?: string;
    message: string;
    retryCount?: number;
    recovered?: boolean;
  }>;

  // HITL requests
  hitlRequests?: Array<{
    id?: string;
    action?: string;
    reason?: string;
    status?: 'pending' | 'approved' | 'rejected' | 'expired';
    timeoutAt?: number;
  }>;

  // Extensibility
  metadata?: Record<string, unknown>;
  timestamp: number;
}

/** Auto-continue: LLM requested more turns or stopped after tool call */
export interface SSEAutoContinuePayload {
  content: string;
  toolSummary?: string;
  contextHint?: string;
  implicitFiles?: string[];
  fileRequestConfidence?: string;
  continuationCount?: number;
  maxContinuations?: number;
  timestamp: number;
}

/** Next nudge: LLM stopped after list_files, prompt to proceed */
export interface SSENexPayload {
  content: string;
  reason?: string;
  listedPath?: string;
  recursive?: string;
  continuationCount?: number;
  maxContinuations?: number;
  timestamp: number;
}

/**
 * Bug #41: loop-guard abort payload. Emitted as the FINAL SSE event when the
 * 3-consecutive-tool-failures kill fires. The UI shows a banner with the
 * categorized reason (binary_missing | tool_failing | timeout | unknown),
 * the failed tool list, and the recovery suggestion.
 */
export interface SSELoopAbortPayload {
  /** Categorized abort reason for the UI banner. */
  abortReason: 'binary_missing' | 'tool_failing' | 'timeout' | 'unknown';
  /** Number of consecutive failures that triggered the kill. */
  consecutive: number;
  /** Last N failed tool calls (name + error preview) so the UI can show details. */
  failedTools: Array<{ name: string; error: string }>;
  /** Human-readable recovery suggestion. */
  suggestion: string;
  /** Auto-recovery target tool (e.g. 'write_file' for binary_missing aborts). */
  autoRecoverTo?: string;
  /** The [STEER] prompt the LLM received — useful for log/grep correlation. */
  steer?: string;
  /** Timestamp */
  timestamp: number;
}

/** Progressive build loop event — emitted at each iteration and completion */
export interface SSEProgressiveBuildPayload {
  /** Stage of the build loop */
  stage:
    | 'started'
    | 'iteration_start'
    | 'iteration_complete'
    | 'iteration_error'
    | 'complete'
    | 'max_iterations_reached';
  /** Current iteration number (1-based) */
  iteration?: number;
  /** Maximum allowed iterations */
  maxIterations?: number;
  /** Context mode used */
  contextMode?: 'diff' | 'read' | 'tree';
  /** Files created/written in this iteration */
  filesCreatedThisRound?: string[];
  /** Gaps identified by reflection pass */
  gapsIdentified?: string[];
  /** Summary from reflection/review */
  reflectionSummary?: string;
  /** Current workspace tree snapshot */
  projectTree?: string;
  /** Duration of this iteration in ms */
  durationMs?: number;
  /** Whether the build is fully complete */
  buildComplete?: boolean;
  /** Reason for completion (if buildComplete is true) */
  completionReason?: string;
  /** Total iterations completed */
  totalIterations?: number;
  /** Error message (for iteration_error stage) */
  error?: string;
  /** Timestamp */
  timestamp: number;
}

/** Tool execution summary from v1-api-with-tools */
export interface SSEToolSummaryPayload {
  /** Total tool calls attempted */
  totalCalls: number;
  /** Number of successful tool calls */
  succeeded: number;
  /** Number of failed tool calls */
  failed: number;
  /** Total duration in milliseconds */
  durationMs?: number;
  /** Timestamp */
  timestamp?: number;
}

/** Single tool call result — emitted via onStreamChunk for client-side display. */
export interface SSEToolResultPayload {
  tool: string;
  success: boolean;
  exitCode: number;
  durationMs: number;
  args: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

/** Auto-continuation progress update */
export interface SSEContinuationPayload {
  /** Request ID for correlation */
  requestId: string;
  /** Current iteration number */
  iteration: number;
  /** Reason for continuation ('tool_results', 'frustration', 'too_short', etc.) */
  reason: string;
  /** Whether this continuation was force-signaled */
  forceSignal?: boolean;
  /** Total continuations so far */
  continuationsSoFar?: number;
  /** Timestamp */
  timestamp?: number;
}

/** Cap exhaustion: continuation limit reached before completing all tasks. */
export interface SSEContinuationExhaustedPayload {
  /** Request ID for correlation */
  requestId: string;
  /** Total iterations completed */
  iteration: number;
  /** Maximum allowed iterations */
  maxIterations: number;
  /** Reason for exhaustion ('max_iterations', 'max_continuations_reached') */
  reason: string;
  /** Number of incomplete tasks / signs of remaining work */
  incompleteSignals?: string[];
  /** Human-readable description of what was left incomplete */
  description?: string;
  /** Timestamp */
  timestamp: number;
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
  | { type: typeof SSE_EVENT_TYPES.DIFFS; data: SSEDiffsPayload }
  | { type: typeof SSE_EVENT_TYPES.REASONING; data: SSEReasoningPayload }
  | { type: typeof SSE_EVENT_TYPES.SANDBOX_OUTPUT; data: SSESandboxOutputPayload }
  | { type: typeof SSE_EVENT_TYPES.FILE_EDIT; data: SSEFileEditPayload }
  | { type: typeof SSE_EVENT_TYPES.SPEC_AMPLIFICATION; data: SSESpecAmplificationPayload }
  | { type: typeof SSE_EVENT_TYPES.SPEC_REFINEMENT; data: SSESpecRefinementPayload }
  | { type: typeof SSE_EVENT_TYPES.DAG_TASK_STATUS; data: SSEDAGTaskStatusPayload }
  | { type: typeof SSE_EVENT_TYPES.ORCHESTRATION_PROGRESS; data: SSEOrchestrationProgressPayload }
  | { type: typeof SSE_EVENT_TYPES.INIT; data: SSEInitPayload }
  | { type: typeof SSE_EVENT_TYPES.DONE; data: SSEDonePayload }
  | { type: typeof SSE_EVENT_TYPES.ERROR; data: SSEErrorPayload }
  | { type: typeof SSE_EVENT_TYPES.HEARTBEAT; data: Record<string, unknown> }
  | { type: typeof SSE_EVENT_TYPES.AUTO_CONTINUE; data: SSEAutoContinuePayload }
  | { type: typeof SSE_EVENT_TYPES.NEXT; data: SSENexPayload }
  | { type: typeof SSE_EVENT_TYPES.PROGRESSIVE_BUILD; data: SSEProgressiveBuildPayload }
  | { type: typeof SSE_EVENT_TYPES.LOOP_ABORT; data: SSELoopAbortPayload }
  | { type: typeof SSE_EVENT_TYPES.TOOL_SUMMARY; data: SSEToolSummaryPayload }
  | { type: typeof SSE_EVENT_TYPES.TOOL_RESULT; data: SSEToolResultPayload }
  | { type: typeof SSE_EVENT_TYPES.CONTINUATION; data: SSEContinuationPayload }
  | { type: typeof SSE_EVENT_TYPES.CONTINUATION_EXHAUSTED; data: SSEContinuationExhaustedPayload };

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
const HEARTBEAT_INTERVAL_MS = 25_000;

export function createSSEEmitter(
  controller: ReadableStreamDefaultController<Uint8Array>,
  abortSignal?: AbortSignal,
) {
  const encoder = new TextEncoder();
  let closed = false;
  const baseEmit = (eventType: SSEEventTypeName, payload: Record<string, unknown>) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(sseEncode(eventType, payload)));
    } catch {
      closed = true;
      cleanup();
    }
  };

  const cleanup = () => {
    closed = true;
    if (heartbeatId) clearInterval(heartbeatId);
  };

  if (!abortSignal) return baseEmit;

  let lastActivity = Date.now();
  let heartbeatId = setInterval(() => {
    if (closed || abortSignal.aborted || controller.desiredSize === null) {
      cleanup();
      return;
    }
    if (Date.now() - lastActivity >= HEARTBEAT_INTERVAL_MS) {
      baseEmit('heartbeat', { t: Date.now() });
    }
  }, HEARTBEAT_INTERVAL_MS);

  abortSignal.addEventListener('abort', () => cleanup(), { once: true });

  return (eventType: SSEEventTypeName, payload: Record<string, unknown>) => {
    lastActivity = Date.now();
    baseEmit(eventType, payload);
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
  'Access-Control-Allow-Origin':
    (typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.NEXT_PUBLIC_APP_URL) || '',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-anonymous-session-id',
  'Vary': 'Origin',
};

/**
 * Build complete SSE response headers with optional extras.
 * Every SSE response branch in the route layer MUST use this function
 * instead of constructing headers inline, to ensure all responses
 * consistently include CORS headers and (when applicable) the
 * anonymous-session cookie.
 */
export function buildSSEResponseHeaders(options?: {
  anonSessionIdToSet?: string;
  stallMeta?: { fired: boolean; reason?: string };
  extraHeaders?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = { ...SSE_RESPONSE_HEADERS };

  if (options?.anonSessionIdToSet) {
    const isSecure =
      (typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.NODE_ENV === 'production');
    headers['Set-Cookie'] =
      `anon-session-id=${options.anonSessionIdToSet}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly${isSecure ? '; Secure' : ''}`;
  }

  if (options?.stallMeta?.fired) {
    headers['x-stall-fired'] = 'true';
    headers['x-stall-reason'] = options.stallMeta.reason ?? 'unknown';
  }

  if (options?.extraHeaders) {
    Object.assign(headers, options.extraHeaders);
  }

  return headers;
}
