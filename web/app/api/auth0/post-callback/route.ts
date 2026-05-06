import { NextRequest, NextResponse } from 'next/server';
import { getLocalUserIdFromAuth0, mapAuth0UserId } from '@/lib/oauth/connections';
import { saveConnectedAccount } from '@/lib/auth0';

const CONNECTION_TO_PROVIDER: Record<string, string> = {
  'github': 'github',
  'google-oauth2': 'google',
  'windowslive': 'microsoft',
  'twitter': 'twitter',
  'linkedin': 'linkedin',
  'facebook': 'facebook',
  'apple': 'apple',
  'instagram': 'instagram',
  'bitbucket': 'bitbucket',
  'slack': 'slack',
};

function normalizeProvider(connection: string): string {
  return CONNECTION_TO_PROVIDER[connection] || connection;
}

/**
 * POST /api/auth0/post-callback
 *
 * Handles post-Auth0-callback database operations that cannot run in Edge Runtime.
 * Called by the client after a successful Auth0 login to map Auth0 users to local
 * users and persist connected accounts.
 *
 * This is a server-side route (not middleware) so it has full Node.js runtime access.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { auth0UserId, email, connectedAccount, accessToken, refreshToken, tokenExpiresAt, scopes } = body;

    if (!auth0UserId || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Normalize scopes once - handle string or array formats
    const normalizedScopes: string[] = Array.isArray(scopes)
      ? scopes
      : typeof scopes === 'string'
        ? scopes.split(/[,\s]+/).filter(Boolean)
        : [];

    console.log('[Auth0 Post-Callback] Processing callback:', {
      auth0UserId,
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      scopeCount: normalizedScopes.length,
    });

    // Map Auth0 user ID to local user on successful login
    if (auth0UserId && email) {
      // Use authenticated session email as the trusted source instead of client-controlled body email
      const { auth0 } = await import('@/lib/auth0');
      const session = await auth0.getSession(request);
      const trustedEmail = session?.user?.email;
      const trustedAuth0UserId = session?.user?.sub;
      
      // Validate that the Auth0 user ID matches the authenticated session
      // This prevents attackers from mapping arbitrary Auth0 IDs to local users
      if (!trustedEmail || !trustedAuth0UserId || trustedAuth0UserId !== auth0UserId) {
        return NextResponse.json({ error: 'Authenticated session required' }, { status: 401 });
      }

      const localUserId = await getLocalUserIdFromAuth0(auth0UserId);

      if (localUserId) {
        // Auth0 user already mapped — refresh the mapping timestamp
        await mapAuth0UserId(localUserId, auth0UserId);
        console.log('[Auth0 Post-Callback] Refreshed Auth0→local user mapping for:', localUserId);
      } else {
        // Try to find local user by trusted email and map it
        const { getDatabase } = await import('@/lib/database/connection');
        const db = getDatabase();
        if (db) {
          const userRow = db.prepare('SELECT id FROM users WHERE email = ? AND is_active = TRUE').get(trustedEmail) as { id: string } | undefined;
          if (userRow) {
            await mapAuth0UserId(userRow.id, auth0UserId);
            console.log('[Auth0 Post-Callback] Mapped Auth0 user to local user:', userRow.id);
          } else {
            console.log('[Auth0 Post-Callback] No local user found for email:', trustedEmail);
          }
        }
      }
    }

    // Save connected account with scopes if provided
    if (connectedAccount && auth0UserId) {
      const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
      if (localUserId) {
        const provider = normalizeProvider(connectedAccount.connection || connectedAccount.provider);
        
        // Save the connection with scopes
        await saveConnectedAccount(
          localUserId,
          provider,
          connectedAccount.id || 'unknown',
          provider,
          accessToken,
          refreshToken,
          tokenExpiresAt ? new Date(tokenExpiresAt) : undefined,
          scopes == null ? undefined : normalizedScopes
        );
        console.log('[Auth0 Post-Callback] Saved connected account:', provider, {
          scopeCount: normalizedScopes.length,
        });

        // Auto-grant basic permissions based on scopes
        if (normalizedScopes.length > 0) {
          const { grantServicePermission } = await import('@/lib/oauth/permission-tracker');

          // Get the connection ID we just saved
          const { getDatabase } = await import('@/lib/database/connection');
          const db = getDatabase();
          if (db) {
            const connRow = db.prepare(`
              SELECT id FROM external_connections
              WHERE user_id = ? AND provider = ? AND provider_account_id = ?
            `).get(localUserId, provider, connectedAccount.id || 'unknown') as { id: number } | undefined;

            if (connRow) {
              // Analyze scopes and grant appropriate permissions
              // Use explicit Gmail scope names, not generic 'mail' or 'email' (OIDC scope)
              if (normalizedScopes.some(s => 
                s.includes('gmail') || 
                s.includes('mail.send') || 
                s.includes('mail.read') ||
                s === 'https://www.googleapis.com/auth/gmail.compose' ||
                s === 'https://www.googleapis.com/auth/gmail.readonly'
              )) {
                await grantServicePermission(localUserId, connRow.id, 'gmail', 'read');
                console.log('[Auth0 Post-Callback] Auto-granted Gmail permission');
              }

              // Drive scopes
              if (normalizedScopes.some(s => s.includes('drive'))) {
                await grantServicePermission(localUserId, connRow.id, 'drive', 'read');
                console.log('[Auth0 Post-Callback] Auto-granted Drive permission');
              }

              // Calendar scopes
              if (normalizedScopes.some(s => s.includes('calendar'))) {
                await grantServicePermission(localUserId, connRow.id, 'calendar', 'read');
                console.log('[Auth0 Post-Callback] Auto-granted Calendar permission');
              }

              // Contacts scopes
              if (normalizedScopes.some(s => s.includes('contacts') || s.includes('directory'))) {
                await grantServicePermission(localUserId, connRow.id, 'contacts', 'read');
                console.log('[Auth0 Post-Callback] Auto-granted Contacts permission');
              }
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      scopeCount: normalizedScopes.length,
    });
  } catch (error: any) {
    console.error('[Auth0 Post-Callback] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
