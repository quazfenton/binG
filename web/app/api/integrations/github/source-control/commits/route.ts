/**
 * Get GitHub Commits
 * 
 * Fetch commit history for a repository.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

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
    const branch = url.searchParams.get('branch');
    
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
    
    // Fetch commits
    const params = new URLSearchParams();
    if (branch) params.set('sha', branch);
    params.set('per_page', '30');
    
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      // Return upstream error details instead of generic error
      const errorData = await response.json().catch(() => ({}));
      console.error('[GitHub Commits] Upstream error:', response.status, errorData);
      
      return NextResponse.json({
        error: errorData.message || `GitHub API error: ${response.status}`,
        status: response.status,
      }, { status: response.status });
    }

    const commits = await response.json();
    
    // Format commits for UI
    const formattedCommits = commits.map((commit: any) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      email: commit.commit.author.email,
      date: commit.commit.author.date,
      url: commit.html_url,
      additions: commit.stats?.additions || 0,
      deletions: commit.stats?.deletions || 0,
      changes: commit.stats?.total || 0,
      files: commit.files?.map((f: any) => ({
        path: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    }));
    
    return NextResponse.json({ commits: formattedCommits });
  } catch (error: any) {
    console.error('[GitHub Commits] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch commits' }, { status: 500 });
  }
}
