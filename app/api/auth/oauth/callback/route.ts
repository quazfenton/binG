import { NextRequest, NextResponse } from 'next/server';
import { oauthService } from '@/lib/auth/oauth-service';

const TOKEN_ENDPOINTS: Record<string, string> = {
  google: 'https://oauth2.googleapis.com/token',
  github: 'https://github.com/login/oauth/access_token',
  spotify: 'https://accounts.spotify.com/api/token',
  slack: 'https://slack.com/api/oauth.v2.access',
  notion: 'https://api.notion.com/v1/oauth/token',
  discord: 'https://discord.com/api/oauth2/token',
};

const USER_INFO_ENDPOINTS: Record<string, string> = {
  google: 'https://www.googleapis.com/oauth2/v2/userinfo',
  github: 'https://api.github.com/user',
  spotify: 'https://api.spotify.com/v1/me',
  discord: 'https://discord.com/api/users/@me',
};

function getClientCredentials(provider: string): { clientId: string; clientSecret: string } | null {
  const prefix = provider.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  
  // Validate that credentials are configured for this provider
  if (!clientId || !clientSecret) {
    console.error(`[OAuth] Provider '${provider}' not configured - missing environment variables`);
    return null;
  }
  
  return { clientId, clientSecret };
}

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
    const error = req.nextUrl.searchParams.get('error');
    const origin = req.nextUrl.searchParams.get('origin');

    if (error) {
      // For popup flows, redirect to error page
      if (origin) {
        return NextResponse.redirect(
          `${req.nextUrl.origin}/api/auth/oauth/error?error=${encodeURIComponent(error)}&origin=${encodeURIComponent(origin)}`
        );
      }
      return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      if (origin) {
        return NextResponse.redirect(
          `${req.nextUrl.origin}/api/auth/oauth/error?error=missing_params&origin=${encodeURIComponent(origin)}`
        );
      }
      return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=missing_params`);
    }

    const session = await oauthService.getOAuthSessionByState(state);
    if (!session) {
      if (origin) {
        return NextResponse.redirect(
          `${req.nextUrl.origin}/api/auth/oauth/error?error=invalid_state&origin=${encodeURIComponent(origin)}`
        );
      }
      return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=invalid_state`);
    }

    const tokenEndpoint = TOKEN_ENDPOINTS[session.provider];
    if (!tokenEndpoint) {
      if (origin) {
        return NextResponse.redirect(
          `${req.nextUrl.origin}/api/auth/oauth/error?error=unsupported_provider&origin=${encodeURIComponent(origin)}`
        );
      }
      return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=unsupported_provider`);
    }

    // Get and validate provider credentials
    const credentials = getClientCredentials(session.provider);
    if (!credentials) {
      // Provider not configured - return early with clear error
      if (origin) {
        return NextResponse.redirect(
          `${req.nextUrl.origin}/api/auth/oauth/error?error=provider_not_configured&origin=${encodeURIComponent(origin)}`
        );
      }
      return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=provider_not_configured`);
    }
    
    const { clientId, clientSecret } = credentials;
    const redirectUri = session.redirectUri || `${req.nextUrl.origin}/api/auth/oauth/callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      console.error('[OAuth] Token exchange failed:', errBody);
      if (origin) {
        return NextResponse.redirect(
          `${req.nextUrl.origin}/api/auth/oauth/error?error=token_exchange_failed&origin=${encodeURIComponent(origin)}`
        );
      }
      return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in;

    // Get user info from provider
    let providerAccountId = 'unknown';
    let providerDisplayName: string | undefined;
    const userInfoUrl = USER_INFO_ENDPOINTS[session.provider];

    if (userInfoUrl && accessToken) {
      try {
        const userResp = await fetch(userInfoUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userResp.ok) {
          const userData = await userResp.json();
          providerAccountId = userData.id?.toString() || userData.sub || userData.login || 'unknown';
          providerDisplayName = userData.name || userData.display_name || userData.email || userData.login;
        }
      } catch {
        // Non-fatal — we can still save the connection
      }
    }

    // Save the connection
    await oauthService.saveConnection({
      userId: session.userId!,
      provider: session.provider,
      providerAccountId,
      providerDisplayName,
      accessToken,
      refreshToken,
      expiresIn,
    });

    await oauthService.completeOAuthSession(state);

    // Check if this is a popup OAuth flow (origin parameter present)
    if (origin) {
      // Redirect to success page which will postMessage to opener and close popup
      return NextResponse.redirect(
        `${req.nextUrl.origin}/api/auth/oauth/success?provider=${encodeURIComponent(session.provider)}&origin=${encodeURIComponent(origin)}`
      );
    }

    return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_success=${encodeURIComponent(session.provider)}`);
  } catch (error: any) {
    console.error('[OAuth] Callback error:', error);
    const origin = req.nextUrl.searchParams.get('origin');
    if (origin) {
      return NextResponse.redirect(
        `${req.nextUrl.origin}/api/auth/oauth/error?error=internal&origin=${encodeURIComponent(origin)}`
      );
    }
    return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=internal`);
  }
}
