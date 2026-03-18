import { NextRequest } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { generateSecureId } from '@/lib/utils';

export interface FilesystemOwnerResolution {
  ownerId: string;
  source: 'jwt' | 'session' | 'anonymous' | 'fallback';
  isAuthenticated: boolean;
  /** Session ID to set as cookie for anonymous users */
  anonSessionId?: string;
}

/**
 * Resolve filesystem owner from request
 * 
 * SECURITY: Anonymous users get unique per-session IDs to prevent cross-user data leakage.
 * Using a shared 'anon:public' ID would cause all anonymous users to share the same workspace.
 */
export async function resolveFilesystemOwner(req: NextRequest): Promise<FilesystemOwnerResolution> {
  const auth = await resolveRequestAuth(req, { allowAnonymous: true });
  if (auth.success && auth.userId) {
    return {
      ownerId: auth.userId,
      source: auth.source || 'fallback',
      isAuthenticated: auth.source === 'jwt' || auth.source === 'session',
    };
  }

  // SECURITY: Generate unique anonymous session ID per client
  // This prevents all anonymous users from sharing the same workspace
  const anonymousSessionId = req.cookies.get('anon-session-id')?.value;
  
  if (anonymousSessionId) {
    return {
      ownerId: `anon:${anonymousSessionId}`,
      source: 'anonymous',
      isAuthenticated: false,
    };
  }

  // Generate new anonymous session ID for first-time visitors
  const newAnonId = generateSecureId('anon');
  
  return {
    ownerId: `anon:${newAnonId}`,
    source: 'fallback',
    isAuthenticated: false,
    anonSessionId: newAnonId, // Signal to set cookie
  };
}
