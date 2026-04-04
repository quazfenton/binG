/**
 * Push to GitHub
 *
 * Push committed changes to GitHub repository.
 * This endpoint pushes local VFS changes to the remote GitHub repository.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { getGitHubToken, githubApi, pushToGitHub } from '@/lib/github/github-oauth';
import { getLocalUserIdFromAuth0 } from '@/lib/oauth/connections';
import { virtualFilesystem } from '@/lib/virtual-filesystem/index.server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);

    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { branch, owner, repo, message = 'Push changes from binG' } = body;

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
      [targetOwner, targetRepo] = reposResponse[0].full_name.split('/');
    }

    // Validate owner/repo (branch is validated separately after getting default)
    const validateOwnerRepo = (value: string): boolean => {
      // GitHub allows: alphanumeric, hyphens, underscores, periods
      // Forward slashes are NOT allowed here to prevent path-segment injection
      if (!/^[\w.\-]+$/.test(value)) {
        return false;
      }
      return true;
    };

    if (!validateOwnerRepo(targetOwner)) {
      return NextResponse.json(
        { error: 'Invalid owner: contains disallowed characters' },
        { status: 400 }
      );
    }
    
    if (!validateOwnerRepo(targetRepo)) {
      return NextResponse.json(
        { error: 'Invalid repo: contains disallowed characters' },
        { status: 400 }
      );
    }

    // Get default branch from repo if not specified
    let targetBranch = branch;
    if (!targetBranch) {
      const repoResponse = await githubApi<any>(
        `/repos/${targetOwner}/${targetRepo}`,
        token
      );
      targetBranch = repoResponse.default_branch || 'main';
    }

    // Check if branch exists (URL encode branch for paths with slashes)
    const encodedBranch = encodeURIComponent(targetBranch);
    try {
      await githubApi(
        `/repos/${targetOwner}/${targetRepo}/branches/${encodedBranch}`,
        token
      );
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return NextResponse.json({
          error: `Branch '${targetBranch}' not found in repository`,
        }, { status: 404 });
      }
      // Rethrow non-404 errors (e.g. 401 unauthorized, 500 server error)
      throw error;
    }

    // Get local changes from VFS (all files recursively)
    const snapshot = await virtualFilesystem.exportWorkspace(localUserId.toString());

    // Collect all file contents for push
    const changes: Array<{ path: string; content: string; message: string }> = [];
    for (const file of snapshot.files) {
      // Skip VFS directory marker files (internal to VFS, not for Git repos)
      if (file.path.endsWith('/.directory') || file.path === '.directory') {
        continue;
      }
      
      changes.push({
        path: file.path.startsWith('/') ? file.path.slice(1) : file.path,
        content: file.content,
        message: `${message} - ${file.path}`,
      });
    }

    if (changes.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No changes to push',
        note: 'VFS is empty',
      });
    }

    // Push to GitHub using the existing helper
    await pushToGitHub(token, targetOwner, targetRepo, encodedBranch, changes);

    // Get updated commit info
    const refResponse = await githubApi<any>(
      `/repos/${targetOwner}/${targetRepo}/git/refs/heads/${encodedBranch}`,
      token
    );

    const latestSha = refResponse.object.sha;
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
      filesPushed: changes.length,
    });
  } catch (error: any) {
    console.error('[GitHub Push] Error:', error);
    return NextResponse.json({
      error: error.message || 'Failed to push changes',
      details: error.toString(),
    }, { status: 500 });
  }
}
