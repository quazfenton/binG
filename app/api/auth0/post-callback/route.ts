import { NextRequest, NextResponse } from 'next/server';
import { getLocalUserIdFromAuth0, mapAuth0UserId } from '@/lib/oauth/connections';
import { saveConnectedAccount } from '@/lib/auth0';

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

    // Map Auth0 user ID to local user on successful login
    if (auth0UserId && email) {
      const localUserId = await getLocalUserIdFromAuth0(auth0UserId);

      if (localUserId) {
        // Auth0 user already mapped — refresh the mapping timestamp
        await mapAuth0UserId(localUserId, auth0UserId);
        console.log('[Auth0 Post-Callback] Refreshed Auth0→local user mapping for:', localUserId);
      } else {
        // Try to find local user by email and map it
        const { getDatabase } = await import('@/lib/database/connection');
        const db = getDatabase();
        if (db) {
          const userRow = db.prepare('SELECT id FROM users WHERE email = ? AND is_active = TRUE').get(email) as { id: number } | undefined;
          if (userRow) {
            await mapAuth0UserId(userRow.id, auth0UserId);
            console.log('[Auth0 Post-Callback] Mapped Auth0 user to local user:', userRow.id);
          } else {
            console.log('[Auth0 Post-Callback] No local user found for email:', email);
          }
        }
      }
    }

    // Save connected account if provided
    if (connectedAccount && auth0UserId) {
      const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
      if (localUserId) {
        await saveConnectedAccount(
          localUserId,
          connectedAccount.connection || connectedAccount.provider,
          connectedAccount.id || 'unknown',
          connectedAccount.connection || connectedAccount.provider,
          accessToken,
          refreshToken,
          tokenExpiresAt ? new Date(tokenExpiresAt) : undefined,
          scopes
        );
        console.log('[Auth0 Post-Callback] Saved connected account:', connectedAccount.connection || connectedAccount.provider);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Auth0 Post-Callback] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
