import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { generateSecureId } from '@/lib/utils';

export interface FilesystemOwnerResolution {
  ownerId: string;
  source: 'jwt' | 'session' | 'anonymous';
  isAuthenticated: boolean;
  /** Session ID to set as cookie for anonymous users */
  anonSessionId?: string;
}

/**
 * Helper to add anonymous session cookie to response
 * Call this for ALL routes that use resolveFilesystemOwner
 */
response.headers.set('set-cookie', `anon-session-id=${owner.anonSessionId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure`)
  response: T,
  owner: FilesystemOwnerResolution
): T {
  if (owner.anonSessionId) {
    response.headers.set(
      'set-cookie',
      `anon-session-id=${owner.anonSessionId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`
    );
  }
  return response;
}

/**
 * Resolve filesystem owner from request
 *
 * SECURITY: Anonymous users get unique per-session IDs to prevent cross-user data leakage.
 * Using a shared 'anon:public' ID would cause all anonymous users to share the same workspace.
 *
 * SESSION PERSISTENCE: Anonymous session IDs are persisted via http-only cookies.
 * To prevent session fragmentation, we use a consistent ID derivation strategy:
 * 1. Use existing cookie if present
 * 2. Generate new ID and mark for cookie setting (caller must set cookie)
 * 3. All routes MUST set the cookie when anonSessionId is returned
 */
export async function resolveFilesystemOwner(req: NextRequest): Promise<FilesystemOwnerResolution> {
  const auth = await resolveRequestAuth(req, { allowAnonymous: true });
  if (auth.success && auth.userId) {
    return {
      ownerId: auth.userId,
      source: auth.source || 'jwt',
      isAuthenticated: auth.source === 'jwt' || auth.source === 'session',
    };
  }

  // SECURITY: Use existing anonymous session ID from cookie if present
  const anonymousSessionId = req.cookies.get('anon-session-id')?.value;

  if (anonymousSessionId) {
    return {
      ownerId: `anon:${anonymousSessionId}`,
      source: 'anonymous',
      isAuthenticated: false,
    };
  }

  // Generate new anonymous session ID for first-time visitors
  // IMPORTANT: Caller MUST set the cookie when anonSessionId is returned
  // to prevent session fragmentation across requests
  const newAnonId = generateSecureId('anon');

  return {
    ownerId: `anon:${newAnonId}`,
    source: 'anonymous',
    isAuthenticated: false,
    anonSessionId: newAnonId, // Signal to set cookie
  };
}
