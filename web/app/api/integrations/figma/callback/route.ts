/**
 * Figma OAuth Callback
 *
 * Handles the OAuth callback from Figma after user authorization.
 * Exchanges authorization code for access token and stores it in the database.
 *
 * Flow:
 * 1. User clicks "Connect Figma" → redirected to /api/integrations/figma?action=authorize
 * 2. User authorizes in Figma popup → Figma redirects to this callback
 * 3. Exchange code for token → store in database
 * 4. Close popup and notify opener
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { getDatabase } from '@/lib/database/connection';
import { exchangeCodeForToken, calculateExpiryDate } from '@/lib/figma/oauth';
import { getFigmaRedirectUri } from '@/lib/figma/config';
import { oauthStateStore } from '../oauth-state-store';

export const runtime = 'nodejs';

/**
 * GET /api/integrations/figma/callback
 *
 * Query parameters:
 * - code: Authorization code from Figma
 * - state: State parameter for CSRF protection
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  try {
    // Handle OAuth error from Figma
    if (error) {
      const errorDescription = searchParams.get('error_description') || 'OAuth error';
      return NextResponse.redirect(
        new URL(`/?figmaError=${encodeURIComponent(errorDescription)}`, request.url)
      );
    }

    // Validate required parameters
    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/?figmaError=Invalid callback parameters', request.url)
      );
    }

    // Get session
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.redirect(
        new URL('/?figmaError=Authentication required', request.url)
      );
    }

    const userId = (session.user as any).id;
    if (!userId) {
      return NextResponse.redirect(
        new URL('/?figmaError=Invalid user session', request.url)
      );
    }

    // Validate state parameter - uses shared store from route.ts
    const stateData = oauthStateStore.get(state);
    if (!stateData) {
      return NextResponse.redirect(
        new URL('/?figmaError=Invalid or expired state parameter', request.url)
      );
    }

    // Check if state matches user
    if (stateData.userId !== userId) {
      return NextResponse.redirect(
        new URL('/?figmaError=State parameter mismatch', request.url)
      );
    }

    // Check if state is expired
    if (new Date() >= stateData.expiresAt) {
      oauthStateStore.delete(state);
      return NextResponse.redirect(
        new URL('/?figmaError=Authorization request expired', request.url)
      );
    }

    // Clean up state from store
    oauthStateStore.delete(state);

    // Exchange code for token
    const redirectUri = getFigmaRedirectUri();

    let tokenData;
    try {
      tokenData = await exchangeCodeForToken({
        code,
        codeVerifier: stateData.codeVerifier,
        redirectUri,
      });
    } catch (tokenError) {
      console.error('[Figma OAuth] Token exchange failed:', tokenError);
      return NextResponse.redirect(
        new URL('/?figmaError=Failed to exchange authorization code', request.url)
      );
    }

    // Save token to database
    const db = getDatabase();
    if (!db) {
      return NextResponse.redirect(
        new URL('/?figmaError=Database not available', request.url)
      );
    }

    try {
      const { encryptApiKey } = await import('@/lib/database/connection');

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO external_connections (
          user_id,
          provider,
          provider_account_id,
          provider_display_name,
          access_token_encrypted,
          refresh_token_encrypted,
          token_expires_at,
          scopes,
          is_active,
          updated_at
        ) VALUES (
          ?,
          'figma',
          'figma_oauth',
          'Figma',
          ?,
          ?,
          datetime('now', '+' || ? || ' seconds'),
          ?,
          TRUE,
          CURRENT_TIMESTAMP
        )
      `);

      stmt.run(
        userId,
        encryptApiKey(tokenData.access_token),
        encryptApiKey(tokenData.refresh_token),
        tokenData.expires_in,
        tokenData.scope
      );

      console.log('[Figma OAuth] Token saved successfully for user', userId);
    } catch (dbError) {
      console.error('[Figma OAuth] Database error:', dbError);
      return NextResponse.redirect(
        new URL('/?figmaError=Failed to save connection', request.url)
      );
    }

    // Redirect to success page
    return NextResponse.redirect(
      new URL('/?figmaConnected=success', request.url)
    );

  } catch (error) {
    console.error('[Figma OAuth Callback] Error:', error);
    return NextResponse.redirect(
      new URL('/?figmaError=An unexpected error occurred', request.url)
    );
  }
}
