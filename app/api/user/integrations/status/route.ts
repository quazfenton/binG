import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { getToolServiceForPlatform } from '@/lib/oauth/provider-map';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

/**
 * GET /api/user/integrations/status
 * Returns all connected integrations for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const localUserId = Number(authResult.userId);
    if (!Number.isFinite(localUserId)) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 401 });
    }

    const db = getDatabase();

    // Verify user exists
    const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(localUserId);
    if (!userExists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get all active external connections for the user
    const connections = db.prepare(`
      SELECT 
        provider,
        provider_account_id,
        provider_display_name,
        is_active,
        created_at,
        updated_at,
        last_accessed_at
      FROM external_connections 
      WHERE user_id = ? AND is_active = TRUE
      ORDER BY updated_at DESC
    `).all(localUserId) as Array<{
      provider: string;
      provider_account_id: string;
      provider_display_name?: string;
      is_active: number;
      created_at: string;
      updated_at: string;
      last_accessed_at?: string;
    }>;

    // Determine OAuth source for each connection using centralized provider map
    const connectionsWithSource = connections.map(conn => {
      const provider = conn.provider.toLowerCase();
      const toolService = getToolServiceForPlatform(provider);

      // Determine source: use tool service if available, fall back to 'auth0' for social logins, else 'oauth'
      let source: 'auth0' | 'arcade' | 'nango' | 'oauth' = 'oauth';
      if (toolService === 'arcade') {
        source = 'arcade';
      } else if (toolService === 'nango') {
        source = 'nango';
      } else {
        // Social login providers handled by Auth0
        const auth0Socials = new Set(['github', 'google', 'google-oauth2', 'facebook', 'twitter', 'linkedin',
          'apple', 'microsoft', 'windowslive', 'instagram', 'bitbucket', 'slack']);
        if (auth0Socials.has(provider)) {
          source = 'auth0';
        }
      }

      return {
        provider: conn.provider,
        providerAccountId: conn.provider_account_id,
        providerDisplayName: conn.provider_display_name,
        source,
        connected: conn.is_active === 1,
        createdAt: conn.created_at,
        updatedAt: conn.updated_at,
        lastAccessedAt: conn.last_accessed_at,
      };
    });

    return NextResponse.json({
      connections: connectionsWithSource,
      total: connectionsWithSource.length,
    });
  } catch (error) {
    console.error('[Integrations Status] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch integration status' },
      { status: 500 }
    );
  }
}