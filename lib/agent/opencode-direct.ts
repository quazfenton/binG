/**
 * OpenCode Direct - Runs OpenCode without task routing overhead
 * 
 * This module directly invokes OpenCode and translates its outputs to VFS
 * in real-time, without waiting for task routing decisions.
 */

import { createLogger } from '../utils/logger';
import { agentSessionManager } from './agent-session-manager';

const logger = createLogger('Agent:OpencodeDirect');

interface OpenCodeDirectOptions {
  userId: string;
  conversationId: string;
  task: string;
  onChunk?: (chunk: string) => void;
  onTool?: (toolName: string, args: Record<string, any>, result: any) => void;
}

interface FileChange {
  path: string;
  operation: 'write' | 'patch' | 'delete';
  content?: string;
  language?: string;
}

interface OpenCodeDirectResult {
  success: boolean;
  response: string;
  agent: string;
  fileChanges: FileChange[];
  steps?: any[];
}

/**
 * Run OpenCode directly - bypasses task routing for faster response
 */
export async function runOpenCodeDirect(options: OpenCodeDirectOptions): Promise<OpenCodeDirectResult> {
  const { userId, conversationId, task, onChunk, onTool } = options;

  logger.info('Running OpenCode directly', { userId, conversationId });

  // Create session only when needed (noSandbox: true means cloud sandbox won't be created)
  // OpenCode can run locally without cloud sandbox
  const session = await agentSessionManager.getOrCreateSession(
    userId,
    conversationId,
    { enableMCP: true, enableNullclaw: false, mode: 'opencode', noSandbox: true }
  );

  // Use OpencodeV2Provider directly
  const { OpencodeV2Provider } = await import('../sandbox/providers/opencode-v2-provider');
  const { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } = await import('../mcp');

  const provider = new OpencodeV2Provider({
    session: {
      userId,
      conversationId,
      enableMcp: true,
      enableNullclaw: false,
      workspaceDir: session.workspacePath,
    },
    sandboxHandle: session.sandboxHandle,
  });

  const tools = await getMCPToolsForAI_SDK(userId);
  const fileChanges: FileChange[] = [];

  const result = await provider.runAgentLoop({
    userMessage: task,
    tools: tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
    systemPrompt: process.env.OPENCODE_SYSTEM_PROMPT,
    maxSteps: parseInt(process.env.OPENCODE_MAX_STEPS || '15', 10),
    onStreamChunk: onChunk,
    onToolExecution: (toolName, args, toolResult) => {
      // Track file changes
      if (toolName === 'write_file' || toolName === 'WriteFile' || toolName === 'write') {
        fileChanges.push({
          path: args.path || args.file || args.target || '',
          operation: 'write',
          content: args.content,
        });
      } else if (toolName === 'edit_file' || toolName === 'EditFile' || toolName === 'patch' || toolName === 'edit') {
        fileChanges.push({
          path: args.path || args.file || args.target || '',
          operation: 'patch',
          content: args.content,
        });
      } else if (toolName === 'delete_file' || toolName === 'DeleteFile' || toolName === 'delete') {
        fileChanges.push({
          path: args.path || args.file || args.target || '',
          operation: 'delete',
        });
      }

      onTool?.(toolName, args, toolResult);
    },
    executeTool: async (name, args) => {
      const toolResult = await callMCPToolFromAI_SDK(name, args, userId);
      return {
        success: toolResult.success,
        output: toolResult.output,
        exitCode: toolResult.success ? 0 : 1,
      };
    },
  });

  // Sync from sandbox to VFS
  try {
    const { agentFSBridge } = await import('./agent-fs-bridge');
    await agentFSBridge.syncFromSandbox(userId, conversationId);
  } catch (syncError) {
    logger.warn('Sync from sandbox failed', { error: syncError });
  }

  return {
    success: true,
    response: result.response || '',
    agent: 'opencode',
    fileChanges,
    steps: result.steps,
  };
}
