/**
 * Mastra Workflow API Routes
 *
 * Provides REST API for workflow execution, status, and management.
 * Supports streaming, suspend/resume, and cancellation.
 *
 * LAZY LOADING: Mastra is loaded on first request to avoid build-time initialization
 */

import { NextRequest, NextResponse } from 'next/server';



// Lazy load Mastra to avoid build-time initialization
let _mastra: any = null;

async function getMastra() {
  if (!_mastra) {
    try {
      const { mastra } = await import('@/lib/orchestra/mastra/mastra-instance');
      _mastra = mastra;
    } catch (error) {
      console.error('[Mastra API] Failed to load Mastra:', error);
      throw new Error('Mastra not available');
    }
  }
  return _mastra;
}

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

    // Get Mastra instance (lazy loaded)
    const mastra = await getMastra();

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
    const result = await run.start({ inputData: inputData || {} });

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

    // Get Mastra instance (lazy loaded)
    const mastra = await getMastra();

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
