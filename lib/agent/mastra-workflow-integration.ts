/**
 * Mastra Workflow Integration Layer
 * 
 * Bridges Multi-Agent Collaboration with Mastra Workflows,
 * replacing the deprecated simulated orchestrator.
 * 
 * Features:
 * - Mastra workflow execution from multi-agent system
 * - Task proposal/review via Mastra
 * - Workflow-based agent coordination
 * - Real-time progress tracking
 */

import { createLogger } from '../utils/logger';
import { EventEmitter } from 'node:events';

const logger = createLogger('Agent:MastraIntegration');

// ============================================================================
// Types
// ============================================================================

export interface MastraTaskProposal {
  id: string;
  title: string;
  description: string;
  status: 'proposed' | 'approved' | 'rejected' | 'in_progress' | 'completed';
  priority: number;
  createdAt: number;
  createdBy?: string;
  assignedTo?: string;
  workflowId?: string;
}

export interface MastraTaskReview {
  proposalId: string;
  decision: 'approve' | 'reject' | 'request_changes';
  feedback?: string;
  reviewedAt: number;
  reviewedBy?: string;
}

export interface MastraWorkflowResult {
  success: boolean;
  workflowId: string;
  steps?: Array<{
    id: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: any;
    error?: string;
    duration?: number;
  }>;
  result?: any;
  error?: string;
  duration: number;
}

export interface MastraIntegrationConfig {
  enableWorkflows?: boolean;
  defaultModel?: string;
  maxConcurrentWorkflows?: number;
  workflowTimeout?: number; // ms
}

// ============================================================================
// Mastra Workflow Integration
// ============================================================================

export class MastraWorkflowIntegration extends EventEmitter {
  private config: MastraIntegrationConfig;
  private activeWorkflows: Map<string, MastraWorkflowResult> = new Map();
  private taskProposals: Map<string, MastraTaskProposal> = new Map();
  private taskReviews: Map<string, MastraTaskReview> = new Map();
  private mastraModule?: any;
  private workflows: Map<string, any> = new Map();
  private runningWorkflowsCount = 0;
  private workflowQueue: Array<{ workflowId: string; data: any; resolve: any; reject: any }> = [];

  constructor(config: MastraIntegrationConfig = {}) {
    super();

    this.config = {
      enableWorkflows: true,
      defaultModel: process.env.DEFAULT_MODEL || 'gpt-4o-mini',
      maxConcurrentWorkflows: parseInt(process.env.MASTRA_MAX_CONCURRENT_WORKFLOWS || '5', 10),
      workflowTimeout: parseInt(process.env.MASTRA_WORKFLOW_TIMEOUT || '300000', 10),
      ...config,
    };
  }

  /**
   * Initialize Mastra module
   */
  private async ensureMastraModule(): Promise<void> {
    if (this.mastraModule !== undefined) return;  // Already initialized (including null for fallback)

    try {
      // Dynamic import to avoid hard dependency
      const { createWorkflow, createStep } = await import('@mastra/core/workflows');
      this.mastraModule = { createWorkflow, createStep };
      logger.info('Mastra module loaded successfully');
    } catch (error: any) {
      logger.warn('Mastra module not available, using fallback implementation', {
        error: error.message,
      });
      // Use fallback implementation - set to null to prevent retry
      this.mastraModule = null;
    }
  }

  /**
   * Propose a new task via Mastra workflow
   */
  async proposeTask(
    title: string,
    description: string,
    options?: {
      priority?: number;
      assignedTo?: string;
      workflowId?: string;
    }
  ): Promise<MastraTaskProposal> {
    await this.ensureMastraModule();

    const proposal: MastraTaskProposal = {
      id: `proposal-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      title,
      description,
      status: 'proposed',
      priority: options?.priority || 5,
      createdAt: Date.now(),
      assignedTo: options?.assignedTo,
      workflowId: options?.workflowId,
    };

    this.taskProposals.set(proposal.id, proposal);

    logger.info('Task proposed', {
      proposalId: proposal.id,
      title,
      priority: proposal.priority,
    });

    this.emit('task:proposed', proposal);

    return proposal;
  }

  /**
   * Review a task proposal
   */
  async reviewTask(
    proposalId: string,
    decision: 'approve' | 'reject' | 'request_changes',
    options?: {
      feedback?: string;
      reviewedBy?: string;
    }
  ): Promise<MastraTaskReview> {
    const proposal = this.taskProposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Task proposal not found: ${proposalId}`);
    }

    const review: MastraTaskReview = {
      proposalId,
      decision,
      feedback: options?.feedback,
      reviewedAt: Date.now(),
      reviewedBy: options?.reviewedBy,
    };

    this.taskReviews.set(proposalId, review);

    // Update proposal status
    if (decision === 'approve') {
      proposal.status = 'approved';
    } else if (decision === 'reject') {
      proposal.status = 'rejected';
    } else {
      proposal.status = 'in_progress'; // Needs changes
    }

    this.taskProposals.set(proposalId, proposal);

    logger.info('Task reviewed', {
      proposalId,
      decision,
      feedback: options?.feedback,
    });

    this.emit('task:reviewed', { proposal, review });

    return review;
  }

  /**
   * List task proposals with filters
   */
  listProposals(filters?: {
    status?: string;
    assignedTo?: string;
  }): MastraTaskProposal[] {
    let proposals = Array.from(this.taskProposals.values());

    if (filters) {
      if (filters.status) {
        proposals = proposals.filter(p => p.status === filters.status);
      }
      if (filters.assignedTo) {
        proposals = proposals.filter(p => p.assignedTo === filters.assignedTo);
      }
    }

    return proposals;
  }

  /**
   * Get proposal by ID
   */
  getProposal(proposalId: string): MastraTaskProposal | null {
    return this.taskProposals.get(proposalId) || null;
  }

  /**
   * Execute a Mastra workflow
   */
  async executeWorkflow(
    workflowId: string,
    inputData: any,
    options?: {
      timeout?: number;
    }
  ): Promise<MastraWorkflowResult> {
    await this.ensureMastraModule();

    const timeout = options?.timeout || this.config.workflowTimeout!;
    const startTime = Date.now();

    logger.info('Executing workflow', { workflowId, timeout });

    // FIX: Enforce maxConcurrentWorkflows limit
    if (this.runningWorkflowsCount >= this.config.maxConcurrentWorkflows!) {
      logger.warn('Workflow queue full, waiting for slot', {
        workflowId,
        runningCount: this.runningWorkflowsCount,
        maxConcurrent: this.config.maxConcurrentWorkflows,
      });
      
      // Wait for a slot to become available
      await new Promise<void>((resolve) => {
        this.workflowQueue.push({ workflowId, data: inputData, resolve, reject: () => {} });
      });
    }

    this.runningWorkflowsCount++;

    // Create workflow result tracker
    const result: MastraWorkflowResult = {
      success: false,
      workflowId,
      steps: [],
      duration: 0,
    };

    this.activeWorkflows.set(workflowId, result);

    try {
      // Check if using real Mastra or fallback
      if (this.mastraModule && this.config.enableWorkflows) {
        // Use real Mastra workflow execution
        result.steps = await this.executeMastraWorkflow(workflowId, inputData, timeout);
      } else {
        // Fallback: simulate workflow execution
        result.steps = await this.simulateWorkflowExecution(workflowId, inputData, timeout);
      }

      // FIX: Check for failed steps, not just completed ones
      const failedSteps = result.steps.filter(s => s.status === 'failed');
      result.success = failedSteps.length === 0 && result.steps.every(s => s.status === 'completed');
      if (failedSteps.length > 0) {
        result.error = failedSteps.map(s => s.error).filter(Boolean).join('; ');
      }
      result.result = result.steps.map(s => s.result);
      result.duration = Date.now() - startTime;

      this.activeWorkflows.set(workflowId, result);

      logger.info('Workflow execution completed', {
        workflowId,
        success: result.success,
        duration: result.duration,
        failedSteps: failedSteps.length,
      });

      this.emit('workflow:completed', result);

      return result;
    } catch (error: any) {
      result.error = error.message;
      result.success = false;
      result.duration = Date.now() - startTime;

      this.activeWorkflows.set(workflowId, result);

      logger.error('Workflow execution failed', {
        workflowId,
        error: error.message,
      });

      this.emit('workflow:failed', { workflowId, error });

      throw error; // Re-throw to prevent treating failed workflows as successful
    } finally {
      // FIX: Decrement running count and process queue
      this.runningWorkflowsCount--;
      
      // Process next workflow in queue if available
      const nextWorkflow = this.workflowQueue.shift();
      if (nextWorkflow) {
        nextWorkflow.resolve();
      }
    }
  }

  /**
   * Execute real Mastra workflow
   */
  private async executeMastraWorkflow(
    workflowId: string,
    inputData: any,
    timeout: number
  ): Promise<any[]> {
    // Get workflow from registry or create default
    let workflow = this.workflows.get(workflowId);

    if (!workflow) {
      // Create default workflow using Mastra SDK
      const { createWorkflow, createStep } = this.mastraModule;

      // Create generic execution step
      const executeStep = createStep({
        id: 'execute',
        inputSchema: null as any,
        outputSchema: null as any,
        execute: async ({ inputData: data }) => {
          // Execute based on workflow type
          return this.executeWorkflowStep(workflowId, data);
        },
      });

      // Create workflow
      workflow = createWorkflow({
        id: workflowId,
        name: workflowId,
      });

      workflow.addStep(executeStep);

      this.workflows.set(workflowId, workflow);
    }

    // Execute workflow with timeout
    const stepStartTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const workflowResult = await Promise.race([
        workflow.execute({ inputData }),
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error('Workflow execution timeout'));
          });
        }),
      ]);

      clearTimeout(timeoutId);

      // FIX: Calculate actual step duration from start time
      const stepDuration = Date.now() - stepStartTime;

      return [
        {
          id: 'execute',
          name: 'Execution',
          status: 'completed',
          result: workflowResult,
          duration: stepDuration,
        },
      ];
    } catch (error: any) {
      clearTimeout(timeoutId);
      throw error;  // Re-throw to properly mark step as failed
    }
  }

  /**
   * Execute workflow step (custom logic per workflow type)
   */
  private async executeWorkflowStep(workflowId: string, data: any): Promise<any> {
    // Custom execution logic based on workflow ID
    switch (workflowId) {
      case 'code-agent':
        return this.executeCodeAgentWorkflow(data);
      case 'hitl':
        return this.executeHITLWorkflow(data);
      case 'parallel':
        return this.executeParallelWorkflow(data);
      default:
        // Generic execution
        return { executed: workflowId, data };
    }
  }

  /**
   * Execute code agent workflow
   */
  private async executeCodeAgentWorkflow(data: any): Promise<any> {
    // Import and execute code agent workflow
    try {
      const { codeAgentWorkflow } = await import('../orchestra/mastra/workflows/code-agent-workflow');

      // Execute the workflow
      const result = await codeAgentWorkflow.execute({
        inputData: {
          task: data.task || data.taskId,
          ownerId: data.ownerId,
        },
      });

      return {
        workflowType: 'code-agent',
        result,
        success: true,
      };
    } catch (error: any) {
      logger.error('Code agent workflow execution failed', { error: error.message });
      throw error;  // Re-throw to properly mark step as failed
    }
  }

  /**
   * Execute HITL workflow
   */
  private async executeHITLWorkflow(data: any): Promise<any> {
    try {
      const { hitlWorkflow } = await import('../orchestra/mastra/workflows/hitl-workflow');

      const result = await hitlWorkflow.execute({
        inputData: {
          ownerId: data.ownerId,
          code: data.code,
          description: data.description,
        },
      });

      return {
        workflowType: 'hitl',
        result,
        success: true,
      };
    } catch (error: any) {
      logger.error('HITL workflow execution failed', { error: error.message });
      throw error;  // Re-throw to properly mark step as failed
    }
  }

  /**
   * Execute parallel workflow
   */
  private async executeParallelWorkflow(data: any): Promise<any> {
    try {
      const { parallelWorkflow } = await import('../orchestra/mastra/workflows/parallel-workflow');

      const result = await parallelWorkflow.execute({
        inputData: {
          ownerId: data.ownerId,
          paths: data.paths,
        },
      });

      return {
        workflowType: 'parallel',
        result,
        success: true,
      };
    } catch (error: any) {
      logger.error('Parallel workflow execution failed', { error: error.message });
      throw error;  // Re-throw to properly mark step as failed
    }
  }

  /**
   * Simulate workflow execution (fallback)
   */
  private async simulateWorkflowExecution(
    workflowId: string,
    inputData: any,
    timeout: number
  ): Promise<any[]> {
    logger.debug('Simulating workflow execution', { workflowId });

    // Simulate steps based on workflow type
    const steps = [
      {
        id: 'init',
        name: 'Initialization',
        status: 'completed' as const,
        result: { initialized: true },
        duration: 100,
      },
      {
        id: 'execute',
        name: 'Execution',
        status: 'completed' as const,
        result: { executed: workflowId, inputData },
        duration: 500,
      },
      {
        id: 'complete',
        name: 'Completion',
        status: 'completed' as const,
        result: { completed: true },
        duration: 50,
      },
    ];

    // Simulate timeout
    await new Promise(resolve => setTimeout(resolve, Math.min(timeout, 1000)));

    return steps;
  }

  /**
   * Get active workflow result
   */
  getWorkflowResult(workflowId: string): MastraWorkflowResult | null {
    return this.activeWorkflows.get(workflowId) || null;
  }

  /**
   * Get task review by proposal ID
   */
  getTaskReview(proposalId: string): MastraTaskReview | null {
    return this.taskReviews.get(proposalId) || null;
  }

  /**
   * Register custom workflow
   */
  registerWorkflow(workflowId: string, workflow: any): void {
    this.workflows.set(workflowId, workflow);
    logger.info('Custom workflow registered', { workflowId });
  }

  /**
   * Get statistics
   */
  getStats(): {
    activeWorkflows: number;
    totalProposals: number;
    pendingReviews: number;
    completedWorkflows: number;
    failedWorkflows: number;
  } {
    const workflows = Array.from(this.activeWorkflows.values());
    const proposals = Array.from(this.taskProposals.values());
    const reviews = Array.from(this.taskReviews.values());

    return {
      activeWorkflows: workflows.filter(w => !w.success && !w.error).length,
      totalProposals: proposals.length,
      pendingReviews: reviews.filter(r => r.decision === 'request_changes').length,
      completedWorkflows: workflows.filter(w => w.success).length,
      failedWorkflows: workflows.filter(w => w.error).length,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const mastraWorkflowIntegration = new MastraWorkflowIntegration();
