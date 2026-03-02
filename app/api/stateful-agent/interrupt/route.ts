import { NextRequest, NextResponse } from 'next/server';
import { hitlManager, requireApproval } from '@/lib/stateful-agent';
import { verifyAuth } from '@/lib/auth/verify-auth';

/**
 * POST /api/stateful-agent/interrupt
 * 
 * Handle interrupt approval/rejection requests.
 * Requires authentication to prevent unauthorized approval/denial.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authResult = await verifyAuth(request);
    if (!authResult.valid) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { action, target, reason, diff, interrupt_id, command } = body;

    if (command === 'approve' || command === 'reject') {
      if (!interrupt_id) {
        return NextResponse.json(
          { error: 'interrupt_id required' },
          { status: 400 }
        );
      }

      // Verify the interrupt exists before resolving
      const pendingInterrupts = hitlManager.getPendingInterrupts();
      const interruptExists = pendingInterrupts.some(i => i.id === interrupt_id);
      
      if (!interruptExists) {
        return NextResponse.json(
          { error: 'Interrupt not found or already resolved' },
          { status: 404 }
        );
      }

      await hitlManager.resolveInterrupt(interrupt_id, {
        approved: command === 'approve',
        feedback: body.feedback,
        modified_value: body.modified_value,
      });

      return NextResponse.json({
        success: true,
        message: `Interrupt ${command === 'approve' ? 'approved' : 'rejected'}`,
      });
    }

    const approval = await requireApproval(
      action,
      target,
      reason,
      diff
    );

    return NextResponse.json({
      approved: approval,
      message: approval ? 'Approved' : 'Requires approval',
    });

  } catch (error) {
    console.error('[Interrupt API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/stateful-agent/interrupt
 * 
 * Get pending interrupts.
 * Requires authentication to prevent leaking sensitive interrupt details.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authResult = await verifyAuth(request);
    if (!authResult.valid) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const pending = hitlManager.getPendingInterrupts();

    return NextResponse.json({
      pending: pending.map(p => ({
        id: p.id,
        action: p.request.action,
        target: p.request.target,
        reason: p.request.reason,
        createdAt: p.createdAt.toISOString(),
      })),
      count: pending.length,
    });
  } catch (error) {
    console.error('[Interrupt API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
