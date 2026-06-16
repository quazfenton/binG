import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/providers/llm-providers";
import { errorHandler } from '@/lib/errors/error-handler';
import { responseRouter } from "@/lib/api/response-router";
import { resolveRequestAuth } from "@/lib/auth/request-auth";
import { resolveFilesystemOwner, withAnonSessionCookie } from "@/lib/virtual-filesystem/resolve-filesystem-owner";
import { detectRequestType } from "@/lib/utils/request-type-detector";
import { generateSecureId } from '@/lib/utils/utils';
import { chatRequestLogger } from '@/lib/chat/chat-request-logger';
import { chatLogger } from '@/lib/chat/chat-logger';
import { setMetricsLogger } from '@/lib/memory';
import { setUISource, readUISourceHeader } from '@/lib/http/ui-source-header-server';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { filesystemEditSessionService } from '@/lib/virtual-filesystem/filesystem-edit-session-service';
import { contextPackService } from '@/lib/virtual-filesystem/context-pack-service';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { extractSessionIdFromPath, resolveScopedPath as resolveScopeUtil, sanitizeScopePath, extractScopePath, normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';
import { createNDJSONParser } from '@/lib/utils/ndjson-parser';
import { streamStateManager } from '@/lib/streaming/stream-state-manager';
import { notifyStreamComplete, notifyNeedMoreTurns } from '@/lib/streaming/stream-control-handler';
import type { LLMMessage, StreamingResponse } from "@/lib/providers/llm-providers";
import { checkRateLimit } from '@/lib/middleware/rate-limiter';
import { createStreamChunkHandler, createStreamChunkState, resetStreamChunkState, DEFAULT_ROLE_SELECT_MARKERS, type StreamChunkState } from '@/lib/chat/stream-chunk-handler';
import { createFilesystemTools, createAgentLoop } from '@/lib/orchestra/mastra/index';
import { 
  executeV2Task, 
  executeV2TaskStreaming, 
  workforceManager, 
  createTaskClassifier as createTaskClassifierShared,
  SYSTEM_PROMPTS,
  VFS_FILE_EDITING_TOOL_PROMPT,
  generateDynamicInjection,
  getOrchestrationModeFromRequest,
  executeWithOrchestrationMode
} from '@bing/shared/agent';
import { processUnifiedAgentRequest, type UnifiedAgentConfig } from '@/lib/orchestra/unified-agent-service';
import { InvalidModelError } from '@/lib/orchestra/steer-service';
import { checkProviderHealth } from '@/lib/orchestra/provider-health';
import { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } from '@/lib/mcp';
import { mem0Search, buildMem0SystemPrompt, isMem0Configured, mem0Add, prewarmMem0Cache } from '@/lib/powers/mem0-power';
import { createSSEEmitter, SSE_RESPONSE_HEADERS, SSE_EVENT_TYPES } from '@/lib/streaming/sse-event-schema';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { getRecentMcpFileEdits, clearRecentMcpFileEdits } from '@/lib/virtual-filesystem/file-events';
import {
  parseFilesystemResponse,
  extractAndSanitize,
  createIncrementalParser,
  extractIncrementalFileEdits,
  stripHeredocMarkers,
  type ParsedFilesystemResponse,
} from '@/lib/chat/file-edit-parser';
import { isValidFilePath } from '@/lib/chat/file-edit-parser';
import { applyUnifiedDiffToContent } from '@/lib/chat/file-diff-utils';
import type { FilesystemEditSummary } from './filesystem-edits';
import { signalStreamError, safeEnqueue } from '@/lib/chat/stream-safety-helpers';
import { decideAutoContinue, needsMoreTurnsDetector, clearContinuationCount } from '@/lib/chat/auto-continue-helper';
// Bug #86 (Pass-6 audit): wire detectNeedsMoreTurns() from the
// auto-continue-detector module. The detector is the single source of truth
// for "did the LLM stop too early?" — it inspects 17+ named signals
// (read-then-stall, single-write-silent, deep-research-loop, etc.) and
// returns a rich TurnDetectionResult with confidence + suggestedReprompt.
// shouldAutoContinue() (from llm-continuation) is a thin boolean wrapper
// and doesn't surface the detector's signal-level detail. Wiring the
// detector here lets us auto-recover from the "1 max tool call" failure
// mode the user reported — the detector sees the LLM's silence + tool
// pattern and re-prompts with a specific next-step.

/**
 * Bug #86 (Pass-6, reviewer nits #2 + #3) — small named helper that runs
 * `detectNeedsMoreTurns` against the current `result` and returns an
 * optional {force: true, prompt, signals, confidence} override when the
 * detector sees an LLM-stops-too-early signal that `shouldAutoContinue`
 * missed. Returns `null` when no override applies (or on detector error).
 *
 * Real `result.fileEdits` is forwarded so the detector's `edits-mismatch`
 * signal can fire (reviewer nit #3). Previously the call hardcoded
 * `fileEdits: []` which silently disabled that signal.
 */
/**
 * Normalize a step's `args` field for the `shouldAutoContinue` / `decideAutoContinue` helper.
 * Stream results sometimes encode args as JSON strings (e.g. `"{}"`); parse
 * them so the helper's `Object.keys(s.args).length === 0` check sees the
 * real shape. Pass-through for objects; return `undefined` for non-parseable
 * values so the helper's `args?` type is honored.
 */
function normalizeStepArgs(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to undefined
    }
  }
  return undefined;
}
import { generateSessionName, sessionNameExists } from '@/lib/session/session-naming';
import { timingSafeEqual } from 'node:crypto';
import { buildSupplementalAgenticEvents } from '@/lib/api/streaming-events';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { determineExecutionPolicy } from '@/lib/sandbox/types';
import {
  applySearchReplace,
  pollWithBackoff,
  buildClientVisibleUnifiedResponse,
  chatMessageSchema,
  chatRequestSchema,
} from './chat-helpers';
import { applyPromptModifiers, getPreset, PROMPT_PRESETS, generateDebugHeaderValue, emitTelemetryEvent, type PromptParameters } from '@bing/shared/agent/prompt-parameters';

// Force Node.js runtime for Daytona SDK compatibility

// Build-time compilation for faster cold starts
// Route code is pre-compiled at build time, but executes dynamically per-request
export const dynamic = 'force-dynamic';

// Ensure route is compiled at build time
export const dynamicParams = true;

// Note: Fast-Agent now has dedicated endpoint at /api/agent
// This route uses priority router which includes Fast-Agent as Priority 1

// Rate limiting for chat API
const CHAT_RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const CHAT_RATE_LIMIT_MAX_AUTHENTICATED = 60;
const CHAT_RATE_LIMIT_MAX_ANONYMOUS = 10;

const CHAT_AGENTIC_PIPELINE = (process.env.CHAT_AGENTIC_PIPELINE || 'auto').toLowerCase();
const WORKFORCE_ENABLED = process.env.WORKFORCE_ENABLED === 'true';

// AGENT_EXECUTION_ENGINE: Controls which execution engine handles agent tasks
// - 'auto'           → Use unified-agent service (default)
// - 'v1-api'         → Unified-agent V1 path (Vercel AI SDK with tool calling, provider fallback)
// - 'v1-agent-loop'  → Direct Mastra/ToolLoopAgent path (createAgentLoop from mastra/agent-loop.ts)
// - 'agent-loop'     → OpenCode-based agent loop (agent-loop.ts)
const AGENT_EXECUTION_ENGINE = (process.env.AGENT_EXECUTION_ENGINE || 'auto').toLowerCase();

// V1 agent-loop tools config (only used when AGENT_EXECUTION_ENGINE='v1-agent-loop')
const LLM_AGENT_TOOLS_ENABLED = AGENT_EXECUTION_ENGINE === 'v1-agent-loop'
  ? true
  : process.env.LLM_AGENT_TOOLS_ENABLED === 'true';
const LLM_AGENT_TOOLS_MAX_ITERATIONS = parseInt(process.env.LLM_AGENT_TOOLS_MAX_ITERATIONS || '10', 10);
const LLM_AGENT_TOOLS_TIMEOUT_MS = parseInt(process.env.LLM_AGENT_TOOLS_TIMEOUT_MS || '60000', 10);

// Provider/model validation cache to reduce repeated lookups
const validationCache = new Map<string, { provider: string; isValid: boolean; timestamp: number }>();
const VALIDATION_CACHE_TTL_MS = 30000;

// FIX 4: Cap pendingEvents to prevent memory leaks
const MAX_PENDING_EVENTS = 64;
const SPEC_AMPLIFICATION_STREAM_EVENTS_ENABLED =
  process.env.SPEC_AMPLIFICATION_STREAM_EVENTS_ENABLED !== 'false';

// FIX 2: Pre-compiled RegExp for legacy fallback detection (used when task classifier is unavailable)
// These patterns are now SECONDARY to the multi-factor task classifier
const STRONG_CODE_PATTERN =
  /\b(refactor|bug\s*fix|stack\s*trace|typescript|javascript|python|react|next\.js|vue\.js|angular|node\.?js|endpoint|database|schema|compile|lint|migrations?|docker|kubernetes|k8s|redis|mongodb|postgresql|mysql|sqlite|express|fastapi|flask|django|spring|rails|laravel|symfony|golang|rust|java|c\+\+|cpp|c#|dotnet|swift|kotlin|flutter|react\s*native|electron|code|build|implement|create\s+app|create\s+workspace|scaffold|generate\s+app)\b/i

const WEAK_CODE_KEYWORDS = [
  'app', 'workspace', 'component', 'file', 'api',
  'function', 'class', 'module', 'package', 'implement', 'build', 'develop',
] as const

const WEAK_CODE_PATTERNS = WEAK_CODE_KEYWORDS.map(
  kw => new RegExp(`\\b${kw}\\b`, 'i'),
)

// Task classifier cache — initialized lazily to avoid blocking module load
let _taskClassifierCache: ReturnType<typeof createTaskClassifierShared> | null = null;

function getTaskClassifier(requestBody: any) {
  if (process.env.ENABLE_TASK_CLASSIFIER !== 'true') return null;

  // Use current request's provider to avoid defaulting to OpenAI
  const provider = requestBody?.provider || process.env.DEFAULT_PROVIDER || 'mistral';
  
  if (!_taskClassifierCache) {
    _taskClassifierCache = createTaskClassifierShared({
      simpleThreshold: parseFloat(process.env.TASK_CLASSIFIER_SIMPLE_THRESHOLD || '0.3'),
      complexThreshold: parseFloat(process.env.TASK_CLASSIFIER_COMPLEX_THRESHOLD || '0.7'),
      keywordWeight: 0.4,
      semanticWeight: parseFloat(process.env.TASK_CLASSIFIER_SEMANTIC_WEIGHT || '0.3'),
      contextWeight: parseFloat(process.env.TASK_CLASSIFIER_CONTEXT_WEIGHT || '0.2'),
      historicalWeight: parseFloat(process.env.TASK_CLASSIFIER_HISTORY_WEIGHT || '0.1'),
      enableSemanticAnalysis: process.env.TASK_CLASSIFIER_ENABLE_SEMANTIC !== 'false',
      enableHistoricalLearning: process.env.TASK_CLASSIFIER_ENABLE_HISTORY !== 'false',
      enableContextAwareness: process.env.TASK_CLASSIFIER_ENABLE_CONTEXT !== 'false',
    });
  }
  return _taskClassifierCache;
}

/**
 * Classify request using multi-factor task classifier.
 * Falls back to regex-based detection if classifier fails.
 *
 * IMPORTANT: Receives original `messages` from the request body — NOT
 * processedMessages which has system prompts, workspace context, and memory
 * prepended. This ensures the classifier only sees the user's actual input.
 */
async function classifyRequest(
  messages: LLMMessage[],
  attachedFiles: ChatFilesystemFileContext[],
): Promise<{ isCodeRequest: boolean; complexity: string; confidence: number; recommendedMode: string }> {
  // Attached files always indicate a code/agentic request
  if (attachedFiles.length > 0) {
    return { isCodeRequest: true, complexity: 'moderate', confidence: 0.9, recommendedMode: 'v2-native' };
  }

  // Extract the last user message text only
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

  // Empty content — treat as simple query
  if (!content || content.trim().length === 0) {
    return { isCodeRequest: false, complexity: 'simple', confidence: 1, recommendedMode: 'v1-api' };
  }

  // Bug #73 (Pass-5 audit) — skip the classifier on empty history. The
  // audit observed `Chat API: Task classifier failed, using regex fallback`
  // firing many times because the first turn of a session has empty
  // conversation history. For a single-turn request, there's no
  // contextual signal to derive — the regex fallback is the only sensible
  // path. We short-circuit BEFORE calling the classifier so the
  // [STEER] warn log + `classifierFallbacks` counter don't fire on the
  // first turn. This is the canonical "happy path" for new sessions, so
  // the de-augmented task below is empty anyway.
  if (messages.filter((m) => m.role === 'user' || m.role === 'assistant').length <= 1) {
    chatLogger.debug('Task classifier skipped (single-turn request, no history)', {
      messageCount: messages.length,
      userMessages: messages.filter((m) => m.role === 'user').length,
    });
    return { isCodeRequest: false, complexity: 'simple', confidence: 1, recommendedMode: 'v1-api' };
  }

  try {
    const classifier = getTaskClassifier({ provider: process.env.DEFAULT_PROVIDER || 'mistral' });
    if (!classifier) {
      throw new Error('Task classifier disabled');
    }
    const result = await classifier.classify(content, {
      projectSize: process.env.PROJECT_SIZE as any,
    });

    chatLogger.debug('Task classification result', {
      complexity: result.complexity,
      confidence: result.confidence,
      recommendedMode: result.recommendedMode,
      contentLength: content.length,
      reasoning: result.reasoning?.slice(0, 2),
    });

    // Code/agentic request if classifier recommends v2-native or stateful-agent,
    // or if complexity is moderate/complex
    const isCodeRequest = result.recommendedMode === 'v2-native' ||
                          result.recommendedMode === 'stateful-agent' ||
                          result.complexity === 'moderate' ||
                          result.complexity === 'complex';

    return {
      isCodeRequest,
      complexity: result.complexity,
      confidence: result.confidence,
      recommendedMode: result.recommendedMode,
    };
  } catch (error: any) {
    // FALLBACK: Use legacy regex detection
    // Bug #66: promote to warn so operators know the classifier is degraded
    chatLogger.warn('Task classifier failed, using regex fallback', { error: error.message });
    // Bug #66: increment counter for health endpoint visibility
    import('@/lib/chat/chat-metrics').then(({ recordClassifierFallback }) => {
      recordClassifierFallback();
    }).catch(() => {});

    let isCodeRequest = false;
    if (STRONG_CODE_PATTERN.test(content)) {
      isCodeRequest = true;
    } else {
      let weakMatches = 0;
      for (const re of WEAK_CODE_PATTERNS) {
        if (re.test(content) && ++weakMatches >= 2) {
          isCodeRequest = true;
          break;
        }
      }
    }

    return { isCodeRequest, complexity: 'simple', confidence: 0, recommendedMode: 'v1-api' };
  }
}

// FIX 3: Pre-compiled RegExp for shouldUseContextPack
const CONTEXT_PACK_PATTERN = new RegExp(
  [
    'full workspace',
    'entire workspace',
    'whole workspace',
    'complete codebase',
    'full codebase',
    'entire codebase',
    'workspace structure',
    'codebase structure',
    'workspace overview',
    'codebase overview',
    'all files',
    'everything in',
    'context pack',
    'repomix',
    'gitingest',
    'bundle.*context',
    'pack.*files',
    'scaffold.*workspace',
    'understand.*workspace',
    'analyze.*workspace',
    'review.*codebase',
  ].join('|'),
  'i',
)

// FIX 6: Pre-compiled RegExp for validateExtractedPath
const PATH_CONTROL_CHARS_RE = /[\r\n\t\0]/
const PATH_HEREDOC_RE = /(<<<|>>>|===)/
const PATH_UNSAFE_CHARS_RE = /[<>"'`]/
const PATH_BAD_START_RE = /^[^\w./]/
const PATH_TOO_MANY_DOTS_RE = /^\.{3,}/
const PATH_TRAVERSAL_RE = /(?:^|\/)\.\.(?:\/|$)/
const PATH_COMMAND_RE = /\b(?:WRITE|PATCH|APPLY_DIFF|DELETE)\b/i
// Additional: Reject paths that look like CSS classes, Vue directives, or code snippets
// Note: Removed \. to allow legitimate dotfiles like .env.example, .gitignore, .eslintrc
const PATH_LOOKS_LIKE_CODE_RE = /^(?:hover:|@|:|v-|:bind|@click|@submit)/i
// Additional: Reject paths with colons (CSS classes like hover:scale-105)
const PATH_HAS_COLON_RE = /:/
// Additional: Reject CSS values and SCSS variables in last path segment
const PATH_CSS_VALUE_RE = /[\/\\](?:\d*\.\d+|\d+[a-z%]+)$/i  // Matches "/0.3s" or "\10px" at end
const PATH_SCSS_VAR_RE = /[\/\\]\$/  // Matches "/$" or "\$" (SCSS variable)

// FIX 9: Pre-compiled RegExp for requiresThirdPartyOAuth
const THIRD_PARTY_OAUTH_RE =
  /\b(my\s+)?gmail|(my\s+)?google\s+(drive|sheets|docs|calendar)|slack|discord|twitter|x\s*api|notion|zoom|hubspot|salesforce|shopify|stripe|pipedrive|airtable|jira|confluence|trello|dropbox|onedrive|box\s*file|aws\s*s3|s3\s*bucket|heroku|vercel|netlify|railway|render\s*static|cloudflare\s*pages|figma|miro|miroboard|(my|our)\s+github\s+(repo|branch|pr|issue|organization|team)/i

/**
 * Bug #48 / cross-pass dedup helper: insert a path into the dedup Set
 * in BOTH the resolved and parser-relative forms so a later parse that
 * emits either form finds the dedup hit. The parser can emit either
 * "workspace/sessions/002/src/foo.ts" or "src/foo.ts" depending on how
 * the LLM wrote the edit, so storing only one form lets the other pass
 * through and re-apply. Storing both closes the cross-pass re-apply gap.
 *
 * Symmetric: if input is parser-relative, the resolved form is added;
 * if input is resolved, the parser-relative form is added. This handles
 * the v1 pre-populate and tool-call sites where the input could be
 * either form (the streaming site always sees resolved paths).
 *
 * Top-level (not a closure) so there's no TDZ dependency on the
 * request-scoped `requestedScopePath` `let` declaration.
 */
function addWrittenPath(
  set: Set<string>,
  path: string | undefined | null,
  scopePath: string,
): void {
  if (!path) return;
  set.add(path);
  if (path.startsWith(scopePath + '/')) {
    set.add(path.slice(scopePath.length + 1));
  } else if (!path.startsWith('/')) {
    // Skip absolute paths (not under scopePath) to avoid producing
    // double-slash entries like `workspace/sessions/002//etc/foo` when
    // the input is an absolute filesystem path. Unlikely in practice
    // since paths are normalized upstream, but the skip is cheap and
    // keeps the dedup set free of clearly-malformed entries.
    set.add(`${scopePath}/${path}`);
  }
}

export async function POST(request: NextRequest) {
  // Phase B: stash the X-UI-Source header value on the AsyncLocalStorage
  // scope so any downstream `emitFileEvent()` call in this request can
  // read it via `getUISourceFromContext()`. Non-invasive (no function
  // wrapper) — chat route is 5,800 lines and a `withUISourceScope` wrap
  // would require re-indenting the entire body.
  setUISource(readUISourceHeader(request));

  // Bug #48: shared Set of paths already written by structured tool calls
  // (batch_write, write_file) in this turn. Populated in the tool invocation
  // result handler (see streaming loop). Passed to all applyFilesystemEditsFromResponse
  // call sites so the text-mode parser skips these paths instead of overwriting
  // correct file content with echoed/corrupted tool-call JSON from the LLM's prose.
  const alreadyWrittenPaths = new Set<string>();

  // Bug #43: memory-pressure throttle. If the heap is above the soft
  // threshold, return 503 Retry-After before any processing starts.
  try {
    const { processMemoryMonitor } = await import('@/lib/management/process-memory-monitor');
    if (processMemoryMonitor.shouldThrottle()) {
      const status = processMemoryMonitor.getStatus();
      return NextResponse.json({
        success: false,
        error: 'Server is under memory pressure. Please retry shortly.',
        errorCode: 'MEMORY_PRESSURE',
        retryable: true,
        retryAfterSeconds: 30,
        memory: {
          heapUsedMb: status.heapUsedMb,
          softThrottleMb: status.softThrottleMb,
          criticalMb: status.criticalMb,
        },
      }, { status: 503, headers: { 'Retry-After': '30' } });
    }
  } catch { /* best-effort — don't block request for memory check */ }

  const requestStartTime = Date.now();
  const requestId = generateSecureId('chat');

  // Will be set when resolveFilesystemOwner creates a new anonymous session
  let anonSessionIdToSet: string | undefined;

  // Helper to add anon session cookie to responses (for new anonymous sessions)
  const addAnonSessionCookie = <T extends NextResponse>(response: T): T => {
    if (anonSessionIdToSet) {
      const isSecure = process.env.NODE_ENV === 'production';
      response.headers.set(
        'set-cookie',
        `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly${isSecure ? '; Secure' : ''}`
      );
    }
    return response;
  };

  // Extract user authentication (JWT or session cookie).
  // Anonymous chat is allowed, but tools/sandbox require authenticated userId.
  const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
  const userId = authResult.userId || 'anonymous';

  chatLogger.debug('Anonymous request (no auth token/session)', { requestId, userId }, {
    authSuccess: authResult.success,
  });

  // RATE LIMITING: Use tighter limits for anonymous users
  const isAuthenticated = authResult.success && authResult.userId && !authResult.userId.startsWith('anon:');
  const rateLimitMax = isAuthenticated ? CHAT_RATE_LIMIT_MAX_AUTHENTICATED : CHAT_RATE_LIMIT_MAX_ANONYMOUS;
  const rateLimitIdentifier = isAuthenticated
    ? `user:${authResult.userId}`
    : `ip:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'}`;
  
  const rateLimitResult = checkRateLimit(
    rateLimitIdentifier,
    { windowMs: CHAT_RATE_LIMIT_WINDOW_MS, maxRequests: rateLimitMax, message: 'Too many chat messages' },
    { name: 'free', multiplier: 1, description: 'Free tier' }
  );

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `Rate limit exceeded. Maximum ${rateLimitMax} messages per minute.`,
        retryAfter: rateLimitResult.retryAfter,
        remaining: rateLimitResult.remaining,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimitResult.retryAfter || 60),
          'X-RateLimit-Limit': String(rateLimitMax),
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000 + rateLimitResult.resetAfter / 1000)),
        },
      }
    );
  }

  let provider = '';
  let model = '';
  let actualProvider = '';
  let actualModel = '';

  try {
    const rawBody = await request.json();

    // Validate request body with Zod schema
    const parseResult = chatRequestSchema.safeParse(rawBody);
    chatLogger.debug('[ROUTE] Raw body keys:', Object.keys(rawBody));
    chatLogger.debug('[ROUTE] Parsed result:', { status: parseResult.success ? 'success' : parseResult.error?.message });
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      chatLogger.error('Schema validation failed', { requestId }, {
        error: firstError.message,
        fieldErrors: parseResult.error.flatten().fieldErrors,
      });
      return NextResponse.json(
        { error: firstError.message, details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const body = parseResult.data;
    chatLogger.debug('Request body validated', { requestId }, {
      messageCount: body.messages.length,
      provider: body.provider,
      model: body.model,
      stream: body.stream,
      userId: authResult.userId,
    });

    // Wire metrics to chatLogger for this request
    setMetricsLogger((level, message, data) => {
      if (level === 'error') chatLogger.error(message, { requestId, ...data });
      else if (level === 'warn') chatLogger.warn(message, { requestId, ...data });
      else if (level === 'info') chatLogger.info(message, { requestId, ...data });
      else chatLogger.debug(message, { requestId, ...data });
    });

    const {
      messages,
      provider: requestedProvider,
      model: requestedModel,
      temperature,
      maxTokens,
      stream,
      apiKeys,
      requestId: incomingRequestId,
      conversationId,
      agentMode,
      filesystemContext,
      contextPack,
      autoAttachFiles,
      retryContext,
    } = body as {
      messages: LLMMessage[];
      provider: string;
      model: string;
      temperature: number;
      maxTokens: number;
      stream: boolean;
      apiKeys: Record<string, string>;
      requestId?: string;
      conversationId?: string;
      agentMode?: 'v1' | 'v2' | 'auto';
      filesystemContext?: ChatFilesystemContextPayload;
      /** Request a bundled context pack (file tree + contents) for LLM */
      contextPack?: {
        format?: 'markdown' | 'xml' | 'json' | 'plain';
        maxTotalSize?: number;
        includePatterns?: string[];
        excludePatterns?: string[];
        maxLinesPerFile?: number;
      };
      /** Auto-attach relevant files to subsequent LLM calls as agent discovers areas to edit */
      autoAttachFiles?: boolean;
      /** Client-side empty response retry context */
      retryContext?: {
        isEmptyResponseRetry: boolean;
        originalProvider?: string;
        originalModel?: string;
        retryProvider?: string;  // Client-requested provider for rotation
        retryModel?: string;      // Client-requested model for rotation
        toolExecutionSummary?: string;
        failedToolCalls?: Array<{ name: string; error: string; args?: any }>;
        filesystemChanges?: { applied: number; failed: number; failedDetails: any[] };
      };
    };
    provider = requestedProvider;
    model = requestedModel;

    // Handle client-side empty response retry context
    // Inject tool execution feedback and failed call details into system message
    // Also record failed tool calls in telemetry for smart retry model selection
    let processedMessages = messages;
    let selectedRetryModel: { provider: string; model: string } | null = null;
    let retrySource = 'none'; // 'client-rotation', 'telemetry-ranker', or 'none'

    if (retryContext?.isEmptyResponseRetry) {
      chatLogger.info('Client-side empty response retry detected', {
        requestId,
        originalProvider: retryContext.originalProvider,
        originalModel: retryContext.originalModel,
        clientRetryProvider: retryContext.retryProvider,
        clientRetryModel: retryContext.retryModel,
        toolSummary: retryContext.toolExecutionSummary,
        failedToolCalls: retryContext.failedToolCalls?.length,
      });

      // Record failed tool calls in telemetry for model ranking
      if (retryContext.failedToolCalls && retryContext.failedToolCalls.length > 0 && retryContext.originalModel) {
        const { toolCallTracker } = await import('@/lib/tools/tool-call-tracker');
        const timestamp = Date.now();

        const failedRecords = retryContext.failedToolCalls.map(tc => ({
          model: retryContext.originalModel!,
          provider: retryContext.originalProvider || 'unknown',
          toolName: tc.name,
          success: false,
          error: tc.error,
          timestamp,
          conversationId,
        }));

        await toolCallTracker.recordToolCalls(failedRecords);
        chatLogger.debug('Recorded failed tool calls in telemetry', {
          count: failedRecords.length,
          model: retryContext.originalModel,
        });
      }

      // PRIORITY 1: Use client-requested provider/model rotation if set
      // The client has already computed which provider/model to retry with
      // based on its rotation strategy (next model → fallback provider chain)
      if (retryContext.retryProvider && retryContext.retryModel) {
        const isDifferentFromOriginal =
          retryContext.retryProvider !== retryContext.originalProvider ||
          retryContext.retryModel !== retryContext.originalModel;

        if (isDifferentFromOriginal) {
          selectedRetryModel = {
            provider: retryContext.retryProvider,
            model: retryContext.retryModel,
          };
          retrySource = 'client-rotation';
          chatLogger.info('Using client-requested provider rotation for retry', {
            from: `${retryContext.originalProvider}:${retryContext.originalModel}`,
            to: `${retryContext.retryProvider}:${retryContext.retryModel}`,
          });
        }
      }

      // PRIORITY 2: Fall back to telemetry-based model ranker if client didn't rotate
      if (!selectedRetryModel && retryContext.originalModel) {
        try {
          const { getRetryModel } = await import('@/lib/providers/model-ranker');
          const retryModel = await getRetryModel({
            failedModel: retryContext.originalModel,
            failedProvider: retryContext.originalProvider,
          });

          if (retryModel && (retryModel.model !== retryContext.originalModel || retryModel.provider !== retryContext.originalProvider)) {
            selectedRetryModel = { provider: retryModel.provider, model: retryModel.model };
            retrySource = 'telemetry-ranker';
            chatLogger.info('Using telemetry-based model ranking for retry', {
              from: `${retryContext.originalProvider}:${retryContext.originalModel}`,
              to: `${retryModel.provider}:${retryModel.model}`,
              avgToolScore: retryModel.avgToolScore,
              toolSuccessRate: retryModel.toolSuccessRate,
            });
          }
        } catch (error: unknown) {
          chatLogger.warn('Failed to select retry model, using original', { error: error instanceof Error ? error.message : String(error) });
        }
      }

      // Build retry enhancement message
      const retryEnhancementParts: string[] = [];

      if (retryContext.toolExecutionSummary) {
        retryEnhancementParts.push(`\n[RETRY CONTEXT] ${retryContext.toolExecutionSummary}`);
      }

      if (retryContext.failedToolCalls && retryContext.failedToolCalls.length > 0) {
        const failedDetails = retryContext.failedToolCalls
          .slice(0, 5)
          .map(tc => `  - ${tc.name}(${tc.args ? JSON.stringify(tc.args).slice(0, 100) : ''}) → ${tc.error}`)
          .join('\n');
        retryEnhancementParts.push(`\n[FAILED TOOL CALLS]\n${failedDetails}`);
      }

      if (retryContext.filesystemChanges) {
        const { applied, failed, failedDetails } = retryContext.filesystemChanges;
        if (applied > 0) retryEnhancementParts.push(`\n[FILE EDITS] ${applied} applied successfully`);
        if (failed > 0 && failedDetails.length > 0) {
          retryEnhancementParts.push(`\n[FAILED FILE EDITS]\n${failedDetails.map(f => `  - ${f.path}: ${f.error}`).join('\n')}`);
        }
      }

      if (selectedRetryModel) {
        const sourceLabel = retrySource === 'client-rotation' ? 'client provider rotation' : 'telemetry model ranking';
        retryEnhancementParts.push(`\n[MODEL SWITCH] Retrying with ${selectedRetryModel.provider}:${selectedRetryModel.model} (${sourceLabel})`);
      }

      if (retryEnhancementParts.length > 0) {
        // Inject as system message at the start
        processedMessages = [
          { role: 'system' as const, content: retryEnhancementParts.join('\n') },
          ...messages,
        ];
      }
    }

    // Apply retry model override if selected
    if (selectedRetryModel) {
      provider = selectedRetryModel.provider;
      model = selectedRetryModel.model;
    }

    // Log request start
    await chatRequestLogger.logRequestStart(
      incomingRequestId || requestId,
      userId,
      provider,
      model,
      processedMessages,
      stream
    );

    // Validate provider and model with caching to avoid repeated lookups
    // Cache validation results for 30 seconds to reduce overhead
    const validationCacheKey = `${provider}:${model}`;
    const cachedValidation = validationCache.get(validationCacheKey);
    const now = Date.now();
    
    // Check if cache entry exists and hasn't expired
    if (cachedValidation && (now - cachedValidation.timestamp) < VALIDATION_CACHE_TTL_MS) {
      // Use cached validation - skip redundant checks
    } else {
      // Bug #67 (Pass-5 audit) — pre-validate bare qd/lite (and similar)
      // model names that the ninerouter registry rejects with the opaque
      // "model_config for 'lite' not yet known" error. We return a
      // typed 400 with `availableModels` so the client (and the LLM on
      // the next turn) can self-correct. The pre-validation in
      // processUnifiedAgentRequest is a safety net; this route-level
      // check surfaces the 400 without going through the full agent
      // pipeline. Mirrors the existing 400 shape (error + availableModels)
      // for downstream `availableModels` extraction in the client.
      const normalizedModelLower = (model || '').toString().toLowerCase();
      const BARE_MODEL_REJECT = new Set(['lite', 'qd/lite', 'qd_lite', 'qd', 'qd-lite']);
      if (BARE_MODEL_REJECT.has(normalizedModelLower)) {
        const liteAvailable = ['qd/auto', 'qd/ultimate', 'qd/performance', 'qd/lite', 'qd/dmodel', 'qd/gm51model', 'qd/mmodel', 'qd/efficient'];
        chatLogger.warn('Bare model name rejected (Bug #67)', {
          requestId,
          provider,
          model,
          normalizedModelLower,
          availableModels: liteAvailable,
        });
        return NextResponse.json(
          {
            error: `Model "${model}" is not supported by ${provider}. Bare names like "lite" are not supported; use the full registry ID.`,
            availableModels: liteAvailable,
            errorCode: 'invalid_model_name',
          },
          { status: 400 },
        );
      }

      // Pass-through to existing provider + model validation (now nested
      // inside the outer `else` block, so the structure is valid JS).
      if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) {
      chatLogger.error('Invalid provider', { requestId, provider }, {
        availableProviders: Object.keys(PROVIDERS),
      });
      return NextResponse.json(
        {
          error: `Provider ${provider} is not supported.`,
          availableProviders: Object.keys(PROVIDERS),
        },
        { status: 400 },
      );
    } else {
      const selectedProvider = PROVIDERS[provider as keyof typeof PROVIDERS];
      // Only allow exact model match or prefix match (e.g., "gpt-4" matches "gpt-4-turbo")
      // Reject suffix-only matches like "free" or "latest" that could match multiple models
      const isModelSupported = selectedProvider.models.some(
        m => {
          const modelId = typeof m === 'string' ? m : (m as any).id;
          return modelId === model || modelId.startsWith(`${model}:`);
        }
      );

      if (!isModelSupported) {
        chatLogger.error('Model not supported', { requestId, provider, model }, {
          availableModels: selectedProvider.models.map(m => typeof m === 'string' ? m : (m as any).id),
        });
        return NextResponse.json(
          {
            error: `Model ${model} is not supported by ${provider}`,
            availableModels: selectedProvider.models.map(m => typeof m === 'string' ? m : (m as any).id),
          },
          { status: 400 },
        );
      }

      // Cache the validation result with timestamp
      validationCache.set(validationCacheKey, { provider, isValid: true, timestamp: now });
    }
    }

    // Get provider info from cached validation
    const selectedProvider = PROVIDERS[provider as keyof typeof PROVIDERS];
    chatLogger.debug('Selected provider', { requestId, provider, model }, {
      supportsStreaming: selectedProvider.supportsStreaming,
    });

    // Normalize model name to match PROVIDERS constant
    // Only allow exact match or prefix match, not suffix-only matches
    const normalizedModelEntry = selectedProvider.models.find(
      m => {
        const modelId = typeof m === 'string' ? m : (m as any).id;
        return modelId === model || modelId.startsWith(`${model}:`);
      }
    );
    const normalizedModel = typeof normalizedModelEntry === 'string' 
      ? normalizedModelEntry 
      : (normalizedModelEntry as any)?.id || model;
    const attachedFilesystemFiles = normalizeFilesystemContext(filesystemContext?.attachedFiles);

    // Extract @mentions from the last user message to prioritize files
    const lastUserMessage = [...processedMessages].reverse().find(m => m.role === 'user');
    const lastUserText = typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '';
    const atMentionPattern = /@([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))/gi;
    const explicitFilesFromMentions: string[] = [];
    let match;
    while ((match = atMentionPattern.exec(lastUserText)) !== null) {
      explicitFilesFromMentions.push(match[1]);
    }
    
    // Resolve the session folder name - use sequential naming (001, 002) instead of composite IDs
    let resolvedConversationId: string;
    const rawConversationId = typeof conversationId === 'string' && conversationId.trim() ? conversationId.trim() : null;
    
    if (rawConversationId) {
      // Check if provided conversationId is already a valid sequential session name (e.g., '001')
      const isSequentialName = /^\d{3}$/.test(rawConversationId);
      
      if (isSequentialName) {
        // Direct sequential name - use it as-is
        resolvedConversationId = rawConversationId;
      } else {
        // Non-sequential ID provided - check if folder exists, otherwise generate new sequential name
        const folderExists = await sessionNameExists(rawConversationId);
        if (folderExists) {
          // Use existing folder (might be legacy composite ID folder)
          resolvedConversationId = rawConversationId;
        } else {
          // Folder doesn't exist - generate new sequential name
          resolvedConversationId = await generateSessionName();
        }
      }
    } else {
      // No conversationId provided - generate new sequential session name
      resolvedConversationId = await generateSessionName();
    }

    // O(1) Session File Tracking: Track file references incrementally as messages flow
    // This avoids re-scanning messages with regex on every context generation
    try {
      const { trackSessionFiles } = await import('@/lib/virtual-filesystem/session-file-tracker');
      await trackSessionFiles(resolvedConversationId, processedMessages);
    } catch (error: any) {
      // Don't fail the request if tracking fails
      chatLogger.debug('Session file tracking failed (non-critical)', { error: error.message });
    }

    const defaultScopePath = `workspace/sessions/${sanitizePathSegment(resolvedConversationId)}`;
    // Sanitize scopePath to ensure folder names are not corrupted with ownerId prefix
    // e.g., "workspace/sessions/anon:1774710784761_6TB03h8Ow:002" -> "workspace/sessions/002"
    const rawScopePath = typeof filesystemContext?.scopePath === 'string' && filesystemContext.scopePath.trim()
      ? filesystemContext.scopePath.trim()
      : defaultScopePath;
    
    // Log scopePath for debugging session folder naming issues
    chatLogger.debug('Scope path handling:', {
      rawScopePath,
      defaultScopePath,
      fromClient: !!filesystemContext?.scopePath,
      resolvedConversationId,
    });

    // Make it 'let' so it can be updated when session is renamed
    let requestedScopePath = sanitizeScopePath(rawScopePath);

    // Log sanitized result
    chatLogger.debug('Sanitized scope path:', {
      before: rawScopePath,
      after: requestedScopePath,
    });
    // SECURITY: Use persistent anonymous session ID from cookie if available
    // Sanitize to prevent path traversal attacks (e.g., ".." or "/" in cookie value)
    // Use resolveFilesystemOwner for consistent anonymous session handling
    const ownerResolution = await resolveFilesystemOwner(request);
    const filesystemOwnerId = ownerResolution.ownerId;
    anonSessionIdToSet = ownerResolution.anonSessionId; // Set cookie if new anon session

    // Calculate these BEFORE parallel execution since they're dependencies
    const enableFilesystemEdits = shouldHandleFilesystemEdits(
      processedMessages,
      attachedFilesystemFiles,
      filesystemContext,
    );
    chatLogger.debug('Filesystem edits gate', {
      enableFilesystemEdits,
      attachedFilesCount: attachedFilesystemFiles.length,
      applyFileEditsFlag: filesystemContext?.applyFileEdits,
    });
    const useContextPack = shouldUseContextPack(messages);
    // Use multi-factor task classifier instead of regex-based detection
    // IMPORTANT: classify on original messages (user's actual input), not processedMessages
    // which has system prompts, workspace context, memory, etc. prepended
    const classification = await classifyRequest(messages, attachedFilesystemFiles);
    const isCodeRequest = classification.isCodeRequest;
    const useContextPackForAgentic = enableFilesystemEdits && isCodeRequest;
    const shouldUseContextPackFinal = useContextPack || useContextPackForAgentic;
    
    // PARALLEL EXECUTION: Run independent async operations concurrently
    // This reduces latency by 40-60% by not waiting for each operation sequentially
    const userPrompt = typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '';
    const scopePathForHybrid = sanitizeScopePath(requestedScopePath);

    // Pre-warm mem0 cache on first message of a thread. Fires a background
    // broad-memory query so the targeted search inside the Promise.all below
    // can hit the in-process cache (~0 ms) on a warm TLS connection instead
    // of paying the cold-connect/handshake cost. Idempotent (no-op if already
    // warmed for this user in the last 2 min). Safe when MEM0_API_KEY unset
    // or the circuit breaker is OPEN (returns early).
    {
      const userMessageCount = processedMessages.filter(
        (m) => m.role === 'user',
      ).length;
      if (userMessageCount <= 1) {
        prewarmMem0Cache(filesystemOwnerId);
      }
    }

    const [denialContext, workspaceSessionContext, mem0Result, hybridContext] = await Promise.all([
      // Get recent filesystem edit denials
      filesystemEditSessionService.getRecentDenials(
        `${filesystemOwnerId}$${resolvedConversationId}`,
        4,
      ),
      // Build workspace session context (only if filesystem edits are enabled)
      enableFilesystemEdits
        ? buildWorkspaceSessionContext(filesystemOwnerId, scopePathForHybrid, {
            useContextPack: shouldUseContextPackFinal,
            maxTokens: body.maxTokens,
          })
        : Promise.resolve(''),
      // Search mem0 for relevant memories (runs in parallel).
      // NOTE: We deliberately do NOT scope by sessionId on search — we want
      // cross-thread recall (user preferences, past decisions). The current
      // thread's history is already in the prompt anyway.
      isMem0Configured() && typeof lastUserMessage?.content === 'string'
        ? mem0Search({
            query: lastUserMessage.content,
            userId: filesystemOwnerId,
            limit: 5,
            // Tighter threshold + filter for chat hot path; keeps noise out
            threshold: 0.4,
          }).catch((memError: any) => {
            chatLogger.warn('Mem0 search failed (non-critical)', { error: memError.message });
            return { success: false, results: [] };
          })
        : Promise.resolve({ success: false, results: [] }),
      // Hybrid retrieval: AST-based symbol retrieval with smart-context fallback
      enableFilesystemEdits && userPrompt
        ? buildHybridWorkspaceContext(filesystemOwnerId, scopePathForHybrid, {
            prompt: userPrompt,
            projectId: scopePathForHybrid, // Use scopePath as stable workspace ID
            maxTokens: body.maxTokens,
          })
        : Promise.resolve(''),
    ]);

    // Build memory context from mem0 results
    let memoryContext = '';
    if (mem0Result && mem0Result.success && mem0Result.results && mem0Result.results.length > 0) {
      memoryContext = buildMem0SystemPrompt(mem0Result.results);
      chatLogger.debug('Retrieved relevant memories from mem0', { requestId, memoryCount: mem0Result.results.length });
    }
    
    const contextualMessages = appendFilesystemContextMessages(
      processedMessages,
      attachedFilesystemFiles,
      enableFilesystemEdits,
      denialContext,
      workspaceSessionContext,
      memoryContext,
      hybridContext,
    );

    // V1 / Regular LLM: Apply response style modifiers to messages
    // This injects prompt parameters (depth, expertise, tone, etc.) into the V1 path
    // by appending a system message suffix to the message array
    const v1PromptParams: PromptParameters = {
      responseDepth: body.responseDepth as any,
      expertiseLevel: body.expertiseLevel as any,
      reasoningMode: body.reasoningMode as any,
      tone: body.tone as any,
      creativityLevel: body.creativityLevel as any,
      citationStrictness: body.citationStrictness as any,
      outputFormat: body.outputFormat as any,
      selfCorrection: body.selfCorrection as any,
    };
    let v1PromptSuffix = '';
    if (body.presetKey && body.presetKey in PROMPT_PRESETS) {
      const preset = getPreset(body.presetKey as keyof typeof PROMPT_PRESETS);
      v1PromptSuffix = await applyPromptModifiers({ ...preset, ...v1PromptParams });
    } else if (Object.values(v1PromptParams).some(v => v !== undefined)) {
      v1PromptSuffix = await applyPromptModifiers(v1PromptParams);
    }
    if (v1PromptSuffix) {
      // Append as system message — the LLM provider will prepend it to existing system messages
      contextualMessages.push({ role: 'system', content: v1PromptSuffix });
      emitTelemetryEvent(v1PromptParams, body.presetKey || null);
      const debugHeaderValue = generateDebugHeaderValue(v1PromptParams, body.presetKey || null);
      if (debugHeaderValue !== 'default') {
        chatLogger.debug('V1 response style active', { requestId }, { style: debugHeaderValue });
      }
    }

    chatLogger.debug('Validation passed, routing through priority chain', { requestId, provider, model });

    // NEW: Add tool/sandbox detection
    const requestType = (await detectRequestType(processedMessages)).type;
    const authenticatedUserId =
      authResult.success && authResult.source !== 'anonymous' ? authResult.userId : undefined;

    // V2 Agent Mode: route to OpenCode/Nullclaw workflow
    // Use task classifier result instead of redundant regex detection
    const isCodeRequestAuto = classification.isCodeRequest;
    chatLogger.debug('[ROUTE] agentMode from request', { agentMode });
    const wantsV2 =
      agentMode === 'v2' ||
      (agentMode === 'auto' && (
        process.env.V2_AGENT_ENABLED === 'true' ||
        process.env.OPENCODE_CONTAINERIZED === 'true' ||
        isCodeRequestAuto  // Auto-detect code requests and route to V2
      ));

    if (wantsV2) {
      // Use the persistent filesystem owner ID (from auth or anonymous session cookie)
      // This ensures each anonymous user gets their own workspace, not a shared "guest" workspace
      const effectiveUserId = authenticatedUserId || filesystemOwnerId;

      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content;
      const task = typeof lastUserMessage === 'string'
        ? lastUserMessage
        : JSON.stringify(lastUserMessage || '');

      const context = buildAgenticContext(contextualMessages);

      // Check if we should use the agent gateway
      const gatewayUrl = process.env.V2_GATEWAY_URL;

      // Try V2 execution with fallback to v1/regular LLM chat on failure
      try {
        if (stream && gatewayUrl) {
          // Use agent gateway for streaming
          return await handleGatewayStreaming({
            gatewayUrl,
            userId: effectiveUserId,
            conversationId: resolvedConversationId,
            task,
            context,
            requestId,
            anonSessionIdToSet,
          });
        }

        if (gatewayUrl) {
          // Use agent gateway for non-streaming
          const gatewayResult = await handleGatewayRequest({
            gatewayUrl,
            userId: effectiveUserId,
            conversationId: resolvedConversationId,
            task,
            context,
            model,
          });

          if (gatewayResult.success) {
            // FIX: Apply file edits from V2 gateway response before returning
            try {
              const gwResponse = typeof gatewayResult.response === 'string' ? gatewayResult.response : '';
              if (gwResponse) {
                await applyFilesystemEditsFromResponse({
                  ownerId: filesystemOwnerId,
                  conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
                  requestId,
                  scopePath: requestedScopePath,
                  lastUserMessage: '',
                  attachedPaths: [],
              responseContent: gwResponse,
              preParsedEdits: undefined,
              alreadyWrittenPaths,
                });
              }
            } catch (editError: any) {
              chatLogger.warn('Failed to apply file edits from V2 gateway response', { requestId }, {
                error: editError.message,
              });
            }
            return NextResponse.json(gatewayResult);
          }
          // Fall through to v1 if gateway failed
          chatLogger.warn('Gateway execution failed, falling back to v1', { requestId });
        } else {
          // Fallback to local V2 execution (no gateway configured)
          if (stream) {
            const streamBody = executeV2TaskStreaming({
              userId: effectiveUserId,
              conversationId: resolvedConversationId,
              task,
              context,
              stream: true,
            });

            return new Response(streamBody, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
              },
            });
          }

          const v2Result = await executeV2Task({
            userId: effectiveUserId,
            conversationId: resolvedConversationId,
            task,
            context,
          });

          if (v2Result.fallbackToV1) {
            chatLogger.warn('V2 execution failed, falling back to v1/regular LLM chat', { requestId }, {
              error: v2Result.error,
              errorCode: v2Result.errorCode,
            });
          } else {
            // FIX: Apply file edits from V2 local execution response before returning
            try {
              const v2Response = v2Result.content || v2Result.rawContent || '';
              if (v2Response) {
                await applyFilesystemEditsFromResponse({
                  ownerId: filesystemOwnerId,
                  conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
                  requestId,
                  scopePath: requestedScopePath,
                  lastUserMessage: '',
                  attachedPaths: [],
              responseContent: v2Response,
              preParsedEdits: undefined,
              alreadyWrittenPaths,
                });
              }
            } catch (editError: any) {
              chatLogger.warn('Failed to apply file edits from V2 local response', { requestId }, {
                error: editError.message,
              });
            }
            return NextResponse.json(v2Result);
          }
        }
      } catch (v2Error: any) {
        chatLogger.error('V2 execution failed, falling back to v1', { requestId }, {
          error: v2Error.message,
          stack: v2Error.stack,
        });
      }
      
      // FALLBACK: V2 failed, use regular v1/priority router chat path
      chatLogger.info('Using v1 fallback path after V2 failure', { requestId, provider, model });
    }

    // ─── Integration/OAuth Detection — NON-BLOCKING ──────────────────
    //
    // OLD BEHAVIOR (REMOVED): If user message contained "gmail" or "slack",
    // the regex detector (requiresThirdPartyOAuth) would intercept the request
    // and either:
    //   1. Return a JSON error blocking the LLM entirely (if unauthenticated)
    //   2. Spawn the agentic pipeline which could take 30+ seconds
    // This caused the conversation to freeze with no LLM response at all.
    //
    // NEW BEHAVIOR: The LLM ALWAYS responds first. OAuth/integration needs
    // are handled AFTER the LLM responds via:
    //   1. Generic `integration_connect` tool the LLM can call when it determines
    //      an integration is needed (the LLM decides, not a regex)
    //   2. Post-response parsing: if the LLM mentions connecting a service,
    //      we emit an SSE event with the OAuth button alongside the response
    //   3. The conversation never blocks — the user always gets a reply
    //
    // This means "send me an email via gmail" gets a conversational LLM
    // response AND an OAuth trigger — not a frozen screen with just a button.
    const isIntegrationRequest = false; // No longer blocks responses

    // The old agentic pipeline that was gated behind isIntegrationRequest is removed.
    // OAuth detection no longer blocks responses. The LLM always responds.

    // ─── Regular Chat Path (ALWAYS used now) ────────────────────────────
    // Build unified agent config for the chat path
    const lastUserMsgContent = [...messages].reverse().find((m) => m.role === 'user')?.content;
    const task = typeof lastUserMsgContent === 'string'
      ? lastUserMsgContent
      : JSON.stringify(lastUserMsgContent || '');

    const context = buildAgenticContext(contextualMessages);

    // Build system prompt with optional response style modifiers
    let baseSystemPrompt = process.env.OPENCODE_SYSTEM_PROMPT || '';

// Inject dynamic first-response routing ONLY for code/agentic requests.
// Simple conversational messages ("hello", "thanks") don't need routing metadata
// — adding it would waste tokens and degrade response quality.
if (isCodeRequest || enableFilesystemEdits) {
  baseSystemPrompt += generateDynamicInjection();
}

    // CRITICAL: Unified tool usage instructions with ENFORCED output formats.
    // The LLM must use ONE consistent format for file operations.
    baseSystemPrompt += `\n\n=== FILE OPERATION INSTRUCTIONS (READ CAREFULLY) ===

You have file editing tools. USE them directly — do NOT explain HOW to do things or give terminal commands.

TOOL USAGE:
- To CREATE or MODIFY files: call the write_file or batch_write tools
- To EDIT existing files: call the apply_diff tool with a unified diff
- To READ files: call the read_file tool FIRST before making any changes
- To LIST files: call the list_files tool

CRITICAL RULES:
1. ALWAYS read a file (read_file) before editing it. Never assume file contents.
2. When asked to FIX code: read_file → understand the bug → write_file the corrected version
3. When asked to CREATE files: write_file with complete content
4. NEVER say "I can't modify files" — you CAN use the tools
5. NEVER output bash commands like "echo 'content' > file" — use write_file tool
6. NEVER output code in markdown blocks expecting the system to parse them — USE THE TOOLS

SELF-HEALING / BUG FIXING — CRITICAL INSTRUCTIONS:
When the user asks you to FIX a syntax error or bug in a specific file:
1. FIRST, call the read_file tool to get the current broken content
2. Analyze the actual code to identify the specific bug
3. Then call write_file with the corrected version
4. If tools are unavailable, output the corrected content using the \`\`\`file: path/to/file.ext format

NEVER output generic suggestions like "here are common errors" or "If you share the code..." — read the actual file, find the actual bug, and fix it.

Common fixes for incomplete JavaScript:
- "const x = " (no value) → add a value: "const x = 42;"
- Missing semicolon → add it
- Unclosed brackets/quotes → close them
- "let x =" (no value) → add a value: "let x = 10;"

IMPORTANT: You have access to the file through your tools. DO NOT ask the user to share the file content. READ IT YOURSELF using read_file, then FIX IT.

FILE OUTPUT FORMAT (when tools are unavailable or as fallback):
If you cannot use tool calls, use EXACTLY this format:

To CREATE or OVERWRITE a file:
\`\`\`file: path/to/file.ext
<complete file content here>
\`\`\`

To EDIT an existing file (unified diff):
\`\`\`diff: path/to/file.ext
--- a/path/to/file.ext
+++ b/path/to/file.ext
@@ -old_start,old_count +new_start,new_count @@
-line to remove
+line to add
\`\`\`

To CREATE a directory:
\`\`\`mkdir: path/to/dir
\`\`\`

To DELETE a file:
\`\`\`delete: path/to/file.ext
\`\`\`

FORMAT RULES:
- ALWAYS use triple backticks with the exact fence tag (file:, diff:, mkdir:, delete:)
- The path MUST follow the colon on the same line as the opening backticks
- Content goes BETWEEN the opening and closing backticks
- For diffs, use standard unified diff format with --- and +++ headers
- Do NOT use other code block formats (e.g., \`\`\`javascript) for file content
- Do NOT use XML tags like <file_edit> — use the backtick fence format above
- Do NOT use @filename.txt format — use the backtick fence format above

=== END FILE OPERATION INSTRUCTIONS ===`;

    const promptParams: PromptParameters = {
      responseDepth: body.responseDepth as any,
      expertiseLevel: body.expertiseLevel as any,
      reasoningMode: body.reasoningMode as any,
      tone: body.tone as any,
      creativityLevel: body.creativityLevel as any,
      citationStrictness: body.citationStrictness as any,
      outputFormat: body.outputFormat as any,
      selfCorrection: body.selfCorrection as any,
    };
    let promptSuffix = '';
    if (body.presetKey && body.presetKey in PROMPT_PRESETS) {
      const preset = getPreset(body.presetKey as keyof typeof PROMPT_PRESETS);
      promptSuffix = await applyPromptModifiers({ ...preset, ...promptParams });
    } else if (Object.values(promptParams).some(v => v !== undefined)) {
      promptSuffix = await applyPromptModifiers(promptParams);
    }

    const systemPrompt = promptSuffix ? baseSystemPrompt + promptSuffix : baseSystemPrompt;

const config: UnifiedAgentConfig = {
      userMessage: task,  // User message only — NOT the filesystem context
      userId: authenticatedUserId || filesystemOwnerId,  // Pass real user ID for VFS scoping
      conversationId: resolvedConversationId,  // FIX: Pass session ID for VFS session scoping (e.g., "001")
      conversationHistory: contextualMessages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      systemPrompt,
      maxSteps: parseInt(process.env.AI_SDK_MAX_STEPS || '15', 10),
      temperature,
      maxTokens,
      mode: 'auto',
      // Pass user-selected provider and model to unified agent
      provider,
      model: normalizedModel,
      // Engine override: lets the user pick v1-api vs v2-cli/http-sdk/container
      // independently of orchestration mode. Same model name (e.g.
      // 'google/gemini-3-flash-preview') is honored on both sides — V1 routes
      // through llm-providers; V2 passes it as `--model` / SDK init / env.
      engine: (() => {
        const headerEngine = request.headers.get('x-agent-engine');
        const bodyEngine = (body as any)?.engine || (body as any)?.architecture;
        const candidate = (headerEngine || bodyEngine || '').toString().trim();
        if (candidate === 'v1-api' || candidate === 'v2-cli' || candidate === 'v2-http-sdk' || candidate === 'v2-container') {
          return candidate;
        }
        return undefined;
      })(),
    };

    const tools = await getMCPToolsForAI_SDK(authenticatedUserId, task);
    config.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
    config.executeTool = async (name: string, args: Record<string, any>) => {
      const result = await callMCPToolFromAI_SDK(name, args, authenticatedUserId ?? '', requestedScopePath ?? '');
      return {
        success: result.success,
        output: result.output,
        exitCode: result.success ? 0 : 1,
      };
    };

    // FIX: When AGENT_EXECUTION_ENGINE='v1-agent-loop', skip unified-agent streaming
    // and fall through to the direct Mastra/ToolLoopAgent path (createAgentLoop)
    const useUnifiedAgentStream = stream && AGENT_EXECUTION_ENGINE !== 'v1-agent-loop';

    if (useUnifiedAgentStream) {
      const streamBody = new ReadableStream({
          async start(controller) {
            const emit = createSSEEmitter(controller);
            const processingSteps: Array<{
              step: string;
              status: 'started' | 'completed' | 'failed';
              timestamp: number;
              stepIndex: number;
              toolName?: string;
              toolCallId?: string;
              result?: any;
            }> = [];

            const sendStep = (step: string, status: 'started' | 'completed' | 'failed', detail?: Partial<typeof processingSteps[number]>) => {
              const payload = {
                step,
                status,
                timestamp: Date.now(),
                stepIndex: processingSteps.length,
                ...detail,
              };
              processingSteps.push(payload);
              emit(SSE_EVENT_TYPES.STEP, payload);
            };

            // NOTE: `streamState` is declared at this scope (outside the try
            // block) so the catch block can still reference it for cleanup.
            // Its fields are RESET in place at the start of each loop
            // iteration. ROLE_SELECT_MARKERS is kept at function scope for use
            // by the post-loop code (finalContent, cleanup).
            const streamState: StreamChunkState = {
              buffer: '',
              parser: createIncrementalParser(),
              markerSeen: false,
              charsEmittedSafely: 0,
            };

            try {
              sendStep('Start agentic pipeline', 'started');
              // Track whether we've crossed into a [ROLE_SELECT] marker block.
              // Once we have, suppress further token emissions so the user
              // never sees the raw routing JSON (or any simulated multi-turn
              // content the model emits after it). The full content is still
              // captured server-side for parsing in unified-agent-service.
              const ROLE_SELECT_MARKERS = ['[ROLE_SELECT]', '[ROUTING_METADATA]'];

              config.onToolExecution = (toolName: string, args: any, result: any) => {
                const toolCallId = `${toolName}-${Date.now()}`;
                sendStep(`Tool ${toolName}`, result?.success === false ? 'failed' : 'completed', {
                  toolName,
                  toolCallId,
                  result,
                });
                emit(SSE_EVENT_TYPES.TOOL_INVOCATION, {
                  toolCallId,
                  toolName,
                  state: 'result',
                  args,
                  result,
                  timestamp: Date.now(),
                });

                // Track tool call success/failure in telemetry for model ranking
                // Uses generated toolCallId for deduplication
                if (toolName) {
                  import('@/lib/tools/tool-call-tracker').then(({ toolCallTracker }) => {
                    toolCallTracker.recordToolCall({
                      model: actualModel,
                      provider: actualProvider,
                      toolName,
                      success: result?.success !== false,
                      error: result?.error,
                      timestamp: Date.now(),
                      conversationId,
                      toolCallId: `agent-${toolName}-${Date.now()}`,
                    });
                  }).catch(() => {});
                }
              };

              // Server-side continuation loop: re-invoke the LLM with the
              // continuation prompt as the next user message when decideAutoContinue
              // returns continue: true. Counter management is handled internally by
              // the helper (requestId-keyed Map in auto-continue-helper.ts).
              // Accumulates content, steps, and fileEdits across iterations. Emits
              // SSE events for each
              // iteration so the client sees real-time streaming for the continuation.
              let currentConfig = config;
              let result: Awaited<ReturnType<typeof processUnifiedAgentRequest>> | undefined;
              let iteration = 0;
              // Per-iteration state — streamState is declared at the outer callback
              // scope (before the try block) so the catch block can still reference
              // it. Only the loop-local state is here.
              let appliedEditsResult: any = null;
              // Accumulated state across iterations
              const accumulatedSteps: any[] = [];
              const accumulatedFileEdits: any[] = [];
              const accumulatedEditCount = { applied: 0, extracted: 0 };

    /**
     * @audit-A2-splice-stub: future migration target. Currently no-op (only
     * logs intent). Once Stage 2/3 promote this to a real helper, the
     * call-site marker immediately before `} while (false);` becomes the
     * canonical migration entry. See plan-act-verify Q3
     * @audit-A2-stitch for the recurrence intent.
     */
    
// @audit-Stage3-process-caller-typed-DEFERRED-pending-helper-migration:
// processUnifiedAgentRequest(currentConfig) at L1501 below is the singular Stage 3
// target. The runAutoContinueLoop helper stub was REMOVED in this turn because the
// prior declaration had an orphan second decl (syntax catastrophe). The current
// loop uses inline `decideAutoContinue(...)` directly + the `autoDecision.continue`
// gate; a future Stage 3 retype can re-introduce runAutoContinueLoop with a
// single-function declaration + `decide: (state) => Promise<ContinueDecision>`
// signature. Until then, do-while(false) + sole-break gate at L1706-bound band
// preserves the single-shot semantics.

// @audit-phantom-L2053: L2053 is a drift target (NOT canonical Stage 2 surface).
//   Canonical Stage 2 = do-while(false) band L1475..L1712 (gate at L1706 in this file).
//   Drift points into orchestration block L2045..L2065 (executeWithOrchestrationMode);
//   rotated under post-drift comment insertions (@audit-A2-splice-stub, @audit-Q2-lift,
//   the Stage 3 marker block above).
//   Pair: @audit-phantom-L4593 in unified-agent-service.ts:1 (parallel phantom fix).

              // Server-side continuation gate.
              // do/while(false) runs ONCE unless `break;` (sole, at L1706) exits mid-body.
              // `iteration++` (L1698) advances each turn; bound is LLM_AGENT_TOOLS_MAX_ITERATIONS (env, default 10).
              // Migration note: when swapping to a real while-loop, preserve the cap + the autoDecision.continue gate so chain-bound semantics do not regress.
              do {
                // Reset per-iteration state in place. The factory's returned
                // handler reads/writes `streamState` by reference, so the same
                // handler is reused across iterations after we mutate its fields.
                resetStreamChunkState(streamState);
                appliedEditsResult = null;

                // Re-wire the streaming callback for this iteration. The factory
                // captures `streamState` by reference, so per-iteration resets
                // above are visible to the handler on the next chunk. The
                // onMarkerSeen callback fires the debug log on the false→true
                // transition without recreating a per-chunk wrapper closure.
                currentConfig.onStreamChunk = createStreamChunkHandler(
                  streamState,
                  emit,
                  ROLE_SELECT_MARKERS,
                  undefined, // use default holdback (longest marker length)
                  ({ bufferLength }) => {
                    chatLogger.debug(
                      '[StreamFilter-LLM-Stream] [ROLE_SELECT] detected, suppressing further tokens',
                      { bufferLength }
                    );
                  }
                );

                // Call the LLM
                result = await 
// @audit-Stage3-process-caller-typed-DEFERRED-pending-Stage0-1-collision:
// processUnifiedAgentRequest(currentConfig) at L1501 is the singular Stage 3 target.
// currentConfig type spelling (verbatim, future retype anchor):
//   `UnifiedAgentConfig` — imported from '@/lib/orchestra/unified-agent-service'
//   (see import line at L36: `import { processUnifiedAgentRequest,
//   type UnifiedAgentConfig } from '@/lib/orchestra/unified-agent-service';`).
//   Declared in route.ts:         `const config: UnifiedAgentConfig = { ... };` (L1306)
//   Re-aliased as:                `let currentConfig = config;` (L1444) — typed
//                                  via assignment inference, retains the
//                                  UnifiedAgentConfig canon type from L1306.
// Migration intent (Stage 3 retype): align `currentConfig` to consume the typed
//   `ContinueDecision` contract (drawn from `@/lib/chat/llm-continuation` via
//   `@/lib/chat/auto-continue-helper`'s re-export) so the AutoContinueDecision
//   return type unifies with the gate's `autoDecision.continue` read at L1706.
// Forward-reference block (Stage 0/1 collision): the `ContinueDecision` name
//   collided across auto-continue-helper.ts (was locally declared pre-cascade)
//   vs llm-continuation.ts (where `ContinueDecisionBase` + `ContinueDecision`
//   + `ContinuationDecision` derived aliases now originate). Suffix
//   `-DEFERRED-pending-Stage0-1-collision` preserved on this marker as
//   historical context — a future reader grepping `@audit-Stage3-process-caller-typed`
//   + this suffix can find the gating rationale without rediscovering it.
// Status note: Stage 0/1 collision is RESOLVED in the cascade's prior turn
//   (dedup landed in llm-continuation.ts + re-export from auto-continue-helper.ts).
//   Suffix preserved here for grep-historical detectability; the LIVE block
//   on the Stage 3 retype is the `currentConfig: UnifiedAgentConfig` typing
//   itself (not the collision).
// Resolution surface (post-cascade reference): the typed contract on the
//   helper side is `interface AutoContinueDecision extends ContinueDecisionBase`
//   in auto-continue-helper.ts; the canonical base lives in llm-continuation.ts.
//   Stage 3 retype aligns `currentConfig` to consume this typed contract
//   so the gate's `autoDecision.continue` read at L1706 sees the same
//   surface area.
processUnifiedAgentRequest(currentConfig);
                sendStep(`Iteration ${iteration + 1}`, result.success ? 'completed' : 'failed');

                // Accumulate this iteration's result
                const iterContent = streamState.buffer + (typeof result.response === 'string' ? result.response : '');
                if (result.steps) accumulatedSteps.push(...result.steps);

                // Flush holdback chars
                if (!streamState.markerSeen && streamState.charsEmittedSafely < streamState.buffer.length) {
                  const flush = streamState.buffer.slice(streamState.charsEmittedSafely);
                  if (flush) emit(SSE_EVENT_TYPES.TOKEN, { content: flush, timestamp: Date.now() });
                  streamState.charsEmittedSafely = streamState.buffer.length;
                }

                // Final parse for remaining edits
                if (streamState.buffer.trim().length > 0) {
                  streamState.parser.emittedEdits.clear();
                  streamState.parser.unclosedPositions.clear();
                  const finalEdits = extractIncrementalFileEdits(streamState.buffer, streamState.parser);
                  if (finalEdits && finalEdits.length > 0) {
                    for (const edit of finalEdits) {
                      if (!isValidFilePath(edit.path)) continue;
                      const editContent = edit.content || edit.diff || '';
                      if (!editContent || editContent.trim().length === 0) continue;
                      const isPatch = edit.action === 'patch' || !!edit.diff;
                      emit(SSE_EVENT_TYPES.FILE_EDIT, {
                        path: edit.path,
                        status: 'detected',
                        operation: isPatch ? 'patch' : 'write',
                        timestamp: Date.now(),
                        content: edit.content || '',
                        diff: isPatch ? (edit.diff || '') : undefined,
                        isFinal: true,
                      });
                    }
                  }
                }

                // VFS WRITE: Apply file edits to the virtual filesystem
                const fullResponse = iterContent;
                if (enableFilesystemEdits && fullResponse.trim() && filesystemOwnerId) {
                  try {
                    const { enableVFSBatchMode, flushVFSBatchMode } = await import('@/lib/virtual-filesystem/git-backed-vfs');
                    enableVFSBatchMode(filesystemOwnerId);
                    appliedEditsResult = await applyFilesystemEditsFromResponse({
                      ownerId: filesystemOwnerId,
                      conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
                      requestId: requestId,
                      scopePath: requestedScopePath,
                      lastUserMessage: (() => {
                        const c = [...messages].reverse().find((m) => m.role === 'user')?.content;
                        return typeof c === 'string' ? c : '';
                      })(),
                      attachedPaths: attachedFilesystemFiles.map((file) => file.path),
                      responseContent: fullResponse,
                      commands: {},
                      forceExtract: true,
                      alreadyWrittenPaths,
                    });
                    await flushVFSBatchMode(filesystemOwnerId);
                    if (appliedEditsResult?.applied?.length) {
                      accumulatedFileEdits.push(...appliedEditsResult.applied);
                      accumulatedEditCount.applied += appliedEditsResult.applied.length;
                      for (const edit of appliedEditsResult.applied) {
                        addWrittenPath(alreadyWrittenPaths, edit.path, requestedScopePath);
                      }
                      for (const edit of appliedEditsResult.applied) {
                        if (!isValidFilePath(edit.path)) continue;
                        const editContent = edit.content || edit.diff || '';
                        if (!editContent || editContent.trim().length === 0) continue;
                        const hasDiff = !!edit.diff;
                        const isPatch = edit.operation === 'patch' || hasDiff;
                        emit(SSE_EVENT_TYPES.FILE_EDIT, {
                          path: edit.path,
                          status: 'applied',
                          operation: isPatch ? 'patch' : (edit.operation || 'write'),
                          timestamp: Date.now(),
                          content: edit.content || '',
                          diff: isPatch ? (edit.diff || '') : undefined,
                        });
                      }
                    }
                  } catch (vfsError) {
                    chatLogger.warn('VFS write failed (iteration)', { requestId, iteration, error: vfsError instanceof Error ? vfsError.message : String(vfsError) });
                  }
                }

                // Auto-continue check: should we re-invoke the LLM?
                // Uses the shared decideAutoContinue helper with the richer
                // needsMoreTurnsDetector as the advanced detector (OR-composition:
                // preserves the fileEdits check while adding 15+ signals across
                // 4 factor groups). The helper handles counter management and
                // max-continuations enforcement internally.
                // Boundary invariant: result.response is the latest post-processUnifiedAgentRequest
                // view; iterContent is the cumulative streamed state (streamState.buffer + result.response).
                // They are equal when streamState.buffer is empty (i.e. immediately after a flush),
                // but diverge while the buffer holds holdback chars. Consumers reading autoDecision:
                //   - input.responseText (= iterContent) -> use for "total assistant content so far"
                //   - input.result.response             -> use for "latest post-processUnifiedAgentRequest view"
                // Runtime divergence diagnostic (warn-only) so audit logs surface the divergence
                // rather than silently treating the two as interchangeable.
                if (
                  streamState.buffer &&
                  typeof result.response === 'string' &&
                  // Q3: normalization polish — tolerate trailing-newline / em-dash /
                  // NFC-vs-NFD byte-only differences. OR semantics so we still log
                  // when either raw OR trimmed-endsWith fails; the two new payload
                  // fields below (iterContentRawEndsWith + iterContentTrimmedEnds)
                  // let downstream log-search post-filter divergence-kind.
                  // Q1: defense parity — the parent guard checks `typeof result.response === 'string'`,
                  // but a future tool-output path may pass non-string `iterContent`.
                  // Without this guard, `iterContent.endsWith` would throw
                  // `TypeError: Cannot read property 'endsWith' of undefined`. Mirror
                  // the surrounding response-guard shape; mechanical insertion.
                  ((typeof iterContent === 'string' && !iterContent.endsWith(result.response)) || !iterContent.trimEnd().endsWith(result.response.trimEnd()))
                ) {
                  chatLogger.info('[AUTO-CONTINUE] boundary divergence: iterContent != result.response', {
                    requestId,
                    bufferLen: streamState.buffer.length,
                    iterContentLen: iterContent.length,
                    iterations: iteration,
                  resultResponseLen: result.response.length,
                  // Q3 separate payload fields — see comment on the predicate above.
                  iterContentRawEndsWith: iterContent.endsWith(result.response),
                  iterContentTrimmedEnds: iterContent.trimEnd().endsWith(result.response.trimEnd()),
                  // Q4: stable per-request UUID so downstream log-search can
                  // dedupe + count boundary-divergence hits without depending on
                  // the parent request log. crypto is a Node global; falls back
                  // to generateSecureId() (already imported) if @types/node misses.
                  boundary_divergence_id: crypto.randomUUID(),
                  });
                }
                const autoDecision = decideAutoContinue({
                  requestId,
                  routing: result.metadata?.routing,
                  steps: (result.steps ?? []).map((s) => ({
                    toolName: s.toolName,
                    args: normalizeStepArgs(s.args),
                  })),
                  responseText: iterContent,
                  result,
                  advancedDetectorFn: needsMoreTurnsDetector,
                });

                // Hoisted (dedup): shared between the [AUTO-CONTINUE] log payload
                // (computed before the `if (autoDecision.continue)` branch so the
                  // Single source of truth: lives next to its only consumer so it is not
                  // computed on no-continue iterations. If a future out-of-branch
                  // telemetry needs it, hoist + add a JSDoc anchoring the invariant.
                  const isPreviousAssistantEmpty =
                    previousAssistantContent.length === 0 ||
                    previousAssistantContent.trim() === '';
                // empty-follow-up audit field stays a forward-precise metric, not
                // an inferred-from-responseLength approximation) and the
                // conversationHistory assistant-message append below.
                const previousAssistantContent = typeof result.response === 'string'
                  ? result.response
                  : (iterContent || '');
                if (autoDecision.continue) {
                  chatLogger.info('[AUTO-CONTINUE] Re-invoking LLM', {
                    requestId,
                    iteration: iteration + 1,
                    reason: autoDecision.reason,
                    forceSignal: autoDecision.forceSignal,
                    advancedDetectorForce: autoDecision.forcedBy === 'advanced',
                    continuationsSoFar: autoDecision.continuationsSoFar,
                    nextResponseEmpty: isPreviousAssistantEmpty,
                  });
                  emit(SSE_EVENT_TYPES.CONTINUE, {
                    requestId,
                    iteration: iteration + 1,
                    reason: autoDecision.reason,
                    continuationsSoFar: autoDecision.continuationsSoFar,
                  });
                  emit(SSE_EVENT_TYPES.STEP, {
                    type: 'continuation',
                    iteration: iteration + 1,
                    reason: autoDecision.reason,
                    prompt: (autoDecision.continuationPrompt ?? '').slice(0, 200),
                    timestamp: Date.now(),
                  });
                  currentConfig = {
                    ...currentConfig,
                    conversationHistory: [

          /*
           * @audit-A2-migration-ready: runAutoContinueLoop helper available
           * at function scope above (see helper docblock). Future Stage 2/3
           * migration will replace the entire iteration+decision body with:
           *   await runAutoContinueLoop(
           *     { requestId, iteration, maxIterations: 10 },
           *     { decide: decideAutoContinue },
           *   );
           * Until then, the do/while(false) shape preserves the single-shot
           * by-break bound here.
           */
                      ...(currentConfig.conversationHistory || []),
                      { role: 'assistant', content: previousAssistantContent },
                      { role: 'user', content: autoDecision.continuationPrompt ?? 'Continue from where you left off.' },
                    ],
                  };
                  iteration++;
                } else {
                  result.metadata = result.metadata || {};
                  result.metadata.continuationDecision = {
                    continue: autoDecision.continue,
                    reason: autoDecision.reason,
                    continuationsSoFar: autoDecision.continuationsSoFar,
                  };
                  break;
                }
              } while (false);
              if (accumulatedSteps.length > 0) {
                result.steps = accumulatedSteps;
              }
              // Post-loop: extract any final edits from the LAST iteration's buffer
              // and apply session naming detection. The loop already handled VFS
              // writes and step accumulation; this block runs once after the loop.
              const finalEdits = extractIncrementalFileEdits(streamState.buffer, streamState.parser);

              // SESSION NAMING: Detect if this is a new single-folder workspace
              const responseContent = streamState.buffer + (typeof result.response === 'string' ? result.response : '') || '';
              try {
                const { detectSingleFolderFromResponse, sessionNameExists } = await import('@/lib/session/session-naming');
                const detectedFolder = detectSingleFolderFromResponse(responseContent);
                const isSequentialSession = /^\d{3}$/.test(resolvedConversationId);
                const isNewSession = isSequentialSession && !result.metadata?.isExistingSession;
                if (detectedFolder && isNewSession && detectedFolder !== resolvedConversationId) {
                  const folderExists = await sessionNameExists(detectedFolder);
                  if (!folderExists) {
                    // Capture previousId BEFORE reassignment so the SSE event
                    // shows the actual rename (previous !== new), not a no-op.
                    const previousId = resolvedConversationId;
                    resolvedConversationId = detectedFolder;
                    requestedScopePath = `workspace/sessions/${detectedFolder}`;
                    emit(SSE_EVENT_TYPES.FILESYSTEM, {
                      previousId,
                      newId: detectedFolder,
                      reason: 'single-folder-workspace',
                    });
                    chatLogger.info('Session folder renamed based on detected workspace structure', {
                      previousId,
                      newId: detectedFolder,
                    });
                  }
                }
              } catch (sessionErr: any) {
                chatLogger.debug('Session naming detection failed (non-fatal)', {
                  error: sessionErr instanceof Error ? sessionErr.message : String(sessionErr),
                });
              }

              // Final file edits emit (post-stream parse catch-all)
              if (finalEdits && finalEdits.length > 0) {
                for (const edit of finalEdits) {
                  if (!isValidFilePath(edit.path)) continue;
                  const editContent = edit.content || edit.diff || '';
                  if (!editContent || editContent.trim().length === 0) continue;
                  const isPatch = edit.action === 'patch' || !!edit.diff;
                  emit(SSE_EVENT_TYPES.FILE_EDIT, {
                    path: edit.path,
                    status: 'detected',
                    operation: isPatch ? 'patch' : 'write',
                    timestamp: Date.now(),
                    content: edit.content || '',
                    diff: isPatch ? (edit.diff || '') : undefined,
                    isFinal: true,
                  });
                }
              }

              // VFS WRITE: Apply final filesystem edits to the virtual filesystem.
              // This mirrors the per-iteration VFS write in the loop — without this,
              // edits from the post-stream parse are only emitted as SSE events
              // (status: 'detected') but NEVER persisted to VFS. Critical for
              // single-iteration requests where the loop's per-iteration VFS write
              // may not catch edits that arrived after the last iteration boundary.
              if (finalEdits.length > 0 && filesystemOwnerId) {
                // (see appliedEditCount/extractedEditCount below) so the SSE DONE
                // event still carries the summary the client needs.
                result.fileEdits = accumulatedFileEdits;
                result.metadata = result.metadata || {};
                result.metadata.appliedEditCount = accumulatedEditCount.applied;
                result.metadata.extractedEditCount = accumulatedEditCount.extracted;
                result.metadata.iterationCount = iteration + 1;
              }
              if (accumulatedSteps.length > 0) {
                result.steps = accumulatedSteps;
              }
              // Post-loop: extract any final edits from the LAST iteration's buffer
              // and apply session naming detection. The loop already handled VFS
              // writes and step accumulation; this block runs once after the loop.
              const finalEdits = extractIncrementalFileEdits(streamState.buffer, streamState.parser);

              // SESSION NAMING: Detect if this is a new single-folder workspace
              const responseContent = streamState.buffer + (typeof result.response === 'string' ? result.response : '') || '';
              try {
                const { detectSingleFolderFromResponse, sessionNameExists } = await import('@/lib/session/session-naming');
                const detectedFolder = detectSingleFolderFromResponse(responseContent);
                const isSequentialSession = /^\d{3}$/.test(resolvedConversationId);
                const isNewSession = isSequentialSession && !result.metadata?.isExistingSession;
                if (detectedFolder && isNewSession && detectedFolder !== resolvedConversationId) {
                  const folderExists = await sessionNameExists(detectedFolder);
                  if (!folderExists) {
                    // Capture previousId BEFORE reassignment so the SSE event
                    // shows the actual rename (previous !== new), not a no-op.
                    const previousId = resolvedConversationId;
                    resolvedConversationId = detectedFolder;
                    requestedScopePath = `workspace/sessions/${detectedFolder}`;
                    emit(SSE_EVENT_TYPES.FILESYSTEM, {
                      previousId,
                      newId: detectedFolder,
                      reason: 'single-folder-workspace',
                    });
                    chatLogger.info('Session folder renamed based on detected workspace structure', {
                      previousId,
                      newId: detectedFolder,
                    });
                  }
                }
              } catch (sessionErr: any) {
                chatLogger.debug('Session naming detection failed (non-fatal)', {
                  error: sessionErr instanceof Error ? sessionErr.message : String(sessionErr),
                });
              }

              // Final file edits emit (post-stream parse catch-all)
              if (finalEdits && finalEdits.length > 0) {
                for (const edit of finalEdits) {
                  if (!isValidFilePath(edit.path)) continue;
                  const editContent = edit.content || edit.diff || '';
                  if (!editContent || editContent.trim().length === 0) continue;
                  const isPatch = edit.action === 'patch' || !!edit.diff;
                  emit(SSE_EVENT_TYPES.FILE_EDIT, {
                    path: edit.path,
                    status: 'detected',
                    operation: isPatch ? 'patch' : 'write',
                    timestamp: Date.now(),
                    content: edit.content || '',
                    diff: isPatch ? (edit.diff || '') : undefined,
                    isFinal: true,
                  });
                }
              }

              // VFS WRITE: Apply final filesystem edits to the virtual filesystem.
              // This mirrors the per-iteration VFS write in the loop — without this,
              // edits from the post-stream parse are only emitted as SSE events
              // (status: 'detected') but NEVER persisted to VFS. Critical for
              // single-iteration requests where the loop's per-iteration VFS write
              // may not catch edits that arrived after the last iteration boundary.
              if (finalEdits.length > 0 && filesystemOwnerId) {
                try {
                  const appliedEdits = await applyFilesystemEditsFromResponse({
                    ownerId: filesystemOwnerId,
                    conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
                    requestId,
                    scopePath: requestedScopePath,
                    lastUserMessage: task,
                    attachedPaths: attachedFilesystemFiles.map(f => f.path),
                    responseContent: streamState.buffer,
                    commands: {},
                    forceExtract: true,
                    alreadyWrittenPaths,
                  });

                  if (appliedEdits?.applied?.length) {
                    for (const edit of appliedEdits.applied) {
                      if (!isValidFilePath(edit.path)) continue;
                      const editContent = edit.content || edit.diff || '';
                      if (!editContent || editContent.trim().length === 0) continue;
                      const hasDiff = !!edit.diff;
                      const isPatch = edit.operation === 'patch' || hasDiff;
                      emit(SSE_EVENT_TYPES.FILE_EDIT, {
                        path: edit.path,
                        status: 'applied',
                        operation: isPatch ? 'patch' : (edit.operation || 'write'),
                        timestamp: Date.now(),
                        content: edit.content || '',
                        diff: isPatch ? (edit.diff || '') : undefined,
                      });
                    }
                    chatLogger.info('Final parse: applied filesystem edits', {
                      count: appliedEdits.applied.length
                    });

                    // Emit filesystem-updated CustomEvent for agent-tool path so
                    // components listening to CustomEvent update (not just SSE
                    // recipients) reflect the new file state.
                    emitFilesystemUpdated({
                      scopePath: requestedScopePath,
                      sessionId: resolvedConversationId,
                      applied: appliedEdits.applied,
                      source: 'agent-tool',
                    });

                    // Add fallback message if content is empty but files were applied
                    if (!streamState.buffer.trim() && appliedEdits.applied.length > 0) {
                      streamState.buffer = `Applied filesystem changes to ${appliedEdits.applied.length} file(s).`;
                    }
                  }
              // OUT-OF-BAND distinct from L2047 controller.enqueue safety-net:
              // this catch scopes tool-call FAILURE cleanup (fileEdits-apply errors).
              // Lock marker: do NOT migrate into runAutoContinueLoop \u2014 distinct semantic.
                } catch (editErr: any) {