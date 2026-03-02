/**
 * Mastra HITL Resume API
 *
 * Resumes suspended workflows with human approval data.
 *
 * SECURITY: Requires JWT authentication. Approver identity is verified server-side
 * using the authenticated user's identity, not client-supplied fields.
 */

import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/lib/mastra/mastra-instance';
import { getApprovalStep } from '@/lib/mastra/workflows/hitl-workflow';
import { verifyAuth } from '@/lib/auth/jwt';

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    // SECURITY: Authenticate the caller using JWT
    const authResult = await verifyAuth(request);
    if (!authResult.success) {
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
      // SECURITY: approverId and approverEmail are now ignored from client input
      // They are derived from the authenticated user instead
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
    // This prevents forgery of approver identity
    const approverId = authResult.userId!;
    const approverEmail = authResult.email!;

    // Get workflow
    const workflow = mastra.getWorkflow('hitl-code-review');

    if (!workflow) {
      return NextResponse.json(
        { error: 'Workflow "hitl-code-review" not found', requestId },
        { status: 404 }
      );
    }

    // Create run with existing runId
    const run = await workflow.createRun({ runId });

    // Check run status - must be suspended to resume
    const status = await run.getStatus();
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

    // Get suspended steps
    const suspendedSteps = await run.getSuspendedSteps();
    if (!suspendedSteps || suspendedSteps.length === 0) {
      return NextResponse.json(
        { error: 'No suspended steps found', requestId },
        { status: 400 }
      );
    }

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
