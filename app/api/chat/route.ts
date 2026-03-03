import { NextRequest, NextResponse } from "next/server";
import { llmService, PROVIDERS } from "@/lib/api/llm-providers";
import { errorHandler } from "@/lib/api/error-handler";
import { priorityRequestRouter } from "@/lib/api/priority-request-router";
import { unifiedResponseHandler } from "@/lib/api/unified-response-handler";
import { resolveRequestAuth } from "@/lib/auth/request-auth";
import { detectRequestType } from "@/lib/utils/request-type-detector";
import { generateSecureId } from '@/lib/utils';
import { chatRequestLogger } from '@/lib/api/chat-request-logger';
import { parsePatch, applyPatch } from 'diff';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { filesystemEditSessionService } from '@/lib/virtual-filesystem/filesystem-edit-session-service';
import type { LLMMessage } from "@/lib/api/llm-providers";
import { checkRateLimit } from '@/lib/middleware/rate-limiter';

// Note: Fast-Agent now has dedicated endpoint at /api/agent
// This route uses priority router which includes Fast-Agent as Priority 1

// Rate limiting for chat API: 60 messages per minute per user
const CHAT_RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const CHAT_RATE_LIMIT_MAX = 60;

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();
  const requestId = generateSecureId('chat');

  console.log('[DEBUG] Chat API: Incoming request', { requestId });

  // Extract user authentication (JWT or session cookie).
  // Anonymous chat is allowed, but tools/sandbox require authenticated userId.
  const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
  const userId = authResult.userId || 'anonymous';

  if (!authResult.success || !authResult.userId) {
    console.log('[DEBUG] Chat API: Anonymous request (no auth token/session)');
  }

  // RATE LIMITING: Check rate limit before processing
  // Use user ID for authenticated users, IP for anonymous
  const rateLimitIdentifier = authResult.userId && authResult.userId !== 'anonymous'
    ? `user:${authResult.userId}`
    : `ip:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'}`;
  
  const rateLimitResult = checkRateLimit(
    rateLimitIdentifier,
    { windowMs: CHAT_RATE_LIMIT_WINDOW_MS, maxRequests: CHAT_RATE_LIMIT_MAX, message: 'Too many chat messages' },
    { name: 'free', multiplier: 1, description: 'Free tier' }
  );

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `Rate limit exceeded. Maximum ${CHAT_RATE_LIMIT_MAX} messages per minute.`,
        retryAfter: rateLimitResult.retryAfter,
        remaining: rateLimitResult.remaining,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimitResult.retryAfter || 60),
          'X-RateLimit-Limit': String(CHAT_RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000 + rateLimitResult.resetAfter / 1000)),
        },
      }
    );
  }

  let provider = '';
  let model = '';

  try {
    const body = await request.json();
    console.log('[DEBUG] Chat API: Request body parsed:', {
      hasMessages: !!body.messages,
      messageCount: body.messages?.length,
      provider: body.provider,
      model: body.model,
      stream: body.stream,
      bodyKeys: Object.keys(body),
      userId: authResult.userId
    });

    const {
      messages,
      provider: requestedProvider,
      model: requestedModel,
      temperature = 0.7,
      maxTokens = 10096,
      stream = true,
      apiKeys = {},
      requestId: incomingRequestId,
      conversationId,
      filesystemContext,
    } = body as {
      messages: LLMMessage[];
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      apiKeys?: Record<string, string>;
      requestId?: string;
      conversationId?: string;
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

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error('[DEBUG] Chat API: Validation failed - missing or empty messages');
      return NextResponse.json(
        { error: "Messages array is required and cannot be empty" },
        { status: 400 },
      );
    }

    if (!provider || !model) {
      console.error('[DEBUG] Chat API: Validation failed - missing provider or model', { provider, model });
      return NextResponse.json(
        { error: "Provider and model are required" },
        { status: 400 },
      );
    }

    // Check if provider is valid (exists in our PROVIDERS constant)
    const isValidProvider = provider in PROVIDERS;
    
    if (!isValidProvider) {
      console.error('[DEBUG] Chat API: Invalid provider:', provider);
      return NextResponse.json(
        {
          error: `Provider ${provider} is not supported.`,
          availableProviders: Object.keys(PROVIDERS),
        },
        { status: 400 },
      );
    }

    // Get provider info from PROVIDERS constant
    const selectedProvider = PROVIDERS[provider as keyof typeof PROVIDERS];
    console.log('[DEBUG] Chat API: Selected provider:', provider, 'supports streaming:', selectedProvider.supportsStreaming);

    // Check if model is supported by the provider (allow partial matches for models like "z-ai/glm-4.5-air" vs "z-ai/glm-4.5-air:free")
    const isModelSupported = selectedProvider.models.some(
      m => m === model || m.startsWith(model + ':') || m.endsWith(':' + model.split(':')[0])
    );
    
    if (!isModelSupported) {
      console.error('[DEBUG] Chat API: Model not supported:', model, 'Available:', selectedProvider.models);
      return NextResponse.json(
        {
          error: `Model ${model} is not supported by ${provider}`,
          availableModels: selectedProvider.models,
        },
        { status: 400 },
      );
    }

    // Normalize model name to match PROVIDERS constant (e.g., "z-ai/glm-4.5-air" -> "z-ai/glm-4.5-air:free")
    const normalizedModel = selectedProvider.models.find(
      m => m === model || m.startsWith(model + ':') || m.endsWith(':' + model.split(':')[0])
    ) || model;
    const attachedFilesystemFiles = normalizeFilesystemContext(filesystemContext?.attachedFiles);
    const anonymousSessionSeed =
      request.headers.get('x-anonymous-session-id')?.trim() || requestId;
    const actorId =
      authResult.success && authResult.userId
        ? authResult.userId
        : `anon:${sanitizePathSegment(anonymousSessionSeed)}`;
    const resolvedConversationId =
      typeof conversationId === 'string' && conversationId.trim()
        ? conversationId.trim()
        : `session_${sanitizePathSegment(actorId)}_${requestId}`;
    const defaultScopePath = `project/sessions/${sanitizePathSegment(resolvedConversationId)}`;
    const requestedScopePath =
      typeof filesystemContext?.scopePath === 'string' && filesystemContext.scopePath.trim()
        ? filesystemContext.scopePath.trim()
        : defaultScopePath;
    const filesystemOwnerId = authResult.success && authResult.userId ? authResult.userId : actorId;
      typeof filesystemContext?.scopePath === 'string' && filesystemContext.scopePath.trim()
        ? filesystemContext.scopePath.trim()
        : defaultScopePath;
    const filesystemOwnerId = actorId;
    const denialContext = filesystemEditSessionService.getRecentDenials(
      `${filesystemOwnerId}:${resolvedConversationId}`,
      4,
    );
    const enableFilesystemEdits = shouldHandleFilesystemEdits(
      messages,
      attachedFilesystemFiles,
      filesystemContext,
    );
    const workspaceSessionContext = enableFilesystemEdits
      ? await buildWorkspaceSessionContext(filesystemOwnerId, requestedScopePath)
      : '';
    const contextualMessages = appendFilesystemContextMessages(
      messages,
      attachedFilesystemFiles,
      enableFilesystemEdits,
      denialContext,
      workspaceSessionContext,
    );

    console.log('[DEBUG] Chat API: Validation passed, routing through priority chain');

    // NEW: Add tool/sandbox detection
    const requestType = detectRequestType(messages);
    const authenticatedUserId =
      authResult.success && authResult.source !== 'anonymous' ? authResult.userId : undefined;

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

    console.log('[DEBUG] Chat API: Routing request through priority chain');

    // Route through priority chain (Fast-Agent → n8n → Custom Fallback → Original System)
    try {
      const routerResponse = await priorityRequestRouter.route(routerRequest);

      const actualProvider = routerResponse.metadata?.actualProvider || routerResponse.source;
      const actualModel = routerResponse.metadata?.actualModel || routerRequest.model;
      
      console.log(`[DEBUG] Chat API: Request handled by ${routerResponse.source} (priority ${routerResponse.priority}) - Actual: ${actualProvider}/${actualModel}`);
      
// Check for auth_required in response
if (routerResponse.data?.requiresAuth && routerResponse.data?.authUrl) {
        return NextResponse.json({
          status: 'auth_required',
          authUrl: routerResponse.data.authUrl,
          toolName: routerResponse.data.toolName,
          provider: routerResponse.data.provider || 'unknown',
          message: `Please authorize ${routerResponse.data.toolName} to continue`
        }, { status: 401 });
      }
      
      // Process response through unified handler
      const unifiedResponse = unifiedResponseHandler.processResponse(routerResponse, requestId);
      const rawResponseContent = unifiedResponse.content || '';
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

      // Handle streaming response
      if (stream && selectedProvider.supportsStreaming) {
        const streamRequestId = requestId || generateSecureId('stream');
        
        // Create streaming events from unified response
        const events = unifiedResponseHandler.createStreamingEvents(clientResponse, streamRequestId);
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
          })}\n\n`;
          events.splice(Math.max(0, events.length - 1), 0, filesystemEvent);
        }

        const encoder = new TextEncoder();
        let encoderRef = encoder;  // Reference for cleanup
        const readableStream = new ReadableStream({
          async start(controller) {
            // Cleanup function for resource management
            const cleanup = () => {
              // TextEncoder instances do not require explicit cleanup/nullification
              // for resource management, so removing this avoids potential race
              // conditions with other uses of encoderRef.
            };

            // Handle client disconnect
            if (request.signal) {
              request.signal.addEventListener('abort', () => {
                cleanup();
                console.log(`[DEBUG] Chat API: Stream cancelled by client: ${streamRequestId}`);
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

                // Add small delays between events for smooth streaming
                if (i < events.length - 1) {
                  await new Promise(resolve => setTimeout(resolve, 50));
                }
              }

              controller.close();
            } catch (error) {
              console.error('[DEBUG] Chat API: Streaming error:', error);
              
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
            console.log(`[DEBUG] Chat API: Stream cancelled by client: ${streamRequestId}`);
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
      // Log which providers were tried from the fallback chain
      const errorMessage = routerErrorObj.message;
      const isNotConfigured = errorMessage.includes('not configured');

      if (!isNotConfigured) {
        console.error('[DEBUG] Chat API: Router error:', errorMessage);
      } else {
        console.log(`[DEBUG] Chat API: No providers configured for request (tried: ${provider}/${model})`);
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
    // Skip verbose logging for expected "not configured" errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNotConfiguredError = errorMessage.includes('not configured');

    if (!isNotConfiguredError) {
      console.error("Chat API error:", errorMessage);
      console.error('[CRITICAL] Chat API: All fallback mechanisms failed');
    } else {
      console.log(`[Chat API] Provider not available: ${errorMessage}`);
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
  next = next.replace(/<file_edit\s+path=["'][^"']+["']\s*>[\s\S]*?<\/file_edit>/gi, '');
  
  // Remove <fs-actions>...</fs-actions> XML tag blocks (LLM sometimes uses XML instead of code blocks)
  next = next.replace(/<fs-actions>[\s\S]*?<\/fs-actions>/gi, '');

  // Remove raw WRITE/PATCH heredoc command blocks that leak into visible output
  next = next.replace(/(?:^|\n)\s*(WRITE|PATCH)\s+[^\n]+\n<<<\n[\s\S]*?\n>>>(?=\n|$)/g, '\n');
  next = next.replace(/(?:^|\n)\s*DELETE\s+[^\n]+(?=\n|$)/g, '\n');

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
}

interface FilesystemEditResult {
  transactionId: string | null;
  status: 'auto_applied' | 'accepted' | 'denied' | 'reverted_with_conflicts' | 'none';
  applied: FilesystemEditSummary[];
  errors: string[];
  requestedFiles: Array<{ path: string; content: string; language: string; version: number }>;
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

  return /\b(file|files|code|edit|patch|create|write|update|project|program)\b/i.test(lastUserMessage);
}

async function buildWorkspaceSessionContext(ownerId: string, scopePath?: string): Promise<string> {
  try {
    const snapshot = await virtualFilesystem.exportWorkspace(ownerId);
    const scopedFiles = scopePath
      ? snapshot.files.filter((file) => file.path === scopePath || file.path.startsWith(`${scopePath}/`))
      : snapshot.files;
    if (scopedFiles.length === 0) {
      return 'Workspace is currently empty.';
    }

    const MAX_PATHS = 120;
    const filePaths = scopedFiles
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_PATHS);

    const clipped = scopedFiles.length > MAX_PATHS;
    return [
      `Workspace root: ${snapshot.root}`,
      `Workspace version: ${snapshot.version}`,
      scopePath ? `Active scope: ${scopePath}` : '',
      `Files (${scopedFiles.length} total):`,
      ...filePaths.map((path) => `- ${path}`),
      clipped ? `- ... (${scopedFiles.length - MAX_PATHS} more files)` : '',
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
            'Prefer concrete multi-file edits when user requests full project scaffolding.',
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

function extractTaggedFileEdits(content: string): Array<{ path: string; content: string }> {
  const edits: Array<{ path: string; content: string }> = [];
  const regex = /<file_edit\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file_edit>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const filePath = match[1]?.trim();
    const fileContent = match[2] ?? '';
    if (!filePath) continue;
    edits.push({ path: filePath, content: fileContent });
  }

  return edits;
}

function extractFencedDiffEdits(content: string): Array<{ path: string; diff: string }> {
  const edits: Array<{ path: string; diff: string }> = [];
  const regex = /```diff\s+([^\n]+)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const targetPath = match[1]?.trim();
    const diff = match[2] ?? '';
    if (!targetPath) continue;
    edits.push({ path: targetPath, diff });
  }

  return edits;
}

function extractFsActionWrites(content: string): Array<{ path: string; content: string }> {
  const writes: Array<{ path: string; content: string }> = [];

  // Extract from ```fs-actions ... ``` code blocks
  const blockRegex = /```fs-actions\s*([\s\S]*?)```/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const blockContent = blockMatch[1] || '';
    const writeRegex = /WRITE\s+([^\n]+)\n<<<\n([\s\S]*?)\n>>>/gi;
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
    const writeRegex = /WRITE\s+([^\n]+)\n<<<\n([\s\S]*?)\n>>>/gi;
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
    const patchRegex = /PATCH\s+([^\n]+)\n<<<\n([\s\S]*?)\n>>>/gi;
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
    const patchRegex = /PATCH\s+([^\n]+)\n<<<\n([\s\S]*?)\n>>>/gi;
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
    const fileContent = match[2] ?? '';
    if (!path) continue;
    writes.push({ path, content: fileContent });
  }

  return writes;
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
    return input.scopePath;
  }

  const attachedSet = new Set((input.attachedPaths || []).map((path) => path.replace(/^\/+/, '')));
  if (attachedSet.has(rawPath)) {
    return rawPath;
  }

  const escapedPath = rawPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escapedPath}\\b`, 'i').test(input.lastUserMessage || '')) {
    return rawPath;
  }

  const baseName = rawPath.split('/').pop() || rawPath;
  const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escapedBaseName}\\b`, 'i').test(input.lastUserMessage || '')) {
    return rawPath;
  }

  if (rawPath.startsWith(`${input.scopePath}/`) || rawPath === input.scopePath) {
    return rawPath;
  }

  const normalizedRelative = rawPath.startsWith('project/')
    ? rawPath.slice('project/'.length)
    : rawPath;
  return `${input.scopePath}/${normalizedRelative}`.replace(/\/{2,}/g, '/');
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
  const combinedWriteEdits = [
    ...extractTaggedFileEdits(input.responseContent || ''),
    ...extractFsActionWrites(input.responseContent || ''),
    ...extractBashHereDocWrites(input.responseContent || ''),
    ...extractFilenameHintCodeBlocks(input.responseContent || ''),
  ];
  const combinedDiffOperations = [
    ...extractFencedDiffEdits(input.responseContent || ''),
    ...extractFsActionPatches(input.responseContent || ''),
    ...(input.commands?.write_diffs || []),
  ];
  const deleteTargets = extractFsActionDeletes(input.responseContent || '');
  const requestFiles = input.commands?.request_files || [];

  // Only create transaction if there are mutating operations (write/patch/delete)
  // This prevents memory leaks from accumulating no-op transactions
  const hasMutatingOperations =
    combinedWriteEdits.length > 0 ||
    combinedDiffOperations.length > 0 ||
    deleteTargets.length > 0;

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
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: file.path,
          operation: 'write',
          newVersion: file.version,
          previousVersion,
          previousContent,
          existedBefore,
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
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: file.path,
          operation: 'patch',
          newVersion: file.version,
          previousVersion,
          previousContent,
          existedBefore,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to apply diff for ${targetPath}: ${message}`;
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

    // Update status if no operations succeeded
    if (result.applied.length === 0 && result.errors.length === 0) {
      result.status = 'none';
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
    const allProviders = Object.values(PROVIDERS).map(provider => ({
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
        defaultMaxTokens: Number.parseInt(process.env.DEFAULT_MAX_TOKENS || "80000"),
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
async function handleError(error: any, requestId: string, provider: string, model: string, userId: string) {
  // We don't have direct access to the original request start time here,
  // so we log completion without latency to avoid referencing undefined state.
  await chatRequestLogger.logRequestComplete(
    requestId,
    false,
    undefined,
    undefined,
    undefined,
    error instanceof Error ? error.message : String(error)
  );
  
  // Use the existing errorHandler.processError API instead of a non-existent handleError method.
  return errorHandler.processError(
    error instanceof Error ? error : new Error(String(error)),
    {
      component: 'chat_api',
      provider,
      model,
      userId,
      requestId,
      timestamp: Date.now(),
    }
  );
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
