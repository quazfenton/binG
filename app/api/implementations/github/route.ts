/**
 * GitHub Import API
 * 
 * Import files from GitHub repositories.
 * Uses Auth0 connection token (via getAccessTokenForConnection) for authenticated access.
 * Falls back to unauthenticated access for public repos.
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  getGitHubRepos, 
  fetchGitHubRepoFiles, 
  parseGitHubUrl,
  type GitHubRepo 
} from '@/lib/oauth/connections';

/**
 * GET /api/implementations/github - List user's GitHub repos (requires Auth0 GitHub connection)
 */
export async function GET(request: NextRequest) {
  try {
    const repos = await getGitHubRepos();
    
    return NextResponse.json({
      success: true,
      repos: repos.map((repo: GitHubRepo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        private: repo.private,
        url: repo.html_url,
        defaultBranch: repo.default_branch,
        stars: repo.stargazers_count,
        language: repo.language,
      })),
    });
  } catch (error) {
    console.error('[GitHub Import] Error listing repos:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to list GitHub repos' 
    }, { status: 500 });
  }
}

/**
 * POST /api/implementations/github - Import files from GitHub
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, repo, branch, maxFiles = 50 } = body;
    
    // If owner/repo provided, fetch files directly
    if (owner && repo) {
      const files = await fetchGitHubRepoFiles(owner, repo, '', null, maxFiles);
      
      return NextResponse.json({
        success: true,
        repo: {
          owner,
          name: repo,
          branch: branch || 'main',
          fullName: `${owner}/${repo}`,
        },
        files: Object.fromEntries(files),
        fileCount: files.size,
      });
    }
    
    // If URL provided, parse and fetch
    const { url } = body;
    if (!url) {
      return NextResponse.json({ error: 'URL or owner/repo is required' }, { status: 400 });
    }
    
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      return NextResponse.json({ 
        error: 'Invalid GitHub URL. Use formats like: github.com/owner/repo or owner/repo' 
      }, { status: 400 });
    }
    
    const files = await fetchGitHubRepoFiles(
      parsed.owner, 
      parsed.repo, 
      '', 
      null,
      maxFiles
    );
    
    return NextResponse.json({
      success: true,
      repo: {
        owner: parsed.owner,
        name: parsed.repo,
        branch: parsed.branch,
        fullName: `${parsed.owner}/${parsed.repo}`,
      },
      files: Object.fromEntries(files),
      fileCount: files.size,
    });
    
  } catch (error) {
    console.error('[GitHub Import] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to import from GitHub' 
    }, { status: 500 });
  }
}
