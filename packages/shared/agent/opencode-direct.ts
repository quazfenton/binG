/**
 * OpenCode Direct - Runs OpenCode with execution policy-based sandbox selection
 *
 * This module invokes OpenCode and translates its outputs to VFS
 * in real-time, with intelligent sandbox selection based on task requirements.
 *
 * Execution Policies:
 * - local-safe: Default, no cloud sandbox
 * - sandbox-required: For bash/file operations
 * - sandbox-heavy: For full-stack apps
 */

import { createLogger } from '../utils/logger';
import { agentSessionManager } from '../session/agent/agent-session-manager';
import type { ExecutionPolicy } from '../sandbox/types';
import { determineExecutionPolicy } from '../sandbox/types';
import type { ToolIntegrationManager } from '@/lib/tools/tool-integration-system';
import { applyPromptModifiers, type PromptParameters } from './prompt-parameters';

const logger = createLogger('Agent:OpencodeDirect');

interface OpenCodeDirectOptions {
  userId: string;
  conversationId: string;
  task: string;
  onChunk?: (chunk: string) => void;
  onTool?: (toolName: string, args: Record<string, any>, result: any) => void;
  /**
   * Execution policy for sandbox selection
   * Auto-detected from task if not specified
   */
  executionPolicy?: ExecutionPolicy;
  /**
   * Tool integration manager for unified tool execution
   * If provided, tools will be executed via ToolIntegrationManager
   */
  toolManager?: ToolIntegrationManager;
  /**
   * Optional prompt parameters to modify response style
   * Applied as a suffix to the base OPENCODE_SYSTEM_PROMPT
   */
  promptParams?: PromptParameters;
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
 * Run OpenCode with execution policy-based sandbox selection
 */
export async function runOpenCodeDirect(options: OpenCodeDirectOptions): Promise<OpenCodeDirectResult> {
  const { userId, conversationId, task, onChunk, onTool, executionPolicy: explicitPolicy, toolManager, promptParams } = options;

  // Auto-detect execution policy from task if not explicitly specified
  const detectedPolicy = explicitPolicy || determineExecutionPolicy({
    task,
    requiresBash: /bash|shell|command|execute|run\s+\w+/i.test(task),
    requiresFileWrite: /write|create|save|edit|modify|delete\s+(file|\w+\.\w+)/i.test(task),
    requiresBackend: /server|api|database|backend|express|fastapi|flask|django/i.test(task),
    requiresGUI: /gui|desktop|browser|electron|tauri/i.test(task),
    isLongRunning: /server|daemon|service|long-running|persistent/i.test(task),
  });

  logger.info('Running OpenCode with execution policy', { userId, conversationId, policy: detectedPolicy });

  // Create session with execution policy
  const session = await agentSessionManager.getOrCreateSession(
    userId,
    conversationId,
    {
      enableMCP: true,
      enableNullclaw: false,
      mode: 'opencode',
      executionPolicy: detectedPolicy,
    }
  );

  // Use OpencodeV2Provider directly
  const { OpencodeV2Provider } = await import('../sandbox/spawn/opencode-cli');
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
    systemPrompt: (process.env.OPENCODE_SYSTEM_PROMPT || '') + applyPromptModifiers(promptParams ?? {}),
    maxSteps: parseInt(process.env.OPENCODE_MAX_STEPS || '15', 10),
    onStreamChunk: onChunk,
    onToolExecution: async (toolName, args, toolResult) => {
      // Use ToolIntegrationManager if provided for unified tool execution
      if (toolManager) {
        try {
          const integratedResult = await toolManager.executeTool(
            toolName,
            args,
            {
              userId,
              conversationId,
              metadata: {
                sessionId: session.id,
                workspacePath: session.workspacePath,
              }
            }
          );
          
          // Call original onTool callback if provided
          if (onTool) {
            onTool(toolName, args, integratedResult);
          }
          
          return integratedResult.output;
        } catch (error: any) {
          logger.error('Tool execution via ToolIntegrationManager failed', { toolName, error: error.message });
          // Fallback to original tool execution
        }
      }
      
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
