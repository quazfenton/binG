import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  resolveFilesystemOwner,
  filesystemEditSessionService,
} from '@/lib/virtual-filesystem';
import { transactionIdSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

const denyEditRequestSchema = z.object({
  transactionId: transactionIdSchema,
  reason: z.string()
    .optional()
    .max(1000, 'Reason too long (max 1000 characters)'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Validate request body with Zod
    const parseResult = denyEditRequestSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return NextResponse.json(
        { 
          success: false, 
          error: firstError.message,
          details: parseResult.error.flatten(),
        },
        { status: 400 },
      );
    }
    
    const { transactionId, reason } = parseResult.data;
    
    const owner = await resolveFilesystemOwner(req);
    
    const tx = await filesystemEditSessionService.getTransaction(transactionId);
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
