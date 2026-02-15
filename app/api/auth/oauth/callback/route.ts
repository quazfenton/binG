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

function getClientCredentials(provider: string): { clientId: string; clientSecret: string } {
  const prefix = provider.toUpperCase();
  return {
    clientId: process.env[`${prefix}_CLIENT_ID`] || '',
    clientSecret: process.env[`${prefix}_CLIENT_SECRET`] || '',
  };
}

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
    const error = req.nextUrl.searchParams.get('error');

    if (error) {
      return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=${error}`);
    }

    if (!code || !state) {
      return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=missing_params`);
    }

    const session = await oauthService.getOAuthSessionByState(state);
    if (!session) {
      return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=invalid_state`);
    }

    const tokenEndpoint = TOKEN_ENDPOINTS[session.provider];
    if (!tokenEndpoint) {
      return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=unsupported_provider`);
    }

    const { clientId, clientSecret } = getClientCredentials(session.provider);
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

    return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_success=${session.provider}`);
  } catch (error: any) {
    console.error('[OAuth] Callback error:', error);
    return NextResponse.redirect(`${req.nextUrl.origin}/settings?oauth_error=internal`);
  }
}
