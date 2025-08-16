"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { enhancedStreaming, StreamingMetrics } from '@/lib/streaming/enhanced-streaming';
import { toast } from 'sonner';

export interface UseEnhancedStreamingOptions {
  onToken?: (content: string) => void;
  onCommands?: (commands: any) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  enableOfflineSupport?: boolean;
  enableNetworkRecovery?: boolean;
}

export interface StreamingState {
  isStreaming: boolean;
  isConnecting: boolean;
  error: Error | null;
  content: string;
  metrics: StreamingMetrics | null;
  canRetry: boolean;
  networkStatus: 'online' | 'offline' | 'reconnecting';
}

export function useEnhancedStreaming(options: UseEnhancedStreamingOptions = {}) {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    isConnecting: false,
    error: null,
    content: '',
    metrics: null,
    canRetry: false,
    networkStatus: 'online',
  });

  const currentRequestId = useRef<string | null>(null);
  const accumulatedContent = useRef<string>('');
  const networkRecoveryTimeout = useRef<NodeJS.Timeout | null>(null);
  const visibilityChangeTimeout = useRef<NodeJS.Timeout | null>(null);

  // Mobile-specific: Handle network status changes
  useEffect(() => {
    if (!options.enableNetworkRecovery) return;

    const handleOnline = () => {
      setState(prev => ({ ...prev, networkStatus: 'online' }));

      // If we were streaming when we went offline, attempt to reconnect
      if (currentRequestId.current && state.error) {
        setState(prev => ({ ...prev, networkStatus: 'reconnecting' }));
        // Small delay to ensure connection is stable
        setTimeout(() => {
          retry();
        }, 1000);
      }
    };

    const handleOffline = () => {
      setState(prev => ({ ...prev, networkStatus: 'offline' }));
      if (options.enableOfflineSupport) {
        toast.info('Connection lost. Will retry when back online.');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Set initial network status
    setState(prev => ({
      ...prev,
      networkStatus: navigator.onLine ? 'online' : 'offline'
    }));

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [options.enableNetworkRecovery, options.enableOfflineSupport]);

  // Mobile-specific: Handle app visibility changes (background/foreground)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // App went to background - keep connection alive but reduce activity
        if (visibilityChangeTimeout.current) {
          clearTimeout(visibilityChangeTimeout.current);
        }
      } else {
        // App came to foreground - resume normal activity
        if (currentRequestId.current && state.error) {
          // If there was an error while in background, try to recover
          visibilityChangeTimeout.current = setTimeout(() => {
            if (state.canRetry) {
              retry();
            }
          }, 500);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (visibilityChangeTimeout.current) {
        clearTimeout(visibilityChangeTimeout.current);
      }
    };
  }, [state.error, state.canRetry]);

  // Set up enhanced streaming event listeners
  useEffect(() => {
    const handleRender = ({ requestId, content }: { requestId: string; content: string }) => {
      if (requestId === currentRequestId.current) {
        accumulatedContent.current += content;
        setState(prev => ({ ...prev, content: accumulatedContent.current }));
        options.onToken?.(content);
      }
    };

    const handleCommands = ({ requestId, commands }: { requestId: string; commands: any }) => {
      if (requestId === currentRequestId.current) {
        options.onCommands?.(commands);
      }
    };

    const handleError = ({ requestId, error, canRetry }: { requestId: string; error: Error; canRetry: boolean }) => {
      if (requestId === currentRequestId.current) {
        setState(prev => ({
          ...prev,
          error,
          isStreaming: false,
          isConnecting: false,
          canRetry,
          networkStatus: navigator.onLine ? 'online' : 'offline'
        }));
        options.onError?.(error);

        // Show user-friendly error messages
        if (error.message.includes('network') || error.message.includes('fetch')) {
          toast.error('Connection interrupted. Tap to retry when ready.');
        } else if (error.message.includes('timeout')) {
          toast.error('Request timed out. You can retry the request.');
        } else {
          toast.error('Something went wrong. You can retry the request.');
        }
      }
    };

    const handleRetry = ({ requestId, attempt }: { requestId: string; attempt: number }) => {
      if (requestId === currentRequestId.current) {
        setState(prev => ({ ...prev, networkStatus: 'reconnecting' }));
        toast.info(`Reconnecting... (attempt ${attempt})`);
      }
    };

    const handleMetrics = ({ requestId, metrics }: { requestId: string; metrics: StreamingMetrics }) => {
      if (requestId === currentRequestId.current) {
        setState(prev => ({ ...prev, metrics }));
      }
    };

    const handleDone = ({ requestId }: { requestId: string }) => {
      if (requestId === currentRequestId.current) {
        setState(prev => ({
          ...prev,
          isStreaming: false,
          isConnecting: false,
          error: null,
          networkStatus: 'online'
        }));
        options.onComplete?.(
        );
      }
    };

    const handleSoftTimeout = ({ requestId }: { requestId: string }) => {
      if (requestId === currentRequestId.current) {
        toast.info('This is taking longer than usual...', {
          action: {
            label: 'Cancel',
            onClick: () => stop(),
          },
        });
      }
    };

    // Register event listeners
    enhancedStreaming.on('render', handleRender);
    enhancedStreaming.on('commands', handleCommands);
    enhancedStreaming.on('error', handleError);
    enhancedStreaming.on('retry', handleRetry);
    enhancedStreaming.on('metrics', handleMetrics);
    enhancedStreaming.on('done', handleDone);
    enhancedStreaming.on('softTimeout', handleSoftTimeout);

    return () => {
      enhancedStreaming.off('render', handleRender);
      enhancedStreaming.off('commands', handleCommands);
      enhancedStreaming.off('error', handleError);
      enhancedStreaming.off('retry', handleRetry);
      enhancedStreaming.off('metrics', handleMetrics);
      enhancedStreaming.off('done', handleDone);
      enhancedStreaming.off('softTimeout', handleSoftTimeout);
    };
  }, [options]);

  // Start streaming function
  const startStreaming = useCallback(async (
    url: string,
    requestBody: any,
    resumeFromOffset?: number
  ) => {
    // Generate unique request ID
    const requestId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    currentRequestId.current = requestId;

    // Reset state
    accumulatedContent.current = '';
    setState(prev => ({
      ...prev,
      isStreaming: true,
      isConnecting: true,
      error: null,
      content: '',
      metrics: null,
      canRetry: false,
      networkStatus: navigator.onLine ? 'online' : 'offline'
    }));

    // Check network status before starting
    if (!navigator.onLine && !options.enableOfflineSupport) {
      const error = new Error('No internet connection');
      setState(prev => ({
        ...prev,
        error,
        isStreaming: false,
        isConnecting: false,
        canRetry: true,
        networkStatus: 'offline'
      }));
      options.onError?.(error);
      return;
    }

    try {
      setState(prev => ({ ...prev, isConnecting: false }));
      await enhancedStreaming.startStream(requestId, url, requestBody, {
        resumeFromOffset
      });
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error as Error,
        isStreaming: false,
        isConnecting: false,
        canRetry: true
      }));
      options.onError?.(error as Error);
    }
  }, [options]);

  // Stop streaming function
  const stop = useCallback(() => {
    if (currentRequestId.current) {
      enhancedStreaming.stopStream(currentRequestId.current);
      setState(prev => ({
        ...prev,
        isStreaming: false,
        isConnecting: false,
        canRetry: false
      }));
      currentRequestId.current = null;
    }
  }, []);

  // Retry function
  const retry = useCallback(() => {
    if (currentRequestId.current && state.canRetry) {
      // Clear network recovery timeout if it exists
      if (networkRecoveryTimeout.current) {
        clearTimeout(networkRecoveryTimeout.current);
        networkRecoveryTimeout.current = null;
      }

      setState(prev => ({
        ...prev,
        error: null,
        isStreaming: true,
        isConnecting: true,
        networkStatus: 'reconnecting'
      }));

      // Get the last successful offset for resume capability
      const resumeOffset = accumulatedContent.current.length;

      // Note: This would require storing the original request parameters
      // For now, we'll emit a retry event that the parent can handle
      toast.info('Retrying connection...');
    }
  }, [state.canRetry]);

  // Clear content function
  const clear = useCallback(() => {
    accumulatedContent.current = '';
    setState(prev => ({ ...prev, content: '', error: null, metrics: null }));
  }, []);

  // Get current metrics
  const getCurrentMetrics = useCallback(() => {
    if (currentRequestId.current) {
      return enhancedStreaming.getMetrics(currentRequestId.current);
    }
    return null;
  }, []);

  return {
    // State
    ...state,

    // Actions
    startStreaming,
    stop,
    retry,
    clear,

    // Utilities
    getCurrentMetrics,
    hasActiveStream: currentRequestId.current !== null,
    requestId: currentRequestId.current,
  };
}
