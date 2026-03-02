/**
 * Human-in-the-Loop (HITL) Workflow
 *
 * Implements suspend/resume pattern for human approval workflows.
 * State persists across restarts via Mastra storage.
 *
 * @see https://mastra.ai/docs/workflows/suspend-and-resume
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { getModel } from '../models/model-router';
import { writeFileTool, syntaxCheckTool } from '../tools';

// ===========================================
// Schema Definitions
// ===========================================

/**
 * Workflow input schema
 */
export const HITLInput = z.object({
  code: z.string().describe('Code to review and potentially write'),
  description: z.string().describe('Description of what the code does'),
  ownerId: z.string().describe('Workspace owner ID'),
  filePath: z.string().optional().describe('Target file path'),
  requesterId: z.string().optional().describe('User requesting the change'),
});

/**
 * Approval decision schema
 */
export const ApprovalDecision = z.object({
  approved: z.boolean().describe('Whether the code is approved'),
  feedback: z.string().optional().describe('Optional feedback if rejected'),
  modifications: z.string().optional().describe('Optional code modifications'),
  approverId: z.string().describe('ID of the approver'),
  approverEmail: z.string().email().describe('Email of the approver'),
});

/**
 * Suspend data schema (stored when paused)
 */
export const SuspendData = z.object({
  reason: z.string().describe('Reason for suspension'),
  codePreview: z.string().describe('First 500 chars of code'),
  fullCode: z.string().describe('Complete code for review'),
  filePath: z.string().optional().describe('Target file path'),
  syntaxErrors: z.array(z.string()).optional().describe('Any syntax errors found'),
  requesterId: z.string().optional().describe('User requesting the change'),
  requestedAt: z.number().describe('Timestamp of request'),
  approvalDeadline: z.number().describe('Timestamp when approval expires'),
});

/**
 * Workflow state schema
 */
export const WorkflowState = z.object({
  currentStep: z.string(),
  approvalCount: z.number().default(0),
  errors: z.array(z.object({
    step: z.string(),
    message: z.string(),
    timestamp: z.number(),
  })).default([]),
});

// ===========================================
// Step Definitions
// ===========================================

/**
 * Step 1: Syntax Check
 *
 * Validates code syntax before human review
 */
export const syntaxCheckStep = createStep({
  id: 'syntax-check',
  inputSchema: HITLInput,
  outputSchema: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()).optional(),
    code: z.string(),
    description: z.string(),
    ownerId: z.string(),
    filePath: z.string().optional(),
    requesterId: z.string().optional(),
  }),
  stateSchema: WorkflowState,
  execute: async ({ inputData, state, setState }) => {
    const { code, description, ownerId, filePath, requesterId } = inputData;

    try {
      setState({ ...state, currentStep: 'syntax-check' });

      const result = await syntaxCheckTool.execute({
        context: { code, language: 'typescript' },
      });

      return {
        valid: result.valid,
        errors: result.errors || [],
        code,
        description,
        ownerId,
        filePath,
        requesterId,
      };
    } catch (error) {
      setState({
        ...state,
        errors: [...state.errors, {
          step: 'syntax-check',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        }],
      });
      throw error;
    }
  },
  retries: 1,
});

/**
 * Step 2: Human Approval (Suspend/Resume)
 *
 * Suspends workflow for human review, resumes with decision
 * 
 * FIXED: Proper suspend/resume pattern with full context preservation
 */
export const approvalStep = createStep({
  id: 'approval',
  inputSchema: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    code: z.string(),
    description: z.string(),
    ownerId: z.string(),
    filePath: z.string().optional(),
    requesterId: z.string().optional(),
  }),
  resumeSchema: ApprovalDecision,
  suspendSchema: SuspendData,
  outputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    modifications: z.string().optional(),
    code: z.string(),
    description: z.string(),
    ownerId: z.string(),
  }),
  stateSchema: WorkflowState,
  execute: async ({ inputData, resumeData, suspend, state, setState }) => {
    const { valid, errors, code, description, ownerId, filePath, requesterId } = inputData;

    try {
      setState({ ...state, currentStep: 'approval' });

      // Check if resuming with approval data
      if (resumeData?.approved !== undefined) {
        if (!resumeData.approved) {
          // Return structured rejection, don't throw
          return {
            approved: false,
            feedback: resumeData.feedback || 'No feedback provided',
            code,
            description,
            ownerId,
          };
        }

        // Apply modifications if provided
        const finalCode = resumeData.modifications || code;

        return {
          approved: true,
          feedback: resumeData.feedback,
          modifications: resumeData.modifications,
          code: finalCode,
          description,
          ownerId,
        };
      }

      // First execution - suspend for approval
      const approvalDeadline = Date.now() + 300000; // 5 minutes from now

      return await suspend({
        reason: valid
          ? 'Code review required before writing to filesystem'
          : `Syntax errors found: ${errors.join(', ')}`,
        codePreview: code.slice(0, 500) + (code.length > 500 ? '...' : ''),
        fullCode: code,
        filePath: filePath || 'output/generated.ts',
        syntaxErrors: valid ? [] : errors,
        requesterId: requesterId || 'unknown',
        requestedAt: Date.now(),
        approvalDeadline,
      });
    } catch (error) {
      setState({
        ...state,
        errors: [...state.errors, {
          step: 'approval',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        }],
      });
      throw error;
    }
  },
  retries: 1,
});

/**
 * Step 3: Write File
 *
 * Writes approved code to filesystem
 * 
 * FIXED: Changed from context.getStepPayload() to inputData per Mastra SDK
 */
export const writeStep = createStep({
  id: 'write-file',
  inputSchema: z.object({
    approved: z.boolean(),
    code: z.string(),
    description: z.string(),
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    path: z.string(),
    success: z.boolean(),
    version: z.number(),
  }),
  stateSchema: WorkflowState,
  execute: async ({ inputData, state, setState }) => {
    // FIXED: Use inputData directly instead of context.getStepPayload()
    const { code, ownerId } = inputData;

    try {
      setState({ ...state, currentStep: 'write-file' });

      const result = await writeFileTool.execute({
        context: {
          path: 'output/generated.ts',
          content: code,
          ownerId
        },
      });

      return { path: result.path, success: result.success, version: result.version };
    } catch (error) {
      setState({
        ...state,
        errors: [...state.errors, {
          step: 'write-file',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        }],
      });
      throw error;
    }
  },
  retries: 1,
});

// ===========================================
// Workflow Definition
// ===========================================

/**
 * HITL Code Review Workflow
 *
 * Suspends for human approval before writing code
 */
export const hitlWorkflow = createWorkflow({
  id: 'hitl-code-review',
  name: 'Human-in-the-Loop Code Review',
  inputSchema: HITLInput,
  outputSchema: z.object({
    path: z.string(),
    success: z.boolean(),
    version: z.number(),
    approved: z.boolean(),
    approverId: z.string().optional(),
    approvedAt: z.number().optional(),
  }),
  stateSchema: WorkflowState,
  retryConfig: {
    attempts: 1,
    delay: 500,
  },
  options: {
    onFinish: async ({ status, result, error, runId }) => {
      console.log(`[HITL] Workflow ${runId} finished with status: ${status}`);
      if (status === 'suspended') {
        console.log('[HITL] Workflow suspended - waiting for approval');
      }
    },
    onError: async ({ error, runId }) => {
      console.error(`[HITL] Workflow ${runId} error:`, error);
    },
  },
})
  .then(syntaxCheckStep)
  .then(approvalStep)
  .then(writeStep)
  .commit();

/**
 * Get HITL workflow by ID
 */
export function getHITLWorkflow() {
  return hitlWorkflow;
}

/**
 * Get approval step for resume operations
 */
export function getApprovalStep() {
  return approvalStep;
}
