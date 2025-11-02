"use client";

import { useState, useCallback, useRef } from 'react';
import { streamingErrorHandler } from '@/lib/streaming/streaming-error-handler';
import { createInputContext, processSafeContent } from '@/lib/input-response-separator';
import type { Message } from '@/types';

export interface UseChatOptions {
  api: string;
  body?: Record<string, any>;
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
}

/**
 * Enhanced useChat hook that properly handles our Server-Sent Events format
 */
export function useEnhancedChat(options: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageRef = useRef<Message | null>(null);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    console.log('[DEBUG] useEnhancedChat: handleSubmit called', { api: options.api, hasBody: !!options.body });
    
    if (!input.trim() || isLoading) {
      console.log('[DEBUG] useEnhancedChat: Skipping - empty input or already loading');
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
      const requestBody = {
        messages: [...messages, userMessage],
        ...options.body,
      };
      
      console.log('[DEBUG] useEnhancedChat: Sending request to', options.api, {
        messageCount: requestBody.messages.length,
        provider: options.body?.provider,
        model: options.body?.model,
        stream: options.body?.stream
      });

      const response = await fetch(options.api, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      // Call onResponse callback
      if (options.onResponse) {
        await options.onResponse(response);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error');
        console.error('[DEBUG] useEnhancedChat: HTTP error', response.status, errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log('[DEBUG] useEnhancedChat: Response received, status:', response.status);

      if (!response.body) {
        console.error('[DEBUG] useEnhancedChat: No response body');
        throw new Error('No response body for streaming');
      }

      // Handle streaming response
      console.log('[DEBUG] useEnhancedChat: Starting to handle streaming response');
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
      const currentMessage = messages.find(msg => msg.id === assistantMessage.id);
      const hasContent = currentMessage && currentMessage.content && currentMessage.content.trim().length > 0;
      
      // Only show error to user if it should be shown and we don't have content
      if (streamingErrorHandler.shouldShowToUser(streamingError) && !hasContent) {
        const userMessage = streamingErrorHandler.getUserMessage(streamingError);
        setError(new Error(userMessage));
        if (options.onError) {
          options.onError(new Error(userMessage));
        }
      } else {
        // Log error for debugging but don't show to user
        console.warn('Chat error (handled silently):', error);
        
        // If we have content, consider the request successful
        if (hasContent && options.onFinish && currentMessageRef.current) {
          options.onFinish({
            ...currentMessageRef.current,
            content: currentMessage.content
          });
        }
      }

      setIsLoading(false);
    }
  }, [input, isLoading, messages, options]);

  const handleStreamingResponse = async (
    body: ReadableStream<Uint8Array>,
    assistantMessage: Message,
    abortController: AbortController
  ) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = '';
    let currentEventType = '';
    let lastUpdateTime = Date.now();

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
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (abortController.signal.aborted) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') {
            // Empty line indicates end of event
            currentEventType = '';
            continue;
          }

          try {
            // Handle event type declarations
            if (line.startsWith('event: ')) {
              currentEventType = line.slice(7).trim();
              console.log('[DEBUG] useEnhancedChat: Event type:', currentEventType);
              continue;
            }

            // Handle data lines
            if (line.startsWith('data: ')) {
              const dataString = line.slice(6).trim();
              if (!dataString) continue;
              
              console.log('[DEBUG] useEnhancedChat: Data line received, length:', dataString.length, 'preview:', dataString.substring(0, 100));

              let eventData;
              try {
                eventData = JSON.parse(dataString);
                console.log('[DEBUG] useEnhancedChat: Parsed event data:', { type: eventData.type, hasContent: !!eventData.content });
              } catch (jsonError) {
                console.warn('[DEBUG] useEnhancedChat: JSON parse failed, trying fallback:', jsonError);
                // If JSON parsing fails, check if it's a simple text response
                if (dataString && typeof dataString === 'string' && dataString.trim()) {
                  // Handle different possible formats
                  if (dataString.startsWith('{') && dataString.endsWith('}')) {
                    // Looks like malformed JSON, try to extract content
                    const contentMatch = dataString.match(/"content":\s*"([^"]*)"/) || 
                                       dataString.match(/'content':\s*'([^']*)'/) ||
                                       dataString.match(/content:\s*"([^"]*)"/) ||
                                       dataString.match(/content:\s*'([^']*)'/) ||
                                       dataString.match(/"([^"]+)"/);
                    
                    if (contentMatch && contentMatch[1]) {
                      accumulatedContent += contentMatch[1];
                      lastUpdateTime = Date.now();
                      setMessages(prev => prev.map(msg => 
                        msg.id === assistantMessage.id 
                          ? { ...msg, content: accumulatedContent }
                          : msg
                      ));
                    }
                  } else {
                    // Treat as plain text content for backward compatibility
                    accumulatedContent += dataString;
                    lastUpdateTime = Date.now();
                    setMessages(prev => prev.map(msg => 
                      msg.id === assistantMessage.id 
                        ? { ...msg, content: accumulatedContent }
                        : msg
                    ));
                  }
                }
                continue;
              }

              // Determine event type from current context or data
              const eventType = currentEventType || eventData.type || 'token';
              console.log('[DEBUG] useEnhancedChat: Processing event type:', eventType);

              switch (eventType) {
                case 'init':
                  // Initialization event - just log for debugging
                  console.log('Chat stream initialized:', eventData);
                  break;

                case 'token':
                case 'data':
                  if (eventData.content) {
                    accumulatedContent += eventData.content;
                    lastUpdateTime = Date.now();
                    
                    // Update the assistant message in real-time
                    setMessages(prev => prev.map(msg => 
                      msg.id === assistantMessage.id 
                        ? { ...msg, content: accumulatedContent }
                        : msg
                    ));
                  }
                  break;

                case 'done':
                  // Streaming complete
                  clearTimeout(timeoutId);
                  setIsLoading(false);
                  if (options.onFinish && currentMessageRef.current) {
                    options.onFinish({
                      ...currentMessageRef.current,
                      content: accumulatedContent
                    });
                  }
                  return;

                case 'error':
                  throw new Error(eventData.message || 'Streaming error');

                case 'heartbeat':
                case 'metrics':
                case 'commands':
                case 'softTimeout':
                  // Non-content events - just log for debugging in development
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
            }

            // Handle other SSE fields (id, retry) - ignore them
            if (line.startsWith('id: ') || line.startsWith('retry: ')) {
              continue;
            }

          } catch (parseError) {
            // Handle parsing errors gracefully - use streaming error handler
            const streamingError = streamingErrorHandler.processError(
              parseError instanceof Error ? parseError : new Error(String(parseError))
            );
            
            // Only show error to user if it should be shown
            if (streamingErrorHandler.shouldShowToUser(streamingError)) {
              console.error('SSE parsing error:', parseError);
            } else {
              console.warn('SSE parsing error (handled silently):', parseError);
            }
            
            // Continue processing other lines even if one fails
            continue;
          }
        }
      }

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
  };
}

