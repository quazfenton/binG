/**
 * GitHub OAuth Authorize
 * 
 * Initiates GitHub OAuth flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGitHubOAuthUrl } from '@/lib/github/github-oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  
  try {
    // Get requested scopes from query params
    const scopes = url.searchParams.get('scopes')?.split(',') || ['repo', 'user', 'workflow'];

    // Generate OAuth URL
    const oauthUrl = getGitHubOAuthUrl(scopes);

    // Redirect to GitHub
    return NextResponse.redirect(oauthUrl);
  } catch (error: any) {
    console.error('[GitHub Authorize] Error:', error);

    const redirectUrl = new URL('/settings', url.origin);
    redirectUrl.searchParams.set('github_error', error.message || 'Failed to initiate GitHub OAuth');

    return NextResponse.redirect(redirectUrl);
  }
}
