import { NextRequest, NextResponse } from "next/server";
import { z } from 'zod';
import { llmService, PROVIDERS } from "@/lib/chat/llm-providers";
import { errorHandler } from "@/lib/chat/error-handler";
import { responseRouter } from "@/lib/api/response-router";
import { resolveRequestAuth } from "@/lib/auth/request-auth";
import { resolveFilesystemOwner, withAnonSessionCookie } from "@/lib/virtual-filesystem/resolve-filesystem-owner";
import { detectRequestType } from "@/lib/utils/request-type-detector";
import { generateSecureId } from '@/lib/utils';
import { chatRequestLogger } from '@/lib/chat/chat-request-logger';
import { chatLogger } from '@/lib/chat/chat-logger';
import { parsePatch, applyPatch } from 'diff';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { filesystemEditSessionService } from '@/lib/virtual-filesystem/filesystem-edit-session-service';
import { contextPackService } from '@/lib/virtual-filesystem/context-pack-service';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { extractSessionIdFromPath, resolveScopedPath as resolveScopeUtil } from '@/lib/virtual-filesystem/scope-utils';
import { createNDJSONParser } from '@/lib/utils/ndjson-parser';
import type { LLMMessage } from "@/lib/chat/llm-providers";
import { checkRateLimit } from '@/lib/middleware/rate-limiter';
import { createFilesystemTools, createAgentLoop } from '@/lib/orchestra/mastra';
import { executeV2Task, executeV2TaskStreaming } from '@/lib/agent/v2-executor';
import { processUnifiedAgentRequest, type UnifiedAgentConfig } from '@/lib/orchestra/unified-agent-service';
import { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } from '@/lib/mcp';
import { workforceManager } from '@/lib/agent/workforce-manager';
import { createSSEEmitter, SSE_RESPONSE_HEADERS, SSE_EVENT_TYPES } from '@/lib/streaming/sse-event-schema';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { llmProviderRouter, type LLMProviderType } from '@/lib/chat/llm-provider-router';
import { sanitizeFileEditTags, extractFileEdits, extractFileWriteEdits, extractFencedDiffEdits as extractFencedDiffEditsShared } from '@/lib/chat/file-edit-parser';

// Force Node.js runtime for Daytona SDK compatibility
export const runtime = 'nodejs';

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

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.union([z.string(), z.array(z.any())]),
}).passthrough();

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1, 'Messages array cannot be empty'),
  provider: z.string().min(1, 'Provider is required'),
  model: z.string().min(1, 'Model is required'),
  temperature: z.number().min(0).refine((val) => val <= 2, 'Temperature must be at most 2').optional().default(0.7),
  maxTokens: z.number().int().min(1).refine((val) => val <= 200000, 'Max tokens must be at most 200000').optional().default(100096),
  stream: z.boolean().optional().default(true),
  apiKeys: z.record(z.string()).optional().default({}),
  requestId: z.string().optional(),
  conversationId: z.string().optional(),
  agentMode: z.enum(['v1', 'v2', 'auto']).optional().default('auto'),
  filesystemContext: z.object({
    attachedFiles: z.any().optional(),
    applyFileEdits: z.boolean().optional(),
    scopePath: z.string().optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();
  const requestId = generateSecureId('chat');

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
      const isModelSupported = selectedProvider.models.some(
        m => m === model || m.startsWith(model + ':') || m.endsWith(':' + model.split(':')[0])
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
    const normalizedModel = selectedProvider.models.find(
      m => m === model || m.startsWith(model + ':') || m.endsWith(':' + model.split(':')[0])
    ) || model;
    const attachedFilesystemFiles = normalizeFilesystemContext(filesystemContext?.attachedFiles);
    const resolvedConversationId =
      typeof conversationId === 'string' && conversationId.trim()
        ? conversationId.trim()
        : `session_${authResult.userId || 'anon'}_${new Date().toISOString().slice(0, 10)}`;
    const defaultScopePath = `project/sessions/${sanitizePathSegment(resolvedConversationId)}`;
    const requestedScopePath =
      typeof filesystemContext?.scopePath === 'string' && filesystemContext.scopePath.trim()
        ? filesystemContext.scopePath.trim()
        : defaultScopePath;
    // SECURITY: Use persistent anonymous session ID from cookie if available
    const anonSessionCookie = request.cookies.get('anon-session-id')?.value;
    const filesystemOwnerId = authResult.success && authResult.userId 
      ? authResult.userId 
      : anonSessionCookie 
        ? `anon:${anonSessionCookie.startsWith('anon_') ? anonSessionCookie.slice(5) : anonSessionCookie}`
        : `anon:${generateSecureId('anon').slice(5)}`;
    const denialContext = await filesystemEditSessionService.getRecentDenials(
      `${filesystemOwnerId}:${resolvedConversationId}`,
      4,
    );
    const enableFilesystemEdits = shouldHandleFilesystemEdits(
      messages,
      attachedFilesystemFiles,
      filesystemContext,
    );
    const useContextPack = shouldUseContextPack(messages);
    const isCodeRequest = isCodeOrAgenticRequest(messages, attachedFilesystemFiles);
    const useContextPackForAgentic = enableFilesystemEdits && isCodeRequest;
    const shouldUseContextPackFinal = useContextPack || useContextPackForAgentic;
    const workspaceSessionContext = enableFilesystemEdits
      ? await buildWorkspaceSessionContext(filesystemOwnerId, requestedScopePath, {
          useContextPack: shouldUseContextPackFinal,
          maxTokens: body.maxTokens,
        })
      : '';
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

            try {
              sendStep('Start agentic pipeline', 'started');
              config.onStreamChunk = (chunk: string) => {
                emit(SSE_EVENT_TYPES.TOKEN, { content: chunk, timestamp: Date.now() });
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
            } catch (error: any) {
              emit(SSE_EVENT_TYPES.ERROR, { message: error.message || 'Agentic execution failed' });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(streamBody, { headers: SSE_RESPONSE_HEADERS });
      }

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
      // Keep these tri-state so router-level detection can still route specialized endpoints.
      // `false` means "explicitly disable", `undefined` means "auto-detect".
      enableTools: requestType === 'tool' ? !!authenticatedUserId : undefined,
      enableSandbox: requestType === 'sandbox' ? !!authenticatedUserId : undefined,
      enableComposio: requestType === 'tool' ? !!authenticatedUserId : undefined,
    };

    chatLogger.debug('Routing request through priority chain', { requestId, provider, model }, {
      requestType,
      enableTools: routerRequest.enableTools,
      enableSandbox: routerRequest.enableSandbox,
      enableComposio: routerRequest.enableComposio,
    });

      // Route through priority chain and format response using consolidated router
    try {
      const unifiedResponse = await responseRouter.routeAndFormat(routerRequest);

      const actualProvider = unifiedResponse.metadata?.actualProvider || unifiedResponse.source;
      const actualModel = unifiedResponse.metadata?.actualModel || routerRequest.model;

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

      // LLM Agent Tools: Execute filesystem tools if enabled and user is authenticated
      let agentToolResults = null;
      let agentToolStreamingResult: any = null;
      
      if (LLM_AGENT_TOOLS_ENABLED && authenticatedUserId && requestType === 'tool') {
        try {
          chatLogger.info('Executing filesystem tools', { requestId, userId: authenticatedUserId }, {
            scopePath: requestedScopePath,
            maxIterations: LLM_AGENT_TOOLS_MAX_ITERATIONS,
          });

          const agentLoop = createAgentLoop(
            authenticatedUserId,
            requestedScopePath || 'workspace',
            LLM_AGENT_TOOLS_MAX_ITERATIONS
          );

          // Check if agent supports streaming (ToolLoopAgent integration)
          const supportsStreaming = 'executeTaskStreaming' in agentLoop;
          
          if (supportsStreaming && stream) {
            // Use streaming execution for real-time tool invocations and reasoning
            chatLogger.info('Using ToolLoopAgent streaming execution', { requestId });
            
            // Store streaming result for later processing in stream handler
            agentToolStreamingResult = {
              agentLoop,
              task: rawResponseContent,
              timeout: LLM_AGENT_TOOLS_TIMEOUT_MS,
            };
          } else {
            // Use non-streaming execution (backward compatible)
            // Set timeout for agent execution with proper cleanup
            let agentTimeoutId: NodeJS.Timeout | null = null;
            const agentPromise = agentLoop.executeTask(rawResponseContent);
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

            // Append agent tool results to response
            if (agentToolResults.success && agentToolResults.results?.length > 0) {
              const toolSummary = agentToolResults.results
                .map((r: any) => `${r.tool}: ${JSON.stringify(r.result)}`)
                .join('\n');
              unifiedResponse.content = `${rawResponseContent}\n\n[Agent Tools Executed]\n${toolSummary}`;
              // Sync rawResponseContent so subsequent rendering uses updated content
              rawResponseContent = unifiedResponse.content;
            }
          }
        } catch (error: any) {
          chatLogger.error('Agent tools execution failed', { requestId }, {
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
          };
        }
      }

      // Handle streaming response
      chatLogger.debug('Checking streaming conditions', { requestId, stream, supportsStreaming: selectedProvider.supportsStreaming });
      if (stream && selectedProvider.supportsStreaming) {
        const streamRequestId = requestId || generateSecureId('stream');
        const streamStartTime = Date.now();
        let chunkCount = 0;

        // Check if we have ToolLoopAgent streaming available
        const hasToolLoopStreaming = agentToolStreamingResult && stream;

        if (hasToolLoopStreaming) {
          // Handle ToolLoopAgent real-time streaming
          chatLogger.info('Streaming with ToolLoopAgent real-time events', { requestId: streamRequestId });
          
          const encoder = new TextEncoder();
          let encoderRef = encoder;

          const readableStream = new ReadableStream({
            async start(controller) {
              const cleanup = () => {
                encoderRef = null;
              };

              if (request.signal) {
                request.signal.addEventListener('abort', () => {
                  cleanup();
                  chatLogger.warn('Stream cancelled by client', { requestId: streamRequestId });
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
                    await new Promise(resolve => setTimeout(resolve, 30));
                  }

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

                    // Minimal delay for faster streaming (reduced from 30ms)
                    await new Promise(resolve => setTimeout(resolve, 5));
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
                chatLogger.error('ToolLoopAgent streaming error', { requestId: streamRequestId }, {
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
            },
          });
        }

        // Fallback: Standard streaming (non-agent or ToolLoopAgent not available)
        // Create streaming events from unified response
        const events = responseRouter.createStreamingEvents(clientResponse, streamRequestId);
        const supplementalAgenticEvents = buildSupplementalAgenticEvents(clientResponse, streamRequestId, events);
        if (supplementalAgenticEvents.length > 0) {
          events.splice(Math.max(0, events.length - 1), 0, ...supplementalAgenticEvents);
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
        chatLogger.info('Starting streaming response', { requestId: streamRequestId, provider, model }, {
          eventsCount: events.length,
          hasFilesystemEdits: hasActualFilesystemEdits,
          appliedEditsCount: filesystemEdits?.applied?.length || 0,
          requestedFilesCount: filesystemEdits?.requestedFiles?.length || 0,
        });

        const encoder = new TextEncoder();
        let encoderRef = encoder;  // Reference for cleanup

        const readableStream = new ReadableStream({
          async start(controller) {
            // Cleanup function for resource management
            const cleanup = () => {
              encoderRef = null;
            };

            // Handle client disconnect
            if (request.signal) {
              request.signal.addEventListener('abort', () => {
                cleanup();
                const streamDuration = Date.now() - streamStartTime;
                chatLogger.warn('Stream cancelled by client', { requestId: streamRequestId, provider, model }, {
                  chunkCount,
                  latencyMs: streamDuration,
                });
              });
            }

            try {
              // Send events with appropriate delays
              for (let i = 0; i < events.length; i++) {
                // Check if client disconnected
                if (request.signal?.aborted) {
                  cleanup();
                  return;
                }

                const event = events[i];
                controller.enqueue(encoderRef.encode(event));
                chunkCount++;

                // Minimal delay between events for faster streaming (reduced from 50ms)
                if (i < events.length - 1) {
                  await new Promise(resolve => setTimeout(resolve, 8));
                }
              }

              const streamDuration = Date.now() - streamStartTime;
              chatLogger.info('Stream completed successfully', { requestId: streamRequestId, provider, model }, {
                chunkCount,
                latencyMs: streamDuration,
                eventsCount: events.length,
              });

              controller.close();
            } catch (error) {
              const streamDuration = Date.now() - streamStartTime;
              chatLogger.error('Streaming error', { requestId: streamRequestId, provider, model }, {
                error: error instanceof Error ? error.message : String(error),
                chunkCount,
                latencyMs: streamDuration,
              });

              // Only send error event if client hasn't disconnected
              if (!request.signal?.aborted) {
                const errorEvent = `event: error\ndata: ${JSON.stringify({
                  requestId: streamRequestId,
                  message: 'Streaming error occurred',
                  canRetry: true  // Changed to true - most errors are retryable
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
            chatLogger.warn('Stream cancelled (cancel callback)', { requestId: streamRequestId, provider, model }, {
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
          },
        });
      }

      // Handle non-streaming response
      const responseLatency = Date.now() - requestStartTime;
      chatLogger.info('Non-streaming response completed', { requestId, provider, model }, {
        latencyMs: responseLatency,
        contentLength: clientResponse.content?.length || 0,
        success: clientResponse.success,
      });
      
      // Record successful latency for provider router
      try {
        llmProviderRouter.recordRequest(provider as LLMProviderType, responseLatency, clientResponse.success !== false);
      } catch {}

      const responseStatus = clientResponse.success ? 200 : 500;
      return NextResponse.json(
        {
          success: clientResponse.success,
          data: clientResponse.data,
          commands: clientResponse.commands,
          filesystem: filesystemEdits,
          metadata: clientResponse.metadata,
          timestamp: clientResponse.metadata?.timestamp
        },
        { status: responseStatus }
      );
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
      return NextResponse.json({
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
      }, { status: 503 }); // Service Unavailable - indicates temporary issue
    }
  }
  catch (error) {
    const errorLatency = Date.now() - requestStartTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNotConfiguredError = errorMessage.includes('not configured');

    if (!isNotConfiguredError) {
      chatLogger.error('Critical chat API error', { requestId, provider, model }, {
        error: errorMessage,
        latencyMs: errorLatency,
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      // Record error latency for provider router
      try {
        llmProviderRouter.recordRequest(provider as LLMProviderType, errorLatency, false);
      } catch {}
    } else {
      chatLogger.warn('Provider not available', { requestId, provider, model }, {
        error: errorMessage,
        latencyMs: errorLatency,
      });
      
      // Record error latency for provider router
      try {
        llmProviderRouter.recordRequest(provider as LLMProviderType, errorLatency, false);
      } catch {}
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
    return NextResponse.json(
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
    );
  }
}

function sanitizeAssistantDisplayContent(content: string): string {
  if (!content) return '';
  let next = content;

  // Remove explicit command envelopes
  next = next.replace(/===\s*COMMANDS_START\s*===([\s\S]*?)===\s*COMMANDS_END\s*===/gi, '');
  next = next.replace(/```fs-actions\s*[\s\S]*?```/gi, '');
  // Remove file_edit tags using shared parser
  next = sanitizeFileEditTags(next);

  // Remove <fs-actions>...</fs-actions> XML tag blocks (LLM sometimes uses XML instead of code blocks)
  next = next.replace(/<fs-actions>[\s\S]*?<\/fs-actions>/gi, '');

  // Remove raw WRITE/PATCH/APPLY_DIFF heredoc command blocks that leak into visible output
  // Enhanced regex to handle more edge cases: no whitespace, different line breaks, nested markers
  // Using line-start anchors (^) with /m flag to avoid matching inside code blocks
  
  // Pattern 1: Standard format with optional newlines between path and <<<
  next = next.replace(/(?:^|\n)\s*(WRITE|PATCH|APPLY_DIFF)\s+[^\n]+(?:\n\s*){0,3}<<<[\s\S]*?>>>(?=\n|$)/gim, '\n');
  
  // Pattern 2: Handle cases where <<< is on same line as path (WRITE path<<< content >>>)
  // Only match at line start to avoid false positives in code blocks
  next = next.replace(/^\s*(WRITE|PATCH|APPLY_DIFF)\s+[^\n]+<<<[\s\S]*?>>>/gim, '');
  
  // Pattern 3: Remove DELETE commands (line start only)
  next = next.replace(/^\s*DELETE\s+[^\n]+(?=\n|$)/gim, '\n');
  
  // Pattern 4: Remove <apply_diff> XML tags with content
  next = next.replace(/<apply_diff\s+path=["'][^"']+["']\s*>[\s\S]*?<\/apply_diff>/gi, '');
  
  // Pattern 5: Handle any remaining fs-actions style commands (outside of code blocks)
  // Match WRITE/PATCH/APPLY_DIFF at start of line with heredoc markers anywhere
  next = next.replace(/^\s*(WRITE|PATCH|APPLY_DIFF)\s+[^\n]*\n?\s*<<<[\s\S]*?>>>/gim, '');
  
  // Pattern 6: Clean up leftover <<< and >>> markers that weren't properly paired
  next = next.replace(/^\s*<<<\s*$/gm, '');
  next = next.replace(/^\s*>>>\s*$/gm, '');

  // Pattern 7: Remove bare heredoc blocks (<<<...>>>) without command prefix
  // These are malformed LLM outputs that should not appear in the display
  next = next.replace(/(?:^|\n)\s*<<<[\s\S]*?>>>\s*(?=\n|$)/gim, '\n');

  // Normalize leftover spacing
  next = next.replace(/\n{3,}/g, '\n\n').trim();
  
  return next;
}

function buildClientVisibleUnifiedResponse(response: any, visibleContent: string): any {
  return {
    ...response,
    content: visibleContent,
    data: {
      ...(response?.data || {}),
      content: visibleContent,
    },
  };
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

  // Keywords that suggest user wants comprehensive project context
  const contextPackKeywords = [
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
  ];

  const pattern = new RegExp(contextPackKeywords.join('|'), 'i');
  return pattern.test(lastUserMessage);
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

    // Poll for completion
    const maxWaitMs = 120000; // 2 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const statusResponse = await fetch(`${gatewayUrl}/jobs/${jobId}`);
      
      if (!statusResponse.ok) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const jobStatus = await statusResponse.json();

      if (jobStatus.status === 'completed') {
        return {
          success: true,
          data: jobStatus,
          sessionId,
          jobId,
        };
      }

      if (jobStatus.status === 'failed') {
        throw new Error(jobStatus.error || 'Job failed');
      }

      // Still processing, wait a bit
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Job timed out');
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
}): Promise<Response> {
  const { gatewayUrl, userId, conversationId, task, context, requestId } = params;

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
            'Prefer concrete multi-file edits when user requests full project scaffolding.',
            '',
            'To read a file from the workspace, use: <file_read path="..." />',
            '',
            'When the user asks how to run code, include shell commands in ```bash blocks.',
            'The user has a terminal that can execute these commands.',
            'For multi-step setups, provide all commands in a single bash block so they can be run together.',
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

  // Strong signals — unambiguous coding/agentic keywords (single match sufficient)
  // These are for V2/OpenCode execution, NOT for 3rd party OAuth
  // "code a nextjs app" should route to V2 for interactive coding session
  const strongPattern = /\b(refactor|bug\s*fix|stack\s*trace|typescript|javascript|python|react|next\.js|vue\.js|angular|node\.?js|endpoint|database|schema|compile|lint|migrations?|docker|kubernetes|k8s|redis|mongodb|postgresql|mysql|sqlite|express|fastapi|flask|django|spring|rails|laravel|symfony|golang|rust|java|c\+\+|cpp|c#|dotnet|swift|kotlin|flutter|react\s*native|electron|code|build|implement|create\s+app|create\s+project|scaffold|generate\s+app)\b/i;
  if (strongPattern.test(content)) return true;

  // Weak signals — require 2+ signals to trigger (lower threshold, not higher)
  // We WANT coding requests to use V2 (OpenCode) for interactive sessioning
  const weakKeywords = ['app', 'project', 'component', 'file', 'api', 'function', 'class', 'module', 'package', 'implement', 'build', 'develop'];
  const weakMatches = weakKeywords.filter(kw => new RegExp(`\\b${kw}\\b`, 'i').test(content));
  if (weakMatches.length >= 2) return true;

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

  // EXPLICIT 3RD PARTY INTEGRATION SIGNALS - these require OAuth to external services
  // Must have specific service names that are known 3rd party integrations
  // Use possessive/contextual patterns to avoid false positives like "github clone"
  const thirdPartyServicePattern = /\b(my\s+)?gmail|(my\s+)?google\s+(drive|sheets|docs|calendar)|slack|discord|twitter|x\s*api|notion|zoom|hubspot|salesforce|shopify|stripe|pipedrive|airtable|jira|confluence|trello|dropbox|onedrive|box\s*file|aws\s*s3|s3\s*bucket|heroku|vercel|netlify|railway|render\s*static|cloudflare\s*pages|figma|miro|miroboard|(my|our)\s+github\s+(repo|branch|pr|issue|organization|team)/i;
  return thirdPartyServicePattern.test(content);
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

// Use shared extractors from file-edit-parser.ts
function extractTaggedFileEdits(content: string): Array<{ path: string; content: string }> {
  return extractFileEdits(content).map(edit => ({ path: edit.path, content: edit.content }));
}

function extractFencedDiffEdits(content: string): Array<{ path: string; diff: string }> {
  return extractFencedDiffEditsShared(content);
}

function extractFsActionWrites(content: string): Array<{ path: string; content: string }> {
  const writes: Array<{ path: string; content: string }> = [];

  // Extract from ```fs-actions ... ``` code blocks
  const blockRegex = /```fs-actions\s*([\s\S]*?)```/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const blockContent = blockMatch[1] || '';
    // FIX: Support "WRITE<path>", "WRITE <path>", "WRITE path", etc.
    // Make whitespace optional between WRITE and path
    const writeRegex = /WRITE\s*([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>/gi;
    let writeMatch: RegExpExecArray | null;
    while ((writeMatch = writeRegex.exec(blockContent)) !== null) {
      const path = writeMatch[1]?.trim();
      const fileContent = writeMatch[2] ?? '';
      if (!path) continue;
      writes.push({ path, content: fileContent });
    }
  }

  // Also extract from <fs-actions>...</fs-actions> XML tags (LLM sometimes uses XML instead of code blocks)
  const xmlBlockRegex = /<fs-actions>([\s\S]*?)<\/fs-actions>/gi;
  let xmlBlockMatch: RegExpExecArray | null;

  while ((xmlBlockMatch = xmlBlockRegex.exec(content)) !== null) {
    const blockContent = xmlBlockMatch[1] || '';
    // FIX: Support "WRITE<path>", "WRITE <path>", "WRITE path", etc.
    const writeRegex = /WRITE\s*([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>/gi;
    let writeMatch: RegExpExecArray | null;
    while ((writeMatch = writeRegex.exec(blockContent)) !== null) {
      const path = writeMatch[1]?.trim();
      const fileContent = writeMatch[2] ?? '';
      if (!path) continue;
      writes.push({ path, content: fileContent });
    }
  }

  // Also extract WRITE commands from regular code blocks (```language ... ```)
  // This handles cases where LLM writes code without fs-actions wrapper
  const regularBlockRegex = /```[a-zA-Z]*\s*([\s\S]*?)```/gi;
  let regularBlockMatch: RegExpExecArray | null;

  while ((regularBlockMatch = regularBlockRegex.exec(content)) !== null) {
    const blockContent = regularBlockMatch[1] || '';
    // Only match if it looks like a WRITE command (not actual code that happens to contain WRITE)
    // Support "WRITE<path>", "WRITE <path>", etc.
    const writeRegex = /^WRITE\s*([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>$/gim;
    let writeMatch: RegExpExecArray | null;
    while ((writeMatch = writeRegex.exec(blockContent)) !== null) {
      const path = writeMatch[1]?.trim();
      const fileContent = writeMatch[2] ?? '';
      if (!path) continue;
      writes.push({ path, content: fileContent });
    }
  }

  return writes;
}

function extractTopLevelWrites(content: string): Array<{ path: string; content: string }> {
  const writes: Array<{ path: string; content: string }> = [];

  const topLevelWriteRegex = /^WRITE\s+([^\s<]+)(?:\n\s*){0,2}<<<\s*\n([\s\S]*?)\s*>>>/gim;
  let match: RegExpExecArray | null;
  while ((match = topLevelWriteRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    const fileContent = match[2] ?? '';
    if (!path) continue;
    writes.push({ path, content: fileContent });
  }

  const altWriteRegex = /^WRITE\s+([^\s<]+)\s*<<<\s*([\s\S]*?)>>>/gim;
  while ((match = altWriteRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    const fileContent = match[2] ?? '';
    if (!path) continue;
    if (!writes.some(w => w.path === path && w.content === fileContent)) {
      writes.push({ path, content: fileContent });
    }
  }

  return writes;
}

function extractTopLevelDeletes(content: string): string[] {
  const deletes: string[] = [];

  const deleteRegex = /^DELETE\s+([^\n]+)/gim;
  let match: RegExpExecArray | null;
  while ((match = deleteRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    if (path) deletes.push(path);
  }

  return deletes;
}

function extractTopLevelPatches(content: string): Array<{ path: string; diff: string }> {
  const patches: Array<{ path: string; diff: string }> = [];

  const patchRegex = /^PATCH\s+([^\s<]+)(?:\n\s*){0,2}<<<\s*\n([\s\S]*?)\s*>>>/gim;
  let match: RegExpExecArray | null;
  while ((match = patchRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    const diff = match[2] ?? '';
    if (!path) continue;
    patches.push({ path, diff });
  }

  return patches;
}

function extractFsActionDeletes(content: string): string[] {
  const deletes: string[] = [];

  // Extract from ```fs-actions ... ``` code blocks
  const blockRegex = /```fs-actions\s*([\s\S]*?)```/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const blockContent = blockMatch[1] || '';
    const deleteRegex = /DELETE\s+([^\n]+)/gi;
    let deleteMatch: RegExpExecArray | null;
    while ((deleteMatch = deleteRegex.exec(blockContent)) !== null) {
      const path = deleteMatch[1]?.trim();
      if (path) deletes.push(path);
    }
  }

  // Also extract from <fs-actions>...</fs-actions> XML tags
  const xmlBlockRegex = /<fs-actions>([\s\S]*?)<\/fs-actions>/gi;
  let xmlBlockMatch: RegExpExecArray | null;

  while ((xmlBlockMatch = xmlBlockRegex.exec(content)) !== null) {
    const blockContent = xmlBlockMatch[1] || '';
    const deleteRegex = /DELETE\s+([^\n]+)/gi;
    let deleteMatch: RegExpExecArray | null;
    while ((deleteMatch = deleteRegex.exec(blockContent)) !== null) {
      const path = deleteMatch[1]?.trim();
      if (path) deletes.push(path);
    }
  }

  return deletes;
}

function extractFsActionPatches(content: string): Array<{ path: string; diff: string }> {
  const patches: Array<{ path: string; diff: string }> = [];

  // Extract from ```fs-actions ... ``` code blocks
  const blockRegex = /```fs-actions\s*([\s\S]*?)```/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const blockContent = blockMatch[1] || '';
    // FIX: Support both "PATCH path <<<" and "PATCH path\n<<<" formats
    const patchRegex = /PATCH\s+([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>/gi;
    let patchMatch: RegExpExecArray | null;
    while ((patchMatch = patchRegex.exec(blockContent)) !== null) {
      const path = patchMatch[1]?.trim();
      const diff = patchMatch[2] ?? '';
      if (!path) continue;
      patches.push({ path, diff });
    }
  }

  // Also extract from <fs-actions>...</fs-actions> XML tags
  const xmlBlockRegex = /<fs-actions>([\s\S]*?)<\/fs-actions>/gi;
  let xmlBlockMatch: RegExpExecArray | null;

  while ((xmlBlockMatch = xmlBlockRegex.exec(content)) !== null) {
    const blockContent = xmlBlockMatch[1] || '';
    // FIX: Support both "PATCH path <<<" and "PATCH path\n<<<" formats
    const patchRegex = /PATCH\s+([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>/gi;
    let patchMatch: RegExpExecArray | null;
    while ((patchMatch = patchRegex.exec(blockContent)) !== null) {
      const path = patchMatch[1]?.trim();
      const diff = patchMatch[2] ?? '';
      if (!path) continue;
      patches.push({ path, diff });
    }
  }

  return patches;
}

function extractApplyDiffOperations(content: string): Array<{ path: string; search: string; replace: string; thought?: string }> {
  const diffs: Array<{ path: string; search: string; replace: string; thought?: string }> = [];

  // Extract from ```fs-actions ... ``` blocks: APPLY_DIFF path <<< search === replace >>>
  const blockRegex = /```fs-actions\s*([\s\S]*?)```/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const blockContent = blockMatch[1] || '';
    const diffRegex = /APPLY_DIFF\s+([^\s<]+)\s*<<<\s*([\s\S]*?)\s*===\s*([\s\S]*?)\s*>>>/gi;
    let diffMatch: RegExpExecArray | null;
    while ((diffMatch = diffRegex.exec(blockContent)) !== null) {
      const path = diffMatch[1]?.trim();
      const search = diffMatch[2] ?? '';
      const replace = diffMatch[3] ?? '';
      if (!path || !search) continue;
      diffs.push({ path, search, replace });
    }
  }

  // Extract from <fs-actions>...</fs-actions> XML tags
  const xmlBlockRegex = /<fs-actions>([\s\S]*?)<\/fs-actions>/gi;
  let xmlBlockMatch: RegExpExecArray | null;

  while ((xmlBlockMatch = xmlBlockRegex.exec(content)) !== null) {
    const blockContent = xmlBlockMatch[1] || '';
    const diffRegex = /APPLY_DIFF\s+([^\s<]+)\s*<<<\s*([\s\S]*?)\s*===\s*([\s\S]*?)\s*>>>/gi;
    let diffMatch: RegExpExecArray | null;
    while ((diffMatch = diffRegex.exec(blockContent)) !== null) {
      const path = diffMatch[1]?.trim();
      const search = diffMatch[2] ?? '';
      const replace = diffMatch[3] ?? '';
      if (!path || !search) continue;
      diffs.push({ path, search, replace });
    }
  }

  // Extract from <apply_diff> XML tags: <apply_diff path="..."><search>...</search><replace>...</replace></apply_diff>
  const xmlDiffRegex = /<apply_diff\s+path=["']([^"']+)["']\s*>\s*<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>\s*(?:<thought>([\s\S]*?)<\/thought>\s*)?<\/apply_diff>/gi;
  let xmlDiffMatch: RegExpExecArray | null;

  while ((xmlDiffMatch = xmlDiffRegex.exec(content)) !== null) {
    const path = xmlDiffMatch[1]?.trim();
    const search = xmlDiffMatch[2] ?? '';
    const replace = xmlDiffMatch[3] ?? '';
    const thought = xmlDiffMatch[4]?.trim();
    if (!path || !search) continue;
    diffs.push({ path, search, replace, thought });
  }

  // Extract top-level APPLY_DIFF commands (outside containers)
  // Matches: APPLY_DIFF path\n<<<\nsearch\n===\nreplace\n>>>
  // Note: Uses literal === and >>> on their own lines to delimit the search/replace sections,
  // not when they appear inside the content.
  const topLevelDiffRegex = /^\s*APPLY_DIFF\s+([^\s<]+)\s*(?:\n\s*)?<<<\s*\n([\s\S]*?)\n===\s*\n([\s\S]*?)\n>>>/gim;
  let topLevelMatch: RegExpExecArray | null;
  while ((topLevelMatch = topLevelDiffRegex.exec(content)) !== null) {
    const path = topLevelMatch[1]?.trim();
    const search = topLevelMatch[2] ?? '';
    const replace = topLevelMatch[3] ?? '';
    if (!path || !search) continue;
    // Deduplicate against already-found diffs
    if (!diffs.some(d => d.path === path && d.search === search && d.replace === replace)) {
      diffs.push({ path, search, replace });
    }
  }

  return diffs;
}

function extractBashHereDocWrites(content: string): Array<{ path: string; content: string }> {
  const writes: Array<{ path: string; content: string }> = [];
  const bashBlockRegex = /```bash\s*([\s\S]*?)```/gi;
  let bashMatch: RegExpExecArray | null;

  while ((bashMatch = bashBlockRegex.exec(content)) !== null) {
    const block = bashMatch[1] || '';
    const hereDocRegex = /cat\s*>\s*([^\s]+)\s*<<['"]?EOF['"]?\n([\s\S]*?)\nEOF/g;
    let hereDocMatch: RegExpExecArray | null;
    while ((hereDocMatch = hereDocRegex.exec(block)) !== null) {
      const path = hereDocMatch[1]?.trim();
      const fileContent = hereDocMatch[2] ?? '';
      if (!path) continue;
      writes.push({ path, content: fileContent });
    }
  }

  return writes;
}

function extractFilenameHintCodeBlocks(content: string): Array<{ path: string; content: string }> {
  const writes: Array<{ path: string; content: string }> = [];
  const regex = /```[^\n`]*\b(?:file|path|filename)\s*[:=]\s*([^\n]+)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const path = match[1]?.trim();
    let fileContent = match[2] ?? '';
    if (!path) continue;
    // Strip heredoc markers that may wrap the content (WRITE path <<< content >>>)
    fileContent = stripHeredocMarkers(fileContent);
    writes.push({ path, content: fileContent });
  }

  return writes;
}

/**
 * Validate an extracted file path to prevent garbage paths from being written.
 * Rejects paths containing heredoc markers, control chars, or command names.
 */
function validateExtractedPath(raw: string): string | null {
  const path = (raw || '').trim().replace(/^['"`]|['"`]$/g, '');
  if (!path) return null;
  if (path.length > 300) return null;
  if (/[\r\n\t\0]/.test(path)) return null;
  if (/(<<<|>>>|===)/.test(path)) return null;
  if (/[<>"'`]/.test(path)) return null;
  // Reject paths starting with problematic chars but allow dots (for dotfiles) and relative paths
  // Allow: .gitignore, ./src/file.ts, ../parent/file.ts
  // Reject: @#$file, <<<path, etc.
  if (/^[^\w./]/.test(path) || /^\.{3,}/.test(path) || /(?:^|\/)\.\.(?:\/|$)/.test(path)) return null;
  if (/\b(?:WRITE|PATCH|APPLY_DIFF|DELETE)\b/i.test(path)) return null;
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
    const path = folderCreateMatch[1]?.trim()
    if (!path) continue
    folders.push(path)
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

function applyUnifiedDiff(currentContent: string, targetPath: string, rawDiff: string): string {
  const diffBody = rawDiff.endsWith('\n') ? rawDiff : `${rawDiff}\n`;
  const unifiedDiff = `--- ${targetPath}\n+++ ${targetPath}\n${diffBody}`;
  const parsedPatches = parsePatch(unifiedDiff);

  if (parsedPatches.length === 0) {
    throw new Error(`Invalid unified diff for ${targetPath}`);
  }

  const patched = applyPatch(currentContent, parsedPatches[0]);
  if (patched === false) {
    throw new Error(`Patch could not be applied for ${targetPath}`);
  }

  return patched;
}

function buildSupplementalAgenticEvents(response: any, requestId: string, existingEvents: string[] = []): string[] {
  const events: string[] = [];
  const hasReasoningEvent = existingEvents.some((event) => String(event).startsWith('event: reasoning'));
  const hasToolInvocationEvent = existingEvents.some((event) => String(event).startsWith('event: tool_invocation'));

  const reasoning = response?.data?.reasoning || response?.metadata?.reasoning;
  const toolInvocations = Array.isArray(response?.data?.toolInvocations)
    ? response.data.toolInvocations
    : [];

  if (!hasReasoningEvent && typeof reasoning === 'string' && reasoning.trim()) {
    events.push(`event: reasoning\ndata: ${JSON.stringify({
      requestId,
      reasoning: reasoning.trim(),
      timestamp: Date.now(),
    })}\n\n`);
  }

  if (!hasToolInvocationEvent && toolInvocations.length > 0) {
    const startedAt = new Map<string, number>();
    for (const invocation of toolInvocations) {
      const now = Date.now();
      const toolCallId = invocation?.toolCallId || `tool-${generateSecureId('call')}`;
      if (invocation?.state === 'call') {
        startedAt.set(toolCallId, now);
      }
      const latencyMs =
        invocation?.state === 'result'
          ? now - (startedAt.get(toolCallId) || now)
          : undefined;

      const payload = {
        ...invocation,
        toolCallId,
        requestId,
        timestamp: now,
        ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      };

      events.push(`event: tool_invocation\ndata: ${JSON.stringify(payload)}\n\n`);
      events.push(`event: step_metric\ndata: ${JSON.stringify({
        requestId,
        toolCallId,
        toolName: invocation?.toolName,
        state: invocation?.state,
        timestamp: now,
        ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      })}\n\n`);
    }
  }

  const sandboxChunks = extractSandboxOutputChunks(toolInvocations);
  for (const chunk of sandboxChunks) {
    events.push(`event: sandbox_output\ndata: ${JSON.stringify({
      requestId,
      ...chunk,
      timestamp: Date.now(),
    })}\n\n`);
  }

  return events;
}

function extractSandboxOutputChunks(
  invocations: Array<{ result?: any; args?: any }>,
): Array<{ stream: 'stdout' | 'stderr'; chunk: string; toolCallId?: string }> {
  const chunks: Array<{ stream: 'stdout' | 'stderr'; chunk: string; toolCallId?: string }> = [];

  for (const invocation of invocations) {
    const result = invocation?.result || {};
    const output = result?.output;
    const error = result?.error;

    if (typeof output === 'string' && output.trim()) {
      for (const part of chunkText(output, 800)) {
        chunks.push({ stream: 'stdout', chunk: part, toolCallId: (invocation as any)?.toolCallId });
      }
    } else if (output && typeof output === 'object') {
      if (typeof output.stdout === 'string' && output.stdout.trim()) {
        for (const part of chunkText(output.stdout, 800)) {
          chunks.push({ stream: 'stdout', chunk: part, toolCallId: (invocation as any)?.toolCallId });
        }
      }
      if (typeof output.stderr === 'string' && output.stderr.trim()) {
        for (const part of chunkText(output.stderr, 800)) {
          chunks.push({ stream: 'stderr', chunk: part, toolCallId: (invocation as any)?.toolCallId });
        }
      }
    }

    if (typeof error === 'string' && error.trim()) {
      for (const part of chunkText(error, 800)) {
        chunks.push({ stream: 'stderr', chunk: part, toolCallId: (invocation as any)?.toolCallId });
      }
    } else if (error && typeof error === 'object' && typeof error.stderr === 'string' && error.stderr.trim()) {
      for (const part of chunkText(error.stderr, 800)) {
        chunks.push({ stream: 'stderr', chunk: part, toolCallId: (invocation as any)?.toolCallId });
      }
    }
  }

  return chunks;
}

function chunkText(input: string, size: number): string[] {
  const chunks: string[] = [];
  const normalized = String(input || '');
  for (let i = 0; i < normalized.length; i += size) {
    chunks.push(normalized.slice(i, i + size));
  }
  return chunks;
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
}): Promise<FilesystemEditResult> {
  // Extract all operations first to check if there's anything to do
  const fileWriteFolderCreateOps = extractFileWriteFolderCreateTags(input.responseContent || '');
  const combinedWriteEdits = [
    ...extractTaggedFileEdits(input.responseContent || ''),
    ...extractFsActionWrites(input.responseContent || ''),
    ...extractTopLevelWrites(input.responseContent || ''),
    ...extractBashHereDocWrites(input.responseContent || ''),
    ...extractFilenameHintCodeBlocks(input.responseContent || ''),
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
    ...extractFencedDiffEdits(input.responseContent || ''),
    ...extractFsActionPatches(input.responseContent || ''),
    ...extractTopLevelPatches(input.responseContent || ''),
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
  const applyDiffOperations = extractApplyDiffOperations(input.responseContent || '').filter(op => {
    const validPath = validateExtractedPath(op.path);
    if (!validPath) {
      console.warn('[applyFilesystemEdits] Rejected invalid apply_diff path:', op.path.substring(0, 80));
      return false;
    }
    op.path = validPath;
    return true;
  });
  const deleteTargets = [
    ...extractFsActionDeletes(input.responseContent || ''),
    ...extractTopLevelDeletes(input.responseContent || ''),
  ].map((p) => {
    const validPath = validateExtractedPath(p);
    if (!validPath) {
      console.warn('[applyFilesystemEdits] Rejected invalid delete path:', p.substring(0, 80));
      return null;
    }
    return validPath;
  }).filter((p): p is string => !!p);
  const folderCreateTargets = fileWriteFolderCreateOps.folders; // Separate folder creation targets
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

        const patchedContent = applyUnifiedDiff(currentContent, targetPath, diffOperation.diff);
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

        const updatedContent = currentContent.replace(diffOp.search, diffOp.replace);
        const file = await virtualFilesystem.writeFile(input.ownerId, targetPath, updatedContent);

        result.applied.push({
          path: file.path,
          operation: 'patch',
          version: file.version,
          previousVersion,
          existedBefore,
          content: updatedContent,
          diff: null,
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

export async function GET() {
  try {
    // Get list of configured provider IDs (checks if API keys are set)
    const configuredProviderIds = llmService.getAvailableProviders().map(p => p.id);

    // Return all providers with availability status (based on API key configuration)
    const allProviders = Object.values(PROVIDERS).map((provider: any) => ({
      ...provider,
      isAvailable: configuredProviderIds.includes(provider.id)
    }));

    return NextResponse.json({
      success: true,
      data: {
        providers: allProviders,
        defaultProvider: process.env.DEFAULT_LLM_PROVIDER || "mistral",
        defaultModel:
          process.env.DEFAULT_MODEL || "mistral-large-latest",
        defaultTemperature: parseFloat(
          process.env.DEFAULT_TEMPERATURE || "0.7",
        ),
        defaultMaxTokens: Number.parseInt(process.env.DEFAULT_MAX_TOKENS || "100000"),
        features: {
          voiceEnabled: process.env.ENABLE_VOICE_FEATURES === "true",
          imageGeneration: process.env.ENABLE_IMAGE_GENERATION === "true",
          chatHistory: process.env.ENABLE_CHAT_HISTORY === "true",
          codeExecution: process.env.ENABLE_CODE_EXECUTION === "true",
        },
      },
    });
  } catch (error) {
    console.error("Error fetching providers:", error);
    return NextResponse.json(
      { error: "Failed to fetch available providers" },
      { status: 500 }
    );
  }
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
