'use client';

import { useState, useCallback } from 'react';

interface SandboxSession {
  sessionId: string;
  sandboxId: string;
  userId: string;
  status: string;
}

interface SandboxAgentStep {
  toolName: string;
  args: Record<string, any>;
  result: { success: boolean; output: string; exitCode?: number };
}

interface UseSandboxOptions {
  userId: string | number | null;
  onStepExecuted?: (step: SandboxAgentStep) => void;
  onError?: (error: string) => void;
}

export function useSandbox(options: UseSandboxOptions) {
  const [session, setSession] = useState<SandboxSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<SandboxAgentStep[]>([]);

  const ensureSession = useCallback(async (): Promise<SandboxSession | null> => {
    if (session) return session;
    if (!options.userId) return null;

    try {
      const res = await fetch('/api/sandbox/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: String(options.userId) }),
      });
      const data = await res.json();
      if (data.session) {
        setSession(data.session);
        return data.session;
      }
      return null;
    } catch (err: any) {
      console.error('[useSandbox] Session creation failed:', err);
      return null;
    }
  }, [session, options.userId]);

  const runAgent = useCallback(
    async (message: string, history?: any[]): Promise<string> => {
      if (!options.userId) {
        options.onError?.('User not authenticated');
        return '';
      }

      setLoading(true);
      setError(null);
      setSteps([]);

      try {
        const res = await fetch('/api/sandbox/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: String(options.userId),
            message,
            history,
          }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Sandbox agent failed');
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let finalResponse = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const json = line.slice(6).trim();
            if (!json) continue;

            let event: any;
            try {
              event = JSON.parse(json);
            } catch {
              // Skip malformed events
              continue;
            }

            if (event.type === 'tool_execution') {
              const step: SandboxAgentStep = {
                toolName: event.toolName,
                args: event.args,
                result: event.result,
              };
              setSteps(prev => [...prev, step]);
              options.onStepExecuted?.(step);
            } else if (event.type === 'complete') {
              finalResponse = event.response;
            } else if (event.type === 'error') {
              // Let the outer try/catch handle server-sent errors
              throw new Error(event.message);
            }
          }
        }

        setLoading(false);
        return finalResponse;
      } catch (err: any) {
        const msg = err.message || 'Sandbox execution failed';
        setError(msg);
        setLoading(false);
        options.onError?.(msg);
        return '';
      }
    },
    [options],
  );

  const destroySession = useCallback(async () => {
    if (!session) return;
    try {
      await fetch('/api/sandbox/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          sandboxId: session.sandboxId
        })
      });
    } catch {
      // Best effort
    }
    setSession(null);
    setSteps([]);
  }, [session]);

  return {
    session,
    loading,
    error,
    steps,
    runAgent,
    ensureSession,
    destroySession,
    hasSession: !!session,
  };
}
