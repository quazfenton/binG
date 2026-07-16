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
import { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK, MCP_AGENT_TIMEOUT_MS } from '@/lib/mcp';
// Import the structured-error type guard directly from the file that
// defines it. Could be re-exported from '@/lib/mcp' for barrel-style
// consistency, but keeping the import file-specific makes the contract
// (vfs-mcp-tools.ts:640+ returns `{ message, code, retryable, correctedExample }`)
// grep-discoverable from the call site.
import { isStructuredMcpError } from '@/lib/mcp/architecture-integration';
import { unwrapStructuredToolError } from '@/lib/mcp/orchestrator-error-unwrap';
import { selectToolPlan } from '@/lib/tools/select-tool-plan';
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
import { decideAutoContinue, needsMoreTurnsDetector, clearContinuationCount, type AutoContinueResultData } from '@/lib/chat/auto-continue-helper';
// StallWatchdogError typed discriminator — fired by `fireStall` (route.ts:L1623
// in this file) and propagated through the chain-walk's abort cascade. The
// outer catch at L2796 uses `instanceof` to map it to HTTP 524 (vs 500).
import { StallWatchdogError } from '@/lib/chat/llm-fallback-coordinator';
// Defense-in-depth: enforce the `UnifiedAgentResult.response: string`
// contract at the route boundary. The service layer (lib/orchestra/unified-agent-service.ts:1568)
// already coerces via stringifyMessageContent; this import is the route's
// belt-and-suspenders guard against any future drift — closing the silent
// stream regression where non-string response shapes became `'[object Object]'`
// at L1889 (operator-precedence floor: `+` binds tighter than `||`).
import { stringifyMessageContent } from '@/lib/chat/content-stringifier';
// Inspector helpers (extracted to `lib/chat/shape-helpers.ts` in this turn
// so they're unit-testable without a live LLM). Used at L1717-L1718 to emit
// `[CHAT-ROUTE] processUnifiedAgentRequest returned` INFO lines that surface
// a non-string response shape at INFO level — without this telemetry the
// silent-stream regression is invisible until a user complains.
import { shapeKeyOf, serializableTextLength } from '@/lib/chat/shape-helpers';
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
import { getRuntimeBroker } from '@/lib/sandbox/runtime-broker';
import { getContentAddressableStorage } from '@/lib/storage/content-addressable-storage';

/**
 * One-call snapshot of the RuntimeBroker degraded state + CAS cache size
 * for surfacing on CHAT-ROUTE boundary logs. Both reads are O(1) and have
 * no I/O — safe to call on every boundary log without measurable cost.
 * `degraded` is null on a clean init, or the init error message when the
 * broker fell back to degraded mode (see RuntimeBroker.getInitError).
 */
function getBrokerDiagnostics(): {
  degraded: string | null;
  cacheSizeBytes: number;
} {
  return {
    degraded: getRuntimeBroker().getInitError()?.message ?? null,
    cacheSizeBytes: getContentAddressableStorage().getCurrentCacheSize(),
  };
}

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
    // @audit-NEW-3-batched (audit 2026-06-20): mirror the fix applied to the
    // tool-call-tracker site. `void` prefix silences ESLint
    // no-floating-promises; outer `.catch` covers module-load failure.
    // requestId is NOT in scope here (classifyRequest runs BEFORE requestId
    // is set at L419) so closure capture doesn't apply — body stays silent
    // because a counter increment is observability-grade telemetry.
    void import('@/lib/chat/chat-metrics')
      .then(({ recordClassifierFallback }) => {
        recordClassifierFallback();
      })
      .catch((err) => chatLogger.warn('recordClassifierFallback failed', {}, { error: String(err) }));

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
  // NEW-1 (latency mask; ~15-40ms/request): fire body parse concurrently with
  // auth. rawBodyPromise resolves in the background while the sync chain below
  // (userId, isAuthenticated, rateLimitIdentifier, checkRateLimit) runs; consumed
  // at L484. Safe — rate-limit early-return at L458-L464 doesn't leak the promise
  // (request.json() can only resolve/throw once; Node gracefully completes the
  // unconsumed promise without re-parsing).
  const authPromise = resolveRequestAuth(request, { allowAnonymous: true });
  const rawBodyPromise = request.json().catch(() => null);
  const authResult = await authPromise;
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
    const rawBody = await rawBodyPromise;

    // Validate request body with Zod schema
    const parseResult = chatRequestSchema.safeParse(rawBody);
    chatLogger.debug('[ROUTE] Raw body keys:', rawBody ? { keys: Object.keys(rawBody) } : undefined);
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
      stream,
    );

    // Chat-hang-fix #2: pre-stream boundary #1 — operator diagnostic log
    // emitted right after the request-start DB write resolves. Used to
    // determine which boundary the chat route crosses last when a hang
    // symptom appears. fire-and-forget INFO (chat-metrics level) so it
    // shows up at the user's `LOG_LEVEL=info` without per-request opt-in.
    chatLogger.info('[CHAT-ROUTE] boundary: post-logRequestStart', {
      requestId,
      elapsedMs: Date.now() - requestStartTime,
      ...getBrokerDiagnostics(),
    });

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
    //
    // @audit-NEW-3-batched (latency mask; ~10-25ms/request): drop the `await` so trackSessionFiles
    // runs in the background while the LLM call setup proceeds. File-tracking is
    // observability-grade telemetry — losing-then-retried is acceptable. Two
    // defense-in-depth niceties from the original try/catch:
    //   1. New `.catch` is chained on the OUTER import promise (not just the
    //      inner trackSessionFiles), so a partial-deploy / module-load failure
    //      also lands in the debug log instead of becoming an UnhandledRejection.
    //   2. We capture `requestId` into a closure-local BEFORE the void chain so
    //      the .catch hander still has correlation after the response has
    //      finalized and AsyncLocalStorage scope is gone.
    // The `void` prefix documents fire-and-forget intent and silences ESLint's
    // `@typescript-eslint/no-floating-promises`. Mirror: tool-call-tracker (L1462).
    const trackingReqId = requestId;
    void import('@/lib/virtual-filesystem/session-file-tracker')
      .then(({ trackSessionFiles }) => trackSessionFiles(resolvedConversationId, processedMessages))
      .catch((error: any) => {
        // Don't fail the request if tracking fails
        chatLogger.debug('Session file tracking failed (non-critical)', { requestId: trackingReqId, error: error.message });
      });

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
    //
    // NEW-2 (audit 2026-07-07, doc/async-parallelization-opportunities.md
    // §NEW-2, latency mask; ~30-50ms/request typical, ~50-150ms/request on
    // cache-miss / cold-cache paths): pre-fire `denialContextPromise` +
    // `mem0ResultPromise` HERE, BEFORE the owner + classify await resolves.
    // Their DB I/O now overlaps with classifyRequest's ML wallclock
    // (~50-150ms) — typical savings is min(T_denied_DB_read, T_mem0_HTTP_round_trip),
    // whichever of the two partners finishes first while classify is still running.
    //
    // Pre-audit, deny + mem0 Promises were assigned AFTER the await, so they
    // could not begin their work until `filesystemOwnerId` was extracted from
    // `ownerResolution` — closing the door on a tighter overlap with the
    // classifier. The dependency is preserved here by chaining on
    // `ownerPromise`: each partner Promise doesn't actually START its DB / HTTP
    // call until ownerPromise settles, but the Promise object IS created here
    // so V8 dispatches the .then callback the moment ownerPromise resolves
    // (typically 5-20ms after the start) — overlapping with the rest of
    // classifyRequest's ML work.
    //
    // Safe per dependency analysis: getRecentDenials is a DB read that
    // accepts (conversationId: string, limit: number) — pure I/O with no
    // synchronous pre-flight on userId. mem0Search is a remote HTTP call to
    // `https://api.mem0.ai/v1/memories/search/` that accepts
    // {userId: string, query: string, ...} — same shape, no sync pre-flight.
    // Both functions tolerate userId being bound late (via .then closure on
    // ownerResolution). The existing prevention proxies are preserved:
    //   - mem0 .catch → graceful fallback to {success:false, results:[]}
    //   - mem0 30s in-memory TTL cache (cache hit ~0ms; cold cache pays
    //     the full TLS-conncect cost the first time)
    //   - mem0 circuit breaker (OPEN ⇒ isMem0Configured()=false ⇒ the .then
    //     branch is gated off; mem0 wallclock cost is then ~0)
    //   - deny DB→in-memory fallback via `denialHistoryByConversation` Map
    //   - anonSessionIdToSet still captured after the await
    //   - filesystemOwnerId still extracted from ownerResolution.ownerId
    const ownerPromise = resolveFilesystemOwner(request);
    const classificationPromise = classifyRequest(messages, attachedFilesystemFiles);
    const denialContextPromise = ownerPromise.then((o) =>
      filesystemEditSessionService.getRecentDenials(
        `${o.ownerId}$${resolvedConversationId}`,
        4,
      ),
    ).catch(() => {
      chatLogger.debug('Failed to fetch denial context (non-critical)', { requestId });
      return [] as Array<{ reason: string; paths: string[]; timestamp: string }>;
    });
    // NEW-2 closure-narrowing fix (tsc): capture the typeof-narrowed query
    // string BEFORE the .then so the `string` type survives across the
    // closure boundary. TypeScript's control-flow narrowing on the
    // surrounding ternary does NOT propagate into the .then callback —
    // inside the closure, `lastUserMessage.content` reverts to the full
    // `string | ContentPart[]` union, which fails the `query: string`
    // contract of `mem0Search`. Hoisting the narrowing into a const
    // preserves it for the lifetime of the closure.
    const mem0QueryText = typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '';
    const mem0ResultPromise = isMem0Configured() && mem0QueryText
      ? ownerPromise.then((o) =>
          mem0Search({
            query: mem0QueryText,
            userId: o.ownerId,
            limit: 5,
            // Tighter threshold + filter for chat hot path; keeps noise out
            threshold: 0.4,
          }).catch((memError: any) => {
            chatLogger.warn('Mem0 search failed (non-critical)', { error: memError.message });
            return { success: false, results: [] };
          }),
        ).catch(() => {
          chatLogger.debug('Mem0 search skipped (owner resolution failed)', { requestId });
          return { success: false, results: [] };
        })
      : Promise.resolve({ success: false, results: [] });

    // Calculate these BEFORE the await — they're dependencies for the
    // downstream 5-way Promise.all branches (buildWorkspaceSessionContext +
    // buildHybridWorkspaceContext both bind shouldUseContextPackFinal
    // at construction time).
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

    // Tier 1 #2 (audit 2026-06-20, Top 5 Quick Win, ~5-20ms/request): fire
    // `resolveFilesystemOwner(request)` concurrently with `classifyRequest(...)`
    // so the auth-derived setup chain (~5-20ms) overlaps with the ML-bound
    // classifier (~50-150ms). Saves the smaller of the two (typically the
    // owner-resolution time) per request.
    //
    // Combined with NEW-2 above, the four independent async ops (owner,
    // classify, deny, mem0) are now ALL scheduled at construction time and
    // PA-resolved together via the bottom Promise.all. The deny + mem0
    // chains effectively become a fan-out extension of the owner resolve
    // — T_deny and T_mem0 overlap with T_classify (and with each other).
    // anonymousSessionIdToSet still captured after this await; the downstream
    // 5-way Promise.all consumes the same denialContextPromise / mem0ResultPromise
    // objects — no consumer-side shape change.
    const [ownerResolution, classification] = await Promise.all([
      ownerPromise,
      classificationPromise,
    ]);
    const filesystemOwnerId = ownerResolution.ownerId;
    anonSessionIdToSet = ownerResolution.anonSessionId; // Set cookie if new anon session

    const isCodeRequest = classification.isCodeRequest;
    const useContextPackForAgentic = enableFilesystemEdits && isCodeRequest;
    const shouldUseContextPackFinal = useContextPack || useContextPackForAgentic;

    // Tier 1 #1 (latency mask; ~50-300ms/request): hoist v1PromptSuffix async
    // computation into the existing Promise.all below as a 5th branch. The async
    // wrapper ONLY depends on `body.presetKey` + `body.responseDepth` /
    // `expertiseLevel` / etc. — all of which are available at Promise.all
    // construction time. Downstream consumer (the `if (v1PromptSuffix)` block
    // that mutates contextualMessages + emits telemetry) runs sequentially
    // AFTER Promise.all resolves as before; only the async work shifts.
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

    // Chat-hang-fix #2: pre-stream boundary #2 — operator diagnostic log
    // emitted right after the 5-way Promise.all (denialContext,
    // workspaceSessionContext, mem0Result, hybridContext, v1PromptSuffix)
    // resolves. Combined with boundary #1 above, the delta between the two
    // narrows the hang to one of: filesystem edit denials DB read,
    // workspace-session-context build, mem0 HTTP call, hybrid AST retrieval,
    // or V1 prompt-modifier composition.
    const fiveWayStartMs = Date.now();
    const [denialContext, workspaceSessionContext, mem0Result, hybridContext, v1PromptSuffix] = await Promise.all([
      // Get recent filesystem edit denials
      denialContextPromise,
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
      mem0ResultPromise,
      // Hybrid retrieval: AST-based symbol retrieval with smart-context fallback
      enableFilesystemEdits && userPrompt
        ? buildHybridWorkspaceContext(filesystemOwnerId, scopePathForHybrid, {
            prompt: userPrompt,
            projectId: scopePathForHybrid, // Use scopePath as stable workspace ID
            maxTokens: body.maxTokens,
          })
        : Promise.resolve(''),
      // 5th branch (Tier 1 #1): resolve V1 prompt modifiers concurrently with
      // the context-builders so the ML/preset-composition latency overlaps
      // with DB I/O. Always resolves to either the suffix string or '' so the
      // downstream `if (v1PromptSuffix)` consumer sees the same shape.
      (async (): Promise<string> => {
        if (body.presetKey && body.presetKey in PROMPT_PRESETS) {
          const preset = getPreset(body.presetKey as keyof typeof PROMPT_PRESETS);
          return await applyPromptModifiers({ ...preset, ...v1PromptParams });
        } else if (Object.values(v1PromptParams).some(v => v !== undefined)) {
          return await applyPromptModifiers(v1PromptParams);
        }
        return '';
      })(),
    ]);
    // Chat-hang-fix #2: companion log to boundary #2 above — reports the
    // total wall-clock for the 5-way fan-out so a single root cause
    // dominating the latency is visible in run.log.
    chatLogger.info('[CHAT-ROUTE] boundary: post-5way-promise-all', {
      requestId,
      elapsedMs: Date.now() - requestStartTime,
      fiveWayDurationMs: Date.now() - fiveWayStartMs,
      ...getBrokerDiagnostics(),
    });

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
    // The async work (applyPromptModifiers) is now resolved INSIDE the 5-way
    // Promise.all above; here we only consume the already-resolved string and
    // append it to contextualMessages + emit telemetry. (Tier 1 #1 refactor.)
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

    // Route-level stall backstop. `agentTurnAbort` is fired by the stall
    // watchdog inside the streaming `start()` (idle-based — reset on every
    // SSE emit) when the agent turn produces NO output for
    // CHAT_ROUTE_STALL_TIMEOUT_MS. Merging it with `request.signal` means a
    // user-initiated stop OR a watchdog timeout both propagate down through
    // `config.abortSignal` into the LLM HTTP call, and the route also races
    // the awaited `processUnifiedAgentRequest` against the watchdog so the
    // response is freed even if the underlying SDK/provider ignores the abort.
    const agentTurnAbort = new AbortController();
    const agentTurnSignal: AbortSignal = request.signal
      ? AbortSignal.any([request.signal, agentTurnAbort.signal, AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS)])
      : AbortSignal.any([agentTurnAbort.signal, AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS)]);

    // Chat-hang-fix #3 — HOISTED route-level stall watchdog.
    //
    // The watchdog was previously nested inside the streaming branch's
    // ReadableStream.start(controller), which meant it only protected the
    // useUnifiedAgentStream path. The non-streaming fallback
    // (await processUnifiedAgentRequest(config)) and the v1-agent-loop
    // branch (await createAgentLoop(...)) had NO watchdog and could hang
    // indefinitely. After hoist, the SAME stallPromise is wired into all
    // three awaited call sites, and the SAME absolute hard cap
    // (ROUTE_MAX_TURN_MS) bounds any single agent turn regardless of which
    // dispatch branch the route resolves to.
    //
    // Closure-captured state is intentionally module-private to POST() so
    // a request's watchdog cannot leak across concurrent requests.
    const stallStartTime = Date.now();
    let lastProgressAt = stallStartTime;
    const PROGRESS_EVENT_TYPES = new Set<unknown>([
      SSE_EVENT_TYPES.TOKEN,
      SSE_EVENT_TYPES.TOOL_INVOCATION,
    ]);
    // Rejects when the watchdog fires so the route stops awaiting any
    // processUnifiedAgentRequest / createAgentLoop call, even if the
    // underlying SDK/provider never settles its promise (e.g. ignores
    // the abort signal).
    let stallReject: ((err: Error) => void) | null = null;
    const stallPromise = new Promise<never>((_, reject) => {
      stallReject = reject;
    });
    // Avoid an unhandled-rejection warning in the normal (no-stall)
    // path: the watchdog is cleared in every branch's finally, so this
    // promise simply stays pending; the noop catch is defensive.
    stallPromise.catch(() => { /* observed via Promise.race */ });

    // Bug #X (— `stallDidFire` propagation for the 524-vs-200 distinction):
    // closure flags set true the moment the stall watchdog fires (via
    // fireStall) or a user-initiated abort fires (via rejectOnAbort).
    // The route reads these flags synchronously to drive two distinct
    // behaviors:
    //
    //   1. PRE-STREAM 524 — if `agentTurnAbort.signal.aborted === true`
    //      when we reach the streaming/non-streaming return point AND
    //      the stall fired before any client-visible content was streamed,
    //      return `new NextResponse(..., { status: 524 })` directly.
    //      HTTP 524 = "A Timeout Occurred" (Cloudflare-style proxy
    //      timeout) is a valid 3-digit status. The pre-fix route returned
    //      200 even on watch-dog-fired stream, masking the timeout from
    //      upstream load balancers + client.
    //
    //   2. MID-STREAM 200 + `x-stall-fired: true` header — if the stall
    //      fires AFTER content was streamed, status is structurally
    //      locked at 200 by the live SSE Response (Next.js cannot change
    //      status post-headers-flush). The route still adds the header +
    //      the SSE error event + the abort cascade so observability +
    //      the client see the timeout signal.
    //
    // Closure-private to POST() so concurrent requests cannot leak.
    let stallDidFire = false;
    let stallDidFireReason: string | null = null;

    // No-progress idle ceiling (default 60s): fires when no token/tool
    // output has arrived for this long. Only relevant for the streaming
    // branch (non-streaming doesn't bump lastProgressAt because there's
    // no client-visible SSE stream); the max-turn cap below catches
    // those cases unconditionally.
    const ROUTE_STALL_TIMEOUT_MS = parseInt(
      process.env.CHAT_ROUTE_STALL_TIMEOUT_MS || '120000',
      10,
    );
    // Absolute hard cap (default 120s): an unconditional upper bound on
    // a single agent turn, applied to ALL branches. This is the
    // guaranteed backstop — including the v1-agent-loop branch whose
    // createAgentLoop(...) call previously had no watchdog at all.
    // Bug #Y — chain.length-conditioned max-turn: the route watchdog must
    // not fire BEFORE the chain-walk in `coordinateConcurrentFallback`
    // completes. Worst-case walk time = `MAX_CHAIN_FALLBACKS * silenceMs +
    // transition overhead`. We treat MAX_CHAIN_FALLBACKS=7 as the upper
    // bound across all configured chains (see
    // `bing/web/lib/providers/provider-fallback-chains.ts`); the 1.5×
    // safety factor absorbs Promise.race transition overhead + slow first
    // token; the 30s buffer absorbs slow tool calls.
    //
    //   ninerouter-class: 7 * 5_000 * 1.5 + 30_000 = 82.5s     (well under envVar floor)
    //   non-ninerouter:   7 * 20_000 * 1.5 + 30_000 = 240_000ms (extends envVar floor)
    //
    // The env var acts as a FLOOR: ops can still raise ROUTE_MAX_TURN_MS
    // past 240s for known-slow chains; we never shrink it below the
    // chain-walk + buffer formula.
    const ROUTE_MAX_TURN_MS_ENV = parseInt(
      process.env.CHAT_ROUTE_MAX_TURN_MS || '120000',
      10,
    );
    const ROUTE_MAX_TURN_MAX_CHAIN_FALLBACKS = 7;
    const isNinerouterClassProvider = ['ninerouter', 'ollama', 'kiro'].includes(provider);
    const effectiveSilenceMs = isNinerouterClassProvider ? 5000 : 20000;
    const ROUTE_MAX_TURN_MS = Math.max(
      ROUTE_MAX_TURN_MS_ENV,
      Math.ceil(ROUTE_MAX_TURN_MAX_CHAIN_FALLBACKS * effectiveSilenceMs * 1.5) + 30000,
    );
    chatLogger.debug('[CHAT-ROUTE] computed max-turn from chain.length + silenceMs', {
      requestId,
      provider,
      isNinerouterClassProvider,
      effectiveSilenceMs,
      ROUTE_MAX_TURN_MAX_CHAIN_FALLBACKS,
      ROUTE_MAX_TURN_MS,
      ROUTE_MAX_TURN_MS_ENV,
    });
    // SSE-bridge: the streaming branch's start(controller) overrides
    // this with the real SSE-error emitter; non-streaming / v1-agent-loop
    // branches leave it as a no-op so fireStall doesn't error trying to
    // enqueue onto a non-existent stream. The no-op default is INTENTIONAL
    // (not dead code) — it's the only safe value before start(controller)
    // has had a chance to run.
    // SSE-stall discriminator — second arg (isStall?: boolean) lets fireStall
    // mark the SSE error payload as a server-side stall so the client
    // (use-enhanced-chat.ts case 'error') can render an unambiguous non-
    // retryable UX. Without this discriminator, mid-stream stalls (which are
    // structurally forced to HTTP 200 because headers were already flushed
    // during streaming) get conflated with transient network errors, leaving
    // the operator uncertain.
    let emitSseError: (message: string, isStall?: boolean) => void = () => { /* not streaming */ };
    const fireStall = (reason: string, detail: Record<string, unknown>) => {
      if (agentTurnAbort.signal.aborted) return;
      // Mark the stall PRIOR to any logging/abort so downstream checks
      // see the closure flag without a window between fire and observe.
      stallDidFire = true;
      stallDidFireReason = reason;
      chatLogger.error(
        '[CHAT-ROUTE] Stall watchdog fired — aborting agent turn',
        { requestId, reason, ...detail },
      );
      const stallErr = new StallWatchdogError(`Chat route stall watchdog (${reason}): ${JSON.stringify(detail)}`);
      // isStall=true: mark as Rec #2 watchdog-fired mid-stream stall so client renders "Server timed out" UX.
      try { emitSseError(stallErr.message, true); } catch { /* best-effort */ }
      // Cancel the in-flight LLM HTTP call (signal is already forwarded
      // through config.abortSignal → runV1Api / runV2Native / v2-cli).
      try { agentTurnAbort.abort(stallErr); } catch { /* best-effort */ }
      // Free the response even if the inner promise never settles.
      stallReject?.(stallErr);
    };
    // When the abort signal fires, reject the stall promise immediately
    // so all three awaited call sites unblock (instead of hanging
    // forever waiting for a Promise.race winner that never settles).
    const rejectOnAbort = () => {
      if (!stallReject) return;
      // User-initiated aborts do NOT count as stalls for the
      // non-streaming 524 contract (the client canceled, not us) — the
      // catch-blocks below only return 524 for watchdog-fired stalls
      // (the `Chat route stall watchdog (...)` substring), not for the
      // literal `'Chat route aborted'` message. We DO set stallDidFire
      // so the streaming x-stall-fired header surfaces *any* abort as
      // a recognizable signal for observability.
      stallDidFire = true;
      stallDidFireReason = stallDidFireReason ?? 'user-abort';
      const abortErr = new Error('Chat route aborted');
      try { emitSseError(abortErr.message); } catch { /* best-effort */ }
      stallReject(abortErr);
      stallReject = null;
    };
    // Handle abort signal that fires after listener is attached.
    agentTurnAbort.signal.addEventListener('abort', rejectOnAbort, { once: true });
    // Handle case where signal was ALREADY aborted before listener.
    if (agentTurnAbort.signal.aborted) rejectOnAbort();
    const stallWatchdog = setInterval(() => {
      if (agentTurnAbort.signal.aborted) return;
      const noProgressMs = Date.now() - lastProgressAt;
      const turnMs = Date.now() - stallStartTime;
      if (turnMs >= ROUTE_MAX_TURN_MS) {
        fireStall('max-turn', { turnMs, thresholdMs: ROUTE_MAX_TURN_MS });
      } else if (noProgressMs >= ROUTE_STALL_TIMEOUT_MS) {
        fireStall('no-progress', { idleMs: noProgressMs, thresholdMs: ROUTE_STALL_TIMEOUT_MS });
      }
    }, Math.min(ROUTE_STALL_TIMEOUT_MS, ROUTE_MAX_TURN_MS, 15000));

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
      // Forward a COMBINED abort signal so the orchestration pipeline
      // (processUnifiedAgentRequest → runV1Api / runV2Native /
      // coordinateConcurrentFallback) can `if (signal?.aborted)` and
      // end the chain-walk on user-initiated stop OR on the route-level
      // stall watchdog (see `agentTurnAbort` below). Without this, the
      // user has no way to interrupt a stalling fallback chain that
      // walks 7+ providers × 30s silence each (~4 min total). The
      // watchdog's controller is merged here so a fired watchdog truly
      // cancels the in-flight LLM HTTP request. See the abortSignal
      // JSDoc on UnifiedAgentConfig for the per-mode wiring status.
      abortSignal: agentTurnSignal,
      // Reset the stall watchdog when the auto-continuation loop starts a
      // new streaming call, preventing false timeouts during the gap between
      // the primary stream ending and the continuation's first token.
      onProgress: () => { lastProgressAt = Date.now(); },
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

    // Race MCP tool loading against a timeout + abort signal. Mcporter's
    // runtime.listTools can hang indefinitely on unreachable HTTP MCP
    // servers (Node.js fetch has no default timeout). When the timeout
    // fires or the client disconnects, we log a warning and proceed with
    // an empty tool set rather than blocking the entire chat response.
    // MCP tools timeout: Two-tier decoupled ceiling.
    //
    // Tier 1 — AbortSignal (MCP_TOOLS_TIMEOUT_MS, default 1000ms):
    //   Passed into getMCPToolsForAI_SDK so Phase 2 ops (getRemoteMCPTools,
    //   getArcadeToolDefinitions, getComposioMCPTools, buildMem0Tools) abort
    //   their in-flight work and degrade to empty slots. This is the fast
    //   path — a dead TCP socket gets killed at ~1s instead of the 15-30s
    //   connect timeout.
    //
    // Tier 2 — route-level Promise.race ceiling (MCP_TOOLS_TIMEOUT_MS + 3000ms):
    //   Safety net in case the abort-signal unwinding itself races the route
    //   boundary. Gives Phase 2 time to catch the abort, return empty slots,
    //   and let getMCPToolsForAI_SDK return whatever Phase 1 tools (VFS,
    //   provider, bash, etc.) it already assembled. Without this padding,
    //   both timers fire at the same wallclock time and the route's setTimeout
    //   always wins — discarding Phase 1 tools that completed in ~50ms.
    const MCP_TOOLS_TIMEOUT_MS = parseInt(
      process.env.CHAT_MCP_TOOLS_TIMEOUT_MS || '1000',
      10,
    );
    const MCP_TOOLS_ROUTE_TIMEOUT_MS = MCP_TOOLS_TIMEOUT_MS + 3000;

    // ── selectToolPlan: route-level pure planner ────────────────────────────
    // Compute the deterministic tool-selection plan BEFORE calling
    // getMCPToolsForAI_SDK. The plan replaces the raw `task` string the
    // route previously passed — see bing/web/lib/mcp/architecture-integration.ts
    // `TaskFilterView` doc for the three-mode contract. Plan mode swaps the
    // substring gates on Blaxel / Nullclaw / Arcade / Composio / Provider
    // for intent + source-permission gates, scopes Composio via
    // `requestedToolkits`, and zeroes out Arcade tools unless the planner
    // matched a web.* / integration.* intent. The VFS / bash / native MCP /
    // MCPorter / remote MCP / Mem0 / web_search sources remain
    // unconditional so the chat-hang-fix VFS fallback stays intact.
    //
    // History is filtered to user/assistant/system roles so a turn carrying
    // tool-call payloads (role:'tool') doesn't pollute the planner's
    // history-weight signal — the planner only sees content strings.
    const toolPlan = selectToolPlan({
      userMessage: task,
      conversationHistory: processedMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content ?? ''),
        })),
      attachedFiles: explicitFilesFromMentions,
      authenticated: !!authenticatedUserId,
      // The route's filesystem-edit gate already accepts/rejects writes
      // via the existing shouldHandleFilesystemEdits() helper. We pass
      // its result so the planner strips mutating tool IDs (file.write,
      // file.str_replace, file.batch_write, file.append, code.ast_diff)
      // when the route's gate is closed.
      filesystemEditEligible: enableFilesystemEdits,
      configuredSources: {
        arcade: !!process.env.ARCADE_API_KEY,
        composio: !!process.env.COMPOSIO_API_KEY,
        nullclaw: process.env.NULLCLAW_ENABLED === 'true',
        remoteMcp: true, // optimistic — runtime + Phase-2 transport decides
        mem0: !!process.env.MEM0_API_KEY,
        mcpHttp: true, // optimistic — Phase-2 transport decides
      },
    });
    chatLogger.debug('[CHAT-ROUTE] selectToolPlan', {
      requestId,
      intents: toolPlan.intents,
      coreToolsCount: toolPlan.coreTools.length,
      matchCount: toolPlan.matchCount,
      fallbackUsed: toolPlan.fallbackUsed,
      sourcePermissions: toolPlan.sourcePermissions,
      requestedToolkits: toolPlan.requestedToolkits,
      authenticatedUser: !!authenticatedUserId,
    });
    // Tier 1: abort signal for Phase 2 internal degradation.
    const mcpAbortSignal = AbortSignal.timeout(MCP_TOOLS_TIMEOUT_MS);
    // Boundary #4 timestamp — measured AT try-entry so duration includes
    // both the getMCPToolsForAI_SDK() call AND any timeout-noise (5s
    // ceiling or 2s bootstrap-mcp abort-mirror). Reported in the
    // boundary: post-mcp-race log below.
    const mcpRaceStartMs = Date.now();
    let tools: Awaited<ReturnType<typeof getMCPToolsForAI_SDK>> = [];
    // Boundary #4 outcome classifier — captured ABOVE the try so the
    // post-catch log can read it. Holds the reject reason (err.message)
    // when the race fails; null on success. Empty success (race resolved
    // with []) is detected via `tools.length === 0` AFTER the try/catch.
    let mcpRaceError: { message?: string } | null = null;
    try {
      const mcpRace: Promise<any>[] = [
        getMCPToolsForAI_SDK(authenticatedUserId, toolPlan, mcpAbortSignal),
        // Tier 2: safety-net ceiling — padded so the Tier-1 abort signal
        // fires first, Phase 2 degrades, and getMCPToolsForAI_SDK returns
        // Phase 1 tools before this timer rejects the race.
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`MCP tools route timeout after ${MCP_TOOLS_ROUTE_TIMEOUT_MS}ms (abort signal ${MCP_TOOLS_TIMEOUT_MS}ms)`)),
            MCP_TOOLS_ROUTE_TIMEOUT_MS,
          );
        }),
      ];
      if (request.signal) {
        mcpRace.push(new Promise<never>((_, reject) => {
          if (request.signal!.aborted) reject(new Error('Request aborted while loading MCP tools'));
          else request.signal!.addEventListener('abort', () => reject(new Error('Request aborted while loading MCP tools')), { once: true });
        }));
      }
      tools = await Promise.race(mcpRace);
    } catch (err: any) {
      // Chat-hang-fix: when the full MCP tool assembly loses the race (slow
      // network-bound source, mcporter runtime, remote MCP, etc.), do NOT drop
      // the model to zero tools — that leaves it unable to edit files and it
      // typically emits an intro then stalls until the turn watchdog fires.
      // Fall back to the STATIC VFS file-edit tools (write_file, apply_diff,
      // read_file, list_files, search_files, batch_write, delete_file). These
      // are pure schema definitions with no network/subprocess dependency and
      // are dispatched through the same config.executeTool → callMCPToolFromAI_SDK
      // path below, so file editing keeps working in the degraded case.
      let fallbackTools: typeof tools = [];
      try {
        const { getVFSToolDefinitions } = await import('@/lib/mcp/vfs-mcp-tools');
        fallbackTools = getVFSToolDefinitions() as typeof tools;
      } catch (fallbackErr: any) {
        chatLogger.warn('[CHAT-ROUTE] VFS fallback tools unavailable', {
          requestId,
          error: fallbackErr?.message,
        });
      }
      chatLogger.warn('[CHAT-ROUTE] MCP tools timed out — falling back to static VFS tools', {
        requestId,
        error: err.message,
        fallbackToolCount: fallbackTools.length,
      });
      tools = fallbackTools;
      mcpRaceError = err;
    }
    // Chat-hang-fix #4 boundary #4 — in-between anchor for the next
    // hang report. Captures mcpRaceDurationMs (the ceiling/timeout of
    // THIS block only) + the final toolsCount so a 30s+ delta between
    // post-5way-promise-all (boundary #2) and pre-processUnifiedAgentRequest
    // (boundary #3) is attribute-able to MCP vs downstream by reading
    // elapsedMs - mcpRaceDurationMs = (everything else). Emitted AFTER the
    // try/catch closes so the log fires whether the race resolved, timed
    // out via MCP_TOOLS_TIMEOUT_MS (5s), or rejected via request.signal.
    // Chat-hang-fix #4 boundary #4 (rev 2) — outcome classifier combined
    // with the in-between anchor log. `toolsOutcome` condenses the
    // (tools.length + err.message) pair into a grep-able literal so
    // operators don't have to regex-parse err.message to classify:
    //   - 'success'    race resolved with >=1 tool
    //   - 'empty'      race resolved with 0 tools (success but empty)
    //   - 'timed_out'  race rejected by MCP_TOOLS_TIMEOUT_MS ceiling
    //   - 'aborted'    race rejected by request.signal abort
    //   - 'empty'      fallback for race-rejected-by-other-reason
    let toolsOutcome: 'success' | 'timed_out' | 'aborted' | 'empty';
    if (mcpRaceError) {
      const msg = mcpRaceError.message || '';
      if (/timed out after/i.test(msg)) {
        toolsOutcome = 'timed_out';
      } else if (/aborted/i.test(msg)) {
        toolsOutcome = 'aborted';
      } else {
        // Race was rejected but not by the two well-known signals (e.g.
        // getMCPToolsForAI_SDK threw its own error). Post-catch tools=[]
        // still applies, so classify as 'empty' rather than introducing
        // a 5th outcome class for a one-off.
        toolsOutcome = 'empty';
      }
    } else {
      toolsOutcome = tools.length === 0 ? 'empty' : 'success';
    }
    chatLogger.info('[CHAT-ROUTE] boundary: post-mcp-race', {
      requestId,
      elapsedMs: Date.now() - requestStartTime,
      mcpRaceDurationMs: Date.now() - mcpRaceStartMs,
      toolsCount: tools.length,
      toolsOutcome,
      // RuntimeBroker degraded state + CAS cache size (O(1) reads, no I/O).
      ...getBrokerDiagnostics(),
    });
    config.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
    config.executeTool = async (name: string, args: Record<string, any>) => {
      // F2 + F4 redesign: per-call AbortController isolation + watchdog
      // progress bumps. Each tool invocation gets its own
      // `toolCallAbort` that is disposed at completion; this prevents a
      //   stalled-stage abort from permanently poisoning the global
      //   `agentTurnSignal` chain (F4: per-stage signal isolation —
      //   resets in `finally`). The next tool call walks in with a
      //   fresh signal, so self-heal retry paths (or subsequent tool
      //   calls) don't inherit an already-aborted signal.
      //
      //   Pair: combine toolCallAbort.signal + agentTurnSignal into a
      //   per-call `toolCallSignal` via `AbortSignal.any` so user-
      //   initiated stops + a route-level stall watchdog bleed into
      //   the transport chain without poisoning the parent.
      const toolCallAbort = new AbortController();
      const toolCallSignal = AbortSignal.any([
        agentTurnSignal,
        toolCallAbort.signal,
      ]);
      // F2 part (a): bump `lastProgressAt` on tool START so the
      // route-level stall watchdog (which keys off `Date.now() -
      // lastProgressAt`) does not fire while the tool is awaiting.
      // setInterval ticks continuously; a fresh `lastProgressAt`
      // resets the cumulative idle window.
      lastProgressAt = Date.now();

      try {
        const result = await callMCPToolFromAI_SDK(
          name,
          args,
          authenticatedUserId ?? '',
          requestedScopePath ?? '',
          undefined,                     // recentFailures (unchanged)
          { signal: toolCallSignal },    // F4: per-call signal (was agentTurnSignal)
        );

      // F1 fix: structured-error unwrap. VFS tools (vfs-mcp-tools.ts:640+) return
      // errors as `{ code, message, retryable, correctedExample }` blobs. The
      // SDK type signature declares `error?: string`, so by the time results
      // reach the orchestrator the structured info is collapsed to a generic
      // "Unknown error — tool result has keys" log line that gives the LLM
      // no actionable context. Detect the structured object shape and lift
      // its fields into the LLM-facing `output` so the model can self-correct.
      //
      // Output format (single LLM-facing block appended to existing output):
      //   [ORCHESTRATOR-UNWRAP]: <error.message>
      //   [error.code=<code>] [retryable=<bool>]
      //   → <correctedExample>      (omitted if undefined)
      //
      // Plain-string errors pass through unchanged. Suppresses the existing
      // "Unknown error — tool result has keys" log spam only when structured
      // shape is detected + unwrap succeeds (the LLM now sees the structured
      // info; the generic WARN line would be redundant).
      // SHOULD-CONSIDER: error.code may be 'UNKNOWN' for unrecognized shapes;
      // the LLM should treat this as a fresh retry rather than a typed failure.
      // F1 fix (helper-extracted): structured-error unwrap migrated to a
      // module-private helper. `unwrapStructuredToolError` returns the
      // formatted `[ORCHESTRATOR-UNWRAP]: …` block OR `null` when the
      // input does not match the VFS/MCP `{ message, code?, retryable?,
      // correctedExample? }` shape. The prior 16-line inline build at
      // this site was lifted out so future V2-path migration +
      // chat-helpers.ts tool-result surfacing reuse the same format
      // without copy-paste drift. See
      // /opt/bing/web/lib/mcp/orchestrator-error-unwrap.ts for the format
      // contract + reuse guidance.
      const orchestratorHint = unwrapStructuredToolError(result.error);
      const finalOutput = orchestratorHint
        ? (result.output && result.output.length > 0
            ? `${result.output}\n\n${orchestratorHint}`
            : orchestratorHint)
        : result.output;

      return {
        success: result.success,
        output: finalOutput,
        exitCode: result.success ? 0 : 1,
      };
      } finally {
        // F2 part (a): bump `lastProgressAt` on tool COMPLETE so the
        // watchdog tally resets even if the tool returned
        // structured-error or failed. Without this, a sequence of
        // tool calls could cumulatively trip the stall watchdog
        // (each tool returning would leave lastProgressAt stale).
        lastProgressAt = Date.now();
        // F4: dispose the per-call AbortController so a subsequent
        // call (or self-heal retry) gets a fresh signal. The
        // `AbortSignal.any` parent reference drops the listener on
        // the next tick once the per-call signal is aborted.
        toolCallAbort.abort();
      }
    };

    // FIX: When AGENT_EXECUTION_ENGINE='v1-agent-loop', skip unified-agent streaming
    // and fall through to the direct Mastra/ToolLoopAgent path (createAgentLoop)
    const useUnifiedAgentStream = stream && AGENT_EXECUTION_ENGINE !== 'v1-agent-loop';

    if (useUnifiedAgentStream) {
      // Bug #X (pre-stream 524): if the watchdog (or abort) fired
      // BEFORE start(controller) was entered (e.g. fast watchdog + slow
      // agent setup, OR an upstream load-balancer request timeout that
      // propagated to `request.signal.aborted`), return 524 directly
      // without ever starting the SSE stream. Status cannot be
      // retroactively changed post-headers-flush, so this is the ONLY
      // window available to surface a non-200 to the client + upstream
      // proxies. Same status as the non-streaming race-winner 524
      // below (the two cases converge on the same HTTP semantics).
      if (agentTurnAbort.signal.aborted) {
        if (typeof clearInterval === 'function') clearInterval(stallWatchdog);
        const preStreamReason = stallDidFireReason ?? 'pre-stream-aborted';
        chatLogger.warn(
          '[CHAT-ROUTE] Pre-stream 524 — stall or abort fired before stream start',
          { requestId, reason: preStreamReason },
        );
        return addAnonSessionCookie(
          NextResponse.json(
            {
              error: 'Chat stalled before stream start',
              reason: preStreamReason,
              requestId,
              stitchedFromWatchDog: stallDidFire,
            },
            {
              status: 524,
              headers: {
                'content-type': 'application/json',
                'x-stall-fired': 'true',
                'x-stall-reason': preStreamReason,
              },
            },
          ),
        );
      }
      const streamBody = new ReadableStream({
          async start(controller) {
            const rawEmit = createSSEEmitter(controller);

            // Chat-hang-fix #3 — streaming branch SSE-bridge override.
            // The hoisted watchdog state (lastProgressAt,
            // PROGRESS_EVENT_TYPES, ROUTE_STALL_TIMEOUT_MS,
            // ROUTE_MAX_TURN_MS, fireStall, rejectOnAbort,
            // stallWatchdog) is owned by the OUTER try block of POST().
            // This start(controller) callback only owns:
            //   1) emitSseError override: wires the hoisted no-op
            //      into the real SSE-error emitter so fireStall's
            //      SSE emit reaches the client when watchdog fires.
            //   2) Local `emit` wrapper: bumps the hoisted
            //      lastProgressAt for TOKEN / TOOL_INVOCATION events
            //   so the no-progress idle ceiling can fire correctly.
            emitSseError = (message: string, isStall?: boolean): void => {
              try { rawEmit(SSE_EVENT_TYPES.ERROR, { message, isStall }); } catch { /* best-effort */ }
            };
            const emit: typeof rawEmit = (eventType, payload) => {
              if (PROGRESS_EVENT_TYPES.has(eventType)) lastProgressAt = Date.now();
              return rawEmit(eventType, payload);
            };

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
                  // @audit-NEW-3-batched (audit 2026-06-20): mirror the trackSessionFiles
                  // fix at L857-L879 for the outer-import rejection + ALS scope
                  // teardown after response finalize. The onToolExecution callback
                  // sometimes fires AFTER the SSE stream ends — snapshotting
                  // requestId into a closure-local BEFORE the void chain keeps
                  // correlation even when chatLogger's ALS scope is gone.
                  const toolTelemetryReqId = requestId;
                  void import('@/lib/tools/tool-call-tracker')
                    .then(({ toolCallTracker }) => {
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
                    })
                    .catch((error: any) => {
                      chatLogger.debug('Tool call telemetry failed (non-critical)', { requestId: toolTelemetryReqId, error: error.message });
                    });
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
// @audit-Stage3-process-caller-typed-APPLIED:
// processUnifiedAgentRequest(currentConfig) at L1501 is the Stage 3 retype target.
// Status: APPLIED in this turn (suffix promoted from
//   `-DEFERRED-pending-Stage0-1-collision` → `-APPLIED`).
//
// currentConfig type anchor (verbatim, post-retype):
//   `UnifiedAgentConfig` — imported from '@/lib/orchestra/unified-agent-service'
//   (see import line at L36: `import { processUnifiedAgentRequest,
//   type UnifiedAgentConfig } from '@/lib/orchestra/unified-agent-service';`).
//   Declared in route.ts:  `const config: UnifiedAgentConfig = { ... };` (L1306)
//   Re-aliased as:         `let currentConfig = config;` (L1444) — typed
//                          via assignment inference, retains the
//                          UnifiedAgentConfig canon type from L1306.
//
// Resolution surface (now applied — cascade Q1-Q5 closure):
//   * `continue: AutoContinueDecision extends ContinueDecisionBase` (helper side)
//   * `decideAutoContinue` returns the typed surface; consumers reading
//     `autoDecision.continue / autoDecision.reason` see the canonical fields
//     (no cast required).
//   * Stage 0/1 collision (ContinueDecision name dedup) was resolved in
//     the prior turn: `ContinueDecisionBase` + `ContinueDecision` + `ContinuationDecision`
//     derive aliases live in llm-continuation.ts; auto-continue-helper.ts
//     re-exports them as single-source-of-truth.
//   * Dormant `AutoContinueInput.iteration?` field was dropped in this turn
//     (cascade Q2 cleanup — never read by decideAutoContinue body).
//
// Pair: @audit-phantom-L2053 in route.ts (canonical Stage 2 band reference).
//        @audit-phantom-L4593 in unified-agent-service.ts:1 (parallel phantom fix).
                chatLogger.info('[CHAT-ROUTE] boundary: pre-processUnifiedAgentRequest (v1 streaming)', {
                  requestId,
                  iteration,
                  elapsedMs: Date.now() - requestStartTime,
                  ...getBrokerDiagnostics(),
                });
                try {
                  result = await Promise.race([
                    processUnifiedAgentRequest(currentConfig),
                    stallPromise,
                  ]);
                } catch (raceErr: any) {
                  // Bug #X (streaming do/while race-winner): if the
                  // stallPromise wins the race, surface a stub `result`
                  // and `break` out of the do-while. The SSE error
                  // event (emitted by fireStall BEFORE the
                  // stallPromise-reject) + the `x-stall-fired` header
                  // + the aborted inner stream are the contract for the
                  // streaming branch. Status remains structurally
                  // locked at 200 (cannot be changed mid-stream).
                  const msg =
                    raceErr instanceof Error ? raceErr.message : String(raceErr);
                  const isStallWinner =
                    typeof msg === 'string' &&
                    (msg.startsWith('Chat route stall watchdog') ||
                      msg === 'Chat route aborted');
                  if (isStallWinner) {
                    chatLogger.warn(
                      '[CHAT-ROUTE] Streaming do/while race-winner is the stall — breaking inner loop',
                      { requestId, msg },
                    );
                    result = {
                      success: false,
                      response: msg,
                      steps: [],
                      mode: 'v1-api',
                      error: msg,
                    } as Awaited<ReturnType<typeof processUnifiedAgentRequest>>;
                    break;
                  }
                  throw raceErr;
                }
                // Bug-fix #2: surface the post-await response shape at INFO level so
                // future silent-stream regressions are visible in production without
                // toggling LOG_LEVEL=debug. When result.response is non-string the
                // route's emit paths ALL coerce to '[object Object]' (operator-
                // precedence bug at L1889) and the user sees a stream with zero
                // content chunks despite 27.7s of pre-Response setup.
                chatLogger.info('[CHAT-ROUTE] processUnifiedAgentRequest returned', {
                  requestId,
                  responseType: typeof result.response,
                  responseShapeKey: shapeKeyOf(result.response),
                  responseLen: serializableTextLength(result.response),
                  bufferLen: streamState.buffer.length,
                  elapsedMs: Date.now() - requestStartTime,
                });
                sendStep(`Iteration ${iteration + 1}`, result.success ? 'completed' : 'failed');

                // Accumulate this iteration's result.
                // (route-layer catch-all — Layer 3 of 3 per content-stringifier.ts JSDoc)
                //
                // Defense-in-depth: route the buffer+result.response concat
                // through explicit type-narrowed variables. Non-string shapes
                // (e.g. {role, parts:[…]} MessageContent, ContentPart arrays)
                // are coerced via stringifyMessageContent — never fall through
                // to `'[object Object]'`. Cheap O(n).
                const bufferText = typeof streamState.buffer === 'string' ? streamState.buffer : '';
                const responseText = typeof result.response === 'string' ? result.response : stringifyMessageContent(result.response);
                const iterContent = bufferText + responseText;
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
                  // Q3 fix: type-narrowed `typeof === 'string'` defensive so
                  // the diagnostic block survives a non-string `result.response`
                  // (currently the parent's `iterContent.endsWith(result.response)`
                  // guard saves it, but the guard is implicit and a future
                  // refactor could regress). The previous `?.length ?? 0` was
                  // partial-truth on arrays (returns element count, not 0);
                  // this narrowing collapses all non-string paths to a clean 0.
                  resultResponseLen:
                    typeof result.response === 'string'
                      ? result.response.length
                      : 0,
                  // Q3 separate payload fields — see comment on the predicate above.
                  iterContentRawEndsWith: iterContent.endsWith(result.response),
                  // Q2 fallback: defensive `?? ''` keeps the endsWith contract
                  // stable when result.response is non-string at this log point.
                  iterContentTrimmedEnds: iterContent.trimEnd().endsWith(result.response ?? ''),
                  // Q1 fix: runtime-survival ternary so the comment's "fallback
                  // to generateSecureId() if @types/node misses" promise is
                  // actually implemented. Next.js edge runtime or future
                  // browser/Worker bundling will silently break the unconditional
                  // `crypto.randomUUID()` call otherwise.
                  // Q2 rename: `_id` → `_event_id` to match the actual per-hit
                  // semantics (a NEW UUID is minted EVERY time this boundary
                  // divergence fires — it is NOT the request ID). Downstream
                  // log-search tooling that joins on this field should treat
                  // it as one event-record-per-fire, not one per-request.
                  boundary_divergence_event_id: crypto?.randomUUID?.() ?? generateSecureId('bdiv'),
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
                  // ARCH-001 Flag 1 (Pickup): `UnifiedAgentResult` now subsumes
                  // `AutoContinueResultData` — the 3 helper-derived fields
                  // (`errors`/`toolFailures`/`incompleteSignals`) are optional
                  // on both, so the upstream cast hop is no longer required.
                  // Runtime identical: `decideAutoContinue`'s `_enrichResultData`
                  // populates the 3 arrays from `steps` + `responseText` BEFORE
                  // the detectors run, so detectors see a fully-shaped
                  // `AutoContinueResultData` regardless of the caller's
                  // pre-population status. Mirror site: unified-agent-service.ts:1712.
                  result,
                  advancedDetectorFn: needsMoreTurnsDetector,
                });

                // Hoisted (dedup): shared between the [AUTO-CONTINUE] log payload
                // (computed before the `if (autoDecision.continue)` branch so the
                // empty-follow-up audit field stays a forward-precise metric, not
                // an inferred-from-responseLength approximation) and the
                // conversationHistory assistant-message append below.
                const previousAssistantContent = typeof result.response === 'string'
                  ? result.response
                  : (iterContent || '');
                // Single source of truth: lives next to its only consumer so it is not
                // computed on no-continue iterations. If a future out-of-branch
                // telemetry needs it, hoist + add a JSDoc anchoring the invariant.
                const isPreviousAssistantEmpty =
                  previousAssistantContent.length === 0 ||
                  previousAssistantContent.trim() === '';
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
                  emit(SSE_EVENT_TYPES.AUTO_CONTINUE, {
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
              // Post-loop: extract any final edits from the LAST iteration's buffer
              // and apply session naming detection. The loop already handled VFS
              // writes and step accumulation; this block runs once after the loop.
              const finalEdits = extractIncrementalFileEdits(streamState.buffer, streamState.parser);

              // SESSION NAMING: Detect if this is a new single-folder workspace
              // (route-layer catch-all — Layer 3 of 3 per content-stringifier.ts JSDoc)
              //
              // Defense-in-depth: route the buffer+result.response concat
              // through explicit type-narrowed variables. Non-string shapes
              // (e.g. {role, parts:[…]} MessageContent, ContentPart arrays)
              // are coerced via stringifyMessageContent — never fall through
              // to `'[object Object]'`. Cheap O(n).
              const bufferText = typeof streamState.buffer === 'string' ? streamState.buffer : '';
              const responseText = typeof result.response === 'string' ? result.response : stringifyMessageContent(result.response);
              const responseContent = bufferText + responseText;
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
                result.fileEdits = accumulatedFileEdits;
                result.metadata = result.metadata || {};
                result.metadata.appliedEditCount = accumulatedEditCount.applied;
                result.metadata.extractedEditCount = accumulatedEditCount.extracted;
                result.metadata.iterationCount = iteration + 1;
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
                } catch (editErr: any) {
                  chatLogger.warn('Final parse: filesystem edit application failed', {
                    error: editErr.message
                  });
                }
              }

              // Collect file edits into result for the done event
              if (accumulatedFileEdits.length > 0) {
                // UnifiedAgentResult.fileEdits is typed as FileEdit[]; assign the
                // accumulated array directly (any[] is assignable to FileEdit[]).
                // Counts are surfaced via result.metadata below.
                result.fileEdits = accumulatedFileEdits;
              }
              result.metadata = result.metadata || {};
              result.metadata.appliedEditCount = accumulatedEditCount.applied;
              result.metadata.extractedEditCount = accumulatedEditCount.extracted;
              result.metadata.iterationCount = iteration + 1;
              if (accumulatedSteps.length > 0) {
                result.steps = accumulatedSteps;
              }

              // Prefer the server-cleaned response (markers stripped, simulated-turn
              // truncation applied) over the raw streaming buffer.
              const finalContent = (typeof result.response === 'string' && result.response.trim())
                ? result.response
                : streamState.buffer;

              // NOTE: Auto-continue evaluation is now performed inside the loop
              // above (per-iteration `shouldAutoContinue` call). The loop surfaces
              // `result.metadata.continuationDecision` on the break path so the
              // client sees the decision in the DONE event. This site is no longer
              // needed — the second evaluation here was dead-weight that produced
              // the same result and risked overwriting the loop's metadata with a
              // stale snapshot.

              emit(SSE_EVENT_TYPES.DONE, {
                success: result.success,
                content: finalContent,
                messageMetadata: {
                  agent: 'unified',
                  mode: result.mode,
                  processingSteps,
                  // Include routing metadata so client can auto-continue multi-step flows
                  ...(result.metadata?.routing ? { routing: result.metadata.routing } : {}),
                  ...(result.metadata?.continuationDecision
                    ? { continuationDecision: result.metadata.continuationDecision }
                    : {}),
                },
                data: result,
              });

              // Cleanup: Clear streaming buffer to free memory
              streamState.buffer = '';
              streamState.parser.emittedEdits.clear();
              streamState.parser.unclosedPositions.clear();
            } catch (error: any) {
              // Clean up the continuation counter on error so it doesn't leak.
              clearContinuationCount(requestId);
              // FINAL PARSE ON ERROR TOO: Try to extract any complete edits before clearing
              if (streamState.buffer.trim().length > 0) {
                try {
                  streamState.parser.emittedEdits.clear();
                  streamState.parser.unclosedPositions.clear();
                  const finalEdits = extractIncrementalFileEdits(streamState.buffer, streamState.parser);
                  for (const edit of finalEdits) {
                    // Validate path before emitting (even in error handler)
                    if (!isValidFilePath(edit.path)) {
                      chatLogger.debug('Skipping invalid path from finalEdits (error handler)', { path: edit.path });
                      continue;
                    }
                    // CRITICAL FIX: Skip empty content to prevent infinite loops (even in error handler)
                    const editContent = edit.content || edit.diff || '';
                    if (!editContent || editContent.trim().length === 0) {
                      chatLogger.debug('Skipping empty edit from finalEdits (error handler, prevents infinite loop)', { path: edit.path });
                      continue;
                    }
                    // CRITICAL FIX: Determine operation type and send correct data format
                    const isPatch = edit.action === 'patch' || !!edit.diff;
                    emit(SSE_EVENT_TYPES.FILE_EDIT, {
                      path: edit.path,
                      status: 'detected',
                      operation: isPatch ? 'patch' : 'write',
                      timestamp: Date.now(),
                      content: edit.content || '',
                      diff: isPatch ? (edit.diff || '') : undefined,
                    });
                  }
                } catch (parseError: unknown) {
                  // Ignore parse errors during error handling
                }
              }

              emit(SSE_EVENT_TYPES.ERROR, { message: error.message || 'Agentic execution failed' });

              // Cleanup on error too
              streamState.buffer = '';
              streamState.parser.emittedEdits.clear();
              streamState.parser.unclosedPositions.clear();
            } finally {
              clearInterval(stallWatchdog);
              controller.close();
            }
          },
          // The runtime's cancel() transitions this stream to "closed"
          // automatically per the WHATWG Streams spec — no explicit
          // controller.close() needed (and the controller is the start()
          // parameter, not in scope in cancel() anyway). We just record
          // the disconnect as signal-class telemetry. Note: closing the
          // SSE pipe makes the client see [DONE] immediately.
          cancel(reason?: unknown) {
            chatLogger.info('SSE stream cancelled by client disconnect', {
              requestId,
              reason: typeof reason === 'string' ? reason : (reason instanceof Error ? reason.message : String(reason)),
            });
          },
        });

        // Conditional `x-stall-fired` + `x-stall-reason` headers —
        // if the watchdog fires MID-stream (after at least one chunk has
        // been emitted to the client), the HTTP status is structurally
        // locked at 200 by the live SSE Response (Next.js cannot rewrite
        // a streaming-Response status after headers flush). The headers
        // are the only channel available to expose "this stream was
        // aborted by a server-side watchdog" to upstream proxies +
        // observability pipelines + clients that parse response trailers.
        const responseHeaders: Record<string, string> = {
          ...SSE_RESPONSE_HEADERS,
          ...(stallDidFire
            ? {
                'x-stall-fired': 'true',
                'x-stall-reason': stallDidFireReason ?? 'unknown',
              }
            : {}),
        };
        return new Response(streamBody, { headers: responseHeaders });
      }

      // Check if custom orchestration mode is selected via header
      // This applies to ALL chat requests, not just integration pipeline requests
      // Bug #63 (Pass-3 follow-up) — the `getOrchestrationModeFromRequest`
      // helper from `@bing/shared/agent` declares its own `NextRequest` type
      // which has an incompatible `nextUrl` shape with the local `NextRequest`
      // imported from `next/server`. Casting to the helper's accepted shape
      // via `as unknown as` is the least-invasive workaround that keeps the
      // call site semantically correct (the helper only reads a header, not
      // the full request body). TODO long-term: align the two NextRequest
      // types in the shared package so no cast is needed.
      const orchestrationMode = getOrchestrationModeFromRequest(request as unknown as Parameters<typeof getOrchestrationModeFromRequest>[0]);

      if (orchestrationMode !== 'task-router') {
        // User has selected a custom orchestration mode
        chatLogger.info('Custom orchestration mode selected', { 
          mode: orchestrationMode,
          requestId,
        });

        const orchestrationResult = await executeWithOrchestrationMode(orchestrationMode, {
          task: task,  // User task only — filesystem context already in conversationHistory
          sessionId: resolvedConversationId,
          ownerId: authenticatedUserId || filesystemOwnerId,
          stream: stream === true,
          model: normalizedModel,
          workspacePath: `workspace/sessions/${resolvedConversationId}`,
          tools: config.tools,
          executeTool: config.executeTool,
        });

        if (stream === true) {
          // Return streaming response for custom orchestration modes
          const encoder = new TextEncoder();
          const streamBody = new ReadableStream({
            async start(controller) {
              const enqueue = (eventType: string, data: Record<string, unknown>) => {
                try {
                  controller.enqueue(encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify({ ...data, timestamp: Date.now() })}\n\n`));
                } catch {
                  // Stream may be closed — ignore
                }
              };

              try {
                // Send initial metadata
                enqueue('init', {
                  agent: 'orchestrator',
                  currentAction: `Running in ${orchestrationMode} mode`,
                  mode: orchestrationMode,
                });

                // Send response content
                if (orchestrationResult?.response) {
                  enqueue('token', {
                    content: orchestrationResult?.response ?? "",
                  });
                }

                // Send completion
                enqueue('done', {
                  success: orchestrationResult?.success ?? false,
                  content: orchestrationResult?.response ?? "",
                  metadata: orchestrationResult?.metadata ?? null,
                });

                controller.close();
                // Clean up the continuation counter on success so it doesn't leak.
                clearContinuationCount(requestId);
              } catch (error: any) {
                enqueue('error', { message: error.message });
                controller.close();
                // Clean up the continuation counter on error so it doesn't leak.
                clearContinuationCount(requestId);
              }
            },
            cancel(reason?: unknown) {
              chatLogger.info('SSE stream cancelled by client disconnect', {
                requestId,
                reason: typeof reason === 'string' ? reason : (reason instanceof Error ? reason.message : String(reason)),
              });
            },
          });

          // Same `x-stall-fired` + `x-stall-reason` propagation as the
          // L2494 site (different branch — Mastra ToolLoopAgent
          // streaming). Duplicated deliberately (each branch
          // self-contained) to avoid LET/HOIST churn at the route level.
          const responseHeaders: Record<string, string> = {
            ...SSE_RESPONSE_HEADERS,
            ...(stallDidFire
              ? {
                  'x-stall-fired': 'true',
                  'x-stall-reason': stallDidFireReason ?? 'unknown',
                }
              : {}),
          };
          return new Response(streamBody, { headers: responseHeaders });
        }

        // Non-streaming response
        return NextResponse.json({
          success: orchestrationResult?.success ?? false,
          content: orchestrationResult?.response ?? "",
          data: orchestrationResult,
        });
      }

      // Default: Use existing unified agent flow (task-router mode)
      // This is the fallback when no custom orchestration mode is selected
      // FIX: Skip when AGENT_EXECUTION_ENGINE='v1-agent-loop' — fall through to direct Mastra path
      chatLogger.debug('[ROUTE-DEBUG] About to call processUnifiedAgentRequest', { agentExecutionEngine: AGENT_EXECUTION_ENGINE });
      chatLogger.debug('[ROUTE-DEBUG] enableFilesystemEdits BEFORE call', { enableFilesystemEdits });
      if (AGENT_EXECUTION_ENGINE !== 'v1-agent-loop') {
        // Chat-hang-fix #2: pre-stream boundary #3 (non-streaming/v1-fallback
        // branch). Pair with boundary #1 (post-logRequestStart) and boundary
        // #2 (post-5way-promise-all). Together they localize which phase
        // crossed last in a hang report: logRequestStart DB write, the 5-way
        // promise.all (denials / wsCtx / mem0 / hybrid / v1Prompt), or the
        // processUnifiedAgentRequest call itself. Engine label matches the
        // v1-streaming branch's "Calling processUnifiedAgentRequest (v1
        // streaming)" entry so a log-search can group both pre-call entries
        // by phase regardless of branch.
        chatLogger.info('[CHAT-ROUTE] boundary: pre-processUnifiedAgentRequest (v1 non-streaming)', {
          requestId,
          elapsedMs: Date.now() - requestStartTime,
          agentExecutionEngine: AGENT_EXECUTION_ENGINE,
          ...getBrokerDiagnostics(),
        });
        // Chat-hang-fix #3 — non-streaming branch stall wiring.
        let result: Awaited<ReturnType<typeof processUnifiedAgentRequest>>;
        try {
          try {
            result = await Promise.race([
              processUnifiedAgentRequest(config),
              stallPromise,
            ]);
          } catch (raceErr: any) {
            // Bug #X (non-streaming race-winner 524): if the race
            // winner is the stall promise, return 524 directly. The
            // original 200 fallback masked timeouts from upstream load
            // balancers. We exclude `'Chat route aborted'` here — that
            // is a user-initiated abort, NOT a server-side stall, so
            // 524 from the client cancel path would be misleading
            // (clients expect the normal stop-button semantics).
            //
            // Detection rule (refactored — typed discriminator as PRIMARY):
            // 1. PRIMARY (native SDK path only): raceErr instanceof
            //    StallWatchdogError. The typed class fired by fireStall
            //    at L1617-L1626 is threaded through agentTurnAbort.signal
            //    .reason; native SDK abort paths preserve the original
            //    instance and surface it as the throw value. NOTE:
            //    SDKs that wrap the abort throw (Vercel AI SDK creates
            //    a new wrapper) BREAK the instanceof check — that is
            //    why the substring fallback (#2) below is mandatory.
            // 2. FALLBACK (defense-in-depth): error.message starts with
            //    `'Chat route stall watchdog'` (the fireStall factory's
            //    exact emit format) — survives even if a future refactor
            //    accidentally drops the typed instance on the abort signal.
            // 3. OR-arm: raceErr.message === `'Chat route aborted'` AND
            //    stallDidFire === true — catches the race where rejectOnAbort
            //    (L1642-L1647) wins the rejection before fireStall's.
            //    User-initiated aborts (no preceding stall) fall through to
            //    throw — clients expect normal stop-button semantics, not 524.
            const msgRaw =
              raceErr instanceof Error ? raceErr.message : String(raceErr);
            // Bug #X (non-streaming race-winner 524): if the race
            // winner is the stall promise, return 524 directly. The
            // original 200 fallback masked timeouts from upstream load
            // balancers.
            //
            // Belt-and-suspenders canonical detection (post STALL-524 close):
            // only `raceErr instanceof StallWatchdogError` is canonical.
            // The previous substring fallback (`msgRaw.startsWith('Chat route
            // stall watchdog')`) AND the abort-during-watchdog OR-arm
            // (`msgRaw === 'Chat route aborted' && stallDidFire`) were retired.
            // The outer catch at L5392 uses the SAME `instanceof` check as
            // the canonical detection site if anything leaks through here.
            // SDKs that wrap the abort throw (Vercel AI SDK) bubble up
            // naturally to the outer instanceof check, so a substring sniff
            // that the typed-discriminator no longer promises is unneeded.
            //
            // Trade-off the user explicitly accepted: a user cancel that
            // races an in-flight watchdog will now reach the outer catch
            // as a plain `Error('Chat route aborted')` (NOT a
            // `StallWatchdogError` instance). Outer-caught
            // errorHandler.processError fallthrough returns 500. Operationally
            // acceptable since `fireStall` sets `stallDidFire = true`
            // synchronously BEFORE `agentTurnAbort.abort(stallErr)`, so the
            // typing-vs-abort race is bounded to one tick.
            const isServerStall =
              typeof msgRaw === 'string' &&
              raceErr instanceof StallWatchdogError;
            if (isServerStall) {
              clearInterval(stallWatchdog);
              const reason = stallDidFireReason ?? 'race-winner-stall';
              chatLogger.warn(
                '[CHAT-ROUTE] Non-streaming 524 — race winner is the stall',
                { requestId, reason, msg: msgRaw },
              );
              return addAnonSessionCookie(
                NextResponse.json(
                  {
                    error: msgRaw,
                    reason,
                    requestId,
                    stitchedFromWatchDog: true,
                  },
                  {
                    status: 524,
                    headers: {
                      'content-type': 'application/json',
                      'x-stall-fired': 'true',
                      'x-stall-reason': reason,
                    },
                  },
                ),
              );
            }
            throw raceErr;
          }
        } finally {
          clearInterval(stallWatchdog);
        }
        chatLogger.debug('[ROUTE-DEBUG] processUnifiedAgentRequest returned', { resultSuccess: result.success, hasResponse: !!result.response });

        // GUARANTEED debug field — always appears if this code path is reached
        const debugInfo = {
          enableFilesystemEdits,
          agentExecutionEngine: AGENT_EXECUTION_ENGINE,
          resultSuccess: result.success,
          hasResponse: !!result.response,
          responseLength: result.response?.length || 0,
        };
        chatLogger.debug('[ROUTE-DEBUG] debugInfo', { ...debugInfo });

        // FIX: Extract and apply file edits from the LLM response text.
        // The LLM may output code blocks, diffs, or write_file instructions
        // that need to be parsed and written to the VFS.
        // This bridges the gap between v1-api chat mode and actual file creation.
        let appliedEdits = null;
        chatLogger.debug('[FILE-EDIT-DEBUG] before apply', { enableFilesystemEdits, resultSuccess: result.success, responseLength: result.response?.length });
        // Bug #48: pre-populate the shared alreadyWrittenPaths Set from v1 result
        // sources (result.fileEdits, result.steps, _writtenPaths) so site 1833
        // shares state with the other 8 call sites. This block runs only in the
        // v1 chat path where `result` is available; the other 8 sites get their
        // paths from the streaming tool invocation loop or don't need them
        // (V2 gateway/local fallback paths use different code paths entirely).
        if (result.success && result.response) {
          for (const fe of (result.fileEdits || [])) {
            addWrittenPath(alreadyWrittenPaths, fe?.path, requestedScopePath);
          }
          for (const s of (result.steps || [])) {
            const toolName = s?.toolName;
            if (!toolName) continue;
            if (toolName === 'file.batch_write' || toolName === 'batch_write') {
              for (const f of (s.args?.files || [])) {
                addWrittenPath(alreadyWrittenPaths, f?.path, requestedScopePath);
              }
            } else if (toolName === 'file.write' || toolName === 'write_file' ||
                       toolName === 'file.str_replace' || toolName === 'file.append') {
              addWrittenPath(alreadyWrittenPaths, s.args?.path, requestedScopePath);
            }
          }
          for (const wp of ((result as any)._writtenPaths || [])) {
            addWrittenPath(alreadyWrittenPaths, wp, requestedScopePath);
          }
        }

        if (result.success && result.response && enableFilesystemEdits) {
          try {
            chatLogger.debug('[FILE-EDIT-DEBUG] Calling applyFilesystemEditsFromResponse, response preview', { responsePreview: result.response.slice(0, 200) });
            appliedEdits = await applyFilesystemEditsFromResponse({
              ownerId: filesystemOwnerId,
              conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
              requestId: requestId || `v1-${Date.now()}`,
              scopePath: requestedScopePath,
              lastUserMessage: typeof lastUserMessage === 'string' ? lastUserMessage : '',
              attachedPaths: attachedFilesystemFiles.map((f) => f.path),
              responseContent: result.response,
              commands: {},
              forceExtract: true,
              // Bug #48: unified shared Set — pre-populated from result.fileEdits,
              // result.steps, and _writtenPaths below (see Bug #48 block above
              // the call). This site now shares state with the other 8 call sites
              // so streaming tool writes captured during the loop are visible here too.
              alreadyWrittenPaths,
            });

            chatLogger.debug('[FILE-EDIT-DEBUG] appliedEdits', {
              applied: appliedEdits?.applied?.length,
              pending: appliedEdits?.pendingEdits?.length,
              errors: appliedEdits?.errors?.length,
            });

            if (appliedEdits?.applied?.length) {
              chatLogger.info('File edits extracted from v1-api response', {
                requestId,
                editCount: appliedEdits.applied.length,
                edits: appliedEdits.applied.map((e: any) => ({ path: e.path, operation: e.operation })),
              });
            } else {
              chatLogger.warn('No file edits extracted from v1-api response — response has no parseable file edits');
            }

            // Bug #48: pending edits from paths already written by structured
            // tool calls are staged for LLM review on the next turn.
            if (appliedEdits?.pendingEdits?.length) {
              const pendingSummary = appliedEdits.pendingEdits
                .map((pe: any) => `  - ${pe.type} for "${pe.path}" (${pe.content.length} chars)`)
                .join('\n');
              result.response = (result.response || '') +
                `\n\n[STEER] The following ${appliedEdits.pendingEdits.length} text-mode edit(s) targeted files already written by tool calls and were NOT applied. Reply with 'apply all', 'discard all', or specify which to apply by path:\n` +
                pendingSummary;
              chatLogger.info('[PARSER] Bug #48: pending edits staged for LLM review', {
                requestId,
                pendingCount: appliedEdits.pendingEdits.length,
                paths: appliedEdits.pendingEdits.map((pe: any) => pe.path),
              });
            }
          } catch (parseError: any) {
            chatLogger.error('Failed to extract file edits from v1-api response', {
              requestId,
              error: parseError.message,
            });
            chatLogger.debug('[FILE-EDIT-DEBUG] Error', { errorMessage: parseError.message, stack: parseError.stack?.slice(0, 500) });
          }
        } else {
          chatLogger.debug('[FILE-EDIT-DEBUG] SKIPPED', { enableFilesystemEdits, success: result.success, hasResponse: !!result.response });
        }

        return NextResponse.json({
          success: result.success,
          content: result.response,
          data: {
            ...result,
            appliedEdits: appliedEdits
              ? { count: appliedEdits.applied?.length || 0, paths: appliedEdits.applied?.map((e: any) => e.path) || [] }
              : null,
            _debug: debugInfo,
          },
        });
      }

    // Sandbox actions require authenticated user identity for authorization and ownership checks.
    // VFS MCP tools are handled inline via Vercel AI SDK tool calling and don't need this gate.
    if (requestType === 'sandbox' && !authenticatedUserId) {
      return NextResponse.json({
        success: false,
        status: 'auth_required',
        error: {
          type: 'auth_required',
          message: 'Sandbox actions require authentication. Please log in first.'
        }
      }, { status: 401 });
    }

    // PRIORITY-BASED ROUTING - Routes through Fast-Agent → n8n → Custom Fallback → Original System
    // Providers that use Vercel AI SDK and support native tool calling
    const VERCEL_AI_PROVIDERS = new Set([
      'openai', 'anthropic', 'google', 'mistral', 'openrouter',
      'chutes', 'github', 'zen', 'nvidia', 'together', 'groq',
      'fireworks', 'anyscale', 'deepinfra', 'lepton',
    ]);

    const routerRequest = {
      messages: contextualMessages,
      provider,
      model: normalizedModel, // Use normalized model name
      temperature,
      maxTokens,
      stream,
      apiKeys,
      requestId,
      userId: authenticatedUserId || filesystemOwnerId, // Use filesystem owner for VFS tools when not authenticated
      // For filesystem operations (including spec enhancement background refinement),
      // use the resolved filesystem owner ID which handles anonymous users correctly
      filesystemOwnerId: filesystemOwnerId,
      // Include conversation ID for spec enhancement filesystem edits
      conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
      // Spec enhancement mode from client
      specMode: (body as any)?.specMode,
      specChain: (body as any)?.specChain,
      // Pass scopePath for session-scoped file operations
      scopePath: requestedScopePath,
      // Keep these tri-state so router-level detection can still route specialized endpoints.
      // `false` means "explicitly disable", `undefined` means "auto-detect".
      // CRITICAL FIX: Enable tools by default for ALL users (authenticated + anonymous).
      // authenticatedUserId is only set for non-anonymous users, but filesystemOwnerId
      // covers both. VFS MCP tools (write_file, read_file, apply_diff) need this enabled.
      enableTools: !!(authenticatedUserId || filesystemOwnerId),
      enableSandbox: requestType === 'sandbox' ? !!(authenticatedUserId || filesystemOwnerId) : undefined,
      enableComposio: requestType === 'tool' ? !!(authenticatedUserId || filesystemOwnerId) : undefined,
      mode: body.mode || 'enhanced', // Add mode from request
      // When Vercel AI SDK handles tool calling natively, skip regex intent parsing
      nativeToolCalling: VERCEL_AI_PROVIDERS.has(provider) && !!(authenticatedUserId || filesystemOwnerId),
      // Context pack: bundle workspace files into LLM-readable format
      contextPack: contextPack ? {
        ...contextPack,
        // Pass @mentioned files as include patterns for highest priority
        includePatterns: explicitFilesFromMentions.length > 0
          ? [...(contextPack.includePatterns || []), ...explicitFilesFromMentions]
          : contextPack.includePatterns,
      } : undefined,
      // Auto-attach relevant files as agent discovers areas to edit
      autoAttachFiles,
      // Pass abort signal for cancellation support
      // Note: request.signal may be undefined on older Node.js versions (< 20)
      // In that case, only the server-side timeout will provide cancellation
      signal: (request as any).signal,
      // Server-side timeout (90s) to prevent hanging on unresponsive providers
      timeoutMs: 90000,
    };

    chatLogger.debug('Routing request through priority chain', { requestId, provider, model }, {
      requestType,
      enableTools: routerRequest.enableTools,
      enableSandbox: routerRequest.enableSandbox,
      enableComposio: routerRequest.enableComposio,
      mode: routerRequest.mode,
    });

    // Route through priority chain with spec amplification (V1 mode only)
    // Track actual provider/model for telemetry (may differ from requested due to fallbacks)
    actualProvider = provider;
    actualModel = normalizedModel;

    // Use a mutable ref for emit - will be set when stream starts
    const emitRef: { current: ((event: string, data: any) => void) | null } = { current: null };
    let acceptDeferredEvents = true;

    // Placeholder emit that stores events until real emit is available
    interface PendingEvent {
      event: string;
      data: any;
      timestamp: number;
    }
    const pendingEvents: PendingEvent[] = [];
    let pendingEventsDropped = false;
    const placeholderEmit = (event: string, data: any) => {
      if (!acceptDeferredEvents) {
        return;
      }
      if (emitRef.current) {
        emitRef.current(event, data);
      } else if (pendingEvents.length < MAX_PENDING_EVENTS) {
        pendingEvents.push({ event, data, timestamp: Date.now() });
      } else if (!pendingEventsDropped) {
        // Log warning only once to avoid spam
        pendingEventsDropped = true;
        chatLogger.warn('Pending event buffer full, events being dropped', {
          requestId,
          maxEvents: MAX_PENDING_EVENTS,
        });
      }
    };

    try {
      let unifiedResponse

      // Spec amplification only works with V1 mode (regular LLM calls)
      // V2 agent mode has its own planning system
      // CRITICAL: Use standard routing - spec amplification handled post-stream
      if (agentMode === 'v2') {
        chatLogger.debug('V2 agent mode, using standard routing without spec amplification', { requestId })
        unifiedResponse = await responseRouter.routeAndFormat(routerRequest)
      } else if (stream && SPEC_AMPLIFICATION_STREAM_EVENTS_ENABLED) {
        // For streaming, use standard routing - spec amplification triggered post-stream if code detected
        chatLogger.debug('V1 mode with streaming, using standard routing + later spec amplification)', { requestId })
        unifiedResponse = await responseRouter.routeAndFormat(routerRequest)

        // Check if response has streaming generator (real-time LLM streaming)
        if (unifiedResponse.stream && typeof unifiedResponse.stream === 'object' && Symbol.asyncIterator in unifiedResponse.stream) {
          chatLogger.info('Received streaming response with generator, will consume chunks in real-time', { requestId })
          // The stream generator will be consumed below in the streaming section
        }
      } else {
        // V1 mode or auto - use standard routing (spec amplification handled post-stream)
        unifiedResponse = await responseRouter.routeAndFormat(routerRequest)
      }

      // Extract actual provider/model from response metadata (after fallbacks)
      // CRITICAL: Use data.provider as fallback (set by response-router from metadata)
      // instead of unifiedResponse.source (which is just the routing priority name like 'original-system')
      actualProvider = unifiedResponse.metadata?.actualProvider ||
                       unifiedResponse.data?.provider ||
                       (unifiedResponse.source !== 'original-system' && unifiedResponse.source !== 'unknown'
                         ? unifiedResponse.source
                         : provider); // Fall back to the originally requested provider
      actualModel = unifiedResponse.metadata?.actualModel ||
                    unifiedResponse.data?.model ||
                    routerRequest.model;

      // Note: Provider/model logging happens in streaming and non-streaming response paths
      // to show the actual LLM provider used (not 'original-system' which is just the router source)
      // Log fallback chain for debugging provider failover
      if (unifiedResponse.metadata?.fallbackChain && unifiedResponse.metadata.fallbackChain.length > 0) {
        chatLogger.debug('Provider fallback chain used', { 
          requestId, 
          fallbackChain: unifiedResponse.metadata.fallbackChain,
          finalProvider: actualProvider 
        });
      }

      chatLogger.debug('Starting filesystem edits processing', { requestId });

      // Check for auth_required in response
      if (unifiedResponse.data?.requiresAuth && unifiedResponse.data?.authUrl) {
        return NextResponse.json({
          status: 'auth_required',
          authUrl: unifiedResponse.data.authUrl,
          toolName: unifiedResponse.data.toolName,
          provider: unifiedResponse.data.provider || 'unknown',
          message: `Please authorize ${unifiedResponse.data.toolName} to continue`
        }, { status: 401 });
      }

      let rawResponseContent = unifiedResponse.content || '';

      // CRITICAL FIX: Declare filesystemEdits at function scope to avoid "before initialization" errors
      // This variable is used in both streaming and non-streaming paths, including fallback scenarios
      let filesystemEdits: Awaited<ReturnType<typeof applyFilesystemEditsFromResponse>> | null = null;
      
      // CRITICAL FIX: Declare streamedEdits at function scope for regular LLM streaming path
      // This is assigned inside the stream completion handler and used in spec amp check
      let streamedEdits: Awaited<ReturnType<typeof applyFilesystemEditsFromResponse>> | null = null;
      
      // CRITICAL FIX: Declare finalContent at function scope for streaming path
      // This is assigned inside the stream and used in spec amp check
      let finalContent: string = '';
      
      // CRITICAL FIX: Declare allEdits at function scope for both streaming paths
      // This is assigned during final parse and used in done event + spec amp check
      let allEdits: Awaited<ReturnType<typeof applyFilesystemEditsFromResponse>> | null = null;
      
      // CRITICAL FIX: Declare clientResponse early to avoid "used before declaration" errors
      // It's needed for spec amplification checks that run before the build call
      let clientResponse: any = null;

      // CRITICAL FIX: Declare streamRequestId at function scope to avoid TDZ errors
      // in nested closures (agentic path, fallback streaming path)
      let streamRequestId: string = requestId || '';
      

      const lastUserMessage =
        [...messages].reverse().find((m) => m.role === 'user')?.content;
      const v1AgentTask = typeof lastUserMessage === 'string'
        ? lastUserMessage
        : JSON.stringify(lastUserMessage || '');
      const v1AgentContext = buildAgenticContext(contextualMessages);
      // FIX: Do NOT prepend filesystem context to the task — the LLM already sees it
      // via contextualMessages in conversationHistory. Prepending it caused the
      // StatefulAgent/BootstrappedAgency to receive the system prompt as the task,
      // leading it to write "SYSTEM: Virtual filesystem tools..." to a file.
      const v1AgentPrompt = v1AgentTask;

      // V1 agentic tools: reuse existing Mastra tool loop for coding/tool requests.
      let agentToolResults = null;
      let agentToolStreamingResult: any = null;

      const shouldRunV1AgentLoop =
        LLM_AGENT_TOOLS_ENABLED &&
        enableFilesystemEdits &&
        !!v1AgentTask &&
        // When AGENT_EXECUTION_ENGINE='v1-agent-loop', always run the v1 agent-loop path
        // regardless of requestType/agentMode/isCodeRequest detection
        (AGENT_EXECUTION_ENGINE === 'v1-agent-loop' ||
          requestType === 'tool' || (agentMode !== 'v2' && isCodeRequest));

      if (shouldRunV1AgentLoop) {
        try {
          const effectiveAgentUserId = authenticatedUserId || filesystemOwnerId;
          const executionPolicy = determineExecutionPolicy({
            task: v1AgentTask,
            requiresBash:
              requestType === 'sandbox' ||
              /\b(run|execute|test|build|install|start|serve|bash|shell|terminal|pnpm|npm|yarn|pip)\b/i.test(v1AgentTask),
            requiresFileWrite: isCodeRequest,
            requiresBackend: /\b(api|server|backend|database|migration|postgres|mysql|redis)\b/i.test(v1AgentTask),
          });

          let sandboxSession: Awaited<ReturnType<typeof sandboxBridge.getOrCreateSession>> | null = null;
          if (authenticatedUserId && executionPolicy !== 'local-safe') {
            // Gap-fix: thread the full ownerResolution (not just filesystemOwnerId)
      // so the bridge has access to the auth source / isAuthenticated /
      // anonSessionId for source-aware sandboxing decisions.
      sandboxSession = await sandboxBridge.getOrCreateSession(
        authenticatedUserId,
        undefined,
        ownerResolution,
      );
          }

          chatLogger.info('Executing v1 agentic tools', { requestId, userId: effectiveAgentUserId }, {
            scopePath: requestedScopePath,
            maxIterations: LLM_AGENT_TOOLS_MAX_ITERATIONS,
            requestType,
            isCodeRequest,
            executionPolicy,
            hasSandbox: !!sandboxSession,
          });

          const agentLoop = createAgentLoop(
            effectiveAgentUserId,
            requestedScopePath || 'workspace',
            LLM_AGENT_TOOLS_MAX_ITERATIONS,
            {
              sandboxId: sandboxSession?.sandboxId,
              sandboxProvider: sandboxSession?.sandboxId
                ? (sandboxBridge.inferProviderFromSandboxId(sandboxSession.sandboxId) || undefined)
                : undefined,
              workspacePath: sandboxSession?.workspacePath || requestedScopePath,
            },
            actualModel, // user-selected model
          );

          // Check if agent supports streaming (ToolLoopAgent integration)
          const supportsStreaming = 'executeTaskStreaming' in agentLoop;

          if (supportsStreaming && stream) {
            // Use streaming execution for real-time tool invocations and reasoning
            chatLogger.info('Using ToolLoopAgent streaming execution', { requestId, provider: actualProvider, model: actualModel });

            // Store streaming result for later processing in stream handler
            agentToolStreamingResult = {
              agentLoop,
              task: v1AgentPrompt,
              timeout: LLM_AGENT_TOOLS_TIMEOUT_MS,
            };
          } else {
            // Use non-streaming execution (backward compatible)
            // Set timeout for agent execution with proper cleanup
            let agentTimeoutId: NodeJS.Timeout | null = null;
            const agentPromise = agentLoop.executeTask(v1AgentPrompt);
            const timeoutPromise = new Promise((_, reject) => {
              agentTimeoutId = setTimeout(() => reject(new Error('Agent tools timeout')), LLM_AGENT_TOOLS_TIMEOUT_MS);
            });

            try {
              agentToolResults = await Promise.race([agentPromise, timeoutPromise]) as any;
            } finally {
              if (agentTimeoutId) clearTimeout(agentTimeoutId);
              // Chat-hang-fix #3 polish: clear the hoisted route-level
              // watchdog here too. The executeTask timeoutPromise is
              // the localized ceiling for the v1-agent-loop branch;
              // once it resolves/rejects, this is the canonical point
              // to release the global stallWatchdog interval so it
              // doesn't outlive the request.
              clearInterval(stallWatchdog);
            }

            chatLogger.info('Agent tools execution completed', { requestId }, {
              success: agentToolResults.success,
              iterations: agentToolResults.iterations,
              resultsCount: agentToolResults.results?.length,
            });

            if (agentToolResults.success) {
              unifiedResponse.data = {
                ...(unifiedResponse.data || {}),
                toolInvocations: [
                  ...(((unifiedResponse.data as any)?.toolInvocations as any[]) || []),
                  ...(agentToolResults.toolInvocations || []),
                ],
              };
              if (!rawResponseContent.trim() && agentToolResults.message) {
                unifiedResponse.content = agentToolResults.message;
                rawResponseContent = unifiedResponse.content;
              }
            }
          }
        } catch (error: any) {
          chatLogger.error('V1 agentic tools execution failed', { requestId }, {
            error: error.message,
          });
          // Continue with normal response even if agent tools fail
        }
      }

      // Enable batch mode to prevent circular Git commits during bulk file writes
      const { enableVFSBatchMode, flushVFSBatchMode, disableVFSBatchMode } = await import('@/lib/virtual-filesystem/git-backed-vfs');
      enableVFSBatchMode(filesystemOwnerId);

      // Declare before try so it's accessible in the post-try sanitization step
      let preSanitizedContent = rawResponseContent;

      try {
        // Single-pass: extract edits AND sanitize (avoids two regex sweeps of the same string)
        const { edits: parsedEdits, sanitized } = enableFilesystemEdits
          ? extractAndSanitize(rawResponseContent, true)
          : { edits: null as unknown as ParsedFilesystemResponse, sanitized: rawResponseContent };
        preSanitizedContent = sanitized;

        filesystemEdits =
          !enableFilesystemEdits
            ? null
            : await applyFilesystemEditsFromResponse({
                ownerId: filesystemOwnerId,
                conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
                requestId: requestId || generateSecureId('req'),
                scopePath: requestedScopePath,
                lastUserMessage: (() => {
                  const content =
                    [...messages].reverse().find((message) => message.role === 'user')
                      ?.content;
                  return typeof content === 'string' ? content : '';
                })(),
                attachedPaths: attachedFilesystemFiles.map((file) => file.path),
                responseContent: rawResponseContent,
                commands: unifiedResponse.commands,
                preParsedEdits: parsedEdits,
              alreadyWrittenPaths,
              });
        chatLogger.debug('Filesystem edits processed', { requestId, appliedCount: filesystemEdits?.applied?.length || 0 });

        // Flush batch mode to commit all changes at once
        await flushVFSBatchMode(filesystemOwnerId);

        // CRITICAL FIX Bug #1: Emit filesystem-updated event for non-streaming path
        // This ensures components update after non-streaming file edits
        if (filesystemEdits && filesystemEdits.applied.length > 0) {
          emitFilesystemUpdated({
            scopePath: requestedScopePath,
            sessionId: resolvedConversationId,
            workspaceVersion: filesystemEdits.workspaceVersion,
            applied: filesystemEdits.applied,
            errors: filesystemEdits.errors,
            source: 'non-streaming',
          });
        }
      } catch (error: unknown) {
        // Disable batch mode on error to prevent stuck state
        disableVFSBatchMode(filesystemOwnerId);
        throw error;
      }

      // SPEC AMPLIFICATION: Trigger after ToolLoopAgent completes (non-streaming path)
      // Runs AFTER filesystem edits are applied (line ~1242)
      // OPTIMIZATION: Use O(1) hasFileEdits check instead of O(n×m) code marker search
      // Also check for file edits from MCP tool execution (function calling path)
      if (agentToolResults && !clientResponse?.metadata?.specAmplificationRun) {
        const hasFileEdits = filesystemEdits && filesystemEdits.applied.length > 0;
        const mcpFileEdits = getRecentMcpFileEdits(resolvedConversationId);
        const hasMcpFileEdits = mcpFileEdits.length > 0;
        // Only trigger spec amplification when there are ACTUAL filesystem edits,
        // not just because the response contains code snippets (const, function, etc.)
        // Spec amplification runs in 'enhanced' or 'max' mode
        const isSpecAmplificationMode = ['enhanced', 'max', 'super'].includes(String(routerRequest.mode));
        const shouldRunSpecAmplification = (hasFileEdits || hasMcpFileEdits) && isSpecAmplificationMode;

        chatLogger.info('Spec amplification check (non-streaming)', {
          requestId,
          hasFileEdits,
          hasMcpFileEdits,
          mcpFileEditCount: mcpFileEdits.length,
          mode: routerRequest.mode,
          isSpecAmplificationMode,
          specAmplificationRun: clientResponse?.metadata?.specAmplificationRun,
          shouldRunSpecAmplification,
        });

        if (shouldRunSpecAmplification) {
          chatLogger.info('File edits detected, triggering spec amplification (non-streaming)', {
            requestId,
          });

          // Trigger spec amplification in background (don't wait)
          const { responseRouter } = await import('@/lib/api/response-router');
          const specRequest = {
            ...routerRequest,
            messages: [
              ...messages,
              { role: 'assistant' as const, content: rawResponseContent },
            ],
            mode: routerRequest.mode || 'enhanced',
            specChain: routerRequest.specChain,
          };

          responseRouter.routeWithSpecAmplification(specRequest).catch(err => {
            chatLogger.warn('Post-stream spec amplification failed', { error: err?.message });
          });
        } else {
          chatLogger.debug('Spec amplification NOT triggered (non-streaming)', {
            requestId,
            reason: !(hasFileEdits || hasMcpFileEdits) ? 'no filesystem edits' :
                    !isSpecAmplificationMode ? `mode is ${routerRequest.mode}` :
                    clientResponse?.metadata?.specAmplificationRun ? 'already run' : 'unknown',
          });
        }
        // Clear tracker after check to prevent stale data on next request
        clearRecentMcpFileEdits(resolvedConversationId);
      }

      let sanitizedResponseContent = preSanitizedContent;
      
      // CRITICAL: Add fallback message when content is empty but files were applied
      // This ensures users see feedback even when AI only makes file changes without explanation
      if (
        !sanitizedResponseContent.trim() &&
        filesystemEdits &&
        filesystemEdits.applied.length > 0
      ) {
        sanitizedResponseContent =
          `Applied filesystem changes to ${filesystemEdits.applied.length} file(s).`;
      }

      // Build client-visible response (assign to early-declared variable)
      clientResponse = buildClientVisibleUnifiedResponse(
        unifiedResponse,
        sanitizedResponseContent,
      );

      if (filesystemEdits && filesystemEdits.applied.length > 0) {
        const codeArtifacts = filesystemEdits.applied
          .filter((edit) => edit.operation !== 'delete')
          .map((edit) => {
            const requestedFile = filesystemEdits?.requestedFiles.find(f => f.path === edit.path);
            return {
              path: edit.path,
              operation: edit.operation,
              content: requestedFile?.content || '',
              language: requestedFile?.language || (
                edit.path.endsWith('.ts') || edit.path.endsWith('.tsx') ? 'typescript' :
                edit.path.endsWith('.js') || edit.path.endsWith('.jsx') ? 'javascript' :
                edit.path.endsWith('.json') ? 'json' :
                edit.path.endsWith('.css') ? 'css' :
                edit.path.endsWith('.html') ? 'html' : 'text'
              ),
              previousContent: undefined,
              newVersion: edit.version,
              previousVersion: edit.previousVersion,
            };
          });

        // CRITICAL FIX: Build fileEdits array with content for enhanced-diff-viewer
        // This merges filesystemEdits.applied with requestedFiles to include actual content
        // ROBUSTNESS: Don't assume WRITE=content, PATCH=diff
        // Filter out invalid paths and empty content/diff
        const fileEdits = filesystemEdits.applied
          .filter((edit) => {
            // Skip invalid paths
            if (!isValidFilePath(edit.path)) return false;
            // CRITICAL FIX: Check for content (WRITE ops) OR diff (PATCH ops)
            // Don't reject WRITE operations that don't have a diff field
            const hasContent = edit.content && edit.content.trim().length > 0;
            const hasDiff = edit.diff && edit.diff.trim().length > 0;
            if (!hasContent && !hasDiff) return false;
            return true;
          })
          .map((edit) => {
            const requestedFile = filesystemEdits?.requestedFiles.find(f => f.path === edit.path);
            // Determine what to send:
            // - If edit.diff exists and looks like unified diff, send it
            // - Otherwise send full content (EnhancedDiffViewer will auto-detect)
            const diffToUse = edit.diff && edit.diff.trim().length > 0 && edit.diff.startsWith('---')
              ? edit.diff
              : undefined;
            return {
              path: edit.path,
              operation: edit.operation || 'write',
              content: requestedFile?.content || edit.content || '',
              diff: diffToUse,  // Only send if it's actual unified diff format
              language: requestedFile?.language,
              version: edit.version,
              previousVersion: edit.previousVersion,
            };
          });

        if (codeArtifacts.length > 0) {
          clientResponse.metadata = {
            ...clientResponse.metadata,
            codeArtifacts,
            // CRITICAL: Include fileEdits with content for enhanced-diff-viewer
            fileEdits,
            // Add filesystem metadata for frontend message-bubble.tsx
            filesystem: {
              transactionId: filesystemEdits.transactionId,
              status: filesystemEdits.status,
              applied: filesystemEdits.applied,
              errors: filesystemEdits.errors,
              requestedFiles: filesystemEdits?.requestedFiles ?? [],
              scopePath: filesystemEdits.scopePath,
              workspaceVersion: filesystemEdits.workspaceVersion,
              commitId: filesystemEdits.commitId,
              sessionId: filesystemEdits.sessionId,
            },
          };
        }
      }

      // Handle streaming response
      chatLogger.debug('Checking streaming conditions', { requestId, stream, supportsStreaming: selectedProvider.supportsStreaming });
      if (stream && selectedProvider.supportsStreaming) {
        streamRequestId = requestId || generateSecureId('stream');
        const streamStartTime = Date.now();
        let chunkCount = 0;

        // NEW: Check if we have LLM stream generator from enhancedLLMService (real-time LLM token streaming)
        const hasLLMStreamGenerator = unifiedResponse.stream && 
          typeof unifiedResponse.stream === 'object' && 
          Symbol.asyncIterator in (unifiedResponse.stream as any);

        // DEBUG: Log stream detection for debugging
        chatLogger.debug('Stream detection', { 
          requestId, 
          hasStream: !!unifiedResponse.stream,
          streamType: typeof unifiedResponse.stream,
          isAsyncIterable: unifiedResponse.stream && Symbol.asyncIterator in (unifiedResponse.stream as any),
          contentLength: unifiedResponse.content?.length || 0,
        });

        // If no stream generator but we have content, we need to stream it
        // This happens when spec amplification was skipped but we have actual LLM response
        if (!hasLLMStreamGenerator && unifiedResponse.content && unifiedResponse.content.length > 0) {
          chatLogger.info('No stream generator but have content, will use fallback streaming with actual response', { 
            requestId, 
            contentLength: unifiedResponse.content.length 
          });
          // Update clientResponse with actual content so fallback can stream it
          clientResponse.content = unifiedResponse.content;
        }

        if (hasLLMStreamGenerator) {
          // Handle real-time LLM streaming with progressive parsing
          chatLogger.info('Streaming with LLM generator (real-time token streaming)', { requestId: streamRequestId, provider: actualProvider, model: actualModel });

          const encoder = new TextEncoder();
          let encoderRef: TextEncoder | null = encoder;
          // Per-iteration state for the second streaming path. Uses the same
          // shared factory as the first streaming path (config.onStreamChunk)
          // for consistency — see bing/web/lib/chat/stream-chunk-handler.ts.
          const streamState = createStreamChunkState();

          // Track tool invocations for telemetry
          const toolCallTracker = new Map<string, { toolName: string; args?: Record<string, any>; startTime: number }>();
          const completedToolCalls: Array<{
            toolCallId: string;
            toolName: string;
            state: 'call' | 'result';
            args?: Record<string, any>;
            result?: any;
            latencyMs?: number;
            success?: boolean;
          }> = [];

          const readableStream = new ReadableStream({
            async start(controller) {
              const realEmit = (eventType: string, data: any) => {
                if (request.signal?.aborted) return;
                const eventStr = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
                if (encoderRef) safeEnqueue(encoderRef, controller, eventStr);
                chunkCount++;
              };

              // Adapter: realEmit has a looser signature than createSSEEmitter's
              // return type, so cast to the expected type. The factory's emit
              // calls use SSE_EVENT_TYPES.TOKEN ('token') and SSE_EVENT_TYPES.FILE_EDIT
              // ('file_edit'), which are compatible with realEmit's string-based
              // event types.
              // The second streaming path was originally tuned to a 16-char
              // holdback. Override the factory default (17 = longest marker
              // length) to preserve that exact pre-refactor behavior.
              const streamChunkEmit = ((type, data) => realEmit(type as string, data)) as ReturnType<typeof createSSEEmitter>;
              // holdback: 16 preserves the pre-refactor behavior of this path.
              // NOTE: 16 is less than the longest marker `[ROUTING_METADATA]`
              // (18 chars), so a marker straddling a chunk boundary could
              // theoretically partially emit. This is a pre-existing quirk
              // faithfully preserved from the original `HOLDBACK = 16`
              // constant. Unifying both paths on 18 would be the more
              // conservative choice if you want to eliminate the edge case.
              const handleStreamChunk = createStreamChunkHandler(
                streamState,
                streamChunkEmit,
                DEFAULT_ROLE_SELECT_MARKERS,
                16, // see comment above
                ({ bufferLength }) => {
                  const wasMarkerSeen = streamState.markerSeen;
                  // The factory has already flipped markerSeen by the time
                  // this fires; this check is a no-op safety guard.
                  if (!wasMarkerSeen) {
                    chatLogger.debug(
                      '[StreamFilter-LLM-Stream] [ROLE_SELECT] detected, suppressing further tokens',
                      { bufferLength }
                    );
                  }
                }
              );

              emitRef.current = realEmit;

              // Send initial 'init' event to establish stream connection immediately
              // This helps client-side rendering detect the stream has started
              // Always have a valid AbortSignal for stream functions
              const abortSignal = request.signal || new AbortController().signal;

              // Create stream state for tracking and WebSocket control channel
              // Lazy import to avoid 'ws' module resolution during instrumentation
              const { streamStateManager: ssm, notifyStreamComplete: nsc } = await (async () => {
                try {
                  const [ssm, sc] = await Promise.all([
                    import('@/lib/streaming/stream-state-manager'),
                    import('@/lib/streaming/stream-control-handler'),
                  ]);
                  return { streamStateManager: ssm.streamStateManager, notifyStreamComplete: sc.notifyStreamComplete };
                } catch {
                  return { streamStateManager: null, notifyStreamComplete: null };
                }
              })();

              let streamStateCreated = false;
              if (ssm) {
                try {
                  ssm.create({
                    streamId: streamRequestId,
                    userId: userId || 'anonymous',
                    provider: actualProvider,
                    model: actualModel,
                    maxTokens: clientResponse.usage?.total_tokens || 65536,
                  });
                  streamStateCreated = true;
                } catch (e: unknown) {
                  chatLogger.warn('Failed to create stream state', {
                    streamRequestId,
                    error: e instanceof Error ? e.message : String(e),
                  });
                }
              }

              realEmit('init', {
                requestId: streamRequestId,
                streamId: streamRequestId, // For WebSocket control channel (same port, path-based routing)
                timestamp: Date.now(),
              });

              // Flush any pending events
              for (const pending of pendingEvents) {
                realEmit(pending.event, { requestId: streamRequestId, ...pending.data, timestamp: pending.timestamp });
              }
              pendingEvents.splice(0, pendingEvents.length);

              const cleanup = () => {
                encoderRef = null;
                emitRef.current = null;
                streamState.buffer = '';
                streamState.parser.emittedEdits.clear();
                streamState.parser.unclosedPositions.clear();
              };

              if (request.signal) {
                request.signal.addEventListener('abort', () => {
                  if (ssm) ssm.abort(streamRequestId);
                  if (nsc) nsc(streamRequestId);
                  cleanup();
                  chatLogger.warn('LLM stream cancelled by client', { requestId: streamRequestId });
                });
              }

              try {
                // Consume the LLM stream generator in real-time
                // This is where TRUE streaming happens - tokens as they're generated by the LLM
                // Token batching: accumulate tokens and emit every ~50ms to reduce SSE overhead
                let tokenBuffer = '';
                let lastTokenEmitTime = Date.now();
                const TOKEN_EMIT_INTERVAL_MS = 16;  // Reduced to 16ms (~60fps) for smoother streaming

                const emitBufferedTokens = async () => {
                  if (tokenBuffer.length > 0) {
                    realEmit('token', {
                      content: tokenBuffer,
                      timestamp: Date.now(),
                      type: 'token'
                    });
                    // Track tokens in stream state (non-fatal if it fails)
                    try {
                      if (ssm) {
                        ssm.appendToken(streamRequestId, tokenBuffer);
                        // If we hit max tokens, signal need more turns (auto-continue)
                        const state = ssm.get(streamRequestId);
                        if (state && state.tokenCount >= state.maxTokens && !state.needsMoreTurns) {
                          await ssm.signalNeedMoreTurns(streamRequestId, "Max tokens reached, auto-continuing...");
                        }
                      }
                    } catch (e: unknown) {
                      // Non-fatal - stream state tracking shouldn't break the main stream
                    }
                    tokenBuffer = '';
                    lastTokenEmitTime = Date.now();
                  }
                };

                for await (const streamChunk of unifiedResponse.stream as AsyncGenerator<StreamingResponse>) {
                  if (request.signal?.aborted) break;

                  // CRITICAL: Track actualProvider/actualModel from streaming metadata chunks
                  // This captures fallback events where the provider/model changes during streaming
                  if (streamChunk.metadata?.actualProvider || streamChunk.metadata?.actualModel) {
                    const newProvider = streamChunk.metadata.actualProvider;
                    const newModel = streamChunk.metadata.actualModel;
                    
                    if (newProvider && newProvider !== actualProvider) {
                      chatLogger.info('Streaming provider changed (fallback occurred)', {
                        requestId: streamRequestId,
                        oldProvider: actualProvider,
                        newProvider,
                        oldModel: actualModel,
                        newModel,
                      });
                      actualProvider = newProvider;
                    }
                    
                    if (newModel && newModel !== actualModel) {
                      actualModel = newModel;
                    }
                  }

                  // Accumulate token content
                  if (streamChunk.content) {
                    // Delegate buffer append, marker detection, holdback,
                    // file edit extraction and emit to the shared
                    // createStreamChunkHandler factory. tokenBuffer
                    // accumulation is kept here because it feeds the
                    // separate emitBufferedTokens() SSE path.
                    const wasMarkerSeen = streamState.markerSeen;
                    handleStreamChunk(streamChunk.content);
                    // Observability: log the transition when a [ROLE_SELECT]/
                    // [ROUTING_METADATA] marker is first detected so operators
                    // can see the suppression kick in (lost when the inline
                    // marker logic was replaced with the shared factory).
                    if (!wasMarkerSeen && streamState.markerSeen) {
                      chatLogger.debug('[StreamFilter-LLM-Stream] [ROLE_SELECT] detected, suppressing further tokens', {
                        bufferLength: streamState.buffer.length,
                      });
                    }

                    // Only add to tokenBuffer if we haven't seen the marker yet
                    if (!streamState.markerSeen) {
                      tokenBuffer += streamChunk.content;
                    }

                    // Emit buffered tokens if interval has passed
                    const now = Date.now();
                    if (now - lastTokenEmitTime >= TOKEN_EMIT_INTERVAL_MS) {
                      await emitBufferedTokens();
                    }
                  }

                  // Handle reasoning traces if present (for models that support it)
                  if (streamChunk.reasoning) {
                    realEmit('reasoning', {
                      reasoning: streamChunk.reasoning,
                      timestamp: Date.now(),
                    });
                  }

                  // Handle tool calls if present
                  // Skip partial tool calls with empty args (streamed incrementally by Vercel AI SDK)
                  // — the tool_invocation event below will contain the full args once execution completes
                  if (streamChunk.toolCalls && streamChunk.toolCalls.length > 0) {
                    for (const toolCall of streamChunk.toolCalls) {
                      const args = toolCall.arguments;
                      if (!args || (typeof args === 'object' && Object.keys(args).length === 0)) continue;
                      realEmit('tool_call', {
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        args,
                        timestamp: Date.now(),
                      });
                    }
                  }

                  // Handle tool invocations if present
                  // FIX: Only emit tool_invocation from stream when args are populated.
                  // The onToolExecution callback (line ~893) emits with full args after tool execution completes.
                  // Vercel AI SDK streams tool arguments incrementally, so early chunks may have empty args.
                  if (streamChunk.toolInvocations && streamChunk.toolInvocations.length > 0) {
                    for (const toolInvocation of streamChunk.toolInvocations) {
                      // Skip emission when args are empty - onToolExecution callback will emit with full args
                      const hasArgs = toolInvocation.args && 
                        (typeof toolInvocation.args === 'object' ? Object.keys(toolInvocation.args).length > 0 : true);
                      
                      // Also skip partial call state (args not yet fully streamed)
                      // Vercel AI SDK uses 'call' state for tool-call, 'result' for tool-result
                      const isPartialCall = toolInvocation.state === 'call' && !hasArgs;
                      
                      if (isPartialCall) {
                        continue; // Wait for result state with populated args
                      }
                      
                      // For result state, try to get args from result if toolInvocation.args is empty
                      let args = toolInvocation.args;
                      const isEmptyArgs = !args || (typeof args === 'object' && Object.keys(args).length === 0);
                      
                      // DIAGNOSTIC: Log when args are empty at result state
                      if (toolInvocation.state === 'result') {
                        if (isEmptyArgs) {
                          chatLogger.warn('[TOOL-INVOKE] Tool result has empty args', {
                            toolCallId: toolInvocation.toolCallId,
                            toolName: toolInvocation.toolName,
                            hasCachedArgs: !!(toolInvocation.result?.input || toolInvocation.result?.args),
                          });
                        } else {
                          chatLogger.info('[TOOL-INVOKE] Tool result with args', {
                            toolCallId: toolInvocation.toolCallId,
                            toolName: toolInvocation.toolName,
                            argsKeys: Object.keys(args),
                          });
                        }
                      }
                      
                      if (toolInvocation.state === 'result' && isEmptyArgs) {
                        // Try to extract args from result if available
                        if (toolInvocation.result?.input) {
                          args = toolInvocation.result.input;
                        } else if (toolInvocation.result?.args) {
                          args = toolInvocation.result.args;
                        }
                      }

                      // Only emit if we have args or it's a result state (to show completion)
                      if (hasArgs || toolInvocation.state === 'result') {
                        const finalArgs = args && typeof args === 'object' && Object.keys(args).length > 0 ? args : undefined;
                        realEmit('tool_invocation', {
                          toolCallId: toolInvocation.toolCallId,
                          toolName: toolInvocation.toolName,
                          state: toolInvocation.state,
                          ...(finalArgs ? { args: finalArgs } : {}),
                          result: toolInvocation.result,
                          timestamp: Date.now(),
                        });

                        // Track tool call for telemetry + real-time model ranking
                        if (toolInvocation.state === 'call') {
                          toolCallTracker.set(toolInvocation.toolCallId, {
                            toolName: toolInvocation.toolName,
                            args: finalArgs,
                            startTime: Date.now(),
                          });
                        } else if (toolInvocation.state === 'result') {
                          const tracked = toolCallTracker.get(toolInvocation.toolCallId);
                          const isSuccess = toolInvocation.result && toolInvocation.result.output !== undefined && toolInvocation.result.output !== null;
                          const errorMsg = toolInvocation.result?.error;

                          completedToolCalls.push({
                            toolCallId: toolInvocation.toolCallId,
                            toolName: toolInvocation.toolName,
                            state: 'result',
                            args: tracked?.args || finalArgs,
                            result: toolInvocation.result,
                            latencyMs: tracked ? Date.now() - tracked.startTime : undefined,
                            success: isSuccess,
                          });
                          toolCallTracker.delete(toolInvocation.toolCallId);

                          // Bug #48: collect paths from successful batch_write / write_file
                          // tool calls so the text-mode parser skips them. Without this,
                          // the parser would overwrite correct file content with echoed
                          // tool-call JSON from the LLM's prose summary.
                          if (isSuccess && (toolInvocation.toolName === 'batch_write' || toolInvocation.toolName === 'write_file')) {
                            const output = toolInvocation.result?.output;
                            if (Array.isArray(output)) {
                              for (const item of output) {
                                if (item && typeof item === 'object' && item.path && item.success !== false) {
                                  addWrittenPath(alreadyWrittenPaths, item.path, requestedScopePath);
                                }
                              }
                            } else if (output && typeof output === 'object' && output.path && output.success !== false) {
                              addWrittenPath(alreadyWrittenPaths, output.path, requestedScopePath);
                            }
                          }

                          // Real-time: Record tool call for model ranking telemetry
                          try {
                            const { toolCallTracker: realTimeTracker } = await import('@/lib/tools/tool-call-tracker');
                            await realTimeTracker.recordToolCall({
                              model: actualModel,
                              provider: actualProvider,
                              toolName: toolInvocation.toolName,
                              success: isSuccess,
                              error: errorMsg,
                              timestamp: Date.now(),
                              conversationId,
                              toolCallId: toolInvocation.toolCallId,
                            });
                          } catch {
                            // Non-critical — don't break stream if tracker fails
                          }
                        }
                      }
                    }
                  }

                  // Handle files if present
                  if (streamChunk.files && streamChunk.files.length > 0) {
                    for (const file of streamChunk.files) {
                      // Validate path to prevent invalid file edits
                      if (!isValidFilePath(file.path)) {
                        chatLogger.debug('Skipping invalid file path from streamChunk.files', { path: file.path });
                        continue;
                      }
                      // CRITICAL FIX: Determine if this is a patch operation (has diff) or regular file operation
                      // Note: StreamingResponse.files operation type is 'create' | 'update' | 'delete'
                      // We check for diff field to determine if it's actually a patch/diff operation
                      const hasDiff = !!(file as any).diff;
                      realEmit('file_edit', {
                        path: file.path,
                        status: file.operation === 'delete' ? 'deleted' : 'detected',
                        operation: hasDiff ? 'patch' : file.operation,
                        content: file.content || '',
                        diff: hasDiff ? ((file as any).diff || '') : undefined,
                        timestamp: Date.now(),
                      });
                    }
                  }

                  // Handle commands if present
                  if (streamChunk.commands) {
                    if (streamChunk.commands.request_files) {
                      realEmit('request_files', {
                        paths: streamChunk.commands.request_files,
                        timestamp: Date.now(),
                      });
                    }
                    if (streamChunk.commands.write_diffs) {
                      realEmit('diffs', {
                        files: streamChunk.commands.write_diffs,
                        timestamp: Date.now(),
                      });
                    }
                  }

                  // Handle auto-continue events from streamWithAutoContinue
                  // These are yielded when the LLM stopped after list_files or requested continuation
                  const streamChunkType = (streamChunk as any).type;
                  if (streamChunkType === 'auto-continue' || streamChunkType === 'next') {
                    realEmit(streamChunkType, {
                      content: streamChunk.content || '',
                      reason: (streamChunk as any).metadata?.reason,
                      listedPath: (streamChunk as any).metadata?.listedPath,
                      recursive: (streamChunk as any).metadata?.recursive,
                      continuationCount: (streamChunk as any).metadata?.continuationCount,
                      maxContinuations: (streamChunk as any).metadata?.maxContinuations,
                      toolSummary: (streamChunk as any).toolSummary,
                      contextHint: (streamChunk as any).contextHint,
                      implicitFiles: (streamChunk as any).metadata?.implicitFiles,
                      timestamp: Date.now(),
                    });
                    chatLogger.info('Emitted auto-continue/next event to client', {
                      type: streamChunkType,
                      reason: (streamChunk as any).metadata?.reason,
                      continuationCount: (streamChunk as any).metadata?.continuationCount,
                    });
                  }

                  // Handle finish reason at end of stream
                  if (streamChunk.isComplete) {
                    // Post-processing: run filesystem edits on accumulated stream content
                    // This ensures WRITE/APPLY_DIFF from streamed output reaches the VFS
                    const streamedContent = streamState.buffer;

                    // DIAGNOSTIC: Log why VFS writes may or may not happen
                    chatLogger.debug('Stream complete — filesystem edit gate check', {
                      enableFilesystemEdits,
                      contentLength: streamedContent.length,
                      contentTrimmed: streamedContent.trim().length,
                      filesystemOwnerId,
                      requestedScopePath,
                      hasCommands: !!unifiedResponse.commands,
                    });

                    if (enableFilesystemEdits && streamedContent.trim()) {
                      try {
                        // Enable batch mode to prevent circular Git commits
                        const { enableVFSBatchMode, flushVFSBatchMode } = await import('@/lib/virtual-filesystem/git-backed-vfs');
                        enableVFSBatchMode(filesystemOwnerId);

                        // FIX: Pass forceExtract=true to ensure we catch ALL edits including those
                        // that may have been missed during incremental parsing (e.g., last file)
                        streamedEdits = await applyFilesystemEditsFromResponse({
                          ownerId: filesystemOwnerId,
                          conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
                          requestId: streamRequestId,
                          scopePath: requestedScopePath,
                          lastUserMessage: (() => {
                            const c = [...messages].reverse().find((m) => m.role === 'user')?.content;
                            return typeof c === 'string' ? c : '';
                          })(),
                          attachedPaths: attachedFilesystemFiles.map((file) => file.path),
                          responseContent: streamedContent,
                          commands: unifiedResponse.commands,
                          forceExtract: true,
                        alreadyWrittenPaths,
                        });

                        // Flush batch mode to commit all changes at once
                        await flushVFSBatchMode(filesystemOwnerId);

                        // Emit applied file edits + tool_invocation events for UI display
                        // CRITICAL FIX: When LLM doesn't support proper function calling,
                        // the Vercel AI SDK streams empty args. We compensate by emitting
                        // tool_invocation events with actual parsed args from streamedEdits.
                        if (streamedEdits?.applied?.length) {
                          // Track if we found any edits that need tool_invocation emission
                          let emittedAnyToolInvocation = false;

                          for (const edit of streamedEdits.applied) {
                            // Validate path before emitting
                            if (!isValidFilePath(edit.path)) {
                              chatLogger.debug('Skipping invalid path from streamedEdits', { path: edit.path });
                              continue;
                            }
                            // CRITICAL FIX: Skip empty content to prevent infinite loops
                            const editContent = edit.content || edit.diff || '';
                            if (!editContent || editContent.trim().length === 0) {
                              chatLogger.debug('Skipping empty edit from streamedEdits (prevents infinite loop)', { path: edit.path });
                              continue;
                            }
                            // CRITICAL FIX: Determine operation type and send correct data format
                            const hasDiff = !!edit.diff;
                            const isPatch = edit.operation === 'patch' || hasDiff;

                            // Emit file_edit event (existing behavior)
                            realEmit('file_edit', {
                              path: edit.path,
                              status: 'applied',
                              operation: isPatch ? 'patch' : (edit.operation || 'write'),
                              timestamp: Date.now(),
                              content: edit.content || '',
                              diff: isPatch ? (edit.diff || '') : undefined,
                            });

                            // FIX: Also emit tool_invocation with actual parsed args
                            // This ensures the UI can display tool calls even when the LLM
                            // didn't emit structured function calls (e.g., minimax/m2.5:free)
                            // Use correct tool based on operation type (write vs patch)
                            const editDiff = edit.diff || (isPatch ? edit.content : '');
                            const toolCallId = streamedEdits?.commitId || (isPatch ? `apply_diff-${Date.now()}-${edit.path}` : `write_file-${Date.now()}-${edit.path}`);
                            let toolName: string;
                            let toolArgs: Record<string, any>;
                            
                            // Handle both content and diff fields (may be stored either way)
                            if (isPatch && editDiff) {
                              toolName = 'apply_diff';
                              toolArgs = {
                                path: edit.path,
                                diff: editDiff,
                              };
                            } else if (edit.operation === 'delete') {
                              toolName = 'delete_file';
                              toolArgs = {
                                path: edit.path,
                              };
                            } else {
                              toolName = 'write_file';
                              toolArgs = {
                                path: edit.path,
                                content: edit.content || editDiff || '',
                              };
                            }
                            
                            realEmit('tool_invocation', {
                              toolCallId,
                              toolName,
                              state: 'result',
                              args: toolArgs,
                              result: { success: true, path: edit.path },
                              timestamp: Date.now(),
                            });
                            emittedAnyToolInvocation = true;
                          }

                          if (emittedAnyToolInvocation) {
                            chatLogger.debug('Emitted tool_invocation events for parsed filesystem edits', {
                              requestId: streamRequestId,
                              editCount: streamedEdits.applied.length,
                              paths: streamedEdits.applied.map(e => e.path).join(', '),
                            });
                          }
                        }

                        // CRITICAL: Add fallback message if sanitized content is empty but files were applied
                        // This applies to post-stream edits that may not have been caught earlier
                        if (!sanitizedResponseContent.trim() && streamedEdits && streamedEdits.applied.length > 0) {
                          sanitizedResponseContent = `Applied filesystem changes to ${streamedEdits.applied.length} file(s).`;
                        }
                      } catch (editErr: any) {
                        // Disable batch mode on error
                        const { disableVFSBatchMode } = await import('@/lib/virtual-filesystem/git-backed-vfs');
                        disableVFSBatchMode(filesystemOwnerId);
                        chatLogger.warn('Post-stream filesystem edits failed', { requestId: streamRequestId, error: editErr.message });
                      }
                    }

                    // Include filesystem metadata in done event for EnhancedDiffViewer
                    const doneEventData = {
                      requestId: streamRequestId,
                      timestamp: Date.now(),
                      success: true,
                      finishReason: streamChunk.finishReason,
                      tokensUsed: streamChunk.tokensUsed,
                      usage: streamChunk.usage,
                      modelName: actualModel,
                    };

                    // Add filesystem metadata if files were applied
                    // CRITICAL FIX: Check BOTH filesystemEdits (pre-stream) AND streamedEdits (final parse)
                    allEdits = streamedEdits && streamedEdits.applied.length > 0
                      ? streamedEdits
                      : filesystemEdits;

                    if (allEdits && allEdits.applied.length > 0) {
                      // CRITICAL FIX: Build fileEdits array with content for enhanced-diff-viewer
                      // ROBUSTNESS: Don't assume WRITE=content, PATCH=diff
                      // LLM may return diffs in <file_edit> tags or full content for existing files
                      // Let EnhancedDiffViewer detect format using isDiffFormat()
                      const fileEdits = (allEdits.applied.map(e => ({ ...e })) as FilesystemEditSummary[])
                        .filter((edit) => {
                          // Skip invalid paths
                          if (!isValidFilePath(edit.path)) return false;
                          // Skip empty content/diff
                          const hasContent = edit.content && edit.content.trim().length > 0;
                          const hasDiff = edit.diff && edit.diff.trim().length > 0;
                          if (!hasContent && !hasDiff) return false;
                          return true;
                        })
                        .map((edit) => {
                          const requestedFile = allEdits?.requestedFiles.find(f => f.path === edit.path);
                          // Determine what to send:
                          // - If edit.diff exists and looks like unified diff, send it
                          // - Otherwise send full content (EnhancedDiffViewer will auto-detect format)
                          const diffToUse = edit.diff && edit.diff.trim().length > 0 && edit.diff.startsWith('---')
                            ? edit.diff
                            : undefined;
                          const contentToUse = requestedFile?.content || edit.content || '';

                          return {
                            path: edit.path,
                            operation: edit.operation || 'write',
                            content: contentToUse,
                            diff: diffToUse,  // Only send if it's actual unified diff format
                            language: requestedFile?.language,
                            version: edit.version,
                            previousVersion: edit.previousVersion,
                          };
                        });

                      (doneEventData as any).filesystem = {
                        transactionId: allEdits.transactionId,
                        status: allEdits.status,
                        applied: allEdits.applied,
                        errors: allEdits.errors,
                        requestedFiles: allEdits.requestedFiles,
                        scopePath: allEdits.scopePath,
                        workspaceVersion: allEdits.workspaceVersion,
                        commitId: allEdits.commitId,
                        sessionId: allEdits.sessionId,
                      };
                      // CRITICAL: Include fileEdits with content for enhanced-diff-viewer
                      (doneEventData as any).fileEdits = fileEdits;
                    }

                    // Add fallback message if sanitized content is empty but files were applied
                    if (!sanitizedResponseContent.trim() && allEdits && allEdits.applied.length > 0) {
                      (doneEventData as any).fallbackMessage = `Applied filesystem changes to ${allEdits.applied.length} file(s).`;
                    }

                    // Emit any remaining buffered tokens before done event
                    await emitBufferedTokens();

                    // Update stream state and notify WebSocket control channel (non-fatal)
                    try {
                      if (ssm) ssm.complete(streamRequestId, doneEventData.finishReason);
                      if (nsc) nsc(streamRequestId);
                    } catch (e: unknown) {
                      chatLogger.warn('Failed to update stream state on completion', {
                        streamRequestId,
                        error: e instanceof Error ? e.message : String(e),
                      });
                    }

                    realEmit('done', doneEventData);

                    // Store conversation in mem0 for persistent memory (fire-and-forget, non-blocking)
                    // Use streamingContentBuffer which has the full response
                    if (isMem0Configured()) {
                      storeConversationInMem0(messages, streamState.buffer, filesystemOwnerId, streamRequestId, {
                        sessionId: resolvedConversationId,
                        metadata: {
                          threadId: resolvedConversationId,
                          scopePath: scopePathForHybrid || undefined,
                          requestId: streamRequestId,
                          path: 'streaming',
                        },
                      }).catch((err) => chatLogger.warn('mem0 store failed (streaming path)', { requestId: streamRequestId }, { error: String(err) }));
                    }

                    break; // Exit loop when complete
                  }
                }

                // Flush any holdback chars that were withheld for partial-marker detection
                // (only when no [ROLE_SELECT] marker was seen). Without this, the last
                // ~17 chars of a clean response would be silently dropped from the UI.
                if (!streamState.markerSeen && streamState.charsEmittedSafely < streamState.buffer.length) {
                  const flush = streamState.buffer.slice(streamState.charsEmittedSafely);
                  if (flush) realEmit('token', { content: flush, timestamp: Date.now() });
                  streamState.charsEmittedSafely = streamState.buffer.length;
                }

                // Emit any remaining buffered tokens (in case loop exited without hitting isComplete)
                await emitBufferedTokens();

                // SPEC AMPLIFICATION: Trigger after regular LLM streaming completes
                // Runs AFTER final parse (line ~1684) and FILE_EDIT events (line ~1715)
                // OPTIMIZATION: Use O(1) hasFileEdits check instead of O(n×m) code marker search
                // Note: allEdits is assigned inside streamChunk.isComplete block (line ~1833)
                // If loop completed normally, allEdits should be set. Otherwise fall back to streamedEdits/filesystemEdits.
                // Also check for file edits from MCP tool execution (function calling path)
                const effectiveEdits = allEdits || streamedEdits || filesystemEdits;
                const hasFileEdits = (effectiveEdits?.applied?.length || 0) > 0;
                const mcpFileEdits = getRecentMcpFileEdits(resolvedConversationId);
                const hasMcpFileEdits = mcpFileEdits.length > 0;
                const isSpecAmplificationMode = ['enhanced', 'max', 'super'].includes(String(routerRequest.mode));
                // Only trigger spec amplification when there are ACTUAL filesystem edits,
                // not just because the response contains code snippets (const, function, etc.)
                const shouldRunSpecAmplification = (hasFileEdits || hasMcpFileEdits) &&
                  isSpecAmplificationMode &&
                  !clientResponse.metadata?.specAmplificationRun;

                chatLogger.info('Spec amplification check (regular LLM stream)', {
                  requestId: streamRequestId,
                  hasFileEdits,
                  hasMcpFileEdits,
                  mcpFileEditCount: mcpFileEdits.length,
                  mode: routerRequest.mode,
                  isSpecAmplificationMode,
                  specAmplificationRun: clientResponse.metadata?.specAmplificationRun,
                  shouldRunSpecAmplification,
                });

                if (shouldRunSpecAmplification) {
                  chatLogger.info('Code/file edits detected, triggering spec amplification (regular LLM path)', {
                    requestId: streamRequestId,
                    contentLength: streamState.buffer.length,
                    appliedEditsCount: effectiveEdits?.applied?.length || 0,
                    mcpFileEdits: hasMcpFileEdits ? mcpFileEdits.map(e => e.path) : undefined,
                  });

                  // Build enhanced content including actual file edits
                  let enhancedContent = streamState.buffer;
                  if ((effectiveEdits?.applied?.length ?? 0) > 0) {
                    const fileEditsContent = (effectiveEdits?.applied ?? [] as Array<{ path: string; content?: string; diff?: string }>)
                      .filter((e: { content?: string; diff?: string }) => e.content || e.diff)
                      .map((e: { path: string; content?: string; diff?: string }) => `\n\`\`\`fs-actions\nWRITE ${e.path} <<<\n${e.content || e.diff || ''}\n>>>\n\`\`\``)
                      .join('\n\n');
                    if (fileEditsContent) {
                      enhancedContent = streamState.buffer + '\n\n' + fileEditsContent;
                      chatLogger.debug('Including file edits in spec amplification', {
                        fileCount: effectiveEdits?.applied?.length ?? 0,
                        additionalContentLength: fileEditsContent.length,
                      });
                    }
                  } else if (hasMcpFileEdits) {
                    // MCP tool execution path: files were modified via function calling.
                    // Do NOT inject WRITE markers with placeholder content into enhancedContent —
                    // the background refinement engine would parse those markers and overwrite
                    // the real file content with the placeholder text.
                    // Instead, just note that files were created/updated via MCP.
                    enhancedContent = streamState.buffer +
                      `\n\n[Note: ${mcpFileEdits.length} file(s) were created/updated via tool calls: ${mcpFileEdits.map(e => e.path).join(', ')}]`;
                    chatLogger.debug('Noting MCP tool file edits in spec amplification (no WRITE markers)', {
                      fileCount: mcpFileEdits.length,
                      paths: mcpFileEdits.map(e => e.path),
                    });
                  }

                  // Trigger spec amplification in background - events stream via emitRef.current
                  const { responseRouter } = await import('@/lib/api/response-router');
                  const specRequest = {
                    ...routerRequest,
                    messages: [
                      ...messages,
                      { role: 'assistant' as const, content: enhancedContent },
                    ],
                    mode: routerRequest.mode || 'enhanced',
            specChain: routerRequest.specChain,
                    emit: emitRef.current,  // CRITICAL: Pass emit function so spec amp events reach client
                  };

                  responseRouter.routeWithSpecAmplification(specRequest).catch(err => {
                    chatLogger.warn('Post-stream spec amplification failed', { error: err?.message });
                  });
                } else {
                  chatLogger.debug('Spec amplification NOT triggered (regular LLM path)', {
                    requestId: streamRequestId,
                    reason: !(hasFileEdits || hasMcpFileEdits) ? 'no filesystem edits' :
                            !isSpecAmplificationMode ? `mode is ${routerRequest.mode}` :
                            clientResponse.metadata?.specAmplificationRun ? 'already run' : 'unknown',
                  });
                }
                // Clear tracker after check to prevent stale data
                clearRecentMcpFileEdits(resolvedConversationId);

                // Record comprehensive telemetry for stream completion
                const streamDuration = Date.now() - streamStartTime;
                chatRequestLogger.logRequestComplete(
                  streamRequestId,
                  true,
                  streamState.buffer.length,
                  undefined,
                  streamDuration,
                  undefined,
                  actualProvider,
                  actualModel,
                  (completedToolCalls.length > 0 ? completedToolCalls : undefined) as any,
                  streamState.buffer.length,
                ).catch((err) => chatLogger.warn('logRequestComplete failed (LLM stream)', { requestId: streamRequestId }, { error: String(err) }));

                cleanup();
              } catch (streamError) {
                chatLogger.error('LLM stream error', { requestId: streamRequestId }, {
                  error: streamError instanceof Error ? streamError.message : String(streamError),
                });

                if (!request.signal?.aborted) {
                  realEmit('error', {
                    message: 'LLM streaming error',
                    error: streamError instanceof Error ? streamError.message : String(streamError),
                  });
                }
                cleanup();
              } finally {
                controller.close();
              }
            },
            cancel(reason?: unknown) {
              const streamDuration = Date.now() - streamStartTime;
              chatLogger.info('SSE stream cancelled by client disconnect', { requestId: streamRequestId }, {
                reason: typeof reason === 'string' ? reason : (reason instanceof Error ? reason.message : String(reason)),
                chunkCount,
                latencyMs: streamDuration,
              });
            }
          });

          return new Response(readableStream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
              Expires: '0',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
              'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || '',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-anonymous-session-id',
              'Vary': 'Origin',
              ...(anonSessionIdToSet ? {
                'Set-Cookie': `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
              } : {}),
            },
          });
        }

        // NOTE: Spec amplification trigger moved to inside each streaming path's completion handler
        // - Regular LLM streaming: line ~1825 (after streamState.buffer is finalized)
        // - ToolLoopAgent streaming: line ~2155 (after finalContent is finalized)
        // This ensures content is available and emitRef.current is properly set

        // Check if we have ToolLoopAgent streaming available
        const hasToolLoopStreaming = agentToolStreamingResult && stream;

        if (hasToolLoopStreaming) {
          // Handle ToolLoopAgent real-time streaming
          chatLogger.info('Streaming with ToolLoopAgent real-time events', { requestId: streamRequestId });
          
          const encoder = new TextEncoder();
          let encoderRef: TextEncoder | null = encoder;

          const readableStream = new ReadableStream({
            async start(controller) {
              // Set up real emit that writes directly to stream controller
              const realEmit = (eventType: string, data: any) => {
                if (request.signal?.aborted) return;
                const eventStr = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
                if (encoderRef) safeEnqueue(encoderRef, controller, eventStr);
                chunkCount++;
              };

              // Replace placeholder emit with real emit - background refinement will now stream directly
              emitRef.current = realEmit;

              // Flush any pending events that arrived before stream started
              for (const pending of pendingEvents) {
                realEmit(pending.event, { requestId: streamRequestId, ...pending.data, timestamp: pending.timestamp });
              }
              pendingEvents.splice(0, pendingEvents.length);

              const cleanup = () => {
                encoderRef = null;
                emitRef.current = null;
                acceptDeferredEvents = false;
              };

              if (request.signal) {
                request.signal.addEventListener('abort', () => {
                  cleanup();
                  chatLogger.warn('Stream cancelled by client', { requestId: streamRequestId, provider: actualProvider, model: actualModel });
                });
              }

              try {
                const { agentLoop, task, timeout } = agentToolStreamingResult;
                let agentTimeoutId: NodeJS.Timeout | null = null;

                // Set up timeout for entire streaming operation
                const timeoutPromise = new Promise((_, reject) => {
                  agentTimeoutId = setTimeout(() => reject(new Error('Agent tools timeout')), timeout);
                });

                  // Stream from agent
                const streamPromise = (async () => {
                  // First, send initial token events from base response
                  const baseEvents = responseRouter.createStreamingEvents(clientResponse, streamRequestId);
                  for (const event of baseEvents) {
                    if (request.signal?.aborted) return;
                    safeEnqueue(encoderRef, controller, event);
                    chunkCount++;
                  }

                  // Note: spec amplification events will now be streamed via emitRef.current
                  // as background refinement progresses (no longer pre-captured)

                  // Now stream tool invocations and reasoning in real-time
                  // Capture the final result to include content in done event
                  // Note: finalContent is declared at function scope (line ~1209)
                  
                  // Token batching for ToolLoopAgent - accumulate and emit every 50ms
                  // This reduces SSE overhead while maintaining smooth streaming
                  let tokenBuffer = '';
                  let lastTokenEmitTime = Date.now();
                  const TOKEN_EMIT_INTERVAL_MS = 50;
                  
                  const emitBufferedTokens = () => {
                    if (tokenBuffer.length > 0) {
                      const tokenEvent = `event: token\ndata: ${JSON.stringify({
                        content: tokenBuffer,
                        timestamp: Date.now(),
                      })}\n\n`;
                      safeEnqueue(encoderRef, controller, tokenEvent);
                      chunkCount++;
                      finalContent += tokenBuffer;
                      tokenBuffer = '';
                      lastTokenEmitTime = Date.now();
                    }
                  };
                  
                  for await (const chunk of agentLoop.executeTaskStreaming(task)) {
                    if (request.signal?.aborted) return;

                    // Transform chunk to SSE format
                    if (chunk.type === 'tool-invocation') {
                      const toolEvent = `event: tool_invocation\ndata: ${JSON.stringify({
                        requestId: streamRequestId,
                        toolCallId: chunk.toolInvocation.toolCallId,
                        toolName: chunk.toolInvocation.toolName,
                        state: chunk.toolInvocation.state,
                        args: chunk.toolInvocation.args,
                        result: chunk.toolInvocation.result,
                        timestamp: Date.now(),
                      })}\n\n`;
                      safeEnqueue(encoderRef, controller, toolEvent);
                      chunkCount++;

                      // Real-time: Track tool call for model ranking telemetry
                      if (chunk.toolInvocation.state === 'result') {
                        const toolName = chunk.toolInvocation.toolName;
                        const isSuccess = chunk.toolInvocation.result &&
                          chunk.toolInvocation.result.output !== undefined &&
                          chunk.toolInvocation.result.output !== null;
                        const errorMsg = chunk.toolInvocation.result?.error;

                        try {
                          const { toolCallTracker: realTimeTracker } = await import('@/lib/tools/tool-call-tracker');
                          await realTimeTracker.recordToolCall({
                            model: actualModel,
                            provider: actualProvider,
                            toolName,
                            success: isSuccess,
                            error: errorMsg,
                            timestamp: Date.now(),
                            conversationId,
                            toolCallId: chunk.toolInvocation.toolCallId,
                          });
                        } catch {
                          // Non-critical
                        }
                      }
                    } else if (chunk.type === 'reasoning') {
                      const reasoningEvent = `event: reasoning\ndata: ${JSON.stringify({
                        requestId: streamRequestId,
                        reasoning: chunk.reasoning,
                        timestamp: Date.now(),
                      })}\n\n`;
                      safeEnqueue(encoderRef, controller, reasoningEvent);
                      chunkCount++;
                    } else if (chunk.type === 'text-delta') {
                      // Accumulate text deltas and emit in batches
                      tokenBuffer += chunk.textDelta;
                      
                      // Emit if interval has passed
                      const now = Date.now();
                      if (now - lastTokenEmitTime >= TOKEN_EMIT_INTERVAL_MS) {
                        emitBufferedTokens();
                      }
                    }
                  }
                  
                  // Emit any remaining buffered tokens before done event
                  emitBufferedTokens();

                  // FINAL PARSE: Run filesystem edits on accumulated stream content
                  // This MUST run BEFORE the done event so filesystem metadata is included
                  // Same as regular LLM path (line ~1755)
                  allEdits = filesystemEdits;
                  const streamedContent = finalContent;
                  
                  // LOG what's being captured
                  chatLogger.info('[STREAM] Final content for parsing', {
                    streamedContentLength: streamedContent?.length || 0,
                    streamedContentPreview: (streamedContent || '').slice(0, 300),
                  });
                  
                  if (enableFilesystemEdits && streamedContent.trim()) {
                    try {
                      // Enable batch mode to prevent circular Git commits
                      const { enableVFSBatchMode, flushVFSBatchMode } = await import('@/lib/virtual-filesystem/git-backed-vfs');
                      enableVFSBatchMode(filesystemOwnerId);

                      // FIX: Pass forceExtract=true to ensure we catch ALL edits including those
                      // that may have been missed during incremental parsing (e.g., last file)
                      const streamedEdits = await applyFilesystemEditsFromResponse({
                        ownerId: filesystemOwnerId,
                        conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
                        requestId: streamRequestId,
                        scopePath: requestedScopePath,
                        lastUserMessage: (() => {
                          const c = [...messages].reverse().find((m) => m.role === 'user')?.content;
                          return typeof c === 'string' ? c : '';
                        })(),
                        attachedPaths: attachedFilesystemFiles.map((file) => file.path),
                        responseContent: streamedContent,
                        commands: unifiedResponse.commands,
                        forceExtract: true,
                        alreadyWrittenPaths,
                      });

                      // Flush batch mode to commit all changes at once
                      await flushVFSBatchMode(filesystemOwnerId);

                      // Use streamedEdits if it has edits, otherwise use filesystemEdits
                      allEdits = streamedEdits && streamedEdits.applied.length > 0 ? streamedEdits : filesystemEdits;

                      // Emit applied file edits
                      if (streamedEdits?.applied?.length) {
                        for (const edit of streamedEdits.applied) {
                          // Validate path before emitting
                          if (!isValidFilePath(edit.path)) {
                            chatLogger.debug('Skipping invalid path from streamedEdits', { path: edit.path });
                            continue;
                          }
                          // CRITICAL FIX: Skip empty content to prevent infinite loops
                          const editContent = edit.content || edit.diff || '';
                          if (!editContent || editContent.trim().length === 0) {
                            chatLogger.debug('Skipping empty edit from streamedEdits (prevents infinite loop)', { path: edit.path });
                            continue;
                          }
                          // CRITICAL FIX: Determine operation type and send correct data format
                          const hasDiff = !!edit.diff;
                          const isPatch = edit.operation === 'patch' || hasDiff;
                          realEmit('file_edit', {
                            path: edit.path,
                            status: 'applied',
                            operation: isPatch ? 'patch' : 'write',
                            timestamp: Date.now(),
                            content: edit.content || '',
                            diff: isPatch ? (edit.diff || '') : undefined,
                          });
                        }
                        chatLogger.info('Final parse: applied filesystem edits', {
                          requestId: streamRequestId,
                          count: streamedEdits.applied.length,
                        });
                      }
                    } catch (editErr: any) {
                      // Disable batch mode on error
                      const { disableVFSBatchMode } = await import('@/lib/virtual-filesystem/git-backed-vfs');
                      disableVFSBatchMode(filesystemOwnerId);
                      chatLogger.warn('Post-stream filesystem edits failed', { requestId: streamRequestId, error: editErr.message });
                    }
                  }

                  // Send completion event with accumulated content AND filesystem metadata
                  const doneEventData: any = {
                    requestId: streamRequestId,
                    timestamp: Date.now(),
                    content: finalContent,
                    modelName: actualModel,
                  };

                  // Include filesystem metadata if files were applied
                  // CRITICAL FIX: Check BOTH filesystemEdits (pre-stream) AND streamedEdits (final parse)
                  if (allEdits && allEdits.applied.length > 0) {
                    doneEventData.filesystem = {
                      transactionId: allEdits.transactionId,
                      status: allEdits.status,
                      applied: allEdits.applied,
                      errors: allEdits.errors,
                      requestedFiles: allEdits.requestedFiles,
                      scopePath: allEdits.scopePath,
                      workspaceVersion: allEdits.workspaceVersion,
                      commitId: allEdits.commitId,
                      sessionId: allEdits.sessionId,
                    };

                    // CRITICAL FIX: Also include fileEdits array for enhanced-diff-viewer
                    // ROBUSTNESS: Don't assume WRITE=content, PATCH=diff
                    // Let EnhancedDiffViewer detect format using isDiffFormat()
                    doneEventData.fileEdits = (allEdits.applied as FilesystemEditSummary[])
                      .filter((edit) => {
                        // Skip invalid paths
                        if (!isValidFilePath(edit.path)) return false;
                        // Skip empty content/diff
                        const hasContent = edit.content && edit.content.trim().length > 0;
                        const hasDiff = edit.diff && edit.diff.trim().length > 0;
                        if (!hasContent && !hasDiff) return false;
                        return true;
                      })
                      .map(edit => {
                        // Determine what to send:
                        // - If edit.diff exists and looks like unified diff, send it
                        // - Otherwise send full content (EnhancedDiffViewer will auto-detect)
                        const diffToUse = edit.diff && edit.diff.trim().length > 0 && edit.diff.startsWith('---')
                          ? edit.diff
                          : undefined;
                        return {
                          path: edit.path,
                          operation: edit.operation || 'write',
                          content: edit.content || '',
                          diff: diffToUse,
                          version: edit.version,
                          previousVersion: edit.previousVersion,
                        };
                      });
                  }

                  const doneEvent = `event: done\ndata: ${JSON.stringify(doneEventData)}\n\n`;
                  safeEnqueue(encoderRef, controller, doneEvent);
                  chunkCount++;
                })();

                try {
                  await Promise.race([streamPromise, timeoutPromise]);
                } finally {
                  if (agentTimeoutId) clearTimeout(agentTimeoutId);
                }

                const streamDuration = Date.now() - streamStartTime;
                chatLogger.info('ToolLoopAgent stream completed', { requestId: streamRequestId }, {
                  chunkCount,
                  latencyMs: streamDuration,
                  contentLength: finalContent?.length || 0,
                });

                // FIX: Record telemetry with the ACTUAL provider/model (handles fallbacks)
                // Include content length for token efficiency scoring
                chatRequestLogger.logRequestComplete(
                  streamRequestId,
                  true,
                  undefined,
                  undefined,
                  streamDuration,
                  undefined,
                  actualProvider,
                  actualModel,
                  undefined, // ToolLoopAgent tools tracked separately
                  finalContent?.length || 0,
                ).catch((err) => chatLogger.warn('logRequestComplete failed (ToolLoopAgent)', { requestId: streamRequestId }, { error: String(err) }));

                // Store conversation in mem0 for persistent memory (fire-and-forget, non-blocking)
                if (isMem0Configured()) {
                  storeConversationInMem0(messages, finalContent, filesystemOwnerId, streamRequestId, {
                    sessionId: resolvedConversationId,
                    metadata: {
                      threadId: resolvedConversationId,
                      scopePath: scopePathForHybrid || undefined,
                      requestId: streamRequestId,
                      path: 'tool-loop',
                    },
                  }).catch((err) => chatLogger.warn('mem0 store failed (tool-loop path)', { requestId: streamRequestId }, { error: String(err) }));
                }

                // SPEC AMPLIFICATION: Trigger after ToolLoopAgent streaming completes
                // Runs AFTER final parse (inside stream callback) and FILE_EDIT events
                // OPTIMIZATION: Use O(1) hasFileEdits check instead of O(n×m) code marker search
                // Note: allEdits is set by final parse inside stream callback (line ~2165)
                // Also check for file edits from MCP tool execution (function calling path)
                const effectiveEdits = allEdits || filesystemEdits;
                const hasFileEdits = (effectiveEdits?.applied?.length || 0) > 0;
                const mcpFileEdits = getRecentMcpFileEdits(resolvedConversationId);
                const hasMcpFileEdits = mcpFileEdits.length > 0;
                const isSpecAmplificationMode = ['enhanced', 'max', 'super'].includes(String(routerRequest.mode));
                // Only trigger spec amplification when there are ACTUAL filesystem edits,
                // not just because the response contains code snippets (const, function, etc.)
                const shouldRunSpecAmplification = (hasFileEdits || hasMcpFileEdits) &&
                  isSpecAmplificationMode &&
                  !clientResponse.metadata?.specAmplificationRun;

                chatLogger.info('Spec amplification check (ToolLoopAgent stream)', {
                  requestId: streamRequestId,
                  hasFileEdits,
                  hasMcpFileEdits,
                  mcpFileEditCount: mcpFileEdits.length,
                  mode: routerRequest.mode,
                  isSpecAmplificationMode,
                  specAmplificationRun: clientResponse.metadata?.specAmplificationRun,
                  shouldRunSpecAmplification,
                });

                if (shouldRunSpecAmplification) {
                  chatLogger.info('Code/file edits detected, triggering spec amplification (ToolLoopAgent path)', {
                    requestId: streamRequestId,
                    finalContentLength: finalContent.length,
                    mcpFileEdits: hasMcpFileEdits ? mcpFileEdits.map(e => e.path) : undefined,
                  });

                  // Trigger spec amplification in background - events stream via emitRef.current
                  const { responseRouter } = await import('@/lib/api/response-router');
                  const specRequest = {
                    ...routerRequest,
                    messages: [
                      ...messages,
                      { role: 'assistant' as const, content: finalContent },
                    ],
                    mode: routerRequest.mode || 'enhanced',
            specChain: routerRequest.specChain,
                    emit: emitRef.current,  // CRITICAL: Pass emit function so spec amp events reach client
                  };

                  responseRouter.routeWithSpecAmplification(specRequest).catch(err => {
                    chatLogger.warn('Post-stream spec amplification failed', { error: err?.message });
                  });
                } else {
                  chatLogger.debug('Spec amplification NOT triggered (ToolLoopAgent path)', {
                    requestId: streamRequestId,
                    reason: !(hasFileEdits || hasMcpFileEdits) ? 'no filesystem edits' :
                            !isSpecAmplificationMode ? `mode is ${routerRequest.mode}` :
                            clientResponse.metadata?.specAmplificationRun ? 'already run' : 'unknown',
                  });
                }
                // Clear tracker after check to prevent stale data
                clearRecentMcpFileEdits(resolvedConversationId);

                controller.close();
              } catch (error) {
                const streamDuration = Date.now() - streamStartTime;
                chatLogger.error('ToolLoopAgent streaming error', { requestId: streamRequestId, provider: actualProvider, model: actualModel }, {
                  error: error instanceof Error ? error.message : String(error),
                  chunkCount,
                  latencyMs: streamDuration,
                });

                if (!request.signal?.aborted) {
                  const errorEvent = `event: error\ndata: ${JSON.stringify({
                    requestId: streamRequestId,
                    message: 'Streaming error occurred',
                    canRetry: true,
                  })}\n\n`;
                  safeEnqueue(encoderRef, controller, errorEvent);
                }
                controller.close();
              } finally {
                cleanup();
              }
            },
            cancel(reason?: unknown) {
              const streamDuration = Date.now() - streamStartTime;
              chatLogger.info('SSE stream cancelled by client disconnect', { requestId: streamRequestId }, {
                reason: typeof reason === 'string' ? reason : (reason instanceof Error ? reason.message : String(reason)),
                chunkCount,
                latencyMs: streamDuration,
              });
            }
          });

          return new Response(readableStream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-store, must-revalidate",
              Pragma: "no-cache",
              Expires: "0",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
              "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || '',
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization, x-anonymous-session-id",
              "Vary": "Origin",
              ...(anonSessionIdToSet ? {
                "Set-Cookie": `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
              } : {}),
            },
          });
        }

        // Fallback: Standard streaming (non-agent or ToolLoopAgent not available)
        // Create streaming events from unified response with faster initial text display

        // Process filesystem edits for streaming path
        // Note: filesystemEdits already declared at function scope (line ~1120)
        if (enableFilesystemEdits) {
          try {
            // Enable batch mode to prevent circular Git commits during bulk file writes
            const { enableVFSBatchMode, flushVFSBatchMode } = await import('@/lib/virtual-filesystem/git-backed-vfs');
            enableVFSBatchMode(filesystemOwnerId);

            filesystemEdits = await applyFilesystemEditsFromResponse({
              ownerId: filesystemOwnerId,
              conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
              requestId: streamRequestId,
              scopePath: requestedScopePath,
              lastUserMessage: (() => {
                const content = [...messages].reverse().find((message) => message.role === 'user')?.content;
                return typeof content === 'string' ? content : '';
              })(),
              attachedPaths: attachedFilesystemFiles.map((file) => file.path),
              responseContent: clientResponse.content || unifiedResponse.content || '',
              commands: unifiedResponse.commands,
              alreadyWrittenPaths,
            });
            
            // Flush batch mode to commit all changes at once
            await flushVFSBatchMode(filesystemOwnerId);
            
            chatLogger.debug('Filesystem edits processed (streaming path)', { 
              requestId: streamRequestId, 
              appliedCount: filesystemEdits?.applied?.length || 0 
            });
          } catch (error) {
            chatLogger.warn('Filesystem edits failed (streaming path)', { error });
          }
        }
        
        const events = responseRouter.createStreamingEvents(clientResponse, streamRequestId, {
          includeReasoning: true,
          includeToolState: true,
          includeFilesystem: true,
          includeDiffs: true,
          chunkSize: 8, // Smaller chunks for smoother progressive display
          emitPrimaryContentImmediately: true, // NEW: Show first 16 chars immediately for faster perceived response
        });
        const supplementalAgenticEvents = buildSupplementalAgenticEvents(clientResponse, streamRequestId, events);
        if (supplementalAgenticEvents.length > 0) {
          events.splice(Math.max(0, events.length - 1), 0, ...supplementalAgenticEvents);
        }
        
        // Add progressive FILE_EDIT events for VFS sync (terminal, file explorer, etc.)
        const fileEditEvents: string[] = [];
        if (filesystemEdits && filesystemEdits.applied.length > 0) {
          for (const edit of filesystemEdits.applied) {
            // Validate path before emitting file edit events
            if (!isValidFilePath(edit.path)) {
              chatLogger.debug('Skipping invalid path from filesystemEdits.applied', { path: edit.path });
              continue;
            }
            // CRITICAL FIX: Determine operation type and send correct data format
            // Check for diff field to determine if it's a patch operation
            const hasDiff = !!(edit as any).diff;
            const isPatch = edit.operation === 'patch' || hasDiff;
            fileEditEvents.push(`event: file_edit\ndata: ${JSON.stringify({
              requestId: streamRequestId,
              path: edit.path,
              status: 'detected',
              operation: isPatch ? 'patch' : edit.operation,
              content: (edit as any).content || '',
              diff: isPatch ? ((edit as any).diff || '') : undefined,
              timestamp: Date.now(),
            })}\n\n`);
          }
        }
        
        if (
          filesystemEdits &&
          (filesystemEdits.applied.length > 0 ||
            filesystemEdits.errors.length > 0 ||
            (filesystemEdits?.requestedFiles?.length ?? 0) > 0)
        ) {
          const filesystemEvent = `event: filesystem\ndata: ${JSON.stringify({
            requestId: streamRequestId,
            transactionId: filesystemEdits.transactionId,
            status: filesystemEdits.status,
            applied: filesystemEdits.applied,
            errors: filesystemEdits.errors,
            requestedFiles: filesystemEdits?.requestedFiles ?? [],
            scopePath: filesystemEdits.scopePath,
            workspaceVersion: filesystemEdits.workspaceVersion,
            commitId: filesystemEdits.commitId,
            sessionId: filesystemEdits.sessionId,
          })}\n\n`;
          events.splice(Math.max(0, events.length - 1), 0, filesystemEvent);
        }

        // Bug #9 Fix: hasFilesystemEdits should be true only when there are actual filesystem write events
        // Not just when the function ran (enableFilesystemEdits was true)
        const hasActualFilesystemEdits = filesystemEdits &&
          (filesystemEdits.applied.length > 0 || (filesystemEdits?.requestedFiles?.length ?? 0) > 0);
        chatLogger.info('Starting streaming response', { requestId: streamRequestId, provider: actualProvider, model: actualModel }, {
          eventsCount: events.length,
          hasFilesystemEdits: hasActualFilesystemEdits,
          appliedEditsCount: filesystemEdits?.applied?.length || 0,
          requestedFilesCount: filesystemEdits?.requestedFiles?.length || 0,
        });

        const encoder = new TextEncoder();
        let encoderRef: TextEncoder | null = encoder;  // Reference for cleanup
        let streamClosed = false;  // Track stream state for cancel callback
        let refinementTimeoutId: NodeJS.Timeout | null = null;  // Timeout for background refinement

        // Cleanup function for resource management (defined here for cancel callback access)
        const cleanup = () => {
          encoderRef = null;
          emitRef.current = null;
          if (refinementTimeoutId) {
            clearTimeout(refinementTimeoutId);
            refinementTimeoutId = null;
          }
        };

        // Activity tracking for timeout management
        let lastActivityTime = Date.now();
        const ACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
        const updateActivity = () => {
          lastActivityTime = Date.now();
        };

        const readableStream = new ReadableStream({
          async start(controller) {
            // Set up real emit that writes directly to stream controller
            // Keep reference for background refinement to use
            const realEmit = (eventType: string, data: any) => {
              if (request.signal?.aborted || streamClosed) return;
              
              // Update activity timestamp on any emission
              updateActivity();
              
              const eventStr = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
              if (encoderRef) safeEnqueue(encoderRef, controller, eventStr);
              chunkCount++;

              // Close stream when refinement completes (true terminal states only)
              // Note: 'task_complete' is emitted per-task, NOT terminal - don't close on it
              if (eventType === 'spec_amplification') {
                const isTerminal =
                  data.stage === 'complete' ||
                  data.stage === 'complete_with_timeouts' ||
                  data.stage === 'error' ||
                  data.stage === 'spec_failed' ||
                  data.stage === 'parse_failed' ||
                  data.stage === 'validation_failed' ||
                  data.stage === 'low_quality';

                if (isTerminal) {
                  streamClosed = true;
                  // Clear the timeout since we completed normally
                  if (refinementTimeoutId) {
                    clearTimeout(refinementTimeoutId);
                    refinementTimeoutId = null;
                  }
                  controller.close();
                  cleanup();
                }
              }
            };

            // Replace placeholder emit with real emit - background refinement will now stream directly
            emitRef.current = realEmit;

            // Flush any pending events that arrived before stream started
            for (const pending of pendingEvents) {
              realEmit(pending.event, { requestId: streamRequestId, ...pending.data, timestamp: pending.timestamp });
            }
            pendingEvents.splice(0, pendingEvents.length);

            // Handle client disconnect
            if (request.signal) {
              request.signal.addEventListener('abort', () => {
                if (!streamClosed) {
                  streamClosed = true;
                  cleanup();
                }
                const streamDuration = Date.now() - streamStartTime;
                chatLogger.warn('Stream cancelled by client', { requestId: streamRequestId, provider: actualProvider, model: actualModel }, {
                  chunkCount,
                  latencyMs: streamDuration,
                });
              });
            }

            try {
              // Separate metadata events from content tokens for better streaming UX
              // Include sandbox_output for stdout/stderr from code execution
              const metadataEvents = events.filter(e =>
                e.includes('event: init') ||
                e.includes('event: reasoning') ||
                e.includes('event: tool_invocation') ||
                e.includes('event: step') ||
                e.includes('event: filesystem') ||
                e.includes('event: diffs') ||
                e.includes('event: sandbox_output') ||
                e.includes('event: spec_amplification')  // Include spec amplification progress
              );
              const tokenEvents = events.filter(e => e.includes('event: token'));
              const doneEvent = events.find(e => e.includes('event: done'));

              // Send metadata events first (quick succession)
              for (const event of metadataEvents) {
                if (request.signal?.aborted || streamClosed) {
                  cleanup();
                  return;
                }
                safeEnqueue(encoderRef, controller, event);
                chunkCount++;
              }

              // Send FILE_EDIT events for VFS sync (before content tokens)
              for (const fileEditEvent of fileEditEvents) {
                if (request.signal?.aborted || streamClosed) {
                  cleanup();
                  return;
                }
                safeEnqueue(encoderRef, controller, fileEditEvent);
                chunkCount++;
              }

              const totalTokens = tokenEvents.length;

              // OPTIMIZED: Faster streaming for better perceived performance
              // Reduced delays while maintaining natural "typing" rhythm
              const baseDelay = totalTokens > 500 ? 0 : totalTokens > 200 ? 1 : totalTokens > 100 ? 2 : 3;

              for (let i = 0; i < totalTokens; i++) {
                if (request.signal?.aborted || streamClosed) {
                  cleanup();
                  return;
                }

                const event = tokenEvents[i];
                // Skip enqueue if stream was closed by spec_amplification event
                if (streamClosed) {
                  return;
                }
                safeEnqueue(encoderRef, controller, event);
                chunkCount++;

                // OPTIMIZED: Minimal delays for faster text display
                // First 10 tokens: almost instant (feels responsive)
                // Middle section: slight rhythm (feels natural)
                // Final tokens: fast completion
                let delay: number;
                if (i < 10) {
                  delay = 0; // No delay for initial tokens - instant gratification
                } else if (i < 50) {
                  delay = baseDelay; // Minimal delay for early streaming
                } else if (i < totalTokens * 0.7) {
                  delay = baseDelay + 1; // Slight rhythm in middle
                } else {
                  delay = 0; // Fast finish at the end
                }

                delay = Math.max(0, Math.min(delay, 3)); // Cap at 3ms max

                if (delay > 0) {
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }

              // Send primary_done event for PRIMARY response completion
              // This signals UI that primary response is ready, but stream stays open for background refinement
              // DON'T close stream yet - background refinement may still be running
              if (doneEvent) {
                // Replace 'done' with 'primary_done' to avoid triggering client stream close
                const primaryDoneEvent = doneEvent.replace(/^event:\s*done/m, 'event: primary_done');
                safeEnqueue(encoderRef, controller, primaryDoneEvent);
                chunkCount++;
              }

              const streamDuration = Date.now() - streamStartTime;
              chatLogger.info(
                SPEC_AMPLIFICATION_STREAM_EVENTS_ENABLED
                  ? 'Primary response stream completed, waiting for background refinement'
                  : 'Primary response stream completed',
                {
                requestId: streamRequestId, 
                provider: actualProvider, 
                model: actualModel 
              }, {
                chunkCount,
                latencyMs: streamDuration,
                eventsCount: events.length,
                tokenCount: tokenEvents.length,
              });

              // Store conversation in mem0 for persistent memory (fire-and-forget, non-blocking)
              // Use clientResponse.content for the fallback streaming path
              if (isMem0Configured() && clientResponse.content) {
                storeConversationInMem0(messages, clientResponse.content, filesystemOwnerId, streamRequestId, {
                  sessionId: resolvedConversationId,
                  metadata: {
                    threadId: resolvedConversationId,
                    scopePath: scopePathForHybrid || undefined,
                    requestId: streamRequestId,
                    path: 'fallback-streaming',
                  },
                }).catch((err) => chatLogger.warn('mem0 store failed (fallback-streaming)', { requestId: streamRequestId }, { error: String(err) }));
              }

              // Log provider latency for observability
              chatLogger.debug(`Provider ${actualProvider} streaming complete`, {
                latencyMs: streamDuration,
                success: true,
                model: actualModel,
              });

              // FIX: Record telemetry with the ACTUAL provider/model (not the originally requested one)
              // This ensures fallback model latency is tracked under the correct model name
              chatRequestLogger.logRequestComplete(
                streamRequestId,
                true,
                undefined,
                undefined,
                streamDuration,
                undefined,
                actualProvider,
                actualModel,
                undefined, // Tool calls tracked separately in agentic path
                clientResponse.content?.length || 0,
              ).catch((err) => chatLogger.warn('logRequestComplete failed (fallback-streaming)', { requestId: streamRequestId }, { error: String(err) }));

              if (!SPEC_AMPLIFICATION_STREAM_EVENTS_ENABLED) {
                streamClosed = true;
                controller.close();
                cleanup();
                return;
              }

              // SPEC AMPLIFICATION: Will be triggered after primary response completes
              // Check happens inside the stream callback where streamState.buffer is available
              // See line ~2520 for spec amplification trigger (inside stream callback)

              // Stream stays open for background refinement events
              // The emit function will close the stream when refinement completes
              // Add timeout fallback in case refinement never completes
              // EXTENDED: 30 minutes to allow long file editing sessions (87 tool calls for 27 files)
              // Activity-based: timeout only triggers if no activity for 30 minutes
              // Periodic check for inactivity (every 30 seconds)
              const activityCheckInterval = setInterval(() => {
                const inactiveTime = Date.now() - lastActivityTime;
                if (inactiveTime >= ACTIVITY_TIMEOUT_MS && !streamClosed) {
                  chatLogger.warn('Background refinement timeout due to inactivity', {
                    requestId: streamRequestId,
                    inactiveTimeMs: inactiveTime
                  });
                  streamClosed = true;
                  controller.close();
                  cleanup();
                  clearInterval(activityCheckInterval);
                }
              }, 30000); // Check every 30 seconds
              
              // Store interval ID for cleanup
              refinementTimeoutId = activityCheckInterval as any;

            } catch (error) {
              const streamDuration = Date.now() - streamStartTime;
              chatLogger.error('Streaming error', { requestId: streamRequestId, provider: actualProvider, model: actualModel }, {
                error: error instanceof Error ? error.message : String(error),
                chunkCount,
                latencyMs: streamDuration,
                success: false,
              });

              // Only send error event if client hasn't disconnected
              if (!request.signal?.aborted) {
                const errorEvent = `event: error\ndata: ${JSON.stringify({
                  requestId: streamRequestId,
                  message: 'Streaming error occurred',
                  canRetry: true  // Changed to true - most errors are retryable
                })}\n\n`;
                safeEnqueue(encoderRef, controller, errorEvent);
                chunkCount++;
              }
              streamClosed = true;
              controller.close();
              cleanup();
            }
          },
          cancel(reason?: unknown) {
            if (!streamClosed) {
              streamClosed = true;
              cleanup();
            }
            const streamDuration = Date.now() - streamStartTime;
            chatLogger.info('SSE stream cancelled by client disconnect', { requestId: streamRequestId, provider: actualProvider, model: actualModel }, {
              reason: typeof reason === 'string' ? reason : (reason instanceof Error ? reason.message : String(reason)),
              chunkCount,
              latencyMs: streamDuration,
            });
          }
        });

        return new Response(readableStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || '',
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-anonymous-session-id",
            "Vary": "Origin",
            ...(anonSessionIdToSet ? {
              "Set-Cookie": `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
            } : {}),
          },
        });
      }

      // Handle non-streaming response
      const responseLatency = Date.now() - requestStartTime;
      chatLogger.info('Non-streaming response completed', { requestId, provider: actualProvider, model: actualModel }, {
        latencyMs: responseLatency,
        contentLength: clientResponse.content?.length || 0,
        success: clientResponse.success,
      });

      // FIX: Record telemetry with the ACTUAL provider/model (handles fallbacks)
      // Include content length for token efficiency scoring
      chatRequestLogger.logRequestComplete(
        requestId,
        clientResponse.success,
        undefined,
        undefined,
        responseLatency,
        clientResponse.success ? undefined : (clientResponse.error || 'Non-streaming response failed'),
        actualProvider,
        actualModel,
        undefined, // No tool calls in non-streaming path
        clientResponse.content?.length || 0,
      ).catch((err) => chatLogger.warn('logRequestComplete failed (non-streaming)', { requestId }, { error: String(err) }));

      // Store conversation in mem0 for persistent memory (fire-and-forget, non-blocking)
      // This runs after the response is sent to not delay the client
      const responseContentForMemory = clientResponse.content || '';
      if (isMem0Configured()) {
        storeConversationInMem0(messages, responseContentForMemory, filesystemOwnerId, requestId, {
          sessionId: resolvedConversationId,
          metadata: {
            threadId: resolvedConversationId,
            scopePath: scopePathForHybrid || undefined,
            requestId,
            path: 'non-streaming',
          },
        }).catch((err) => chatLogger.warn('mem0 store failed (non-streaming)', { requestId }, { error: String(err) }));
      }

      const responseStatus = clientResponse.success ? 200 : 500;
      return addAnonSessionCookie(NextResponse.json(
        {
          success: clientResponse.success,
          data: clientResponse.data,
          commands: clientResponse.commands,
          filesystem: filesystemEdits,
          metadata: { ...clientResponse.metadata, modelName: actualModel },
          timestamp: clientResponse.metadata?.timestamp,
          modelName: actualModel,
        },
        { status: responseStatus }
      ));
    } catch (routerError) {
      const routerErrorObj = routerError as Error;
      const routerLatency = Date.now() - requestStartTime;
      const isNotConfigured = routerErrorObj.message.includes('not configured');

      if (!isNotConfigured) {
        chatLogger.error('Router error', { requestId, provider, model }, {
          error: routerErrorObj.message,
          latencyMs: routerLatency,
        });
      } else {
        chatLogger.warn('No providers configured', { requestId, provider, model }, {
          latencyMs: routerLatency,
        });
      }

      // Emergency fallback - return friendly error with proper status
      return addAnonSessionCookie(NextResponse.json({
        success: false, // Indicate failure so UI can show error state
        error: {
          type: 'router_error',
          message: 'All providers failed to process request',
          isRetryable: true
        },
        data: {
          content: "I apologize, but I'm experiencing technical difficulties. Try again in a moment.",
          provider: 'emergency-fallback',
          model: 'fallback',
          isFallback: true
        },
        timestamp: new Date().toISOString()
      }, { status: 503 })); // Service Unavailable - indicates temporary issue
    } finally {
      // Only clear pendingEvents and emitter for non-streaming responses
      // Streaming responses handle cleanup in the stream's finally block
      if (!(stream && selectedProvider.supportsStreaming)) {
        acceptDeferredEvents = false;
        pendingEvents.splice(0, pendingEvents.length);
        emitRef.current = null;
      }
    }
  } catch (error) {
    const errorLatency = Date.now() - requestStartTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNotConfiguredError = errorMessage.includes('not configured');

    if (!isNotConfiguredError) {
      chatLogger.error('Critical chat API error', { requestId, provider: actualProvider, model: actualModel }, {
        error: errorMessage,
        latencyMs: errorLatency,
        success: false,
        stack: error instanceof Error ? error.stack : undefined,
      });
    } else {
      chatLogger.warn('Provider not available', { requestId, provider: actualProvider, model: actualModel }, {
        error: errorMessage,
        latencyMs: errorLatency,
        success: false,
      });
    }

    // Process error with enhanced error handler for logging
    // STALL-524 OUTERCATCH gap fix: route a StallWatchdogError class instance
    // to status 524 BEFORE the generic errorHandler fallback below converts to 500.
    // This branch is the additive counterpart to the inner-catch `isServerStall`
    // check at L2790-L2835. When the chain-walk's abort cascade escapes the
    // inner catch (e.g. addAnonSessionCookie throws on undefined
    // anonSessionIdToSet, or the inner catch is bypassed for one of the
    // other dispatch branches), the typed-discriminator here ensures the
    // response status is still 524, never 500. Companion ticket:
    // bing/.tickets/STALL-524-OUTERCATCH-GAP.md.
    if (error instanceof StallWatchdogError) {
      return addAnonSessionCookie(
        NextResponse.json(
          {
            error: error.message,
            reason: 'stall-watchdog',
            requestId,
            stitchedFromWatchDog: true,
          },
          {
            status: 524,
            headers: {
              'content-type': 'application/json',
              'x-stall-fired': 'true',
              'x-stall-reason': 'stall-watchdog',
            },
          },
        ),
      );
    }

    const processedError = errorHandler.processError(
      error instanceof Error ? error : new Error(String(error)),
      {
        component: 'chat-api',
        operation: 'generateResponse',
        provider,
        model,
        requestId,
        timestamp: Date.now()
      }
    );

    // Return friendly response with proper error status
    return addAnonSessionCookie(NextResponse.json(
      {
        success: false, // Indicate failure for proper error handling
        error: {
          type: 'critical_error',
          code: processedError.code,
          message: 'Critical system error occurred',
          isRetryable: processedError.severity !== 'high'
        },
        data: {
          content: "I apologize, but I'm experiencing technical difficulties right now. Our team has been notified and is working to resolve the issue. Please try again in a few moments.",
          provider: 'critical-fallback',
          model: 'fallback',
          isFallback: true,
          fallbackReason: 'critical_error'
        },
        timestamp: new Date().toISOString()
      },
      { status: 500 }, // Internal Server Error - indicates server-side issue
    ));
  }
}

interface ChatFilesystemFileContext {
  path: string;
  content: string;
  language?: string;
}

interface ChatFilesystemContextPayload {
  attachedFiles?: ChatFilesystemFileContext[] | Record<string, { content: string; language?: string }>;
  applyFileEdits?: boolean;
  scopePath?: string;
}

interface FilesystemEditResult {
  transactionId: string | null;
  status: 'auto_applied' | 'accepted' | 'denied' | 'reverted_with_conflicts' | 'none';
  applied: FilesystemEditSummary[];
  errors: string[];
  requestedFiles: Array<{ path: string; content: string; language: string; version: number }>;
  scopePath?: string;
  workspaceVersion?: number;
  commitId?: string;
  sessionId?: string;
  /** Bug #48: text-mode edits for paths already written by structured tool calls,
   * staged for LLM review on next turn. */
  pendingEdits?: Array<{
    path: string;
    content: string;
    type: 'write' | 'diff';
    diffBody?: string;
    reason: string;
  }>;
}

function normalizeFilesystemContext(
  input: ChatFilesystemContextPayload['attachedFiles'],
): ChatFilesystemFileContext[] {
  if (!input) return [];

  if (Array.isArray(input)) {
    return input
      .filter((entry): entry is ChatFilesystemFileContext => {
        return typeof entry?.path === 'string' && typeof entry?.content === 'string';
      })
      .map((entry) => ({
        path: entry.path,
        content: entry.content,
        language: entry.language,
      }));
  }

  if (typeof input === 'object') {
    return Object.entries(input)
      .map(([path, file]) => ({
        path,
        content: typeof file?.content === 'string' ? file.content : '',
        language: file?.language,
      }))
      .filter((entry) => !!entry.path && !!entry.content);
  }

  return [];
}

function shouldHandleFilesystemEdits(
  messages: LLMMessage[],
  attachedFiles: ChatFilesystemFileContext[],
  filesystemContext?: ChatFilesystemContextPayload,
): boolean {
  if (filesystemContext?.applyFileEdits === false) {
    return false;
  }

  if (attachedFiles.length > 0) {
    return true;
  }

  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content;
  if (typeof lastUserMessage !== 'string') {
    return false;
  }

  return /\b(file|files|code|edit|patch|create|write|update|workspace|program|build|run|execute|install|scaffold|component|page|app|module|function|class)\b/i.test(lastUserMessage);
}

/**
 * Detect if user is requesting a comprehensive context pack
 * Look for keywords suggesting they want full workspace context
 */
function shouldUseContextPack(messages: LLMMessage[]): boolean {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content;
  if (typeof lastUserMessage !== 'string') {
    return false;
  }

  return CONTEXT_PACK_PATTERN.test(lastUserMessage);
}

/**
 * Handle non-streaming request via agent gateway
 */
async function handleGatewayRequest(params: {
  gatewayUrl: string;
  userId: string;
  conversationId: string;
  task: string;
  context?: string;
  model?: string;
}): Promise<any> {
  const { gatewayUrl, userId, conversationId, task, context, model } = params;

  try {
    // Create job via gateway
    const jobResponse = await fetch(`${gatewayUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        conversationId,
        prompt: task,
        context,
        model,
      }),
    });

    if (!jobResponse.ok) {
      throw new Error(`Gateway error: ${jobResponse.statusText}`);
    }

    const { jobId, sessionId } = await jobResponse.json();

    const result = await pollWithBackoff(
      async () => {
        const statusResponse = await fetch(`${gatewayUrl}/jobs/${jobId}`);
        if (!statusResponse.ok) return null;
        const jobStatus = await statusResponse.json();
        if (jobStatus.status === 'failed') {
          throw new Error(jobStatus.error || 'Job failed');
        }
        return jobStatus;
      },
      (status) => status.status === 'completed',
      { maxWaitMs: 120000 }
    );

    return {
      success: true,
      data: result,
      sessionId,
      jobId,
    };
  } catch (error: any) {
    chatLogger.error('Gateway request failed', {}, { error: error.message });
    throw error;
  }
}

/**
 * Handle streaming request via agent gateway
 */
async function handleGatewayStreaming(params: {
  gatewayUrl: string;
  userId: string;
  conversationId: string;
  task: string;
  context?: string;
  requestId: string;
  anonSessionIdToSet?: string;
}): Promise<Response> {
  const { gatewayUrl, userId, conversationId, task, context, requestId, anonSessionIdToSet } = params;

  // Create job first
  const jobResponse = await fetch(`${gatewayUrl}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      conversationId,
      prompt: task,
      context,
    }),
  });

  if (!jobResponse.ok) {
    throw new Error(`Gateway error: ${jobResponse.statusText}`);
  }

  const { sessionId } = await jobResponse.json();
  chatLogger.info('Created gateway job', { requestId, sessionId });

  // Stream events from gateway
  const streamResponse = await fetch(`${gatewayUrl}/stream/${sessionId}`);

  if (!streamResponse.ok || !streamResponse.body) {
    throw new Error(`Gateway stream error: ${streamResponse.statusText}`);
  }

  // Transform gateway events to our SSE format
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const parser = createNDJSONParser();

  const readableStream = new ReadableStream({
    async start(controller) {
      const reader = streamResponse.body?.getReader();
  if (!reader) {
    // Bug #X: signal a stream error via controller.error() instead of throwing.
    // Throwing inside ReadableStream.start() crashes the stream without
    // surfacing the error to the client. signalStreamError() wraps the
    // controller.error() call and returns a sentinel so the caller can
    // `return` it directly. See bing/web/lib/chat/stream-safety-helpers.ts
    // for the behavioral test coverage.
    return signalStreamError(controller, 'No response body reader available from gateway stream');
  }

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          // Decode chunk and parse complete NDJSON lines
          const chunk = decoder.decode(value, { stream: true });

          // Parse NDJSON and re-emit as SSE
          const events = parser.parse(chunk);
          
          if (events.length > 0) {
            // Successfully parsed NDJSON events - normalize to chat SSE format
            for (const event of events) {
              // Convert gateway event to chat SSE format
              // The chat client expects: data: {...}\n\n with choices[0].delta.content for streaming
              if (event.type === 'token' || event.type === 'message' || event.type === 'delta') {
                const content =
                  typeof event.data?.content === 'string'
                    ? event.data.content
                    : typeof event.content === 'string'
                      ? event.content
                      : typeof event.delta === 'string'
                        ? event.delta
                        : '';
                const sseData = {
                  choices: [{
                    delta: { content }
                  }]
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(sseData)}\n\n`));
              } else if (event.type === 'done' || event.type === 'complete') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              }
            }
          } else {
            // No events parsed - NDJSON parser buffers incomplete lines
            // Only consider this an error AFTER stream finalization or explicit parser error
            // Skip transient/partial reads like "[]", empty buffers, or incomplete JSON
            // Let the parser signal end/error explicitly rather than inferring from chunk content
          }
        }
      } catch (error) {
        chatLogger.error('Stream error', { requestId }, { error: String(error) });
        // Send SSE error event BEFORE controller.error() so the client receives
        // a structured error (matching the V2 path at line ~4712). Without this,
        // the client only sees a raw stream rejection via controller.error() with
        // no event: error payload, making it harder to show a user-facing message.
        try {
          const errMsg = error instanceof Error ? error.message : String(error);
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: errMsg, canRetry: true })}\n\n`));
        } catch {
          // best-effort — stream may already be closing
        }
        controller.error(error);
      }
    },
    cancel(reason?: unknown) {
      chatLogger.info('SSE stream cancelled by client disconnect', {
        requestId,
        reason: typeof reason === 'string' ? reason : (reason instanceof Error ? reason.message : String(reason)),
      });
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(anonSessionIdToSet ? {
        'Set-Cookie': `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
      } : {}),
    },
  });
}

async function buildWorkspaceSessionContext(
  ownerId: string,
  scopePath?: string,
  options?: { useContextPack?: boolean; maxTokens?: number }
): Promise<string> {
  // Use context pack if requested and available - includes file contents!
  if (options?.useContextPack) {
    try {
      // Quick gate: check if workspace has any files before expensive generation
      const quickList = await virtualFilesystem.listDirectory(ownerId, scopePath || '/');
      const hasFiles = (quickList.nodes || []).some(n => n.type === 'file');
      if (!hasFiles && (quickList.nodes || []).length === 0) {
        return [
          `=== WORKSPACE CONTEXT ===`,
          `Root: ${scopePath || '/'}`,
          `No files in workspace yet. Create files by asking me to build something.`,
        ].join('\n');
      }

      const contextPack = await contextPackService.generateContextPack(ownerId, scopePath || '/', {
        format: 'plain',
        includeContents: true,
        includeTree: true,
        maxFileSize: 50 * 1024, // 50KB per file
        maxLinesPerFile: 200,
        maxTotalSize: options.maxTokens ? options.maxTokens * 4 : 500 * 1024, // ~500KB default
        excludePatterns: [
          'node_modules/**',
          '.git/**',
          '.next/**',
          'dist/**',
          'build/**',
          '*.log',
          '*.lock',
          '.env*',
        ],
      });
      
      return [
        `=== WORKSPACE CONTEXT (Context Pack - Full File Contents) ===`,
        `Root: ${scopePath || '/'}`,
        `Files: ${contextPack.fileCount}`,
        `Directories: ${contextPack.directoryCount}`,
        `Estimated Tokens: ${contextPack.estimatedTokens}`,
        contextPack.hasTruncation ? `⚠️ Some files were truncated` : '',
        '',
        contextPack.bundle,
      ].filter(Boolean).join('\n');
    } catch (error: unknown) {
      chatLogger.warn('[Chat] Context pack generation failed, falling back to basic context:', { error: error instanceof Error ? error.message : String(error) });
      // Fall through to enhanced context with key file contents
    }
  }
  
  // Enhanced workspace context with key file contents for editing
  try {
    const snapshot = await virtualFilesystem.exportWorkspace(ownerId);
    const scopedFiles = scopePath
      ? snapshot.files.filter((file) => file.path === scopePath || file.path.startsWith(`${scopePath}/`))
      : snapshot.files;
    
    if (scopedFiles.length === 0) {
      return 'Workspace is currently empty.';
    }

    // Identify key files that might need editing (source code, config, etc.)
    // Exclude ALL .env files to prevent secret leakage into LLM prompts
    const keyExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.py', '.vue', '.svelte', '.html', '.css', '.md', '.yaml', '.yml', 'Dockerfile', 'docker-compose.yml', '.env.example'];
    const keyFiles = scopedFiles
      .filter(f => keyExtensions.some(ext => f.path.toLowerCase().endsWith(ext) || f.path.toLowerCase().includes('dockerfile')))
      .filter(f => {
        // Block all .env* files including .env, .env.local, .env.production, etc.
        const pathLower = f.path.toLowerCase();
        if (pathLower.includes('.env')) {
          // Allow .env.example but block all other .env files
          return pathLower.endsWith('.env.example');
        }
        return true;
      })
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 30); // Limit to 30 key files to avoid token explosion

    const MAX_FILE_SIZE = 8000; // Max chars per file to include
    const MAX_TOTAL_CHARS = options?.maxTokens ? options.maxTokens * 4 : 50000; // Respect maxTokens if provided (4 chars ≈ 1 token)
    const fileContents: string[] = [];
    
    // Read files in parallel for better performance
    const fileReadResults = await Promise.allSettled(
      keyFiles.map(async (file) => {
        const fileData = await virtualFilesystem.readFile(ownerId, file.path);
        const content = fileData.content || '';
        const truncatedContent = content.length > MAX_FILE_SIZE 
          ? content.slice(0, MAX_FILE_SIZE) + '\n\n[...truncated...]'
          : content;
        return {
          path: file.path,
          content: truncatedContent,
          success: true
        };
      })
    );
    
    let failedReads = 0;
    for (const result of fileReadResults) {
      if (result.status === 'fulfilled') {
        const { path, content } = result.value;
        fileContents.push(
          `### FILE: ${path}`,
          '```' + (path.endsWith('.json') ? 'json' : path.endsWith('.ts') || path.endsWith('.tsx') ? 'typescript' : path.endsWith('.py') ? 'python' : ''),
          content,
          '```'
        );
      } else {
        failedReads++;
      }
    }
    if (failedReads > 0) {
      fileContents.push(`\n(${failedReads} additional files could not be read)`);
    }

    // Also include file tree for remaining files
    const remainingFiles = scopedFiles
      .filter(f => !keyFiles.includes(f))
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 100);

    const clipped = scopedFiles.length > 130;
    return [
      `=== WORKSPACE CONTEXT (Files with Contents + Tree) ===`,
      `Workspace root: ${snapshot.root}`,
      `Workspace version: ${snapshot.version}`,
      scopePath ? `Active scope: ${scopePath}` : '',
      `Key source files (${keyFiles.length} - full contents for editing):`,
      '',
      ...fileContents,
      '',
      remainingFiles.length > 0 ? `Other files (${remainingFiles.length}):` : '',
      ...remainingFiles.map((path) => `- ${path}`),
      clipped ? `- ... (${scopedFiles.length - 130} more files)` : '',
    ]
      .filter(Boolean)
      .join('\n');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return `Workspace context unavailable: ${message}`;
  }
}

/**
 * Hybrid workspace context — combines AST-based symbol retrieval with existing
 * smart-context fallback. No breaking changes to existing behavior.
 *
 * When the vector store has indexed symbols for this workspace, uses the
 * high-precision 7-signal ranking. Falls back to smart-context keyword scoring
 * when no symbols are available.
 */
async function buildHybridWorkspaceContext(
  ownerId: string,
  scopePath?: string,
  opts?: {
    prompt?: string;
    projectId?: string;
    explicitFiles?: string[];
    maxTokens?: number;
    tabId?: string;
  }
): Promise<string> {
  // Fast gate: if no prompt and no projectId, fall back to existing behavior
  if (!opts?.prompt && !opts?.projectId) {
    return ''; // Signal caller to use existing buildWorkspaceSessionContext
  }

  try {
    const { retrieveHybrid } = await import('@/lib/retrieval/hybrid-retrieval');
    const result = await retrieveHybrid({
      userId: ownerId,
      projectId: opts?.projectId,
      prompt: opts?.prompt ?? '',
      explicitFiles: opts?.explicitFiles,
      currentProjectPath: scopePath,
      scopePath,
      tabId: opts?.tabId,
      maxContextTokens: opts?.maxTokens,
    });

    if (result.source === 'fallback') {
      // Neither retrieval path worked — fall back to existing function
      return '';
    }

    // Log token usage for monitoring
    chatLogger.debug('[Chat] Hybrid workspace context built', {
      source: result.source,
      symbolCount: result.symbolCount,
      filesIncluded: result.filesIncluded,
      estimatedTokens: result.estimatedTokens,
      treeMode: result.treeMode,
      budgetTier: result.budgetTier,
      warnings: result.warnings.length > 0 ? result.warnings.join('; ') : undefined,
    });

    // For JSON format, prepend the tree so the LLM sees workspace structure
    const treeSection = result.tree ? `Workspace structure:\n\`\`\`\n${result.tree}\n\`\`\`\n\n` : '';

    return [
      `${treeSection}=== WORKSPACE CONTEXT (${result.source === 'symbol-retrieval' ? 'AST Symbols' : 'Smart Context'}) ===`,
      `Files: ${result.filesIncluded}`,
      result.symbolCount > 0 ? `Symbols: ${result.symbolCount}` : '',
      `Estimated Tokens: ${result.estimatedTokens}`,
      result.warnings.length > 0 ? `⚠️ ${result.warnings.join('; ')}` : '',
      '',
      result.bundle,
    ].filter(Boolean).join('\n');
  } catch (err) {
    // Silently fall back to existing behavior
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    
    chatLogger.error('[Chat] ❌ Hybrid retrieval failed, using existing context', {
      error: errorMsg,
      stack: errorStack?.split('\n').slice(0, 3).join('\n'),
      ownerId,
      projectId: opts?.projectId,
      promptLength: opts?.prompt?.length || 0,
      promptPreview: opts?.prompt?.slice(0, 100),
      scopePath,
    });
    
    return '';
  }
}

function appendFilesystemContextMessages(
  messages: LLMMessage[],
  attachedFiles: ChatFilesystemFileContext[],
  allowFileEdits: boolean,
  denialContext: Array<{ reason: string; paths: string[]; timestamp: string }> = [],
  workspaceContext: string = '',
  memoryContext: string = '',
  hybridContext: string = '',
): LLMMessage[] {
  if (!attachedFiles.length && !allowFileEdits) {
    return messages;
  }

  const MAX_FILES = 8;
  const MAX_FILE_CHARS = 8000;
  const MAX_TOTAL_CHARS = 28000;
  let usedChars = 0;

  const chunks: string[] = [];
  for (const file of attachedFiles.slice(0, MAX_FILES)) {
    if (usedChars >= MAX_TOTAL_CHARS) {
      break;
    }

    const remaining = MAX_TOTAL_CHARS - usedChars;
    const clippedContent = file.content.slice(0, Math.min(MAX_FILE_CHARS, remaining));
    usedChars += clippedContent.length;

    chunks.push(
      [
        `### FILE: ${file.path}`,
        file.language ? `Language: ${file.language}` : '',
        '```',
        clippedContent,
        '```',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (chunks.length === 0 && !allowFileEdits) {
    return messages;
  }

  const filesystemContextMessage: LLMMessage = {
    role: 'system',
    content: [
      allowFileEdits
        ? 'Virtual filesystem tools are available for this request. Use function calling to read, write, edit, and delete files.'
        : 'Attached filesystem context for this request:',
      '',
      ...chunks,
      '',
      allowFileEdits
        ? VFS_FILE_EDITING_TOOL_PROMPT
        : '',
      workspaceContext ? `Current workspace session context:\n${workspaceContext}` : '',
      hybridContext ? `Codebase retrieval context:\n${hybridContext}` : '',
      memoryContext ? `User memory context:\n${memoryContext}` : '',
      denialContext.length > 0
        ? `Recent denied edits (avoid repeating without adjustment):\n${denialContext
            .map((entry) => `- ${entry.timestamp}: ${entry.reason}; files: ${entry.paths.join(', ')}`)
            .join('\n')}`
        : '',
    ].join('\n'),
  };

  const [firstMessage, ...restMessages] = messages;
  if (firstMessage?.role === 'system' && typeof firstMessage.content === 'string') {
    const mergedSystemMessage: LLMMessage = {
      ...firstMessage,
      content: `${firstMessage.content}\n\n${filesystemContextMessage.content}`,
    };
    return [mergedSystemMessage, ...restMessages];
  }

  return [filesystemContextMessage, ...messages];
}

/**
 * Check if request specifically needs 3rd party OAuth integration (not just general coding)
 * This returns true ONLY for actual integration requests requiring OAuth
 */
function requiresThirdPartyOAuth(messages: LLMMessage[]): boolean {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const content =
    typeof lastUser?.content === 'string'
      ? lastUser.content
      : JSON.stringify(lastUser?.content || '');

  return THIRD_PARTY_OAUTH_RE.test(content);
}

function buildAgenticContext(messages: LLMMessage[]): string {
  const systemMessages = messages.filter(m => m.role === 'system');
  const recent = messages.slice(-8);
  const parts = [
    ...systemMessages.map(m => `SYSTEM: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`),
    ...recent.map(m => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`),
  ];
  return parts.join('\n\n');
}

/**
 * Per-request dedup guard: each request id is allowed to write to mem0 once.
 * Multiple stream paths (regular streaming, tool-loop, fallback, non-streaming)
 * race to fire-and-forget after completion; without this guard the same
 * conversation would be added 2-4× per response. See call sites near the
 * `realEmit('done')`, `ToolLoopAgent stream completed`, and non-streaming
 * paths in this file.
 */
const _mem0WrittenRequestIds = new Set<string>();
const MEM0_WRITTEN_LRU_CAP = 1024;

/**
 * Truncate long content so a single user/assistant message can't blow through
 * the Mem0 token budget. 8K chars ≈ 2K tokens which is plenty for memory
 * extraction; longer content is rarely useful as a "memory".
 */
const MEM0_MAX_CHAR_PER_MSG = 8_000;
function truncateForMem0(s: string): string {
  if (s.length <= MEM0_MAX_CHAR_PER_MSG) return s;
  return s.slice(0, MEM0_MAX_CHAR_PER_MSG) + '\n…[truncated]';
}

/**
 * Store conversation in mem0 for persistent memory.
 *
 * Sends only the *new* turn pair (last user message + assistant response)
 * rather than the full conversation history. Mem0 already stores all prior
 * turns from previous requests, so re-sending the entire `messages` array
 * every turn duplicates work, wastes tokens, and inflates extraction cost.
 *
 * Also dedupes by `requestId` because multiple stream completion paths
 * fire-and-forget call this in the same request.
 */
async function storeConversationInMem0(
  messages: LLMMessage[],
  responseContent: string,
  userId: string,
  requestId: string,
  options: { sessionId?: string; metadata?: Record<string, any> } = {},
): Promise<void> {
  if (!isMem0Configured()) {
    return;
  }

  // Per-request dedup
  if (_mem0WrittenRequestIds.has(requestId)) {
    return;
  }
  _mem0WrittenRequestIds.add(requestId);
  // Cheap LRU eviction: when oversized, drop the oldest insertion-order entries
  if (_mem0WrittenRequestIds.size > MEM0_WRITTEN_LRU_CAP) {
    const it = _mem0WrittenRequestIds.values();
    for (let i = 0; i < 128; i++) {
      const next = it.next();
      if (next.done) break;
      _mem0WrittenRequestIds.delete(next.value);
    }
  }

  try {
    // Find the last user message in the request; that is the "new turn".
    let lastUser: { content: string } | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim().length > 0) {
        lastUser = { content: msg.content };
        break;
      }
    }

    const cleanResponse = (responseContent || '').trim();
    if (!lastUser && !cleanResponse) {
      return;
    }

    // If the last message in `messages` is already an assistant message that
    // matches `responseContent`, don't append it again.
    const tail = messages[messages.length - 1];
    const tailIsResponse =
      !!tail &&
      tail.role === 'assistant' &&
      typeof tail.content === 'string' &&
      tail.content.trim() === cleanResponse;

    const turnPair: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
    if (lastUser) {
      turnPair.push({ role: 'user', content: truncateForMem0(lastUser.content) });
    }
    if (cleanResponse && !tailIsResponse) {
      turnPair.push({ role: 'assistant', content: truncateForMem0(cleanResponse) });
    } else if (tailIsResponse && tail && typeof tail.content === 'string') {
      // Use the (already-trimmed) tail assistant message
      turnPair.push({ role: 'assistant', content: truncateForMem0(tail.content) });
    }

    // Need at least one user + one assistant message for a meaningful memory
    if (turnPair.length < 2) {
      return;
    }

    const result = await mem0Add({
      messages: turnPair,
      userId,
      sessionId: options.sessionId,
      metadata: options.metadata,
    });

    if (result.success) {
      chatLogger.debug('Stored conversation in mem0', { requestId, userId, messageCount: turnPair.length });
    } else {
      chatLogger.warn('Failed to store conversation in mem0', { requestId, error: result.error });
    }
  } catch (err: any) {
    // Non-critical - don't fail the response if memory storage fails
    chatLogger.warn('Mem0 storage failed (non-critical)', { requestId, error: err.message });
  }
}

/**
 * Validate an extracted file path to prevent garbage paths from being written.
 * Rejects paths containing heredoc markers, control chars, or command names.
 */
function validateExtractedPath(raw: string, isFolder: boolean = false): string | null {
  const path = (raw || '').trim().replace(/^['"`]|['"`]$/g, '');
  if (!path) {
    chatLogger.debug('[validateExtractedPath] Rejected: empty path', { raw });
    return null;
  }
  if (path.length > 300) {
    chatLogger.debug('[validateExtractedPath] Rejected: path too long (>300)', { path: path.slice(0, 100), length: path.length });
    return null;
  }
  if (PATH_CONTROL_CHARS_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: control chars', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_HEREDOC_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: heredoc markers', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_UNSAFE_CHARS_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: unsafe chars', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_BAD_START_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: bad start', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_TOO_MANY_DOTS_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: too many dots', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_TRAVERSAL_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: path traversal', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_COMMAND_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: looks like command', { path: path.slice(0, 100) });
    return null;
  }
  // Reject paths that look like CSS classes, Vue directives, or code snippets
  if (PATH_LOOKS_LIKE_CODE_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: looks like code', { path: path.slice(0, 100) });
    return null;
  }
  // Reject paths with colons (CSS classes like hover:scale-105)
  if (PATH_HAS_COLON_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: contains colon', { path: path.slice(0, 100) });
    return null;
  }
  // CRITICAL FIX: Reject CSS values and SCSS variables in last path segment
  // This catches "workspace/sessions/002/0.3s" where "0.3s" is invalid
  if (PATH_CSS_VALUE_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: CSS value', { path: path.slice(0, 100) });
    return null;
  }  // CSS values like "/0.3s"
  if (PATH_SCSS_VAR_RE.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: SCSS var', { path: path.slice(0, 100) });
    return null;
  }  // SCSS variables like "/$var"
  // Must have a valid file extension or be a directory name
  // Allow brackets [] for Next.js dynamic routes like app/blog/[slug]/page.tsx
  if (!/^[a-zA-Z0-9._\-\[\]]+(?:\/[a-zA-Z0-9._\-\[\]]+)*\/?$/.test(path)) {
    chatLogger.debug('[validateExtractedPath] Rejected: invalid format', { path: path.slice(0, 100) });
    return null;
  }

  // CRITICAL FIX: Use shared validation to reject JSON/object syntax in paths
  if (!isValidFilePath(path, isFolder)) {
    chatLogger.debug('[validateExtractedPath] Rejected: isValidFilePath check', { path: path.slice(0, 100), isFolder });
    return null;
  }

  return path;
}

/**
 * Extract folder_create tags from content.
 */
function extractFolderCreateTags(content: string): string[] {
  const folders: string[] = []

  if (!content.includes('folder_create')) return folders;

  // Extract folder_create tags
  const folderCreateRegex = /<folder_create\s+path\s*=\s*["']([^"']+)["']\s*\/?>/gi
  let folderCreateMatch: RegExpExecArray | null
  while ((folderCreateMatch = folderCreateRegex.exec(content)) !== null) {
    const rawPath = folderCreateMatch[1]?.trim()
    if (!rawPath) continue
    
    // Validate folder path the same way we validate file paths
    const validPath = validateExtractedPath(rawPath)
    if (!validPath) {
      chatLogger.warn('[applyFilesystemEdits] Rejected invalid folder_create path', { path: rawPath.substring(0, 80) })
      continue
    }
    folders.push(validPath)
  }

  return folders
}

function sanitizePathSegment(input: string): string {
  // CRITICAL FIX: Use normalizeSessionId to extract simple session name from composite IDs
  // This prevents "anon:timestamp:001" from becoming "anon-timestamp-001"
  // If normalizeSessionId returns empty (invalid input), fall back to 'session'
  const simpleSessionId = normalizeSessionId(input);
  return simpleSessionId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

function resolveScopedPath(input: {
  requestedPath: string;
  scopePath: string;
  attachedPaths: string[];
  lastUserMessage: string;
}): string {
  const rawPath = (input.requestedPath || '').trim().replace(/^\/+/, '');
  if (!rawPath) {
    return resolveScopeUtil('', input.scopePath);
  }

  const attachedSet = new Set((input.attachedPaths || []).map((path) => path.replace(/^\/+/, '')));
  if (attachedSet.has(rawPath)) {
    return resolveScopeUtil(rawPath, input.scopePath);
  }

  const escapedPath = rawPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escapedPath}\\b`, 'i').test(input.lastUserMessage || '')) {
    return resolveScopeUtil(rawPath, input.scopePath);
  }

  const baseName = rawPath.split('/').pop() || rawPath;
  const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escapedBaseName}\\b`, 'i').test(input.lastUserMessage || '')) {
    return resolveScopeUtil(rawPath, input.scopePath);
  }

  if (rawPath.startsWith(`${input.scopePath}/`) || rawPath === input.scopePath) {
    return resolveScopeUtil(rawPath, input.scopePath);
  }

  const normalizedRelative = rawPath.startsWith('workspace/')
    ? rawPath.slice('workspace/'.length)
    : rawPath;
  
  const resolvedPath = resolveScopeUtil(normalizedRelative, input.scopePath);

  // DEBUG LOGGING: Trace path resolution to debug session folder issues
  chatLogger.debug('[resolveScopedPath] Path resolution', {
    rawPath,
    scopePath: input.scopePath,
    normalizedRelative,
    resolvedPath,
    wasInAttached: attachedSet.has(rawPath),
    wasInUserMessage: new RegExp(`\\b${escapedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(input.lastUserMessage || ''),
    baseNameInUserMessage: new RegExp(`\\b${escapedBaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(input.lastUserMessage || ''),
    startsWithScope: rawPath.startsWith(`${input.scopePath}/`) || rawPath === input.scopePath,
  });

  return resolvedPath;
}

async function applyFilesystemEditsFromResponse(input: {
  ownerId: string;
  conversationId: string;
  requestId: string;
  scopePath: string;
  lastUserMessage: string;
  attachedPaths: string[];
  responseContent: string;
  commands?: {
    request_files?: string[];
    write_diffs?: Array<{ path: string; diff: string }>;
  };
  /** Force extraction even if previously emitted (for final parse after stream completes) */
  forceExtract?: boolean;
  /** Pre-parsed edits (from extractAndSanitize) to skip redundant re-parsing */
  preParsedEdits?: ParsedFilesystemResponse;
  /** Bug #48: paths already written by structured tool calls this turn. Text-mode
   * edits for these paths are staged as pendingEdits for LLM review instead of
   * being silently dropped (preserves incremental improvements). */
  alreadyWrittenPaths?: Set<string>;
}): Promise<FilesystemEditResult> {
  // FIX: If forceExtract is true, bypass deduplication to catch all edits including those
  // that may have been skipped during incremental parsing (e.g., last file with unclosed heredoc)
  const parsedResponse = input.preParsedEdits
    ? input.preParsedEdits
    : parseFilesystemResponse(input.responseContent || '', input.forceExtract ?? false);
  const folderCreateOps = extractFolderCreateTags(input.responseContent || '');

  // DIAGNOSTIC: Log what edits were found by the parser
  chatLogger.info('[PARSER] applyFilesystemEditsFromResponse — parse results', {
    writesFound: parsedResponse.writes.length,
    diffsFound: parsedResponse.diffs.length,
    applyDiffsFound: parsedResponse.applyDiffs.length,
    deletesFound: parsedResponse.deletes.length,
    foldersFound: parsedResponse.folders.length,
    forceExtract: input.forceExtract,
    responseContentLength: input.responseContent?.length || 0,
    responsePreview: (input.responseContent || '').slice(0, 200),
  });

  // Bug #48: stage edits for paths already written by structured tool calls
  // as pending (for LLM review next turn) instead of silently dropping them.
  const alreadyWritten = input.alreadyWrittenPaths;
  const pendingEdits: NonNullable<FilesystemEditResult['pendingEdits']> = [];
  if (alreadyWritten && alreadyWritten.size > 0) {
    parsedResponse.writes = parsedResponse.writes.filter(w => {
      if (alreadyWritten.has(w.path)) {
        pendingEdits.push({ path: w.path, content: w.content, type: 'write', reason: 'Already written by structured tool call this turn' });
        return false;
      }
      return true;
    });
    parsedResponse.diffs = parsedResponse.diffs.filter(d => {
      if (alreadyWritten.has(d.path)) {
        pendingEdits.push({ path: d.path, content: d.diff, type: 'diff', diffBody: d.diff, reason: 'Already written by structured tool call this turn' });
        return false;
      }
      return true;
    });
  }

  // FIX: Extract file writes from bash code blocks (echo "content" > file, cat > file << EOF)
  // The LLM often outputs bash commands instead of markdown file blocks.
  // This bridges the gap so bash-based file creation actually writes to the VFS.
  function extractBashFileWrites(content: string): Array<{ path: string; content: string }> {
    const writes: Array<{ path: string; content: string }> = [];

    // Pattern 1: echo "content" > file or echo 'content' > file
    const echoPattern = /```(?:bash|sh|shell)?\s*\n([\s\S]*?echo\s+["']([^"']*)["']\s*>\s*([^\s\n]+)[\s\S]*?)```/gi;
    let match;
    while ((match = echoPattern.exec(content)) !== null) {
      const fileContent = match[2];
      const filePath = match[3].trim();
      const validPath = validateExtractedPath(filePath);
      if (validPath) {
        writes.push({ path: validPath, content: fileContent });
        chatLogger.info('[BASH-EXTRACT] Found echo write:', { path: validPath, content: fileContent.slice(0, 50) });
      }
    }

    // Pattern 2: cat > file << 'EOF'\ncontent\nEOF
    const catPattern = /```(?:bash|sh|shell)?\s*\n[\s\S]*?cat\s*>\s*([^\s\n]+)\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\2/gi;
    while ((match = catPattern.exec(content)) !== null) {
      const filePath = match[1].trim();
      const fileContent = match[3].trim();
      const validPath = validateExtractedPath(filePath);
      if (validPath) {
        writes.push({ path: validPath, content: fileContent });
        chatLogger.info('[BASH-EXTRACT] Found cat write:', { path: validPath, content: fileContent.slice(0, 50) });
      }
    }

    // Pattern 3: printf "content" > file
    const printfPattern = /```(?:bash|sh|shell)?\s*\n[\s\S]*?printf\s+["']([^"']*)["']\s*>\s*([^\s\n]+)[\s\S]*?```/gi;
    while ((match = printfPattern.exec(content)) !== null) {
      const fileContent = match[1];
      const filePath = match[2].trim();
      const validPath = validateExtractedPath(filePath);
      if (validPath) {
        writes.push({ path: validPath, content: fileContent });
        chatLogger.info('[BASH-EXTRACT] Found printf write:', { path: validPath, content: fileContent.slice(0, 50) });
      }
    }

    return writes;
  }

  const bashWrites = extractBashFileWrites(input.responseContent || '');

  if (parsedResponse.writes.length > 0) {
    chatLogger.debug('Parsed write edits', {
      paths: parsedResponse.writes.map(w => w.path),
    });
  }

  // Track invalid paths to detect when ALL paths are invalid (prevents infinite retry loops)
  const invalidPathErrors: string[] = [];

  // If forceExtract, we still need to deduplicate within the response but not skip based on prior emits
  const combinedWriteEdits = [
    ...parsedResponse.writes.map(edit => ({ path: edit.path, content: edit.content })),
    // FIX: Include bash command extractions (echo/cat/printf > file)
    ...bashWrites,
  ].map(edit => ({
    ...edit,
    // Universal sanitization: strip any leaked heredoc markers from all extractors
    content: stripHeredocMarkers(edit.content),
  })).filter(edit => {
    const validPath = validateExtractedPath(edit.path);
    if (!validPath) {
      invalidPathErrors.push(`Invalid path: ${edit.path.substring(0, 100)}`);
      chatLogger.warn('[applyFilesystemEdits] Rejected invalid write path', { path: edit.path.substring(0, 80) });
      return false;
    }
    edit.path = validPath;
    return true;
  });
  const combinedDiffOperations = [
    ...parsedResponse.diffs,
    ...(input.commands?.write_diffs || []),
  ].filter(op => {
    const validPath = validateExtractedPath(op.path);
    if (!validPath) {
      invalidPathErrors.push(`Invalid diff path: ${op.path.substring(0, 100)}`);
      chatLogger.warn('[applyFilesystemEdits] Rejected invalid diff path', { path: op.path.substring(0, 80) });
      return false;
    }
    op.path = validPath;
    return true;
  });
  const applyDiffOperations = parsedResponse.applyDiffs.filter(op => {
    const validPath = validateExtractedPath(op.path);
    if (!validPath) {
      invalidPathErrors.push(`Invalid apply_diff path: ${op.path.substring(0, 100)}`);
      chatLogger.warn('[applyFilesystemEdits] Rejected invalid apply_diff path', { path: op.path.substring(0, 80) });
      return false;
    }
    op.path = validPath;
    return true;
  });
  const deleteTargets = [
    ...parsedResponse.deletes,
  ].map((p) => {
    const validPath = validateExtractedPath(p);
    if (!validPath) {
      invalidPathErrors.push(`Invalid delete path: ${p.substring(0, 100)}`);
      chatLogger.warn('[applyFilesystemEdits] Rejected invalid delete path', { path: p.substring(0, 80) });
      return null;
    }
    return validPath;
  }).filter((p): p is string => !!p);

  // Validate folder paths from parsed response (trailing slashes OK for folders)
  const validatedParsedFolders = parsedResponse.folders.map((folderPath) => {
    const validPath = validateExtractedPath(folderPath, true); // isFolder = true
    if (!validPath) {
      invalidPathErrors.push(`Invalid folder path: ${folderPath.substring(0, 100)}`);
      chatLogger.warn('[applyFilesystemEdits] Rejected invalid folder path', { path: folderPath.substring(0, 80) });
      return null;
    }
    return validPath;
  }).filter((p): p is string => !!p);

  const folderCreateTargets = [...new Set([...validatedParsedFolders, ...folderCreateOps])];
  const requestFiles = (input.commands?.request_files || []).map((requestedPath) => {
    const validPath = validateExtractedPath(requestedPath);
    if (!validPath) {
      invalidPathErrors.push(`Invalid requested read path: ${requestedPath.substring(0, 100)}`);
      chatLogger.warn('[applyFilesystemEdits] Rejected invalid requested read path', { path: requestedPath.substring(0, 80) });
      return null;
    }
    return validPath;
  }).filter((p): p is string => !!p);

  // CRITICAL FIX: If ALL paths were invalid, return explicit error to prevent infinite retry loop
  const totalRequestedPaths = parsedResponse.writes.length + parsedResponse.diffs.length +
                               parsedResponse.applyDiffs.length + parsedResponse.deletes.length;
  const totalValidPaths = combinedWriteEdits.length + combinedDiffOperations.length +
                          applyDiffOperations.length + deleteTargets.length;

  // DIAGNOSTIC: Log path validation results
  chatLogger.debug('applyFilesystemEditsFromResponse — path validation', {
    requestedPaths: totalRequestedPaths,
    validPaths: totalValidPaths,
    rejectedPaths: invalidPathErrors.length,
    sampleErrors: invalidPathErrors.slice(0, 3),
  });

  if (totalRequestedPaths > 0 && totalValidPaths === 0 && invalidPathErrors.length > 0) {
    chatLogger.error('[applyFilesystemEdits] ALL paths were invalid - returning explicit error to prevent infinite retry', {
      requestId: input.requestId,
      totalRequestedPaths,
      invalidPathCount: invalidPathErrors.length,
      sampleErrors: invalidPathErrors.slice(0, 5),
    });
    
    return {
      transactionId: null,
      status: 'none',
      applied: [],
      errors: invalidPathErrors,
      requestedFiles: [],
      scopePath: input.scopePath,
      sessionId: extractSessionIdFromPath(input.scopePath) || input.conversationId,
    };
  }

  // Only create transaction if there are mutating operations (write/patch/delete/apply_diff)
  // This prevents memory leaks from accumulating no-op transactions
  const hasMutatingOperations =
    combinedWriteEdits.length > 0 ||
    combinedDiffOperations.length > 0 ||
    applyDiffOperations.length > 0 ||
    deleteTargets.length > 0 ||
    folderCreateTargets.length > 0;

  const transaction = hasMutatingOperations
    ? filesystemEditSessionService.createTransaction({
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        requestId: input.requestId,
      })
    : null;

  const result: FilesystemEditResult = {
    transactionId: transaction ? transaction.id : null,
    status: hasMutatingOperations ? 'auto_applied' : 'none',
    applied: [],
    errors: [],
    requestedFiles: [],
    scopePath: input.scopePath,
    sessionId: extractSessionIdFromPath(input.scopePath) || input.conversationId,
    pendingEdits: pendingEdits.length > 0 ? pendingEdits : undefined,
  };

  // Process write operations only if we have a transaction
  if (transaction) {
    const seenWriteEdits = new Set<string>();

    for (const edit of combinedWriteEdits) {
      const targetPath = resolveScopedPath({
        requestedPath: edit.path,
        scopePath: input.scopePath,
        attachedPaths: input.attachedPaths,
        lastUserMessage: input.lastUserMessage,
      });
      const writeKey = `${targetPath}::${edit.content}`;
      if (seenWriteEdits.has(writeKey)) continue;
      seenWriteEdits.add(writeKey);

      try {
        let previousVersion: number | null = null;
        let previousContent: string | null = null;
        let existedBefore = false;
        try {
          const previousFile = await virtualFilesystem.readFile(input.ownerId, targetPath);
          previousVersion = previousFile.version;
          previousContent = previousFile.content;
          existedBefore = true;
        } catch {
          existedBefore = false;
        }

        const file = await virtualFilesystem.writeFile(input.ownerId, targetPath, edit.content);
        
        // DEBUG LOGGING: Track where files are actually being written
        chatLogger.info('[VFS Write] File written to VFS', {
          ownerId: input.ownerId,
          requestedPath: edit.path,
          resolvedPath: targetPath,
          actualVfsPath: file.path,
          contentLength: edit.content?.length || 0,
          contentPreview: edit.content?.slice(0, 100),
          scopePath: input.scopePath,
          conversationId: input.conversationId,
        });
        
        chatLogger.debug('VFS write completed', {
          ownerId: input.ownerId,
          requestedPath: edit.path,
          resolvedPath: targetPath,
          contentLength: edit.content?.length || 0,
        });
        result.applied.push({
          path: file.path,
          operation: 'write',
          version: file.version,
          previousVersion,
          existedBefore,
          content: edit.content,
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: file.path,
          operation: 'write',
          newVersion: file.version,
          previousVersion,
          previousContent,
          existedBefore,
        });

        // Emit filesystem-updated event to notify UI panels
        // Emits 'create' for new files, 'update' for existing files
        emitFilesystemUpdated({
          path: file.path,
          paths: [file.path],
          scopePath: extractScopePath(file.path),
          type: existedBefore ? 'update' : 'create',
          sessionId: input.conversationId,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to write ${targetPath}: ${message}`;
        result.errors.push(err);
        filesystemEditSessionService.addError(transaction.id, err);
      }
    }

    // Process diff/patch operations
    const seenDiffKey = new Set<string>();
    for (const diffOperation of combinedDiffOperations) {
      const targetPath = resolveScopedPath({
        requestedPath: diffOperation.path,
        scopePath: input.scopePath,
        attachedPaths: input.attachedPaths,
        lastUserMessage: input.lastUserMessage,
      });
      const diffKey = `${targetPath}::${diffOperation.diff}`;
      if (seenDiffKey.has(diffKey)) {
        continue;
      }
      seenDiffKey.add(diffKey);

      try {
        let currentContent = '';
        let previousVersion: number | null = null;
        let previousContent: string | null = null;
        let existedBefore = false;
        try {
          const existingFile = await virtualFilesystem.readFile(input.ownerId, targetPath);
          currentContent = existingFile.content;
          previousVersion = existingFile.version;
          previousContent = existingFile.content;
          existedBefore = true;
        } catch {
          currentContent = '';
          existedBefore = false;
        }

        const patchedContent = applyUnifiedDiffToContent(currentContent, targetPath, diffOperation.diff);
        if (patchedContent === null) {
          // DEBUG: Log why diff application failed
          chatLogger.error('[DIFF-APPLY] Failed to apply diff', {
            targetPath,
            diffLength: diffOperation.diff.length,
            diffPreview: diffOperation.diff.slice(0, 200),
            currentContentLength: currentContent.length,
            currentContentPreview: currentContent.slice(0, 200),
            existedBefore,
          });
          result.errors.push(`Failed to apply unified diff for ${targetPath}: patch could not be applied`);
          continue;
        }
        const file = await virtualFilesystem.writeFile(input.ownerId, targetPath, patchedContent);

        // DEBUG: Log successful diff application
        chatLogger.info('[DIFF-APPLY] Successfully applied diff', {
          targetPath,
          originalLength: currentContent.length,
          patchedLength: patchedContent.length,
          existedBefore,
        });

        result.applied.push({
          path: file.path,
          operation: 'patch',
          version: file.version,
          previousVersion,
          existedBefore,
          diff: diffOperation.diff,
          content: patchedContent,
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: file.path,
          operation: 'patch',
          newVersion: file.version,
          previousVersion,
          previousContent,
          existedBefore,
        });

        // Emit filesystem-updated event for existing files to notify UI panels
        if (existedBefore) {
          emitFilesystemUpdated({
            path: file.path,
            paths: [file.path],
            scopePath: extractScopePath(file.path),
            type: 'update',
            sessionId: input.conversationId,
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to apply diff for ${targetPath}: ${message}`;
        result.errors.push(err);
        filesystemEditSessionService.addError(transaction.id, err);
      }
    }

    // Process APPLY_DIFF operations (surgical search & replace)
    const seenApplyDiffKey = new Set<string>();
    for (const diffOp of applyDiffOperations) {
      const targetPath = resolveScopedPath({
        requestedPath: diffOp.path,
        scopePath: input.scopePath,
        attachedPaths: input.attachedPaths,
        lastUserMessage: input.lastUserMessage,
      });
      const diffKey = `${targetPath}::${diffOp.search}::${diffOp.replace}`;
      if (seenApplyDiffKey.has(diffKey)) continue;
      seenApplyDiffKey.add(diffKey);

      try {
        let currentContent = '';
        let previousVersion: number | null = null;
        let previousContent: string | null = null;
        let existedBefore = false;
        try {
          const existingFile = await virtualFilesystem.readFile(input.ownerId, targetPath);
          currentContent = existingFile.content;
          previousVersion = existingFile.version;
          previousContent = existingFile.content;
          existedBefore = true;
        } catch {
          currentContent = '';
          existedBefore = false;
        }

        if (!existedBefore) {
          // Allow apply_diff to create new files - use the replace content as the new file content
          // This is useful when the LLM uses apply_diff syntax but the file doesn't exist yet
          chatLogger.debug(`[apply_diff] File ${targetPath} does not exist, creating new file with replace content`);
          const file = await virtualFilesystem.writeFile(input.ownerId, targetPath, diffOp.replace);

          result.applied.push({
            path: file.path,
            operation: 'write',
            version: file.version,
            previousVersion: null,
            existedBefore: false,
            content: diffOp.replace,
          });
          filesystemEditSessionService.recordOperation(transaction.id, {
            path: file.path,
            operation: 'write',
            newVersion: file.version,
            previousVersion: null,
            previousContent: null,
            existedBefore: false,
          });

          // Emit event for new file creation
          emitFilesystemUpdated({
            path: file.path,
            paths: [file.path],
            scopePath: extractScopePath(file.path),
            type: 'create',
            sessionId: input.conversationId,
          });
          continue;
        }

        // Perform search & replace on existing file
        if (!currentContent.includes(diffOp.search)) {
          result.errors.push(`APPLY_DIFF failed for ${targetPath}: search block not found in file.`);
          continue;
        }

        const updatedContent = applySearchReplace(currentContent, diffOp.search, diffOp.replace);
        const file = await virtualFilesystem.writeFile(input.ownerId, targetPath, updatedContent);

        result.applied.push({
          path: file.path,
          operation: 'patch',
          version: file.version,
          previousVersion,
          existedBefore,
          content: updatedContent,
          diff: `<<<\n${diffOp.search}\n===\n${diffOp.replace}\n>>>`,
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: file.path,
          operation: 'patch',
          newVersion: file.version,
          previousVersion,
          previousContent,
          existedBefore,
        });

        // Emit filesystem-updated event to notify UI panels (code-preview-panel)
        // This ensures existing file changes are reflected in the file editor
        emitFilesystemUpdated({
          path: file.path,
          paths: [file.path],
          scopePath: extractScopePath(file.path),
          type: 'update',
          sessionId: input.conversationId,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to apply_diff for ${targetPath}: ${message}`;
        result.errors.push(err);
        filesystemEditSessionService.addError(transaction.id, err);
      }
    }

    // Process delete operations
    const seenDeleteTargets = new Set<string>();
    for (const deletePath of deleteTargets) {
      const normalizedPath = resolveScopedPath({
        requestedPath: deletePath.trim(),
        scopePath: input.scopePath,
        attachedPaths: input.attachedPaths,
        lastUserMessage: input.lastUserMessage,
      });
      if (!normalizedPath || seenDeleteTargets.has(normalizedPath)) {
        continue;
      }
      seenDeleteTargets.add(normalizedPath);

      try {
        let existingVersion: number | null = null;
        let existingContent: string | null = null;
        let existedBefore = false;
        try {
          const existingFile = await virtualFilesystem.readFile(input.ownerId, normalizedPath);
          existingVersion = existingFile.version;
          existingContent = existingFile.content;
          existedBefore = true;
        } catch {
          existedBefore = false;
        }

        if (!existedBefore) {
          continue;
        }

        await virtualFilesystem.deletePath(input.ownerId, normalizedPath);
        result.applied.push({
          path: normalizedPath,
          operation: 'delete',
          version: -1,
          previousVersion: existingVersion,
          existedBefore: true,
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: normalizedPath,
          operation: 'delete',
          newVersion: -1,
          previousVersion: existingVersion,
          previousContent: existingContent,
          existedBefore: true,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to delete ${normalizedPath}: ${message}`;
        result.errors.push(err);
        filesystemEditSessionService.addError(transaction.id, err);
      }
    }

    // Process folder creation operations
    const seenFolderCreates = new Set<string>();
    for (const folderPath of folderCreateTargets) {
      const normalizedPath = resolveScopedPath({
        requestedPath: folderPath.trim(),
        scopePath: input.scopePath,
        attachedPaths: input.attachedPaths,
        lastUserMessage: input.lastUserMessage,
      });
      if (!normalizedPath || seenFolderCreates.has(normalizedPath)) {
        continue;
      }
      seenFolderCreates.add(normalizedPath);

      try {
        // Check if folder already exists (by checking if any file has this path prefix)
        let existedBefore = false;
        try {
          const listing = await virtualFilesystem.listDirectory(input.ownerId, normalizedPath);
          // If we can list it, the directory exists (has files or subdirs under it)
          existedBefore = listing.nodes.length > 0;
        } catch {
          existedBefore = false;
        }

        // In VFS, directories are implicit - they exist when files are in them
        // To create an empty directory, we create a .gitkeep marker file
        // This ensures the directory structure is preserved
        const gitkeepPath = `${normalizedPath}/.gitkeep`;
        
        try {
          // Check if .gitkeep already exists
          await virtualFilesystem.readFile(input.ownerId, gitkeepPath);
          existedBefore = true;
        } catch {
          // .gitkeep doesn't exist, create it
          await virtualFilesystem.writeFile(input.ownerId, gitkeepPath, '');
        }

        result.applied.push({
          path: normalizedPath,
          operation: 'write', // Use 'write' since folder creation is via marker file
          version: 1,
          previousVersion: null,
          existedBefore,
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: normalizedPath,
          operation: 'write',
          newVersion: 1,
          previousVersion: null,
          previousContent: null,
          existedBefore,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to create folder ${normalizedPath}: ${message}`;
        result.errors.push(err);
        filesystemEditSessionService.addError(transaction.id, err);
      }
    }

    // Update status if no operations succeeded
    if (result.applied.length === 0 && result.errors.length === 0) {
      result.status = 'none';
    }

    // Auto-commit: create a git-backed snapshot after successful edits
    if (result.applied.length > 0) {
      try {
        const commitManager = new ShadowCommitManager();

        // Get recorded operations from the edit session (includes previousContent)
        const editTx = transaction ? filesystemEditSessionService.getTransactionSync(transaction.id) : null;
        const recordedOps = editTx?.operations || [];

        // Build transaction entries with original + new content for rollback support
        const transactions = result.applied.map(op => {
          const recorded = recordedOps.find((r: any) => r.path === op.path);
          return {
            path: op.path,
            type: (op.operation === 'delete' ? 'DELETE' : op.existedBefore ? 'UPDATE' : 'CREATE') as 'UPDATE' | 'CREATE' | 'DELETE',
            timestamp: Date.now(),
            originalContent: recorded?.previousContent ?? undefined,
            newContent: undefined as string | undefined,
          };
        });

        const vfs: Record<string, string> = {};

        // DESKTOP MODE: Skip reading files — content is stripped by ShadowCommitManager.
        const desktopMode = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';
        if (!desktopMode) {
          for (const op of result.applied) {
            if (op.operation !== 'delete') {
              try {
                const file = await virtualFilesystem.readFile(input.ownerId, op.path);
                vfs[op.path] = file.content;
                const txn = transactions.find(t => t.path === op.path);
                if (txn) txn.newContent = file.content;
              } catch (readError) {
                void readError;
              }
            }
          }
        }

        const filesSummary = result.applied
          .map(op => `${op.operation} ${op.path}`)
          .join(', ');
        const workspaceVersion = await virtualFilesystem.getWorkspaceVersion(input.ownerId);
        result.workspaceVersion = workspaceVersion;

        const commitResult = await commitManager.commit(vfs, transactions, {
          sessionId: result.sessionId || input.conversationId,
          message: `Auto-commit: ${filesSummary}`,
          author: input.ownerId,
          source: 'chat',
          integration: 'chat',
          workspaceVersion,
        });

        if (commitResult.success) {
          result.commitId = commitResult.commitId;
        }
      } catch (commitError) {
        // Non-fatal: edits were applied even if commit fails
        chatLogger.error('[Chat] Auto-commit failed:', { error: commitError instanceof Error ? commitError.message : String(commitError) });
      }
    }
  }

  // Process file read requests (always allowed, even without mutating operations)
  const seenRequested = new Set<string>();
  for (const requestedFile of requestFiles) {
    const requestedPath = resolveScopedPath({
      requestedPath: requestedFile,
      scopePath: input.scopePath,
      attachedPaths: input.attachedPaths,
      lastUserMessage: input.lastUserMessage,
    });
    if (seenRequested.has(requestedPath)) continue;
    seenRequested.add(requestedPath);

    try {
      const file = await virtualFilesystem.readFile(input.ownerId, requestedPath);
      result.requestedFiles.push({
        path: file.path,
        content: file.content,
        language: file.language,
        version: file.version,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      result.errors.push(`Requested read failed for ${requestedPath}: ${message}`);
    }
  }

  // DIAGNOSTIC: Log final result of VFS edit application
  chatLogger.info('applyFilesystemEditsFromResponse — final result', {
    applied: result.applied.length,
    appliedPaths: result.applied.map(a => a.path),
    errors: result.errors.length,
    errorMessages: result.errors.slice(0, 3),
    status: result.status,
  });

  return result;
}

export async function GET(request: NextRequest) {
  // Precompile warmup: Initialize LLM providers on first GET request
  // This ensures the route is ready for subsequent POST requests without cold start
  const url = new URL(request.url);

  // If called with ?warmup=true, trigger provider initialization
  // SECURITY: Only allow in development or with admin auth header
  if (url.searchParams.get('warmup') === 'true') {
    // Timing-safe comparison to prevent timing attacks
    const headerValue = request.headers.get('x-admin-secret') || '';
    const expectedSecret = process.env.CHAT_ADMIN_SECRET;
    // SECURITY: Require CHAT_ADMIN_SECRET to be configured and non-empty
    // In production, an empty secret means NO auth is configured, so reject all requests
    const isAdminAuth = !!expectedSecret &&
      headerValue.length === expectedSecret.length &&
      timingSafeEqual(Buffer.from(headerValue), Buffer.from(expectedSecret));
    const isDevOnly = process.env.NODE_ENV === 'development';

    if (!isAdminAuth && !isDevOnly) {
      return NextResponse.json(
        { error: 'Unauthorized: warmup requires admin auth or dev mode' },
        { status: 401 }
      );
    }
    
    try {
      const { llmService } = await import("@/lib/providers/llm-providers");
      await llmService.warmupProviders();

      return NextResponse.json({
        success: true,
        message: "Chat API pre-warmed and ready",
        timestamp: Date.now(),
      });
    } catch (error) {
      // OUTERCATCH-GAP fix: mirror the L5497-L5516 524 contract from the
      // POST handler's outer catch. A StallWatchdogError propagating to this
      // GET warmup handler (e.g. watchdog firing during provider warmup probe,
      // or via timeouts in prepareStep from a streaming variant) must
      // surface as HTTP 524 with the x-stall-fired signal — not the
      // generic 500 fallback below. Closes STALL-524-OUTERCATCH-GAP for the
      // warmup route; the active /api/chat route was already covered.
      if (error instanceof StallWatchdogError) {
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            reason: 'stall-watchdog',
            stitchedFromWatchDog: true,
          },
          {
            status: 524,
            headers: {
              'content-type': 'application/json',
              'x-stall-fired': 'true',
              'x-stall-reason': 'stall-watchdog',
            },
          },
        );
      }
      chatLogger.error("Chat API warmup error:", { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { success: false, error: "Warmup failed" },
        { status: 500 }
      );
    }
  }

  // Default: Redirect to providers endpoint
  return NextResponse.redirect(new URL('/api/providers', request.url));
}

/**
 * Error handler with logging
 */
async function handleError(
  error: { message: string },
  requestId: string,
  provider: string,
  model: string,
  userId: string,
  requestStartTime: number
) {
  const latencyMs = Date.now() - requestStartTime;

  await chatRequestLogger.logRequestComplete(
    requestId,
    false,
    undefined,
    undefined,
    latencyMs,
    error.message,
    provider,
    model,
    undefined, // No tool calls on error path
    0, // No content on error
  );

  return errorHandler.processError(error instanceof Error ? error : new Error(error.message), {
    operation: 'chat_api',
    provider,
    model,
    userId,
  });
}

// Handle preflight requests for CORS
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || '',
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-anonymous-session-id",
      "Vary": "Origin",
    },
  });
}



