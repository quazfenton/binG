import { NextRequest, NextResponse } from 'next/server';
import { hitlManager, requireApproval } from '@/lib/stateful-agent';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, target, reason, diff, interrupt_id, command } = body;

    if (command === 'approve' || command === 'reject') {
      if (!interrupt_id) {
        return NextResponse.json(
          { error: 'interrupt_id required' },
          { status: 400 }
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
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
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
}
