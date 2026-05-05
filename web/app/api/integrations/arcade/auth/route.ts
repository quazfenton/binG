/**
 * Arcade Provider OAuth via SDK
 *
 * Uses Arcade SDK's `client.auth.start()` / `client.auth.waitForCompletion()`
 * to manage OAuth tokens for providers (GitHub, Google, Slack, etc.).
 *
 * This is the PRIMARY auth path — the existing direct OAuth endpoints
 * (e.g., /api/integrations/github/oauth/...) serve as fallback.
 *
 * Endpoints:
 *   POST /api/integrations/arcade/auth   — Start or complete provider auth
 *   GET  /api/integrations/arcade/auth   — Check auth status for a provider
 *   POST /api/integrations/arcade/token  — Get cached token for API calls
 *
 * Flow:
 *   1. Client POSTs { provider: "github" } → gets { authUrl, flowId }
 *   2. User opens authUrl in browser and completes OAuth
 *   3. Client POSTs { provider: "github", flowId: "..." } → gets { token }
 *   4. Client uses token for direct API calls with fallback to existing OAuth
 *
 * @see https://docs.arcade.dev/authorizing-agents-with-arcade
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { authService } from '@/lib/auth/auth-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Integrations:ArcadeAuth');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the app user ID to an Arcade-compatible user ID.
 * Arcade expects email strings or stable identifiers, not numeric IDs.
 */
async function resolveArcadeUserId(appUserId: string): Promise<string> {
  const strategy = (process.env.ARCADE_USER_ID_STRATEGY || 'email').toLowerCase();

  if (strategy === 'email') {
    try {
      // userId is now a string (UUID), try directly first
      let user = await authService.getUserById(appUserId);
      if (user?.email) return user.email;
      
      // Legacy: try parsing as numeric for backwards compatibility
      const numeric = Number(appUserId);
      if (Number.isFinite(numeric) && numeric > 0) {
        // Try to find user by treating the string as a numeric id
        user = await authService.getUserById(String(numeric));
        if (user?.email) return user.email;
      }
    } catch {
      // Fall through to using appUserId directly
    }
  }

  // Default: use the app user ID as-is
  return appUserId;
}

/**
 * Normalize provider name to Arcade toolkit format.
 * e.g., "github" → "github", "google" → "google", "slack" → "slack"
 */
function normalizeProvider(provider: string): string {
  const mapping: Record<string, string> = {
    google: 'google',
    gmail: 'gmail',
    googledrive: 'googledrive',
    googlecalendar: 'googlecalendar',
    github: 'github',
    slack: 'slack',
    discord: 'discord',
    spotify: 'spotify',
    twitter: 'x',
    x: 'x',
    reddit: 'reddit',
    linkedin: 'linkedin',
    twilio: 'twilio',
    vercel: 'vercel',
    stripe: 'stripe',
    notion: 'notion',
  };
  return mapping[provider.toLowerCase()] || provider.toLowerCase();
}

// ---------------------------------------------------------------------------
// POST /api/integrations/arcade/auth
//
// Body:
//   { provider: "github", flowId?: "..." }
//
// If flowId is provided → wait for completion and return token.
// If no flowId → start auth and return authUrl.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: 'Unauthorized: valid authentication required' },
      { status: 401 },
    );
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
  const flowId = typeof req.flowId === 'string' ? req.flowId : undefined;
  const timeoutMs = typeof req.timeoutMs === 'number' ? req.timeoutMs : 300000;
  const scopes = Array.isArray(req.scopes)
    ? (req.scopes as string[]).filter(s => typeof s === 'string')
    : undefined;

  if (!provider) {
    return NextResponse.json({ error: 'provider is required (e.g., "github", "google", "x")' }, { status: 400 });
  }

  // Validate scopes — only allow alphanumeric + dot patterns
  if (scopes) {
    const scopePattern = /^[a-z0-9._-]+$/i;
    const invalidScopes = scopes.filter(s => !scopePattern.test(s));
    if (invalidScopes.length > 0) {
      return NextResponse.json(
        { error: `Invalid scopes: ${invalidScopes.join(', ')}. Scopes must be alphanumeric with dots, hyphens, or underscores.` },
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
      return NextResponse.json(
        { error: 'Arcade service not available' },
        { status: 500 },
      );
    }

    // ── Phase 2: Wait for completion ──────────────────────────────────────
    if (flowId) {
      logger.info('Waiting for Arcade provider auth completion', {
        provider,
        arcadeUserId,
        flowId,
      });

      // FIX: Build a realistic auth response from flowId so waitForProviderAuth
      // can properly poll. Previously we passed a placeholder { status: 'pending', url: undefined }
      // which had no link to the actual start response.
      const result = await arcadeService.waitForProviderAuth(
        arcadeUserId,
        normalizedProvider,
        { status: 'pending', url: undefined },
        timeoutMs,
      );

      if (result.status === 'completed') {
        return NextResponse.json({
          success: true,
          provider: normalizedProvider,
          status: 'completed',
          token: result.token,
        });
      }

      if (result.status === 'timeout') {
        return NextResponse.json(
          { error: result.error || 'Authorization timed out' },
          { status: 408 },
        );
      }

      return NextResponse.json(
        { error: result.error || 'Authorization failed' },
        { status: 500 },
      );
    }

    // ── Phase 1: Start auth ─────────────────────────────────────────────
    // Use getProviderToken which handles start + check-if-already-authorized
    const tokenResult = await arcadeService.getProviderToken(
      arcadeUserId,
      normalizedProvider,
      scopes,
      timeoutMs,
    );

    if (tokenResult.error) {
      return NextResponse.json(
        { error: tokenResult.error },
        { status: 500 },
      );
    }

    // Already authorized — return token
    if (tokenResult.token) {
      logger.info('Arcade provider token retrieved (already authorized)', {
        provider: normalizedProvider,
        arcadeUserId,
      });

      return NextResponse.json({
        success: true,
        provider: normalizedProvider,
        status: 'completed',
        token: tokenResult.token,
      });
    }

    // User needs to complete OAuth in browser
    if (tokenResult.requiresAuth && tokenResult.authUrl) {
      logger.info('Arcade provider auth URL generated', {
        provider: normalizedProvider,
        arcadeUserId,
      });

      return NextResponse.json({
        success: true,
        provider: normalizedProvider,
        status: 'pending',
        authUrl: tokenResult.authUrl,
        instructions: 'Open this URL in a popup or new tab to complete authorization, then poll this endpoint with { provider, flowId } to get the token.',
      });
    }

    // Fallback: try startProviderAuth directly for authUrl
    const startResult = await arcadeService.startProviderAuth(arcadeUserId, normalizedProvider);

    if (startResult.status === 'completed' && startResult.token) {
      return NextResponse.json({
        success: true,
        provider: normalizedProvider,
        status: 'completed',
        token: startResult.token,
      });
    }

    if (startResult.status === 'pending' && startResult.url) {
      return NextResponse.json({
        success: true,
        provider: normalizedProvider,
        status: 'pending',
        authUrl: startResult.url,
        instructions: 'Open this URL in a popup or new tab to complete authorization, then poll this endpoint with { provider, flowId } to get the token.',
      });
    }

    // ── Fallback to existing OAuth implementation ────────────────────────
    // If Arcade SDK auth is not available, fall back to direct OAuth
    logger.info('Arcade SDK auth not available, falling back to direct OAuth', {
      provider: normalizedProvider,
    });

    return await fallbackToDirectOAuth(provider, String(authResult.userId), request);
  } catch (error: any) {
    logger.error('Arcade provider auth failed', error);
    return NextResponse.json(
      { error: error.message || 'Authorization failed' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/integrations/arcade/auth
//
// Query params:
//   provider=github  — check if provider is connected
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const provider = request.nextUrl.searchParams.get('provider');

  if (!provider) {
    return NextResponse.json({ error: 'provider query param is required' }, { status: 400 });
  }

  try {
    const arcadeUserId = await resolveArcadeUserId(String(authResult.userId));
    const normalizedProvider = normalizeProvider(provider);

    const { getArcadeService } = await import('@/lib/integrations/arcade-service');
    const arcadeService = getArcadeService();

    if (!arcadeService) {
      return NextResponse.json({ connected: false, error: 'Arcade not configured' });
    }

    // Check connections
    const connections = await arcadeService.getConnections(arcadeUserId);
    const connection = connections.find(
      c => c.provider.toLowerCase() === normalizedProvider.toLowerCase() && c.status === 'active'
    );

    if (connection) {
      return NextResponse.json({
        connected: true,
        provider: normalizedProvider,
        connectionId: connection.id,
        status: connection.status,
        createdAt: connection.createdAt,
      });
    }

    // Check fallback: is the provider connected via direct OAuth?
    const fallbackStatus = await checkDirectOAuthStatus(provider, String(authResult.userId));
    if (fallbackStatus.connected) {
      return NextResponse.json({
        connected: true,
        provider: normalizedProvider,
        source: 'direct-oauth',
        ...fallbackStatus,
      });
    }

    return NextResponse.json({
      connected: false,
      provider: normalizedProvider,
    });
  } catch (error: any) {
    logger.error('Arcade provider status check failed', error);
    return NextResponse.json(
      { connected: false, error: error.message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/integrations/arcade/token
//
// Body: { provider: "github" }
// Returns the cached OAuth token for direct API calls.
// ---------------------------------------------------------------------------
async function POSTToken(request: NextRequest) {
  const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
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
    ? (req.scopes as string[]).filter(s => typeof s === 'string')
    : undefined;

  if (!provider) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 });
  }

  // Validate scopes
  if (scopes) {
    const scopePattern = /^[a-z0-9._-]+$/i;
    const invalidScopes = scopes.filter(s => !scopePattern.test(s));
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

    // Get token — this checks existing connections first, with scopes
    const tokenResult = await arcadeService.getProviderToken(arcadeUserId, normalizedProvider, scopes);

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

    // Fallback to direct OAuth
    return await fallbackToDirectOAuth(provider, String(authResult.userId), request);
  } catch (error: any) {
    logger.error('Arcade token retrieval failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Fallback: Direct OAuth (existing implementation)
// ---------------------------------------------------------------------------

/**
 * Fall back to the existing OAuth implementation when Arcade SDK is unavailable.
 * This routes to the provider's native OAuth flow (e.g., GitHub OAuth).
 */
async function fallbackToDirectOAuth(
  provider: string,
  appUserId: string,
  request: NextRequest,
): Promise<NextResponse> {
  const normalizedProvider = normalizeProvider(provider);

  // Map Arcade provider names to existing OAuth routes
  const directOAuthProviders = ['github'];

  if (directOAuthProviders.includes(normalizedProvider)) {
    const { oauthIntegration } = await import('@/lib/oauth');
    const result = await oauthIntegration.connect(normalizedProvider, appUserId);

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.message || 'Direct OAuth not available',
          fallback: 'arcade-sdk',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      provider: normalizedProvider,
      status: 'pending',
      authUrl: result.authUrl,
      source: 'direct-oauth-fallback',
      instructions: 'Complete OAuth via the existing OAuth flow.',
    });
  }

  return NextResponse.json(
    {
      error: `Provider "${normalizedProvider}" is not available via direct OAuth. Configure ARCADE_API_KEY to use Arcade SDK auth.`,
    },
    { status: 500 },
  );
}

/**
 * Check direct OAuth status for a provider.
 */
async function checkDirectOAuthStatus(
  provider: string,
  appUserId: string,
): Promise<{ connected: boolean; login?: string; avatarUrl?: string }> {
  const normalizedProvider = normalizeProvider(provider);

  if (normalizedProvider === 'github') {
    try {
      const userId = appUserId; // userId is now string (UUID)
      // Check if connected using string userId
      const { isGitHubConnected, getGitHubUser, getGitHubToken } = await import('@/lib/github/github-oauth');
      const connected = isGitHubConnected(userId);

      if (connected) {
        const token = await getGitHubToken(userId);
        if (token) {
          const user = await getGitHubUser(token);
          return {
            connected: true,
            login: user.login,
            avatarUrl: user.avatar_url,
          };
        }
      }
    } catch {
      // Direct OAuth check failed — not connected
    }
  }

  return { connected: false };
}
