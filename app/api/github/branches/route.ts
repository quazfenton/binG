/**
 * Get GitHub Branches
 * 
 * Fetch branches for a repository.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { getGitHubToken } from '@/lib/github/github-oauth';
import { getLocalUserIdFromAuth0 } from '@/lib/oauth/connections';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const url = new URL(request.url);
    const owner = url.searchParams.get('owner');
    const repo = url.searchParams.get('repo');
    
    // Get local user ID
    const auth0UserId = session.user.sub;
    const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
    
    if (!localUserId) {
      return NextResponse.json({ error: 'Local user not found' }, { status: 404 });
    }
    
    // Get GitHub token
    const token = await getGitHubToken(localUserId);
    
    if (!token) {
      return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 });
    }
    
    if (!owner || !repo) {
      return NextResponse.json({ error: 'Owner and repo required' }, { status: 400 });
    }
    
    // Fetch branches
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch branches');
    }
    
    const branches = await response.json();
    
    // Get current branch from VFS or default to main/master
    const currentBranch = branches.find((b: any) => b.name === 'main') || 
                          branches.find((b: any) => b.name === 'master') || 
                          branches[0];
    
    // Format branches for UI
    const formattedBranches = branches.map((branch: any) => ({
      name: branch.name,
      sha: branch.commit.sha,
      current: branch.name === currentBranch?.name,
      protected: branch.protected,
    }));
    
    return NextResponse.json({ 
      branches: formattedBranches,
      current: currentBranch?.name,
    });
  } catch (error: any) {
    console.error('[GitHub Branches] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch branches' }, { status: 500 });
  }
}
