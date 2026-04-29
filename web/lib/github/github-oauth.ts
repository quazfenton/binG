/**
 * GitHub OAuth Integration
 *
 * Handles GitHub OAuth authentication for Git operations.
 * Similar to Google OAuth but for GitHub API access.
 */

import { getDatabase, encryptApiKey, decryptApiKey } from '@/lib/database/connection';
import { randomBytes } from 'crypto';

export const GITHUB_CONNECTION = 'github';

export interface GitHubToken {
  accessToken: string;
  tokenType: string;
  scope: string[];
  expiresAt?: Date;
  refreshToken?: string;
}

export interface GitHubUser {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  site_admin: boolean;
  name?: string;
  company?: string;
  blog?: string;
  location?: string;
  email?: string;
  hireable?: boolean;
  bio?: string;
  twitter_username?: string;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
}

export interface GitHubRepo {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  owner: GitHubUser;
  html_url: string;
  description: string | null;
  fork: boolean;
  url: string;
  forks_url: string;
  keys_url: string;
  collaborators_url: string;
  teams_url: string;
  hooks_url: string;
  issue_events_url: string;
  events_url: string;
  assignees_url: string;
  branches_url: string;
  tags_url: string;
  blobs_url: string;
  git_tags_url: string;
  git_refs_url: string;
  trees_url: string;
  statuses_url: string;
  languages_url: string;
  stargazers_url: string;
  contributors_url: string;
  subscribers_url: string;
  subscription_url: string;
  commits_url: string;
  git_commits_url: string;
  comments_url: string;
  issue_comment_url: string;
  contents_url: string;
  compare_url: string;
  merges_url: string;
  archive_url: string;
  downloads_url: string;
  issues_url: string;
  pulls_url: string;
  milestones_url: string;
  notifications_url: string;
  labels_url: string;
  releases_url: string;
  deployments_url: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  git_url: string;
  ssh_url: string;
  clone_url: string;
  svn_url: string;
  homepage: string | null;
  size: number;
  stargazers_count: number;
  watchers_count: number;
  language: string | null;
  has_issues: boolean;
  has_projects: boolean;
  has_downloads: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  has_discussions: boolean;
  forks_count: number;
  mirror_url: string | null;
  archived: boolean;
  disabled: boolean;
  open_issues_count: number;
  license: any;
  allow_forking: boolean;
  is_template: boolean;
  web_commit_signoff_required: boolean;
  topics: string[];
  visibility: string;
  forks: number;
  open_issues: number;
  watchers: number;
  default_branch: string;
  temp_clone_token?: string;
  organization?: any;
  network_count?: number;
  subscribers_count?: number;
}

export interface GitHubCommit {
  sha: string;
  node_id: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
    tree: {
      sha: string;
      url: string;
    };
    url: string;
    comment_count: number;
    verification: {
      verified: boolean;
      reason: string;
      signature: string | null;
      payload: string | null;
    };
  };
  url: string;
  html_url: string;
  comments_url: string;
  author?: GitHubUser;
  committer?: GitHubUser;
  parents: Array<{
    sha: string;
    url: string;
    html_url: string;
  }>;
  stats?: {
    total: number;
    additions: number;
    deletions: number;
  };
  files?: Array<{
    sha: string;
    filename: string;
    status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
    additions: number;
    deletions: number;
    changes: number;
    blob_url: string;
    raw_url: string;
    contents_url: string;
    patch?: string;
  }>;
}

export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

/**
 * Get GitHub OAuth URL for authentication
 * Returns both the URL and the generated state for CSRF protection
 */
export function getGitHubOAuthUrl(scopes: string[] = ['repo', 'user', 'workflow']): { url: string; state: string } {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = process.env.GITHUB_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/integrations/github/oauth/callback`;

  if (!clientId) {
    throw new Error('GITHUB_CLIENT_ID not configured');
  }

  const state = generateState();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
  });

  return {
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
    state,
  };
}

/**
 * Generate cryptographically secure state parameter for OAuth security
 * Uses crypto.randomBytes() instead of Math.random() to prevent CSRF attacks
 */
function generateState(): string {
  // Generate 32 bytes (256 bits) of random data and convert to hex
  return randomBytes(32).toString('hex');
}

/**
 * Exchange OAuth code for access token
 */
export async function exchangeCodeForToken(code: string, state: string): Promise<GitHubToken> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/github/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('GitHub OAuth credentials not configured');
  }

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      state,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to exchange code for token');
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    scope: data.scope ? data.scope.split(' ') : [],
    refreshToken: data.refresh_token,
  };
}

/**
 * Get GitHub user info
 */
export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get GitHub user info');
  }

  return response.json();
}

/**
 * Save GitHub token to database
 */
export async function saveGitHubToken(userId: string, token: GitHubToken, user: GitHubUser): Promise<boolean> {
  try {
    const db = getDatabase();

    const { encrypted: accessTokenEncrypted } = await encryptApiKey(token.accessToken);
    const { encrypted: refreshTokenEncrypted } = token.refreshToken
      ? await encryptApiKey(token.refreshToken)
      : { encrypted: null };

    const stmt = db.prepare(`
      INSERT INTO external_connections
      (user_id, provider, provider_account_id, provider_display_name,
       access_token_encrypted, refresh_token_encrypted, token_expires_at,
       scopes, metadata, updated_at, is_active, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, TRUE, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, provider, provider_account_id)
      DO UPDATE SET
        provider_display_name = excluded.provider_display_name,
        access_token_encrypted = COALESCE(excluded.access_token_encrypted, external_connections.access_token_encrypted),
        refresh_token_encrypted = COALESCE(excluded.refresh_token_encrypted, external_connections.refresh_token_encrypted),
        token_expires_at = COALESCE(excluded.token_expires_at, external_connections.token_expires_at),
        scopes = COALESCE(excluded.scopes, external_connections.scopes),
        metadata = COALESCE(excluded.metadata, external_connections.metadata),
        updated_at = CURRENT_TIMESTAMP,
        last_accessed_at = CURRENT_TIMESTAMP,
        is_active = TRUE
    `);

    const metadata = JSON.stringify({
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
      html_url: user.html_url,
    });

    stmt.run(
      userId,
      'github',
      user.id.toString(),
      user.login,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      token.expiresAt?.toISOString() || null,
      token.scope.join(','),
      metadata
    );

    console.log(`[GitHub] Saved token for user: ${user.login}`);
    return true;
  } catch (error) {
    console.error('[GitHub] Failed to save token:', error);
    return false;
  }
}

/**
 * Get GitHub token from database
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT access_token_encrypted 
      FROM external_connections 
      WHERE user_id = ? AND provider = 'github' AND is_active = TRUE
      LIMIT 1
    `);

    const result = stmt.get(userId) as { access_token_encrypted: string } | undefined;

    if (result?.access_token_encrypted) {
      return decryptApiKey(result.access_token_encrypted);
    }

    return null;
  } catch (error) {
    console.error('[GitHub] Failed to get token:', error);
    return null;
  }
}

/**
 * Check if GitHub is connected
 */
export function isGitHubConnected(userId: string): boolean {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT 1 FROM external_connections
      WHERE user_id = ? AND provider = 'github' AND is_active = TRUE
      LIMIT 1
    `);
    return !!stmt.get(userId);
  } catch {
    return false;
  }
}

/**
 * Disconnect GitHub
 */
export function disconnectGitHub(userId: string): boolean {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE external_connections
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND provider = 'github'
    `);
    const result = stmt.run(userId, 'github');
    return result.changes > 0;
  } catch (error) {
    console.error('[GitHub] Failed to disconnect:', error);
    return false;
  }
}

/**
 * GitHub API helper
 */
export async function githubApi<T>(endpoint: string, token: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `GitHub API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get user's repositories
 */
export async function getGitHubRepos(token: string): Promise<GitHubRepo[]> {
  return githubApi<GitHubRepo[]>('/user/repos?per_page=100', token);
}

/**
 * Get repository branches
 */
export async function getGitHubBranches(token: string, owner: string, repo: string): Promise<GitHubBranch[]> {
  return githubApi<GitHubBranch[]>(`/repos/${owner}/${repo}/branches`, token);
}

/**
 * Get repository commits
 */
export async function getGitHubCommits(token: string, owner: string, repo: string, branch?: string): Promise<GitHubCommit[]> {
  const params = branch ? `?sha=${branch}` : '';
  return githubApi<GitHubCommit[]>(`/repos/${owner}/${repo}/commits${params}`, token);
}

/**
 * Get commit details with files
 */
export async function getGitHubCommitDetails(token: string, owner: string, repo: string, sha: string): Promise<GitHubCommit> {
  return githubApi<GitHubCommit>(`/repos/${owner}/${repo}/commits/${sha}`, token);
}

/**
 * Create or update a file
 */
export async function updateGitHubFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<any> {
  const body: any = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch,
  };
  
  if (sha) {
    body.sha = sha;
  }

  return githubApi(`/repos/${owner}/${repo}/contents/${path}`, token, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * Get file content and SHA
 */
export async function getGitHubFile(token: string, owner: string, repo: string, path: string, branch?: string): Promise<{ content: string; sha: string }> {
  const params = branch ? `?ref=${branch}` : '';
  const data = await githubApi<any>(`/repos/${owner}/${repo}/contents/${path}${params}`, token);
  
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha,
  };
}

/**
 * Push commits to repository
 */
export async function pushToGitHub(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  changes: Array<{ path: string; content: string; message: string }>
): Promise<void> {
  // Get current commit SHA
  const refs = await githubApi<any>(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token);
  const sha = refs.object.sha;

  // Get current tree
  const commit = await githubApi<any>(`/repos/${owner}/${repo}/git/commits/${sha}`, token);
  const treeSha = commit.tree.sha;

  // Create blobs for each file
  const blobs = await Promise.all(
    changes.map(async (change) => {
      const blob = await githubApi<any>(`/repos/${owner}/${repo}/git/blobs`, token, {
        method: 'POST',
        body: JSON.stringify({
          content: change.content,
          encoding: 'utf-8',
        }),
      });
      return { path: change.path, sha: blob.sha };
    })
  );

  // Create new tree
  const baseTree = await githubApi<any>(`/repos/${owner}/${repo}/git/trees/${treeSha}`, token);
  const newTree = await githubApi<any>(`/repos/${owner}/${repo}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: treeSha,
      tree: blobs.map((blob) => ({
        path: blob.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      })),
    }),
  });

  // Create new commit
  const newCommit = await githubApi<any>(`/repos/${owner}/${repo}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      tree: newTree.sha,
      message: changes.map((c) => c.message).join('\n\n'),
      parents: [sha],
    }),
  });

  // Update ref
  await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: newCommit.sha,
      force: false,
    }),
  });
}
