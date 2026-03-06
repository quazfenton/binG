/**
 * Mastra Workflow API Routes
 *
 * Provides REST API for workflow execution, status, and management.
 * Supports streaming, suspend/resume, and cancellation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/lib/mastra/mastra-instance';

/**
 * POST /api/mastra/workflows/:workflowId/run
 *
 * Execute a workflow with the given input.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const body = await request.json();
    const { inputData, userId } = body;

    // Get workflow
    const workflow = mastra.getWorkflow(workflowId);

    if (!workflow) {
      return NextResponse.json(
        { error: `Workflow "${workflowId}" not found` },
        { status: 404 }
      );
    }

    // Execute workflow
    const run = await workflow.createRun();
    const result = await run.start({ data: inputData || {} });

    return NextResponse.json({
      success: true,
      runId: run.runId,
      result,
    });
  } catch (error) {
    console.error(`[Mastra API] Workflow execution error:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Workflow execution failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/mastra/workflows/:workflowId/status
 *
 * Get workflow status.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');

    if (!runId) {
      return NextResponse.json(
        { error: 'runId is required' },
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

    // Get run state
    const runState = await workflow.getWorkflowRunById(runId);

    if (!runState) {
      return NextResponse.json(
        { error: `Run ${runId} not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      status: runState.status,
      steps: runState.steps,
      createdAt: runState.createdAt,
      updatedAt: runState.updatedAt,
    });
  } catch (error) {
    console.error(`[Mastra API] Status error:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Status check failed' },
      { status: 500 }
    );
  }
}
