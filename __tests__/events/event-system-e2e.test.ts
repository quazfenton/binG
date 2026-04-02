/**
 * Event System End-to-End Tests
 *
 * Tests for the complete event system including:
 * - Event emission and retrieval
 * - Scheduled tasks
 * - Event routing and handling
 * - Self-healing
 * - Human approvals
 * - DAG execution
 *
 * Run: pnpm test __tests__/events/event-system-e2e.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  emitEvent,
  getEventsByUser,
  getEventById,
  getEventStats,
  initializeEventSystem,
  EventTypes,
} from '@/lib/events';
import { createScheduledTask, getScheduledTasks } from '@/lib/events/scheduler';
import { createApprovalRequest, getPendingApprovals } from '@/lib/events/human-in-loop';
import { validateDAG, createDAGFromPipeline } from '@/lib/events/handlers/dag-execution';

describe('Event System E2E', () => {
  const testUserId = 'test-user-e2e';
  const testSessionId = 'test-session-e2e';

  beforeEach(async () => {
    // Initialize event system before each test
    await initializeEventSystem();
  });

  afterEach(async () => {
    // Cleanup after tests
    // In production, you'd delete test events
  });

  describe('Event Emission', () => {
    it('should emit and retrieve event', async () => {
      // Emit event
      const result = await emitEvent(
        {
          type: EventTypes.NOTIFICATION,
          userId: testUserId,
          title: 'Test Notification',
          message: 'This is a test',
          channel: 'in-app',
          priority: 'normal',
        },
        testUserId,
        testSessionId
      );

      expect(result.eventId).toBeDefined();
      expect(result.status).toBe('queued');

      // Retrieve event
      const event = await getEventById(result.eventId);

      expect(event).toBeDefined();
      expect(event?.type).toBe(EventTypes.NOTIFICATION);
      expect(event?.userId).toBe(testUserId);
      expect(event?.sessionId).toBe(testSessionId);
    });

    it('should get events by user', async () => {
      // Emit multiple events
      await emitEvent(
        {
          type: EventTypes.NOTIFICATION,
          userId: testUserId,
          title: 'Test 1',
          message: 'Message 1',
          channel: 'in-app',
        },
        testUserId
      );

      await emitEvent(
        {
          type: EventTypes.NOTIFICATION,
          userId: testUserId,
          title: 'Test 2',
          message: 'Message 2',
          channel: 'in-app',
        },
        testUserId
      );

      // Get user events
      const events = await getEventsByUser(testUserId, 10);

      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it('should get event statistics', async () => {
      const stats = await getEventStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
    });
  });

  describe('Scheduled Tasks', () => {
    it('should create and retrieve scheduled task', async () => {
      const taskId = await createScheduledTask(
        testUserId,
        'HACKER_NEWS_DAILY',
        '0 9 * * *', // Every day at 9 AM
        { destination: 'test@example.com' }
      );

      expect(taskId).toBeDefined();

      const tasks = await getScheduledTasks(testUserId);

      expect(tasks.length).toBeGreaterThanOrEqual(1);
      const task = tasks.find((t) => t.id === taskId);
      expect(task).toBeDefined();
      expect(task?.cron_expression).toBe('0 9 * * *');
    });

    it('should calculate next run time', async () => {
      const { calculateNextRun } = await import('@/lib/events/scheduler');

      const nextRun = calculateNextRun('0 9 * * *');

      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun.getHours()).toBe(9);
    });
  });

  describe('Human Approvals', () => {
    it('should create and retrieve approval request', async () => {
      const approval = await createApprovalRequest(
        'event-123',
        'Deploy to production',
        { environment: 'production', version: '1.0.0' },
        { timeout: 24 * 60 * 60 * 1000 }
      );

      expect(approval.id).toBeDefined();
      expect(approval.status).toBe('pending');
      expect(approval.action).toBe('Deploy to production');

      const pending = await getPendingApprovals();

      expect(pending.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('DAG Execution', () => {
    it('should create DAG from pipeline', async () => {
      const dag = createDAGFromPipeline('curl api | jq ".items" | grep AI');

      expect(dag.nodes.length).toBe(3);
      expect(dag.nodes[0].command).toBe('curl api');
      expect(dag.nodes[1].dependsOn).toEqual(['step-0']);
    });

    it('should validate valid DAG', async () => {
      const dag = {
        nodes: [
          { id: 'a', type: 'bash' as const, command: 'echo a', dependsOn: [] },
          { id: 'b', type: 'bash' as const, command: 'echo b', dependsOn: ['a'] },
        ],
      };

      const validation = validateDAG(dag);

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should reject invalid DAG with circular dependency', async () => {
      const dag = {
        nodes: [
          { id: 'a', type: 'bash' as const, command: 'echo a', dependsOn: ['b'] },
          { id: 'b', type: 'bash' as const, command: 'echo b', dependsOn: ['a'] },
        ],
      };

      const validation = validateDAG(dag);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Circular'))).toBe(true);
    });

    it('should reject DAG with missing dependency', async () => {
      const dag = {
        nodes: [
          { id: 'a', type: 'bash' as const, command: 'echo a', dependsOn: ['nonexistent'] },
        ],
      };

      const validation = validateDAG(dag);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('non-existent'))).toBe(true);
    });
  });

  describe('Event Types', () => {
    it('should emit SCHEDULED_TASK event', async () => {
      const result = await emitEvent(
        {
          type: EventTypes.SCHEDULED_TASK,
          taskType: 'HACKER_NEWS_DAILY',
          userId: testUserId,
          payload: { destination: 'test@example.com' },
        },
        testUserId
      );

      expect(result.eventId).toBeDefined();
    });

    it('should emit BASH_EXECUTION event', async () => {
      const result = await emitEvent(
        {
          type: EventTypes.BASH_EXECUTION,
          command: 'echo hello',
          agentId: testUserId,
          sessionId: testSessionId,
        },
        testUserId,
        testSessionId
      );

      expect(result.eventId).toBeDefined();
    });

    it('should emit DAG_EXECUTION event', async () => {
      const dag = createDAGFromPipeline('echo hello');

      const result = await emitEvent(
        {
          type: EventTypes.DAG_EXECUTION,
          dag,
          agentId: testUserId,
          sessionId: testSessionId,
        },
        testUserId,
        testSessionId
      );

      expect(result.eventId).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid event type', async () => {
      await expect(
        emitEvent(
          {
            type: 'INVALID_TYPE' as any,
            userId: testUserId,
          },
          testUserId
        )
      ).rejects.toThrow();
    });

    it('should handle missing required fields', async () => {
      await expect(
        emitEvent(
          {
            type: EventTypes.NOTIFICATION,
            userId: testUserId,
            // Missing required fields
          } as any,
          testUserId
        )
      ).rejects.toThrow();
    });
  });
});
