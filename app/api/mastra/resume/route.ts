/**
 * Mastra HITL Resume API
 *
 * Resumes suspended workflows with human approval data.
 * 
 * FIXED: Added comprehensive validation, run status checking, and audit trail
 */

import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/lib/mastra/mastra-instance';
import { getApprovalStep } from '@/lib/mastra/workflows/hitl-workflow';

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

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

    const { 
      runId, 
      approved, 
      feedback, 
      modifications,
      approverId,
      approverEmail,
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

    // Validate approver info for audit trail
    if (!approverId || typeof approverId !== 'string') {
      return NextResponse.json(
        { error: 'approverId is required for audit trail', requestId },
        { status: 400 }
      );
    }

    if (!approverEmail || typeof approverEmail !== 'string') {
      return NextResponse.json(
        { error: 'approverEmail is required for audit trail', requestId },
        { status: 400 }
      );
    }

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
