import { NextRequest, NextResponse } from 'next/server';
import { oauthService } from '@/lib/auth/oauth-service';

const OAUTH_CONFIGS: Record<string, { authUrl: string; scopes: string; clientIdEnv: string }> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scopes: 'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    scopes: 'repo user read:org',
    clientIdEnv: 'GITHUB_CLIENT_ID',
  },
  spotify: {
    authUrl: 'https://accounts.spotify.com/authorize',
    scopes: 'user-read-playback-state user-modify-playback-state playlist-modify-public',
    clientIdEnv: 'SPOTIFY_CLIENT_ID',
  },
  slack: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    scopes: 'chat:write channels:read channels:history',
    clientIdEnv: 'SLACK_CLIENT_ID',
  },
  notion: {
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    scopes: '',
    clientIdEnv: 'NOTION_CLIENT_ID',
  },
  discord: {
    authUrl: 'https://discord.com/oauth2/authorize',
    scopes: 'bot messages.read',
    clientIdEnv: 'DISCORD_CLIENT_ID',
  },
};

export async function GET(req: NextRequest) {
  try {
    const provider = req.nextUrl.searchParams.get('provider');
    const userId = req.nextUrl.searchParams.get('userId');

    if (!provider || !userId) {
      return NextResponse.json({ error: 'provider and userId are required' }, { status: 400 });
    }

    const config = OAUTH_CONFIGS[provider];
    if (!config) {
      return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
    }

    const clientId = process.env[config.clientIdEnv];
    if (!clientId) {
      return NextResponse.json({ error: `${provider} OAuth not configured` }, { status: 500 });
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin}/api/auth/oauth/callback`;

    const session = await oauthService.createOAuthSession({
      userId: parseInt(userId, 10),
      provider,
      redirectUri,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scopes,
      state: session.state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return NextResponse.redirect(`${config.authUrl}?${params.toString()}`);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
