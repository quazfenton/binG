/**
 * Mastra Workflow API Routes
 *
 * Provides REST API for workflow execution, status, and management.
 * Supports streaming, suspend/resume, and cancellation.
 *
 * @see lib/mastra/workflows/
 */

import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/lib/mastra/mastra-instance';

/**
 * POST /api/mastra/workflows/:workflowId/run
 *
 * Execute a workflow with the given input.
 *
 * @body {object} inputData - Workflow input data
 * @body {string} [userId] - User ID for tracking
 * @returns {object} Workflow run result
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { workflowId: string } }
) {
  try {
    const { workflowId } = params;
    const body = await request.json();
    const { inputData, userId } = body;

    if (!inputData) {
      return NextResponse.json(
        { error: 'inputData is required' },
        { status: 400 }
      );
    }

    // Get workflow
    const workflow = mastra.getWorkflow(workflowId);

    if (!workflow) {
      return NextResponse.json(
        { error: `Workflow "${workflowId}" not found` },
        { status: 404 }
      );
    }

    // Create and start run
    const run = await workflow.createRun();
    const result = await run.start({ inputData });

    return NextResponse.json({
      success: true,
      runId: run.runId,
      status: result.status,
      result: result.result,
    });
  } catch (error: any) {
    console.error('[Mastra API] Workflow execution error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/mastra/workflows/:workflowId/run/:runId
 *
 * Get workflow run status and result.
 *
 * @returns {object} Run status and result
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string; runId: string }> }
) {
  try {
    const { workflowId, runId } = await params;

    // Get workflow
    const workflow = mastra.getWorkflow(workflowId);

    if (!workflow) {
      return NextResponse.json(
        { error: `Workflow "${workflowId}" not found` },
        { status: 404 }
      );
    }

    // Get run
    const run = await workflow.createRun({ runId });
    const [status, history] = await Promise.all([
      run.getStatus(),
      run.getHistory().catch(() => []),
    ]);

    return NextResponse.json({
      runId,
      workflowId,
      status,
      history,
      createdAt: history[0]?.timestamp,
      updatedAt: history[history.length - 1]?.timestamp,
    });
  } catch (error: any) {
    console.error('[Mastra API] Get run status error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mastra/workflows/:workflowId/run/:runId/cancel
 *
 * Cancel a running workflow.
 * NOTE: This should be moved to a separate /cancel route file
 * Commented out to fix duplicate export error
 *
 * @returns {object} Cancellation result
 */
// export async function POST(
//   request: NextRequest,
//   { params }: { params: { workflowId: string; runId: string } }
// ) {
//   try {
//     const { workflowId, runId } = params;

//     // Get workflow
//     const workflow = mastra.getWorkflow(workflowId);

//     if (!workflow) {
//       return NextResponse.json(
//         { error: `Workflow "${workflowId}" not found` },
//         { status: 404 }
//       );
//     }

//     // Get run and cancel
//     const run = await workflow.createRun({ runId });
//     await run.cancel();

//     return NextResponse.json({
//       success: true,
//       runId,
//       status: 'cancelled',
//     });
//   } catch (error: any) {
//     console.error('[Mastra API] Cancel run error:', error);
//     return NextResponse.json(
//       { error: error.message },
//       { status: 500 }
//     );
//   }
// }

/**
 * POST /api/mastra/workflows/:workflowId/run/:runId/resume
 *
 * Resume a suspended workflow (HITL).
 * NOTE: This should be moved to a separate /resume route file
 * Commented out to fix duplicate export error
 *
 * @body {object} resumeData - Data to resume with
 * @body {string} stepId - Step to resume at
 * @returns {object} Resume result
 */
// export async function POST(
//   request: NextRequest,
//   { params }: { params: { workflowId: string; runId: string; action: string } }
// ) {
//   try {
//     const { workflowId, runId } = params;
//     const body = await request.json();
//     const { resumeData, stepId } = body;

//     // Get workflow
//     const workflow = mastra.getWorkflow(workflowId);

//     if (!workflow) {
//       return NextResponse.json(
//         { error: `Workflow "${workflowId}" not found` },
//         { status: 404 }
//       );
//     }

//     // Get run
//     const run = await workflow.createRun({ runId });

//     // Check status
//     const status = await run.getStatus();
//     if (status !== 'suspended') {
//       return NextResponse.json(
//         { error: `Run is not suspended. Current status: ${status}` },
//         { status: 400 }
//       );
//     }

//     // Get suspended steps
//     const suspendedSteps = await run.getSuspendedSteps();
//     if (!suspendedSteps || suspendedSteps.length === 0) {
//       return NextResponse.json(
//         { error: 'No suspended steps found' },
//         { status: 400 }
//       );
//     }

//     // Find step to resume
//     const step = suspendedSteps.find(s => s.id === stepId) || suspendedSteps[0];

//     // Resume
//     const result = await run.resume({
//       step: { id: step.id },
//       resumeData,
//     });

//     return NextResponse.json({
//       success: true,
//       runId,
//       status: result.status,
//       result: result.result,
//     });
//   } catch (error: any) {
//     console.error('[Mastra API] Resume run error:', error);
//     return NextResponse.json(
//       { error: error.message },
//       { status: 500 }
//     );
//   }
// }

/**
 * GET /api/mastra/workflows
 *
 * List all available workflows.
 *
 * @returns {object[]} Array of workflow definitions
 */
// NOTE: This GET conflicts with the main route GET, commented out
// export async function GET() {
//   try {
//     // Get all registered workflows from Mastra instance
//     const workflows = mastra.workflows;

//     const workflowList = Object.entries(workflows).map(([id, workflow]) => ({
//       id,
//       name: workflow.name || id,
//       // Note: Can't expose full workflow definition for security
//     }));

//     return NextResponse.json({
//       workflows: workflowList,
//     });
//   } catch (error: any) {
//     console.error('[Mastra API] List workflows error:', error);
//     return NextResponse.json(
//       { error: error.message },
//       { status: 500 }
//     );
//   }
// }
