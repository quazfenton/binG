import type { NextRequest } from 'next/server';

export type OrchestrationMode =
  | 'task-router'
  | 'unified-agent'
  | 'stateful-agent'
  | 'agent-kernel'
  | 'agent-loop'
  | 'execution-graph'
  | 'nullclaw'
  | 'opencode-sdk'
  | 'mastra-workflow'
  | 'crewai'
  | 'v2-executor'
  | 'agent-team'
  | 'desktop'
  | string;

export interface OrchestrationRequest {
  task: string;
  ownerId: string;
  sessionId: string;
  stream?: boolean;
  model?: string;
  context?: string;
  [key: string]: any;
}

export interface OrchestrationResult {
  success: boolean;
  response?: string;
  steps?: any[];
  error?: string;
  metadata?: {
    agentType: string;
    [key: string]: any;
  };
}

export function getOrchestrationModeFromRequest(req: Request | NextRequest): OrchestrationMode {
  const header = req.headers.get('x-orchestration-mode') || req.headers.get('X-Orchestration-Mode');
  return (header?.toLowerCase() || 'task-router') as OrchestrationMode;
}

export async function executeWithOrchestrationMode(
  mode: OrchestrationMode,
  request: OrchestrationRequest,
): Promise<OrchestrationResult> {
  const { taskRouter } = await import('./task-router');

  if (mode === 'task-router') {
    return taskRouter.executeTask({
      id: request.sessionId,
      task: request.task,
      userId: request.ownerId,
      conversationId: request.sessionId,
      stream: request.stream,
      model: request.model,
      context: request.context,
    } as any);
  }

  // Compatibility fallback: use the shared task router for all custom modes.
  // This keeps the chat route functional while avoiding the broken legacy
  // orchestration module graph in modula.ts during production builds.
  return taskRouter.executeTask({
    id: request.sessionId,
    task: request.task,
    userId: request.ownerId,
    conversationId: request.sessionId,
    stream: request.stream,
    model: request.model,
    context: request.context,
    preferredAgent: mode,
  } as any);
}
