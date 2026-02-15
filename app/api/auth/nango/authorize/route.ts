import { NextRequest, NextResponse } from 'next/server';
import { Nango } from '@nangohq/node';

// Initialize Nango client
const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

export async function GET(req: NextRequest) {
  try {
    const provider = req.nextUrl.searchParams.get('provider');
    const userId = req.nextUrl.searchParams.get('userId');

    if (!provider || !userId) {
      return NextResponse.json({ error: 'provider and userId are required' }, { status: 400 });
    }

    if (!process.env.NANGO_SECRET_KEY) {
      return NextResponse.json({ error: 'Nango secret key not configured' }, { status: 500 });
    }

    // Create a Nango connect session
    const connectSession = await nango.createConnectSession({
      tags: {
        end_user_id: userId,
        end_user_email: `${userId}@example.com`, // In a real app, you'd get the actual email
      },
      allowed_integrations: [provider]
    });

    // Return the connect session token
    // The frontend would use this with Nango's frontend SDK to initiate the connection
    return NextResponse.json({ 
      sessionToken: connectSession.data.token,
      connectLink: connectSession.data.connect_link,
      expiresAt: connectSession.data.expires_at
    });
  } catch (error: any) {
    console.error('[Nango Auth] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}