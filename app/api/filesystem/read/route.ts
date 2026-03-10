import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';
import { absolutePathSchema } from '@/lib/validation/schemas';
import { resolveFilesystemOwnerWithFallback } from '../utils';

export const runtime = 'nodejs';

/**
 * Schema for filesystem read requests
 * Validates path and prevents path traversal attacks
 */
const readRequestSchema = z.object({
  path: absolutePathSchema.refine(
    (path) => path.startsWith('/home/') || path.startsWith('/workspace/'),
    'Absolute paths must start with /home/ or /workspace/'
  ),
});

export async function POST(req: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 8);
  
  try {
    const body = await req.json();

    // Validate request body
    const validation = readRequestSchema.safeParse(body);
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

    const { path: filePath } = validation.data;

    // SECURITY: Always derive ownerId from authenticated request context
    // Never trust user-supplied ownerId for read operations
    const authResolution = await resolveFilesystemOwnerWithFallback(req, {
      route: 'read',
      requestId,
    });
    const ownerId = authResolution.ownerId;

    const file = await virtualFilesystem.readFile(ownerId, filePath);
    return NextResponse.json({
      success: true,
      data: {
        path: file.path,
        content: file.content,
        version: file.version,
        language: file.language,
        size: file.size,
        lastModified: file.lastModified,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to read file';
    const status = message.toLowerCase().includes('not found') ? 404 : 400;
    // SECURITY: Don't expose raw internal error messages
    const safeMessage = message.toLowerCase().includes('not found')
      ? 'File not found'
      : 'Failed to read file';
    return NextResponse.json({ success: false, error: safeMessage }, { status });
  }
}
