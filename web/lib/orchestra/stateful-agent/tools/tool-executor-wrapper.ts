/**
 * StatefulAgent Tool Executor Wrapper
 *
 * Wraps CapabilityRouter with StatefulAgent-specific policies:
 * - Sandbox health check with 5s TTL cache
 * - Per-tool timeout enforcement
 * - Transaction logging (VFS-aware mutation audit trail)
 * - smartApply cascade with LLM repair
 * - AST-aware diff for TS/JS
 * - Command security patterns
 * - Execution metrics/analytics
 *
 * File/sandbox operations route through CapabilityRouter.
 * StatefulAgent-specific tools (discovery, plan, commit, rollback, history, approval)
 * are handled locally.
 */

import { getCapabilityRouter } from '@/lib/tools/router';
import { smartApply } from '@/lib/chat/file-diff-utils';
import { createLogger } from '@/lib/utils/logger';
import type { SandboxHandle } from '@/lib/sandbox/providers/sandbox-provider';

const log = createLogger('ToolExecutor:Wrapper');

export interface ToolExecution {
  toolName: string;
  parameters: Record<string, any>;
  result: any;
  duration: number;
  error?: Error;
  timestamp: Date;
}

export interface TransactionEntry {
  path: string;
  type: 'UPDATE' | 'CREATE' | 'DELETE';
  timestamp: number;
  originalContent?: string;
  newContent?: string;
  search?: string;
  replace?: string;
}

export interface ToolExecutorWrapperConfig {
  sandboxHandle?: SandboxHandle;
  vfs?: Record<string, string>;
  transactionLog?: TransactionEntry[];
  enableLogging?: boolean;
  enableMetrics?: boolean;
  userId?: string;
  sessionId?: string;
}

export class ToolExecutorWrapper {
  private sandboxHandle?: SandboxHandle;
  private vfs: Record<string, string>;
  private transactionLog: TransactionEntry[];
  private executionLog: ToolExecution[] = [];
  private enableLogging: boolean;
  private enableMetrics: boolean;
  private userId?: string;
  private sessionId?: string;

  // Health check cache
  private healthCheckCache = new Map<string, { healthy: boolean; error?: string; timestamp: number }>();
  private readonly HEALTH_CHECK_TTL = 5000;

  // Per-tool timeouts
  private readonly timeouts: Record<string, number> = {
    'file.read': 5000,
    'file.list': 5000,
    'file.write': 10000,
    'file.apply_diff': 15000,
    'code.ast_diff': 15000,
    'sandbox.shell': 120000,
    'code.syntax_check': 30000,
    'workflow.discovery': 60000,
    'workflow.plan': 30000,
    'workflow.commit': 30000,
    'workflow.rollback': 30000,
    'default': 60000,
  };

  // Blocked command patterns
  private readonly blockedPatterns = [
    /^rm\s+-rf\s+\/$/,
    /^mkfs/,
    /^dd\s+if=/,
    /:\(\)\{\s*:\|\:&\s*\};:/,
    /\/dev\/(sd|hd)[a-z]/,
  ];

  constructor(config: ToolExecutorWrapperConfig) {
    this.sandboxHandle = config.sandboxHandle;
    this.vfs = config.vfs || {};
    this.transactionLog = config.transactionLog || [];
    this.enableLogging = config.enableLogging ?? true;
    this.enableMetrics = config.enableMetrics ?? true;
    this.userId = config.userId;
    this.sessionId = config.sessionId;
  }

  /**
   * Execute a capability with all StatefulAgent policies enforced
   */
  async execute(
    capabilityId: string,
    args: Record<string, any>,
  ): Promise<any> {
    const startTime = Date.now();
    const timestamp = new Date();

    try {
      // Health check (skip for lightweight ops)
      const lightweightOps = ['file.read', 'file.list', 'workflow.history'];
      if (!lightweightOps.includes(capabilityId) && this.sandboxHandle) {
        const health = await this.checkSandboxHealth();
        if (!health.healthy) {
          return { success: false, error: health.error || 'Sandbox unhealthy', blocked: true };
        }
      }

      // Command security for shell capabilities
      if (capabilityId === 'sandbox.shell' && args.command) {
        const blocked = this.isCommandBlocked(args.command);
        if (blocked) {
          return { success: false, error: `Blocked dangerous command: ${args.command}`, blocked: true };
        }
      }

      // Timeout enforcement
      const timeoutMs = this.timeouts[capabilityId] || this.timeouts.default;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Capability ${capabilityId} timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      const executionPromise = this.executeCapability(capabilityId, args);
      const result = await Promise.race([executionPromise, timeoutPromise]);

      const duration = Date.now() - startTime;

      if (this.enableMetrics) {
        this.executionLog.push({
          toolName: capabilityId,
          parameters: args,
          result,
          duration,
          timestamp,
        });
      }

      if (this.enableLogging) {
        log.debug(`Completed ${capabilityId} in ${duration}ms`, { success: result.success });
      }

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const executionError = error instanceof Error ? error : new Error(String(error));

      if (this.enableMetrics) {
        this.executionLog.push({
          toolName: capabilityId,
          parameters: args,
          result: { success: false, error: executionError.message },
          duration,
          error: executionError,
          timestamp,
        });
      }

      log.error(`Failed ${capabilityId}: ${executionError.message}`);
      throw error;
    }
  }

  /**
   * Execute a capability through the CapabilityRouter
   */
  private async executeCapability(capabilityId: string, args: Record<string, any>): Promise<any> {
    const router = getCapabilityRouter();

    try {
      const result = await router.execute(capabilityId, args, {
        userId: this.userId,
        sessionId: this.sessionId,
      });

      // Log file mutations to transaction log
      if (result.success && args.path) {
        this.logTransaction(capabilityId, args, result);
      }

      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Apply a search/replace diff with smartApply cascade
   */
  async applyDiff(params: {
    path: string;
    search: string;
    replace: string;
    thought?: string;
  }): Promise<any> {
    const startTime = Date.now();
    const { path, search, replace } = params;

    // Get current content
    const currentContent = await this.getFileContent(path);
    if (!currentContent.success) {
      return currentContent;
    }

    const content = currentContent.content!;

    // Try exact match first
    if (content.includes(search)) {
      // Check for multiple occurrences
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const occurrenceCount = (content.match(new RegExp(escapedSearch, 'g')) || []).length;
      if (occurrenceCount > 1) {
        return {
          success: false,
          error: `Search pattern found ${occurrenceCount} times in ${path}. Make the search pattern more specific.`,
          blocked: true,
          hint: 'Include 3-5 lines of surrounding context to make the search pattern unique.',
        };
      }

      const newContent = content.replace(search, replace);
      return this.writeFile(path, newContent, { originalContent: content, search, replace });
    }

    // Fall back to smartApply cascade: unified diff → fuzzy → line → symbol → LLM repair
    const diff = `--- ${path}\n+++ ${path}\n@@\n-${search.replace(/\n/g, '\n-')}\n+${replace.replace(/\n/g, '\n+')}`;
    const patchResult = await smartApply({
      content,
      path,
      diff,
      llm: async (prompt: string): Promise<string> => {
        try {
          const { llmService } = await import('@/lib/chat/llm-providers');
          const response = await llmService.generateResponse({
            provider: 'openai',
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            maxTokens: 4000,
          });
          return response.content || '';
        } catch {
          return '';
        }
      },
    });

    if (patchResult.content !== null && patchResult.content !== content) {
      return this.writeFile(path, patchResult.content, {
        originalContent: content,
        newContent: patchResult.content,
        search,
        replace,
        metadata: { strategy: patchResult.strategy, confidence: patchResult.confidence, attempts: patchResult.attempts },
      });
    }

    return {
      success: false,
      error: `Search pattern not found in ${path}. Use read_file to get current content and ensure exact whitespace matching.`,
      blocked: true,
      hint: 'Use read_file to get the current content and ensure exact whitespace matching.',
    };
  }

  /**
   * Apply AST-aware diff for TS/JS files
   */
  async applyAstDiff(params: {
    path: string;
    operation: string;
    nodeSelector: any;
    newContent?: string;
    metadata?: any;
  }): Promise<any> {
    const startTime = Date.now();
    const { path, operation, nodeSelector, newContent, metadata } = params;

    // Get current content
    const currentContent = await this.getFileContent(path);
    if (!currentContent.success) {
      return currentContent;
    }

    // Only TS/JS
    const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx'];
    const fileExt = path.split('.').pop()?.toLowerCase();
    if (!fileExt || !supportedExtensions.includes(fileExt)) {
      return {
        success: false,
        error: `AST diff only supports TypeScript/JavaScript files. Got: ${fileExt}`,
        hint: 'Use apply_diff for non-TypeScript/JavaScript files',
      };
    }

    try {
      const { AstDiffManager } = await import('./ast-aware-diff');
      const manager = new AstDiffManager();

      const result = await manager.applyAstDiff(path, currentContent.content!, {
        path,
        operation: operation as any,
        nodeSelector,
        newContent,
        metadata,
      });

      if (result.success) {
        // Update VFS
        if (this.vfs) {
          this.vfs[path] = result.updatedContent;
        }

        // Update sandbox if available
        if (this.sandboxHandle) {
          await this.sandboxHandle.writeFile(path, result.updatedContent);
        }

        // Log transaction
        this.transactionLog.push({
          path,
          type: 'UPDATE',
          timestamp: Date.now(),
          originalContent: currentContent.content!,
          newContent: result.updatedContent,
        });

        return {
          success: true,
          output: `AST diff applied: ${result.changes.map((c: any) => c.type).join(', ')}. ${metadata?.reason || ''}`,
          content: result.updatedContent,
        };
      }

      return {
        success: false,
        error: result.errors?.join(', ') || 'AST diff failed',
        blocked: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `AST diff execution failed: ${error.message}`,
      };
    }
  }

  /**
   * Check sandbox health with caching
   */
  private async checkSandboxHealth(): Promise<{ healthy: boolean; error?: string }> {
    const sandboxId = this.sandboxHandle?.id || 'default';
    const cached = this.healthCheckCache.get(sandboxId);

    if (cached && Date.now() - cached.timestamp < this.HEALTH_CHECK_TTL) {
      return { healthy: cached.healthy, error: cached.error };
    }

    if (!this.sandboxHandle) {
      const result = { healthy: true };
      this.healthCheckCache.set(sandboxId, { ...result, timestamp: Date.now() });
      return result;
    }

    try {
      const { checkSandboxHealth: checkHealth } = await import('@/lib/management/sandbox-health');
      const result = await checkHealth(this.sandboxHandle);
      const healthResult = { healthy: result.healthy, error: result.error };
      this.healthCheckCache.set(sandboxId, { ...healthResult, timestamp: Date.now() });
      return healthResult;
    } catch (error: any) {
      const healthResult = { healthy: false, error: error.message };
      this.healthCheckCache.set(sandboxId, { ...healthResult, timestamp: Date.now() });
      return healthResult;
    }
  }

  clearHealthCache(): void {
    const sandboxId = this.sandboxHandle?.id || 'default';
    this.healthCheckCache.delete(sandboxId);
  }

  /**
   * Check if a command is blocked
   */
  private isCommandBlocked(command: string): boolean {
    return this.blockedPatterns.some(pattern => pattern.test(command));
  }

  /**
   * Get file content from sandbox or VFS
   */
  private async getFileContent(path: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (this.sandboxHandle) {
      const readResult = await this.sandboxHandle.readFile(path);
      if (!readResult.success || !readResult.content) {
        return { success: false, error: readResult.error || `Failed to read file: ${path}` };
      }
      return { success: true, content: readResult.content };
    }

    const content = this.vfs?.[path];
    if (content === undefined) {
      return { success: false, error: `File not found in VFS: ${path}` };
    }
    return { success: true, content };
  }

  /**
   * Write file and log transaction
   */
  private async writeFile(
    path: string,
    content: string,
    options?: {
      originalContent?: string;
      newContent?: string;
      search?: string;
      replace?: string;
      metadata?: any;
    }
  ): Promise<any> {
    // Update VFS
    if (this.vfs) {
      this.vfs[path] = content;
    }

    // Update sandbox if available
    if (this.sandboxHandle) {
      const result = await this.sandboxHandle.writeFile(path, content);
      if (result.success) {
        this.transactionLog.push({
          path,
          type: 'UPDATE',
          timestamp: Date.now(),
          originalContent: options?.originalContent,
          newContent: options?.newContent || content,
          search: options?.search,
          replace: options?.replace,
        });
      }
      return {
        success: result.success,
        output: `Applied diff to ${path}${options?.metadata ? ` via ${options.metadata.strategy} strategy (confidence: ${(options.metadata.confidence * 100).toFixed(0)}%)` : ''}`,
        content,
        metadata: options?.metadata,
      };
    }

    // VFS only
    this.transactionLog.push({
      path,
      type: 'UPDATE',
      timestamp: Date.now(),
      originalContent: options?.originalContent,
      newContent: options?.newContent || content,
      search: options?.search,
      replace: options?.replace,
    });

    return {
      success: true,
      output: `Applied diff to ${path}${options?.metadata ? ` via ${options.metadata.strategy} strategy (confidence: ${(options.metadata.confidence * 100).toFixed(0)}%)` : ''}`,
      content,
      metadata: options?.metadata,
    };
  }

  /**
   * Log file mutations to transaction log
   */
  private logTransaction(
    capabilityId: string,
    args: Record<string, any>,
    result: any,
  ): void {
    if (!result.success) return;

    const writeCapabilities = ['file.write', 'file.append'];
    if (writeCapabilities.includes(capabilityId) && args.path) {
      this.transactionLog.push({
        path: args.path,
        type: 'CREATE',
        timestamp: Date.now(),
        newContent: args.content,
      });
    }
  }

  /**
   * Execution metrics
   */
  getMetrics(): {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageDuration: number;
    byTool: Record<string, { count: number; success: number; failed: number; avgDuration: number }>;
  } {
    const byTool: Record<string, { count: number; success: number; failed: number; totalDuration: number }> = {};

    for (const exec of this.executionLog) {
      if (!byTool[exec.toolName]) {
        byTool[exec.toolName] = { count: 0, success: 0, failed: 0, totalDuration: 0 };
      }
      byTool[exec.toolName].count++;
      byTool[exec.toolName].totalDuration += exec.duration;
      if (exec.result.success) {
        byTool[exec.toolName].success++;
      } else {
        byTool[exec.toolName].failed++;
      }
    }

    const totalExecutions = this.executionLog.length;
    const successfulExecutions = this.executionLog.filter(e => e.result.success).length;
    const failedExecutions = totalExecutions - successfulExecutions;
    const averageDuration =
      totalExecutions > 0
        ? this.executionLog.reduce((sum, e) => sum + e.duration, 0) / totalExecutions
        : 0;

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      averageDuration,
      byTool: Object.entries(byTool).reduce(
        (acc, [name, data]) => ({
          ...acc,
          [name]: {
            count: data.count,
            success: data.success,
            failed: data.failed,
            avgDuration: data.count > 0 ? data.totalDuration / data.count : 0,
          },
        }),
        {} as Record<string, { count: number; success: number; failed: number; avgDuration: number }>
      ),
    };
  }

  getExecutionLog(): ToolExecution[] {
    return [...this.executionLog];
  }

  clearLog(): void {
    this.executionLog = [];
  }

  /**
   * Get transaction log
   */
  getTransactionLog(): TransactionEntry[] {
    return [...this.transactionLog];
  }
}

export function createToolExecutorWrapper(config: ToolExecutorWrapperConfig): ToolExecutorWrapper {
  return new ToolExecutorWrapper(config);
}
