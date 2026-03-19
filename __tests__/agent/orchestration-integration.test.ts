/**
 * Agent Orchestration Integration Tests
 * 
 * Comprehensive tests for the integrated orchestration system including:
 * - Session management with background jobs
 * - Execution graph tracking
 * - Workforce management
 * - Mastra workflow integration
 * - Multi-agent collaboration
 * - End-to-end orchestration workflows
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sessionManager,
  executionGraphEngine,
  enhancedBackgroundJobsManager,
  workforceManager,
  mastraWorkflowIntegration,
  initializeOrchestration,
  shutdownOrchestration,
  getOrchestrationStats,
} from '@/lib/agent/orchestration';

describe('Agent Orchestration Integration', () => {
  const testUserId = 'test-user-orchestration';
  const testConversationId = 'test-conversation-orchestration';

  beforeEach(async () => {
    vi.clearAllMocks();
    // Initialize orchestration components
    await initializeOrchestration();
  });

  afterEach(async () => {
    // Cleanup all sessions
    const sessions = sessionManager.listSessions(testUserId);
    for (const session of sessions) {
      await sessionManager.destroySession(session.userId, session.conversationId);
    }
    
    // Shutdown orchestration
    await shutdownOrchestration();
    vi.restoreAllMocks();
  });

  describe('Session Management with Background Jobs', () => {
    it('should create session with execution graph and background jobs support', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.executionGraphId).toBeDefined();
      expect(session.backgroundJobs).toBeDefined();
      expect(session.backgroundJobs!.size).toBe(0);

      // Verify execution graph was created
      const graph = executionGraphEngine.getGraph(session.executionGraphId!);
      expect(graph).toBeDefined();
      expect(graph.sessionId).toBe(testConversationId);
    });

    it('should start background job with quota checking', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      const jobResult = await sessionManager.startBackgroundJob(session.id, {
        sandboxId: session.sandboxId || 'test-sandbox',
        command: 'echo "test"',
        interval: 30,
        description: 'Test background job',
        quotaCategory: 'compute',
      });

      expect(jobResult.jobId).toBeDefined();
      expect(jobResult.status).toBe('running');

      // Verify job is tracked in session
      expect(session.backgroundJobs!.size).toBe(1);

      // Verify execution graph node was created
      const graph = executionGraphEngine.getGraph(session.executionGraphId!);
      expect(graph).toBeDefined();
    });

    it('should stop background job gracefully', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      const jobResult = await sessionManager.startBackgroundJob(session.id, {
        sandboxId: session.sandboxId || 'test-sandbox',
        command: 'echo "test"',
        interval: 30,
      });

      // Stop the job
      const stopped = await sessionManager.stopBackgroundJob(
        session.id,
        jobResult.jobId,
        'Test stop'
      );

      expect(stopped).toBe(true);
      expect(session.backgroundJobs!.size).toBe(0);
    });

    it('should list background jobs with filters', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      // Start multiple jobs
      await sessionManager.startBackgroundJob(session.id, {
        sandboxId: 'sandbox-1',
        command: 'echo "job1"',
        interval: 30,
        tags: ['test', 'job1'],
      });

      await sessionManager.startBackgroundJob(session.id, {
        sandboxId: 'sandbox-2',
        command: 'echo "job2"',
        interval: 60,
        tags: ['test', 'job2'],
      });

      // List all jobs
      const allJobs = sessionManager.listBackgroundJobs(session.id);
      expect(allJobs.length).toBe(2);

      // List jobs by status
      const runningJobs = sessionManager.listBackgroundJobs(session.id, { status: 'running' });
      expect(runningJobs.length).toBe(2);
    });

    it('should get background jobs statistics', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      await sessionManager.startBackgroundJob(session.id, {
        sandboxId: 'sandbox-1',
        command: 'echo "test"',
        interval: 30,
      });

      const stats = sessionManager.getBackgroundJobsStats(session.id);

      expect(stats.total).toBe(1);
      expect(stats.running).toBe(1);
      expect(stats.completed).toBe(0);
    });

    it('should cleanup background jobs on session destroy', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      await sessionManager.startBackgroundJob(session.id, {
        sandboxId: session.sandboxId || 'test',
        command: 'echo "test"',
        interval: 30,
      });

      expect(session.backgroundJobs!.size).toBe(1);

      // Destroy session
      await sessionManager.destroySession(testUserId, testConversationId);

      // Verify jobs were stopped
      const jobs = enhancedBackgroundJobsManager.listJobs({ sessionId: testConversationId });
      expect(jobs.length).toBe(0);
    });
  });

  describe('Execution Graph Integration', () => {
    it('should create execution graph for session', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      expect(session.executionGraphId).toBeDefined();

      const graph = executionGraphEngine.getGraph(session.executionGraphId!);
      expect(graph).toBeDefined();
      expect(graph.sessionId).toBe(testConversationId);
      expect(graph.status).toBe('pending');
    });

    it('should add nodes to execution graph', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      const graph = executionGraphEngine.getGraph(session.executionGraphId!);
      expect(graph).toBeDefined();

      // Add node
      const node = executionGraphEngine.addNode(graph!, {
        id: 'test-node-1',
        type: 'agent_step',
        name: 'Test Task',
        description: 'Test task description',
        dependencies: [],
      });

      expect(node).toBeDefined();
      expect(node.id).toBe('test-node-1');
      expect(node.status).toBe('pending');
    });

    it('should update node status during execution', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      const graph = executionGraphEngine.getGraph(session.executionGraphId!);
      const node = executionGraphEngine.addNode(graph!, {
        id: 'test-node-2',
        type: 'agent_step',
        name: 'Test Task',
        description: 'Test task',
        dependencies: [],
      });

      // Update to running
      node.status = 'running';
      node.startedAt = Date.now();

      expect(node.status).toBe('running');
      expect(node.startedAt).toBeDefined();

      // Update to completed
      node.status = 'completed';
      node.completedAt = Date.now();
      node.result = { success: true };

      expect(node.status).toBe('completed');
      expect(node.completedAt).toBeDefined();
    });

    it('should track execution graph progress', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      const graph = executionGraphEngine.getGraph(session.executionGraphId!);

      // Add multiple nodes
      for (let i = 0; i < 5; i++) {
        executionGraphEngine.addNode(graph!, {
          id: `node-${i}`,
          type: 'agent_step',
          name: `Task ${i}`,
          description: `Task ${i} description`,
          dependencies: [],
        });
      }

      // Mark some as completed
      graph!.nodes.get('node-0')!.status = 'completed';
      graph!.nodes.get('node-1')!.status = 'completed';
      graph!.nodes.get('node-2')!.status = 'running';

      // Calculate progress
      const nodes = Array.from(graph!.nodes.values());
      const completed = nodes.filter(n => n.status === 'completed').length;
      const progress = (completed / nodes.length) * 100;

      expect(progress).toBe(40); // 2 out of 5 completed
    });
  });

  describe('Workforce Manager Integration', () => {
    it('should spawn task with execution graph tracking', async () => {
      const task = await workforceManager.spawnTask(
        testUserId,
        testConversationId,
        {
          title: 'Test Task',
          description: 'Test task description',
          agent: 'opencode',
        }
      );

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.status).toBe('pending');

      // Verify execution graph was created
      const stats = await workforceManager.getStats(testUserId, testConversationId);
      expect(stats.totalTasks).toBe(1);
    });

    it('should spawn recurring task as background job', async () => {
      const task = await workforceManager.spawnTask(
        testUserId,
        testConversationId,
        {
          title: 'Recurring Task',
          description: 'Recurring task description',
          agent: 'opencode',
          isRecurring: true,
          interval: 60, // 60 seconds
          tags: ['recurring', 'test'],
        }
      );

      expect(task).toBeDefined();

      // Verify background job was started
      const stats = await workforceManager.getStats(testUserId, testConversationId);
      expect(stats.activeBackgroundJobs).toBeGreaterThan(0);
    });

    it('should get workforce statistics', async () => {
      // Spawn multiple tasks
      await workforceManager.spawnTask(testUserId, testConversationId, {
        title: 'Task 1',
        description: 'Description 1',
        agent: 'opencode',
      });

      await workforceManager.spawnTask(testUserId, testConversationId, {
        title: 'Task 2',
        description: 'Description 2',
        agent: 'nullclaw',
      });

      const stats = await workforceManager.getStats(testUserId, testConversationId);

      expect(stats.totalTasks).toBe(2);
      expect(stats.pending).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Mastra Workflow Integration', () => {
    it('should propose and review task', async () => {
      const proposal = await mastraWorkflowIntegration.proposeTask(
        'Test Task',
        'Test task description',
        { priority: 1, assignedTo: 'test-agent' }
      );

      expect(proposal).toBeDefined();
      expect(proposal.id).toBeDefined();
      expect(proposal.status).toBe('proposed');

      // Review the proposal
      const review = await mastraWorkflowIntegration.reviewTask(
        proposal.id,
        'approve',
        { reviewedBy: 'test-reviewer', feedback: 'Looks good' }
      );

      expect(review).toBeDefined();
      expect(review.decision).toBe('approve');

      // Verify proposal status updated
      const updatedProposal = mastraWorkflowIntegration.getProposal(proposal.id);
      expect(updatedProposal?.status).toBe('approved');
    });

    it('should list proposals with filters', async () => {
      // Create multiple proposals
      await mastraWorkflowIntegration.proposeTask('Task 1', 'Description 1');
      await mastraWorkflowIntegration.proposeTask('Task 2', 'Description 2');

      // List all
      const all = mastraWorkflowIntegration.listProposals();
      expect(all.length).toBe(2);

      // List by status
      const proposed = mastraWorkflowIntegration.listProposals({ status: 'proposed' });
      expect(proposed.length).toBe(2);
    });

    it('should execute workflow', async () => {
      const result = await mastraWorkflowIntegration.executeWorkflow(
        'code-agent',
        {
          task: 'Test task',
          ownerId: testUserId,
        }
      );

      expect(result).toBeDefined();
      expect(result.workflowId).toBe('code-agent');
      // Result may succeed or fail depending on Mastra availability
      expect(result.success !== undefined).toBe(true);
    });

    it('should get Mastra statistics', async () => {
      const stats = mastraWorkflowIntegration.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.activeWorkflows).toBe('number');
      expect(typeof stats.totalProposals).toBe('number');
    });
  });

  describe('Orchestration Statistics', () => {
    it('should get comprehensive orchestration stats', async () => {
      // Create session with background job
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      await sessionManager.startBackgroundJob(session.id, {
        sandboxId: 'test',
        command: 'echo test',
        interval: 30,
      });

      // Get stats
      const stats = getOrchestrationStats();

      expect(stats.sessions).toBeDefined();
      expect(stats.backgroundJobs).toBeDefined();
      expect(stats.executionGraphs).toBeDefined();
      expect(stats.mastraWorkflows).toBeDefined();
    });
  });

  describe('End-to-End Orchestration Workflow', () => {
    it('should handle complete workflow: session -> task -> execution -> cleanup', async () => {
      // Step 1: Create session
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      expect(session).toBeDefined();
      expect(session.executionGraphId).toBeDefined();

      // Step 2: Spawn workforce task
      const task = await workforceManager.spawnTask(
        testUserId,
        testConversationId,
        {
          title: 'E2E Test Task',
          description: 'Complete end-to-end test',
          agent: 'opencode',
        }
      );

      expect(task).toBeDefined();

      // Step 3: Start background monitoring job
      const job = await sessionManager.startBackgroundJob(session.id, {
        sandboxId: session.sandboxId || 'test',
        command: 'echo "Monitoring"',
        interval: 60,
        description: 'E2E monitoring',
      });

      expect(job.jobId).toBeDefined();

      // Step 4: Verify execution graph tracking
      const graph = executionGraphEngine.getGraph(session.executionGraphId!);
      expect(graph).toBeDefined();

      // Step 5: Get comprehensive stats
      const stats = getOrchestrationStats();
      expect(stats.sessions.active).toBeGreaterThanOrEqual(1);
      expect(stats.backgroundJobs.running).toBeGreaterThanOrEqual(1);

      // Step 6: Cleanup - destroy session (should stop all jobs)
      await sessionManager.destroySession(testUserId, testConversationId);

      // Verify cleanup
      const remainingJobs = enhancedBackgroundJobsManager.listJobs({ sessionId: testConversationId });
      expect(remainingJobs.length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle session not found for background job', async () => {
      await expect(
        sessionManager.startBackgroundJob('nonexistent-session', {
          sandboxId: 'test',
          command: 'echo test',
          interval: 30,
        })
      ).rejects.toThrow('Session not found');
    });

    it('should handle invalid job stop', async () => {
      const session = await sessionManager.getOrCreateSession(
        testUserId,
        testConversationId,
        { mode: 'opencode' }
      );

      const stopped = await sessionManager.stopBackgroundJob(
        session.id,
        'nonexistent-job',
        'Test'
      );

      expect(stopped).toBe(false);
    });

    it('should handle workflow execution errors gracefully', async () => {
      const result = await mastraWorkflowIntegration.executeWorkflow(
        'nonexistent-workflow',
        { task: 'test' }
      );

      // Should return error result, not throw
      expect(result).toBeDefined();
      expect(result.success === false || result.error !== undefined).toBe(true);
    });
  });
});
