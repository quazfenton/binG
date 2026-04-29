import type { ApprovalRequest } from './schemas';
import { hitlAuditLogger } from './hitl-audit-logger';
import { minimatch } from 'minimatch';
import { isOutsideWorkspace, resolveWorkspaceRoot, DESTRUCTIVE_OPERATIONS } from '@/lib/agent-bins/workspace-boundary';

export interface InterruptRequest {
  type: 'approval_required';
  action: string;
  target: string;
  reason: string;
  diff?: string;
  metadata?: Record<string, any>;
}

export interface InterruptResponse {
  approved: boolean;
  feedback?: string;
  modified_value?: any;
}

type InterruptHandler = (request: InterruptRequest) => Promise<InterruptResponse>;

class HumanInTheLoopManager {
  private pendingInterrupts: Map<string, {
    request: InterruptRequest;
    resolve: (response: InterruptResponse) => void;
    createdAt: Date;
    requestLogged: boolean;
    resolved: boolean;  // Flag to prevent race condition
  }> = new Map<string, {
    request: InterruptRequest;
    resolve: (response: InterruptResponse) => void;
    createdAt: Date;
    requestLogged: boolean;
    resolved: boolean;  // Flag to prevent race condition
  }>();

  private handler: InterruptHandler | null = null;

  setHandler(handler: InterruptHandler) {
    this.handler = handler;
  }

  async requestInterrupt(
    request: InterruptRequest,
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<InterruptResponse> {
    const interruptId = crypto.randomUUID();
    const requestStartTime = Date.now();

    if (!this.handler) {
      console.warn('[HITL] No handler configured, auto-denying interrupt');
      await hitlAuditLogger.logApprovalDecision(interruptId, false, 'No approval handler configured');
      return { approved: false, feedback: 'No approval handler configured' };
    }

    // Log approval request for audit
    if (userId) {
      await hitlAuditLogger.logApprovalRequest(
        interruptId,
        userId,
        request.action,
        request.target,
        request.reason,
        metadata
      );
    }

    const promise = new Promise<InterruptResponse>((resolve) => {
      this.pendingInterrupts.set(interruptId, {
        request,
        resolve,
        createdAt: new Date(),
        requestLogged: !!userId,
        resolved: false,
      });
    });

    // Parse timeout with validation (default: 5 minutes, min: 10s, max: 30 minutes)
    const configuredTimeout = parseInt(process.env.HITL_TIMEOUT || '300000');
    const timeout = Number.isNaN(configuredTimeout)
      ? 300000
      : Math.max(10000, Math.min(1800000, configuredTimeout));

    const timeoutPromise = new Promise<InterruptResponse>((resolve) => {
      setTimeout(() => {
        // Check and set resolved flag atomically to prevent race condition
        const pending = this.pendingInterrupts.get(interruptId);
        if (pending && !pending.resolved) {
          pending.resolved = true;
          this.pendingInterrupts.delete(interruptId);
          resolve({ approved: false, feedback: 'Approval request timed out' });
        }
      }, timeout);
    });

    // Race handler completion against timeout - handler runs in background without blocking timeout
    const handlerPromise = (async () => {
      try {
        await this.handler(request);
      } catch (handlerError) {
        console.error('[HITL] Handler error:', handlerError);
        // Resolve with error fallback - don't leave pending
        const pending = this.pendingInterrupts.get(interruptId);
        if (pending && !pending.resolved) {
          pending.resolved = true;
          pending.resolve({ approved: false, feedback: `Handler error: ${handlerError instanceof Error ? handlerError.message : String(handlerError)}` });
          this.pendingInterrupts.delete(interruptId);
        }
      }
    })();

    const response = await Promise.race([promise, timeoutPromise]);
    
    // Ensure we only resolve once by checking the resolved flag
    const pending = this.pendingInterrupts.get(interruptId);
    if (pending && !pending.resolved) {
      pending.resolved = true;
      this.pendingInterrupts.delete(interruptId);
    }
    
    // Log approval decision for audit
    const responseTimeMs = Date.now() - requestStartTime;
    await hitlAuditLogger.logApprovalDecision(
      interruptId,
      response.approved,
      response.feedback,
      response.modified_value,
      responseTimeMs
    );

    return response;
  }

  async resolveInterrupt(interruptId: string, response: InterruptResponse): Promise<void> {
    const pending = this.pendingInterrupts.get(interruptId);
    if (pending) {
      pending.resolve(response);
      this.pendingInterrupts.delete(interruptId);
    }
  }

  getPendingInterrupts(): Array<{ id: string; request: InterruptRequest; createdAt: Date }> {
    return Array.from(this.pendingInterrupts.entries()).map(([id, { request, createdAt }]) => ({
      id,
      request,
      createdAt,
    }));
  }

  cancelAllInterrupts(): void {
    for (const [id, pending] of this.pendingInterrupts) {
      pending.resolve({ approved: false, feedback: 'Session cancelled' });
    }
    this.pendingInterrupts.clear();
  }
}

export const hitlManager = new HumanInTheLoopManager();

export function createApprovalRequest(
  action: ApprovalRequest['action'],
  target: string,
  reason: string,
  diff?: string
): ApprovalRequest {
  return {
    id: crypto.randomUUID(),
    action,
    target,
    reason,
    diff,
    requested_at: new Date().toISOString(),
    status: 'pending',
  };
}

export async function requireApproval(
  action: ApprovalRequest['action'],
  target: string,
  reason: string,
  diff?: string,
  userId?: string,
  metadata?: Record<string, any>
): Promise<boolean> {
  const shouldEnforce = process.env.ENABLE_HITL === 'true';
  const requiresApproval = process.env.HITL_APPROVAL_REQUIRED_ACTIONS?.split(',').includes(action) ?? false;

  if (!shouldEnforce || !requiresApproval) {
    return true;
  }

  const request: InterruptRequest = {
    type: 'approval_required',
    action,
    target,
    reason,
    diff,
  };

  const response = await hitlManager.requestInterrupt(request, userId, metadata);
  return response.approved;
}

// ==================== Enhanced Approval Workflows ====================
// Configurable approval workflows with rules based on tool type, file paths, and risk levels

/**
 * Approval rule condition function
 * Evaluates whether a rule applies to a given action
 */
export type ApprovalCondition = (toolName: string, params: any, context?: ApprovalContext) => boolean;

/**
 * Context for approval evaluation
 */
export interface ApprovalContext {
  filePath?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  userId?: string;
  sessionId?: string;
  [key: string]: any;
}

/**
 * Approval rule for workflow-based decisions
 */
export interface ApprovalRule {
  id?: string;
  name?: string;
  condition: ApprovalCondition;
  action: 'require_approval' | 'notify_only' | 'auto_approve';
  approvers?: string[];
  timeout?: number;
  description?: string;
}

/**
 * Approval workflow configuration
 */
export interface ApprovalWorkflow {
  id: string;
  name?: string;
  type: 'auto' | 'manual' | 'hybrid';
  rules: ApprovalRule[];
  defaultAction?: 'require_approval' | 'auto_approve';
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Workflow evaluation result
 */
export interface WorkflowEvaluation {
  requiresApproval: boolean;
  action: 'require_approval' | 'notify_only' | 'auto_approve';
  matchedRule?: ApprovalRule;
  approvers?: string[];
  timeout?: number;
  reason?: string;
}

// ==================== Pre-built Conditions ====================

/**
 * Condition: Check if tool name matches
 */
export function toolNameMatcher(names: string[]): ApprovalCondition {
  return (toolName: string) => names.includes(toolName);
}

/**
 * Condition: Check if file path matches pattern
 * Uses minimatch library for proper glob pattern matching
 */
export function filePathMatcher(patterns: string[]): ApprovalCondition {
  return (_toolName: string, _params: any, context?: ApprovalContext) => {
    if (!context?.filePath) return false;
    const filePath = context.filePath;
    
    // Use minimatch for proper glob matching
    // Options: dot=true allows matching dotfiles, nocase=true for case-insensitive
    return patterns.some(pattern => 
      minimatch(filePath, pattern, { dot: true, nocase: false })
    );
  };
}

/**
 * Condition: Check if risk level matches
 */
export function riskLevelMatcher(levels: ('low' | 'medium' | 'high')[]): ApprovalCondition {
  return (_toolName: string, _params: any, context?: ApprovalContext) => {
    return context?.riskLevel ? levels.includes(context.riskLevel) : false;
  };
}

/**
 * Condition: Check if a destructive file operation targets a path outside the workspace root.
 * Uses the shared workspace-boundary utility for consistent root resolution.
 */
export function outsideWorkspaceMatcher(): ApprovalCondition {
  return (_toolName: string, params: any, context?: ApprovalContext) => {
    const targetPath = params?.path || params?.filePath || params?.targetPath || context?.filePath;
    if (!targetPath) return false;

    // Only flag destructive operations
    const operation = params?.operation || _toolName;
    if (!DESTRUCTIVE_OPERATIONS.has(operation)) return false;

    return isOutsideWorkspace(targetPath, context?.workspaceRoot);
  };
}

/**
 * Condition: Combined matcher (all conditions must match)
 */
export function allConditions(...conditions: ApprovalCondition[]): ApprovalCondition {
  return (toolName: string, params: any, context?: ApprovalContext) => {
    return conditions.every(cond => cond(toolName, params, context));
  };
}

/**
 * Condition: Any matcher (at least one condition must match)
 */
export function anyConditions(...conditions: ApprovalCondition[]): ApprovalCondition {
  return (toolName: string, params: any, context?: ApprovalContext) => {
    return conditions.some(cond => cond(toolName, params, context));
  };
}

// ==================== Pre-built Rules ====================

/**
 * Create a rule for high-risk shell commands
 */
export function createShellCommandRule(): ApprovalRule {
  return {
    id: 'shell-commands',
    name: 'Shell Command Approval',
    condition: toolNameMatcher(['execShell', 'exec_shell', 'runCommand', 'run_command', 'executeCommand', 'execute_command']),
    action: 'require_approval',
    timeout: 300000, // 5 minutes
    description: 'Require approval for shell command execution',
  };
}

/**
 * Create a rule for sensitive file paths
 */
export function createSensitiveFilesRule(): ApprovalRule {
  return {
    id: 'sensitive-files',
    name: 'Sensitive File Approval',
    condition: filePathMatcher(['*.env', '*.env.*', '**/.env*', '**/secrets/*', '**/credentials/*', '**/*.key', '**/*.pem']),
    action: 'require_approval',
    timeout: 600000, // 10 minutes
    description: 'Require approval for accessing sensitive files',
  };
}

/**
 * Create a rule for read-only operations (auto-approve)
 */
export function createReadOnlyRule(): ApprovalRule {
  return {
    id: 'read-only',
    name: 'Read-Only Auto-Approval',
    condition: toolNameMatcher(['readFile', 'read_file', 'listFiles', 'list_dir', 'dir', 'ls', 'cat']),
    action: 'auto_approve',
    description: 'Auto-approve read-only operations',
  };
}

/**
 * Create a rule for operations outside the workspace boundary
 */
export function createOutsideWorkspaceRule(): ApprovalRule {
  return {
    id: 'outside-workspace',
    name: 'Outside Workspace Boundary',
    condition: outsideWorkspaceMatcher(),
    action: 'require_approval',
    timeout: 60000, // 1 minute — shorter since user needs to act quickly
    description: 'Require approval for destructive file operations outside the workspace root',
  };
}

/**
 * Create a rule for high-risk file operations
 */
export function createHighRiskFileRule(): ApprovalRule {
  return {
    id: 'high-risk-files',
    name: 'High-Risk File Operations',
    condition: allConditions(
      toolNameMatcher(['writeFile', 'write_file', 'deleteFile', 'delete_file', 'applyDiff', 'apply_diff']),
      riskLevelMatcher(['high'])
    ),
    action: 'require_approval',
    timeout: 300000,
    description: 'Require approval for high-risk file operations',
  };
}

// ==================== Default Workflows ====================

/**
 * Default hybrid workflow with balanced security
 */
export const defaultWorkflow: ApprovalWorkflow = {
  id: 'default',
  name: 'Default Hybrid Workflow',
  type: 'hybrid',
  rules: [
    createOutsideWorkspaceRule(),
    createShellCommandRule(),
    createSensitiveFilesRule(),
    createReadOnlyRule(),
    createHighRiskFileRule(),
  ],
  defaultAction: 'auto_approve',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Strict workflow - requires approval for most operations
 */
export const strictWorkflow: ApprovalWorkflow = {
  id: 'strict',
  name: 'Strict Approval Workflow',
  type: 'manual',
  rules: [
    {
      id: 'all-write-operations',
      name: 'All Write Operations',
      condition: toolNameMatcher(['writeFile', 'deleteFile', 'applyDiff', 'execShell', 'runCommand']),
      action: 'require_approval',
      timeout: 300000,
    },
  ],
  defaultAction: 'require_approval',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Permissive workflow - only requires approval for high-risk operations
 */
export const permissiveWorkflow: ApprovalWorkflow = {
  id: 'permissive',
  name: 'Permissive Workflow',
  type: 'auto',
  rules: [
    {
      id: 'critical-operations',
      name: 'Critical Operations Only',
      condition: anyConditions(
        filePathMatcher(['**/.env*', '**/secrets/*', '**/credentials/*']),
        allConditions(toolNameMatcher(['execShell']), riskLevelMatcher(['high']))
      ),
      action: 'require_approval',
      timeout: 180000, // 3 minutes
    },
  ],
  defaultAction: 'auto_approve',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Desktop workflow - auto-approves nearly everything for local execution.
 * Only blocks truly destructive system-level operations (format disk, fork bomb).
 */
export const desktopWorkflow: ApprovalWorkflow = {
  id: 'desktop',
  name: 'Desktop Workflow',
  type: 'auto',
  rules: [
    // Workspace boundary — always require confirmation for destructive ops outside workspace
    createOutsideWorkspaceRule(),
    // FIX: Comprehensive destructive command matching - covers all dangerous shell patterns
    {
      id: 'system-destructive',
      name: 'System-Destructive Operations',
      condition: anyConditions(
        // Filesystem destruction: rm -rf with dangerous targets
        (toolName, params) => /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(\/|~|\/\*|\$HOME|\$PWD)/i.test(params?.command || ''),
        (toolName, params) => /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+--no-preserve-root/i.test(params?.command || ''),
        (toolName, params) => /rm\s+.*--no-preserve-root/i.test(params?.command || ''),
        (toolName, params) => /sudo\s+.*rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)/i.test(params?.command || ''),

        // Disk/partition destruction: mkfs, fdisk, format (but not --help)
        (toolName, params) => {
          const cmd = params?.command || '';
          return /(^|\s|sudo\s+)(mkfs|mkfs\.\w+|fdisk|parted|format)\s/i.test(cmd) && !/\s--help/i.test(cmd);
        },
        (toolName, params) => /(^|\s|sudo\s+)dd\s+if=\/dev\/(zero|null)/i.test(params?.command || ''),
        (toolName, params) => /sudo\s+.*dd\s+/i.test(params?.command || ''),

        // Dangerous permission changes
        (toolName, params) => /chmod\s+(-R\s+)?777\s+(\/|\/\w)/i.test(params?.command || ''),
        (toolName, params) => /chmod\s+-R\s/i.test(params?.command || ''),
        (toolName, params) => /chown\s+-R\s/i.test(params?.command || ''),
        (toolName, params) => /sudo\s+.*(chmod|chown)\s/i.test(params?.command || ''),

        // Device file overwrites: > /dev/sda, > /dev/hda, etc.
        (toolName, params) => />\s*\/dev\/(sd[a-z]|hd[a-z]|nvme|vda|xvd|loop|ram|zero|null)/i.test(params?.command || ''),

        // Fork bomb variants (multiple patterns to catch obfuscation)
        (toolName, params) => /:\s*\(\)\s*\{.*:\|.*:&.*\}\s*;/.test(params?.command || ''),
        (toolName, params) => /:\(\)/.test(params?.command || ''),
        (toolName, params) => /fork\s*bomb/i.test(params?.command || ''),

        // Pipe to shell execution: curl | bash, wget | sh
        (toolName, params) => /(curl|wget)\s+.*\|\s*(bash|sh|zsh|fish|dash)/i.test(params?.command || ''),
        (toolName, params) => /(curl|wget)\s+.*\|\|\s*(bash|sh|zsh|fish|dash)/i.test(params?.command || ''),

        // System shutdown/reboot/init (but not --help)
        (toolName, params) => {
          const cmd = params?.command || '';
          return /(^|\s|sudo\s+)(shutdown|reboot|halt|poweroff)(\s|$)/i.test(cmd) && !/\s--help/i.test(cmd);
        },
        (toolName, params) => /(^|\s|sudo\s+)init\s+[06]/i.test(params?.command || ''),
        (toolName, params) => /systemctl\s+(reboot|poweroff|halt|suspend|hibernate)/i.test(params?.command || ''),
      ),
      action: 'require_approval',
      timeout: 60000,
      description: 'Block system-destructive commands in desktop mode',
    },
  ],
  defaultAction: 'auto_approve',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ==================== Workflow Registry ====================

/**
 * Registry of available workflows
 */
export const workflowRegistry: Map<string, ApprovalWorkflow> = new Map([
  ['default', defaultWorkflow],
  ['strict', strictWorkflow],
  ['permissive', permissiveWorkflow],
  ['desktop', desktopWorkflow],
]);

/**
 * Get workflow by ID
 */
export function getWorkflow(id: string): ApprovalWorkflow | undefined {
  return workflowRegistry.get(id);
}

/**
 * Register a custom workflow
 */
export function registerWorkflow(workflow: ApprovalWorkflow): void {
  workflowRegistry.set(workflow.id, workflow);
}

/**
 * Get active workflow from environment or use default
 */
export function getActiveWorkflow(): ApprovalWorkflow {
  // Desktop mode defaults to the permissive desktop workflow
  const isDesktop = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';
  const defaultId = isDesktop ? 'desktop' : 'default';
  const workflowId = process.env.HITL_WORKFLOW_ID || defaultId;
  return getWorkflow(workflowId) || defaultWorkflow;
}

// ==================== Workflow Evaluation ====================

/**
 * Evaluate an action against a workflow's rules
 * Returns the first matching rule's decision
 */
export function evaluateWorkflow(
  workflow: ApprovalWorkflow,
  toolName: string,
  params: any,
  context?: ApprovalContext
): WorkflowEvaluation {
  for (const rule of workflow.rules) {
    try {
      if (rule.condition(toolName, params, context)) {
        return {
          requiresApproval: rule.action === 'require_approval',
          action: rule.action,
          matchedRule: rule,
          approvers: rule.approvers,
          timeout: rule.timeout,
          reason: rule.description || `Rule "${rule.name || rule.id}" matched`,
        };
      }
    } catch (error) {
      console.error(`[HITL] Error evaluating rule ${rule.id}:`, error);
      // Continue to next rule on error
    }
  }

  // No rules matched - use default action
  // FIX: Fail closed (require approval) when rule evaluation fails to prevent bypassing security
  // Only use auto_approve if explicitly set in defaultAction
  const defaultAction = workflow.defaultAction || 'require_approval';
  return {
    requiresApproval: defaultAction === 'require_approval',
    action: defaultAction,
    reason: 'No matching rules - using default action',
  };
}

/**
 * Evaluate against active workflow
 */
export function evaluateActiveWorkflow(
  toolName: string,
  params: any,
  context?: ApprovalContext
): WorkflowEvaluation {
  const workflow = getActiveWorkflow();
  return evaluateWorkflow(workflow, toolName, params, context);
}

// ==================== Enhanced Approval Functions ====================

/**
 * Check if an action requires approval based on workflow rules
 */
export async function requireApprovalWithWorkflow(
  toolName: string,
  params: any,
  context?: ApprovalContext,
  userId?: string
): Promise<{ approved: boolean; reason?: string; timeout?: number }> {
  const shouldEnforce = process.env.ENABLE_HITL === 'true';

  if (!shouldEnforce) {
    return { approved: true, reason: 'HITL not enabled' };
  }

  // Evaluate workflow
  const evaluation = evaluateActiveWorkflow(toolName, params, context);

  // Auto-approve if workflow says so
  if (!evaluation.requiresApproval) {
    return {
      approved: true,
      reason: evaluation.reason || 'Auto-approved by workflow',
    };
  }

  // Require approval
  const request: InterruptRequest = {
    type: 'approval_required',
    action: toolName,
    target: context?.filePath || 'unknown',
    reason: evaluation.reason || 'Workflow requires approval',
    metadata: {
      params,
      context,
      matchedRule: evaluation.matchedRule?.id,
      approvers: evaluation.approvers,
    },
  };

  const response = await hitlManager.requestInterrupt(request, userId, {
    workflowEvaluation: evaluation,
    ...context,
  });

  return {
    approved: response.approved,
    reason: response.feedback,
    timeout: evaluation.timeout,
  };
}

/**
 * Create a workflow-based approval request
 */
export function createWorkflowApprovalRequest(
  toolName: string,
  params: any,
  context?: ApprovalContext
): { request: InterruptRequest; evaluation: WorkflowEvaluation } {
  const evaluation = evaluateActiveWorkflow(toolName, params, context);

  const request: InterruptRequest = {
    type: 'approval_required',
    action: toolName,
    target: context?.filePath || 'unknown',
    reason: evaluation.reason || 'Workflow requires approval',
    metadata: {
      params,
      context,
      evaluation,
    },
  };

  return { request, evaluation };
}

// ==================== Workflow Manager ====================

/**
 * Human-in-the-Loop Workflow Manager
 * Extends basic HITL manager with workflow-based approvals
 */
export class HITLWorkflowManager {
  private currentWorkflow: ApprovalWorkflow;
  private evaluationHistory: Array<{
    timestamp: number;
    toolName: string;
    params: any;
    evaluation: WorkflowEvaluation;
    result?: { approved: boolean; reason?: string };
  }> = [];

  constructor(workflow?: ApprovalWorkflow) {
    this.currentWorkflow = workflow || getActiveWorkflow();
  }

  /**
   * Set the active workflow
   */
  setWorkflow(workflow: ApprovalWorkflow): void {
    this.currentWorkflow = workflow;
  }

  /**
   * Get current workflow
   */
  getWorkflow(): ApprovalWorkflow {
    return this.currentWorkflow;
  }

  /**
   * Evaluate an action without executing
   */
  evaluate(toolName: string, params: any, context?: ApprovalContext): WorkflowEvaluation {
    return evaluateWorkflow(this.currentWorkflow, toolName, params, context);
  }

  /**
   * Execute with workflow-based approval
   */
  async executeWithApproval(
    toolName: string,
    params: any,
    executeFn: () => Promise<any>,
    context?: ApprovalContext,
    userId?: string
  ): Promise<{ success: boolean; result?: any; reason?: string }> {
    const evaluation = this.evaluate(toolName, params, context);

    // Log evaluation
    this.evaluationHistory.push({
      timestamp: Date.now(),
      toolName,
      params,
      evaluation,
    });

    // Auto-approve if workflow says so
    if (!evaluation.requiresApproval) {
      try {
        const result = await executeFn();
        // Update last history entry with result
        const lastEntry = this.evaluationHistory[this.evaluationHistory.length - 1];
        if (lastEntry) {
          lastEntry.result = { approved: true, reason: evaluation.reason };
        }
        return { success: true, result, reason: evaluation.reason };
      } catch (error) {
        return {
          success: false,
          reason: error instanceof Error ? error.message : 'Execution failed',
        };
      }
    }

    // Require approval
    const request: InterruptRequest = {
      type: 'approval_required',
      action: toolName,
      target: context?.filePath || 'unknown',
      reason: evaluation.reason || 'Workflow requires approval',
      metadata: {
        params,
        context,
        evaluation,
      },
    };

    const response = await hitlManager.requestInterrupt(request, userId, {
      workflowEvaluation: evaluation,
      ...context,
    });

    // Update last history entry with result
    const lastEntry = this.evaluationHistory[this.evaluationHistory.length - 1];
    if (lastEntry) {
      lastEntry.result = { approved: response.approved, reason: response.feedback };
    }

    if (!response.approved) {
      return { success: false, reason: response.feedback || 'Approval denied' };
    }

    // Execute after approval
    try {
      const result = await executeFn();
      return { success: true, result, reason: response.feedback };
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'Execution failed after approval',
      };
    }
  }

  /**
   * Get evaluation history
   */
  getHistory(limit: number = 50): typeof this.evaluationHistory {
    return this.evaluationHistory.slice(-limit);
  }

  /**
   * Clear evaluation history
   */
  clearHistory(): void {
    this.evaluationHistory = [];
  }
}

/**
 * Create a HITL Workflow Manager instance
 */
export function createHITLWorkflowManager(workflow?: ApprovalWorkflow): HITLWorkflowManager {
  return new HITLWorkflowManager(workflow);
}

// ==================== Exports Summary ====================
//
// Core Types:
// - InterruptRequest, InterruptResponse
// - ApprovalWorkflow, ApprovalRule, ApprovalCondition
// - ApprovalContext, WorkflowEvaluation
//
// Core Classes:
// - HumanInTheLoopManager (hitlManager instance)
// - HITLWorkflowManager
//
// Core Functions:
// - requireApproval() - Basic approval based on action list
// - requireApprovalWithWorkflow() - Workflow-based approval
// - evaluateWorkflow() - Evaluate action against workflow rules
// - evaluateActiveWorkflow() - Evaluate against active workflow
// - createApprovalRequest() - Create approval request object
// - createWorkflowApprovalRequest() - Create workflow-based request
//
// Pre-built Rules:
// - createShellCommandRule()
// - createSensitiveFilesRule()
// - createReadOnlyRule()
// - createHighRiskFileRule()
//
// Pre-built Workflows:
// - defaultWorkflow - Balanced hybrid approach
// - strictWorkflow - Require approval for most operations
// - permissiveWorkflow - Only approve high-risk operations
//
// Workflow Registry:
// - getWorkflow(id) - Get workflow by ID
// - registerWorkflow(workflow) - Register custom workflow
// - getActiveWorkflow() - Get workflow from environment
// - createHITLWorkflowManager(workflow) - Create manager instance
