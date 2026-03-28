/**
 * Create GitHub Commit
 * 
 * Commit staged changes to GitHub repository.
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
    const { message, description, changes, branch, owner, repo } = body;
    
    if (!message) {
      return NextResponse.json({ error: 'Commit message required' }, { status: 400 });
    }
    
    if (!changes || !Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json({ error: 'No changes to commit' }, { status: 400 });
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
      const reposResponse = await githubApi<any[]>('/user/repos?per_page=10', token);
      if (reposResponse.length === 0) {
        return NextResponse.json({ error: 'No repositories found' }, { status: 404 });
      }
      [targetOwner, targetRepo] = reposResponse[0].full_name.split('/');
    }
    
    const targetBranch = branch || 'main';
    
    // Get current branch ref
    const refResponse = await githubApi<any>(
      `/repos/${targetOwner}/${targetRepo}/git/refs/heads/${targetBranch}`,
      token
    );
    
    const commitSha = refResponse.object.sha;
    
    // Get current commit
    const commitResponse = await githubApi<any>(
      `/repos/${targetOwner}/${targetRepo}/git/commits/${commitSha}`,
      token
    );
    
    const treeSha = commitResponse.tree.sha;
    
    // Create blobs for each file
    const blobs = await Promise.all(
      changes.map(async (change: any) => {
        // Skip deleted files - they need tree manipulation, not blob creation
        if (change.status === 'deleted') {
          return { path: change.path, sha: null, status: 'deleted' };
        }

        // Skip files without content
        if (!change.content) {
          console.warn(`[GitHub Commit] File ${change.path} has no content, skipping`);
          return null;
        }

        const blobResponse = await githubApi<any>(
          `/repos/${targetOwner}/${targetRepo}/git/blobs`,
          token,
          {
            method: 'POST',
            body: JSON.stringify({
              content: change.content,
              encoding: 'utf-8',
            }),
          }
        );
        return { path: change.path, sha: blobResponse.sha, status: change.status };
      })
    );

    // Filter out skipped entries (files without content)
    const validBlobs = blobs.filter((blob): blob is NonNullable<typeof blob> => blob !== null);

    // Validate all blobs have SHA before creating tree
    const missingShaBlobs = validBlobs.filter(blob => blob.status !== 'deleted' && !blob.sha);
    if (missingShaBlobs.length > 0) {
      return NextResponse.json(
        { 
          error: 'Invalid file data',
          details: `Missing file content for: ${missingShaBlobs.map(b => b.path).join(', ')}`
        }, 
        { status: 400 }
      );
    }

    // Create new tree with proper handling for deleted files
    // GitHub API supports file deletion by including tree entries with sha: null
    const tree = validBlobs.flatMap((blob: any) => {
      if (blob.status === 'deleted') {
        // Deleted files: include with sha: null to remove from repo
        return [{
          path: blob.path,
          mode: '100644',
          type: 'blob',
          sha: null,
        }];
      }
      // Modified/added files: include with actual sha
      return [{
        path: blob.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      }];
    });

    // Create new tree with all entries (including deletions)
    const newTreeResponse = await githubApi<any>(
      `/repos/${targetOwner}/${targetRepo}/git/trees`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          base_tree: treeSha,
          tree: tree,
        }),
      }
    );
    
    // Create new commit
    const fullMessage = description ? `${message}\n\n${description}` : message;
    
    const newCommitResponse = await githubApi<any>(
      `/repos/${targetOwner}/${targetRepo}/git/commits`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          tree: newTreeResponse.sha,
          message: fullMessage,
          parents: [commitSha],
        }),
      }
    );
    
    // Update ref
    await githubApi(
      `/repos/${targetOwner}/${targetRepo}/git/refs/heads/${targetBranch}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify({
          sha: newCommitResponse.sha,
          force: false,
        }),
      }
    );
    
    return NextResponse.json({
      success: true,
      sha: newCommitResponse.sha,
      url: newCommitResponse.html_url,
      message: fullMessage,
    });
  } catch (error: any) {
    console.error('[GitHub Commit] Error:', error);
    return NextResponse.json({
      error: 'Failed to create commit',
    }, { status: 500 });
  }
}
