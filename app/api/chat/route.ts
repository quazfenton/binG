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
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { filesystemEditSessionService } from '@/lib/virtual-filesystem/filesystem-edit-session-service';
import { contextPackService } from '@/lib/virtual-filesystem/context-pack-service';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { extractSessionIdFromPath, resolveScopedPath as resolveScopeUtil, sanitizeScopePath, extractScopePath } from '@/lib/virtual-filesystem/scope-utils';
import { createNDJSONParser } from '@/lib/utils/ndjson-parser';
import type { LLMMessage, StreamingResponse } from "@/lib/chat/llm-providers";
import { checkRateLimit } from '@/lib/middleware/rate-limiter';
import { createFilesystemTools, createAgentLoop } from '@/lib/orchestra/mastra';
import { executeV2Task, executeV2TaskStreaming } from '@/lib/agent/v2-executor';
import { processUnifiedAgentRequest, type UnifiedAgentConfig } from '@/lib/orchestra/unified-agent-service';
import { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } from '@/lib/mcp';
import { workforceManager } from '@/lib/agent/workforce-manager';
import { createSSEEmitter, SSE_RESPONSE_HEADERS, SSE_EVENT_TYPES } from '@/lib/streaming/sse-event-schema';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { llmProviderRouter, type LLMProviderType } from '@/lib/chat/llm-provider-router';
import { getOrchestrationModeFromRequest, executeWithOrchestrationMode } from '@/lib/agent/orchestration-mode-handler';
import {
  sanitizeAssistantDisplayContent,
  extractFileWriteEdits,
  parseFilesystemResponse,
  createIncrementalParser,
  extractIncrementalFileEdits,
} from '@/lib/chat/file-edit-parser';
import { applyUnifiedDiffToContent } from '@/lib/chat/file-diff-utils';
import { generateSessionName, sessionNameExists } from '@/lib/session-naming';
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

// Force Node.js runtime for Daytona SDK compatibility
export const runtime = 'nodejs';

// Precompile optimization: enable dynamic to allow static generation for simple requests
export const dynamic = 'auto';

// Cache configuration for precompiled responses
export const revalidate = 0; // Default: no cache (opt-in only)
export const dynamicParams = true;

// LLM Agent Tools Configuration
const LLM_AGENT_TOOLS_ENABLED = process.env.LLM_AGENT_TOOLS_ENABLED !== 'false';
const LLM_AGENT_TOOLS_MAX_ITERATIONS = parseInt(process.env.LLM_AGENT_TOOLS_MAX_ITERATIONS || '10', 10);
const LLM_AGENT_TOOLS_TIMEOUT_MS = parseInt(process.env.LLM_AGENT_TOOLS_TIMEOUT_MS || '30000', 10);

// Note: Fast-Agent now has dedicated endpoint at /api/agent
// This route uses priority router which includes Fast-Agent as Priority 1

// Rate limiting for chat API
const CHAT_RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const CHAT_RATE_LIMIT_MAX_AUTHENTICATED = 60;
const CHAT_RATE_LIMIT_MAX_ANONYMOUS = 10;

const CHAT_AGENTIC_PIPELINE = (process.env.CHAT_AGENTIC_PIPELINE || 'auto').toLowerCase();
const WORKFORCE_ENABLED = process.env.WORKFORCE_ENABLED === 'true';

// Provider/model validation cache to reduce repeated lookups
const validationCache = new Map<string, { provider: string; isValid: boolean; timestamp: number }>();
const VALIDATION_CACHE_TTL_MS = 30000;

// FIX 4: Cap pendingEvents to prevent memory leaks
const MAX_PENDING_EVENTS = 64;
const SPEC_AMPLIFICATION_STREAM_EVENTS_ENABLED =
  process.env.SPEC_AMPLIFICATION_STREAM_EVENTS_ENABLED !== 'false';

// FIX 2: Pre-compiled RegExp for isCodeOrAgenticRequest (module-level, not per request)
const STRONG_CODE_PATTERN =
  /\b(refactor|bug\s*fix|stack\s*trace|typescript|javascript|python|react|next\.js|vue\.js|angular|node\.?js|endpoint|database|schema|compile|lint|migrations?|docker|kubernetes|k8s|redis|mongodb|postgresql|mysql|sqlite|express|fastapi|flask|django|spring|rails|laravel|symfony|golang|rust|java|c\+\+|cpp|c#|dotnet|swift|kotlin|flutter|react\s*native|electron|code|build|implement|create\s+app|create\s+project|scaffold|generate\s+app)\b/i

const WEAK_CODE_KEYWORDS = [
  'app', 'project', 'component', 'file', 'api',
  'function', 'class', 'module', 'package', 'implement', 'build', 'develop',
] as const

const WEAK_CODE_PATTERNS = WEAK_CODE_KEYWORDS.map(
  kw => new RegExp(`\\b${kw}\\b`, 'i'),
)

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
    };
    provider = requestedProvider;
    model = requestedModel;

    // Log request start
    await chatRequestLogger.logRequestStart(
      incomingRequestId || requestId,
      userId,
      provider,
      model,
      messages,
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
    
    const defaultScopePath = `project/sessions/${sanitizePathSegment(resolvedConversationId)}`;
    // Sanitize scopePath to ensure folder names are not corrupted with ownerId prefix
    // e.g., "project/sessions/anon:1774710784761_6TB03h8Ow:002" -> "project/sessions/002"
    const requestedScopePath = sanitizeScopePath(
      typeof filesystemContext?.scopePath === 'string' && filesystemContext.scopePath.trim()
        ? filesystemContext.scopePath.trim()
        : defaultScopePath
    );
    // SECURITY: Use persistent anonymous session ID from cookie if available
    // Sanitize to prevent path traversal attacks (e.g., ".." or "/" in cookie value)
    // Use resolveFilesystemOwner for consistent anonymous session handling
    const ownerResolution = await resolveFilesystemOwner(request);
    const filesystemOwnerId = ownerResolution.ownerId;
    anonSessionIdToSet = ownerResolution.anonSessionId; // Set cookie if new anon session
    
    // Calculate these BEFORE parallel execution since they're dependencies
    const enableFilesystemEdits = shouldHandleFilesystemEdits(
      messages,
      attachedFilesystemFiles,
      filesystemContext,
    );
    const useContextPack = shouldUseContextPack(messages);
    const isCodeRequest = isCodeOrAgenticRequest(messages, attachedFilesystemFiles);
    const useContextPackForAgentic = enableFilesystemEdits && isCodeRequest;
    const shouldUseContextPackFinal = useContextPack || useContextPackForAgentic;
    
    // PARALLEL EXECUTION: Run independent async operations concurrently
    // This reduces latency by 40-60% by not waiting for each operation sequentially
    const [denialContext, workspaceSessionContext] = await Promise.all([
      // Get recent filesystem edit denials
      filesystemEditSessionService.getRecentDenials(
        `${filesystemOwnerId}:${resolvedConversationId}`,
        4,
      ),
      // Build workspace session context (only if filesystem edits are enabled)
      enableFilesystemEdits
        ? buildWorkspaceSessionContext(filesystemOwnerId, sanitizeScopePath(requestedScopePath), {
            useContextPack: shouldUseContextPackFinal,
            maxTokens: body.maxTokens,
          })
        : Promise.resolve('')
    ]);
    
    const contextualMessages = appendFilesystemContextMessages(
      messages,
      attachedFilesystemFiles,
      enableFilesystemEdits,
      denialContext,
      workspaceSessionContext,
    );

    chatLogger.debug('Validation passed, routing through priority chain', { requestId, provider, model });

    // NEW: Add tool/sandbox detection
    const requestType = detectRequestType(messages);
    const authenticatedUserId =
      authResult.success && authResult.source !== 'anonymous' ? authResult.userId : undefined;

    // V2 Agent Mode: route to OpenCode/Nullclaw workflow
    // Auto-detect V2 for code-intensive requests
    const isCodeRequestAuto = isCodeOrAgenticRequest(messages, attachedFilesystemFiles);
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

    // Agentic pipeline (non-V2) for code-centric requests
    // Only route to agentic pipeline if it's actually an integration request (OAuth needed)
    // Regular coding requests should use V2 (handled above) or regular chat
    const isIntegrationRequest = requiresThirdPartyOAuth(messages);
    if (isCodeRequest && !isIntegrationRequest && CHAT_AGENTIC_PIPELINE !== 'off') {
      // For non-integration code requests that don't want V2, fall through to regular chat
      // This allows "code a nextjs app" to get regular LLM response instead of agentic pipeline
    } else if (isCodeRequest && isIntegrationRequest && CHAT_AGENTIC_PIPELINE !== 'off') {
      // This is an integration request that needs OAuth
      if (!authenticatedUserId) {
        return NextResponse.json({
          success: false,
          status: 'auth_required',
          authUrl: '/api/auth/signin', // Site login for integration OAuth
          toolName: 'integration',
          provider: 'integration',
          error: {
            type: 'auth_required',
            message: 'This request requires connecting to an external service. Please log in.',
          },
        }, { status: 401 });
      }

      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content;
      const task = typeof lastUserMessage === 'string'
        ? lastUserMessage
        : JSON.stringify(lastUserMessage || '');

      const context = buildAgenticContext(contextualMessages);

      if (WORKFORCE_ENABLED && /parallel|multi-agent|agents|crew|swarm/i.test(task)) {
        await workforceManager.spawnTask(authenticatedUserId, resolvedConversationId, {
          title: 'Research & context gathering',
          description: `Gather context and research for: ${task}`,
          agent: 'nullclaw',
        });
        await workforceManager.spawnTask(authenticatedUserId, resolvedConversationId, {
          title: 'Implementation',
          description: task,
          agent: 'opencode',
        });
      }

      const config: UnifiedAgentConfig = {
        userMessage: context ? `${context}\n\nTASK:\n${task}` : task,
        conversationHistory: contextualMessages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        systemPrompt: process.env.OPENCODE_SYSTEM_PROMPT,
        maxSteps: parseInt(process.env.AI_SDK_MAX_STEPS || '15', 10),
        temperature,
        maxTokens,
        mode: 'auto',
      };

      const tools = await getMCPToolsForAI_SDK(authenticatedUserId);
      config.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }));
      config.executeTool = async (name: string, args: Record<string, any>) => {
        const result = await callMCPToolFromAI_SDK(name, args, authenticatedUserId);
        return {
          success: result.success,
          output: result.output,
          exitCode: result.success ? 0 : 1,
        };
      };

      if (stream) {
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
                
                // Emit file_edit events for newly detected edits
                for (const edit of newFileEdits) {
                  emit(SSE_EVENT_TYPES.FILE_EDIT, {
                    path: edit.path,
                    status: 'detected',
                    timestamp: Date.now(),
                  });
                  chatLogger.debug('Progressive file edit detected', { path: edit.path }, {});
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
              };

              const result = await processUnifiedAgentRequest(config);
              sendStep('Start agentic pipeline', result.success ? 'completed' : 'failed');
              emit(SSE_EVENT_TYPES.DONE, {
                success: result.success,
                content: result.response,
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
            } catch (error: any) {
              emit(SSE_EVENT_TYPES.ERROR, { message: error.message || 'Agentic execution failed' });

              // Cleanup on error too
              streamingContentBuffer = '';
              fileEditParserState.emittedEdits.clear();
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
          task: context ? `${context}\n\nTASK:\n${task}` : task,
          sessionId: resolvedConversationId,
          ownerId: authenticatedUserId,
          stream: stream === true,
        });

        if (stream === true) {
          // Return streaming response for custom orchestration modes
          const encoder = new TextEncoder();
          const streamBody = new ReadableStream({
            async start(controller) {
              try {
                // Send initial metadata
                controller.enqueue(encoder.encode(
                  `event: metadata\ndata: ${JSON.stringify({
                    mode: orchestrationMode,
                    agentType: orchestrationResult.metadata?.agentType,
                  })}\n\n`
                ));

                // Send response content
                if (orchestrationResult.response) {
                  controller.enqueue(encoder.encode(
                    `event: content\ndata: ${JSON.stringify({
                      content: orchestrationResult.response,
                    })}\n\n`
                  ));
                }

                // Send completion
                controller.enqueue(encoder.encode(
                  `event: done\ndata: ${JSON.stringify({
                    success: orchestrationResult.success,
                    metadata: orchestrationResult.metadata,
                  })}\n\n`
                ));

                controller.close();
              } catch (error: any) {
                controller.enqueue(encoder.encode(
                  `event: error\ndata: ${JSON.stringify({
                    message: error.message,
                  })}\n\n`
                ));
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
      const result = await processUnifiedAgentRequest(config);
      return NextResponse.json({
        success: result.success,
        content: result.response,
        data: result,
      });
    }

    // Tool/sandbox actions require authenticated user identity for authorization and ownership checks.
    if ((requestType === 'tool' || requestType === 'sandbox') && !authenticatedUserId) {
      return NextResponse.json({
        success: false,
        status: 'auth_required',
        error: {
          type: 'auth_required',
          message: `${requestType === 'tool' ? 'Tool use' : 'Sandbox actions'} require authentication. Please log in first.`
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
      userId: authenticatedUserId, // Include userId for tool and sandbox authorization
      // For filesystem operations (including spec enhancement background refinement),
      // use the resolved filesystem owner ID which handles anonymous users correctly
      filesystemOwnerId: filesystemOwnerId,
      // Include conversation ID for spec enhancement filesystem edits
      conversationId: `${filesystemOwnerId}:${resolvedConversationId}`,
      // Keep these tri-state so router-level detection can still route specialized endpoints.
      // `false` means "explicitly disable", `undefined` means "auto-detect".
      enableTools: requestType === 'tool' ? !!authenticatedUserId : undefined,
      enableSandbox: requestType === 'sandbox' ? !!authenticatedUserId : undefined,
      enableComposio: requestType === 'tool' ? !!authenticatedUserId : undefined,
      mode: body.mode || 'enhanced', // Add mode from request
      // When Vercel AI SDK handles tool calling natively, skip regex intent parsing
      nativeToolCalling: VERCEL_AI_PROVIDERS.has(provider) && !!authenticatedUserId,
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
    const placeholderEmit = (event: string, data: any) => {
      if (!acceptDeferredEvents) {
        return;
      }
      if (emitRef.current) {
        emitRef.current(event, data);
      } else if (pendingEvents.length < MAX_PENDING_EVENTS) {
        pendingEvents.push({ event, data, timestamp: Date.now() });
      }
    };

    try {
      let unifiedResponse

      // Spec amplification only works with V1 mode (regular LLM calls)
      // V2 agent mode has its own planning system
      if (agentMode === 'v2') {
        chatLogger.debug('V2 agent mode, using standard routing without spec amplification', { requestId })
        unifiedResponse = await responseRouter.routeAndFormat(routerRequest)
      } else if (stream && SPEC_AMPLIFICATION_STREAM_EVENTS_ENABLED) {
        // NEW: For streaming with spec amplification, we need special handling
        // The response will contain a stream generator that we consume in real-time
        chatLogger.debug('V1 mode with streaming, using routeWithSpecAmplification with emit', { requestId })
        unifiedResponse = await responseRouter.routeWithSpecAmplification({
          ...routerRequest,
          emit: placeholderEmit
        })
        
        // Check if response has streaming generator (real-time LLM streaming)
        if (unifiedResponse.stream && typeof unifiedResponse.stream === 'object' && Symbol.asyncIterator in unifiedResponse.stream) {
          chatLogger.info('Received streaming response with generator, will consume chunks in real-time', { requestId })
          // The stream generator will be consumed below in the streaming section
        }
      } else {
        // V1 mode or auto - use spec amplification if enabled (non-streaming)
        unifiedResponse = await responseRouter.routeWithSpecAmplification({
          ...routerRequest,
        })
      }

      // Extract actual provider/model from response metadata (after fallbacks)
      actualProvider = unifiedResponse.metadata?.actualProvider || unifiedResponse.source;
      actualModel = unifiedResponse.metadata?.actualModel || routerRequest.model;

      chatLogger.info('Request handled by response router', { requestId, provider: actualProvider, model: actualModel }, {
        source: unifiedResponse.source,
        priority: unifiedResponse.priority,
        fallbackChain: unifiedResponse.metadata?.fallbackChain,
      });

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
      const lastUserMessage =
        [...messages].reverse().find((m) => m.role === 'user')?.content;
      const v1AgentTask = typeof lastUserMessage === 'string'
        ? lastUserMessage
        : JSON.stringify(lastUserMessage || '');
      const v1AgentContext = buildAgenticContext(contextualMessages);
      const v1AgentPrompt = v1AgentContext
        ? `${v1AgentContext}\n\nTASK:\n${v1AgentTask}`
        : v1AgentTask;

      // V1 agentic tools: reuse existing Mastra tool loop for coding/tool requests.
      let agentToolResults = null;
      let agentToolStreamingResult: any = null;
      
      const shouldRunV1AgentLoop =
        LLM_AGENT_TOOLS_ENABLED &&
        enableFilesystemEdits &&
        !!v1AgentTask &&
        (requestType === 'tool' || (agentMode !== 'v2' && isCodeRequest));

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
      
      const filesystemEdits =
        !enableFilesystemEdits
          ? null
          : await applyFilesystemEditsFromResponse({
              ownerId: filesystemOwnerId,
              conversationId: `${filesystemOwnerId}:${resolvedConversationId}`,
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
            });
      chatLogger.debug('Filesystem edits processed', { requestId, appliedCount: filesystemEdits?.applied?.length || 0 });
      
      let sanitizedResponseContent = sanitizeAssistantDisplayContent(rawResponseContent);
      if (
        !sanitizedResponseContent.trim() &&
        filesystemEdits &&
        filesystemEdits.applied.length > 0
      ) {
        sanitizedResponseContent =
          `Applied filesystem changes to ${filesystemEdits.applied.length} file(s).`;
      }
      const clientResponse = buildClientVisibleUnifiedResponse(
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

        if (codeArtifacts.length > 0) {
          clientResponse.metadata = {
            ...clientResponse.metadata,
            codeArtifacts,
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
        const streamRequestId = requestId || generateSecureId('stream');
        const streamStartTime = Date.now();
        let chunkCount = 0;

        // NEW: Check if we have LLM stream generator from enhancedLLMService (real-time LLM token streaming)
        const hasLLMStreamGenerator = unifiedResponse.stream && 
          typeof unifiedResponse.stream === 'object' && 
          Symbol.asyncIterator in unifiedResponse.stream;

        if (hasLLMStreamGenerator) {
          // Handle real-time LLM streaming with progressive parsing
          chatLogger.info('Streaming with LLM generator (real-time token streaming)', { requestId: streamRequestId, provider: actualProvider, model: actualModel });

          const encoder = new TextEncoder();
          let encoderRef = encoder;
          let streamingContentBuffer = '';
          const fileEditParserState = createIncrementalParser();

          const readableStream = new ReadableStream({
            async start(controller) {
              const realEmit = (eventType: string, data: any) => {
                if (request.signal?.aborted) return;
                const eventStr = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
                controller.enqueue(encoderRef.encode(eventStr));
                chunkCount++;
              };

              emitRef.current = realEmit;

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
                  cleanup();
                  chatLogger.warn('LLM stream cancelled by client', { requestId: streamRequestId });
                });
              }

              try {
                // Consume the LLM stream generator in real-time
                // This is where TRUE streaming happens - tokens as they're generated by the LLM
                for await (const streamChunk of unifiedResponse.stream as AsyncGenerator<StreamingResponse>) {
                  if (request.signal?.aborted) break;

                  // Emit token chunk immediately
                  if (streamChunk.content) {
                    realEmit('token', { 
                      content: streamChunk.content, 
                      timestamp: Date.now(),
                      type: 'token'
                    });

                    // Progressive file edit detection from streaming content
                    streamingContentBuffer += streamChunk.content;
                    const newFileEdits = extractIncrementalFileEdits(streamingContentBuffer, fileEditParserState);

                    for (const edit of newFileEdits) {
                      realEmit('file_edit', {
                        path: edit.path,
                        status: 'detected',
                        timestamp: Date.now(),
                      });
                      chatLogger.debug('Progressive file edit detected during LLM stream', { path: edit.path });
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
                  if (streamChunk.toolCalls && streamChunk.toolCalls.length > 0) {
                    for (const toolCall of streamChunk.toolCalls) {
                      realEmit('tool_call', {
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        args: toolCall.arguments,
                        timestamp: Date.now(),
                      });
                    }
                  }

                  // Handle tool invocations if present
                  if (streamChunk.toolInvocations && streamChunk.toolInvocations.length > 0) {
                    for (const toolInvocation of streamChunk.toolInvocations) {
                      realEmit('tool_invocation', {
                        toolCallId: toolInvocation.toolCallId,
                        toolName: toolInvocation.toolName,
                        state: toolInvocation.state,
                        args: toolInvocation.args,
                        result: toolInvocation.result,
                        timestamp: Date.now(),
                      });
                    }
                  }

                  // Handle files if present
                  if (streamChunk.files && streamChunk.files.length > 0) {
                    for (const file of streamChunk.files) {
                      realEmit('file_edit', {
                        path: file.path,
                        status: file.operation === 'delete' ? 'deleted' : 'detected',
                        operation: file.operation,
                        content: file.content,
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

                  // Handle finish reason at end of stream
                  if (streamChunk.isComplete) {
                    // Post-processing: run filesystem edits on accumulated stream content
                    // This ensures WRITE/APPLY_DIFF from streamed output reaches the VFS
                    const streamedContent = streamingContentBuffer;
                    if (enableFilesystemEdits && streamedContent.trim()) {
                      try {
                        const streamedEdits = await applyFilesystemEditsFromResponse({
                          ownerId: filesystemOwnerId,
                          conversationId: `${filesystemOwnerId}:${resolvedConversationId}`,
                          requestId: streamRequestId,
                          scopePath: requestedScopePath,
                          lastUserMessage: (() => {
                            const c = [...messages].reverse().find((m) => m.role === 'user')?.content;
                            return typeof c === 'string' ? c : '';
                          })(),
                          attachedPaths: attachedFilesystemFiles.map((file) => file.path),
                          responseContent: streamedContent,
                          commands: unifiedResponse.commands,
                        });
                        // Emit applied file edits
                        if (streamedEdits?.applied?.length) {
                          for (const edit of streamedEdits.applied) {
                            realEmit('file_edit', {
                              path: edit.path,
                              status: 'applied',
                              operation: edit.operation || 'write',
                              timestamp: Date.now(),
                            });
                          }
                        }
                      } catch (editErr: any) {
                        chatLogger.warn('Post-stream filesystem edits failed', { requestId: streamRequestId, error: editErr.message });
                      }
                    }

                    realEmit('done', {
                      requestId: streamRequestId,
                      timestamp: Date.now(),
                      success: true,
                      finishReason: streamChunk.finishReason,
                      tokensUsed: streamChunk.tokensUsed,
                      usage: streamChunk.usage,
                    });
                    break; // Exit loop when complete
                  }
                }

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
                    } else if (chunk.type === 'reasoning') {
                      const reasoningEvent = `event: reasoning\ndata: ${JSON.stringify({
                        requestId: streamRequestId,
                        reasoning: chunk.reasoning,
                        timestamp: Date.now(),
                      })}\n\n`;
                      controller.enqueue(encoderRef.encode(reasoningEvent));
                      chunkCount++;
                    } else if (chunk.type === 'text-delta') {
                      // Stream text response
                      const tokenEvent = `event: token\ndata: ${JSON.stringify({
                        content: chunk.textDelta,
                        timestamp: Date.now(),
                      })}\n\n`;
                      controller.enqueue(encoderRef.encode(tokenEvent));
                      chunkCount++;
                    }

                  }

                  // Send completion event
                  const doneEvent = `event: done\ndata: ${JSON.stringify({
                    requestId: streamRequestId,
                    timestamp: Date.now(),
                  })}\n\n`;
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
                });

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
            fileEditEvents.push(`event: file_edit\ndata: ${JSON.stringify({
              requestId: streamRequestId,
              path: edit.path,
              status: 'detected',
              operation: edit.operation,
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
              const tokenEvents = events.filter(e => e.includes('event: token') && e.includes('"type":"token"'));
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

              // Record latency for provider router (use actual provider after fallbacks)
              try {
                llmProviderRouter.recordRequest(actualProvider as LLMProviderType, streamDuration, true);
              } catch (error) {
                chatLogger.warn('Failed to record provider metrics', {
                  provider: actualProvider,
                  error: error instanceof Error ? error.message : String(error)
                });
              }

              if (!SPEC_AMPLIFICATION_STREAM_EVENTS_ENABLED) {
                streamClosed = true;
                controller.close();
                cleanup();
                return;
              }

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
              });

              // Record error latency for provider router
              try {
                llmProviderRouter.recordRequest(actualProvider as LLMProviderType, streamDuration, false);
              } catch (recordError) {
                chatLogger.warn('Failed to record provider error metrics', {
                  provider: actualProvider,
                  error: recordError instanceof Error ? recordError.message : String(recordError)
                });
              }

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

      // Record latency for provider router (use actual provider after fallbacks)
      try {
        llmProviderRouter.recordRequest(actualProvider as LLMProviderType, responseLatency, clientResponse.success !== false);
      } catch (error) {
        chatLogger.warn('Failed to record provider metrics', { 
          provider: actualProvider, 
          error: error instanceof Error ? error.message : String(error) 
        });
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
  }
  catch (error) {
    const errorLatency = Date.now() - requestStartTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNotConfiguredError = errorMessage.includes('not configured');

    if (!isNotConfiguredError) {
      chatLogger.error('Critical chat API error', { requestId, provider: actualProvider, model: actualModel }, {
        error: errorMessage,
        latencyMs: errorLatency,
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Record error latency for provider router (use actual provider)
      try {
        llmProviderRouter.recordRequest(actualProvider as LLMProviderType, errorLatency, false);
      } catch (recordError) {
        chatLogger.warn('Failed to record provider error metrics', { 
          provider: actualProvider, 
          error: recordError instanceof Error ? recordError.message : String(recordError) 
        });
      }
    } else {
      chatLogger.warn('Provider not available', { requestId, provider: actualProvider, model: actualModel }, {
        error: errorMessage,
        latencyMs: errorLatency,
      });

      // Record error latency for provider router (use actual provider)
      try {
        llmProviderRouter.recordRequest(actualProvider as LLMProviderType, errorLatency, false);
      } catch (recordError) {
        chatLogger.warn('Failed to record provider error metrics', { 
          provider: actualProvider, 
          error: recordError instanceof Error ? recordError.message : String(recordError) 
        });
      }
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

function appendFilesystemContextMessages(
  messages: LLMMessage[],
  attachedFiles: ChatFilesystemFileContext[],
  allowFileEdits: boolean,
  denialContext: Array<{ reason: string; paths: string[]; timestamp: string }> = [],
  workspaceContext: string = '',
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
        ? 'Virtual filesystem is available for this request. You may propose edits and create full project folder structures.'
        : 'Attached filesystem context for this request:',
      '',
      ...chunks,
      '',
      allowFileEdits
        ? [
            'For file changes, prefer one of these parseable schemas:',
            '',
            'CAPABILITY CHOICE:',
            '- For modifying an existing file, use APPLY_DIFF first.',
            '- For creating a brand-new file, use WRITE or <file_edit path="...">...</file_edit>.',
            '- For deleting a file, use DELETE <path>.',
            '- For reading or referring to existing workspace content, use <file_read path="..." /> when needed.',
            '- For shell/runtime instructions meant for the user terminal, emit a single ```bash block.',
            '',
            'FOR EXISTING FILES, prefer surgical edits (APPLY_DIFF) over full rewrites:',
            '  <apply_diff path="src/utils.ts">',
            '    <search>function oldName() {',
            '      return 1;',
            '    }</search>',
            '    <replace>function newName() {',
            '      return 2;',
            '    }</replace>',
            '  </apply_diff>',
            'Or in fs-actions blocks:',
            '  APPLY_DIFF <path>',
            '  <<<',
            '  <exact code to find>',
            '  ===',
            '  <replacement code>',
            '  >>>',
            '',
            'FOR NEW FILES, use full writes:',
            '1) <file_edit path="...">...</file_edit>',
            '2) COMMANDS write_diffs',
            '3) ```fs-actions ...``` blocks with:',
            '   WRITE <path>',
            '   <<<',
            '   <full file content>',
            '   >>>',
            '   PATCH <path>',
            '   <<<',
            '   <unified diff body>',
            '   >>>',
            '   DELETE <path>',
            '',
            'IMPORTANT: For edits to existing files, ALWAYS use APPLY_DIFF instead of WRITE.',
            'APPLY_DIFF only replaces the exact block you specify, preventing context truncation.',
            'Use WRITE only when creating new files or when a complete rewrite is explicitly needed.',
            'Do not rewrite whole existing files unless the user explicitly wants a full rewrite.',
            '',
            'DIFF AUTHORING RULES:',
            '- The <search> block or APPLY_DIFF search section must match the existing code exactly, including spacing and punctuation.',
            '- Keep each diff surgical and minimal; prefer multiple small APPLY_DIFF operations over one large rewrite.',
            '- Include enough surrounding context in the search block to uniquely identify the target.',
            '- If multiple files are involved, emit one operation per file rather than mixing contents.',
            '',
            'DIFF-BASED SELF-HEALING:',
            '- If an edit might fail because surrounding code may have drifted, first read/reference the latest file content and then emit a narrower APPLY_DIFF.',
            '- If a search block is large, brittle, or repeated, reduce it to the smallest unique exact block.',
            '- If an earlier attempted patch likely failed, do not repeat the same broad patch; emit a corrected APPLY_DIFF with fresher exact context.',
            '- Prefer preserving user code and making the minimum viable edit rather than replacing entire functions or files.',
            'Prefer concrete multi-file edits when user requests full project scaffolding.',
            '',
            'To read a file from the workspace, use: <file_read path="..." />',
            '',
            'When the user asks how to run code, include shell commands in ```bash blocks.',
            'The user has a terminal that can execute these commands.',
            'For multi-step setups, provide all commands in a single bash block so they can be run together.',
            'Use bash blocks for user-facing commands only; use filesystem edit schemas for file mutations.',
            'If a task is too large for a single response, end with the exact token: [CONTINUE_REQUESTED]',
            'Example: ```bash',
            'npm install',
            'npm run dev',
            '```',
          ].join('\n')
        : '',
      workspaceContext ? `Current workspace session context:\n${workspaceContext}` : '',
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

function isCodeOrAgenticRequest(
  messages: LLMMessage[],
  attachedFiles: ChatFilesystemFileContext[],
): boolean {
  if (attachedFiles.length > 0) return true;

  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const content =
    typeof lastUser?.content === 'string'
      ? lastUser.content
      : JSON.stringify(lastUser?.content || '');

  if (STRONG_CODE_PATTERN.test(content)) return true;

  let weakMatches = 0;
  for (const re of WEAK_CODE_PATTERNS) {
    if (re.test(content) && ++weakMatches >= 2) return true;
  }

  return false;
}

/**
 * Check if request specifically needs 3rd party OAuth integration (not just general coding)
 * This is separate from isCodeOrAgenticRequest - it returns true ONLY for actual integrations
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
 * Validate an extracted file path to prevent garbage paths from being written.
 * Rejects paths containing heredoc markers, control chars, or command names.
 */
function validateExtractedPath(raw: string): string | null {
  const path = (raw || '').trim().replace(/^['"`]|['"`]$/g, '');
  if (!path) return null;
  if (path.length > 300) return null;
  if (PATH_CONTROL_CHARS_RE.test(path)) return null;
  if (PATH_HEREDOC_RE.test(path)) return null;
  if (PATH_UNSAFE_CHARS_RE.test(path)) return null;
  if (PATH_BAD_START_RE.test(path)) return null;
  if (PATH_TOO_MANY_DOTS_RE.test(path)) return null;
  if (PATH_TRAVERSAL_RE.test(path)) return null;
  if (PATH_COMMAND_RE.test(path)) return null;
  return path;
}

/**
 * Strip heredoc markers (<<<, >>>) that may wrap file content.
 * Also strips a leading WRITE/PATCH command line if present.
 */
function stripHeredocMarkers(content: string): string {
  let cleaned = content;
  // Remove leading "WRITE path" or "PATCH path" line if the whole block is a command
  cleaned = cleaned.replace(/^\s*(?:WRITE|PATCH)\s+\S+\s*\n/, '');
  // Strip leading <<< marker (with optional whitespace/newline)
  cleaned = cleaned.replace(/^\s*<<<\s*\n?/, '');
  // Strip trailing >>> marker (with optional whitespace/newline)
  cleaned = cleaned.replace(/\n?\s*>>>\s*$/, '');
  return cleaned;
}

function extractFileWriteFolderCreateTags(content: string): {
  writes: Array<{ path: string; content: string }>;
  folders: string[];
} {
  // Use shared parser for file_write tags
  const fileWrites = extractFileWriteEdits(content);
  const writes: Array<{ path: string; content: string }> = fileWrites.map(w => ({
    path: w.path,
    content: w.content
  }));

  const folders: string[] = []

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

  return { writes, folders }
}

function sanitizePathSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
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
  return resolveScopeUtil(normalizedRelative, input.scopePath);
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
}): Promise<FilesystemEditResult> {
  const parsedResponse = parseFilesystemResponse(input.responseContent || '');
  const fileWriteFolderCreateOps = extractFileWriteFolderCreateTags(input.responseContent || '');
  const combinedWriteEdits = [
    ...parsedResponse.writes.map(edit => ({ path: edit.path, content: edit.content })),
    ...fileWriteFolderCreateOps.writes.map(w => ({ path: w.path, content: w.content })),
  ].map(edit => ({
    ...edit,
    // Universal sanitization: strip any leaked heredoc markers from all extractors
    content: stripHeredocMarkers(edit.content),
  })).filter(edit => {
    const validPath = validateExtractedPath(edit.path);
    if (!validPath) {
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
      console.warn('[applyFilesystemEdits] Rejected invalid diff path:', op.path.substring(0, 80));
      return false;
    }
    op.path = validPath;
    return true;
  });
  const applyDiffOperations = parsedResponse.applyDiffs.filter(op => {
    const validPath = validateExtractedPath(op.path);
    if (!validPath) {
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
      console.warn('[applyFilesystemEdits] Rejected invalid delete path:', p.substring(0, 80));
      return null;
    }
    return validPath;
  }).filter((p): p is string => !!p);
  const folderCreateTargets = [...new Set([...parsedResponse.folders, ...fileWriteFolderCreateOps.folders])];
  const requestFiles = input.commands?.request_files || [];

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
          result.errors.push(`Failed to apply unified diff for ${targetPath}: patch could not be applied`);
          continue;
        }
        const file = await virtualFilesystem.writeFile(input.ownerId, targetPath, patchedContent);

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

  return result;
}

export async function GET(request: NextRequest) {
  // Precompile warmup: Initialize LLM providers on first GET request
  // This ensures the route is ready for subsequent POST requests without cold start
  const url = new URL(request.url);
  
  // If called with ?warmup=true, trigger provider initialization
  if (url.searchParams.get('warmup') === 'true') {
    try {
      const { llmService } = await import("@/lib/chat/llm-providers");
      await llmService.warmupProviders();
      const availableProviders = llmService.getAvailableProviders();
      
      return NextResponse.json({
        success: true,
        message: "Chat API pre-warmed and ready",
        availableProviders: availableProviders.length,
        providers: availableProviders.map(p => p.id),
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
    error.message
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
