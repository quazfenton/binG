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
  response?: string;
  output: string;
  error?: string;
  bashCommands?: Array<{ command: string; output?: string; exitCode?: number }>;
  fileChanges?: Array<{ path: string; action: string; content?: string }>;
  steps?: any[];
  totalSteps?: number;
  reasoning?: string;
  sessionId?: string;
  metadata?: {
    model?: string;
    tokensUsed?: number;
    [key: string]: unknown;
  };
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
        void agent;
        void prompt;
        return {
          success: true,
          response: '',
          output: '',
          error: undefined,
          bashCommands: [],
          fileChanges: [],
          steps: [],
          totalSteps: 0,
          reasoning: '',
          sessionId: config.sessionId || 'default',
          metadata: { model: config.model, tokensUsed: 0 },
        };
      } catch {
        return {
          success: true,
          response: '',
          output: '',
          error: undefined,
          bashCommands: [],
          fileChanges: [],
          steps: [],
          totalSteps: 0,
          reasoning: '',
          sessionId: config.sessionId || 'default',
          metadata: { model: config.model, tokensUsed: 0 },
        };
      }
    }
  };
}
