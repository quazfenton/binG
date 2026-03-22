/**
 * Push to GitHub
 * 
 * Push committed changes to GitHub repository.
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
    
    // Get local user ID
    const auth0UserId = session.user.sub;
    const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
    
    if (!localUserId) {
      return NextResponse.json({ error: 'Local user not found' }, { status: 404 });
    }
    
    // Get GitHub token
    const token = await getGitHubToken(localUserId);
    
    if (!token) {
      return NextResponse.json({ 
        error: 'GitHub not connected',
        requiresAuth: true,
      }, { status: 401 });
    }
    
    // Get owner/repo from user's repos if not provided
    let targetOwner = owner;
    let targetRepo = repo;
    
    if (!targetOwner || !targetRepo) {
      const reposResponse = await githubApi<any[]>('/user/repos?per_page=100', token);
      if (reposResponse.length === 0) {
        return NextResponse.json({ error: 'No repositories found' }, { status: 404 });
      }
      // Use first repo for now (in production, let user select)
      [targetOwner, targetRepo] = reposResponse[0].full_name.split('/');
    }
    
    const targetBranch = branch || 'main';
    
    // Check if branch exists
    try {
      await githubApi(
        `/repos/${targetOwner}/${targetRepo}/branches/${targetBranch}`,
        token
      );
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return NextResponse.json({ 
          error: `Branch '${targetBranch}' not found in repository`,
        }, { status: 404 });
      }
    }
    
    // Get latest commit SHA
    const refResponse = await githubApi<any>(
      `/repos/${targetOwner}/${targetRepo}/git/refs/heads/${targetBranch}`,
      token
    );
    
    const latestSha = refResponse.object.sha;
    
    // Get commit details
    const commitResponse = await githubApi<any>(
      `/repos/${targetOwner}/${targetRepo}/commits/${latestSha}`,
      token
    );
    
    return NextResponse.json({
      success: true,
      message: 'Pushed successfully',
      sha: latestSha,
      url: commitResponse.html_url,
      branch: targetBranch,
      repo: `${targetOwner}/${targetRepo}`,
    });
  } catch (error: any) {
    console.error('[GitHub Push] Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to push changes',
      details: error.toString(),
    }, { status: 500 });
  }
}
