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

        const processingSteps: Array<{
          step: string;
          status: 'started' | 'completed' | 'failed';
          timestamp: number;
          stepIndex: number;
          toolName?: string;
          toolCallId?: string;
          result?: any;
          detail?: string;
        }> = [];

        const emitStep = (step: string, status: 'started' | 'completed' | 'failed', detail?: Partial<typeof processingSteps[number]>) => {
          const payload = {
            step,
            status,
            timestamp: Date.now(),
            stepIndex: processingSteps.length,
            ...detail,
          };
          processingSteps.push(payload);
          controller.enqueue(encoder.encode(formatEvent('step', payload)));
        };

        const session = await agentSessionManager.getOrCreateSession(
          options.userId,
          options.conversationId,
          { mode: options.preferredAgent === 'nullclaw' ? 'nullclaw' : 'hybrid', enableMCP: true, enableNullclaw: true },
        );

        emitStep('Initialize V2 session', 'completed', {
          detail: `sessionId=${session.id}`,
        });

        emitStep('Sync workspace to sandbox', 'started');
        await agentFSBridge.syncToSandbox(options.userId, options.conversationId);
        emitStep('Sync workspace to sandbox', 'completed');
        agentSessionManager.setSessionState(options.userId, options.conversationId, 'busy');

        // Send init event to signal V2 mode start
        controller.enqueue(encoder.encode(formatEvent('init', {
          agent: 'v2',
          sessionId: session.id,
          conversationId: session.conversationId,
          timestamp: Date.now(),
        })));

        let accumulatedContent = '';
        let toolInvocations: any[] = [];

        emitStep('Execute task', 'started');
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
            const toolCallId = `${toolName}-${Date.now()}`;
            toolInvocations.push({
              toolCallId,
              toolName,
              state: 'result',
              args,
              result,
              timestamp: Date.now(),
            });
            emitStep(`Tool ${toolName}`, result?.success === false ? 'failed' : 'completed', {
              toolName,
              toolCallId,
              result,
            });
            controller.enqueue(encoder.encode(formatEvent('tool_invocation', {
              toolCallId,
              toolName,
              state: 'result',
              args,
              result,
              timestamp: Date.now(),
            })));
          },
        });

        const result = await resultPromise;
        emitStep('Execute task', 'completed');

        if (result.agent === 'opencode') {
          emitStep('Sync workspace from sandbox', 'started');
          await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
          emitStep('Sync workspace from sandbox', 'completed');
        }

        agentSessionManager.setSessionState(options.userId, options.conversationId, 'ready');
        agentSessionManager.updateActivity(options.userId, options.conversationId);

        // Build enhanced message metadata with code artifacts
        const finalContent = accumulatedContent || result.response || '';
        const messageMetadata: any = {
          agent: result.agent,
          sessionId: session.id,
          conversationId: session.conversationId,
          v2SessionId: session.v2SessionId,
          toolInvocations: toolInvocations,
          processingSteps: processingSteps,
        };

        // Extract code artifacts from result if available
        if (result.fileChanges && result.fileChanges.length > 0) {
          messageMetadata.codeArtifacts = result.fileChanges.map((fc: any) => ({
            path: fc.path,
            operation: fc.operation || 'write',
            language: fc.language || 'typescript',
          }));
        }

        // Include reasoning if available
        if (result.reasoning) {
          messageMetadata.reasoning = result.reasoning;
        }

        controller.enqueue(encoder.encode(formatEvent('done', {
          success: result.success ?? true,
          content: finalContent,
          messageMetadata,
          data: result,
        })));
      } catch (error: any) {
        logger.error('Streaming execution failed', error);
        try {
          agentSessionManager.setSessionState(options.userId, options.conversationId, 'ready');
          agentSessionManager.updateActivity(options.userId, options.conversationId);
        } catch { /* ignore cleanup errors */ }
        controller.enqueue(encoder.encode(formatEvent('error', {
          message: error.message || 'Execution failed',
        })));
      } finally {
        controller.close();
      }
    },
  });
}
