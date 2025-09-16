/**
 * React Hook for Enhanced API Client
 * 
 * Provides a React interface for the enhanced API client with
 * automatic error handling, retry logic, and user notifications.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from './use-toast';

export interface UseEnhancedAPIOptions {
  enableNotifications?: boolean;
  enableRetry?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export interface APIRequestConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  data?: any;
  headers?: Record<string, string>;
  fallbackEndpoints?: string[];
  enableCircuitBreaker?: boolean;
}

export interface APIState<T = any> {
  data: T | null;
  loading: boolean;
  error: string | null;
  isRetryable: boolean;
  retryCount: number;
  lastRequestTime: number | null;
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  providers: {
    available: string[];
    total: number;
  };
  errors: {
    frequent: string[];
  };
  timestamp: string;
}

export function useEnhancedAPI<T = any>(options: UseEnhancedAPIOptions = {}) {
  const {
    enableNotifications = true,
    enableRetry = true,
    maxRetries = 3,
    retryDelay = 1000,
    timeout = 30000
  } = options;

  const { toast } = useToast();
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const [state, setState] = useState<APIState<T>>({
    data: null,
    loading: false,
    error: null,
    isRetryable: false,
    retryCount: 0,
    lastRequestTime: null
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const request = useCallback(async (config: APIRequestConfig): Promise<T | null> => {
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    setState(prev => ({
      ...prev,
      loading: true,
      error: null,
      lastRequestTime: Date.now()
    }));

    try {
      const response = await fetch(config.url, {
        method: config.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...config.headers
        },
        body: config.data ? JSON.stringify(config.data) : undefined,
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      setState(prev => ({
        ...prev,
        data,
        loading: false,
        error: null,
        retryCount: 0
      }));

      return data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was cancelled, don't update state
        return null;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
        isRetryable: enableRetry && prev.retryCount < maxRetries
      }));

      // Show notification if enabled
      if (enableNotifications) {
        toast({
          title: "Request Failed",
          description: errorMessage,
          variant: "destructive",
        });
      }

      throw error;
    }
  }, [enableNotifications, enableRetry, maxRetries, toast]);

  const retry = useCallback(async (config: APIRequestConfig): Promise<T | null> => {
    if (!state.isRetryable) {
      throw new Error('Request is not retryable');
    }

    setState(prev => ({
      ...prev,
      retryCount: prev.retryCount + 1
    }));

    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, retryDelay * state.retryCount));

    return request(config);
  }, [state.isRetryable, state.retryCount, retryDelay, request]);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setState(prev => ({
        ...prev,
        loading: false
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      data: null,
      loading: false,
      error: null,
      isRetryable: false,
      retryCount: 0,
      lastRequestTime: null
    });
  }, []);

  return {
    ...state,
    request,
    retry,
    cancel,
    reset
  };
}

// Hook for monitoring API health
export function useAPIHealth() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = useCallback(async (detailed: boolean = false) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/health${detailed ? '?detailed=true' : ''}`);
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.statusText}`);
      }

      const healthData = await response.json();
      setHealth(healthData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Health check failed';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  const resetCircuitBreaker = useCallback(async (provider?: string) => {
    try {
      const response = await fetch('/api/health', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'reset-circuit-breaker',
          provider
        })
      });

      if (!response.ok) {
        throw new Error('Failed to reset circuit breaker');
      }

      // Refresh health status
      await checkHealth(true);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Reset failed');
    }
  }, [checkHealth]);

  const clearErrorStats = useCallback(async () => {
    try {
      const response = await fetch('/api/health', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'clear-error-stats'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to clear error stats');
      }

      // Refresh health status
      await checkHealth(true);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Clear failed');
    }
  }, [checkHealth]);

  const testProvider = useCallback(async (provider: string) => {
    try {
      const response = await fetch('/api/health', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'test-provider',
          provider
        })
      });

      const result = await response.json();
      return result;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Test failed');
    }
  }, []);

  // Auto-refresh health status
  useEffect(() => {
    checkHealth(true);
    
    const interval = setInterval(() => {
      checkHealth(false); // Basic health check every minute
    }, 60000);

    return () => clearInterval(interval);
  }, [checkHealth]);

  return {
    health,
    loading,
    error,
    checkHealth,
    resetCircuitBreaker,
    clearErrorStats,
    testProvider
  };
}

// Hook for chat API with enhanced features
export function useEnhancedChat() {
  const api = useEnhancedAPI();
  const { toast } = useToast();

  const sendMessage = useCallback(async (
    messages: any[],
    provider: string,
    model: string,
    options: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      apiKeys?: Record<string, string>;
      fallbackProviders?: string[];
    } = {}
  ) => {
    const config: APIRequestConfig = {
      url: '/api/chat',
      method: 'POST',
      data: {
        messages,
        provider,
        model,
        temperature: options.temperature || 0.7,
        maxTokens: options.maxTokens || 4096,
        stream: options.stream || false,
        apiKeys: options.apiKeys || {},
        fallbackProviders: options.fallbackProviders
      },
      enableCircuitBreaker: true
    };

    try {
      const response = await api.request(config);
      
      // Handle fallback notification
      if (response?.data?.provider?.includes('->')) {
        toast({
          title: "Fallback Provider Used",
          description: `Switched to alternative provider: ${response.data.provider}`,
          variant: "default",
        });
      }

      return response;
    } catch (error) {
      // Enhanced error handling is already done in the API route
      throw error;
    }
  }, [api, toast]);

  return {
    ...api,
    sendMessage
  };
}