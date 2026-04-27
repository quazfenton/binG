import type { SandboxHandle } from '@/lib/sandbox/providers/sandbox-provider';
import type { ToolResult } from './sandbox-tools';
import { createToolExecutorWrapper, type ToolExecution, type TransactionEntry, type ToolExecutorWrapper } from './tool-executor-wrapper';
import { normalizeToolArgs } from '@/lib/orchestra/shared-agent-context';

export type { ToolExecution, TransactionEntry } from './tool-executor-wrapper';

export interface ToolExecutorConfig {
  sandboxHandle?: SandboxHandle;
  vfs?: Record<string, string>;
  transactionLog?: TransactionEntry[];
  enableLogging?: boolean;
  enableMetrics?: boolean;
  userId?: string;
  sessionId?: string;
}

/**
 * ToolExecutor — backward-compatible wrapper around ToolExecutorWrapper.
 * Maps legacy tool names (readFile, createFile, etc.) to capability IDs
 * and delegates to the wrapper for execution through CapabilityRouter.
 *
 * StatefulAgent-specific tools (discovery, plan, commit, rollback, history,
 * requestApproval) are handled locally since they aren't capabilities.
 */
export class ToolExecutor {
  private config: ToolExecutorConfig;
  private wrapper: ToolExecutorWrapper;

  // Tool name → capability ID mapping
  private readonly toolToCapability: Record<string, string> = {
    readFile: 'file.read',
    listFiles: 'file.list',
    createFile: 'file.write',
    applyDiff: 'file.apply_diff',
    astDiff: 'code.ast_diff',
    execShell: 'sandbox.shell',
    syntaxCheck: 'code.syntax_check',
  };

  constructor(config: ToolExecutorConfig) {
    this.config = {
      enableLogging: true,
      enableMetrics: true,
      ...config,
    };

    this.wrapper = createToolExecutorWrapper({
      sandboxHandle: config.sandboxHandle,
      vfs: config.vfs,
      transactionLog: config.transactionLog,
      enableLogging: config.enableLogging,
      enableMetrics: config.enableMetrics,
      userId: config.userId,
      sessionId: config.sessionId,
    });
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();

    // Map legacy camelCase tool names to canonical snake_case names
    const LEGACY_NAME_MAP: Record<string, string> = {
      readFile: 'read_file',
      createFile: 'write_file',
      listFiles: 'list_files',
      applyDiff: 'apply_diff',
    };
    const canonicalName = LEGACY_NAME_MAP[toolName] || toolName;
    // Normalize args to fix common LLM field-name mistakes
    params = normalizeToolArgs(canonicalName, params) as Record<string, any>;

    // Route through wrapper for capability-mapped tools
    const capability = this.toolToCapability[toolName] || this.toolToCapability[canonicalName];
    if (capability) {
      return this.wrapper.execute(capability, params) as Promise<ToolResult>;
    }

    // Handle StatefulAgent-specific tools locally
    try {
      const timeoutMs = this.getToolTimeout(toolName);
      const timeoutPromise = new Promise<ToolResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      const executionPromise = this.executeLocalTool(toolName, params);
      const result = await Promise.race([executionPromise, timeoutPromise]);

      // Record metrics for local tools (wrapper only handles capability-mapped tools)
      if (this.config.enableMetrics) {
        const duration = Date.now() - startTime;
        // Access wrapper's execution log directly via its public API
        const metrics = this.wrapper.getMetrics();
        void metrics; // metrics are available; wrapper tracks capability-mapped tools
        // Log to console for local tools since wrapper doesn't track them
        if (this.config.enableLogging) {
          console.log(`[ToolExecutor] Completed ${toolName} in ${duration}ms`, { success: result.success });
        }
      }

      return result;
    } catch (error: any) {
      console.error(`[ToolExecutor] Failed ${toolName}:`, error.message);
      throw error;
    }
  }

  private async executeLocalTool(toolName: string, params: any): Promise<ToolResult> {
    switch (toolName) {
      case 'requestApproval':
        return {
          success: true,
          output: JSON.stringify({
            requires_approval: true,
            approval_request: {
              id: crypto.randomUUID(),
              ...params,
              requested_at: new Date().toISOString(),
              status: 'pending',
            },
          }),
        };

      case 'discovery':
        return {
          success: true,
          output: `Discovery phase: Analyzing ${params.files_to_analyze?.length || 0} files for task: ${params.proposed_task}`,
        };

      case 'createPlan':
        return {
          success: true,
          output: JSON.stringify({
            version: '1.0',
            created_at: new Date().toISOString(),
            ...params,
          }),
        };

      case 'commit':
        return {
          success: true,
          output: `Commit requested for session ${params.session_id}: ${params.message}`,
        };

      case 'rollback':
        return {
          success: true,
          output: `Rollback requested to commit ${params.commit_id} for session ${params.session_id}`,
        };

      case 'history':
        return {
          success: true,
          output: `History requested for session ${params.session_id}`,
        };

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Apply diff via wrapper's smartApply cascade
   */
  async applyDiff(params: { path: string; search: string; replace: string; thought?: string }): Promise<ToolResult> {
    return this.wrapper.applyDiff(params) as Promise<ToolResult>;
  }

  /**
   * Apply AST-aware diff via wrapper
   */
  async applyAstDiff(params: { path: string; operation: string; nodeSelector: any; newContent?: string; metadata?: any }): Promise<ToolResult> {
    return this.wrapper.applyAstDiff(params) as Promise<ToolResult>;
  }

  /**
   * Get tool-specific timeout
   */
  private getToolTimeout(toolName: string): number {
    const timeouts: Record<string, number> = {
      readFile: 5000,
      listFiles: 5000,
      createFile: 10000,
      applyDiff: 15000,
      astDiff: 15000,
      execShell: 120000,
      syntaxCheck: 30000,
      discovery: 60000,
      createPlan: 30000,
      commit: 30000,
      rollback: 30000,
      default: 60000,
    };
    return timeouts[toolName] || timeouts.default;
  }

  // Delegate metrics/logging to wrapper
  getExecutionLog(): ToolExecution[] {
    return this.wrapper.getExecutionLog();
  }

  getMetrics(): {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageDuration: number;
    byTool: Record<string, { count: number; success: number; failed: number; avgDuration: number }>;
  } {
    return this.wrapper.getMetrics();
  }

  clearLog(): void {
    this.wrapper.clearLog();
  }

  clearHealthCache(): void {
    this.wrapper.clearHealthCache();
  }
}

export function createToolExecutor(config: ToolExecutorConfig): ToolExecutor {
  return new ToolExecutor(config);
}
