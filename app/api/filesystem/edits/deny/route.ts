import { NextRequest, NextResponse } from 'next/server';
import {
  resolveFilesystemOwner,
  filesystemEditSessionService,
} from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const owner = await resolveFilesystemOwner(req);
    const body = await req.json();
    const transactionId = typeof body?.transactionId === 'string' ? body.transactionId : '';
    const reason = typeof body?.reason === 'string' ? body.reason : '';

    if (!transactionId.trim()) {
      return NextResponse.json(
        { success: false, error: 'transactionId is required' },
        { status: 400 },
      );
    }

    const tx = filesystemEditSessionService.getTransaction(transactionId);
    if (!tx || tx.ownerId !== owner.ownerId) {
      return NextResponse.json(
        { success: false, error: 'Edit transaction not found' },
        { status: 404 },
      );
    }

    const denyResult = await filesystemEditSessionService.denyTransaction({
      transactionId,
      reason,
    });
    if (!denyResult) {
      return NextResponse.json(
        { success: false, error: 'Failed to deny edit transaction' },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      data: denyResult,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to deny edit transaction';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
