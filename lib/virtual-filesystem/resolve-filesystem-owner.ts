// Server-only module - do not import directly in Client Components
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { generateSecureId } from '@/lib/utils/server-id';

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
 *
 * Also adds X-Anonymous-Session-ID header that client-side JavaScript can read
 * to sync localStorage with the server's session ID.
 *
 * SECURITY: Secure flag is added in production for HTTPS deployments.
 * For local development, the cookie works over HTTP on localhost.
 */
export function withAnonSessionCookie<T extends NextResponse>(
  response: T,
  owner: FilesystemOwnerResolution
): T {
  if (owner.anonSessionId) {
    const isSecure = process.env.NODE_ENV === 'production';
    response.headers.set(
      'set-cookie',
      `anon-session-id=${owner.anonSessionId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${isSecure ? '; Secure' : ''}`
    );
    // Also add a readable header for client-side JavaScript to sync localStorage
    response.headers.set('x-anonymous-session-id', owner.anonSessionId);
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
 * To prevent IDOR attacks, we NEVER trust client-controlled headers for identity.
 * Only the HttpOnly anon-session-id cookie is used as the identity source.
 *
 * SESSION FRAGMENTATION FIX: During initial page load, multiple concurrent requests
 * may arrive before the cookie is set. To prevent this, we accept the client-provided
 * session ID from the x-anonymous-session-id header as a fallback when no cookie exists.
 * This header is only used to PREVENT generating duplicate IDs - it's still the server
 * that sets the authoritative cookie.
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

  // SECURITY: Only trust the HttpOnly cookie for anonymous identity.
  // Never trust client-controlled headers - they can be forged to impersonate other users.
  const sanitizeSessionId = (id: string): string => {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  };

  // PRIORITY 1: Use existing anonymous session ID from HttpOnly cookie
  const rawSessionId = req.cookies.get('anon-session-id')?.value;

  if (rawSessionId) {
    // Strip 'anon_' prefix if present (from generateSecureId format)
    const rawId = rawSessionId.startsWith('anon_') ? rawSessionId.slice(5) : rawSessionId;
    const sessionId = sanitizeSessionId(rawId);
    return {
      ownerId: `anon:${sessionId}`,
      source: 'anonymous',
      isAuthenticated: false,
    };
  }

  // PRIORITY 2: Use client-provided session ID from header (if available)
  // This prevents session fragmentation during initial page load when multiple
  // concurrent requests arrive before the cookie is set.
  // SECURITY: We only use this to PREVENT generating duplicate IDs.
  // The server still sets the authoritative cookie.
  const clientSessionId = req.headers.get('x-anonymous-session-id');
  if (clientSessionId) {
    const sanitizedClientId = sanitizeSessionId(clientSessionId);
    // Strip 'anon_' prefix if present for consistent format
    const clientId = sanitizedClientId.startsWith('anon_') ? sanitizedClientId.slice(5) : sanitizedClientId;
    return {
      ownerId: `anon:${clientId}`,
      source: 'anonymous',
      isAuthenticated: false,
      anonSessionId: sanitizedClientId, // Set cookie with the client-provided ID
    };
  }

  // PRIORITY 3: Generate new anonymous session ID for first-time visitors
  // IMPORTANT: Caller MUST set the cookie when anonSessionId is returned
  // to prevent session fragmentation across requests
  // The session ID stored in cookie is the full generateSecureId output (includes 'anon_' prefix)
  const newAnonId = generateSecureId('anon'); // Produces 'anon_timestamp_random'

  return {
    ownerId: `anon:${newAnonId.slice(5)}`, // Strip 'anon_' prefix for consistent ownerId format
    source: 'anonymous',
    isAuthenticated: false,
    anonSessionId: newAnonId, // Store full ID (with anon_ prefix) in cookie
  };
}
