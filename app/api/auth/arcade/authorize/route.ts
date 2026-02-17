import { NextRequest, NextResponse } from 'next/server';
import Arcade from '@arcadeai/arcadejs';
import { verifyAuth } from '@/lib/auth/jwt';

const arcade = new Arcade({
  apiKey: process.env.ARCADE_API_KEY || '',
});

export async function GET(req: NextRequest) {
  // Extract provider before try block so it's accessible in catch
  const provider = req.nextUrl.searchParams.get('provider');

  try {
    // CRITICAL: Authenticate user from JWT token - do NOT trust userId from query string
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Use authenticated userId from token, ignore query userId
    const authenticatedUserId = authResult.userId;

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }

    if (!process.env.ARCADE_API_KEY) {
      return NextResponse.json({ error: 'Arcade API key not configured' }, { status: 500 });
    }

    // Map provider to Arcade toolkit name for listing tools
    const providerToolkitMap: Record<string, string> = {
      google: 'Google',
      gmail: 'Gmail',
      googledocs: 'GoogleDocs',
      googlesheets: 'GoogleSheets',
      googlecalendar: 'GoogleCalendar',
      googledrive: 'GoogleDrive',
      googlemaps: 'GoogleMaps',
      googlenews: 'GoogleNews',
      exa: 'Exa',
      twilio: 'Twilio',
      spotify: 'Spotify',
      vercel: 'Vercel',
      railway: 'Railway',
    };

    const toolkitName = providerToolkitMap[provider] || provider;

    // List all tools in the toolkit to collect required scopes
    const toolkit = await arcade.tools.list({ toolkit: toolkitName });
    
    // Collect all OAuth scopes required by tools in this toolkit
    const scopes = new Set(
      (toolkit.items || []).flatMap(tool => 
        tool.requirements?.authorization?.oauth2?.scopes ?? []
      )
    );

    // If no scopes found, use a default based on provider
    const scopesArray = scopes.size > 0 ? [...scopes] : ['openid', 'email', 'profile'];

    // Start authorization with all collected scopes at once
    const authResponse = await arcade.auth.start(
      authenticatedUserId,
      provider,
      { scopes: scopesArray }
    );

    // Return the authorization URL for popup window
    return NextResponse.json({
      authUrl: authResponse.url,
      authId: authResponse.id,
      status: authResponse.status,
    });
  } catch (error: any) {
    console.error('[Arcade Auth] Error:', error);
    // Handle toolkit not found error
    if (error.message?.includes('toolkit')) {
      return NextResponse.json({ error: `Unknown provider toolkit: ${provider}` }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}