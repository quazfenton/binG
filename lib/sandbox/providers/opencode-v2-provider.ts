/**
 * Enhanced OpenCode Containerized Provider with V2 Support
 * 
 * Features:
 * - Per-user session isolation via OpenCodeV2SessionManager
 * - Nullclaw integration for extended agency
 * - MCP tool bridging
 * - Cloud filesystem support
 * - Checkpoint/restore capabilities
 * 
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │           OpenCodeContainerizedProvider                     │
 * │  ┌─────────────────────────────────────────────────────┐  │
 * │  │  Session Layer (OpenCodeV2SessionManager)            │  │
 * │  │  - Per-user workspaces                              │  │
 * │  │  - Quota tracking                                   │  │
 * │  │  - Checkpoint management                            │  │
 * │  └─────────────────────────────────────────────────────┘  │
 * │  ┌─────────────────────────────────────────────────────┐  │
 * │  │  Sandbox Layer (getSandboxProvider)                 │  │
 * │  │  - Sprites/E2B/Daytona/CodeSandbox                 │  │
 * │  │  - Isolated execution                               │  │
 * │  └─────────────────────────────────────────────────────┘  │
 * │  ┌─────────────────────────────────────────────────────┐  │
 * │  │  Tool Layer                                          │  │
 * │  │  - MCP Bridge (localhost:8888)                     │  │
 * │  │  - Nullclaw Bridge                                  │  │
 * │  │  - Local file operations                            │  │
 * │  └─────────────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────┘
 */

import { spawn, type ChildProcess } from 'child_process';
import { createLogger } from '../../utils/logger';
import type { ToolResult } from '../types';
import type {
  LLMProvider,
  LLMAgentOptions,
  LLMAgentResult,
  LLMAgentStep,
} from './llm-provider';
import { getSandboxProvider } from '.';
import type { SandboxHandle, SandboxCreateConfig } from './sandbox-provider';
import { openCodeV2SessionManager, type V2SessionConfig, type OpenCodeV2Session } from '../../api/opencode-v2-session-manager';
import { nullclawMCPBridge } from '../../mcp/nullclaw-mcp-bridge';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('OpenCode:V2Provider');

const DEFAULT_MAX_STEPS = 15;
const PROCESS_TIMEOUT_MS = 300_000; // 5 minutes

export interface OpenCodeV2ProviderConfig {
  session?: {
    userId: string;
    conversationId: string;
    enableNullclaw?: boolean;
    enableMcp?: boolean;
    cloudFsProvider?: 'sprites' | 'e2b' | 'daytona' | 'local';
    workspaceDir?: string;
  };
  sandbox?: Partial<SandboxCreateConfig>;
  sandboxHandle?: SandboxHandle;
  opencode?: {
    model?: string;
    maxSteps?: number;
    timeout?: number;
  };
}

export interface OpenCodeV2ExecutionResult extends LLMAgentResult {
  sessionId?: string;
  quotaUsed?: {
    computeMinutes: number;
    storageBytes: number;
  };
  nullclawTasks?: Array<{
    tool: string;
    status: string;
    result?: any;
  }>;
}

export class OpencodeV2Provider implements LLMProvider {
  readonly name = 'opencode-v2';
  private config: OpenCodeV2ProviderConfig;
  private currentSession?: OpenCodeV2Session;
  private sandboxHandle?: SandboxHandle;
  private mcpServerProcess?: ChildProcess;

  constructor(config: OpenCodeV2ProviderConfig = {}) {
    this.config = config;
  }

  /**
   * Run the V2 agent loop with full session management
   */
  async runAgentLoop(options: LLMAgentOptions): Promise<OpenCodeV2ExecutionResult> {
    const startTime = Date.now();
    const {
      userMessage,
      tools,
      systemPrompt,
      maxSteps = DEFAULT_MAX_STEPS,
      executeTool,
      onToolExecution,
      onStreamChunk,
    } = options;

    // Get or create session
    if (!this.currentSession) {
      await this.initializeSession();
    }

    if (!this.currentSession) {
      return {
        response: 'Failed to initialize V2 session',
        steps: [],
        totalSteps: 0,
      };
    }

    const steps: LLMAgentStep[] = [];
    let finalResponse = '';

    try {
      // Ensure sandbox is ready
      if (!this.sandboxHandle) {
        await this.initializeSandbox();
      }

      if (!this.sandboxHandle) {
        return {
          response: 'Failed to initialize sandbox',
          steps,
          totalSteps: steps.length,
          sessionId: this.currentSession.id,
        };
      }

      // Ensure MCP is available
      if (this.currentSession.mcpEnabled && !this.currentSession.mcpServerUrl) {
        await this.initializeMCP();
      }

      // Write the prompt to a temp file
      const promptPayload = JSON.stringify({
        prompt: userMessage,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        systemPrompt: systemPrompt,
        sessionId: this.currentSession.id,
        mcpServerUrl: this.currentSession.mcpServerUrl,
      });

      const promptFile = `/tmp/opencode-v2-prompt-${Date.now()}.json`;
      await this.sandboxHandle.writeFile(promptFile, promptPayload);

      // Execute opencode in the sandbox
      const model = process.env.OPENCODE_MODEL || 'claude-3-5-sonnet';
      const modelFlag = model ? `--model '${model.replace(/'/g, "'\\''")}'` : '';
      
      const result = await this.sandboxHandle.executeCommand(
        `OPENCODE_SYSTEM_PROMPT='${(systemPrompt || '').replace(/'/g, "'\\''")}' cat ${promptFile} | opencode chat --json ${modelFlag}`.trim(),
        this.currentSession.workspaceDir,
        PROCESS_TIMEOUT_MS / 1000,
      );

      const nullclawTasks: Array<{ tool: string; status: string; result?: any }> = [];

      if (result.success) {
        // Parse output and execute tools
        const lines = result.output.split('\n').filter(Boolean);
        
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            
            // Text response
            if (parsed.text) {
              finalResponse += parsed.text;
              onStreamChunk?.(parsed.text);
            }

            // Tool invocation
            const toolInvocation = this.extractToolInvocation(parsed);
            if (toolInvocation && steps.length < maxSteps) {
              const { name: toolName, args: toolArgs } = toolInvocation;

              // Check if it's a Nullclaw tool
              if (toolName.startsWith('nullclaw_')) {
                const nullclawResult = await nullclawMCPBridge.executeTool(
                  toolName,
                  toolArgs,
                  this.currentSession.id
                );
                
                nullclawTasks.push({
                  tool: toolName,
                  status: nullclawResult.success ? 'completed' : 'failed',
                  result: nullclawResult,
                });

                const toolResult: ToolResult = {
                  success: nullclawResult.success,
                  output: nullclawResult.output,
                  exitCode: nullclawResult.success ? 0 : 1,
                };

                steps.push({ toolName, args: toolArgs, result: toolResult });
                onToolExecution?.(toolName, toolArgs, toolResult);
              } else {
                // Standard tool execution
                let toolResult: ToolResult;
                try {
                  toolResult = await executeTool(toolName, toolArgs ?? {});
                } catch (err) {
                  toolResult = {
                    success: false,
                    output: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
                    exitCode: 1,
                  };
                }

                steps.push({ toolName, args: toolArgs ?? {}, result: toolResult });
                onToolExecution?.(toolName, toolArgs ?? {}, toolResult);

                // Record metrics
                openCodeV2SessionManager.recordMetrics(
                  this.currentSession.id,
                  1,
                  0,
                  0,
                  Date.now() - startTime
                );
              }
            }

            // Completion
            if (parsed.done || parsed.complete) {
              finalResponse = parsed.response ?? parsed.text ?? finalResponse;
            }
          } catch {
            // Non-JSON line
            finalResponse += line + '\n';
            onStreamChunk?.(line + '\n');
          }
        }
      } else {
        finalResponse = `Execution failed: ${result.output}`;
      }

      // Update session activity
      openCodeV2SessionManager.updateActivity(this.currentSession.id);

      return {
        response: finalResponse || 'No response from V2 agent',
        steps,
        totalSteps: steps.length,
        sessionId: this.currentSession.id,
        quotaUsed: {
          computeMinutes: this.currentSession.quota.computeUsed,
          storageBytes: this.currentSession.quota.storageUsed,
        },
        nullclawTasks,
      };

    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('V2 agent loop failed', error);

      return {
        response: `V2 execution error: ${errorMsg}`,
        steps,
        totalSteps: steps.length,
        sessionId: this.currentSession.id,
      };
    }
  }

  /**
   * Initialize session
   */
  private async initializeSession(): Promise<void> {
    if (!this.config.session) {
      throw new Error('Session config required for V2 provider');
    }

    const sessionConfig: V2SessionConfig = {
      userId: this.config.session.userId,
      conversationId: this.config.session.conversationId,
      enableNullclaw: this.config.session.enableNullclaw,
      enableMcp: this.config.session.enableMcp,
      cloudFsProvider: this.config.session.cloudFsProvider,
      workspaceDir: this.config.session.workspaceDir,
    };

    this.currentSession = await openCodeV2SessionManager.createSession(sessionConfig);
    logger.info(`Initialized V2 session: ${this.currentSession.id}`);
  }

  /**
   * Initialize sandbox for session
   */
  private async initializeSandbox(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('Session not initialized');
    }

    if (this.config.sandboxHandle) {
      this.sandboxHandle = this.config.sandboxHandle;
      openCodeV2SessionManager.setSandbox(
        this.currentSession.id,
        this.sandboxHandle.id,
        this.currentSession.sandboxProvider || 'external',
      );
      return;
    }

    // Determine provider based on config or availability
    let providerName = this.config.session?.cloudFsProvider || 'sprites';
    
    // Check if provider is available
    try {
      this.sandboxHandle = await this.createSandboxForSession(providerName);
      openCodeV2SessionManager.setSandbox(
        this.currentSession.id,
        this.sandboxHandle.id,
        providerName
      );
    } catch (error) {
      // Fallback to other providers
      const providers = ['e2b', 'daytona', 'codesandbox'];
      for (const provider of providers) {
        try {
          this.sandboxHandle = await this.createSandboxForSession(provider);
          openCodeV2SessionManager.setSandbox(
            this.currentSession.id,
            this.sandboxHandle.id,
            provider
          );
          break;
        } catch {
          continue;
        }
      }
    }

    if (!this.sandboxHandle) {
      throw new Error('No sandbox provider available');
    }

    // Ensure opencode is installed
    await this.sandboxHandle.executeCommand(
      'which opencode || npm install -g opencode-ai 2>/dev/null || echo "opencode not available"'
    );

    logger.info(`Sandbox initialized: ${this.sandboxHandle.id}`);
  }

  /**
   * Create sandbox for session
   */
  private async createSandboxForSession(provider: string): Promise<SandboxHandle> {
    const sandboxProvider = await getSandboxProvider(provider as any);
    const config: SandboxCreateConfig = {
      language: 'typescript',
      envVars: {
        OPENCODE_MODEL: process.env.OPENCODE_MODEL || 'claude-3-5-sonnet',
        OPENCODE_SYSTEM_PROMPT: '',
        TERM: 'xterm-256color',
        ...this.config.sandbox?.envVars,
      },
      resources: this.config.sandbox?.resources || { cpu: 2, memory: 4 },
    };

    return sandboxProvider.createSandbox(config);
  }

  /**
   * Initialize MCP server for session
   */
  private async initializeMCP(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('Session not initialized');
    }

    const port = parseInt(process.env.MCP_CLI_PORT || '8888', 10);
    this.currentSession.mcpServerUrl = `http://127.0.0.1:${port}`;
    
    logger.info(`MCP server URL set: ${this.currentSession.mcpServerUrl}`);
  }

  /**
   * Extract tool invocation from parsed output
   */
  private extractToolInvocation(
    parsed: any
  ): { name: string; args: Record<string, any> } | null {
    if (!parsed || typeof parsed !== 'object') return null;

    // OpenCode/OpenAI-style payload
    if (parsed.tool_call) {
      const call = parsed.tool_call;
      if (call?.name) {
        return {
          name: String(call.name),
          args: (call.arguments ?? {}) as Record<string, any>,
        };
      }
    }

    // Anthropic-style payload
    if (parsed.tool_use) {
      const toolUse = parsed.tool_use;
      if (toolUse?.name) {
        return {
          name: String(toolUse.name),
          args: (toolUse.input ?? {}) as Record<string, any>,
        };
      }
    }

    return null;
  }

  /**
   * Create checkpoint for current session
   */
  async createCheckpoint(label?: string): Promise<{
    checkpointId: string;
    timestamp: number;
  }> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    return openCodeV2SessionManager.createCheckpoint(this.currentSession.id, label);
  }

  /**
   * Get current session info
   */
  getSessionInfo(): OpenCodeV2Session | undefined {
    return this.currentSession;
  }

  /**
   * Shutdown provider and cleanup resources
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down V2 provider...');

    if (this.sandboxHandle) {
      try {
        const { getSandboxProvider } = await import('.');
        const provider = await getSandboxProvider(this.sandboxHandle.id.startsWith('sprite') ? 'sprites' : 
          this.sandboxHandle.id.startsWith('daytona') ? 'daytona' :
          this.sandboxHandle.id.startsWith('e2b') ? 'e2b' : 'codesandbox');
        await provider.destroySandbox(this.sandboxHandle.id);
      } catch (error: any) {
        logger.error('Failed to destroy sandbox', error);
      }
    }

    if (this.mcpServerProcess) {
      this.mcpServerProcess.kill();
    }

    if (this.currentSession) {
      await openCodeV2SessionManager.stopSession(this.currentSession.id);
    }

    logger.info('V2 provider shutdown complete');
  }
}

/**
 * Factory function to create V2 provider
 */
export function createOpenCodeV2Provider(config: OpenCodeV2ProviderConfig): OpencodeV2Provider {
  return new OpencodeV2Provider(config);
}
