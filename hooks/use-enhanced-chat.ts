"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import { streamingErrorHandler } from '@/lib/streaming/streaming-error-handler';
import { createNDJSONParser } from '@/lib/utils/ndjson-parser';
import type { Message } from '@/types';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { buildApiHeaders } from '@/lib/utils';
import type { AgentType, AgentStatus } from '@/components/agent-status-display';

export interface UseChatOptions {
  api: string;
  body?: Record<string, any> | (() => Record<string, any>);
  onResponse?: (response: Response) => void | Promise<void>;
  onError?: (error: Error) => void;
  onFinish?: (message: Message) => void;
}

export interface UseChatReturn {
  messages: Message[];
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  error: Error | undefined;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  stop: () => void;
  setInput: (input: string) => void;
  // Agent status for multi-agent display
  agentStatus: {
    type: AgentType;
    status: AgentStatus;
    currentAction?: string;
  };
  // Version tracking
  currentVersion?: number;
  // Agent activity for experimental panel
  agentActivity?: any;
  setAgentActivity?: (activity: any) => void;
}

/**
 * Enhanced useChat hook that properly handles our Server-Sent Events format
 */
export function useEnhancedChat(options: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  
  // Agent status state
  const [agentType, setAgentType] = useState<AgentType>('single');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [currentAction, setCurrentAction] = useState<string | undefined>();
  
  // Version tracking
  const [currentVersion, setCurrentVersion] = useState<number | undefined>();

  // Agent activity for experimental panel
  const [agentActivity, setAgentActivity] = useState<any>({
    status: 'idle',
    currentAction: '',
    toolInvocations: [],
    reasoningChunks: [],
    processingSteps: [],
    gitCommits: [],
    diffs: [],
    fileEdits: [],
    specAmplification: undefined,
    refinementProgress: undefined,
    dagProgress: undefined,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageRef = useRef<Message | null>(null);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setAgentStatus('idle');
    }
  }, []);

  const buildRequestHeaders = useCallback((): HeadersInit => {
    return buildApiHeaders();
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!input.trim() || isLoading) {
      return;
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
    };

    const assistantMessage: Message = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
    };

    // Add user message and prepare assistant message
    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput('');
    setIsLoading(true);
    setError(undefined);

    // Store reference to current assistant message
    currentMessageRef.current = assistantMessage;

    // Create abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const resolvedBody = typeof options.body === 'function'
        ? options.body()
        : (options.body || {});
      const requestBody = {
        messages: [...messagesRef.current, userMessage],
        ...resolvedBody,
      };

      const response = await fetch(options.api, {
        method: 'POST',
        headers: buildRequestHeaders(),
        credentials: 'include',
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      // Call onResponse callback
      if (options.onResponse) {
        await options.onResponse(response);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error');
        let payload: any = null;
        try {
          payload = JSON.parse(errorText);
        } catch {
          payload = null;
        }

        const authRequired =
          response.status === 401 &&
          (payload?.status === 'auth_required' ||
            payload?.error?.type === 'auth_required' ||
            payload?.data?.requiresAuth === true);

        if (authRequired) {
          // Distinguish integration OAuth (has toolName/provider/authUrl) from site login auth
          const integrationTool = payload?.toolName || payload?.data?.toolName;
          const integrationProvider = payload?.provider || payload?.data?.provider;
          const integrationAuthUrl = payload?.authUrl || payload?.data?.authUrl;
          const isIntegrationAuth = !!(integrationTool && integrationProvider && integrationAuthUrl);

          const content =
            payload?.error?.message ||
            payload?.message ||
            `Authentication is required to continue.`;
          const messageMetadata = isIntegrationAuth
            ? {
                requiresAuth: true,
                authUrl: integrationAuthUrl,
                toolName: integrationTool,
                provider: integrationProvider,
              }
            : {
                requiresAuth: false,
                loginRequired: true,
              };

          setMessages(prev => prev.map(msg =>
            msg.id === assistantMessage.id
              ? { ...msg, content, metadata: { ...(msg.metadata || {}), ...messageMetadata } }
              : msg
          ));
          setIsLoading(false);
          if (options.onFinish && currentMessageRef.current) {
            options.onFinish({
              ...currentMessageRef.current,
              content,
              metadata: messageMetadata
            });
          }
          return;
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}${payload?.error?.message ? ` - ${payload.error.message}` : ''}`);
      }

      // Some auth-required responses are returned as JSON, not SSE.
      const contentType = response.headers.get('content-type') || '';
      
      // Check for JSON responses (errors, auth required, etc.)
      // Skip this for SSE streams which may include 'application/json' in content-type
      if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
        const payload = await response.json().catch(() => ({} as any));
        const authRequired =
          payload?.status === 'auth_required' ||
          payload?.data?.requiresAuth === true ||
          payload?.metadata?.messageMetadata?.requiresAuth === true;

        if (authRequired) {
          // Check if this is a real integration auth (has tool/provider/authUrl) or just site login
          const existingMeta = payload?.metadata?.messageMetadata;
          const integrationTool = existingMeta?.toolName || payload?.toolName || payload?.data?.toolName;
          const integrationProvider = existingMeta?.provider || payload?.provider || payload?.data?.provider;
          const integrationAuthUrl = existingMeta?.authUrl || payload?.authUrl || payload?.data?.authUrl;
          const isIntegrationAuth = !!(integrationTool && integrationProvider && integrationAuthUrl);

          const content =
            payload?.message ||
            payload?.data?.content ||
            (isIntegrationAuth
              ? `I need authorization to use ${integrationTool}. Please connect your account to proceed.`
              : 'Authentication is required to continue. Please log in first.');

          const messageMetadata = isIntegrationAuth
            ? (existingMeta || {
                requiresAuth: true,
                authUrl: integrationAuthUrl,
                toolName: integrationTool,
                provider: integrationProvider,
              })
            : {
                requiresAuth: false,
                loginRequired: true,
              };

          setMessages(prev => prev.map(msg =>
            msg.id === assistantMessage.id
              ? { ...msg, content, metadata: { ...(msg.metadata || {}), ...messageMetadata } }
              : msg
          ));
          setIsLoading(false);
          if (options.onFinish && currentMessageRef.current) {
            options.onFinish({
              ...currentMessageRef.current,
              content,
              metadata: messageMetadata
            });
          }
          return;
        }
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      // Handle streaming response
      await handleStreamingResponse(response.body, assistantMessage, abortController);

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled
        return;
      }

      const error = err instanceof Error ? err : new Error('Unknown error');

      // Process error through error handler
      const streamingError = streamingErrorHandler.processError(error);

      // Check if we have accumulated any content before showing error
      // Use messagesRef.current to avoid stale closure bug
      const currentMessage = messagesRef.current.find(msg => msg.id === assistantMessage.id);
      const hasContent = currentMessage && currentMessage.content && currentMessage.content.trim().length > 0;

      // Only show error to user if it should be shown and we don't have content
      if (streamingErrorHandler.shouldShowToUser(streamingError) && !hasContent) {
        const userMessage = streamingErrorHandler.getUserMessage(streamingError);
        setError(new Error(userMessage));
        if (options.onError) {
          options.onError(new Error(userMessage));
        }
      } else {
        // We have accumulated content, so the response is partially usable.
        // Log the original error and still surface it as a non-blocking warning
        // so the user knows the response may be incomplete.
        console.warn('Chat streaming interrupted (partial content preserved):', error);

        if (hasContent && currentMessageRef.current) {
          // Append a subtle indicator that the response was truncated
          const partialContent = (currentMessage?.content || '') + '\n\n⚠️ _Response may be incomplete due to a connection issue._';
          setMessages(prev => prev.map(msg =>
            msg.id === currentMessageRef.current!.id
              ? { ...msg, content: partialContent }
              : msg
          ));
          if (options.onFinish) {
            options.onFinish({
              ...currentMessageRef.current,
              content: partialContent,
            });
          }
        }
      }

      setIsLoading(false);
    }
  }, [buildRequestHeaders, input, isLoading, options]);

  const handleStreamingResponse = async (
    body: ReadableStream<Uint8Array>,
    assistantMessage: Message,
    abortController: AbortController
  ) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let accumulatedContent = '';
    let currentEventType = '';

    // Set up a timeout to ensure we don't get stuck
    const timeoutId = setTimeout(() => {
      if (accumulatedContent.trim()) {
        // If we have some content, finalize it
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: accumulatedContent }
            : msg
        ));
        setIsLoading(false);
        if (options.onFinish && currentMessageRef.current) {
          options.onFinish({
            ...currentMessageRef.current,
            content: accumulatedContent
          });
        }
      }
    }, 30000); // 30 second timeout

    try {
      const parser = createNDJSONParser();
      
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (abortController.signal.aborted) {
          break;
        }

        // Decode chunk and parse complete NDJSON lines
        const chunk = decoder.decode(value, { stream: true });
        
        // Handle SSE format (event: / data: / \n\n)
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.trim() === '') {
            // Empty line indicates end of event
            currentEventType = '';
            continue;
          }

          // Handle event type declarations
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }

          // Handle data lines
          if (line.startsWith('data: ')) {
            const dataString = line.slice(6).trim();
            if (!dataString) continue;

            // Debug: Log raw data in dev mode
            if (process.env.NODE_ENV === 'development') {
              console.log('[SSE] Raw data:', dataString.substring(0, 80), 'event:', currentEventType);
            }

            // SSE data is a single JSON object, not NDJSON
            // Try JSON.parse first, then fallback to NDJSON parser
            let parsedObjects: any[];
            try {
              const parsed = JSON.parse(dataString);
              parsedObjects = [parsed];
            } catch {
              // Fallback to NDJSON parser for edge cases
              try {
                parsedObjects = parser.parse(dataString + '\n');
              } catch (parseError) {
                console.warn('[SSE] Parse error:', parseError);
                continue;
              }
            }

            for (const eventData of parsedObjects) {
              // Debug: Log parsed content
              if (process.env.NODE_ENV === 'development' && eventData.content) {
                console.log('[SSE] Content received:', eventData.content.substring(0, 50));
              }

              // Determine event type from current context or data
              const eventType = currentEventType || eventData.type || 'token';

              switch (eventType) {
                case 'init':
                  // Initialization event - update agent status
                  console.log('Chat stream initialized:', eventData);
                  if (eventData.agent === 'planner') {
                    setAgentType('planner');
                  } else if (eventData.agent === 'executor') {
                    setAgentType('executor');
                  } else if (eventData.agent === 'background') {
                    setAgentType('background');
                  }
                  setAgentStatus('thinking');
                  // Update agent activity
                  setAgentActivity(prev => ({
                    ...prev,
                    status: 'thinking',
                    currentAction: eventData.currentAction || 'Initializing...',
                  }));
                  break;

                case 'token':
                case 'data':
                  if (eventData.content) {
                    accumulatedContent += eventData.content;

                    // Update the assistant message in real-time
                    setMessages(prev => prev.map(msg =>
                      msg.id === assistantMessage.id
                        ? { ...msg, content: accumulatedContent }
                        : msg
                    ));
                  }
                  // Update agent status to executing if we're receiving tokens
                  if (agentStatus === 'thinking') {
                    setAgentStatus('executing');
                  }
                  break;

                case 'primary_done':
                  // Primary response completed, but stream stays open for background refinement
                  // Update metadata but DON'T close the stream or call onFinish yet
                  if (eventData.messageMetadata) {
                    const metadata = eventData.messageMetadata;
                    setMessages(prev => prev.map(msg =>
                      msg.id === assistantMessage.id
                        ? { ...msg, metadata: { ...(msg.metadata || {}), ...metadata } }
                        : msg
                    ));
                  }
                  // Update version if provided
                  if (eventData.version) {
                    setCurrentVersion(eventData.version);
                  }
                  // Mark primary as complete but keep listening for background events
                  setAgentStatus('executing'); // Still executing background tasks
                  break;

                case 'primary_response':
                  // Primary response content from spec enhancement routing
                  // eventData contains: { content, timestamp }
                  // Note: File edits in primary response are handled server-side via applyFilesystemEditsFromResponse
                  // Client just displays the content - filesystem edits come via separate 'filesystem' event
                  if (eventData.content) {
                    accumulatedContent += eventData.content;

                    // Update the assistant message in real-time
                    setMessages(prev => prev.map(msg =>
                      msg.id === assistantMessage.id
                        ? { ...msg, content: accumulatedContent }
                        : msg
                    ));
                  }
                  // Update agent status to executing if we're receiving content
                  if (agentStatus === 'thinking') {
                    setAgentStatus('executing');
                  }
                  break;

                case 'done':
                  if (eventData.messageMetadata) {
                    const metadata = eventData.messageMetadata;
                    setMessages(prev => prev.map(msg =>
                      msg.id === assistantMessage.id
                        ? { ...msg, metadata: { ...(msg.metadata || {}), ...metadata } }
                        : msg
                    ));
                  }
                  // Update version if provided
                  if (eventData.version) {
                    setCurrentVersion(eventData.version);
                  }
                  // Streaming complete (all background tasks finished)
                  clearTimeout(timeoutId);
                  setIsLoading(false);
                  setAgentStatus('completed');
                  if (options.onFinish && currentMessageRef.current) {
                    options.onFinish({
                      ...currentMessageRef.current,
                      content: accumulatedContent,
                      metadata: eventData.messageMetadata
                    });
                  }
                  return;

                case 'error': {
                  // Check if this is a V2 session failure that should trigger fallback to v1
                  if (eventData.fallbackToV1) {
                    console.warn('V2 execution failed, will retry with v1 mode:', eventData);
                    
                    // Clear timeout from failed V2 stream
                    clearTimeout(timeoutId);
                    
                    // Reuse handleStreamingResponse for v1 fallback
                    await handleV1Fallback(assistantMessage, abortController);
                    return;
                  }
                  
                  throw new Error(eventData.message || 'Streaming error');
                  }

                case 'filesystem':
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessage.id
                      ? {
                          ...msg,
                          metadata: {
                            ...(msg.metadata || {}),
                            filesystem: eventData,
                          },
                        }
                      : msg
                  ));
                  emitFilesystemUpdated({
                    scopePath: typeof eventData?.scopePath === 'string' ? eventData.scopePath : undefined,
                    sessionId: typeof eventData?.sessionId === 'string' ? eventData.sessionId : undefined,
                    commitId: typeof eventData?.commitId === 'string' ? eventData.commitId : undefined,
                    workspaceVersion: typeof eventData?.workspaceVersion === 'number' ? eventData.workspaceVersion : undefined,
                    applied: eventData?.applied,
                    errors: eventData?.errors,
                    source: 'chat',
                  });
                  break;

                case 'diffs': {
                  // Handle git-style diffs for client sync
                  // eventData contains: { files: [{ path, diff, changeType }], count, requestId }
                  const diffFiles = eventData.files as Array<{ path: string; diff: string; changeType: string }> || [];
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessage.id
                      ? {
                          ...msg,
                          metadata: {
                            ...(msg.metadata || {}),
                            diffs: diffFiles,
                            diffsCount: eventData.count,
                            diffsRequestId: eventData.requestId,
                          },
                        }
                      : msg
                  ));
                  // Update agent activity
                  setAgentActivity(prev => ({
                    ...prev,
                    diffs: [...prev.diffs, ...diffFiles.map((f: any) => ({
                      path: f.path,
                      diff: f.diff,
                      changeType: f.changeType,
                    }))],
                  }));
                  // Also emit filesystem updated event so VFS listeners get notified
                  emitFilesystemUpdated({
                    scopePath: undefined,
                    sessionId: undefined,
                    applied: diffFiles.map(f => ({ path: f.path, operation: f.changeType === 'delete' ? 'delete' : 'write' })),
                    errors: undefined,
                    source: 'diffs',
                  });
                  // Emit custom event for any listeners interested in diff updates
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('agent-diffs', {
                      detail: {
                        files: diffFiles,
                        count: eventData.count,
                        requestId: eventData.requestId,
                        timestamp: Date.now(),
                      }
                    }));
                  }
                  if (process.env.NODE_ENV === 'development') {
                    console.log('[Chat] Received diffs event:', {
                      count: eventData.count,
                      files: diffFiles.map(f => f.path),
                    });
                  }
                  break;
                }

                case 'reasoning':
                  if (eventData.reasoning) {
                    setMessages(prev => prev.map(msg =>
                      msg.id === assistantMessage.id
                        ? {
                            ...msg,
                            metadata: {
                              ...(msg.metadata || {}),
                              reasoning: eventData.reasoning,
                            },
                          }
                        : msg
                    ));
                    // Update agent activity
                    setAgentActivity(prev => ({
                      ...prev,
                      status: 'thinking',
                      currentAction: 'Thinking...',
                      reasoningChunks: [...prev.reasoningChunks, {
                        id: Date.now().toString(),
                        type: eventData.type || 'reasoning',
                        content: eventData.reasoning,
                        timestamp: Date.now(),
                      }],
                    }));
                  }
                  break;

                case 'file_edit':
                  // Progressive file edit detected during streaming
                  // eventData contains: { path, status, operation, timestamp }
                  if (eventData.path) {
                    // Update agent activity with progressive file edit
                    setAgentActivity(prev => ({
                      ...prev,
                      status: 'executing',
                      currentAction: `Editing ${eventData.path}...`,
                      fileEdits: [...(prev.fileEdits || []), {
                        path: eventData.path,
                        status: eventData.status || 'detected',
                        operation: eventData.operation,
                        timestamp: eventData.timestamp || Date.now(),
                      }],
                    }));

                    if (process.env.NODE_ENV === 'development') {
                      console.log('[Chat] Progressive file edit detected:', eventData.path);
                    }
                  }
                  break;

                case 'spec_amplification':
                  // Spec amplification lifecycle event
                  // eventData contains: { stage, fastModel, specScore, sectionsGenerated, currentIteration, totalIterations, currentSection, error, timestamp, filesystem, content, taskId, taskTitle }
                  setAgentActivity(prev => ({
                    ...prev,
                    status: eventData.stage === 'complete' || eventData.stage === 'error' || eventData.stage === 'task_complete' ? 'idle' : 'processing',
                    currentAction: eventData.stage === 'started'
                      ? 'Generating improvement spec...'
                      : eventData.stage === 'spec_generated'
                      ? 'Spec generated, starting refinement...'
                      : eventData.stage === 'refining'
                      ? `Refining section ${eventData.currentIteration || 0}/${eventData.totalIterations || 0}...`
                      : eventData.stage === 'task_complete'
                      ? `Completed: ${eventData.taskTitle || 'Refinement task'}`
                      : eventData.stage === 'complete'
                      ? 'Refinement complete'
                      : eventData.error || 'Processing...',
                    specAmplification: {
                      stage: eventData.stage,
                      fastModel: eventData.fastModel,
                      specScore: eventData.specScore,
                      sectionsGenerated: eventData.sectionsGenerated,
                      currentIteration: eventData.currentIteration,
                      totalIterations: eventData.totalIterations,
                      currentSection: eventData.currentSection,
                      error: eventData.error,
                      timestamp: eventData.timestamp || Date.now(),
                      taskId: eventData.taskId,
                      taskTitle: eventData.taskTitle,
                    },
                  }));

                  // When refinement starts, create a pending message to show loading state
                  if (eventData.stage === 'started' || eventData.stage === 'refining') {
                    setMessages(prev => {
                      const hasPendingRefinement = prev.some(m =>
                        m.metadata?.isRefinement && m.metadata?.isPending
                      );

                      if (!hasPendingRefinement) {
                        // Create pending refinement message with rotating statements
                        const pendingMessage: Message = {
                          id: 'refinement-pending',
                          role: 'assistant',
                          content: '',
                          metadata: {
                            isRefinement: true,
                            isPending: true,
                            isLoading: true,
                          },
                        };
                        return [...prev, pendingMessage];
                      }

                      return prev;
                    });
                  }

                  // When a refinement task completes, create/update a message with the content
                  // Each task gets its own message to show progressive improvements
                  if (eventData.stage === 'task_complete' && eventData.content) {
                    // Extract file edits from the content for enhanced-diff-viewer display
                    // Note: Server already applied these edits via applyFilesystemEditsFromResponse
                    // We just extract for UI display, not for re-applying
                    const { extractCompactFileEdits, extractFileWriteEdits } = await import('@/lib/chat/file-edit-parser');
                    const compactEdits = extractCompactFileEdits(eventData.content);
                    const writeEdits = extractFileWriteEdits(eventData.content);
                    const allEdits = [...compactEdits, ...writeEdits];

                    setMessages(prev => {
                      // Remove pending message if it exists
                      const withoutPending = prev.filter(m =>
                        !(m.metadata?.isRefinement && m.metadata?.isPending)
                      );

                      // Check if this task message already exists (update vs create)
                      const existingTaskIndex = withoutPending.findIndex(m =>
                        m.metadata?.taskId === eventData.taskId
                      );

                      const refinementMessage: Message = {
                        id: `refinement-${eventData.taskId || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        role: 'assistant',
                        content: eventData.content,
                        metadata: {
                          isRefinement: true,
                          taskId: eventData.taskId,
                          taskTitle: eventData.taskTitle,
                          provider: eventData.fastModel,
                          timestamp: eventData.timestamp,
                          isTaskComplete: true,
                          // Store extracted edits for enhanced-diff-viewer display
                          fileEdits: allEdits.length > 0 ? allEdits : undefined,
                        },
                      };

                      if (existingTaskIndex >= 0) {
                        // Update existing task message
                        const updated = [...withoutPending];
                        updated[existingTaskIndex] = refinementMessage;
                        return updated;
                      }

                      // Add new task message
                      return withoutPending.concat(refinementMessage);
                    });
                  }

                  // When refinement completes, create/update summary message
                  // This happens regardless of filesystem edits
                  if (eventData.stage === 'complete') {
                    // Extract file edits from the refined content for enhanced-diff-viewer display
                    // Note: Server already applied these edits via applyFilesystemEditsFromResponse
                    // We just extract for UI display, not for re-applying
                    const { extractCompactFileEdits, extractFileWriteEdits } = await import('@/lib/chat/file-edit-parser');
                    const compactEdits = extractCompactFileEdits(eventData.refinedContent || '');
                    const writeEdits = extractFileWriteEdits(eventData.refinedContent || '');
                    const allEdits = [...compactEdits, ...writeEdits];

                    setMessages(prev => {
                      // Remove pending message if it exists
                      const withoutPending = prev.filter(m =>
                        !(m.metadata?.isRefinement && m.metadata?.isPending)
                      );

                      // Check if summary message already exists
                      const existingSummaryIndex = withoutPending.findIndex(m =>
                        m.metadata?.isRefinementSummary
                      );

                      const refinementMessage: Message = {
                        id: `refinement-summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        role: 'assistant',
                        content: eventData.refinedContent || 'Refinement complete.',
                        metadata: {
                          filesystem: eventData.filesystem,
                          provider: eventData.fastModel,
                          specScore: eventData.specScore,
                          isRefinementSummary: true,
                          sectionsProcessed: eventData.sectionsProcessed,
                          // Store extracted edits for enhanced-diff-viewer display
                          fileEdits: allEdits.length > 0 ? allEdits : undefined,
                        },
                      };

                      if (existingSummaryIndex >= 0) {
                        // Update existing summary
                        const updated = [...withoutPending];
                        updated[existingSummaryIndex] = refinementMessage;
                        return updated;
                      }

                      // Add new summary message
                      return withoutPending.concat(refinementMessage);
                    });
                  }
                  break;

                case 'spec_refinement':
                  // Spec section refinement progress
                  // eventData contains: { section, tasks, progress, content, timestamp }
                  setAgentActivity(prev => ({
                    ...prev,
                    status: 'processing',
                    currentAction: `Refining: ${eventData.section}`,
                    refinementProgress: {
                      section: eventData.section,
                      tasks: eventData.tasks,
                      progress: eventData.progress,
                      content: eventData.content,
                      timestamp: eventData.timestamp || Date.now(),
                    },
                  }));
                  break;

                case 'dag_task_status':
                  // DAG task execution status
                  // eventData contains: { tasks, overallProgress, activeTasks, timestamp }
                  setAgentActivity(prev => ({
                    ...prev,
                    status: 'processing',
                    currentAction: `Executing ${eventData.activeTasks.length} task(s) in parallel...`,
                    dagProgress: {
                      tasks: eventData.tasks,
                      overallProgress: eventData.overallProgress,
                      activeTasks: eventData.activeTasks,
                      timestamp: eventData.timestamp || Date.now(),
                    },
                  }));
                  break;

                case 'tool_invocation':
                  setMessages(prev => prev.map(msg => {
                    if (msg.id !== assistantMessage.id) return msg;
                    const existing = Array.isArray((msg.metadata as any)?.toolInvocations)
                      ? ([...(msg.metadata as any).toolInvocations] as any[])
                      : [];

                    // Find existing invocation with same toolCallId
                    const idx = existing.findIndex((inv) =>
                      inv.toolCallId === eventData.toolCallId
                    );

                    // Handle different states for real-time updates
                    if (eventData.state === 'partial-call') {
                      // Streaming arguments - update or create
                      if (idx === -1) {
                        existing.push({
                          toolCallId: eventData.toolCallId,
                          toolName: eventData.toolName,
                          state: 'partial-call',
                          args: eventData.args || {},
                        });
                      } else {
                        existing[idx] = {
                          ...existing[idx],
                          state: 'partial-call',
                          args: { ...existing[idx].args, ...eventData.args },
                        };
                      }
                    } else if (eventData.state === 'call') {
                      // Tool executing
                      if (idx === -1) {
                        existing.push({
                          toolCallId: eventData.toolCallId,
                          toolName: eventData.toolName,
                          state: 'call',
                          args: eventData.args || {},
                        });
                      } else {
                        existing[idx] = {
                          ...existing[idx],
                          state: 'call',
                        };
                      }
                      // Update agent activity
                      setAgentActivity(prev => ({
                        ...prev,
                        status: 'executing',
                        currentAction: `Executing ${eventData.toolName}...`,
                        toolInvocations: [...prev.toolInvocations, {
                          id: eventData.toolCallId || Date.now().toString(),
                          toolName: eventData.toolName,
                          state: 'call',
                          args: eventData.args || {},
                          timestamp: Date.now(),
                        }],
                      }));
                    } else if (eventData.state === 'result') {
                      // Tool completed
                      if (idx === -1) {
                        existing.push({
                          toolCallId: eventData.toolCallId,
                          toolName: eventData.toolName,
                          state: 'result',
                          args: eventData.args || {},
                          result: eventData.result,
                        });
                      } else {
                        existing[idx] = {
                          ...existing[idx],
                          state: 'result',
                          result: eventData.result,
                        };
                      }
                      // Update agent activity - update existing tool
                      setAgentActivity(prev => ({
                        ...prev,
                        toolInvocations: prev.toolInvocations.map(t =>
                          t.toolName === eventData.toolName
                            ? { ...t, state: 'result', result: eventData.result }
                            : t
                        ),
                      }));
                    }

                    return {
                      ...msg,
                      metadata: {
                        ...(msg.metadata || {}),
                        toolInvocations: existing,
                      },
                    };
                  }));
                  break;
                
                case 'step':
                  setMessages(prev => prev.map(msg => {
                    if (msg.id !== assistantMessage.id) return msg;
                    const existing = Array.isArray((msg.metadata as any)?.processingSteps)
                      ? ([...(msg.metadata as any).processingSteps] as any[])
                      : [];
                    const stepIndex = typeof eventData.stepIndex === 'number'
                      ? eventData.stepIndex
                      : existing.length;
                    if (stepIndex >= 0) {
                      existing[stepIndex] = {
                        ...(existing[stepIndex] || {}),
                        ...eventData,
                      };
                    } else {
                      existing.push(eventData);
                    }
                    return {
                      ...msg,
                      metadata: {
                        ...(msg.metadata || {}),
                        processingSteps: existing,
                      },
                    };
                  }));
                  // Update agent activity
                  setAgentActivity(prev => ({
                    ...prev,
                    status: eventData.status === 'started' ? 'executing' : 
                            eventData.status === 'completed' ? 'completed' : prev.status,
                    currentAction: eventData.status === 'started' ? eventData.step : prev.currentAction,
                    processingSteps: [...prev.processingSteps, {
                      id: Date.now().toString(),
                      step: eventData.step,
                      status: eventData.status,
                      stepIndex: eventData.stepIndex || prev.processingSteps.length,
                      timestamp: Date.now(),
                    }],
                  }));
                  // Update agent status based on step
                  if (eventData.status === 'started') {
                    setAgentStatus('executing');
                    setCurrentAction(eventData.step);
                  } else if (eventData.status === 'completed') {
                    setCurrentAction(undefined);
                  }
                  break;

                case 'git:commit':
                  // Git commit event - update version
                  if (eventData.version) {
                    setCurrentVersion(eventData.version);
                  }
                  setMessages(prev => prev.map(msg => {
                    if (msg.id !== assistantMessage.id) return msg;
                    return {
                      ...msg,
                      metadata: {
                        ...(msg.metadata || {}),
                        gitCommit: {
                          filesChanged: eventData.filesChanged,
                          paths: eventData.paths,
                          version: eventData.version,
                        },
                      },
                    };
                  }));
                  // Update agent activity
                  setAgentActivity(prev => ({
                    ...prev,
                    gitCommits: [...prev.gitCommits, {
                      version: eventData.version,
                      filesChanged: eventData.filesChanged || eventData.paths?.length || 0,
                      paths: eventData.paths || [],
                      timestamp: Date.now(),
                    }],
                  }));
                  break;

                case 'git:rollback':
                  // Git rollback event
                  if (eventData.version) {
                    setCurrentVersion(eventData.version);
                  }
                  break;

                case 'step_metric':
                  setMessages(prev => prev.map(msg => {
                    if (msg.id !== assistantMessage.id) return msg;
                    const existing = Array.isArray((msg.metadata as any)?.stepMetrics)
                      ? ([...(msg.metadata as any).stepMetrics] as any[])
                      : [];
                    existing.push({
                      ...eventData,
                      timestamp: eventData?.timestamp || Date.now(),
                    });
                    return {
                      ...msg,
                      metadata: {
                        ...(msg.metadata || {}),
                        stepMetrics: existing,
                      },
                    };
                  }));
                  break;

                // Non-content events - just log for debugging in development
                case 'heartbeat':
                case 'metrics':
                case 'commands':
                case 'softTimeout':
                  if (process.env.NODE_ENV === 'development') {
                    console.log(`Chat stream event (${eventType}):`, eventData);
                  }
                  break;

                default:
                  // Handle unknown event types gracefully
                  if (process.env.NODE_ENV === 'development') {
                    console.warn('Unknown event type:', eventType, eventData);
                  }
                  break;
              }
            } // End for loop

            // Handle other SSE fields (id, retry) - ignore them
            if (line.startsWith('id: ') || line.startsWith('retry: ')) {
              continue;
            }
          } // End if (line.startsWith('data: '))
        } // End for (const line of lines)
      } // End while (true)

      // If we reach here without a 'done' event, consider it complete
      clearTimeout(timeoutId);
      setIsLoading(false);
      
      if (options.onFinish && currentMessageRef.current) {
        options.onFinish({
          ...currentMessageRef.current,
          content: accumulatedContent
        });
      }
    } catch (streamError) {
      clearTimeout(timeoutId);
      if (streamError instanceof Error && streamError.name !== 'AbortError') {
        throw streamError;
      }
    } finally {
      reader.releaseLock();
      abortControllerRef.current = null;
    }
  };

  // Helper function to retry with v1 mode, reusing handleStreamingResponse
  const handleV1Fallback = async (
    assistantMessage: Message,
    abortController: AbortController
  ) => {
    // Get current messages for retry - filter out the current assistant message
    // and reconstruct the request as it was originally built
    const filteredMessages = [...messagesRef.current].filter(m => m.id !== assistantMessage.id);
    const resolvedBody = typeof options.body === 'function'
      ? options.body()
      : (options.body || {});
    
    // Retry with agentMode: v1 - reconstruct request like handleSubmit does
    const v1RequestBody = {
      messages: filteredMessages,
      ...resolvedBody,
      agentMode: 'v1',
    };
    
    // Log fallback attempt
    console.log('[Chat] Attempting V1 fallback with messages:', {
      messageCount: filteredMessages.length,
      api: options.api,
      hasBody: !!resolvedBody,
    });
    
    let v1Response: Response;
    try {
      v1Response = await fetch(options.api, {
        method: 'POST',
        headers: buildRequestHeaders(),
        credentials: 'include',
        body: JSON.stringify(v1RequestBody),
        signal: abortController.signal,
      });
    } catch (fetchError) {
      // Handle network errors gracefully
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Network error during V1 fallback';
      console.error('[Chat] V1 fallback fetch failed:', errorMessage);
      
      // If fetch failed, show a user-friendly error but preserve any accumulated content
      setError(new Error('Connection failed. Please check your network and try again.'));
      if (options.onError) {
        options.onError(new Error(errorMessage));
      }
      setIsLoading(false);
      return;
    }
    
    if (!v1Response.ok) {
      const errorText = await v1Response.text().catch(() => 'Unable to read error');
      console.error('[Chat] V1 fallback HTTP error:', { status: v1Response.status, body: errorText });
      
      // Handle HTTP errors gracefully
      setError(new Error(`Server error: ${v1Response.status}`));
      if (options.onError) {
        options.onError(new Error(`Server error: ${v1Response.status}`));
      }
      setIsLoading(false);
      return;
    }
    
    if (!v1Response.body) {
      console.error('[Chat] V1 fallback returned empty response body');
      throw new Error('No response body from v1 fallback');
    }
    
    console.log('[Chat] V1 fallback request successful, processing stream...');
    
    // Wrap onFinish to add fallback metadata
    const originalOnFinish = options.onFinish;
    const fallbackOnFinish = (message: Message) => {
      console.log('[Chat] V1 fallback completed successfully', {
        contentLength: message.content?.length,
        hasMetadata: !!message.metadata,
      });
      if (originalOnFinish) {
        originalOnFinish({
          ...message,
          metadata: { ...(message.metadata || {}), fallbackFromV2: true },
        });
      }
    };
    
    // Process v1 response stream
    try {
      await processV1Stream(v1Response.body, assistantMessage, abortController, fallbackOnFinish);
    } catch (streamError) {
      console.error('[Chat] V1 fallback stream processing error:', streamError);
      throw streamError;
    }
  };
  
  // Process v1 stream - extracted to avoid code duplication
  const processV1Stream = async (
    body: ReadableStream<Uint8Array>,
    assistantMessage: Message,
    abortController: AbortController,
    onFinish?: (message: Message) => void
  ) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let accumulatedContent = '';
    
    // Set up a timeout
    const timeoutId = setTimeout(() => {
      if (accumulatedContent.trim()) {
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: accumulatedContent }
            : msg
        ));
        setIsLoading(false);
        if (onFinish && currentMessageRef.current) {
          onFinish({
            ...currentMessageRef.current,
            content: accumulatedContent,
          });
        }
      }
    }, 30000);
    
    const parser = createNDJSONParser();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || abortController.signal.aborted) break;

        // Decode chunk and parse complete NDJSON lines
        const chunk = decoder.decode(value, { stream: true });
        
        // Handle SSE format (data: {...})
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const dataString = line.slice(6).trim();
          if (dataString === '[DONE]') {
            clearTimeout(timeoutId);
            setIsLoading(false);
            if (onFinish && currentMessageRef.current) {
              onFinish({
                ...currentMessageRef.current,
                content: accumulatedContent,
              });
            }
            return;
          }

          // Use robust NDJSON parser to handle partial chunks
          // Add newline to ensure complete parsing of SSE payloads
          let parsedObjects: any[];
          try {
            parsedObjects = parser.parse(dataString + '\n');
          } catch (parseError) {
            console.warn('V1 stream parsing error:', parseError);
            continue;
          }
          
          for (const parsed of parsedObjects) {
            // Handle OpenAI-compatible streaming format (v1)
            if (parsed.choices?.[0]?.delta?.content) {
              accumulatedContent += parsed.choices[0].delta.content;
              setMessages(prev => prev.map(msg =>
                msg.id === assistantMessage.id
                  ? { ...msg, content: accumulatedContent }
                  : msg
              ));
            } else if (parsed.content) {
              // Non-streaming content
              accumulatedContent += parsed.content;
              setMessages(prev => prev.map(msg =>
                msg.id === assistantMessage.id
                  ? { ...msg, content: accumulatedContent }
                  : msg
              ));
            }
            }
          }
        }
      } finally {
      reader.releaseLock();
    }
    
    // If we reach here without a 'done' event
    clearTimeout(timeoutId);
    setIsLoading(false);
    if (onFinish && currentMessageRef.current) {
      onFinish({
        ...currentMessageRef.current,
        content: accumulatedContent,
      });
    }
  };

  return {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    setMessages,
    stop,
    setInput,
    // Agent status for multi-agent display
    agentStatus: {
      type: agentType,
      status: agentStatus,
      currentAction,
    },
    // Version tracking
    currentVersion,
    // Agent activity for experimental panel
    agentActivity,
    setAgentActivity,
  };
}
