/**
 * OpenCode Engine Service
 * Placeholder for backward compatibility.
 */

export interface OpenCodeEngineConfig {
  userId: string;
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

export async function createOpenCodeEngine(config: OpenCodeEngineConfig) {
  try {
    const { OpenCodeAgent } = await import('@/lib/spawn/opencode-agent');
    const agent = new OpenCodeAgent({ userId: config.userId } as any);
    return {
      execute: async (prompt: string) => {
        return { success: true, output: '', error: undefined };
      }
    };
  } catch {
    return {
      execute: async (prompt: string) => {
        return { success: true, output: '', error: undefined };
      }
    };
  }
}