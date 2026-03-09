'use client';

import { useState, useCallback, useRef } from 'react';

interface ToolExecutionState {
  loading: boolean;
  error: string | null;
  output: any | null;
  authRequired: boolean;
  authUrl: string | null;
  toolName: string | null;
  provider: string | null;
  category?: string;
  retryable?: boolean;
  hints?: string[];
}

interface UseToolIntegrationOptions {
  userId: string | number | null;
  conversationId?: string;
  onAuthRequired?: (authUrl: string, toolName: string, provider: string) => void;
  onSuccess?: (output: any, toolName: string) => void;
  onError?: (error: string, hints?: string[]) => void;
}

/**
 * Hook for executing tools via unified registry
 * Supports all providers: Composio, Arcade, Nango, Smithery, Tambo, MCP
 */
export function useToolIntegration(options: UseToolIntegrationOptions) {
  const [state, setState] = useState<ToolExecutionState>({
    loading: false,
    error: null,
    output: null,
    authRequired: false,
    authUrl: null,
    toolName: null,
    provider: null,
    category: undefined,
    retryable: false,
    hints: [],
  });

  // Use refs for callbacks and values that change every render
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const executeTool = useCallback(
    async (toolKey: string, input: any) => {
      const opts = optionsRef.current;
      if (!opts.userId) {
        opts.onError?.('User not authenticated');
        return null;
      }

      setState({ 
        loading: true, 
        error: null, 
        output: null, 
        authRequired: false, 
        authUrl: null, 
        toolName: toolKey, 
        provider: null,
        category: undefined,
        retryable: false,
        hints: [],
      });

      try {
        const response = await fetch('/api/tools/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolKey,
            input,
            userId: String(opts.userId),
            conversationId: opts.conversationId,
          }),
        });

        const data = await response.json();

        if (data.status === 'auth_required' || data.data?.requiresAuth) {
          setState({
            loading: false, 
            error: null, 
            output: null,
            authRequired: true, 
            authUrl: data.authUrl || data.data?.authUrl,
            toolName: data.toolName || data.data?.toolName, 
            provider: data.provider || data.data?.provider,
            category: data.category,
            retryable: false,
            hints: data.hints,
          });
          opts.onAuthRequired?.(
            data.authUrl || data.data?.authUrl, 
            data.toolName || data.data?.toolName, 
            data.provider || data.data?.provider
          );
          return null;
        }

        if (data.error) {
          setState({ 
            loading: false, 
            error: data.error, 
            output: null, 
            authRequired: false, 
            authUrl: null, 
            toolName: toolKey, 
            provider: null,
            category: data.category,
            retryable: data.retryable,
            hints: data.hints,
          });
          opts.onError?.(data.error, data.hints);
          return null;
        }

        setState({ 
          loading: false, 
          error: null, 
          output: data.output, 
          authRequired: false, 
          authUrl: null, 
          toolName: toolKey, 
          provider: null,
          category: undefined,
          retryable: false,
          hints: [],
        });
        opts.onSuccess?.(data.output, toolKey);
        return data.output;
      } catch (err: any) {
        const msg = err.message || 'Tool execution failed';
        setState({ 
          loading: false, 
          error: msg, 
          output: null, 
          authRequired: false, 
          authUrl: null, 
          toolName: toolKey, 
          provider: null,
          category: undefined,
          retryable: false,
          hints: ['Check your connection', 'Try again in a few moments'],
        });
        opts.onError?.(msg);
        return null;
      }
    },
    [],
  );

  const dismissAuth = useCallback(() => {
    setState(s => ({ ...s, authRequired: false, authUrl: null }));
  }, []);

  const retry = useCallback(async () => {
    if (state.retryable && state.toolName) {
      return executeTool(state.toolName, state.output || {});
    }
  }, [state.retryable, state.toolName, state.output, executeTool]);

  return { ...state, executeTool, dismissAuth, retry };
}

/**
 * Hook for discovering and searching tools
 */
export function useToolDiscovery(userId?: string) {
  const [state, setState] = useState({
    loading: false,
    tools: [] as Array<{
      name: string;
      description: string;
      provider: string;
      requiresAuth: boolean;
      category?: string;
    }>,
    error: null as string | null,
  });

  const search = useCallback(async (query: string, filters?: {
    category?: string;
    provider?: string;
    requiresAuth?: boolean;
    limit?: number;
  }) => {
    setState(s => ({ ...s, loading: true, error: null }));

    try {
      const params = new URLSearchParams({ query });
      if (filters?.category) params.set('category', filters.category);
      if (filters?.provider) params.set('provider', filters.provider);
      if (filters?.requiresAuth !== undefined) params.set('requiresAuth', String(filters.requiresAuth));
      if (filters?.limit) params.set('limit', String(filters.limit));
      if (userId) params.set('userId', String(userId));

      const response = await fetch(`/api/tools/discovery?${params}`);
      const data = await response.json();

      if (data.error) {
        setState({ loading: false, tools: [], error: data.error });
        return [];
      }

      setState({ loading: false, tools: data.tools || [], error: null });
      return data.tools || [];
    } catch (err: any) {
      setState({ loading: false, tools: [], error: err.message || 'Search failed' });
      return [];
    }
  }, [userId]);

  const getPopular = useCallback(async (limit = 10) => {
    setState(s => ({ ...s, loading: true, error: null }));

    try {
      const response = await fetch(`/api/tools/popular?limit=${limit}&userId=${userId || ''}`);
      const data = await response.json();

      if (data.error) {
        setState({ loading: false, tools: [], error: data.error });
        return [];
      }

      setState({ loading: false, tools: data.tools || [], error: null });
      return data.tools || [];
    } catch (err: any) {
      setState({ loading: false, tools: [], error: err.message || 'Failed to load popular tools' });
      return [];
    }
  }, [userId]);

  return { ...state, search, getPopular };
}
