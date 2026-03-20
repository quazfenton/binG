import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';

/**
 * GET /api/user/integrations/status
 * Returns all connected integrations for a user with their OAuth source
 * 
 * Query params:
 * - userId: The local user ID
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const db = getDatabase();
    const localUserId = parseInt(userId, 10);
    
    if (isNaN(localUserId)) {
      return NextResponse.json(
        { error: 'Invalid userId' },
        { status: 400 }
      );
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

    // Determine OAuth source for each connection
    // We infer the source based on provider patterns
    const connectionsWithSource = connections.map(conn => {
      let source: 'auth0' | 'arcade' | 'nango' | 'oauth' = 'oauth';
      
      // Auth0 Connected Accounts providers (social logins)
      const auth0Providers = ['github', 'google', 'facebook', 'twitter', 'linkedin', 
        'apple', 'microsoft', 'instagram', 'bitbucket', 'slack', 'windowslive'];
      
      // Arcade providers
      const arcadeProviders = ['gmail', 'googledocs', 'googlesheets', 'googlecalendar', 
        'googledrive', 'spotify', 'exa', 'twilio', 'vercel', 'railway'];
      
      // Nango providers
      const nangoProviders = ['discord', 'reddit'];

      const provider = conn.provider.toLowerCase();
      
      if (auth0Providers.includes(provider)) {
        source = 'auth0';
      } else if (arcadeProviders.includes(provider)) {
        source = 'arcade';
      } else if (nangoProviders.includes(provider)) {
        source = 'nango';
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