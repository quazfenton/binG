/**
 * Simulated Orchestration
 *
 * Lightweight task orchestration for multi-agent collaboration.
 * Provides task proposal, review, and execution tracking.
 *
 * @deprecated This is an MVP stub. Use lib/orchestra/mastra/workflows/ for production.
 *
 * This file was created during initial prototyping and should not be used for new development.
 * All production orchestration logic has been moved to:
 * - lib/orchestra/mastra/workflows/ - Workflow templates
 * - lib/orchestra/mastra/verification/ - Verification system
 * - lib/agent/stateful-agent.ts - Agent implementation
 *
 * Migration guide:
 * ```typescript
 * // Before
 * import { SimulatedOrchestration } from '@bing/shared/agent/simulated-orchestration';
 * const orchestrator = new SimulatedOrchestrator();
 *
 * // After - For workflow-based orchestration
 * import { WorkflowTemplates } from '@/lib/orchestra/mastra/workflows';
 * const workflow = WorkflowTemplates.getTemplate('research');
 *
 * // After - For agent-based orchestration
 * import { StatefulAgent } from '@bing/shared/agent/stateful-agent';
 * const agent = new StatefulAgent(config);
 * ```
 *
 * @see lib/orchestra/mastra/workflows/ - Production workflow templates
 * @see lib/orchestra/mastra/verification/ - Production verification system
 * @see lib/agent/stateful-agent.ts - Production agent implementation
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Agent:SimulatedOrchestration');

export interface TaskProposal {
  id: string;
  title: string;
  description: string;
  status: 'proposed' | 'approved' | 'rejected' | 'in_progress' | 'completed';
  createdAt: number;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: number;
  completedAt?: number;
  result?: any;
  assignedWorkerId?: string;
  retryCount?: number;
  execution?: {
    startedAt?: number;
    completedAt?: number;
    lastError?: string;
  };
}

export interface TaskReview {
  taskId: string;
  reviewerId: string;
  decision: 'approve' | 'reject' | 'request_changes';
  comment?: string;
  reviewedAt: number;
}

class SimulatedOrchestrator {
  private proposals = new Map<string, TaskProposal>();
  private reviews = new Map<string, TaskReview[]>();
  private executions = new Map<string, any>();

  proposeTask(options: {
    title: string;
    description: string;
    createdBy?: string;
  }): TaskProposal {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const proposal: TaskProposal = {
      id,
      title: options.title,
      description: options.description,
      status: 'proposed',
      createdAt: Date.now(),
      createdBy: options.createdBy || 'system',
      retryCount: 0,
      execution: {},
    };
    
    this.proposals.set(id, proposal);
    this.reviews.set(id, []);
    
    logger.info(`Task proposed: ${id} - ${options.title}`);
    return proposal;
  }

  reviewTask(
    taskId: string,
    reviewerId: string,
    decision: 'approve' | 'reject' | 'request_changes',
    comment?: string
  ): TaskReview {
    const proposal = this.proposals.get(taskId);
    if (!proposal) {
      throw new Error(`Task ${taskId} not found`);
    }

    const review: TaskReview = {
      taskId,
      reviewerId,
      decision,
      comment,
      reviewedAt: Date.now(),
    };

    const taskReviews = this.reviews.get(taskId) || [];
    taskReviews.push(review);
    this.reviews.set(taskId, taskReviews);

    if (decision === 'approve' && proposal.status === 'proposed') {
      proposal.status = 'approved';
      proposal.approvedBy = reviewerId;
      proposal.approvedAt = Date.now();
      this.proposals.set(taskId, proposal);
    }

    logger.info(`Task reviewed: ${taskId} - ${decision} by ${reviewerId}`);
    return review;
  }

  getReadyTasks(): TaskProposal[] {
    return Array.from(this.proposals.values()).filter(
      p => p.status === 'approved'
    );
  }

  startExecution(taskId: string): void {
    this.startExecutionWithWorker(taskId);
  }

  startExecutionWithWorker(taskId: string, workerId?: string): void {
    const proposal = this.proposals.get(taskId);
    if (!proposal) {
      throw new Error(`Task ${taskId} not found`);
    }

    // CRITICAL FIX: Only allow starting tasks from 'approved' status
    // This prevents bypassing the review gate and double-dispatching work
    if (proposal.status !== 'approved') {
      throw new Error(`Task ${taskId} cannot start from status '${proposal.status}'. Must be 'approved'.`);
    }

    const now = Date.now();
    
    proposal.status = 'in_progress';
    proposal.assignedWorkerId = workerId || proposal.assignedWorkerId;
    proposal.execution = {
      ...proposal.execution,
      startedAt: now,
    };
    this.proposals.set(taskId, proposal);
    this.executions.set(taskId, {
      startedAt: now,
      workerId: proposal.assignedWorkerId,
      attempts: (proposal.retryCount || 0) + 1,
    });

    logger.info(`Task execution started: ${taskId}${proposal.assignedWorkerId ? ` on ${proposal.assignedWorkerId}` : ''}`);
  }

  completeTask(taskId: string, result: any): void {
    const proposal = this.proposals.get(taskId);
    if (!proposal) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    proposal.status = 'completed';
    proposal.completedAt = Date.now();
    proposal.result = result;
    proposal.execution = {
      ...proposal.execution,
      completedAt: proposal.completedAt,
      lastError: undefined,
    };
    this.proposals.set(taskId, proposal);
    this.executions.delete(taskId);
    
    logger.info(`Task completed: ${taskId}`);
  }

  listProposals(): TaskProposal[] {
    return Array.from(this.proposals.values());
  }

  getProposal(taskId: string): TaskProposal | undefined {
    return this.proposals.get(taskId);
  }

  getReviews(taskId: string): TaskReview[] {
    return this.reviews.get(taskId) || [];
  }

  failTask(taskId: string, error: string, options?: { retry?: boolean; workerId?: string }): void {
    const proposal = this.proposals.get(taskId);
    if (!proposal) {
      throw new Error(`Task ${taskId} not found`);
    }

    const now = Date.now();
    
    proposal.retryCount = (proposal.retryCount || 0) + 1;
    proposal.assignedWorkerId = options?.workerId || proposal.assignedWorkerId;
    proposal.execution = {
      ...proposal.execution,
      completedAt: now,  // CRITICAL FIX: Persist completion timestamp before deleting execution
      lastError: error,
    };
    proposal.status = options?.retry ? 'approved' : 'rejected';
    this.proposals.set(taskId, proposal);
    this.executions.delete(taskId);

    logger.warn(`Task execution failed: ${taskId} (${error})`);
  }
}

export const simulatedOrchestrator = new SimulatedOrchestrator();
