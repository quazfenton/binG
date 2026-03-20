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
import { auth0, getConnectedAccounts } from '@/lib/auth0';

export async function GET() {
  try {
    const session = await auth0.getSession();
    
    if (!session) {
      return NextResponse.json({ 
        authenticated: false,
        connections: [] 
      });
    }

    // Get connection status for all providers
    const connections = await getConnectedAccounts();

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
