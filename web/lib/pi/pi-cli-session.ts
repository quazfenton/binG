/**
 * Pi CLI Session
 * 
 * Runs Pi as a subprocess and communicates via JSON-RPC over stdin/stdout.
 * This is used for desktop mode where we spawn the pi binary.
 * 
 * Integrates with binG's existing:
 * - VFS for file operations (when mode='vfs')
 * - MCP tools for tool execution
 * - Session Manager for persistence
 */

import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { PiSession, PiConfig, PiEvent, PiPromptOptions, PiState } from './pi-types';
import type { AgentMessage } from '@/lib/agent/types';
import type { ToolResult } from '@/lib/agent/types';
import { findPiBinarySync } from '@/lib/agent-bins/find-pi-binary';
import { spawnLocalAgent, type SpawnLocalAgentOptions } from '@/lib/spawn/local-server-utils';

interface RpcRequest {
  id?: string;
  type: string;
  message?: string;
  streamingBehavior?: string;
  [key: string]: unknown;
}

interface RpcResponse {
  id?: string;
  type: 'response';
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface RpcEvent {
  type: string;
  [key: string]: unknown;
}

/** JSON-LF parser - splits on LF only */
function parseJsonl(buffer: string, onLine: (line: string) => void): string {
  let remaining = buffer;
  while (true) {
    const newlineIndex = remaining.indexOf('\n');
    if (newlineIndex === -1) break;
    const line = remaining.slice(0, newlineIndex);
    remaining = remaining.slice(newlineIndex + 1);
    if (line.endsWith('\r')) {
      onLine(line.slice(0, -1));
    } else {
      onLine(line);
    }
  }
  return remaining;
}

/** Execute bash command locally via existing bash-tool infrastructure */
async function executeBashLocally(command: string, cwd: string): Promise<ToolResult> {
  try {
    const { createBashTool } = await import('@/lib/bash/bash-tool');
    const bashToolMap = createBashTool({
      workingDir: cwd,
      enableSelfHealing: true,
      persistToVFS: true,
    });
    const bashTool = bashToolMap.bash_execute;
    
    if (!bashTool) {
      return {
        content: [{ type: 'text', text: 'Bash tool not available' }],
        details: { isError: true },
      };
    }

    const result = await bashTool.execute({ command }, {} as any);
    const res = result as any;
    return {
      content: [{ type: 'text', text: res.output || '' }],
      details: { exitCode: res.exitCode },
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
      details: { isError: true },
    };
  }
}

export async function createCliPiSession(config: PiConfig): Promise<PiSession> {
  const {
    cwd = process.cwd(),
    mode = 'local',
    provider = 'anthropic',
    modelId = 'claude-sonnet-4-20250514',
    thinkingLevel = 'medium',
    apiKey,
    sessionDir,
    noSession = false,
  } = config;

  // Build CLI arguments
  const args = [
    '--mode', 'rpc',
    '--provider', provider,
    '--model', modelId,
    '--no-session',
  ];
  
  if (sessionDir) {
    args.push('--session-dir', sessionDir);
  }

  // Resolve pi binary via robust OS-aware detection (PI_BIN → which/where → default paths)
  const piBin = findPiBinarySync() ?? 'pi';

  // On Windows, 'pi' may not be directly in PATH — fall back to 'npx pi' if not found
  const command = process.platform === 'win32' && piBin === 'pi' ? 'npx' : piBin;
  const commandArgs = command === 'npx' ? ['pi', ...args] : args;

  const spawnOpts: SpawnLocalAgentOptions = {
    cwd,
    label: 'pi',
    env: {
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
    },
    // Pi uses JSON-RPC over stdout — do NOT drain stdout to logger
    drainStdout: false,
    onExit: (code) => {
      console.log('[Pi CLI] exited with code:', code);
    },
    onError: (err) => {
      console.error('[Pi CLI] error:', err);
    },
  };

  const proc = spawnLocalAgent(command, commandArgs, spawnOpts);

  const sessionId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let buffer = '';
  let isStreaming = false;
  const listeners: Set<(event: PiEvent) => void> = new Set();
  let pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let requestId = 0;

  // Handle stdout for events and responses
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer = parseJsonl(buffer + chunk.toString(), (line) => {
      if (!line) return;
      try {
        const event = JSON.parse(line) as RpcEvent | RpcResponse;
        
        if (event.type === 'response') {
          const response = event as RpcResponse;
          if (response.id && pendingRequests.has(response.id)) {
            const { resolve } = pendingRequests.get(response.id)!;
            pendingRequests.delete(response.id);
            resolve(response);
          }
        } else {
          // Emit event to listeners
          const piEvent = transformEvent(event as RpcEvent);
          if (piEvent) {
            for (const listener of listeners) {
              try {
                listener(piEvent);
              } catch {}
            }
          }
          
          // Track streaming state
          if (piEvent.type === 'agent_start') {
            isStreaming = true;
          } else if (piEvent.type === 'agent_end') {
            isStreaming = false;
          }
        }
      } catch {}
    });
  });

  // spawnLocalAgent logs stderr at debug level; elevate to warn for Pi CLI diagnostics
  proc.stderr?.on('data', (chunk: Buffer) => {
    console.warn('[Pi CLI] stderr:', chunk.toString());
  });
  // exit/error are handled via spawnOpts.onExit / spawnOpts.onError

  // Send command helper
  function sendCommand(cmd: RpcRequest): Promise<RpcResponse> {
    return new Promise((resolve, reject) => {
      const id = `req-${++requestId}`;
      const fullCmd = { ...cmd, id };
      
      pendingRequests.set(id, { resolve, reject });
      
      proc.stdin?.write(JSON.stringify(fullCmd) + '\n');
      
      // Timeout after 60 seconds
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 60000);
    });
  }

  // Transform RPC event to PiEvent
  function transformEvent(event: RpcEvent): PiEvent | null {
    switch (event.type) {
      case 'agent_start':
        return { type: 'agent_start' };
      case 'agent_end':
        return { type: 'agent_end', messages: (event as any).messages || [] };
      case 'turn_start':
        return { type: 'turn_start' };
      case 'turn_end':
        return { type: 'turn_end', message: (event as any).message, toolResults: (event as any).toolResults || [] };
      case 'message_start':
        return { type: 'message_start', message: (event as any).message };
      case 'message_end':
        return { type: 'message_end', message: (event as any).message };
      case 'message_update':
        return { 
          type: 'message_update', 
          message: (event as any).message,
          assistantMessageEvent: (event as any).assistantMessageEvent,
        };
      case 'tool_execution_start':
        return { 
          type: 'tool_execution_start',
          toolCallId: (event as any).toolCallId,
          toolName: (event as any).toolName,
          args: (event as any).args,
        };
      case 'tool_execution_update':
        return { 
          type: 'tool_execution_update',
          toolCallId: (event as any).toolCallId,
          toolName: (event as any).toolName,
          partialResult: (event as any).partialResult,
        };
      case 'tool_execution_end':
        return { 
          type: 'tool_execution_end',
          toolCallId: (event as any).toolCallId,
          toolName: (event as any).toolName,
          result: (event as any).result,
          isError: (event as any).isError,
        };
      case 'queue_update':
        return {
          type: 'queue_update',
          steering: (event as any).steering || [],
          followUp: (event as any).followUp || [],
        };
      case 'compaction_start':
        return { type: 'compaction_start', reason: (event as any).reason || 'manual' };
      case 'compaction_end':
        return { type: 'compaction_end', summary: (event as any).result?.summary || '', aborted: (event as any).aborted || false };
      case 'error':
        return { type: 'error', message: (event as any).error || 'Unknown error' };
      default:
        return null;
    }
  }

  return {
    sessionId,
    isStreaming: false,

    async prompt(message: string, options?: PiPromptOptions): Promise<void> {
      await sendCommand({
        type: 'prompt',
        message,
        streamingBehavior: options?.streamingBehavior,
      });
    },

    async steer(message: string): Promise<void> {
      await sendCommand({ type: 'steer', message });
    },

    async followUp(message: string): Promise<void> {
      await sendCommand({ type: 'follow_up', message });
    },

    subscribe(listener: (event: PiEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async abort(): Promise<void> {
      await sendCommand({ type: 'abort' });
    },

    async getState(): Promise<PiState> {
      const response = await sendCommand({ type: 'get_state' });
      return response.data as PiState;
    },

    async getMessages(): Promise<AgentMessage[]> {
      const response = await sendCommand({ type: 'get_messages' });
      return (response.data as any)?.messages || [];
    },

    async cycleModel(): Promise<void> {
      await sendCommand({ type: 'cycle_model' });
    },

    async cycleThinkingLevel(): Promise<void> {
      await sendCommand({ type: 'cycle_thinking_level' });
    },

    async compact(): Promise<void> {
      await sendCommand({ type: 'compact' });
    },

    dispose(): void {
      proc.stdin?.end();
      proc.kill();
      listeners.clear();
    },
  };
}