/**
 * Mastra Workflow Execution API
 *
 * Streams workflow execution results via SSE.
 * Supports both code-agent and hitl workflows.
 *
 * LAZY LOADING: Mastra is loaded on first request to avoid build-time initialization
 */

import { NextRequest, NextResponse } from 'next/server';

// Valid workflow types
const VALID_WORKFLOWS = ['code-agent', 'hitl-code-review'];

// Lazy load Mastra to avoid build-time initialization
let _mastra: any = null;

async function getMastra() {
  if (!_mastra) {
    try {
      const { mastra } = await import('@/lib/orchestra/mastra/mastra-instance');
      _mastra = mastra;
    } catch (error) {
      console.error('[Mastra API] Failed to load Mastra:', error);
      throw new Error('Mastra not available - check DATABASE_URL and configuration');
    }
  }
  return _mastra;
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const abortController = new AbortController();

  try {
    // Parse and validate request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body', requestId },
        { status: 400 }
      );
    }

    const { workflowType, inputData, userId } = body;

    // Validate workflow type
    if (!workflowType || !VALID_WORKFLOWS.includes(workflowType)) {
      return NextResponse.json(
        { error: `Invalid workflowType. Must be one of: ${VALID_WORKFLOWS.join(', ')}`, requestId },
        { status: 400 }
      );
    }

    // Get Mastra instance (lazy loaded)
    const mastra = await getMastra();

    // Get workflow
    const workflow = mastra.getWorkflow(workflowType);

    if (!workflow) {
      return NextResponse.json(
        { error: `Workflow "${workflowType}" not found`, requestId },
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
      requestId,
    });
  } catch (error) {
    console.error(`[Mastra API] Workflow error (${requestId}):`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Workflow execution failed', requestId },
      { status: 500 }
    );
  }
}
