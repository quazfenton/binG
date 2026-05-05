/**
 * GitHub OAuth Callback
 *
 * Handles OAuth callback from GitHub after user authorization.
 * Verifies state parameter against HttpOnly cookie for CSRF protection.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { exchangeCodeForToken, getGitHubUser, saveGitHubToken } from '@/lib/github/github-oauth';
import { auth0 } from '@/lib/auth0';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    // Check for errors
    if (error) {
      const errorDescription = url.searchParams.get('error_description') || 'GitHub OAuth failed';
      console.error('[GitHub Callback] Error:', errorDescription);

      const errorUrl = new URL('/settings', url.origin);
      errorUrl.searchParams.set('github_error', errorDescription);
      return NextResponse.redirect(errorUrl);
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
    }

    // Verify state parameter against cookie (CSRF protection)
    const cookieState = request.cookies.get('github_oauth_state')?.value;

    if (!cookieState) {
      console.error('[GitHub Callback] State cookie not found');
      return NextResponse.json({ error: 'OAuth state not found. Please try again.' }, { status: 400 });
    }

    if (state !== cookieState) {
      console.error('[GitHub Callback] State mismatch - possible CSRF attack');
      return NextResponse.json({ error: 'Invalid OAuth state. Please try again.' }, { status: 400 });
    }

    console.log('[GitHub Callback] State verified, exchanging code for token...');

    // Exchange code for token
    const token = await exchangeCodeForToken(code, state);

    console.log('[GitHub Callback] Token obtained, fetching user info...');

    // Get user info
    const user = await getGitHubUser(token.accessToken);

    console.log('[GitHub Callback] User info:', user.login);

    // Get Auth0 session to get local user ID
    const auth0Session = await auth0.getSession(request);

    if (!auth0Session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get local user ID from Auth0 user
    const { getLocalUserIdFromAuth0 } = await import('@/lib/oauth/connections');
    const auth0UserId = auth0Session.user.sub;
    let localUserId = await getLocalUserIdFromAuth0(auth0UserId);

    if (!localUserId) {
      // Try to find by email
      const { getDatabase } = await import('@/lib/database/connection');
      const db = getDatabase();
      const email = auth0Session.user.email;

      if (email) {
        const userRow = db.prepare('SELECT id FROM users WHERE email = ? AND is_active = TRUE').get(email) as { id: string } | undefined;
        if (userRow) {
          localUserId = userRow.id;
          console.log('[GitHub Callback] Found local user by email:', localUserId);
        }
      }
    }

    if (!localUserId) {
      return NextResponse.json({ error: 'Local user not found' }, { status: 404 });
    }

    // Save GitHub token
    await saveGitHubToken(localUserId, token, user);

    console.log('[GitHub Callback] GitHub connected for user:', localUserId);

    // Clear the state cookie after successful validation and redirect with success params
    const redirectUrl = new URL('/settings', url.origin);
    redirectUrl.searchParams.set('github_connected', 'true');
    redirectUrl.searchParams.set('github_login', user.login);

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete('github_oauth_state');

    return response;
  } catch (error: any) {
    console.error('[GitHub Callback] Error:', error);

    const url = new URL(request.url);
    const errorUrl = new URL('/settings', url.origin);
    errorUrl.searchParams.set('github_error', error.message || 'Failed to connect GitHub');

    return NextResponse.redirect(errorUrl);
  }
}
