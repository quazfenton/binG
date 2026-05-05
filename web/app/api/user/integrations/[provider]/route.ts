import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { disconnectProviderAll } from '@/lib/oauth/connections';

/**
 * DELETE /api/user/integrations/[provider]
 * Disconnects a provider from all OAuth systems (Auth0 + Nango/Arcade/Composio)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }

    // Authenticate: require valid auth - NO fallback to body userId
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ 
        error: 'Authentication required',
        requiresAuth: true,
      }, { status: 401 });
    }

    // userId is now a string (UUID)
    const userId = authResult.userId;

    if (!userId) {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
    }

    const success = await disconnectProviderAll(userId, provider);

    if (success) {
      return NextResponse.json({
        success: true,
        provider,
        message: `Disconnected ${provider} from all systems`,
      });
    }

    return NextResponse.json(
      { error: `Failed to disconnect ${provider}` },
      { status: 500 }
    );
  } catch (error: any) {
    console.error('[Integrations Disconnect] Error:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect integration' },
      { status: 500 }
    );
  }
}
