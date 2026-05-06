import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { resolveFilesystemOwnerWithFallback } from '../utils';
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { absolutePathSchema } from '@/lib/validation/schemas';
import { isOutsideWorkspace } from '@/lib/agent-bins/workspace-boundary';



/**
 * Schema for filesystem delete requests
 * Validates path and prevents path traversal attacks
 */
const deleteRequestSchema = z.object({
  path: absolutePathSchema
    .refine(
      (path) => path.startsWith('/home/') || path.startsWith('/workspace/') || path.startsWith('/project/'),
      'Absolute paths must start with /home/, /workspace/, or /project/'
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

    // WORKSPACE BOUNDARY (defense-in-depth):
    // If the schema is ever relaxed to allow real filesystem paths (outside /project/,
    // /workspace/, /home/), this check prevents unauthorised out-of-workspace deletes.
    // Currently the schema already constrains paths to VFS prefixes, so this code
    // path is unreachable — but it guards against future schema changes.
    // Pass `?confirmed=true` to proceed after client-side user approval.
    const confirmed = new URL(req.url).searchParams.get('confirmed') === 'true';
    if (isOutsideWorkspace(targetPath) && !confirmed) {
      return NextResponse.json({
        success: false,
        error: 'Path is outside the workspace root',
        needsWorkspaceConfirmation: true,
        workspaceBoundary: 'outside',
      }, { status: 403 });
    }

    // SECURITY: Always derive ownerId from authenticated request context
    // Never trust user-supplied ownerId for delete operations
    const authResolution = await resolveFilesystemOwnerWithFallback(req, {
      route: 'delete',
      requestId: Math.random().toString(36).slice(2, 8),
    });
    const ownerId = authResolution.ownerId;

    const result = await virtualFilesystem.deletePath(ownerId, targetPath);

    const response = NextResponse.json({
      success: true,
      data: result,
    });
    return withAnonSessionCookie(response, authResolution);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete path';
    const errorResponse = NextResponse.json({ success: false, error: message }, { status: 400 });
    // We don't have authResolution in catch, so create a basic one
    return withAnonSessionCookie(errorResponse, {
      ownerId: 'unknown',
      source: 'anonymous',
      isAuthenticated: false,
    });
  }
}
