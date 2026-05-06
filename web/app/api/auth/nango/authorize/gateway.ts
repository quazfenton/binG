import { NextRequest, NextResponse } from 'next/server';


import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { oauthIntegration } from '@/lib/oauth';

export async function GET(req: NextRequest) {
  try {
    const shouldRedirect = req.nextUrl.searchParams.get('redirect') === '1';
    const tokenFromQuery = req.nextUrl.searchParams.get('token');
    const authResult = await resolveRequestAuth(req, {
      bearerToken: tokenFromQuery,
      allowAnonymous: false,
    });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    const authenticatedUserId = authResult.userId;
    const provider = req.nextUrl.searchParams.get('provider');

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }

    // Use new oauthIntegration API
    const result = await oauthIntegration.connect(provider, authenticatedUserId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.message || 'Authorization failed' },
        { status: result.message?.includes('Unknown provider') ? 400 : 500 }
      );
    }

    // Return the authorization URL for popup window
    if (shouldRedirect) {
      const redirectResponse = NextResponse.redirect(result.authUrl);
      redirectResponse.headers.set('Referrer-Policy', 'no-referrer');
      return redirectResponse;
    }

    return NextResponse.json({
      authUrl: result.authUrl,
      provider,
      status: 'pending',
    });
  } catch (error: any) {
    console.error('[Nango Auth] Error:', error);
    return NextResponse.json({ error: 'Authorization failed' }, { status: 500 });
  }
}
