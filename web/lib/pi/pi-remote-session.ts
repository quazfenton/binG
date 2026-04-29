/**
 * Pi Remote Session
 * 
 * Connects to a remote Pi server via HTTP.
 * Used for web mode where Pi runs in a separate container/process.
 */

import type { PiSession, PiConfig, PiEvent, PiPromptOptions, PiState } from './pi-types';
import type { AgentMessage } from '@/lib/agent/types';

/** HTTP Remote session */
export async function createRemotePiSession(config: PiConfig & { remoteUrl: string }): Promise<PiSession> {
  const {
    remoteUrl,
    cwd = '/workspace',
    sessionDir,
    noSession = true,
  } = config;

  const baseUrl = remoteUrl.replace(/\/$/, '');
  let sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let isStreaming = false;
  const listenerBase = `${baseUrl}/events/${sessionId}`;
  const listeners: Map<string, (event: PiEvent) => void> = new Map<string, (event: PiEvent) => void>();
  let eventSource: EventSource | null = null;

  // Connect to event stream
  async function connectEvents() {
    if (typeof EventSource === 'undefined') {
      console.warn('[Pi Remote] EventSource not available, polling mode');
      return;
    }

    eventSource = new EventSource(listenerBase);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const piEvent = transformEvent(data);
        if (piEvent) {
          for (const [, listener] of listeners) {
            try {
              listener(piEvent);
            } catch {}
          }
        }
      } catch {}
    };

    eventSource.onerror = () => {
      console.error('[Pi Remote] EventSource error, reconnecting...');
    };
  }

  // HTTP request helper
  async function request(endpoint: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  // Transform HTTP event to PiEvent
  function transformEvent(event: Record<string, unknown>): PiEvent | null {
    switch (event.type) {
      case 'agent_start':
        return { type: 'agent_start' };
      case 'agent_end':
        return { type: 'agent_end', messages: event.messages as AgentMessage[] };
      case 'turn_start':
        return { type: 'turn_start' };
      case 'turn_end':
        return { type: 'turn_end', message: event.message as AgentMessage, toolResults: event.toolResults as any[] };
      case 'message_start':
        return { type: 'message_start', message: event.message as AgentMessage };
      case 'message_end':
        return { type: 'message_end', message: event.message as AgentMessage };
      case 'message_update':
        return { type: 'message_update', message: event.message as AgentMessage, assistantMessageEvent: event.assistantMessageEvent as any };
      case 'tool_execution_start':
        return { type: 'tool_execution_start', toolCallId: event.toolCallId as string, toolName: event.toolName as string, args: event.args as any };
      case 'tool_execution_update':
        return { type: 'tool_execution_update', toolCallId: event.toolCallId as string, toolName: event.toolName as string, partialResult: event.partialResult as any };
      case 'tool_execution_end':
        return { type: 'tool_execution_end', toolCallId: event.toolCallId as string, toolName: event.toolName as string, result: event.result as any, isError: event.isError as boolean };
      case 'queue_update':
        return { type: 'queue_update', steering: event.steering as string[], followUp: event.followUp as string[] };
      case 'compaction_start':
        return { type: 'compaction_start', reason: event.reason as any };
      case 'compaction_end':
        return { type: 'compaction_end', summary: (event.result as any)?.summary || '', aborted: event.aborted as boolean };
      case 'error':
        return { type: 'error', message: event.message as string };
      default:
        return null;
    }
  }

  // Initialize session with server
  try {
    const initRes = await request('/session/create', {
      sessionId,
      cwd,
      sessionDir,
      noSession,
    });
    if ((initRes as any)?.sessionId) {
      sessionId = (initRes as any).sessionId;
    }
  } catch (err) {
    console.warn('[Pi Remote] Failed to create session:', err);
  }

  // Connect to events
  connectEvents();

  return {
    sessionId,
    get isStreaming() { return isStreaming; },

    async prompt(message: string, options?: PiPromptOptions): Promise<void> {
      const res = await request('/prompt', {
        sessionId,
        message,
        streamingBehavior: options?.streamingBehavior,
      });
      
      if (!(res as any).success) {
        throw new Error((res as any).error || 'Prompt failed');
      }
    },

    async steer(message: string): Promise<void> {
      await request('/steer', { sessionId, message });
    },

    async followUp(message: string): Promise<void> {
      await request('/follow_up', { sessionId, message });
    },

    subscribe(listener: (event: PiEvent) => void): () => void {
      const id = Math.random().toString(36);
      listeners.set(id, listener);
      return () => listeners.delete(id);
    },

    async abort(): Promise<void> {
      await request('/abort', { sessionId });
    },

    async getState(): Promise<PiState> {
      const res = await request('/get_state', { sessionId });
      return res as PiState;
    },

    async getMessages(): Promise<AgentMessage[]> {
      const res = await request('/get_messages', { sessionId });
      return ((res as any).messages || []) as AgentMessage[];
    },

    async cycleModel(): Promise<void> {
      await request('/cycle_model', { sessionId });
    },

    async cycleThinkingLevel(): Promise<void> {
      await request('/cycle_thinking_level', { sessionId });
    },

    async compact(): Promise<void> {
      await request('/compact', { sessionId });
    },

    dispose(): void {
      eventSource?.close();
      request('/session/dispose', { sessionId }).catch(() => {});
      listeners.clear();
    },
  };
}