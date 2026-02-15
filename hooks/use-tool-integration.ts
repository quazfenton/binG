'use client';

import { useState, useCallback } from 'react';

interface ToolExecutionState {
  loading: boolean;
  error: string | null;
  output: any | null;
  authRequired: boolean;
  authUrl: string | null;
  toolName: string | null;
  provider: string | null;
}

interface UseToolIntegrationOptions {
  userId: string | number | null;
  conversationId?: string;
  onAuthRequired?: (authUrl: string, toolName: string, provider: string) => void;
  onSuccess?: (output: any, toolName: string) => void;
  onError?: (error: string) => void;
}

export function useToolIntegration(options: UseToolIntegrationOptions) {
  const [state, setState] = useState<ToolExecutionState>({
    loading: false,
    error: null,
    output: null,
    authRequired: false,
    authUrl: null,
    toolName: null,
    provider: null,
  });

  const executeTool = useCallback(
    async (toolKey: string, input: any) => {
      if (!options.userId) {
        options.onError?.('User not authenticated');
        return null;
      }

      setState({ loading: true, error: null, output: null, authRequired: false, authUrl: null, toolName: toolKey, provider: null });

      try {
        const response = await fetch('/api/tools/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolKey,
            input,
            userId: String(options.userId),
            conversationId: options.conversationId,
          }),
        });

        const data = await response.json();

        if (data.status === 'auth_required') {
          setState({
            loading: false, error: null, output: null,
            authRequired: true, authUrl: data.authUrl,
            toolName: data.toolName, provider: data.provider,
          });
          options.onAuthRequired?.(data.authUrl, data.toolName, data.provider);
          return null;
        }

        if (data.error) {
          setState({ loading: false, error: data.error, output: null, authRequired: false, authUrl: null, toolName: toolKey, provider: null });
          options.onError?.(data.error);
          return null;
        }

        setState({ loading: false, error: null, output: data.output, authRequired: false, authUrl: null, toolName: toolKey, provider: null });
        options.onSuccess?.(data.output, toolKey);
        return data.output;
      } catch (err: any) {
        const msg = err.message || 'Tool execution failed';
        setState({ loading: false, error: msg, output: null, authRequired: false, authUrl: null, toolName: toolKey, provider: null });
        options.onError?.(msg);
        return null;
      }
    },
    [options],
  );

  const dismissAuth = useCallback(() => {
    setState(s => ({ ...s, authRequired: false, authUrl: null }));
  }, []);

  return { ...state, executeTool, dismissAuth };
}
