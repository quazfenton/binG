/**
 * OAuth Connections Utility
 * 
 * Shared utilities for OAuth integrations via Auth0.
 * Used by AI agent implementations, GitHub imports, and other 3rd party integrations.
 * 
 * This is NOT Nango/Composio - this is direct OAuth via Auth0 connections
 * for scenarios where you need the user's OAuth token for direct API access.
 * 
 * Note: For tool authorization, use tool-authorization-manager which handles
 * consolidation across Nango/Arcade/Composio and Auth0.
 */

import { AUTH0_CONNECTIONS } from '@/lib/auth0';
import { oauthService } from '../auth/oauth-service';
import { getDatabase, encryptApiKey, decryptApiKey } from '../database/connection';

// Lazy-loaded functions to avoid circular dependency
async function getAccessTokenForConnection(connection: string, userId?: string) {
  const { getAccessTokenForConnection: fn } = await import('@/lib/auth0');
  return fn(connection, userId);
}

function isProviderConnected(userId: string, provider: string): boolean {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT 1 FROM external_connections 
      WHERE user_id = ? AND provider = ? AND is_active = TRUE
      LIMIT 1
    `);
    return !!stmt.get(userId, provider);
  } catch {
    return false;
  }
}

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
 * @param userId - Optional user ID for database token retrieval
 */
export async function getGitHubRepos(connectionToken?: string | null, userId?: string): Promise<GitHubRepo[]> {
  const token = connectionToken || await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB, userId);
  
  if (!token) {
    throw new Error('GitHub not connected. Please sign in with GitHub.');
  }
  
  return fetchGitHub<GitHubRepo[]>('/user/repos?sort=updated&per_page=30', token);
}

/**
 * Get contents of a GitHub repo directory
 * @param userId - Optional user ID for database token retrieval
 */
export async function getGitHubRepoContents(
  owner: string,
  repo: string,
  path: string = '',
  connectionToken?: string | null,
  userId?: string
): Promise<GitHubFile[]> {
  const token = connectionToken || await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB, userId);
  
  if (!token) {
    throw new Error('GitHub not connected');
  }
  
  const encodedPath = path ? `/${encodeURIComponent(path)}` : '';
  return fetchGitHub<GitHubFile[]>(`/repos/${owner}/${repo}/contents${encodedPath}`, token);
}

/**
 * Get file content from GitHub
 * @param userId - Optional user ID for database token retrieval
 */
export async function getGitHubFileContent(
  downloadUrl: string,
  connectionToken?: string | null,
  userId?: string
): Promise<string> {
  const token = connectionToken || await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB, userId);
  
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
 * @param userId - Optional user ID for database token retrieval
 */
export async function fetchGitHubRepoFiles(
  owner: string,
  repo: string,
  path: string = '',
  connectionToken?: string | null,
  maxFiles: number = 100,
  existingFiles: Map<string, string> = new Map<string, string>(),
  userId?: string
): Promise<Map<string, string>> {
  if (existingFiles.size >= maxFiles) return existingFiles;

  const token = connectionToken || await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB, userId);
  const contents = await getGitHubRepoContents(owner, repo, path, token);

  for (const item of contents) {
    if (existingFiles.size >= maxFiles) break;

    if (item.type === 'file' && item.download_url) {
      const content = await getGitHubFileContent(item.download_url, token);
      existingFiles.set(item.path, content);
    } else if (item.type === 'dir') {
      // CRITICAL FIX: Pass original maxFiles (not maxFiles - existingFiles.size)
      // The recursive call checks existingFiles.size against maxFiles at the start,
      // so passing a reduced value causes premature termination in nested directories
      await fetchGitHubRepoFiles(owner, repo, item.path, token, maxFiles, existingFiles, userId);
    }
  }

  return existingFiles;
}

/**
 * Check if GitHub connection is available (consolidated check)
 * @param userId - Optional user ID to check database
 */
export async function isGitHubConnected(userId?: string): Promise<boolean> {
  try {
    // Check cache/database first
    if (userId) {
      const hasDbConnection = isProviderConnected(userId, 'github');
      if (hasDbConnection) return true;
    }
    
    // Check Auth0 connected accounts
    const token = await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB, userId);
    if (token) return true;
    
    // Check Nango/Arcade/Composio connections (for tools)
    if (userId) {
      const db = getDatabase();
      const stmt = db.prepare(`
        SELECT 1 FROM external_connections 
        WHERE user_id = ? AND provider = 'github' AND is_active = TRUE LIMIT 1
      `);
      if (stmt.get(userId)) return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if any provider is connected (consolidated check across all OAuth systems)
 * This is the main entry point for checking connection status
 * 
 * @param userId - User ID to check
 * @param provider - Provider to check (e.g., 'github', 'google', 'slack')
 * @returns true if connected via ANY system (Nango/Arcade/Composio/Auth0)
 */
export async function isProviderConnectedAny(userId: string, provider: string): Promise<boolean> {
  try {
    // 1. Check database for Nango/Arcade/Composio connections
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT 1 FROM external_connections 
      WHERE user_id = ? AND provider = ? AND is_active = TRUE LIMIT 1
    `);
    if (stmt.get(userId, provider)) return true;
    
    // 2. Check Auth0 Connected Accounts
    const auth0Connection = getAuth0ConnectionName(provider);
    if (auth0Connection) {
      const token = await getAccessTokenForConnection(auth0Connection, userId);
      if (token) return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

// Use centralized provider mapping (single source of truth)
import { getAuth0ConnectionForPlatform as getAuth0ConnectionName } from './provider-map';

/**
 * Get all connected providers for a user (consolidated across all systems)
 * 
 * @param userId - User ID to check
 * @returns Array of provider names that are connected
 */
export async function getAllConnectedProviders(userId: string): Promise<string[]> {
  const connectedProviders = new Set<string>();
  
  try {
    // 1. Get connections from database (Nango/Arcade/Composio)
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT DISTINCT provider FROM external_connections 
      WHERE user_id = ? AND is_active = TRUE
    `);
    const rows = stmt.all(userId) as Array<{ provider: string }>;
    for (const row of rows) {
      connectedProviders.add(row.provider);
    }
    
    // 2. Check Auth0 Connected Accounts
    const auth0Providers = ['github', 'google', 'gmail', 'slack', 'twitter', 'linkedin', 'microsoft'];
    for (const provider of auth0Providers) {
      const auth0Connection = getAuth0ConnectionName(provider);
      if (auth0Connection) {
        const token = await getAccessTokenForConnection(auth0Connection, userId);
        if (token) connectedProviders.add(provider);
      }
    }
    
    return Array.from(connectedProviders);
  } catch {
    return Array.from(connectedProviders);
  }
}

/**
 * Parse GitHub URL to extract owner and repo
 */
/**
 * Map Auth0 user ID to local database user ID
 * This is needed for the onCallback hook to save connected accounts
 * 
 * @param auth0UserId - The Auth0 user ID (session.user.sub)
 * @returns Local user ID or null if not found
 */
export async function getLocalUserIdFromAuth0(auth0UserId: string): Promise<string | null> {
  try {
    const db = getDatabase();
    // Look up user by auth0 id if stored, or by matching email from session
    // For now, we store the auth0 user id in user_preferences
    const stmt = db.prepare(`
      SELECT user_id FROM user_preferences 
      WHERE preference_key = 'auth0_user_id' AND preference_value = ?
      LIMIT 1
    `);
    const row = stmt.get(auth0UserId) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Store Auth0 user ID mapping for a local user
 * Call this when user first logs in via Auth0
 * 
 * @param localUserId - Local database user ID
 * @param auth0UserId - Auth0 user ID
 */
export async function mapAuth0UserId(localUserId: string, auth0UserId: string): Promise<boolean> {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO user_preferences (user_id, preference_key, preference_value, updated_at)
      VALUES (?, 'auth0_user_id', ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(localUserId, auth0UserId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Disconnect a provider from all OAuth systems (consolidated)
 * This removes the connection from Nango/Arcade/Composio AND Auth0
 * 
 * @param userId - Local user ID
 * @param provider - Provider to disconnect (e.g., 'github', 'google', 'slack')
 */
export async function disconnectProviderAll(userId: string, provider: string): Promise<boolean> {
  let success = true;
  
  try {
    // 1. Disconnect from database (Nango/Arcade/Composio)
    const db = getDatabase();
    const dbStmt = db.prepare(`
      UPDATE external_connections SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND provider = ?
    `);
    dbStmt.run(userId, provider);
    
    // 2. Disconnect from Auth0 Connected Accounts
    const { disconnectProvider } = await import('@/lib/auth0');
    try {
      await disconnectProvider(userId, provider);
    } catch (e) {
      // Auth0 disconnect might fail if not connected there - that's OK
      console.log(`[OAuth] Auth0 disconnect skipped for ${provider}:`, e);
    }
    
    console.log(`[OAuth] Disconnected ${provider} for user ${userId} from all systems`);
    return success;
  } catch (error) {
    console.error(`[OAuth] Failed to disconnect ${provider}:`, error);
    return false;
  }
}

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
