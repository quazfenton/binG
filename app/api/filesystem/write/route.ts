import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

/**
 * Schema for filesystem write requests
 * Validates path, content, and prevents path traversal attacks
 */
const writeRequestSchema = z.object({
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
  content: z.string()
    .max(10 * 1024 * 1024, 'Content too large (max 10MB)'),
  ownerId: z.string().optional(),
  language: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate request body
    const validation = writeRequestSchema.safeParse(body);
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

    const { path: filePath, content, language } = validation.data;

    // SECURITY: Always derive ownerId from authenticated request context
    // Never trust user-supplied ownerId for write operations
    const authResolution = await resolveFilesystemOwner(req);
    const ownerId = authResolution.ownerId;

    const file = await virtualFilesystem.writeFile(ownerId, filePath, content, language);

    return NextResponse.json({
      success: true,
      data: {
        path: file.path,
        version: file.version,
        language: file.language,
        size: file.size,
        lastModified: file.lastModified,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to write file';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
