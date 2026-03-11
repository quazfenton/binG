import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';
import { absolutePathSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

/**
 * Schema for filesystem delete requests
 * Validates path and prevents path traversal attacks
 */
const deleteRequestSchema = z.object({
  path: absolutePathSchema
    .refine(
      (path) => path.startsWith('/home/') || path.startsWith('/workspace/'),
      'Absolute paths must start with /home/ or /workspace/'
    )
    .refine(
      (path) => !path.includes('..'),
      'Path traversal sequences (..) are not allowed'
    ),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate request body
    const validation = deleteRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 },
      );
    }

    const { path: targetPath } = validation.data;

    // SECURITY: Always derive ownerId from authenticated request context
    // Never trust user-supplied ownerId for delete operations
    const authResolution = await resolveFilesystemOwner(req);
    const ownerId = authResolution.ownerId;

    const result = await virtualFilesystem.deletePath(ownerId, targetPath);
    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete path';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
