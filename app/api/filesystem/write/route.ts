import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { extractSessionIdFromPath } from '@/lib/virtual-filesystem/scope-utils';
import { fileContentSchema, languageSchema } from '@/lib/validation/schemas';
import { resolveFilesystemOwnerWithFallback } from '../utils';
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import type { AuthResult } from '@/lib/auth/auth-service';

export const runtime = 'nodejs';

/**
 * Schema for filesystem write requests
 * Validates path, content, and prevents path traversal attacks
 * Accepts both relative paths (project/sessions/...) and absolute paths (/home/..., /workspace/...)
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
      (path) => {
        // Allow relative paths (project, project/sessions, etc.)
        if (!path.startsWith('/')) return true;
        // If absolute, must start with /home/, /workspace/, or /tmp/
        return path.startsWith('/home/') || path.startsWith('/workspace/') || path.startsWith('/tmp/');
      },
      'Invalid path format'
    ),
  content: fileContentSchema,
  language: languageSchema.optional(),
  sessionId: z.string().min(1).max(200).optional(),
  source: z.string().min(1).max(100).optional(),
  integration: z.string().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  let filesystemOwnerResolution: FilesystemOwnerResolution | undefined;
  let authResult: AuthResult | undefined;
  let ownerId: string | undefined;

  try {
    // Resolve owner: authenticated users via JWT/session, anonymous via x-anonymous-session-id header
    authResult = await resolveRequestAuth(req, { allowAnonymous: true });

    if (!authResult.success || !authResult.user?.id) {
      // Fallback: resolve via resolveFilesystemOwner (checks header + cookie)
      filesystemOwnerResolution = await resolveFilesystemOwnerWithFallback(req, {
        route: 'write',
        requestId: Math.random().toString(36).slice(2, 8),
      });
      if (!filesystemOwnerResolution.ownerId) {
        const errorResponse = NextResponse.json(
          { error: 'Authentication required for file write operations' },
          { status: 401 }
        );
        return withAnonSessionCookie(errorResponse, filesystemOwnerResolution);
      }
      ownerId = filesystemOwnerResolution.ownerId;
    } else {
      ownerId = String(authResult.user?.id);
    }

    // Parse JSON body with error handling
    let body;
    try {
      body = await req.json();
    } catch (err) {
      const errorResponse = NextResponse.json(
        { success: false, error: 'Malformed JSON payload' },
        { status: 400 }
      );
      return withAnonSessionCookie(errorResponse, filesystemOwnerResolution || {
        ownerId,
        source: (authResult.source as any) || 'jwt',
        isAuthenticated: true,
      });
    }

    // Validate request body
    const validation = writeRequestSchema.safeParse(body);
    if (!validation.success) {
      const errorResponse = NextResponse.json(
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
      return withAnonSessionCookie(errorResponse, filesystemOwnerResolution || {
        ownerId,
        source: (authResult.source as any) || 'jwt',
        isAuthenticated: true,
      });
    }

    const {
      path: filePath,
      content,
      language,
      sessionId: requestedSessionId,
      source,
      integration,
    } = validation.data;

    let previousContent: string | undefined;
    let previousVersion: number | null = null;
    let existedBefore = false;

    try {
      const previousFile = await virtualFilesystem.readFile(ownerId, filePath);
      previousContent = previousFile.content;
      previousVersion = previousFile.version;
      existedBefore = true;
    } catch {
      previousContent = undefined;
      previousVersion = null;
      existedBefore = false;
    }

    const file = await virtualFilesystem.writeFile(ownerId, filePath, content, language);
    const workspaceVersion = await virtualFilesystem.getWorkspaceVersion(ownerId);

    const resolvedSessionId = requestedSessionId || extractSessionIdFromPath(filePath);
    let commitId: string | undefined;

    if (resolvedSessionId) {
      const commitManager = new ShadowCommitManager();
      const commitResult = await commitManager.commit(
        { [file.path]: file.content },
        [{
          path: file.path,
          type: existedBefore ? 'UPDATE' : 'CREATE',
          timestamp: Date.now(),
          originalContent: previousContent,
          newContent: file.content,
        }],
        {
          sessionId: `${ownerId}:${resolvedSessionId}`,
          message: `${source || 'filesystem'} write: ${file.path}`,
          author: ownerId,
          source: source || 'filesystem-write',
          integration: integration || source || 'filesystem',
          workspaceVersion,
        },
      );

      if (commitResult.success) {
        commitId = commitResult.commitId;
      }
    }

    const response = NextResponse.json({
      success: true,
      data: {
        path: file.path,
        version: file.version,
        previousVersion,
        workspaceVersion,
        sessionId: resolvedSessionId,
        commitId,
        language: file.language,
        size: file.size,
        lastModified: file.lastModified,
      },
    });
    
    return withAnonSessionCookie(response, filesystemOwnerResolution || {
      ownerId: ownerId || 'unknown',
      source: 'jwt',
      isAuthenticated: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to write file';
    const errorResponse = NextResponse.json({ success: false, error: message }, { status: 400 });
    return withAnonSessionCookie(errorResponse, filesystemOwnerResolution || {
      ownerId: ownerId || 'unknown',
      source: 'jwt',
      isAuthenticated: true,
    });
  }
}
