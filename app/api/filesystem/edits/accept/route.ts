import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withAnonSessionCookie,
  filesystemEditSessionService,
} from '@/lib/virtual-filesystem';
import { resolveFilesystemOwnerWithFallback } from '../../utils';
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
    
    // Resolve auth upfront for cookie wrapping
    const owner = await resolveFilesystemOwnerWithFallback(req, {
      route: 'edits-accept',
      requestId: Math.random().toString(36).slice(2, 8),
    });
    
    const tx = await filesystemEditSessionService.getTransaction(transactionId);
    if (!tx || tx.ownerId !== owner.ownerId) {
      const errorResponse = NextResponse.json(
        { success: false, error: 'Edit transaction not found' },
        { status: 404 },
      );
      return withAnonSessionCookie(errorResponse, owner);
    }

    const accepted = filesystemEditSessionService.acceptTransaction(transactionId);
    const response = NextResponse.json({
      success: true,
      data: {
        transaction: accepted,
      },
    });
    return withAnonSessionCookie(response, owner);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to accept edit transaction';
    const errorResponse = NextResponse.json({ success: false, error: message }, { status: 400 });
    return withAnonSessionCookie(errorResponse, {
      ownerId: 'unknown',
      source: 'anonymous',
      isAuthenticated: false,
    });
  }
}
