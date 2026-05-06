/**
 * Arcade Token Endpoint
 *
 * POST /api/integrations/arcade/token
 *
 * Body: { provider: "github", scopes?: ["repo", "user"] }
 * Returns the cached OAuth token for direct API calls.
 * If the user hasn't authorized the provider yet, returns { requiresAuth: true, authUrl: "..." }.
 */

import { NextRequest, NextResponse } from 'next/server';


import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { authService } from '@/lib/auth/auth-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Integrations:ArcadeToken');

/**
 * Normalize provider names to Arcade SDK expectations.
 */
function normalizeProvider(raw: string): string {
  const map: Record<string, string> = {
    x: 'twitter',
    twitter: 'twitter',
    github: 'github',
    google: 'google',
    slack: 'slack',
    discord: 'discord',
  };
  return map[raw.toLowerCase()] || raw.toLowerCase();
}

/**
 * Resolve the app user ID to an Arcade-compatible user ID (email).
 */
async function resolveArcadeUserId(appUserId: string): Promise<string> {
  const strategy = (process.env.ARCADE_USER_ID_STRATEGY || 'email').toLowerCase();

   if (strategy === 'email') {
     try {
       // userId is now a string (UUID), try directly first
       let user = await authService.getUserById(appUserId);
       if (user?.email) return user.email;
       
       // Legacy: try parsing as numeric for backwards compatibility
       // Use strict numeric check to avoid partial parsing (e.g., "123abc" -> 123)
       const numeric = /^\d+$/.test(appUserId) ? parseInt(appUserId, 10) : NaN;
       if (!isNaN(numeric)) {
         // Try to find user by treating the string as a numeric id
         // This handles migration cases where old numeric IDs might be referenced
         user = await authService.getUserById(String(numeric));
         if (user?.email) return user.email;
       }
     } catch {
       // fall through
     }
     return appUserId; // return as-is if not found
   }

  // strategy === 'id'
  return appUserId;
}

export async function POST(request: NextRequest) {
  const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.ARCADE_API_KEY) {
    return NextResponse.json(
      { error: 'Arcade not configured (ARCADE_API_KEY not set)' },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const req = body as Record<string, unknown>;
  const provider = typeof req.provider === 'string' ? req.provider : undefined;
  const scopes = Array.isArray(req.scopes)
    ? (req.scopes as string[]).filter((s) => typeof s === 'string')
    : undefined;

  if (!provider) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 });
  }

  // Validate scopes
  if (scopes) {
    const scopePattern = /^[a-z0-9._-]+$/i;
    const invalidScopes = scopes.filter((s) => !scopePattern.test(s));
    if (invalidScopes.length > 0) {
      return NextResponse.json(
        { error: `Invalid scopes: ${invalidScopes.join(', ')}` },
        { status: 400 },
      );
    }
  }

  try {
    const arcadeUserId = await resolveArcadeUserId(String(authResult.userId));
    const normalizedProvider = normalizeProvider(provider);

    const { getArcadeService } = await import('@/lib/integrations/arcade-service');
    const arcadeService = getArcadeService();

    if (!arcadeService) {
      return NextResponse.json({ error: 'Arcade service not available' }, { status: 500 });
    }

    const tokenResult = await arcadeService.getProviderToken(
      arcadeUserId,
      normalizedProvider,
      scopes,
    );

    if (tokenResult.error) {
      return NextResponse.json({ error: tokenResult.error }, { status: 500 });
    }

    if (tokenResult.token) {
      return NextResponse.json({
        success: true,
        provider: normalizedProvider,
        token: tokenResult.token,
      });
    }

    if (tokenResult.requiresAuth && tokenResult.authUrl) {
      return NextResponse.json({
        success: true,
        provider: normalizedProvider,
        requiresAuth: true,
        authUrl: tokenResult.authUrl,
      });
    }

    return NextResponse.json(
      { error: 'Unexpected auth state — no token or auth URL returned' },
      { status: 500 },
    );
  } catch (error: any) {
    logger.error('Arcade token retrieval failed', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
