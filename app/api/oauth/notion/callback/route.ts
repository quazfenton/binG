import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ error: 'No authorization code provided' }, { status: 400 });
    }

    // SECURITY: Validate OAuth state parameter to prevent CSRF attacks
    const storedState = req.cookies.get('notion_oauth_state')?.value;
    if (!storedState || state !== storedState) {
      return NextResponse.json({ error: 'Invalid OAuth state parameter' }, { status: 400 });
    }

    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;
    const redirectUri = process.env.NOTION_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      return NextResponse.json(
        { error: 'NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, and NOTION_REDIRECT_URI are required' },
        { status: 500 }
      );
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok) {
      return NextResponse.json(
        { error: data?.error || 'Notion token exchange failed' },
        { status: tokenRes.status }
      );
    }

    const response = NextResponse.json({
      success: true,
      workspace_id: data.workspace_id,
      workspace_name: data.workspace_name,
      // SECURITY: Don't expose access_token in JSON response
      // Token is stored in httpOnly cookie for secure server-side use
    });

    // Store access token in httpOnly cookie (not accessible to JavaScript)
    response.cookies.set('notion_access_token', data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/notion',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    // Clear the state cookie after successful validation
    response.cookies.delete('notion_oauth_state');
    return response;
  } catch (err) {
    console.error('Notion callback error:', err);
    return NextResponse.json({ error: 'Notion OAuth callback fails' }, { status: 500 });
  }
}
