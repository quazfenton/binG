import { agentSessionManager } from './agent-session-manager';
import { agentFSBridge } from './agent-fs-bridge';
import { taskRouter } from './task-router';
import { createLogger } from '../utils/logger';

const logger = createLogger('Agent:V2Executor');

export interface V2ExecuteOptions {
  userId: string;
  conversationId: string;
  task: string;
  context?: string;
  stream?: boolean;
  preferredAgent?: 'opencode' | 'nullclaw' | 'cli';
  cliCommand?: {
    command: string;
    args?: string[];
  };
}

export async function executeV2Task(options: V2ExecuteOptions): Promise<any> {
  const taskWithContext = options.context
    ? `${options.context}\n\nTASK:\n${options.task}`
    : options.task;
  const session = await agentSessionManager.getOrCreateSession(
    options.userId,
    options.conversationId,
    { mode: options.preferredAgent === 'nullclaw' ? 'nullclaw' : 'hybrid', enableMCP: true, enableNullclaw: true },
  );

  // Sync VFS into sandbox before execution
  await agentFSBridge.syncToSandbox(options.userId, options.conversationId);

  agentSessionManager.setSessionState(options.userId, options.conversationId, 'busy');
  let result: any;
  try {
    result = await taskRouter.executeTask({
      id: `task-${Date.now()}`,
      userId: options.userId,
      conversationId: options.conversationId,
      task: taskWithContext,
      stream: false,
      preferredAgent: options.preferredAgent,
      cliCommand: options.cliCommand,
    });
  } finally {
    agentSessionManager.setSessionState(options.userId, options.conversationId, 'ready');
    agentSessionManager.updateActivity(options.userId, options.conversationId);
  }

  // Sync back after OpenCode execution
  if (result.agent === 'opencode') {
    await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
  }

  return {
    success: result.success ?? true,
    data: result,
    sessionId: session.id,
    conversationId: session.conversationId,
    workspacePath: session.workspacePath,
  };
}

export function executeV2TaskStreaming(options: V2ExecuteOptions): ReadableStream {
  const encoder = new TextEncoder();

  const formatEvent = (type: string, data: any) =>
    `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  return new ReadableStream({
    async start(controller) {
      try {
        const taskWithContext = options.context
          ? `${options.context}\n\nTASK:\n${options.task}`
          : options.task;

        const session = await agentSessionManager.getOrCreateSession(
          options.userId,
          options.conversationId,
          { mode: options.preferredAgent === 'nullclaw' ? 'nullclaw' : 'hybrid', enableMCP: true, enableNullclaw: true },
        );

        await agentFSBridge.syncToSandbox(options.userId, options.conversationId);
        agentSessionManager.setSessionState(options.userId, options.conversationId, 'busy');

        let accumulatedContent = '';

        const resultPromise = taskRouter.executeTask({
          id: `task-${Date.now()}`,
          userId: options.userId,
          conversationId: options.conversationId,
          task: taskWithContext,
          stream: true,
          preferredAgent: options.preferredAgent,
          cliCommand: options.cliCommand,
          onStreamChunk: (chunk) => {
            accumulatedContent += chunk;
            controller.enqueue(encoder.encode(formatEvent('token', { content: chunk, timestamp: Date.now() })));
          },
          onToolExecution: (toolName, args, result) => {
            controller.enqueue(encoder.encode(formatEvent('tool_invocation', {
              toolCallId: `${toolName}-${Date.now()}`,
              toolName,
              state: 'result',
              args,
              result,
              timestamp: Date.now(),
            })));
          },
        });

        const result = await resultPromise;

        if (result.agent === 'opencode') {
          await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
        }

        agentSessionManager.setSessionState(options.userId, options.conversationId, 'ready');
        agentSessionManager.updateActivity(options.userId, options.conversationId);

        controller.enqueue(encoder.encode(formatEvent('done', {
          success: result.success ?? true,
          content: accumulatedContent || result.response || '',
          messageMetadata: {
            agent: result.agent,
            sessionId: session.id,
            conversationId: session.conversationId,
            v2SessionId: session.v2SessionId,
          },
          data: result,
        })));
      } catch (error: any) {
        logger.error('Streaming execution failed', error);
        agentSessionManager.setSessionState(options.userId, options.conversationId, 'ready');
        agentSessionManager.updateActivity(options.userId, options.conversationId);
        controller.enqueue(encoder.encode(formatEvent('error', {
          message: error.message || 'Execution failed',
        })));
      } finally {
        controller.close();
      }
    },
  });
}
