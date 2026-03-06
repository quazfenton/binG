/**
 * Mastra Workflow Execution API
 *
 * Streams workflow execution results via SSE.
 * Supports both code-agent and hitl workflows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/lib/mastra/mastra-instance';

// Valid workflow types
const VALID_WORKFLOWS = ['code-agent', 'hitl-code-review'];

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
    const result = await run.start({ data: inputData || {} });

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
