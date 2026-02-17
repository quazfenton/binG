import { NextRequest, NextResponse } from 'next/server';
import { Nango } from '@nangohq/node';
import { verifyAuth } from '@/lib/auth/jwt';

// Initialize Nango client
const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

export async function GET(req: NextRequest) {
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

    const provider = req.nextUrl.searchParams.get('provider');

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }

    if (!process.env.NANGO_SECRET_KEY) {
      return NextResponse.json({ error: 'Nango secret key not configured' }, { status: 500 });
    }

    // Create a Nango connect session with the authenticated user's ID
    const connectSession = await nango.createConnectSession({
      tags: {
        end_user_id: authenticatedUserId,
        // In a real app, you'd get the actual email from the authenticated user
        end_user_email: `${authenticatedUserId}@example.com`,
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