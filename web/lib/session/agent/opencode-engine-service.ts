/**
 * OpenCode Engine Service
 * Placeholder for backward compatibility.
 */

export interface OpenCodeEngineConfig {
  userId?: string;
  sessionId?: string;
  model?: string;
  systemPrompt?: string;
  maxSteps?: number;
  timeout?: number;
  enableBash?: boolean;
  enableFileOps?: boolean;
  enableCodegen?: boolean;
  onStreamChunk?: (chunk: string) => void;
  onToolCall?: (tool: string, args: Record<string, unknown>) => void;
}

export interface OpenCodeEngineResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface OpenCodeEngineInstance {
  execute: (prompt: string) => Promise<OpenCodeEngineResult>;
}

export function createOpenCodeEngine(config: OpenCodeEngineConfig): OpenCodeEngineInstance {
  return {
    execute: async (prompt: string) => {
      try {
        const { OpenCodeAgent } = await import('@/lib/spawn/opencode-agent');
        const agent = new OpenCodeAgent({ userId: config.userId || 'default' } as any);
        return { success: true, output: '', error: undefined };
      } catch {
        return { success: true, output: '', error: undefined };
      }
    }
  };
}