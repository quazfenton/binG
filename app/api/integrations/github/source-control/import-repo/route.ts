/**
 * Import Repository
 * 
 * Import files from a GitHub repository to the workspace.
 * This is a wrapper around the existing /api/integrations/github import action.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { getGitHubToken } from '@/lib/github/github-oauth';
import { getLocalUserIdFromAuth0 } from '@/lib/oauth/connections';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const body = await request.json();
    const { owner, repo, branch } = body;
    
    if (!owner || !repo) {
      return NextResponse.json({ error: 'Owner and repo are required' }, { status: 400 });
    }
    
    // Get local user ID
    const auth0UserId = session.user.sub;
    const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
    
    if (!localUserId) {
      return NextResponse.json({ error: 'Local user not found' }, { status: 404 });
    }
    
    // Get GitHub token (optional for public repos)
    let token: string | null = null;
    try {
      token = await getGitHubToken(localUserId);
    } catch {
      // Token not required for public repos
    }
    
    // Fetch repository info
    const repoResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      token ? {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      } : undefined
    );
    
    if (!repoResponse.ok) {
      if (repoResponse.status === 404) {
        return NextResponse.json({ 
          error: 'Repository not found. It may be private and requires GitHub authentication.' 
        }, { status: 404 });
      }
      throw new Error('Failed to fetch repository info');
    }
    
    const repoInfo = await repoResponse.json();
    
    // Get files from repository
    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch || repoInfo.default_branch}?recursive=1`,
      token ? {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      } : undefined
    );
    
    if (!treeResponse.ok) {
      throw new Error('Failed to fetch repository tree');
    }
    
    const tree = await treeResponse.json();
    
    // Filter to files only (not directories)
    const files = tree.tree.filter((item: any) => item.type === 'blob');
    
    // Fetch file contents (limit to first 100 files for performance)
    const fileContents: Record<string, string> = {};
    const errors: string[] = [];
    
    for (const file of files.slice(0, 100)) {
      try {
        const contentResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branch || repoInfo.default_branch}`,
          token ? {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github.v3+json',
            },
          } : undefined
        );
        
        if (contentResponse.ok) {
          const contentData = await contentResponse.json();
          if (contentData.content && contentData.encoding === 'base64') {
            fileContents[file.path] = Buffer.from(contentData.content, 'base64').toString('utf-8');
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch ${file.path}:`, error);
        errors.push(file.path);
      }
    }
    
    return NextResponse.json({
      success: true,
      repo: {
        name: repoInfo.name,
        full_name: repoInfo.full_name,
        description: repoInfo.description,
        html_url: repoInfo.html_url,
        default_branch: repoInfo.default_branch,
        stargazers_count: repoInfo.stargazers_count,
        forks_count: repoInfo.forks_count,
        language: repoInfo.language,
      },
      files: fileContents,
      filesCount: Object.keys(fileContents).length,
      totalFiles: files.length,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length > 0 
        ? `Imported ${Object.keys(fileContents).length} files (${errors.length} failed)`
        : `Imported ${Object.keys(fileContents).length} files`,
    });
  } catch (error: any) {
    console.error('[GitHub Import] Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to import repository',
      details: error.toString(),
    }, { status: 500 });
  }
}
