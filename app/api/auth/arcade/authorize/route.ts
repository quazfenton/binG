import { NextRequest, NextResponse } from 'next/server';
import Arcade from '@arcadeai/arcadejs';

const arcade = new Arcade({
  apiKey: process.env.ARCADE_API_KEY || '',
});

export async function GET(req: NextRequest) {
  try {
    const provider = req.nextUrl.searchParams.get('provider');
    const userId = req.nextUrl.searchParams.get('userId');

    if (!provider || !userId) {
      return NextResponse.json({ error: 'provider and userId are required' }, { status: 400 });
    }

    if (!process.env.ARCADE_API_KEY) {
      return NextResponse.json({ error: 'Arcade API key not configured' }, { status: 500 });
    }

    // Map provider to Arcade tool name
    const providerToolMap: Record<string, string> = {
      google: 'Google.*',
      gmail: 'Gmail.*',
      googledocs: 'GoogleDocs.*',
      googlesheets: 'GoogleSheets.*',
      googlecalendar: 'GoogleCalendar.*',
      googledrive: 'GoogleDrive.*',
      googlemaps: 'GoogleMaps.*',
      googlenews: 'GoogleNews.*',
      exa: 'Exa.*',
      twilio: 'Twilio.*',
      spotify: 'Spotify.*',
      vercel: 'Vercel.*',
      railway: 'Railway.*',
    };

    const toolPattern = providerToolMap[provider] || `${provider}.*`;

    // Initiate authorization with Arcade
    const authResponse = await arcade.tools.authorize({
      tool_name: toolPattern,
      user_id: userId,
    });

    // Return the authorization URL for popup window
    return NextResponse.json({
      authUrl: authResponse.url,
      authId: authResponse.id,
      status: authResponse.status,
    });
  } catch (error: any) {
    console.error('[Arcade Auth] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}