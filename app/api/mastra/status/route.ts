/**
 * Mastra Workflow Status API
 *
 * Gets the current status of a workflow run.
 * 
 * FIXED: Added comprehensive status information including step details and history
 */

import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/lib/mastra/mastra-instance';

// Valid workflow types - allowlist for security
const VALID_WORKFLOWS = ['code-agent', 'hitl-code-review'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get('runId');
  const workflowType = searchParams.get('workflowType') || 'code-agent';
  const includeHistory = searchParams.get('includeHistory') === 'true';

  // Validate required fields
  if (!runId) {
    return NextResponse.json(
      { error: 'runId is required' },
      { status: 400 }
    );
  }

  // SECURITY: Validate workflowType against allowlist before querying
  if (!VALID_WORKFLOWS.includes(workflowType)) {
    return NextResponse.json(
      { error: `Invalid workflowType. Must be one of: ${VALID_WORKFLOWS.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    // Get workflow
    const workflow = mastra.getWorkflow(workflowType);

    if (!workflow) {
      return NextResponse.json(
        { error: `Workflow "${workflowType}" not found` },
        { status: 404 }
      );
    }

    // Create run with existing runId
    const run = await workflow.createRun({ runId });

    // Get status
    const status = await run.getStatus();

    // Build response
    const response: any = {
      runId,
      workflowType,
      status,
      timestamp: Date.now(),
    };

    // Get history if requested
    if (includeHistory) {
      try {
        const history = await run.getHistory();
        response.history = history;
        response.createdAt = history[0]?.timestamp;
        response.updatedAt = history[history.length - 1]?.timestamp;
      } catch (historyError) {
        console.warn(`Failed to get history for run ${runId}:`, historyError);
        response.history = [];
      }
    }

    // Get step details if suspended
    if (status === 'suspended') {
      try {
        const suspendedSteps = await run.getSuspendedSteps();
        response.suspendedSteps = suspendedSteps;
      } catch (suspendError) {
        console.warn(`Failed to get suspended steps for run ${runId}:`, suspendError);
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error(`[Mastra API] Status error (run: ${runId}):`, error);

    const isDev = process.env.NODE_ENV === 'development';
    
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Status check failed',
        runId,
        workflowType,
        stack: isDev && error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
