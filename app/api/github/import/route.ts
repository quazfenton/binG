/**
 * GitHub Import API
 * 
 * Import files from GitHub repositories.
 * Uses Auth0 access token if available (OAuth connection).
 * Falls back to unauthenticated access for public repos.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

interface GitHubFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
  content?: string;
}

async function getGitHubToken(): Promise<string | null> {
  try {
    const session = await auth0.getSession();
    if (session) {
      const token = await auth0.getAccessToken();
      if (token.token) {
        return token.token;
      }
    }
  } catch {
    // Not authenticated via Auth0
  }
  return null;
}

async function fetchGitHubApi(url: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, { headers });
}

async function fetchRepoContents(
  owner: string,
  repo: string,
  path: string = '',
  token?: string
): Promise<GitHubFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const response = await fetchGitHubApi(url, token);
  
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }
  
  return response.json();
}

async function fetchFileContent(url: string, token?: string): Promise<string> {
  const response = await fetchGitHubApi(url, token);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  
  return response.text();
}

async function recursivelyFetchDirectory(
  owner: string,
  repo: string,
  path: string,
  token?: string,
  maxFiles: number = 100
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  
  if (files.size >= maxFiles) return files;
  
  const contents = await fetchRepoContents(owner, repo, path, token);
  
  for (const item of contents) {
    if (files.size >= maxFiles) break;
    
    if (item.type === 'file') {
      const content = await fetchFileContent(item.download_url!, token);
      files.set(item.path, content);
    } else if (item.type === 'dir') {
      const subFiles = await recursivelyFetchDirectory(owner, repo, item.path, token, maxFiles - files.size);
      subFiles.forEach((content, filePath) => files.set(filePath, content));
    }
  }
  
  return files;
}

function parseGitHubUrl(url: string): { owner: string; repo: string; branch?: string } | null {
  // Handle formats:
  // https://github.com/owner/repo
  // https://github.com/owner/repo/tree/branch
  // https://github.com/owner/repo/blob/branch/path
  // owner/repo
  // owner/repo/tree/branch
  // owner/repo/blob/branch/path
  
  const patterns = [
    /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\/(?:tree|blob)\/([^\/]+))?(?:\/.*)?$/,
    /^([^\/]+)\/([^\/]+?)(?:\/(?:tree|blob)\/([^\/]+))?(?:\/.*)?$/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''),
        branch: match[3],
      };
    }
  }
  
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, maxFiles = 50 } = body;
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }
    
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      return NextResponse.json({ 
        error: 'Invalid GitHub URL. Use formats like: github.com/owner/repo or owner/repo' 
      }, { status: 400 });
    }
    
    const token = await getGitHubToken();
    
    // Fetch repository info first
    const repoUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
    const repoResponse = await fetchGitHubApi(repoUrl, token);
    
    if (!repoResponse.ok) {
      if (repoResponse.status === 404) {
        return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
      }
      return NextResponse.json({ 
        error: `GitHub API error: ${repoResponse.status}` 
      }, { status: repoResponse.status });
    }
    
    const repoInfo = await repoResponse.json();
    const defaultBranch = repoInfo.default_branch;
    const branch = parsed.branch || defaultBranch;
    
    // Recursively fetch all files
    const files = await recursivelyFetchDirectory(
      parsed.owner, 
      parsed.repo, 
      '', 
      token,
      maxFiles
    );
    
    return NextResponse.json({
      success: true,
      repo: {
        owner: parsed.owner,
        name: parsed.repo,
        branch,
        defaultBranch,
        fullName: `${parsed.owner}/${parsed.repo}`,
        description: repoInfo.description,
        stars: repoInfo.stargazers_count,
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
