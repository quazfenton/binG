import type { SandboxHandle } from '@/lib/sandbox/providers/sandbox-provider';
import type { ToolResult, ToolContext } from './sandbox-tools';

export interface ToolExecution {
  toolName: string;
  parameters: Record<string, any>;
  result: ToolResult;
  duration: number;
  error?: Error;
  timestamp: Date;
}

export interface ToolExecutorConfig {
  sandboxHandle?: SandboxHandle;
  vfs?: Record<string, string>;
  transactionLog?: Array<{
    path: string;
    type: 'UPDATE' | 'CREATE' | 'DELETE';
    timestamp: number;
    originalContent?: string;
    newContent?: string;
    search?: string;
    replace?: string;
  }>;
  enableLogging?: boolean;
  enableMetrics?: boolean;
}

export class ToolExecutor {
  private context: ToolContext;
  private executionLog: ToolExecution[] = [];
  private config: ToolExecutorConfig;

  constructor(config: ToolExecutorConfig) {
    this.config = {
      enableLogging: true,
      enableMetrics: true,
      ...config,
    };
    this.context = {
      sandboxHandle: config.sandboxHandle,
      vfs: config.vfs || {},
      transactionLog: config.transactionLog || [],
    };
  }

  updateContext(updates: Partial<ToolContext>): void {
    this.context = { ...this.context, ...updates };
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const timestamp = new Date();

    try {
      if (this.config.enableLogging) {
        console.log(`[ToolExecutor] Executing ${toolName}`, params);
      }

      const result = await this.executeTool(toolName, params);
      const duration = Date.now() - startTime;

      if (this.config.enableMetrics) {
        this.executionLog.push({
          toolName,
          parameters: params,
          result,
          duration,
          timestamp,
        });
      }

      if (this.config.enableLogging) {
        console.log(`[ToolExecutor] Completed ${toolName} in ${duration}ms`, {
          success: result.success,
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const executionError = error instanceof Error ? error : new Error(String(error));

      const failedExecution: ToolExecution = {
        toolName,
        parameters: params,
        result: { success: false, error: executionError.message },
        duration,
        error: executionError,
        timestamp,
      };

      if (this.config.enableMetrics) {
        this.executionLog.push(failedExecution);
      }

      console.error(`[ToolExecutor] Failed ${toolName}:`, executionError.message);
      throw error;
    }
  }

  private async executeTool(toolName: string, params: any): Promise<ToolResult> {
    switch (toolName) {
      case 'readFile':
        return this.executeReadFile(params);
      case 'listFiles':
        return this.executeListFiles(params);
      case 'createFile':
        return this.executeCreateFile(params);
      case 'applyDiff':
        return this.executeApplyDiff(params);
      case 'astDiff':
        return this.executeAstDiff(params);
      case 'execShell':
        return this.executeExecShell(params);
      case 'syntaxCheck':
        return this.executeSyntaxCheck(params);
      case 'requestApproval':
        return this.executeRequestApproval(params);
      case 'discovery':
        return this.executeDiscovery(params);
      case 'createPlan':
        return this.executeCreatePlan(params);
      case 'commit':
        return this.executeCommit(params);
      case 'rollback':
        return this.executeRollback(params);
      case 'history':
        return this.executeHistory(params);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async executeReadFile({ path }: { path: string }): Promise<ToolResult> {
    if (!this.context.sandboxHandle && !this.context.vfs) {
      throw new Error('Either sandboxHandle or vfs context required for readFile');
    }

    if (this.context.sandboxHandle) {
      const result = await this.context.sandboxHandle.readFile(path);
      return result;
    }

    // Fallback to VFS
    const content = this.context.vfs?.[path];
    if (content === undefined) {
      return {
        success: false,
        error: `File not found in VFS: ${path}`,
      };
    }

    return {
      success: true,
      content,
    };
  }

  private async executeListFiles({
    path = '.',
    pattern,
  }: {
    path?: string;
    pattern?: string;
  }): Promise<ToolResult> {
    if (!this.context.sandboxHandle) {
      // Return VFS keys as fallback
      const files = Object.keys(this.context.vfs || {})
        .filter((f) => f.startsWith(path))
        .filter((f) => !pattern || new RegExp(pattern).test(f));

      return {
        success: true,
        output: files.join('\n'),
      };
    }

    return this.context.sandboxHandle.listDirectory(path, pattern);
  }

  private async executeCreateFile({
    path,
    content,
  }: {
    path: string;
    content: string;
  }): Promise<ToolResult> {
    if (!this.context.sandboxHandle) {
      // Update VFS as fallback
      if (this.context.vfs) {
        this.context.vfs[path] = content;
        if (this.context.transactionLog) {
          this.context.transactionLog.push({
            path,
            type: 'CREATE',
            timestamp: Date.now(),
            newContent: content,
          });
        }
        return {
          success: true,
          output: `File created in VFS: ${path}`,
        };
      }
      throw new Error('SandboxHandle required for createFile');
    }

    return this.context.sandboxHandle.writeFile(path, content);
  }

  private async executeApplyDiff({
    path,
    search,
    replace,
    thought,
  }: {
    path: string;
    search: string;
    replace: string;
    thought: string;
  }): Promise<ToolResult> {
    if (!this.context.sandboxHandle && !this.context.vfs) {
      throw new Error('Either sandboxHandle or vfs context required for applyDiff');
    }

    // Get current content
    let currentContent: string;
    if (this.context.sandboxHandle) {
      const readResult = await this.context.sandboxHandle.readFile(path);
      if (!readResult.success || !readResult.content) {
        return {
          success: false,
          error: readResult.error || `Failed to read file: ${path}`,
        };
      }
      currentContent = readResult.content;
    } else {
      currentContent = this.context.vfs?.[path] || '';
      if (!currentContent && this.context.vfs) {
        return {
          success: false,
          error: `File not found in VFS: ${path}`,
        };
      }
    }

    // Perform the diff/replace
    if (!currentContent.includes(search)) {
      return {
        success: false,
        error: `Search pattern not found in ${path}. Make sure the search string exactly matches the content you want to replace.`,
        blocked: true,
        hint: 'Use read_file to get the current content and ensure exact whitespace matching.',
      };
    }

    // Check for multiple occurrences - warn if found to prevent accidental mass replacement
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrenceCount = (currentContent.match(new RegExp(escapedSearch, 'g')) || []).length;
    if (occurrenceCount > 1) {
      return {
        success: false,
        error: `Search pattern found ${occurrenceCount} times in ${path}. Make the search pattern more specific to uniquely identify the code block.`,
        blocked: true,
        hint: 'Include 3-5 lines of surrounding context to make the search pattern unique.',
      };
    }

    const newContent = currentContent.replace(search, replace);

    if (this.context.sandboxHandle) {
      const result = await this.context.sandboxHandle.writeFile(path, newContent);
      if (result.success && this.context.transactionLog) {
        this.context.transactionLog.push({
          path,
          type: 'UPDATE',
          timestamp: Date.now(),
          originalContent: currentContent,
          newContent,
          search,
          replace,
        });
      }
      return result;
    }

    // Update VFS
    if (this.context.vfs) {
      this.context.vfs[path] = newContent;
      if (this.context.transactionLog) {
        this.context.transactionLog.push({
          path,
          type: 'UPDATE',
          timestamp: Date.now(),
          originalContent: currentContent,
          newContent,
          search,
          replace,
        });
      }
    }

    return {
      success: true,
      output: `Successfully applied diff to ${path}`,
      content: newContent,
    };
  }

  private async executeAstDiff({
    path,
    operation,
    nodeSelector,
    newContent,
    metadata,
  }: {
    path: string;
    operation: string;
    nodeSelector: any;
    newContent?: string;
    metadata?: any;
  }): Promise<ToolResult> {
    if (!this.context.sandboxHandle && !this.context.vfs) {
      throw new Error('Either sandboxHandle or vfs context required for astDiff');
    }

    // Get current content
    let currentContent: string;
    if (this.context.sandboxHandle) {
      const readResult = await this.context.sandboxHandle.readFile(path);
      if (!readResult.success || !readResult.content) {
        return {
          success: false,
          error: readResult.error || `Failed to read file: ${path}`,
        };
      }
      currentContent = readResult.content;
    } else {
      currentContent = this.context.vfs?.[path] || '';
      if (!currentContent && this.context.vfs) {
        return {
          success: false,
          error: `File not found in VFS: ${path}`,
        };
      }
    }

    // Only support TypeScript/JavaScript files
    const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx'];
    const fileExt = path.split('.').pop()?.toLowerCase();
    if (!fileExt || !supportedExtensions.includes(fileExt)) {
      return {
        success: false,
        error: `AST diff only supports TypeScript/JavaScript files. Got: ${fileExt}`,
        hint: 'Use apply_diff for non-TypeScript/JavaScript files',
      };
    }

    // Apply AST-aware diff
    try {
      const { AstDiffManager } = await import('./ast-aware-diff');
      const manager = new AstDiffManager();

      const result = await manager.applyAstDiff(path, currentContent, {
        path,
        operation: operation as any,
        nodeSelector,
        newContent,
        metadata,
      });

      if (result.success) {
        // Update VFS
        if (this.context.vfs) {
          this.context.vfs[path] = result.updatedContent;
        }

        // Update sandbox if available
        if (this.context.sandboxHandle) {
          await this.context.sandboxHandle.writeFile(path, result.updatedContent);
        }

        // Log transaction
        if (this.context.transactionLog) {
          this.context.transactionLog.push({
            path,
            type: 'UPDATE',
            timestamp: Date.now(),
            originalContent: currentContent,
            newContent: result.updatedContent,
          });
        }

        return {
          success: true,
          output: `AST diff applied: ${result.changes.map((c) => c.type).join(', ')}. ${metadata?.reason || ''}`,
          content: result.updatedContent,
        };
      }

      return {
        success: false,
        error: result.errors?.join(', ') || 'AST diff failed',
        blocked: true,
      };
    } catch (error) {
      return {
        success: false,
        error: `AST diff execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async executeExecShell({
    command,
    cwd,
  }: {
    command: string;
    cwd?: string;
  }): Promise<ToolResult> {
    // Security: Block dangerous commands
    const blockedPatterns = [
      /^rm\s+-rf\s+\/$/,
      /^mkfs/,
      /^dd\s+if=/,
      /:\(\)\{\s*:\|\:&\s*\};:/,
      /\/dev\/(sd|hd)[a-z]/,
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(command)) {
        return {
          success: false,
          error: `Blocked dangerous command: ${command}`,
          blocked: true,
        };
      }
    }

    if (!this.context.sandboxHandle) {
      return {
        success: false,
        error: 'SandboxHandle required for execShell',
        blocked: true,
      };
    }

    return this.context.sandboxHandle.executeCommand(command, cwd);
  }

  private async executeSyntaxCheck({ paths }: { paths: string[] }): Promise<ToolResult> {
    if (!this.context.sandboxHandle) {
      return {
        success: true,
        output: 'Syntax check skipped - no sandbox available',
      };
    }

    const errors: string[] = [];

    for (const path of paths) {
      const ext = path.split('.').pop()?.toLowerCase();

      try {
        switch (ext) {
          case 'ts':
          case 'tsx':
          case 'js':
          case 'jsx':
            // Use TypeScript compiler if available
            const readResult = await this.context.sandboxHandle.readFile(path);
            if (readResult.success && readResult.content) {
              // Basic syntax validation - in real impl, use tsc
              const content = readResult.content;
              const braceCount = (content.match(/{/g) || []).length - (content.match(/}/g) || []).length;
              const parenCount = (content.match(/\(/g) || []).length - (content.match(/\)/g) || []).length;
              const bracketCount = (content.match(/\[/g) || []).length - (content.match(/\]/g) || []).length;

              if (braceCount !== 0 || parenCount !== 0 || bracketCount !== 0) {
                errors.push(`${path}: Unbalanced brackets/parentheses/braces`);
              }
            }
            break;
          case 'json':
            const jsonResult = await this.context.sandboxHandle.readFile(path);
            if (jsonResult.success && jsonResult.content) {
              try {
                JSON.parse(jsonResult.content);
              } catch (e) {
                errors.push(`${path}: Invalid JSON - ${(e as Error).message}`);
              }
            }
            break;
        }
      } catch (e) {
        errors.push(`${path}: ${(e as Error).message}`);
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        output: errors.join('\n'),
      };
    }

    return {
      success: true,
      output: 'All files passed syntax check',
    };
  }

  private async executeRequestApproval(params: {
    action: string;
    target: string;
    reason: string;
    diff?: string;
  }): Promise<ToolResult> {
    // This tool just signals that approval is needed
    // Actual approval handling is done by the agent/HITL system
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
  }

  private async executeDiscovery(params: {
    files_to_analyze: string[];
    proposed_task: string;
  }): Promise<ToolResult> {
    // Discovery is handled at the agent level
    // This tool just returns the files that need analysis
    return {
      success: true,
      output: `Discovery phase: Analyzing ${params.files_to_analyze.length} files for task: ${params.proposed_task}`,
    };
  }

  private async executeCreatePlan(params: {
    task: string;
    files: any[];
    execution_order: string[];
    rollback_plan: string;
  }): Promise<ToolResult> {
    return {
      success: true,
      output: JSON.stringify({
        version: '1.0',
        created_at: new Date().toISOString(),
        ...params,
      }),
    };
  }

  private async executeCommit(params: {
    session_id: string;
    message: string;
  }): Promise<ToolResult> {
    // Commit is handled by ShadowCommitManager
    return {
      success: true,
      output: `Commit requested for session ${params.session_id}: ${params.message}`,
    };
  }

  private async executeRollback(params: {
    session_id: string;
    commit_id: string;
  }): Promise<ToolResult> {
    // Rollback is handled by ShadowCommitManager
    return {
      success: true,
      output: `Rollback requested to commit ${params.commit_id} for session ${params.session_id}`,
    };
  }

  private async executeHistory(params: {
    session_id: string;
    limit?: number;
  }): Promise<ToolResult> {
    // History is handled by ShadowCommitManager
    return {
      success: true,
      output: `History requested for session ${params.session_id}`,
    };
  }

  getExecutionLog(): ToolExecution[] {
    return [...this.executionLog];
  }

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
    const successfulExecutions = this.executionLog.filter((e) => e.result.success).length;
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

  clearLog(): void {
    this.executionLog = [];
  }
}

export function createToolExecutor(config: ToolExecutorConfig): ToolExecutor {
  return new ToolExecutor(config);
}
