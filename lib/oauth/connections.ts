/**
 * OAuth Connections Utility
 * 
 * Shared utilities for OAuth integrations via Auth0.
 * Used by AI agent implementations, GitHub imports, and other 3rd party integrations.
 * 
 * This is NOT Nango/Composio - this is direct OAuth via Auth0 connections
 * for scenarios where you need the user's OAuth token for direct API access.
 */

import { getAccessTokenForConnection, AUTH0_CONNECTIONS } from '@/lib/auth0';

export { AUTH0_CONNECTIONS };

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
}

export interface GitHubFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
  content?: string;
  sha?: string;
}

/**
 * GitHub API base URL
 */
const GITHUB_API = 'https://api.github.com';

/**
 * Fetch with GitHub token (handles both Auth0 token and direct token)
 */
async function fetchGitHub<T>(endpoint: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${GITHUB_API}${endpoint}`, { headers });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `GitHub API error: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Get user's GitHub repos via Auth0 connection token
 */
export async function getGitHubRepos(connectionToken?: string | null): Promise<GitHubRepo[]> {
  const token = connectionToken || await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB);
  
  if (!token) {
    throw new Error('GitHub not connected. Please sign in with GitHub.');
  }
  
  return fetchGitHub<GitHubRepo[]>('/user/repos?sort=updated&per_page=30', token);
}

/**
 * Get contents of a GitHub repo directory
 */
export async function getGitHubRepoContents(
  owner: string,
  repo: string,
  path: string = '',
  connectionToken?: string | null
): Promise<GitHubFile[]> {
  const token = connectionToken || await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB);
  
  if (!token) {
    throw new Error('GitHub not connected');
  }
  
  const encodedPath = path ? `/${encodeURIComponent(path)}` : '';
  return fetchGitHub<GitHubFile[]>(`/repos/${owner}/${repo}/contents${encodedPath}`, token);
}

/**
 * Get file content from GitHub
 */
export async function getGitHubFileContent(
  downloadUrl: string,
  connectionToken?: string | null
): Promise<string> {
  const token = connectionToken || await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB);
  
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3.raw',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(downloadUrl, { headers });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  
  return response.text();
}

/**
 * Recursively fetch all files from a GitHub repo
 */
export async function fetchGitHubRepoFiles(
  owner: string,
  repo: string,
  path: string = '',
  connectionToken?: string | null,
  maxFiles: number = 100,
  existingFiles: Map<string, string> = new Map()
): Promise<Map<string, string>> {
  if (existingFiles.size >= maxFiles) return existingFiles;
  
  const token = connectionToken || await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB);
  const contents = await getGitHubRepoContents(owner, repo, path, token);
  
  for (const item of contents) {
    if (existingFiles.size >= maxFiles) break;
    
    if (item.type === 'file' && item.download_url) {
      const content = await getGitHubFileContent(item.download_url, token);
      existingFiles.set(item.path, content);
    } else if (item.type === 'dir') {
      await fetchGitHubRepoFiles(owner, repo, item.path, token, maxFiles - existingFiles.size, existingFiles);
    }
  }
  
  return existingFiles;
}

/**
 * Check if GitHub connection is available
 */
export async function isGitHubConnected(): Promise<boolean> {
  try {
    const token = await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB);
    return token !== null;
  } catch {
    return false;
  }
}

/**
 * Parse GitHub URL to extract owner and repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string; branch?: string } | null {
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
