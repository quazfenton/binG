/**
 * Create GitHub Pull Request
 * 
 * API endpoint to create a pull request on GitHub.
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
    const { 
      title, 
      body: description, 
      head, 
      base, 
      owner, 
      repo,
      draft = false 
    } = body;
    
    if (!title || !head || !base) {
      return NextResponse.json({ 
        error: 'Title, head branch, and base branch are required' 
      }, { status: 400 });
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
    
    // Create pull request
    const prResponse = await githubApi<any>(
      `/repos/${targetOwner}/${targetRepo}/pulls`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          title,
          body: description || '',
          head,
          base,
          draft,
        }),
      }
    );
    
    return NextResponse.json({
      success: true,
      pr: {
        number: prResponse.number,
        title: prResponse.title,
        html_url: prResponse.html_url,
        state: prResponse.state,
        draft: prResponse.draft,
        user: {
          login: prResponse.user.login,
          avatar_url: prResponse.user.avatar_url,
        },
        head: {
          ref: prResponse.head.ref,
          sha: prResponse.head.sha,
        },
        base: {
          ref: prResponse.base.ref,
          sha: prResponse.base.sha,
        },
        created_at: prResponse.created_at,
        updated_at: prResponse.updated_at,
      },
    });
  } catch (error: any) {
    console.error('[GitHub PR] Error:', error);
    
    // Handle specific GitHub API errors
    if (error.message?.includes('422')) {
      return NextResponse.json({ 
        error: 'Pull request could not be created. The branches may already have a PR or there are no changes.',
        details: error.toString(),
      }, { status: 422 });
    }
    
    return NextResponse.json({ 
      error: error.message || 'Failed to create pull request',
    }, { status: 500 });
  }
}
