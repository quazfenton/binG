/**
 * Mastra Workflow Status API
 *
 * Gets the current status of a workflow run.
 *
 * LAZY LOADING: Mastra is loaded on first request to avoid build-time initialization
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { resolveRequestAuth } from '@/lib/auth/request-auth';

// Valid workflow types - allowlist for security
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
      throw new Error('Mastra not available');
    }
  }
  return _mastra;
}

export async function GET(request: NextRequest) {
  // SECURITY: Require authentication to access workflow status
  const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

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
    // Get Mastra instance (lazy loaded)
    const mastra = await getMastra();

    // Get workflow
    const workflow = mastra.getWorkflow(workflowType);

    if (!workflow) {
      return NextResponse.json(
        { error: `Workflow "${workflowType}" not found` },
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

    const status = runState.status;

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
        response.history = runState.steps || {};
        response.createdAt = runState.createdAt;
        response.updatedAt = runState.updatedAt;
      } catch (historyError) {
        console.warn(`Failed to get history for run ${runId}:`, historyError);
        response.history = [];
      }
    }

    // Get step details if suspended
    if (status === 'suspended') {
      try {
        response.suspendedSteps = runState.activeStepsPath;
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
