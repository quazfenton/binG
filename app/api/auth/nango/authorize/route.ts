import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

// Lazy-initialize Nango client to avoid crash when env var is missing
let _nango: any | null = null;
function getNango() {
  if (!_nango) {
    const nangoSecret = process.env.NANGO_SECRET_KEY || process.env.NANGO_API_KEY;
    if (!nangoSecret) {
      throw new Error('Nango secret key not configured');
    }
    const { Nango } = require('@nangohq/node');
    _nango = new Nango({ secretKey: nangoSecret });
  }
  return _nango;
}

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

    // Use authenticated userId from token, ignore query userId
    const authenticatedUserId = authResult.userId;

    const provider = req.nextUrl.searchParams.get('provider');

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }

    // Create a Nango connect session with the authenticated user's ID
    const nango = getNango();
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
    if (shouldRedirect) {
      return NextResponse.redirect(connectSession.data.connect_link);
    }

    return NextResponse.json({
      sessionToken: connectSession.data.token,
      connectLink: connectSession.data.connect_link,
      expiresAt: connectSession.data.expires_at
    });
  } catch (error: any) {
    console.error('[Nango Auth] Error:', error);
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Authorization failed' }, { status: 500 });
  }
}
