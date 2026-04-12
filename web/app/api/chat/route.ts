import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/chat/llm-providers";
import { errorHandler } from "@/lib/chat/error-handler";
import { responseRouter } from "@/lib/api/response-router";
import { resolveRequestAuth } from "@/lib/auth/request-auth";
import { resolveFilesystemOwner, withAnonSessionCookie } from "@/lib/virtual-filesystem/resolve-filesystem-owner";
import { detectRequestType } from "@/lib/utils/request-type-detector";
import { generateSecureId } from '@/lib/utils';
import { chatRequestLogger } from '@/lib/chat/chat-request-logger';
import { chatLogger } from '@/lib/chat/chat-logger';
import { setMetricsLogger } from '@/lib/agent/metrics';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { filesystemEditSessionService } from '@/lib/virtual-filesystem/filesystem-edit-session-service';
import { contextPackService } from '@/lib/virtual-filesystem/context-pack-service';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { extractSessionIdFromPath, resolveScopedPath as resolveScopeUtil, sanitizeScopePath, extractScopePath, normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';
import { createNDJSONParser } from '@/lib/utils/ndjson-parser';
import type { LLMMessage, StreamingResponse } from "@/lib/chat/llm-providers";
import { checkRateLimit } from '@/lib/middleware/rate-limiter';
import { createFilesystemTools, createAgentLoop } from '@/lib/orchestra/mastra';
import { executeV2Task, executeV2TaskStreaming } from '@bing/shared/agent/v2-executor';
import { processUnifiedAgentRequest, type UnifiedAgentConfig } from '@/lib/orchestra/unified-agent-service';
import { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } from '@/lib/mcp';
import { workforceManager } from '@bing/shared/agent/workforce-manager';
import { createTaskClassifier as createTaskClassifierShared } from '@bing/shared/agent/task-classifier';
import { VFS_FILE_EDITING_TOOL_PROMPT } from '@bing/shared/agent/system-prompts';
import { mem0Search, buildMem0SystemPrompt, isMem0Configured, mem0Add } from '@/lib/powers/mem0-power';
import { createSSEEmitter, SSE_RESPONSE_HEADERS, SSE_EVENT_TYPES } from '@/lib/streaming/sse-event-schema';
// Lazy imports — avoid 'ws' module resolution during instrumentation context
// import { streamStateManager } from '@/lib/streaming/stream-state-manager';
// import { notifyNeedMoreTurns, notifyStreamComplete } from '@/lib/streaming/stream-control-handler';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { getRecentMcpFileEdits, clearRecentMcpFileEdits } from '@/lib/virtual-filesystem/file-events';
import { getOrchestrationModeFromRequest, executeWithOrchestrationMode } from '@bing/shared/agent/orchestration-mode-handler';
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
import { generateSessionName, sessionNameExists } from '@/lib/session-naming';
import { timingSafeEqual } from 'node:crypto';
import { buildSupplementalAgenticEvents } from '@/lib/api/streaming-events';
import { sandboxBridge } from '@/lib/sandbox';
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
export const runtime = 'nodejs';

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
  /\b(refactor|bug\s*fix|stack\s*trace|typescript|javascript|python|react|next\.js|vue\.js|angular|node\.?js|endpoint|database|schema|compile|lint|migrations?|docker|kubernetes|k8s|redis|mongodb|postgresql|mysql|sqlite|express|fastapi|flask|django|spring|rails|laravel|symfony|golang|rust|java|c\+\+|cpp|c#|dotnet|swift|kotlin|flutter|react\s*native|electron|code|build|implement|create\s+app|create\s+project|scaffold|generate\s+app)\b/i

const WEAK_CODE_KEYWORDS = [
  'app', 'project', 'component', 'file', 'api',
  'function', 'class', 'module', 'package', 'implement', 'build', 'develop',
] as const

const WEAK_CODE_PATTERNS = WEAK_CODE_KEYWORDS.map(
  kw => new RegExp(`\\b${kw}\\b`, 'i'),
)

// Task classifier cache — initialized lazily to avoid blocking module load
let _taskClassifierCache: ReturnType<typeof createTaskClassifierShared> | null = null;

function getTaskClassifier() {
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

  try {
    const classifier = getTaskClassifier();
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
    chatLogger.debug('Task classifier failed, using regex fallback', { error: error.message });

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
    'full project',
    'entire project',
    'whole project',
    'complete codebase',
    'full codebase',
    'entire codebase',
    'project structure',
    'codebase structure',
    'project overview',
    'codebase overview',
    'all files',
    'everything in',
    'context pack',
    'repomix',
    'gitingest',
    'bundle.*context',
    'pack.*files',
    'scaffold.*project',
    'understand.*project',
    'analyze.*project',
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

export async function POST(request: NextRequest) {
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
        `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${isSecure ? '; Secure' : ''}`
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
    console.log('[ROUTE] Raw body keys:', Object.keys(rawBody));
    console.log('[ROUTE] Parsed result:', parseResult.success ? 'success' : parseResult.error?.message);
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
        const { toolCallTracker } = await import('@/lib/chat/tool-call-tracker');
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
          const { getRetryModel } = await import('@/lib/models/model-ranker');
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
        } catch (error) {
          chatLogger.warn('Failed to select retry model, using original', error);
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
    } else if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) {
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
        m => m === model || m.startsWith(`${model}:`)
      );

      if (!isModelSupported) {
        chatLogger.error('Model not supported', { requestId, provider, model }, {
          availableModels: selectedProvider.models,
        });
        return NextResponse.json(
          {
            error: `Model ${model} is not supported by ${provider}`,
            availableModels: selectedProvider.models,
          },
          { status: 400 },
        );
      }

      // Cache the validation result with timestamp
      validationCache.set(validationCacheKey, { provider, isValid: true, timestamp: now });
    }

    // Get provider info from cached validation
    const selectedProvider = PROVIDERS[provider as keyof typeof PROVIDERS];
    chatLogger.debug('Selected provider', { requestId, provider, model }, {
      supportsStreaming: selectedProvider.supportsStreaming,
    });

    // Normalize model name to match PROVIDERS constant
    // Only allow exact match or prefix match, not suffix-only matches
    const normalizedModel = selectedProvider.models.find(
      m => m === model || m.startsWith(`${model}:`)
    ) || model;
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

    const defaultScopePath = `project/sessions/${sanitizePathSegment(resolvedConversationId)}`;
    // Sanitize scopePath to ensure folder names are not corrupted with ownerId prefix
    // e.g., "project/sessions/anon:1774710784761_6TB03h8Ow:002" -> "project/sessions/002"
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
      // Search mem0 for relevant memories (runs in parallel)
      isMem0Configured() && typeof lastUserMessage?.content === 'string'
        ? mem0Search({
            query: lastUserMessage.content,
            userId: filesystemOwnerId,
            limit: 5,
          }).catch((memError: any) => {
            chatLogger.warn('Mem0 search failed (non-critical)', { error: memError.message });
            return { success: false, results: [] };
          })
        : Promise.resolve({ success: false, results: [] }),
      // Hybrid retrieval: AST-based symbol retrieval with smart-context fallback
      enableFilesystemEdits && userPrompt
        ? buildHybridWorkspaceContext(filesystemOwnerId, scopePathForHybrid, {
            prompt: userPrompt,
            projectId: scopePathForHybrid, // Use scopePath as stable project ID
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
    console.log('[ROUTE] agentMode from request:', agentMode);
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
                  preParsedEdits: null,
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
                  preParsedEdits: null,
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
    };

    const tools = await getMCPToolsForAI_SDK(authenticatedUserId, lastUserMsgContent);
    config.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
    config.executeTool = async (name: string, args: Record<string, any>) => {
      const result = await callMCPToolFromAI_SDK(name, args, authenticatedUserId, requestedScopePath);
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

            // Progressive file edit parsing - buffer for incremental parsing
            let streamingContentBuffer = '';
            const fileEditParserState = createIncrementalParser();

            try {
              sendStep('Start agentic pipeline', 'started');
              config.onStreamChunk = (chunk: string) => {
                // Emit token as before
                emit(SSE_EVENT_TYPES.TOKEN, { content: chunk, timestamp: Date.now() });

                // Progressive file edit detection
                streamingContentBuffer += chunk;
                const newFileEdits = extractIncrementalFileEdits(streamingContentBuffer, fileEditParserState);

                // Filter out invalid paths and empty content to prevent UI polling loops
                for (const edit of newFileEdits) {
                  // CRITICAL FIX: Use proper isValidFilePath validation instead of simple regex
                  // This catches CSS values (0.3s), code snippets (with, submission), etc.
                  if (!isValidFilePath(edit.path)) {
                    chatLogger.debug('Skipping invalid progressive file edit path (failed isValidFilePath)', { path: edit.path });
                    continue;
                  }
                  // CRITICAL FIX: Skip empty content to prevent infinite loops
                  const editContent = edit.content || edit.diff || '';
                  if (!editContent || editContent.trim().length === 0) {
                    chatLogger.debug('Skipping empty edit content (prevents infinite loop)', { path: edit.path });
                    continue;
                  }
                  // CRITICAL FIX: Determine operation type and send correct data format
                  // - For WRITE operations: send full content, operation='write', NO diff field
                  // - For PATCH operations: send unified diff in diff field, operation='patch'
                  const isPatch = edit.action === 'patch' || !!edit.diff;
                  emit(SSE_EVENT_TYPES.FILE_EDIT, {
                    path: edit.path,
                    status: 'detected',
                    operation: isPatch ? 'patch' : 'write',
                    timestamp: Date.now(),
                    content: edit.content || '',  // Always send full content for WRITE operations
                    diff: isPatch ? (edit.diff || '') : undefined,  // Only send diff for PATCH operations
                  });
                  chatLogger.debug('Progressive file edit detected', { 
                    path: edit.path,
                    operation: isPatch ? 'patch' : 'write',
                    hasDiff: !!edit.diff,
                  });
                }
              };
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
                  import('@/lib/chat/tool-call-tracker').then(({ toolCallTracker }) => {
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

              const result = await processUnifiedAgentRequest(config);
              sendStep('Start agentic pipeline', result.success ? 'completed' : 'failed');

              // FIX: Final parse after stream completes to catch any remaining edits
              // The closing >>> may have arrived in the last chunk
              // CRITICAL: Clear BOTH emittedEdits AND unclosedPositions for proper re-parsing
              if (streamingContentBuffer.trim().length > 0) {
                fileEditParserState.emittedEdits.clear();
                fileEditParserState.unclosedPositions.clear();
                const finalEdits = extractIncrementalFileEdits(streamingContentBuffer, fileEditParserState);
                
                // CRITICAL FIX: Emit FILE_EDIT events for final edits caught in post-stream parse
                // This ensures frontend receives edits that were stuck in "unclosed" regions during streaming
                if (finalEdits && finalEdits.length > 0) {
                  chatLogger.debug('Emitting final file edits from post-stream parse', {
                    requestId,
                    editCount: finalEdits.length,
                    paths: finalEdits.map(e => e.path).join(', ')
                  });
                  try {
                    for (const edit of finalEdits) {
                      // Validate path and content before emitting
                      if (!isValidFilePath(edit.path)) {
                        chatLogger.debug('Skipping invalid path from finalEdits (post-stream)', { path: edit.path });
                        continue;
                      }
                      const editContent = edit.content || edit.diff || '';
                      if (!editContent || editContent.trim().length === 0) {
                        chatLogger.debug('Skipping empty edit from finalEdits (post-stream)', { path: edit.path });
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
                        isFinal: true,  // Mark as final parse edit for frontend
                      });
                    }
                  } catch (error) {
                    chatLogger.warn('Failed to emit final file edits', {
                      requestId,
                      error: error instanceof Error ? error.message : String(error),
                    });
                    // Continue anyway - don't break stream completion
                  }
                }

                // VFS WRITE: Actually write extracted file edits to the virtual filesystem
                // This mirrors the streaming path at line ~2340 — without this, edits are
                // only emitted as SSE events (status: 'detected') but NEVER persisted to VFS.
                const fullResponse = streamingContentBuffer + (typeof result.response === 'string' ? result.response : '') || '';
                let appliedEditsResult: any = null;
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
                    });

                    await flushVFSBatchMode(filesystemOwnerId);

                    // Emit applied file edit events so UI shows status: 'applied'
                    if (appliedEditsResult?.applied?.length) {
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
                        chatLogger.debug('VFS file edit applied (agentic path)', {
                          path: edit.path,
                          operation: isPatch ? 'patch' : 'write',
                        });
                      }
                      chatLogger.info('Agentic path: filesystem edits applied to VFS', {
                        editCount: appliedEditsResult.applied.length,
                        paths: appliedEditsResult.applied.map(e => e.path).join(', '),
                      });
                    } else if (appliedEditsResult?.errors?.length) {
                      chatLogger.warn('Agentic path: VFS write errors', {
                        errors: appliedEditsResult.errors.slice(0, 5),
                      });
                    }
                  } catch (e) {
                    chatLogger.warn('Agentic path: VFS write failed (non-fatal)', {
                      error: e instanceof Error ? e.message : String(e),
                    });
                  }
                }

                // Collect file edits into result object for the done event
                // This ensures the stream method returns fileEdits in the result
                if (appliedEditsResult) {
                  result.fileEdits = appliedEditsResult;
                  result.metadata = result.metadata || {};
                  result.metadata.appliedEditCount = appliedEditsResult.applied?.length || 0;
                  result.metadata.extractedEditCount = finalEdits?.length || 0;
                }

                // SESSION NAMING: Detect if this is a new single-folder project
                // If so, rename the session folder to match the project folder
                const responseContent = streamingContentBuffer + (typeof result.response === 'string' ? result.response : '') || '';

                const { detectSingleFolderFromResponse } = await import('@/lib/session-naming');
                const detectedFolder = detectSingleFolderFromResponse(responseContent);

                // Check if we should rename: new session (sequential ID) with single detected folder
                const isSequentialSession = /^\d{3}$/.test(resolvedConversationId);
                const isNewSession = isSequentialSession && !result.metadata?.isExistingSession;

                // DEBUG LOGGING: Session naming detection
                console.debug('[SessionNaming] Session folder detection', {
                  detectedFolder,
                  resolvedConversationId,
                  isSequentialSession,
                  isNewSession,
                  responseContentLength: responseContent.length,
                  responsePreview: responseContent.slice(0, 200),
                  metadata: result.metadata,
                });
                
                if (detectedFolder && isNewSession && detectedFolder !== resolvedConversationId) {
                  // Check if detected folder name is available
                  const { sessionNameExists } = await import('@/lib/session-naming');
                  const folderExists = await sessionNameExists(detectedFolder);

                  if (!folderExists) {
                    // Rename session folder by moving contents
                    const oldPath = `project/sessions/${resolvedConversationId}`;
                    const newPath = `project/sessions/${detectedFolder}`;

                    try {
                      const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
                      // List files in old session
                      const listing = await virtualFilesystem.listDirectory(filesystemOwnerId, oldPath);

                      // ALWAYS rename session when LLM suggests a single folder name
                      // File migration is optional (currently not implemented in VFS)
                      if (listing.nodes.length > 0) {
                        // Note: VFS doesn't support rename, so we'd need to copy+delete
                        // For now, skip file moving - session rename is cosmetic only
                        chatLogger.info('Session folder name updated (files would need manual migration)', {
                          oldPath,
                          newPath,
                          filesToMove: listing.nodes.length,
                        });
                        // TODO: Implement file migration when VFS supports rename/move operations
                      }

                      // Update resolvedConversationId for future operations
                      const previousId = resolvedConversationId;
                      resolvedConversationId = detectedFolder;
                      // CRITICAL: Update scope path to match renamed session
                      requestedScopePath = `project/sessions/${detectedFolder}`;

                      chatLogger.info('Session folder renamed based on detected project structure', {
                        previousId,
                        newId: detectedFolder,
                        filesMoved: listing.nodes.length,
                      });

                      // Emit filesystem updated event for UI
                      emit(SSE_EVENT_TYPES.FILESYSTEM, {
                        previousId,
                        newId: detectedFolder,
                        reason: 'single-folder-project',
                      });
                    } catch (renameError: any) {
                      chatLogger.warn('Failed to rename session folder', {
                        error: renameError.message,
                        detectedFolder,
                      });
                    }
                  }
                }

                // Apply filesystem edits if any were detected
                if (finalEdits.length > 0 && filesystemOwnerId) {
                  try {
                    const { applyFilesystemEditsFromResponse } = await import('./route');
                    const appliedEdits = await applyFilesystemEditsFromResponse({
                      ownerId: filesystemOwnerId,
                      conversationId: `${filesystemOwnerId}$${resolvedConversationId}`,
                      requestId,
                      scopePath: requestedScopePath,
                      lastUserMessage: task,
                      attachedPaths: attachedFilesystemFiles.map(f => f.path),
                      responseContent: streamingContentBuffer,
                      commands: {},
                      forceExtract: true,
                    });

                    // Emit applied edits
                    if (appliedEdits?.applied?.length) {
                      for (const edit of appliedEdits.applied) {
                        // Validate path before emitting
                        if (!isValidFilePath(edit.path)) {
                          chatLogger.debug('Skipping invalid path from appliedEdits', { path: edit.path });
                          continue;
                        }
                        // CRITICAL FIX: Skip empty content to prevent infinite loops
                        const editContent = edit.content || edit.diff || '';
                        if (!editContent || editContent.trim().length === 0) {
                          chatLogger.debug('Skipping empty edit from appliedEdits (prevents infinite loop)', { path: edit.path });
                          continue;
                        }
                        // CRITICAL FIX: Determine operation type and send correct data format
                        // Check for diff field to determine if it's a patch operation
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

                      // CRITICAL FIX Bug #2: Emit filesystem-updated CustomEvent for agent tool path
                      // This ensures components listening to CustomEvent update (not just SSE recipients)
                      emitFilesystemUpdated({
                        scopePath: requestedScopePath,
                        sessionId: resolvedConversationId,
                        applied: appliedEdits.applied,
                        source: 'agent-tool',
                      });

                      // CRITICAL: Add fallback message if content is empty but files were applied
                      if (!streamingContentBuffer.trim() && appliedEdits.applied.length > 0) {
                        streamingContentBuffer = `Applied filesystem changes to ${appliedEdits.applied.length} file(s).`;
                      }
                    }
                  } catch (editErr: any) {
                    chatLogger.warn('Final parse: filesystem edit application failed', {
                      error: editErr.message
                    });
                  }
                } else {
                  // Just emit events if no filesystem owner
                  for (const edit of finalEdits) {
                    // Validate path before emitting
                    if (!isValidFilePath(edit.path)) {
                      chatLogger.debug('Skipping invalid path from finalEdits (no owner)', { path: edit.path });
                      continue;
                    }
                    // CRITICAL FIX: Skip empty content to prevent infinite loops
                    const editContent = edit.content || edit.diff || '';
                    if (!editContent || editContent.trim().length === 0) {
                      chatLogger.debug('Skipping empty edit from finalEdits (prevents infinite loop)', { path: edit.path });
                      continue;
                    }
                    // CRITICAL FIX: Determine operation type and send correct data format
                    const isPatch = edit.action === 'patch' || !!edit.diff;
                    chatLogger.debug('Final parse file edit detected', { 
                      path: edit.path,
                      operation: isPatch ? 'patch' : 'write',
                    });
                    emit(SSE_EVENT_TYPES.FILE_EDIT, {
                      path: edit.path,
                      status: 'detected',
                      operation: isPatch ? 'patch' : 'write',
                      timestamp: Date.now(),
                      content: edit.content || '',
                      diff: isPatch ? (edit.diff || '') : undefined,
                    });
                  }
                }
              }

              emit(SSE_EVENT_TYPES.DONE, {
                success: result.success,
                content: streamingContentBuffer || (typeof result.response === 'string' ? result.response : ''),
                messageMetadata: {
                  agent: 'unified',
                  mode: result.mode,
                  processingSteps,
                },
                data: result,
              });

              // Cleanup: Clear streaming buffer to free memory
              streamingContentBuffer = '';
              fileEditParserState.emittedEdits.clear();
              fileEditParserState.unclosedPositions.clear();
            } catch (error: any) {
              // FINAL PARSE ON ERROR TOO: Try to extract any complete edits before clearing
              if (streamingContentBuffer.trim().length > 0) {
                try {
                  fileEditParserState.emittedEdits.clear();
                  fileEditParserState.unclosedPositions.clear();
                  const finalEdits = extractIncrementalFileEdits(streamingContentBuffer, fileEditParserState);
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
                } catch (parseError) {
                  // Ignore parse errors during error handling
                }
              }

              emit(SSE_EVENT_TYPES.ERROR, { message: error.message || 'Agentic execution failed' });

              // Cleanup on error too
              streamingContentBuffer = '';
              fileEditParserState.emittedEdits.clear();
              fileEditParserState.unclosedPositions.clear();
            } finally {
              controller.close();
            }
          },
        });

        return new Response(streamBody, { headers: SSE_RESPONSE_HEADERS });
      }

      // Check if custom orchestration mode is selected via header
      // This applies to ALL chat requests, not just integration pipeline requests
      const orchestrationMode = getOrchestrationModeFromRequest(request);

      if (orchestrationMode !== 'task-router') {
        // User has selected a custom orchestration mode
        chatLogger.info('Custom orchestration mode selected', { 
          mode: orchestrationMode,
          requestId,
        });

        const orchestrationResult = await executeWithOrchestrationMode(orchestrationMode, {
          task: task,  // User task only — filesystem context already in conversationHistory
          sessionId: resolvedConversationId,
          ownerId: authenticatedUserId,
          stream: stream === true,
          model: normalizedModel,
          workspacePath: `project/sessions/${resolvedConversationId}`,
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
                if (orchestrationResult.response) {
                  enqueue('token', {
                    content: orchestrationResult.response,
                  });
                }

                // Send completion
                enqueue('done', {
                  success: orchestrationResult.success,
                  content: orchestrationResult.response,
                  metadata: orchestrationResult.metadata,
                });

                controller.close();
              } catch (error: any) {
                enqueue('error', { message: error.message });
                controller.close();
              }
            },
          });

          return new Response(streamBody, { headers: SSE_RESPONSE_HEADERS });
        }

        // Non-streaming response
        return NextResponse.json({
          success: orchestrationResult.success,
          content: orchestrationResult.response,
          data: orchestrationResult,
        });
      }

      // Default: Use existing unified agent flow (task-router mode)
      // This is the fallback when no custom orchestration mode is selected
      // FIX: Skip when AGENT_EXECUTION_ENGINE='v1-agent-loop' — fall through to direct Mastra path
      console.log('[ROUTE-DEBUG] About to call processUnifiedAgentRequest, AGENT_EXECUTION_ENGINE:', AGENT_EXECUTION_ENGINE);
      console.log('[ROUTE-DEBUG] enableFilesystemEdits BEFORE call:', enableFilesystemEdits);
      if (AGENT_EXECUTION_ENGINE !== 'v1-agent-loop') {
        const result = await processUnifiedAgentRequest(config);
        console.log('[ROUTE-DEBUG] processUnifiedAgentRequest returned, result.success:', result.success, 'hasResponse:', !!result.response);

        // GUARANTEED debug field — always appears if this code path is reached
        const debugInfo = {
          enableFilesystemEdits,
          agentExecutionEngine: AGENT_EXECUTION_ENGINE,
          resultSuccess: result.success,
          hasResponse: !!result.response,
          responseLength: result.response?.length || 0,
        };
        console.log('[ROUTE-DEBUG] debugInfo:', JSON.stringify(debugInfo));

        // FIX: Extract and apply file edits from the LLM response text.
        // The LLM may output code blocks, diffs, or write_file instructions
        // that need to be parsed and written to the VFS.
        // This bridges the gap between v1-api chat mode and actual file creation.
        let appliedEdits = null;
        console.log('[FILE-EDIT-DEBUG] enableFilesystemEdits:', enableFilesystemEdits, 'result.success:', result.success, 'response length:', result.response?.length);
        if (result.success && result.response && enableFilesystemEdits) {
          try {
            console.log('[FILE-EDIT-DEBUG] Calling applyFilesystemEditsFromResponse, response preview:', result.response.slice(0, 200));
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
            });

            console.log('[FILE-EDIT-DEBUG] appliedEdits:', JSON.stringify({
              writes: appliedEdits?.writes?.length,
              patches: appliedEdits?.patches?.length,
              applied: appliedEdits?.applied?.length,
              errors: appliedEdits?.errors?.length,
            }));

            if (appliedEdits?.applied?.length) {
              chatLogger.info('File edits extracted from v1-api response', {
                requestId,
                editCount: appliedEdits.applied.length,
                edits: appliedEdits.applied.map((e: any) => ({ path: e.path, operation: e.operation })),
              });
            } else {
              chatLogger.warn('No file edits extracted from v1-api response — response has no parseable file edits');
            }
          } catch (parseError: any) {
            chatLogger.error('Failed to extract file edits from v1-api response', {
              requestId,
              error: parseError.message,
            });
            console.log('[FILE-EDIT-DEBUG] Error:', parseError.message, parseError.stack?.slice(0, 500));
          }
        } else {
          console.log('[FILE-EDIT-DEBUG] SKIPPED: enableFilesystemEdits=', enableFilesystemEdits, 'success=', result.success, 'hasResponse=', !!result.response);
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
            sandboxSession = await sandboxBridge.getOrCreateSession(authenticatedUserId);
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
                ? sandboxBridge.inferProviderFromSandboxId(sandboxSession.sandboxId) || undefined
                : undefined,
              workspacePath: sandboxSession?.workspacePath || requestedScopePath,
            },
            actualModel, // Pass user's selected model
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
                agentToolResults,
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
      } catch (error) {
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
            const requestedFile = filesystemEdits.requestedFiles.find(f => f.path === edit.path);
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
            const requestedFile = filesystemEdits.requestedFiles.find(f => f.path === edit.path);
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
              requestedFiles: filesystemEdits.requestedFiles,
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
          let encoderRef = encoder;
          let streamingContentBuffer = '';
          const fileEditParserState = createIncrementalParser();

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
                controller.enqueue(encoderRef.encode(eventStr));
                chunkCount++;
              };

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
                } catch (e) {
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
              pendingEvents.length = 0;

              const cleanup = () => {
                encoderRef = null;
                emitRef.current = null;
                streamingContentBuffer = '';
                fileEditParserState.emittedEdits.clear();
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
                const TOKEN_EMIT_INTERVAL_MS = 50;  // Batch tokens for 50ms before emitting

                const emitBufferedTokens = () => {
                  if (tokenBuffer.length > 0) {
                    realEmit('token', {
                      content: tokenBuffer,
                      timestamp: Date.now(),
                      type: 'token'
                    });
                    // Track tokens in stream state (non-fatal if it fails)
                    try {
                      if (ssm) ssm.appendToken(streamRequestId, tokenBuffer);
                    } catch (e) {
                      // Non-fatal — stream state tracking shouldn't break the main stream
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
                    tokenBuffer += streamChunk.content;

                    // Progressive file edit detection from streaming content
                    streamingContentBuffer += streamChunk.content;
                    const newFileEdits = extractIncrementalFileEdits(streamingContentBuffer, fileEditParserState);

                    // Filter out invalid paths and empty content to prevent UI polling loops
                    for (const edit of newFileEdits) {
                      // CRITICAL FIX: Use proper isValidFilePath validation instead of simple regex
                      // This catches CSS values (0.3s), code snippets (with, submission), etc.
                      if (!isValidFilePath(edit.path)) {
                        chatLogger.debug('Skipping invalid progressive file edit path (failed isValidFilePath)', { path: edit.path });
                        continue;
                      }
                      // CRITICAL FIX: Skip empty content to prevent infinite loops
                      const editContent = edit.content || edit.diff || '';
                      if (!editContent || editContent.trim().length === 0) {
                        chatLogger.debug('Skipping empty edit content (prevents infinite loop)', { path: edit.path });
                        continue;
                      }
                      // CRITICAL FIX: Determine operation type and send correct data format
                      // - For WRITE operations: send full content, operation='write', NO diff field
                      // - For PATCH operations: send unified diff in diff field, operation='patch'
                      const isPatch = edit.action === 'patch' || !!edit.diff;
                      realEmit('file_edit', {
                        path: edit.path,
                        status: 'detected',
                        operation: isPatch ? 'patch' : 'write',
                        timestamp: Date.now(),
                        content: edit.content || '',  // Always send full content for WRITE operations     
                        diff: isPatch ? (edit.diff || '') : undefined,  // Only send diff for PATCH operations
                      });
                      chatLogger.debug('Progressive file edit detected during LLM stream', {
                        path: edit.path,
                        operation: isPatch ? 'patch' : 'write',
                        hasDiff: !!edit.diff,
                      });
                    }

                    // Emit buffered tokens if interval has passed
                    const now = Date.now();
                    if (now - lastTokenEmitTime >= TOKEN_EMIT_INTERVAL_MS) {
                      emitBufferedTokens();
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

                          // Real-time: Record tool call for model ranking telemetry
                          try {
                            const { toolCallTracker: realTimeTracker } = await import('@/lib/chat/tool-call-tracker');
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
                    const streamedContent = streamingContentBuffer;

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
                      const fileEdits = allEdits.applied
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
                          const requestedFile = allEdits.requestedFiles.find(f => f.path === edit.path);
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
                    emitBufferedTokens();

                    // Update stream state and notify WebSocket control channel (non-fatal)
                    try {
                      if (ssm) ssm.complete(streamRequestId, doneEventData.finishReason);
                      if (nsc) nsc(streamRequestId);
                    } catch (e) {
                      chatLogger.warn('Failed to update stream state on completion', {
                        streamRequestId,
                        error: e instanceof Error ? e.message : String(e),
                      });
                    }

                    realEmit('done', doneEventData);

                    // Store conversation in mem0 for persistent memory (fire-and-forget, non-blocking)
                    // Use streamingContentBuffer which has the full response
                    if (isMem0Configured()) {
                      storeConversationInMem0(messages, streamingContentBuffer, filesystemOwnerId, streamRequestId).catch(() => {});
                    }

                    break; // Exit loop when complete
                  }
                }

                // Emit any remaining buffered tokens (in case loop exited without hitting isComplete)
                emitBufferedTokens();

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
                    contentLength: streamingContentBuffer.length,
                    appliedEditsCount: effectiveEdits?.applied?.length || 0,
                    mcpFileEdits: hasMcpFileEdits ? mcpFileEdits.map(e => e.path) : undefined,
                  });

                  // Build enhanced content including actual file edits
                  let enhancedContent = streamingContentBuffer;
                  if (effectiveEdits?.applied?.length > 0) {
                    const fileEditsContent = effectiveEdits.applied
                      .filter(e => e.content || e.diff)
                      .map(e => `\n\`\`\`fs-actions\nWRITE ${e.path} <<<\n${e.content || e.diff || ''}\n>>>\n\`\`\``)
                      .join('\n\n');
                    if (fileEditsContent) {
                      enhancedContent = streamingContentBuffer + '\n\n' + fileEditsContent;
                      chatLogger.debug('Including file edits in spec amplification', {
                        fileCount: effectiveEdits.applied.length,
                        additionalContentLength: fileEditsContent.length,
                      });
                    }
                  } else if (hasMcpFileEdits) {
                    // MCP tool execution path: files were modified via function calling.
                    // Do NOT inject WRITE markers with placeholder content into enhancedContent —
                    // the background refinement engine would parse those markers and overwrite
                    // the real file content with the placeholder text.
                    // Instead, just note that files were created/updated via MCP.
                    enhancedContent = streamingContentBuffer +
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
                  streamingContentBuffer.length,
                  undefined,
                  streamDuration,
                  undefined,
                  actualProvider,
                  actualModel,
                  completedToolCalls.length > 0 ? completedToolCalls : undefined,
                  streamingContentBuffer.length,
                ).catch(() => {});

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
            cancel() {
              const streamDuration = Date.now() - streamStartTime;
              chatLogger.warn('LLM stream cancelled (cancel callback)', { requestId: streamRequestId }, {
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
              'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || '',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-anonymous-session-id',
              'Vary': 'Origin',
              ...(anonSessionIdToSet ? {
                'Set-Cookie': `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
              } : {}),
            },
          });
        }

        // NOTE: Spec amplification trigger moved to inside each streaming path's completion handler
        // - Regular LLM streaming: line ~1825 (after streamingContentBuffer is finalized)
        // - ToolLoopAgent streaming: line ~2155 (after finalContent is finalized)
        // This ensures content is available and emitRef.current is properly set

        // Check if we have ToolLoopAgent streaming available
        const hasToolLoopStreaming = agentToolStreamingResult && stream;

        if (hasToolLoopStreaming) {
          // Handle ToolLoopAgent real-time streaming
          chatLogger.info('Streaming with ToolLoopAgent real-time events', { requestId: streamRequestId });
          
          const encoder = new TextEncoder();
          let encoderRef = encoder;

          const readableStream = new ReadableStream({
            async start(controller) {
              // Set up real emit that writes directly to stream controller
              const realEmit = (eventType: string, data: any) => {
                if (request.signal?.aborted) return;
                const eventStr = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
                controller.enqueue(encoderRef.encode(eventStr));
                chunkCount++;
              };

              // Replace placeholder emit with real emit - background refinement will now stream directly
              emitRef.current = realEmit;

              // Flush any pending events that arrived before stream started
              for (const pending of pendingEvents) {
                realEmit(pending.event, { requestId: streamRequestId, ...pending.data, timestamp: pending.timestamp });
              }
              pendingEvents.length = 0;

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
                    controller.enqueue(encoderRef.encode(event));
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
                      controller.enqueue(encoderRef.encode(tokenEvent));
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
                      controller.enqueue(encoderRef.encode(toolEvent));
                      chunkCount++;

                      // Real-time: Track tool call for model ranking telemetry
                      if (chunk.toolInvocation.state === 'result') {
                        const toolName = chunk.toolInvocation.toolName;
                        const isSuccess = chunk.toolInvocation.result &&
                          chunk.toolInvocation.result.output !== undefined &&
                          chunk.toolInvocation.result.output !== null;
                        const errorMsg = chunk.toolInvocation.result?.error;

                        try {
                          const { toolCallTracker: realTimeTracker } = await import('@/lib/chat/tool-call-tracker');
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
                      controller.enqueue(encoderRef.encode(reasoningEvent));
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
                    doneEventData.fileEdits = allEdits.applied
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
                  controller.enqueue(encoderRef.encode(doneEvent));
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
                ).catch(() => {}); // fire-and-forget — don't block stream

                // Store conversation in mem0 for persistent memory (fire-and-forget, non-blocking)
                if (isMem0Configured()) {
                  storeConversationInMem0(messages, finalContent, filesystemOwnerId, streamRequestId).catch(() => {});
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
                  controller.enqueue(encoderRef.encode(errorEvent));
                }
                controller.close();
              } finally {
                cleanup();
              }
            },
            cancel() {
              const streamDuration = Date.now() - streamStartTime;
              chatLogger.warn('Stream cancelled (cancel callback)', { requestId: streamRequestId }, {
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
              "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || "",
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization, x-anonymous-session-id",
              "Vary": "Origin",
              ...(anonSessionIdToSet ? {
                "Set-Cookie": `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
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
            filesystemEdits.requestedFiles.length > 0)
        ) {
          const filesystemEvent = `event: filesystem\ndata: ${JSON.stringify({
            requestId: streamRequestId,
            transactionId: filesystemEdits.transactionId,
            status: filesystemEdits.status,
            applied: filesystemEdits.applied,
            errors: filesystemEdits.errors,
            requestedFiles: filesystemEdits.requestedFiles,
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
          (filesystemEdits.applied.length > 0 || filesystemEdits.requestedFiles.length > 0);
        chatLogger.info('Starting streaming response', { requestId: streamRequestId, provider: actualProvider, model: actualModel }, {
          eventsCount: events.length,
          hasFilesystemEdits: hasActualFilesystemEdits,
          appliedEditsCount: filesystemEdits?.applied?.length || 0,
          requestedFilesCount: filesystemEdits?.requestedFiles?.length || 0,
        });

        const encoder = new TextEncoder();
        let encoderRef = encoder;  // Reference for cleanup
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

        const readableStream = new ReadableStream({
          async start(controller) {
            // Set up real emit that writes directly to stream controller
            // Keep reference for background refinement to use
            const realEmit = (eventType: string, data: any) => {
              if (request.signal?.aborted || streamClosed) return;
              const eventStr = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
              controller.enqueue(encoderRef.encode(eventStr));
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
            pendingEvents.length = 0;

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
                controller.enqueue(encoderRef.encode(event));
                chunkCount++;
              }

              // Send FILE_EDIT events for VFS sync (before content tokens)
              for (const fileEditEvent of fileEditEvents) {
                if (request.signal?.aborted || streamClosed) {
                  cleanup();
                  return;
                }
                controller.enqueue(encoderRef.encode(fileEditEvent));
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
                controller.enqueue(encoderRef.encode(event));
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
                controller.enqueue(encoderRef.encode(primaryDoneEvent));
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
                storeConversationInMem0(messages, clientResponse.content, filesystemOwnerId, streamRequestId).catch(() => {});
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
              ).catch(() => {}); // fire-and-forget — don't block stream

              if (!SPEC_AMPLIFICATION_STREAM_EVENTS_ENABLED) {
                streamClosed = true;
                controller.close();
                cleanup();
                return;
              }

              // SPEC AMPLIFICATION: Will be triggered after primary response completes
              // Check happens inside the stream callback where streamingContentBuffer is available
              // See line ~2520 for spec amplification trigger (inside stream callback)

              // Stream stays open for background refinement events
              // The emit function will close the stream when refinement completes
              // Add timeout fallback in case refinement never completes
              refinementTimeoutId = setTimeout(() => {
                if (!streamClosed) {
                  chatLogger.warn('Background refinement timeout, closing stream', {
                    requestId: streamRequestId
                  });
                  streamClosed = true;
                  controller.close();
                  cleanup();
                }
              }, 180000); // 180 second timeout for refinement (matches DAG time budget)

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
                controller.enqueue(encoderRef.encode(errorEvent));
                chunkCount++;
              }
              streamClosed = true;
              controller.close();
              cleanup();
            }
          },
          cancel() {
            if (!streamClosed) {
              streamClosed = true;
              cleanup();
            }
            const streamDuration = Date.now() - streamStartTime;
            chatLogger.warn('Stream cancelled (cancel callback)', { requestId: streamRequestId, provider: actualProvider, model: actualModel }, {
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
            "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || "",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-anonymous-session-id",
            "Vary": "Origin",
            ...(anonSessionIdToSet ? {
              "Set-Cookie": `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
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
      ).catch(() => {}); // fire-and-forget

      // Store conversation in mem0 for persistent memory (fire-and-forget, non-blocking)
      // This runs after the response is sent to not delay the client
      const responseContentForMemory = clientResponse.content || '';
      if (isMem0Configured()) {
        storeConversationInMem0(messages, responseContentForMemory, filesystemOwnerId, requestId).catch(() => {});
      }

      const responseStatus = clientResponse.success ? 200 : 500;
      return addAnonSessionCookie(NextResponse.json(
        {
          success: clientResponse.success,
          data: clientResponse.data,
          commands: clientResponse.commands,
          filesystem: filesystemEdits,
          metadata: clientResponse.metadata,
          timestamp: clientResponse.metadata?.timestamp
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
        pendingEvents.length = 0;
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

interface FilesystemEditSummary {
  path: string;
  operation: 'write' | 'patch' | 'delete';
  version: number;
  previousVersion: number | null;
  existedBefore: boolean;
  content?: string;
  diff?: string;
  commitId?: string;
  commitMessage?: string;
  message?: string;
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

  return /\b(file|files|code|edit|patch|create|write|update|project|program|build|run|execute|install|scaffold|component|page|app|module|function|class)\b/i.test(lastUserMessage);
}

/**
 * Detect if user is requesting a comprehensive context pack
 * Look for keywords suggesting they want full project context
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
      const reader = streamResponse.body.getReader();

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
        controller.error(error);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(anonSessionIdToSet ? {
        'Set-Cookie': `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
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
      console.warn('[Chat] Context pack generation failed, falling back to basic context:', error);
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
 * When the vector store has indexed symbols for this project, uses the
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
    console.debug('[Chat] Hybrid workspace context built', {
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
    
    console.error('[Chat] ❌ Hybrid retrieval failed, using existing context', {
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
 * Store conversation in mem0 for persistent memory
 * This runs after each chat response to build persistent context
 */
async function storeConversationInMem0(
  messages: LLMMessage[],
  responseContent: string,
  userId: string,
  requestId: string
): Promise<void> {
  if (!isMem0Configured()) {
    return;
  }

  try {
    // Extract user and assistant messages from the conversation
    const conversationMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
    
    for (const msg of messages) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        conversationMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
        conversationMessages.push({ role: 'assistant', content: msg.content });
      }
    }

    // Add the final response if we have one
    if (responseContent && responseContent.trim().length > 0) {
      conversationMessages.push({ role: 'assistant', content: responseContent });
    }

    // Only store if we have meaningful conversation (at least user message + response)
    if (conversationMessages.length < 2) {
      return;
    }

    // Call mem0 to store the conversation
    const result = await mem0Add({
      messages: conversationMessages,
      userId,
    });

    if (result.success) {
      chatLogger.debug('Stored conversation in mem0', { requestId, userId, messageCount: conversationMessages.length });
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
    console.debug('[validateExtractedPath] Rejected: empty path', { raw });
    return null;
  }
  if (path.length > 300) {
    console.debug('[validateExtractedPath] Rejected: path too long (>300)', { path: path.slice(0, 100), length: path.length });
    return null;
  }
  if (PATH_CONTROL_CHARS_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: control chars', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_HEREDOC_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: heredoc markers', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_UNSAFE_CHARS_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: unsafe chars', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_BAD_START_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: bad start', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_TOO_MANY_DOTS_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: too many dots', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_TRAVERSAL_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: path traversal', { path: path.slice(0, 100) });
    return null;
  }
  if (PATH_COMMAND_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: looks like command', { path: path.slice(0, 100) });
    return null;
  }
  // Reject paths that look like CSS classes, Vue directives, or code snippets
  if (PATH_LOOKS_LIKE_CODE_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: looks like code', { path: path.slice(0, 100) });
    return null;
  }
  // Reject paths with colons (CSS classes like hover:scale-105)
  if (PATH_HAS_COLON_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: contains colon', { path: path.slice(0, 100) });
    return null;
  }
  // CRITICAL FIX: Reject CSS values and SCSS variables in last path segment
  // This catches "project/sessions/002/0.3s" where "0.3s" is invalid
  if (PATH_CSS_VALUE_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: CSS value', { path: path.slice(0, 100) });
    return null;
  }  // CSS values like "/0.3s"
  if (PATH_SCSS_VAR_RE.test(path)) {
    console.debug('[validateExtractedPath] Rejected: SCSS var', { path: path.slice(0, 100) });
    return null;
  }  // SCSS variables like "/$var"
  // Must have a valid file extension or be a directory name
  // Allow brackets [] for Next.js dynamic routes like app/blog/[slug]/page.tsx
  if (!/^[a-zA-Z0-9._\-\[\]]+(?:\/[a-zA-Z0-9._\-\[\]]+)*\/?$/.test(path)) {
    console.debug('[validateExtractedPath] Rejected: invalid format', { path: path.slice(0, 100) });
    return null;
  }

  // CRITICAL FIX: Use shared validation to reject JSON/object syntax in paths
  if (!isValidFilePath(path, isFolder)) {
    console.debug('[validateExtractedPath] Rejected: isValidFilePath check', { path: path.slice(0, 100), isFolder });
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
      console.warn('[applyFilesystemEdits] Rejected invalid folder_create path:', rawPath.substring(0, 80))
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

  const normalizedRelative = rawPath.startsWith('project/')
    ? rawPath.slice('project/'.length)
    : rawPath;
  
  const resolvedPath = resolveScopeUtil(normalizedRelative, input.scopePath);

  // DEBUG LOGGING: Trace path resolution to debug session folder issues
  console.debug('[resolveScopedPath] Path resolution', {
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

export async function applyFilesystemEditsFromResponse(input: {
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
      console.warn('[applyFilesystemEdits] Rejected invalid write path:', edit.path.substring(0, 80));
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
      console.warn('[applyFilesystemEdits] Rejected invalid diff path:', op.path.substring(0, 80));
      return false;
    }
    op.path = validPath;
    return true;
  });
  const applyDiffOperations = parsedResponse.applyDiffs.filter(op => {
    const validPath = validateExtractedPath(op.path);
    if (!validPath) {
      invalidPathErrors.push(`Invalid apply_diff path: ${op.path.substring(0, 100)}`);
      console.warn('[applyFilesystemEdits] Rejected invalid apply_diff path:', op.path.substring(0, 80));
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
      console.warn('[applyFilesystemEdits] Rejected invalid delete path:', p.substring(0, 80));
      return null;
    }
    return validPath;
  }).filter((p): p is string => !!p);

  // Validate folder paths from parsed response (trailing slashes OK for folders)
  const validatedParsedFolders = parsedResponse.folders.map((folderPath) => {
    const validPath = validateExtractedPath(folderPath, true); // isFolder = true
    if (!validPath) {
      invalidPathErrors.push(`Invalid folder path: ${folderPath.substring(0, 100)}`);
      console.warn('[applyFilesystemEdits] Rejected invalid folder path:', folderPath.substring(0, 80));
      return null;
    }
    return validPath;
  }).filter((p): p is string => !!p);

  const folderCreateTargets = [...new Set([...validatedParsedFolders, ...folderCreateOps])];
  const requestFiles = (input.commands?.request_files || []).map((requestedPath) => {
    const validPath = validateExtractedPath(requestedPath);
    if (!validPath) {
      invalidPathErrors.push(`Invalid requested read path: ${requestedPath.substring(0, 100)}`);
      console.warn('[applyFilesystemEdits] Rejected invalid requested read path:', requestedPath.substring(0, 80));
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
        console.info('[VFS Write] File written to VFS', {
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
          console.error('[DIFF-APPLY] Failed to apply diff', {
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
        console.info('[DIFF-APPLY] Successfully applied diff', {
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
          console.log(`[apply_diff] File ${targetPath} does not exist, creating new file with replace content`);
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
        console.error('[Chat] Auto-commit failed:', commitError);
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
      const { llmService } = await import("@/lib/chat/llm-providers");
      await llmService.warmupProviders();

      return NextResponse.json({
        success: true,
        message: "Chat API pre-warmed and ready",
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Chat API warmup error:", error);
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
      "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || "",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-anonymous-session-id",
      "Vary": "Origin",
    },
  });
}
