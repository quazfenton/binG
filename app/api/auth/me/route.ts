/**
 * GET /api/auth/me - Get current Auth0 user session and connected accounts
 * 
 * Returns user profile, connected accounts status, and available tokens.
 * This is the standard Auth0 endpoint for checking authentication status.
 * 
 * Response format:
 * {
 *   authenticated: boolean,
 *   user?: { name, email, sub, ... },
 *   connections?: Array<{ provider, connected }>
 * }
 */
import { NextResponse } from 'next/server';
import { auth0, AUTH0_CONNECTIONS, getConnectedAccountsByUser } from '@/lib/auth0';
import { getLocalUserIdFromAuth0 } from '@/lib/oauth/connections';

const AUTH0_TO_CANONICAL: Record<string, string> = {
  'github': 'github',
  'google-oauth2': 'google',
  'windowslive': 'microsoft',
  'facebook': 'facebook',
  'twitter': 'twitter',
  'linkedin': 'linkedin',
  'apple': 'apple',
  'instagram': 'instagram',
  'bitbucket': 'bitbucket',
  'slack': 'slack',
};

export async function GET() {
  try {
    const session = await auth0.getSession();
    
    if (!session) {
      return NextResponse.json({ 
        authenticated: false,
        connections: [] 
      });
    }

    const auth0UserId = session.user.sub;
    const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
    
    const connectedProviders = new Set(
      localUserId ? getConnectedAccountsByUser(localUserId).map((account) => account.provider) : []
    );
    const connections = Object.entries(AUTH0_CONNECTIONS).map(([name, connection]) => {
      const normalizedConnection = AUTH0_TO_CANONICAL[connection] || connection;
      return {
        provider: name.toLowerCase(),
        connection,
        connected: connectedProviders.has(normalizedConnection),
      };
    });

    return NextResponse.json({
      authenticated: true,
      user: {
        name: session.user.name,
        email: session.user.email,
        sub: session.user.sub,
        picture: session.user.picture,
      },
      connections,
    });
  } catch (error) {
    console.error('[Auth0 /api/auth/me] Error:', error);
    return NextResponse.json(
      { 
        authenticated: false,
        error: error instanceof Error ? error.message : 'Failed to get session',
        connections: []
      },
      { status: 500 }
    );
  }
}
