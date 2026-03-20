import { NextRequest, NextResponse } from 'next/server';
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

    // Authenticate: try bearer token, then fall back to body userId
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

    let numericUserId: number;

    if (authResult.success && authResult.userId) {
      numericUserId = parseInt(authResult.userId, 10);
    } else {
      // Fallback: read userId from request body
      const body = await request.json().catch(() => ({}));
      const bodyUserId = body?.userId;
      if (!bodyUserId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      numericUserId = parseInt(bodyUserId, 10);
    }

    if (isNaN(numericUserId)) {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
    }

    const success = await disconnectProviderAll(numericUserId, provider);

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
