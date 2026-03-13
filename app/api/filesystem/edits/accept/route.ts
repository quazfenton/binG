import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  resolveFilesystemOwner,
  filesystemEditSessionService,
} from '@/lib/virtual-filesystem';
import { transactionIdSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

const acceptEditRequestSchema = z.object({
  transactionId: transactionIdSchema,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Validate request body with Zod
    const parseResult = acceptEditRequestSchema.safeParse(body);
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
    
    const { transactionId } = parseResult.data;
    
    const owner = await resolveFilesystemOwner(req);
    
    const tx = await filesystemEditSessionService.getTransaction(transactionId);
    if (!tx || tx.ownerId !== owner.ownerId) {
      return NextResponse.json(
        { success: false, error: 'Edit transaction not found' },
        { status: 404 },
      );
    }

    const accepted = filesystemEditSessionService.acceptTransaction(transactionId);
    return NextResponse.json({
      success: true,
      data: {
        transaction: accepted,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to accept edit transaction';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
