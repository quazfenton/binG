/**
 * Pull from GitHub
 * 
 * Pull latest changes from GitHub repository.
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
    
    const targetBranch = branch || 'main';
    
    // Get latest commit from GitHub
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
    
    // Get tree contents
    const treeResponse = await githubApi<any>(
      `/repos/${targetOwner}/${targetRepo}/git/trees/${commitResponse.tree.sha}?recursive=1`,
      token
    );
    
    // Fetch all files from the tree
    const files: Record<string, { content: string; sha: string }> = {};
    
    const blobFiles = treeResponse.tree.filter((item: any) => item.type === 'blob');
    
    for (const file of blobFiles.slice(0, 50)) { // Limit to 50 files for performance
      try {
        const fileResponse = await githubApi<any>(
          `/repos/${targetOwner}/${targetRepo}/contents/${file.path}`,
          token,
          {
            params: { ref: targetBranch },
          }
        );
        
        if (fileResponse.content) {
          files[file.path] = {
            content: Buffer.from(fileResponse.content, 'base64').toString('utf-8'),
            sha: fileResponse.sha,
          };
        }
      } catch (error) {
        console.warn(`Failed to fetch ${file.path}:`, error);
      }
    }
    
    return NextResponse.json({
      success: true,
      message: 'Pulled successfully',
      sha: latestSha,
      branch: targetBranch,
      repo: `${targetOwner}/${targetRepo}`,
      filesCount: Object.keys(files).length,
      // Note: Files would be written to VFS by the client
    });
  } catch (error: any) {
    console.error('[GitHub Pull] Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to pull changes',
    }, { status: 500 });
  }
}
