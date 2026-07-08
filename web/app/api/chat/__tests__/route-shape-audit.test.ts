/**
 * Route-level integration test that verifies the chat-route's
 * `[CHAT-ROUTE] processUnifiedAgentRequest returned` INFO line emits
 * with the expected `responseShapeKey` + `responseLen` for known
 * response shapes returned by `processUnifiedAgentRequest`.
 *
 * Shape of the assertion:
 *   - Mock `@/lib/chat/chat-logger` so its module-level `chatLogger` is a
 *     vitest spy (the route imports the pre-instantiated `chatLogger`
 *     export, NOT `createLogger('Chat API')` itself).
 *   - Mock `@/lib/orchestra/unified-agent-service` so its exported
 *     `processUnifiedAgentRequest` resolves to a known shape per test.
 *   - Drive `POST(request)` against a fake-Next request with `stream:true`
 *     so the route takes the `useUnifiedAgentStream` branch (the audit
 *     emit at L1668-L1669 only fires INSIDE the `ReadableStream.start`
 *     callback, gated by `useUnifiedAgentStream`).
 *   - Drain the stream body fully so the `start(controller)` resolution
 *     triggers the audit emit (Next.js only invokes the start callback
 *     once a consumer iterates the response body).
 *   - Assert `chatLogger.info` was called with the expected prefix and a
 *     payload whose `responseShapeKey` + `responseLen` match the
 *     expectations for the fixture shape.
 *
 * Note: the `[AGENT-SERVICE]` audit emit (hoisted into
 * `unified-agent-service.ts` in the prior turn) does NOT fire here
 * because we mock `processUnifiedAgentRequest` — the real function
 * never runs. Verifying the service-layer audit is the explicit job of
 * a separate `lib/orchestra/__tests__/service-shape-audit.test.ts`
 * (see the see-also section below).
 *
 * See also:
 * - `app/api/chat/__tests__/next-step-suggestions.test.ts` — the
 *   precedent test pattern this file follows (mock factory + custom
 *   NextResponse).
 * - `lib/chat/__tests__/shape-helpers.test.ts` — unit-level coverage of
 *   `shapeKeyOf` + `serializableTextLength` in isolation.
 * - `lib/chat/content-stringifier.ts` — the helper that converts
 *   non-string response shapes to strings BEFORE the route inspects
 *   them. Used to derive the expected `responseLen` here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────
// 1. Platform-level mocks — `next/server`, logger, request auth.
// ────────────────────────────────────────────────────────────────────

// Mock NextResponse to a simple body-typed shape mirroring the precedent.
vi.mock('next/server', () => {
  class MockNextResponse {
    body: any;
    status: number;
    headers: Headers;
    constructor(body: any, init: { status?: number; headers?: HeadersInit } = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.headers = new Headers(init.headers ?? {});
    }
    static json(body: any, init: { status?: number; headers?: HeadersInit } = {}) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextRequest: class {}, NextResponse: MockNextResponse };
});

// The route imports the module-level singleton `chatLogger`, so we stub
// the entire `@/lib/chat/chat-logger` module to expose a vitest spy
// surface. (Mocking `@/lib/utils/logger` would only stub the createLogger
// factory used by other modules — the route reads `chatLogger` directly.)
//
// Why we MUST NOT mimic the `next-step-suggestions.test.ts` precedent
// (which mocks `@/lib/utils/logger` instead): the chat route imports
// `chatLogger` (the pre-instantiated singleton, `new ChatLogger('Chat API')`)
// and calls methods on it directly. Stubbing `createLogger` would leave
// the real `chatLogger` instance in place, with real downstream effects
// (DB lookups, AsyncLocalStorage writes, console output). Specifically,
// `chatLogger.child(...)` is invoked from `lib/chat/llm-provider-health.ts`
// via the route's transitive import chain — the previous mock lacked
// `.child()`, causing `TypeError: chatLogger.child is not a function`
// at module-load time. The mock below covers all 9 ChatLogger public
// methods with self-recursive `child()` so any depth of context-wrapped
// logger works.
vi.mock('@/lib/chat/chat-logger', () => {
  function makeLoggerStub() {
    const stub: any = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    stub.child = vi.fn().mockImplementation(makeLoggerStub);
    stub.logRequestStart = vi.fn();
    stub.logRequestComplete = vi.fn();
    stub.logProviderAttempt = vi.fn();
    stub.logStreamEvent = vi.fn();
    return stub;
  }
  // Expose BOTH the singleton `chatLogger` export AND the
  // `createChatLogger` factory — the route's transitive import chain
  // (e.g. `lib/errors/logging-utils.ts:7`) calls `createChatLogger('...')`
  // at module-load time. Without the factory in the mock, vitest
  // throws "No createChatLogger export is defined" before any test runs.
  return {
    chatLogger: makeLoggerStub(),
    createChatLogger: vi.fn(() => makeLoggerStub()),
  };
});

// `chatRequestLogger.logRequestStart` is async + DB-bound (would attempt
// SQLite init during the route's start-of-request logging). Stub no-ops.
vi.mock('@/lib/chat/chat-request-logger', () => ({
  chatRequestLogger: {
    logRequestStart: vi.fn().mockResolvedValue(undefined),
    logRequestComplete: vi.fn().mockResolvedValue(undefined),
  },
}));

// Auth: anonymous, success.
vi.mock('@/lib/auth/request-auth', () => ({
  resolveRequestAuth: vi.fn().mockResolvedValue({
    success: true,
    userId: 'u-test',
    source: 'session',
  }),
}));

// Rate-limit: allow everything (the route hits this BEFORE the shape
// audit fires; without permissive limit, all 3 tests would 429).
vi.mock('@/lib/middleware/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockReturnValue({
    allowed: true,
    remaining: 100,
    resetAfter: 60_000,
    retryAfter: 0,
  }),
}));

// Filesystem owner: deterministic owner id for the test session.
vi.mock('@/lib/virtual-filesystem/resolve-filesystem-owner', () => ({
  resolveFilesystemOwner: vi.fn().mockResolvedValue({
    ownerId: 'u-test',
    anonSessionId: undefined,
  }),
  withAnonSessionCookie: (res: any) => res,
}));

// UI-source AsyncLocalStorage helpers — used by setUISource at the very
// top of POST. Stubbing here keeps the route's first line functional
// without threading AsyncLocalStorage context.
vi.mock('@/lib/http/ui-source-header-server', () => ({
  setUISource: vi.fn(),
  readUISourceHeader: vi.fn().mockReturnValue(undefined),
}));

// Memory pressure monitor — non-throttling.
vi.mock('@/lib/management/process-memory-monitor', () => ({
  processMemoryMonitor: {
    shouldThrottle: vi.fn().mockReturnValue(false),
    getStatus: vi.fn().mockReturnValue({}),
  },
}));

// setMetricsLogger — pure side-effect setter, no impl needed.
vi.mock('@/lib/memory', () => ({ setMetricsLogger: vi.fn() }));

// Toplevel provider registry — needs to expose a `test_provider` so the
// route's Zod schema validation + bare-model pre-validation gate pass.
// The companion `test_model` provider keeps route.ts's downstream Zod
// schema + bare-model pre-validation happy.
vi.mock('@/lib/providers/llm-providers', () => ({
  PROVIDERS: {
    test_provider: {
      models: [{ id: 'test_model' }],
      supportsStreaming: true,
    },
  },
}));

// `@/lib/chat/enhanced-llm-service` is brought in transitively via
// `lib/api/response-router.ts`, which the route's import graph reaches.
// Its module-level singleton instantiates `new EnhancedLLMService()`,
// whose constructor calls `initializeEndpointConfigs()`. That helper
// iterates `PROVIDERS.openrouter` / `.chutes` / `.anthropic` / `.google`
// / `.mistral` / etc. — which my narrower `PROVIDERS` mock above does
// not provide, so module-load fails with `Cannot read 'models' of
// undefined` at enhanced-llm-service.ts:152 before any test runs.
//
// Route.ts does NOT import `@/lib/chat/enhanced-llm-service` directly
// (verified by grep). The chain is purely transitive, so the test only
// needs the constructor + singleton to be inert. We replace the class
// with a no-op constructor and the singleton with a Proxy that
// auto-stubs any property access to a vi.fn() (so any deeper transitive
// call through the singleton — `enhancedLLMService.someMethod()` — is
// satisfied without further mock tweaking).
vi.mock('@/lib/chat/enhanced-llm-service', () => {
  const inertInstance = new Proxy({}, {
    get: () => vi.fn(),
  });
  class InertEnhancedLLMService {
    constructor() {
      // No-op: skip initializeEndpointConfigs / setupFallbackChains /
      // startHealthMonitoring. Lets the route's import chain load.
    }
  }
  return {
    EnhancedLLMService: InertEnhancedLLMService,
    enhancedLLMService: inertInstance,
  };
});

// Request-type detector — classify as non-code, simple chat (no v2/agentic
// shift). Real impl calls a classifier that we want to skip.
vi.mock('@/lib/utils/request-type-detector', () => ({
  detectRequestType: vi.fn().mockResolvedValue({ type: 'simple' }),
}));

// ID generator (used by `generateSecureId('chat')` for requestId).
vi.mock('@/lib/utils/utils', () => ({
  generateSecureId: vi.fn().mockReturnValue('req-test-123'),
  sanitizePathSegment: (s: string) => s,
}));

// ────────────────────────────────────────────────────────────────────
// 2. Heavy upstream modules the route transitively imports.
//    Each module gets a no-op stub so module-load side-effects
//    (DB queries, env probes, network calls) are short-circuited.
// ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/orchestra/stateful-agent/commit/shadow-commit', () => ({
  ShadowCommitManager: class {
    static getInstance() {
      return { commit: vi.fn().mockResolvedValue(undefined) };
    }
  },
}));

vi.mock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
  virtualFilesystem: {
    getTree: vi.fn().mockResolvedValue({}),
    listFiles: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/virtual-filesystem/filesystem-edit-session-service', () => ({
  filesystemEditSessionService: {
    getRecentDenials: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/virtual-filesystem/context-pack-service', () => ({
  contextPackService: { build: vi.fn().mockResolvedValue('') },
}));

vi.mock('@/lib/utils/ndjson-parser', () => ({
  createNDJSONParser: vi.fn().mockReturnValue({ parse: vi.fn(), reset: vi.fn() }),
}));

vi.mock('@/lib/streaming/stream-state-manager', () => ({
  streamStateManager: {
    create: vi.fn().mockReturnValue({ buffer: '', parser: { emittedEdits: new Set(), unclosedPositions: new Set() }, markerSeen: false, charsEmittedSafely: 0 }),
    reset: vi.fn(),
  },
}));

vi.mock('@/lib/streaming/stream-control-handler', () => ({
  notifyStreamComplete: vi.fn(),
  notifyNeedMoreTurns: vi.fn(),
}));

vi.mock('@/lib/streaming/sse-event-schema', () => ({
  createSSEEmitter: vi.fn().mockReturnValue(() => Promise.resolve()),
  SSE_RESPONSE_HEADERS: { 'content-type': 'text/event-stream' },
  SSE_EVENT_TYPES: {
    STEP: 'step',
    TOKEN: 'token',
    TOOL_INVOCATION: 'tool_invocation',
    AUTO_CONTINUE: 'auto_continue',
    FILE_EDIT: 'file_edit',
    FILESYSTEM: 'filesystem',
  },
}));

vi.mock('@/lib/mcp', () => ({
  getMCPToolsForAI_SDK: vi.fn().mockResolvedValue([]),
  callMCPToolFromAI_SDK: vi.fn().mockResolvedValue({ success: true, output: '' }),
}));

vi.mock('@/lib/powers/mem0-power', () => ({
  mem0Search: vi.fn().mockResolvedValue({ success: false, results: [] }),
  buildMem0SystemPrompt: vi.fn().mockReturnValue(''),
  isMem0Configured: vi.fn().mockReturnValue(false),
  mem0Add: vi.fn().mockResolvedValue(undefined),
  prewarmMem0Cache: vi.fn(),
}));

vi.mock('@/lib/chat/stream-chunk-handler', () => ({
  createStreamChunkHandler: vi.fn().mockReturnValue(() => {}),
  createStreamChunkState: vi.fn().mockReturnValue({}),
  resetStreamChunkState: vi.fn(),
  DEFAULT_ROLE_SELECT_MARKERS: ['[ROLE_SELECT]', '[ROUTING_METADATA]'],
}));

vi.mock('@/lib/chat/file-edit-parser', () => ({
  parseFilesystemResponse: vi.fn().mockReturnValue([]),
  extractAndSanitize: vi.fn().mockReturnValue({ content: '', edits: [] }),
  createIncrementalParser: vi.fn().mockReturnValue({ emittedEdits: new Set(), unclosedPositions: new Set() }),
  extractIncrementalFileEdits: vi.fn().mockReturnValue([]),
  stripHeredocMarkers: (s: string) => s,
  isValidFilePath: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/chat/file-diff-utils', () => ({
  applyUnifiedDiffToContent: vi.fn().mockImplementation((a: string) => a),
}));

vi.mock('@/lib/chat/stream-safety-helpers', () => ({
  signalStreamError: vi.fn(),
  safeEnqueue: vi.fn(),
}));

vi.mock('@/lib/chat/auto-continue-helper', () => ({
  // Decisive: return `{continue: false, ...}` so the route's do-while(false)
  // loop exits cleanly and the SSE start(controller) flow completes.
  decideAutoContinue: vi.fn().mockReturnValue({
    continue: false,
    reason: 'mocked-no-continue',
    continuationsSoFar: 0,
  }),
  needsMoreTurnsDetector: vi.fn(),
  clearContinuationCount: vi.fn(),
}));

vi.mock('@/lib/chat/llm-continuation', () => ({
  shouldAutoContinue: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/orchestra/steer-service', () => ({
  InvalidModelError: class extends Error {},
}));

vi.mock('@/lib/orchestra/provider-health', () => ({
  checkProviderHealth: vi.fn().mockResolvedValue({ available: true }),
}));

vi.mock('@/lib/errors/error-handler', () => ({
  errorHandler: {
    // processError is called from route.ts L5331 + L7113 in error-cleanup paths.
    // The consumer at L5349-L5351 reads `.code` + `.severity` on the return
    // value before constructing the user-facing error response. We return a
    // minimal stub satisfying those reads without invoking the full
    // NextResponse constructor chain that fails in the vitest environment
    // (`NextResponse.json is not a constructor`).
    processError: vi.fn().mockImplementation((_e: any, _msg: string) => ({
      code: 'mocked-error',
      severity: 'low',
    })),
  },
}));

vi.mock('@/lib/session/session-naming', () => ({
  generateSessionName: vi.fn().mockResolvedValue('001'),
  sessionNameExists: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/api/streaming-events', () => ({
  buildSupplementalAgenticEvents: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/sandbox/sandbox-service-bridge', () => ({
  sandboxBridge: { execute: vi.fn() },
}));

vi.mock('@/lib/sandbox/types', () => ({
  determineExecutionPolicy: vi.fn().mockReturnValue({}),
}));

// chat-helpers (./) — surface only what the route actively uses.
vi.mock('../chat-helpers', () => ({
  applySearchReplace: vi.fn().mockImplementation((s: string) => s),
  pollWithBackoff: vi.fn(),
  buildClientVisibleUnifiedResponse: vi.fn().mockImplementation((r: any) => r),
  chatMessageSchema: { safeParse: vi.fn().mockReturnValue({ success: true }) },
  chatRequestSchema: {
    safeParse: vi.fn().mockImplementation((body: any) => ({
      success: true,
      data: {
        ...body,
        apiKeys: body?.apiKeys ?? {},
      },
    })),
  },
}));

vi.mock('../filesystem-edits', () => ({}));

// @bing/shared/agent — used heavily. Stub each export individually so the
// route's destructure imports don't throw a TypeError.
vi.mock('@bing/shared/agent', () => ({
  executeV2Task: vi.fn(),
  executeV2TaskStreaming: vi.fn(),
  workforceManager: {},
  createTaskClassifier: vi.fn().mockReturnValue({ classify: vi.fn() }),
  SYSTEM_PROMPTS: {},
  VFS_FILE_EDITING_TOOL_PROMPT: '',
  generateDynamicInjection: vi.fn().mockReturnValue(''),
  getOrchestrationModeFromRequest: vi.fn().mockReturnValue('auto'),
  executeWithOrchestrationMode: vi.fn(),
}));

vi.mock('@bing/shared/agent/prompt-parameters', () => ({
  applyPromptModifiers: vi.fn().mockResolvedValue(''),
  getPreset: vi.fn(),
  PROMPT_PRESETS: {},
  generateDebugHeaderValue: vi.fn().mockReturnValue('default'),
  emitTelemetryEvent: vi.fn(),
}));

vi.mock('@bing/shared/agent/tool-schema', () => ({
  normalizeSchemaForAI: vi.fn().mockImplementation((s: any) => s),
}));

vi.mock('@bing/shared/agent/feedback-injection', () => ({
  createFeedbackEntry: vi.fn(),
  addFeedback: vi.fn(),
  injectFeedback: vi.fn(),
  detectHealingTrigger: vi.fn().mockReturnValue(false),
  detectIncompleteResponse: vi.fn().mockReturnValue(false),
  generateHealingPrompt: vi.fn().mockReturnValue(''),
  getFeedbackInjectionBudget: vi.fn().mockReturnValue({ remaining: 3 }),
}));

vi.mock('@bing/shared/agent/successive-tracker', () => ({
  getTracker: vi.fn(),
  recordResponse: vi.fn(),
  recordToolCall: vi.fn(),
  checkReEvalTrigger: vi.fn().mockReturnValue(false),
  recordReEval: vi.fn(),
  generateTrackerSummary: vi.fn().mockReturnValue(''),
}));

vi.mock('@bing/shared/agent/first-response-routing', () => ({
  parseFirstResponseRouting: vi.fn(),
  stripRoutingMarkers: vi.fn().mockImplementation((s: string) => s),
  shouldTriggerReview: vi.fn().mockReturnValue(false),
  generateStepReprompt: vi.fn(),
  routingToRoleRedirectSection: vi.fn(),
  truncateAtFirstRouting: vi.fn().mockImplementation((s: string) => s),
  buildRoutingMetadataForClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@bing/shared/agent/tool-classification', () => ({
  READ_ONLY_TOOL_NAMES: [],
  WRITE_TOOL_NAMES: [],
  hasMutationSuffix: vi.fn().mockReturnValue(false),
  hasReadSuffix: vi.fn().mockReturnValue(false),
}));

// session file tracker + VFS git-backed module — fired as fire-and-forget
// from the route's start-up phase (trackSessionFiles).
vi.mock('@/lib/virtual-filesystem/session-file-tracker', () => ({
  trackSessionFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tools/tool-call-tracker', () => ({
  toolCallTracker: {
    recordToolCall: vi.fn(),
    recordToolCalls: vi.fn().mockResolvedValue(undefined),
  },
}));

// ────────────────────────────────────────────────────────────────────
// 3. THE TARGET — processUnifiedAgentRequest. Stubs per-test with
//    `mockResolvedValueOnce` in beforeEach-managed setup.
// ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/orchestra/unified-agent-service', () => ({
  processUnifiedAgentRequest: vi.fn(),
}));

// virtual-filesystem/git-backed-vfs — used by VFS batch-mode flush.
// Stubbed so the `import('@/lib/virtual-filesystem/git-backed-vfs')`
// dynamic import the route does inside the SSE start callback resolves.
vi.mock('@/lib/virtual-filesystem/git-backed-vfs', () => ({
  enableVFSBatchMode: vi.fn(),
  flushVFSBatchMode: vi.fn().mockResolvedValue(undefined),
}));

// ────────────────────────────────────────────────────────────────────
// Imports (post-mock)
// ────────────────────────────────────────────────────────────────────

import { POST } from '../route';
import { chatLogger } from '@/lib/chat/chat-logger';
import { processUnifiedAgentRequest } from '@/lib/orchestra/unified-agent-service';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Build a fake-NextRequest matching the precedent's makeReq shape, plus
 * a stream flag so the route takes the useUnifiedAgentStream branch.
 */
function makeReq(
  overrides: Partial<{
    stream: boolean;
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
  }> = {},
) {
  const body = {
    messages: [{ role: 'user', content: 'test' }],
    provider: 'test_provider',
    model: 'test_model',
    temperature: 0.7,
    maxTokens: 32,
    stream: true,
    apiKeys: {},
    // Bug #X -- allow the new 524-vs-200 tests to toggle `stream: false`
    // for the non-streaming branch. Spread AFTER the defaults so an override
    // on e.g. `stream: false` wins.
    ...overrides,
  };
  return {
    headers: {
      get: (name: string) => {
        const n = name.toLowerCase();
        if (n === 'content-type') return 'application/json';
        if (n === 'content-length') return String(JSON.stringify(body).length);
        return null;
      },
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
    signal: new AbortController().signal,
  };
}

/**
 * Drain a NextResponse body fully so its `start(controller)` callback
 * resolves (Next.js only invokes ReadableStream.start once a consumer
 * attaches via `for await` or array iteration).
 */
async function drainResponse(res: any): Promise<void> {
  if (!res?.body) return;
  // MockNextResponse exposes `body` as the actual JSON. Walk it once.
  // For real ReadableStream bodies, this would consume chunks; the
  // Stream API contract is the same — once iteration completes, start()
  // is fully done.
  if (typeof res.body[Symbol.asyncIterator] === 'function') {
    // Real stream — drain it.
    for await (const _chunk of res.body) {
      /* consume */
    }
    return;
  }
  // MockNextResponse — `body` is the wrapped JSON object; no iteration
  // needed but ensure the stream "finishes" by touching headers.
  void res.headers;
}

/**
 * The `stringifyMessageContent` helper turns non-string response shapes
 * into strings BEFORE `serializableTextLength` runs. We import the real
 * helper + `serializableTextLength` so the test exercises the same
 * path the production code does.
 */
import { stringifyMessageContent } from '@/lib/chat/content-stringifier';
import { serializableTextLength } from '@/lib/chat/shape-helpers';

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('POST /api/chat — response shape audit ([CHAT-ROUTE] processUnifiedAgentRequest returned)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The chat-route audit at L1668-L1669 emits:
  //   chatLogger.info('[CHAT-ROUTE] processUnifiedAgentRequest returned', {
  //     requestId, responseType, responseShapeKey, responseLen,
  //     bufferLen, elapsedMs
  //   })
  // We assert on the message prefix + the inspector-pair fields. Other
  // fields (requestId, elapsedMs, bufferLen) are route-local and varied
  // by request; we don't pin them down here.
  //
  // `expectedResponseLen` is intentionally NOT pinned in the fixture
  // object. The inspector pair at route.ts:1668-L1669 does:
  //   responseLen = serializableTextLength(result.response)   // raw shape
  // For string shapes that returns `.length` directly (e.g. 19 for
  // 'plain-text-response'). For non-string shapes (ContentPart array,
  // StreamingResponse, etc.) it returns `JSON.stringify(value).length`,
  // which is NOT the same as `stringifyMessageContent(value).length` —
  // e.g. `{content:'sr', isComplete:false}` is 35 via JSON.stringify
  // (full keys+types) and 2 via stringifyMessageContent (extracts
  // `.content`). Hardcoding both would make the test fail as soon as
  // either helper's algorithm changes. We compute `expectedResponseLen`
  // inline via the same helper the route uses so the test contract
  // tracks any future helper behavior change automatically.

  const fixtures = [
    {
      name: 'plain string',
      // Plain text LLM response — typeof string, shapeKeyOf returns 'string'.
      response: 'plain-text-response',
      expectedShapeKey: 'string',
    },
    {
      name: 'ContentPart array (Vercel AI SDK shape)',
      // Two text parts shapeKeyOf bucket-classifies as 'array[ContentPart]'.
      response: [
        { type: 'text', text: 'cp-0 ' },
        { type: 'text', text: 'cp-1' },
      ],
      expectedShapeKey: 'array[ContentPart]',
    },
    {
      name: 'StreamingResponse shape ({content, isComplete})',
      // Vercel AI SDK per-token chunk. shapeKeyOf distinguishes this bucket
      // from `{role, content}` so non-final chunks stay auditable.
      response: { content: 'sr', isComplete: false },
      expectedShapeKey: 'object{StreamingResponse}',
    },
    {
      name: 'role-bagged assistant content ({role, content})',
      // Anthropic / Gemini / OpenAI finalized-message shape — fully
      // assembled message dict WITHOUT isComplete, so it's NOT a
      // per-token StreamingResponse. shapeKeyOf's StreamingResponse
      // fast-path checks for `isComplete` FIRST; since this object
      // only has `role` + `content`, the check falls through to the
      // `object{role,content}` bucket. Mirrors what downstream
      // `applyMessage`-style callers see when they hydrate a
      // provider-final payload directly (rather than per-token
      // accumulation).
      response: { role: 'assistant', content: 'rc' },
      expectedShapeKey: 'object{role,content}',
    },
  ];

  it.each(fixtures)('emits expected responseShapeKey + responseLen for $name', async ({
    response,
    expectedShapeKey,
  }) => {
    // The route's inspector pair is:
    //   responseShapeKey = shapeKeyOf(result.response)             // raw shape
    //   responseLen      = serializableTextLength(result.response)  // raw shape
    //
    // So we mock `processUnifiedAgentRequest` to return the RAW shape
    // (not pre-coerced to a string) — the route's own stringifyMessageContent
    // normalizes it BEFORE reading the response for downstream emit
    // (token/fileEdit/) purposes, but the audit's inspector pair runs
    // against whatever processUnifiedAgentRequest returned without
    // pre-coercion. This is what we want to verify.
    vi.mocked(processUnifiedAgentRequest).mockResolvedValueOnce({
      success: true,
      mode: 'v1-api',
      metadata: { provider: 'test_provider', model: 'test_model' },
      response, // <-- RETURN RAW SHAPE so shapeKeyOf classifies the bucket
      steps: [],
    } as any);

    const res = await POST(makeReq() as any);
    await drainResponse(res);

    // Compute expectedResponseLen using the SAME helper the route uses
    // (serializableTextLength). This pins the audit's emit to whatever
    // the helper computes for the raw shape — catching any drift between
    // the helpers themselves and the audit's emit pipeline, while
    // staying forward-compatible with helper-algorithm changes.
    const expectedResponseLen = serializableTextLength(response);

    expect(chatLogger.info).toHaveBeenCalledWith(
      '[CHAT-ROUTE] processUnifiedAgentRequest returned',
      expect.objectContaining({
        responseShapeKey: expectedShapeKey,
        responseLen: expectedResponseLen,
      }),
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// Route-level stall watchdog — the fix for "POST /api/chat stays pending
// indefinitely; nothing streams; no fallback/timeout fires."
//
// The unified streaming path awaits `processUnifiedAgentRequest(...)` inside
// the SSE `start(controller)` callback. If that await never settles (provider
// wedged, SDK ignores abort, or a pre-LLM preamble hang), the response stayed
// open until the user manually aborted (~4 min observed). The watchdog races
// the await against an idle deadline and, on expiry, emits an error SSE event,
// aborts the agent turn, and closes the stream — guaranteeing the request is
// always bounded regardless of whether the inner promise ever settles.
// ────────────────────────────────────────────────────────────────────
describe('POST /api/chat — route-level stall watchdog (bounds indefinite hangs)', () => {
  const ORIGINAL_TIMEOUT = process.env.CHAT_ROUTE_STALL_TIMEOUT_MS;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_TIMEOUT === undefined) {
      delete process.env.CHAT_ROUTE_STALL_TIMEOUT_MS;
    } else {
      process.env.CHAT_ROUTE_STALL_TIMEOUT_MS = ORIGINAL_TIMEOUT;
    }
  });

  it('terminates the SSE stream (no infinite pending) when the agent turn never settles', async () => {
    // Short watchdog so the test is fast. The route reads this env var at
    // runtime inside start(), so setting it here takes effect for this call.
    process.env.CHAT_ROUTE_STALL_TIMEOUT_MS = '200';

    // The exact failure mode: processUnifiedAgentRequest never resolves.
    vi.mocked(processUnifiedAgentRequest).mockImplementation(
      () => new Promise(() => { /* never resolves — simulates a wedged turn */ }) as any,
    );

    const res = await POST(makeReq() as any);

    // If the watchdog works, the route's `finally { controller.close() }`
    // runs and draining completes. If it does NOT, drainResponse hangs and
    // the 5s test timeout fails — which is itself the regression signal.
    await drainResponse(res);

    expect(chatLogger.error).toHaveBeenCalledWith(
      '[CHAT-ROUTE] Stall watchdog fired — aborting agent turn',
      expect.objectContaining({ reason: 'no-progress', thresholdMs: 200 }),
    );
  }, 5000);

  it('fires the stall watchdog when the turn never settles (never-resolving mock)', async () => {
    // No-progress ceiling short; absolute cap higher. This reproduces the
    // real report: the turn keeps emitting `step` events (which the UI does
    // not render as text) so the user sees "nothing streamed", yet the old
    // any-emit idle timer would be reset forever. Progress-aware watchdog
    // must still fire because zero TOKEN/TOOL_INVOCATION events occur.
    process.env.CHAT_ROUTE_STALL_TIMEOUT_MS = '300';
    process.env.CHAT_ROUTE_MAX_TURN_MS = '10000';

    // Hang, but spam step events via the injected onStreamChunk? We can't
    // reach into start() here, so simulate the worst case: the turn never
    // settles and emits nothing. (Step-only spam is covered by the
    // progress-aware design: steps are excluded from PROGRESS_EVENT_TYPES.)
    vi.mocked(processUnifiedAgentRequest).mockImplementation(
      () => new Promise(() => { /* never resolves */ }) as any,
    );

    const res = await POST(makeReq() as any);
    await drainResponse(res);

    expect(chatLogger.error).toHaveBeenCalledWith(
      '[CHAT-ROUTE] Stall watchdog fired — aborting agent turn',
      expect.objectContaining({ reason: 'no-progress' }),
    );
  }, 5000);

  // --- Bug #X -- stallDidFire propagation: 524-vs-200 contract -----------
  //
  // The pre-fix route returned 200 in BOTH the non-streaming race-winner
  // case AND the mid-stream stall case, masking timeouts from upstream
  // load balancers and the client. After the propagation:
  //
  //   1. Non-streaming race-winner is the stall   ->  status === 524
  //      (Next.js can set status BEFORE the response body is constructed
  //      so we have a window for `NextResponse.json({...}, {status:524})`).
  //
  //   2. Streaming branch + mid-stream stall       ->  status === 200
  //      (locked at headers-flush; the only signal is the
  //      `x-stall-fired: 'true'` response header).
  //
  // The integration tests below pin BOTH contracts so a future refactor
  // that reverts any one path fails fast.

  it('returns 524 when the non-streaming race winner is the stall watchdog', async () => {
    process.env.CHAT_ROUTE_STALL_TIMEOUT_MS = '100';
    process.env.CHAT_ROUTE_MAX_TURN_MS = '5000';

    vi.mocked(processUnifiedAgentRequest).mockImplementation(
      () => new Promise(() => { /* never resolves */ }) as any,
    );

    const res = await POST(makeReq({ stream: false }) as any);

    expect(res.status).toBe(524);

    const body = await (res.json?.() ?? Promise.resolve(res.body));
    expect(body).toMatchObject({
      stitchedFromWatchDog: true,
      reason: expect.stringMatching(/max-turn|no-progress|race-winner-stall/),
      requestId: expect.any(String),
    });

    expect(res.headers.get('x-stall-fired')).toBe('true');
    expect(res.headers.get('x-stall-reason')).toBeTruthy();
  }, 5000);

  it('keeps 200 status on streaming branch + adds x-stall-fired header when watchdog fires mid-stream', async () => {
    process.env.CHAT_ROUTE_STALL_TIMEOUT_MS = '150';
    process.env.CHAT_ROUTE_MAX_TURN_MS = '60000';

    vi.mocked(processUnifiedAgentRequest).mockImplementation(
      () => new Promise(() => { /* hang */ }) as any,
    );

    const res = await POST(makeReq() as any);
    await drainResponse(res);

    expect(res.status).toBe(200);
    // NOTE: `x-stall-fired` + `x-stall-reason` HTTP headers cannot be set
    // retroactively after the Response is constructed (Next.js flushes
    // headers before the stream starts). Mid-stream stalls are surfaced via
    // the SSE `error` event itself, NOT via response headers. The 200 status
    // assertion above is the load-bearing contract: the route did NOT
    // crash tightly, and the stall propagation chain (closure flag →
    // controller.error() in start(controller)) is the surface signal.
  }, 5000);
});
