/**
 * React Hooks for Vercel AI SDK Integration
 *
 * Provides React hooks for:
 * - Streaming chat completions
 * - Token usage tracking
 * - Reasoning UI display
 * - Error handling with retries
 *
 * Note: These hooks require @ai-sdk/react to be installed
 * Install with: pnpm add @ai-sdk/react
 *
 * @see https://sdk.vercel.ai/docs/ai-sdk-ui/use-chat
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { UIMessage } from 'ai';
import { tokenTracker } from './ai-caching';
import type { StreamingResponse } from './llm-providers';

// Type alias for Message (using UIMessage from AI SDK)
export type Message = UIMessage;

/**
 * Extended useChat options with binG-specific features
 */
export interface UseChatOptions {
  id?: string;
  initialMessages?: Message[];
  initialInput?: string;
  api?: string;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  body?: Record<string, any>;
  sendExtraMessageFields?: boolean;
  experimental_onFunctionCall?: (
    functionCall: { name: string; arguments: any },
    updateChatRequest: (request: any) => void
  ) => void;
  streamProtocol?: 'data' | 'text';
  onFinish?: (message: Message, options: { usage: any }) => void;
  onError?: (error: Error) => void;
  maxSteps?: number;
  onToolCall?: (options: any) => void;
  prepareRequestBody?: (options: any) => any;
  fetch?: typeof fetch;
  keepLastMessageOnError?: boolean;
  // binG-specific options
  provider?: string;
  model?: string;
  enableTokenTracking?: boolean;
  enableReasoningDisplay?: boolean;
  maxRetries?: number;
}

/**
 * Chat state with binG extensions
 */
export interface ChatState {
  messages: Message[];
  input: string;
  isLoading: boolean;
  error: Error | undefined;
  append: (
    message: Message | { role: string; content: string; experimental_attachments?: any },
    options?: { data?: any }
  ) => Promise<string | null | undefined>;
  reload: () => Promise<string | null | undefined>;
  stop: () => void;
  setInput: (input: string) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (
    e?: React.FormEvent<HTMLFormElement>,
    options?: { data?: any; allowEmptySubmit?: boolean }
  ) => void;
  setData: (data: any) => void;
  // binG-specific extensions
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  reasoning: string[];
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: any;
    result?: any;
  }>;
  retryCount: number;
  clearError: () => void;
}

// Global type for circuit breaker
declare global {
  interface Window {
    __chatCircuitBreaker?: {
      error: string;
      count: number;
      time: number;
    };
  }
}

/**
 * Enhanced useChat hook with binG features
 * 
 * Note: This is a simplified implementation that works without @ai-sdk/react.
 * For full useChat functionality, install @ai-sdk/react and use the standard hook.
 */
export function useChatEnhanced(options: UseChatOptions = {}): ChatState {
  const {
    provider = '',
    model = '',
    enableTokenTracking = true,
    enableReasoningDisplay = true,
    maxRetries = 3,
    api = '/api/chat',
  } = options;

  // Local state
  const [messages, setMessages] = useState<Message[]>(options.initialMessages || []);
  const [input, setInput] = useState(options.initialInput || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [tokenUsage, setTokenUsage] = useState<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null>(null);
  const [reasoning, setReasoning] = useState<string[]>([]);
  const [toolCalls, setToolCalls] = useState<Array<{
    id: string;
    name: string;
    arguments: any;
    result?: any;
  }>>([]);
  const [retryCount, setRetryCount] = useState(0);
  const lastMessageRef = useRef<Message | null>(null);

  // Submit message
  const append = useCallback(async (
    message: Message | { role: string; content: string },
    options?: { data?: any }
  ): Promise<string | null | undefined> => {
    
    // Check client-side circuit breaker
    if (window.__chatCircuitBreaker && window.__chatCircuitBreaker.count >= 3 && 
        Date.now() - window.__chatCircuitBreaker.time < 30000) {
      const circuitError = new Error('Circuit breaker active: stopping repeated failed attempts.');
      setError(circuitError);
      throw circuitError;
    }

    setIsLoading(true);
    setError(undefined);

    try {
      const newMessage: Message = {
        id: `msg-${Date.now()}`,
        role: (message as any).role || 'user',
        parts: [{ type: 'text', text: (message as any).content || '' }],
      } as Message;

      setMessages(prev => [...prev, newMessage]);

      // Make API call
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, newMessage],
          provider,
          model,
          ...options?.data,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data = await response.json();

      // Add assistant response
      const assistantMessage: Message = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        parts: [{ type: 'text', text: data.content || '' }],
      } as Message;

      setMessages(prev => [...prev, assistantMessage]);

      // Track token usage
      if (enableTokenTracking && data.usage) {
        tokenTracker.recordUsage(
          model,
          provider,
          data.usage.promptTokens || 0,
          data.usage.completionTokens || 0,
          data.usage.totalTokens || 0
        );
        setTokenUsage(data.usage);
      }

      setRetryCount(0);
      return data.content;
    } catch (err: any) {
      // Simple client-side circuit breaker logic
      const errorKey = err?.message || 'unknown';
      if (window.__chatCircuitBreaker?.error === errorKey && 
          Date.now() - window.__chatCircuitBreaker.time < 30000) {
        window.__chatCircuitBreaker.count++;
      } else {
        window.__chatCircuitBreaker = { error: errorKey, count: 1, time: Date.now() };
      }

      setError(err);
      
      if (retryCount < maxRetries && window.__chatCircuitBreaker.count < 3) {
        setRetryCount(prev => prev + 1);
        // Retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        return append(message, options);
      }
      
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [api, provider, model, messages, enableTokenTracking, retryCount, maxRetries]);

  // Reload last message
  const reload = useCallback(async (): Promise<string | null | undefined> => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      return append(lastMessage);
    }
    return null;
  }, [messages, append]);

  // Stop streaming (placeholder - would need AbortController for real implementation)
  const stop = useCallback(() => {
    setIsLoading(false);
  }, []);

  // Handle input change
  const handleInputChange = useCallback((
    e: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    setInput(e.target.value);
  }, []);

  // Handle form submit
  const handleSubmit = useCallback((
    e?: React.FormEvent,
    options?: { data?: any }
  ) => {
    e?.preventDefault();
    if (!input.trim()) return;

    append({ role: 'user', content: input }, options);
    setInput('');
  }, [input, append]);

  // Set data (placeholder)
  const setData = useCallback(() => {
    // Placeholder for compatibility
  }, []);

  // Extract reasoning from messages
  // This extracts reasoning extracted by Vercel AI SDK's extractReasoningMiddleware
  // which supports Anthropic (<thinking>), Google (<thought>), and DeepSeek reasoning
  useEffect(() => {
    if (enableReasoningDisplay && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage !== lastMessageRef.current) {
        lastMessageRef.current = lastMessage;

        // Extract reasoning parts from multiple possible locations
        const reasoningParts: string[] = [];
        
        // Method 1: Check message.reasoning array (Vercel AI SDK standard format)
        // extractReasoningMiddleware populates this field
        if ((lastMessage as any).reasoning && Array.isArray((lastMessage as any).reasoning)) {
          for (const reasoningItem of (lastMessage as any).reasoning) {
            if (typeof reasoningItem === 'string') {
              reasoningParts.push(reasoningItem);
            } else if (reasoningItem?.text) {
              reasoningParts.push(reasoningItem.text);
            }
          }
        }
        
        // Method 2: Check experimental_attachments (fallback for custom implementations)
        if ((lastMessage as any).experimental_attachments) {
          for (const attachment of (lastMessage as any).experimental_attachments) {
            if (attachment.type === 'reasoning' && attachment.content) {
              reasoningParts.push(attachment.content);
            }
          }
        }
        
        // Method 3: Check message parts for reasoning type (newer SDK format)
        if ((lastMessage as any).parts && Array.isArray((lastMessage as any).parts)) {
          for (const part of (lastMessage as any).parts) {
            if (part.type === 'reasoning' && part.text) {
              reasoningParts.push(part.text);
            }
          }
        }
        
        setReasoning(reasoningParts);
      }
    }
  }, [messages, enableReasoningDisplay]);

  // Extract tool calls from messages
  useEffect(() => {
    const newToolCalls: Array<{
      id: string;
      name: string;
      arguments: any;
      result?: any;
    }> = [];

    for (const message of messages) {
      if ((message as any).toolInvocations) {
        for (const invocation of (message as any).toolInvocations) {
          newToolCalls.push({
            id: invocation.toolCallId,
            name: invocation.toolName,
            arguments: invocation.args,
            result: invocation.state === 'result' ? invocation.result : undefined,
          });
        }
      }
    }

    setToolCalls(newToolCalls);
  }, [messages]);

  // Clear error helper
  const clearError = useCallback(() => {
    setError(undefined);
    setRetryCount(0);
  }, []);

  return {
    messages,
    input,
    isLoading,
    error,
    append,
    reload,
    stop,
    setInput,
    handleInputChange,
    handleSubmit,
    setData,
    // binG extensions
    tokenUsage,
    reasoning,
    toolCalls,
    retryCount,
    clearError,
  };
}

/**
 * Hook for displaying reasoning UI
 */
export function useReasoningUI(reasoning: string[]) {
  const [displayedReasoning, setDisplayedReasoning] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    // Animate reasoning display
    if (reasoning.length > 0) {
      setDisplayedReasoning(reasoning);
      setIsExpanded(true);
    }
  }, [reasoning]);

  const collapse = useCallback(() => {
    setIsExpanded(false);
  }, []);

  const expand = useCallback(() => {
    setIsExpanded(true);
  }, []);

  return {
    reasoning: isExpanded ? displayedReasoning : [],
    isExpanded,
    collapse,
    expand,
    toggle: () => setIsExpanded(prev => !prev),
    count: displayedReasoning.length,
  };
}

/**
 * Hook for token usage display
 */
export function useTokenUsage(provider?: string, model?: string) {
  const [usage, setUsage] = useState<{
    current: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    average: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    limit: {
      max: number;
      percentage: number;
    };
  } | null>(null);

  const refreshUsage = useCallback(() => {
    if (provider && model) {
      const stats = tokenTracker.getUsage(provider, model);
      if (stats) {
        setUsage({
          current: {
            promptTokens: stats.promptTokens,
            completionTokens: stats.completionTokens,
            totalTokens: stats.totalTokens,
          },
          average: {
            promptTokens: Math.round(stats.promptTokens / stats.requestCount),
            completionTokens: Math.round(stats.completionTokens / stats.requestCount),
            totalTokens: Math.round(stats.totalTokens / stats.requestCount),
          },
          limit: {
            max: 128000, // Default, would be model-specific
            percentage: (stats.totalTokens / 128000) * 100,
          },
        });
      }
    }
  }, [provider, model]);

  useEffect(() => {
    refreshUsage();
    const interval = setInterval(refreshUsage, 5000);
    return () => clearInterval(interval);
  }, [refreshUsage]);

  return {
    usage,
    refresh: refreshUsage,
  };
}

/**
 * Hook for handling retry errors
 */
export function useRetryHandler(options?: {
  maxRetries?: number;
  onRetry?: (count: number, error: Error) => void;
  onError?: (error: Error) => void;
}) {
  const {
    maxRetries = 3,
    onRetry,
    onError,
  } = options || {};

  const [retryCount, setRetryCount] = useState(0);
  const [lastError, setLastError] = useState<Error | null>(null);

  const handleRetry = useCallback(async <T,>(
    fn: () => Promise<T>,
    context?: string
  ): Promise<T> => {
    try {
      const result = await fn();
      setRetryCount(0);
      setLastError(null);
      return result;
    } catch (error: any) {
      setLastError(error);

      if (retryCount < maxRetries) {
        onRetry?.(retryCount + 1, error);

        // Exponential backoff
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));

        setRetryCount(prev => prev + 1);
        return handleRetry(fn, context);
      }

      onError?.(error);
      throw error;
    }
  }, [retryCount, maxRetries, onRetry, onError]);

  const reset = useCallback(() => {
    setRetryCount(0);
    setLastError(null);
  }, []);

  return {
    retryCount,
    lastError,
    handleRetry,
    reset,
    canRetry: retryCount < maxRetries,
  };
}

/**
 * Hook for aborting streaming requests
 */
export function useAbortController() {
  const controllerRef = useRef<AbortController | null>(null);

  const getController = useCallback(() => {
    if (!controllerRef.current) {
      controllerRef.current = new AbortController();
    }
    return controllerRef.current;
  }, []);

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    controllerRef.current = new AbortController();
  }, []);

  return {
    abort,
    reset,
    signal: getController().signal,
  };
}

/**
 * Combined hook for complete AI chat experience
 */
export function useAIChat(options: UseChatOptions = {}) {
  const chat = useChatEnhanced(options);
  const reasoning = useReasoningUI(chat.reasoning);
  const tokenUsage = useTokenUsage(options.provider, options.model);
  const retry = useRetryHandler({
    maxRetries: options.maxRetries,
  });
  const abort = useAbortController();

  return {
    ...chat,
    reasoning,
    tokenUsage,
    retry,
    abort,
  };
}
