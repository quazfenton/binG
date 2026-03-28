/**
 * GitHub OAuth Authorize
 *
 * Initiates GitHub OAuth flow for source control features.
 * Sets HttpOnly state cookie for CSRF protection.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGitHubOAuthUrl } from '@/lib/github/github-oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  try {
    // Get requested scopes from query params
    const requestedScopes = url.searchParams.get('scopes')?.split(',').map(s => s.trim()).filter(Boolean) || ['repo', 'user', 'workflow'];

    // Validate scopes against whitelist to prevent unauthorized access
    const allowedScopes = ['repo', 'user', 'workflow', 'read:user', 'user:email', 'admin:repo_hook', 'write:repo_hook'];
    const validScopes = requestedScopes.filter(scope => allowedScopes.includes(scope));
    
    // Log if any invalid scopes were requested
    const invalidScopes = requestedScopes.filter(scope => !allowedScopes.includes(scope));
    if (invalidScopes.length > 0) {
      console.warn('[GitHub Authorize] Invalid scopes requested:', invalidScopes);
    }
    
    // Ensure we have at least some valid scopes
    const scopes = validScopes.length > 0 ? validScopes : ['repo', 'user', 'workflow'];

    // Generate OAuth URL with state
    const { url: oauthUrl, state } = getGitHubOAuthUrl(scopes);

    // Create redirect response
    const response = NextResponse.redirect(oauthUrl);

    // Set state as HttpOnly, Secure cookie for CSRF protection
    response.cookies.set('github_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 minutes
      path: '/api/integrations/github/oauth/callback',
    });

    return response;
  } catch (error: any) {
    console.error('[GitHub Authorize] Error:', error);

    const redirectUrl = new URL('/settings', url.origin);
    redirectUrl.searchParams.set('github_error', error.message || 'Failed to initiate GitHub OAuth');

    return NextResponse.redirect(redirectUrl);
  }
}
