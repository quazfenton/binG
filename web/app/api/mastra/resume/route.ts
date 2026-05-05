/**
 * Mastra HITL Resume API
 *
 * Resumes suspended workflows with human approval data.
 *
 * SECURITY: Requires JWT authentication. Approver identity is verified server-side
 * using the authenticated user's identity, not client-supplied fields.
 *
 * LAZY LOADING: Mastra is loaded on first request to avoid build-time initialization
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { getApprovalStep } from '@/lib/orchestra/mastra/workflows/hitl-workflow';
import { verifyAuth } from '@/lib/auth/jwt';
import { authService } from '@/lib/auth/auth-service';

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

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    // SECURITY: Authenticate the caller using JWT
    const authResult = await verifyAuth(request);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required', requestId },
        { status: 401 }
      );
    }

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

    const {
      runId,
      approved,
      feedback,
      modifications,
    } = body;

    // Validate required fields
    if (!runId || typeof runId !== 'string') {
      return NextResponse.json(
        { error: 'runId is required and must be a string', requestId },
        { status: 400 }
      );
    }

    if (typeof approved !== 'boolean') {
      return NextResponse.json(
        { error: 'approved must be a boolean', requestId },
        { status: 400 }
      );
    }

    // SECURITY: Use authenticated user's identity for audit trail
    const approverId = authResult.userId;
    const user = await authService.getUserById(approverId);
    
    // SECURITY: Ensure we have a valid user record with email for audit integrity
    if (!user || !user.email) {
      return NextResponse.json(
        { error: 'Authenticated user record not found or missing email', requestId },
        { status: 401 }
      );
    }
    const approverEmail = user.email;

    // Get Mastra instance (lazy loaded)
    const mastra = await getMastra();

    // Get workflow
    const workflow = mastra.getWorkflow('hitl-code-review');

    if (!workflow) {
      return NextResponse.json(
        { error: 'Workflow "hitl-code-review" not found', requestId },
        { status: 404 }
      );
    }

    // Get workflow state
    const runState = await workflow.getWorkflowRunById(runId);

    if (!runState) {
      return NextResponse.json(
        {
          error: `Run ${runId} not found`,
          requestId,
        },
        { status: 404 }
      );
    }

    const status = runState.status;
    if (status !== 'suspended') {
      return NextResponse.json(
        {
          error: `Run is not suspended. Current status: ${status}`,
          currentStatus: status,
          requestId,
        },
        { status: 400 }
      );
    }

    // Check if there are active suspended steps
    const suspendedSteps = runState.activeStepsPath;
    if (!suspendedSteps || Object.keys(suspendedSteps).length === 0) {
      return NextResponse.json(
        { error: 'No suspended steps found', requestId },
        { status: 400 }
      );
    }

    // Create run instance for resuming
    const run = await workflow.createRun({ runId });

    // Get approval step
    const approvalStep = getApprovalStep();

    // Resume with approval data
    const result = await run.resume({
      step: approvalStep,
      resumeData: {
        approved,
        feedback,
        modifications,
        approverId,
        approverEmail,
      },
    });

    return NextResponse.json({
      success: true,
      result,
      requestId,
      auditTrail: {
        runId,
        approverId,
        approverEmail,
        approvedAt: Date.now(),
        decision: approved ? 'approved' : 'rejected',
      },
    });
  } catch (error) {
    console.error(`[Mastra API] Resume error (${requestId}):`, error);

    const isDev = process.env.NODE_ENV === 'development';

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Resume failed',
        requestId,
        stack: isDev && error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
