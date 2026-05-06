/**
 * Switch GitHub Branch
 * 
 * Switch to a different branch.
 */

import { NextRequest, NextResponse } from 'next/server';


import { auth0 } from '@/lib/auth0';
import { getGitHubToken, githubApi } from '@/lib/github/github-oauth';
import { getLocalUserIdFromAuth0 } from '@/lib/oauth/connections';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const body = await request.json();
    const { branch, owner, repo } = body;
    
    if (!branch) {
      return NextResponse.json({ error: 'Branch name required' }, { status: 400 });
    }
    
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
    
    // Get owner/repo from user's repos if not provided
    let targetOwner = owner;
    let targetRepo = repo;
    
    if (!targetOwner || !targetRepo) {
      const reposResponse = await githubApi<any[]>('/user/repos?per_page=100', token);
      if (reposResponse.length === 0) {
        return NextResponse.json({ error: 'No repositories found' }, { status: 404 });
      }
      [targetOwner, targetRepo] = reposResponse[0].full_name.split('/');
    }
    
    // Check if branch exists
    let branchResponse;
    try {
      branchResponse = await githubApi<any>(
        `/repos/${targetOwner}/${targetRepo}/branches/${branch}`,
        token
      );
    } catch (apiError: any) {
      if (apiError.message?.includes('404')) {
        return NextResponse.json({ error: `Branch '${branch}' not found` }, { status: 404 });
      }
      throw apiError; // Re-throw other errors
    }

    return NextResponse.json({
      success: true,
      branch: {
        name: branchResponse.name,
        sha: branchResponse.commit.sha,
        protected: branchResponse.protected,
      },
      repo: `${targetOwner}/${targetRepo}`,
    });
  } catch (error: any) {
    console.error('[GitHub Branch] Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to switch branch',
    }, { status: 500 });
  }
}
