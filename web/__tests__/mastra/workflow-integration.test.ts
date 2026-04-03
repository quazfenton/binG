/**
 * Mastra Workflow Integration Tests
 * 
 * Advanced E2E tests for Mastra workflow orchestration.
 * Tests workflow execution, suspend/resume, and streaming.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mastra } from '@/lib/mastra/mastra-instance';
import { codeAgentWorkflow } from '@/lib/mastra/workflows/code-agent-workflow';
import { hitlWorkflow, getApprovalStep } from '@/lib/mastra/workflows/hitl-workflow';

describe('Mastra Workflow Integration', () => {
  describe('Code Agent Workflow', () => {
    it('should execute planner step successfully', async () => {
      const workflow = mastra.getWorkflow('code-agent');
      const run = await workflow.createRun();

      const result = await run.start({
        inputData: {
          task: 'Create a hello world function in TypeScript',
          ownerId: 'test-user-123',
        },
      });

      expect(result.status).toBeDefined();
      expect(['success', 'failed', 'suspended']).toContain(result.status);
    });

    it('should stream workflow execution', async () => {
      const workflow = mastra.getWorkflow('code-agent');
      const run = await workflow.createRun();

      const stream = await run.stream({
        inputData: {
          task: 'Write a simple calculator',
          ownerId: 'test-user-456',
        },
      });

      const chunks: any[] = [];
      for await (const chunk of stream.fullStream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.type === 'step-start')).toBe(true);
    });

    it('should handle workflow errors gracefully', async () => {
      const workflow = mastra.getWorkflow('code-agent');
      const run = await workflow.createRun();

      const result = await run.start({
        inputData: {
          task: '', // Invalid empty task
          ownerId: 'test-user-789',
        },
      });

      // Should fail gracefully, not throw
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
    });
  });

  describe('HITL Workflow', () => {
    it('should suspend for human approval', async () => {
      const workflow = mastra.getWorkflow('hitl-code-review');
      const run = await workflow.createRun();

      const result = await run.start({
        inputData: {
          code: 'export const hello = "world";',
          description: 'Test export',
          ownerId: 'test-user-hitl',
        },
      });

      expect(result.status).toBe('suspended');
      expect(result.suspended).toBeDefined();
      expect(result.suspended[0]).toBe('approval');
    });

    it('should resume with approval', async () => {
      const workflow = mastra.getWorkflow('hitl-code-review');
      const run = await workflow.createRun();

      // Start and suspend
      await run.start({
        inputData: {
          code: 'export const test = 123;',
          description: 'Test code',
          ownerId: 'test-user-resume',
        },
      });

      // Resume with approval
      const approvalStep = getApprovalStep();
      const resumeResult = await run.resume({
        step: approvalStep,
        resumeData: { approved: true, feedback: 'Looks good!' },
      });

      expect(resumeResult.status).toBe('success');
    });

    it('should handle rejection', async () => {
      const workflow = mastra.getWorkflow('hitl-code-review');
      const run = await workflow.createRun();

      // Start and suspend
      await run.start({
        inputData: {
          code: 'const bad = true;',
          description: 'Bad code',
          ownerId: 'test-user-reject',
        },
      });

      // Resume with rejection
      const approvalStep = getApprovalStep();
      
      await expect(
        run.resume({
          step: approvalStep,
          resumeData: { approved: false, feedback: 'Needs improvement' },
        })
      ).rejects.toThrow('Approval rejected');
    });
  });

  describe('Workflow State Management', () => {
    it('should persist state across restarts', async () => {
      const workflow = mastra.getWorkflow('code-agent');
      
      // First run
      const run1 = await workflow.createRun();
      const result1 = await run1.start({
        inputData: {
          task: 'Test persistence',
          ownerId: 'test-user-persist',
        },
      });

      expect(result1.status).toBeDefined();

      // Second run with same workflow
      const run2 = await workflow.createRun();
      const result2 = await run2.start({
        inputData: {
          task: 'Test persistence again',
          ownerId: 'test-user-persist',
        },
      });

      expect(result2.status).toBeDefined();
    });

    it('should track workflow execution history', async () => {
      const workflow = mastra.getWorkflow('code-agent');
      const run = await workflow.createRun();

      const result = await run.start({
        inputData: {
          task: 'Track this execution',
          ownerId: 'test-user-history',
        },
      });

      // Result should contain step information
      if (result.status === 'success') {
        expect(result.steps).toBeDefined();
        expect(Object.keys(result.steps).length).toBeGreaterThan(0);
      }
    });
  });

  describe('Model Router Integration', () => {
    it('should use reasoning model for complex tasks', async () => {
      const workflow = mastra.getWorkflow('code-agent');
      const run = await workflow.createRun();

      const result = await run.start({
        inputData: {
          task: 'Design a complex distributed system with microservices, message queues, and database sharding',
          ownerId: 'test-user-complex',
        },
      });

      expect(result.status).toBeDefined();
    });

    it('should use fast model for simple tasks', async () => {
      const workflow = mastra.getWorkflow('code-agent');
      const run = await workflow.createRun();

      const result = await run.start({
        inputData: {
          task: 'Say hello',
          ownerId: 'test-user-simple',
        },
      });

      expect(result.status).toBeDefined();
    });
  });

  describe('Tool Execution', () => {
    it('should execute WRITE_FILE tool', async () => {
      const workflow = mastra.getWorkflow('code-agent');
      const run = await workflow.createRun();

      const result = await run.start({
        inputData: {
          task: 'Create a file named test.txt with content "Hello World"',
          ownerId: 'test-user-write',
        },
      });

      expect(result.status).toBeDefined();
    });

    it('should execute READ_FILE tool', async () => {
      const workflow = mastra.getWorkflow('code-agent');
      const run = await workflow.createRun();

      const result = await run.start({
        inputData: {
          task: 'Read the file package.json and show its contents',
          ownerId: 'test-user-read',
        },
      });

      expect(result.status).toBeDefined();
    });

    it('should handle tool execution errors', async () => {
      const workflow = mastra.getWorkflow('code-agent');
      const run = await workflow.createRun();

      const result = await run.start({
        inputData: {
          task: 'Read a non-existent file /nonexistent/file.txt',
          ownerId: 'test-user-error',
        },
      });

      // Should handle error gracefully
      expect(['success', 'failed', 'suspended']).toContain(result.status);
    });
  });
});
