import { getOpenCodeEngine, type OpenCodeConfig, type OpenCodeEvent } from '../../../agent/services/agent-worker/src/opencode-engine';

export interface OpencodeV2ProviderOptions {
  session?: {
    userId?: string;
    conversationId?: string;
    enableMcp?: boolean;
    enableNullclaw?: boolean;
    workspaceDir?: string;
  };
  sandboxHandle?: unknown;
}

export interface OpencodeV2RunAgentLoopOptions {
  userMessage: string;
  tools?: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
  systemPrompt?: string;
  maxSteps?: number;
  onStreamChunk?: (chunk: string) => void;
  onToolExecution?: (toolName: string, args: Record<string, unknown>, result: unknown) => void;
  executeTool?: (name: string, args: Record<string, unknown>) => Promise<{
    success: boolean;
    output: unknown;
    exitCode: number;
  }>;
}

export interface OpencodeV2RunAgentLoopResult {
  response?: string;
  steps?: OpenCodeEvent[];
  totalSteps?: number;
  sessionId?: string;
  reasoning?: string;
  nullclawTasks?: unknown[];
}

export class OpencodeV2Provider {
  private readonly session: OpencodeV2ProviderOptions['session'];

  constructor(options: OpencodeV2ProviderOptions = {}) {
    this.session = options.session;
    void options.sandboxHandle;
  }

  async runAgentLoop(options: OpencodeV2RunAgentLoopOptions): Promise<OpencodeV2RunAgentLoopResult> {
    const engine = getOpenCodeEngine({
      workspaceDir: this.session?.workspaceDir,
      maxSteps: options.maxSteps,
      tools: options.tools?.map(tool => tool.name) || [],
    } satisfies OpenCodeConfig);

    const sessionId = this.session?.conversationId || this.session?.userId || 'default';
    const events: OpenCodeEvent[] = [];
    for await (const event of engine.runStream({
      sessionId,
      prompt: options.userMessage,
      context: options.systemPrompt,
      onEvent: (event) => {
        if (event.type === 'text' && typeof event.data?.text === 'string') {
          options.onStreamChunk?.(event.data.text);
        }
        if (event.type === 'tool' && event.data?.tool) {
          options.onToolExecution?.(event.data.tool, event.data.args || {}, event.data.result);
        }
      },
    })) {
      events.push(event);
    }

    const responseEvent = [...events].reverse().find(event => event.type === 'done');
    return {
      response: responseEvent?.data?.response || '',
      steps: events,
      totalSteps: events.length,
      sessionId,
      reasoning: '',
      nullclawTasks: [],
    };
  }
}
