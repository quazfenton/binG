import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

/**
 * Schema for filesystem delete requests
 * Validates path and prevents path traversal attacks
 */
const deleteRequestSchema = z.object({
  path: z.string()
    .min(1, 'Path is required')
    .max(500, 'Path too long (max 500 characters)')
    .refine(
      (path) => !path.includes('..') && !path.includes('\0'),
      'Path contains invalid characters'
    )
    .refine(
      (path) => !path.startsWith('/') || path.startsWith('/home/') || path.startsWith('/workspace/'),
      'Absolute paths must start with /home/ or /workspace/'
    ),
  ownerId: z.string().optional(),
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

    const { path: targetPath, ownerId: ownerIdFromBody } = validation.data;

    // Use ownerId from body if provided, otherwise resolve from auth
    const ownerId = ownerIdFromBody || (await resolveFilesystemOwner(req)).ownerId;

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
