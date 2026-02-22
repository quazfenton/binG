import { NextRequest, NextResponse } from 'next/server';
import Arcade from '@arcadeai/arcadejs';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { authService } from '@/lib/auth/auth-service';

const arcade = new Arcade({
  apiKey: process.env.ARCADE_API_KEY || '',
});

export async function GET(req: NextRequest) {
  // Extract provider before try block so it's accessible in catch
  const provider = req.nextUrl.searchParams.get('provider');
  const shouldRedirect = req.nextUrl.searchParams.get('redirect') === '1';

  try {
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

    // Use authenticated userId from token/session, ignore query userId
    const authenticatedUserId = authResult.userId;

    const strategy = (process.env.ARCADE_USER_ID_STRATEGY || 'email').toLowerCase();
    let arcadeUserId = authenticatedUserId;
    
    if (strategy === 'email') {
      const numericUserId = Number(authenticatedUserId);
      
      if (Number.isNaN(numericUserId)) {
        // Invalid user ID format - cannot lookup email
        console.error(
          `[Arcade Auth] Email strategy failed: Invalid user ID format "${authenticatedUserId}". ` +
          `Expected numeric ID. Cannot proceed with email-based identification.`
        );
        // Return error instead of silent fallback to prevent orphaned authorizations
        return NextResponse.json(
          { 
            error: 'Invalid user ID format for email strategy',
            details: 'Email strategy requires a valid numeric user ID'
          }, 
          { status: 400 }
        );
      }
      
      const user = await authService.getUserById(numericUserId);
      
      if (!user) {
        // User not found
        console.error(
          `[Arcade Auth] Email strategy failed: User ${numericUserId} not found. ` +
          `Cannot proceed with email-based identification.`
        );
        return NextResponse.json(
          { 
            error: 'User not found for email strategy',
            details: `User ID ${numericUserId} does not exist`
          }, 
          { status: 404 }
        );
      }
      
      if (!user.email) {
        // User has no email
        console.error(
          `[Arcade Auth] Email strategy failed: User ${numericUserId} has no email address. ` +
          `Cannot proceed with email-based identification.`
        );
        return NextResponse.json(
          { 
            error: 'User has no email address',
            details: `User ${numericUserId} exists but has no email configured`
          }, 
          { status: 400 }
        );
      }
      
      // Success - use email as Arcade user ID
      arcadeUserId = user.email;
      console.log(`[Arcade Auth] Using email strategy for Arcade user ID for user ${numericUserId}`);
    }

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
      arcadeUserId,
      provider,
      { scopes: scopesArray }
    );

    // Return the authorization URL for popup window
    if (shouldRedirect) {
      // Add Referrer-Policy header to prevent JWT token leakage via Referer header
      const redirectResponse = NextResponse.redirect(authResponse.url);
      redirectResponse.headers.set('Referrer-Policy', 'no-referrer');
      return redirectResponse;
    }

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
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Authorization failed' }, { status: 500 });
  }
}
