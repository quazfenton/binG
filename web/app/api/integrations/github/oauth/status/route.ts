/**
 * GitHub Connection Status
 * 
 * Check if user has connected their GitHub account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { getGitHubToken, isGitHubConnected, getGitHubUser } from '@/lib/github/github-oauth';
import { getLocalUserIdFromAuth0 } from '@/lib/oauth/connections';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    
    if (!session?.user) {
      return NextResponse.json({ connected: false, error: 'Not authenticated' });
    }
    
    // Get local user ID from Auth0
    const auth0UserId = session.user.sub;
    const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
    
    if (!localUserId) {
      return NextResponse.json({ connected: false, error: 'Local user not found' });
    }
    
    // Check if GitHub is connected
    const connected = isGitHubConnected(localUserId);
    
    if (!connected) {
      return NextResponse.json({ connected: false });
    }
    
    // Get GitHub token and fetch user info
    const token = await getGitHubToken(localUserId);
    
    if (!token) {
      return NextResponse.json({ connected: false, error: 'Token not found' });
    }
    
    // Fetch GitHub user info
    const user = await getGitHubUser(token);
    
    // Fetch user's repositories
    const reposResponse = await fetch('https://api.github.com/user/repos?per_page=50', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    
    const repos = await reposResponse.json().catch(() => []);
    
    return NextResponse.json({
      connected: true,
      login: user.login,
      avatarUrl: user.avatar_url,
      htmlUrl: user.html_url,
      name: user.name,
      repos: repos.map((r: any) => ({
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        html_url: r.html_url,
        default_branch: r.default_branch,
      })),
    });
  } catch (error: any) {
    console.error('[GitHub Status] Error:', error);
    return NextResponse.json({ 
      connected: false, 
      error: error.message || 'Failed to check GitHub connection' 
    });
  }
}
