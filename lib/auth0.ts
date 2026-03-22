/**
 * Auth0 Client Configuration
 *
 * PURPOSE: Additional OAuth integration layer for:
 * 1. Social logins (GitHub, Google, etc.) via Connected Accounts
 * 2. Direct API access via Auth0 Token Vault
 * 3. Complementary to Nango/Composio/Arcade (not a replacement)
 *
 * Auth0 is used for:
 * - UX-level integrations (GitHub repo import, etc.)
 * - Fallback token source for agent tools
 * - Direct user account connections
 */

import { NextResponse } from 'next/server';
import { Auth0Client } from "@auth0/nextjs-auth0/server";

console.log('[Auth0] Initializing Auth0Client', {
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_CLIENT_ID,
  hasSecret: !!process.env.AUTH0_SECRET,
  baseUrl: process.env.AUTH0_BASE_URL || process.env.NEXT_PUBLIC_APP_URL,
});

// Lazy-loaded database functions to avoid Edge Runtime issues
// Node.js modules (crypto, fs, path) in connection.ts are not compatible with Edge
function getDatabase() {
  return require('./database/connection').getDatabase();
}

function encryptApiKey(apiKey: string) {
  return require('./database/connection').encryptApiKey(apiKey);
}

function decryptApiKey(encryptedData: string) {
  return require('./database/connection').decryptApiKey(encryptedData);
}

// Lazy-loaded mapping functions to avoid circular dependency
// These will be called inside callback to avoid import issues
async function getLocalUserIdFromAuth0(auth0UserId: string): Promise<number | null> {
  const { getLocalUserIdFromAuth0: fn } = await import("./oauth/connections");
  return fn(auth0UserId);
}

async function mapAuth0UserId(localUserId: number, auth0UserId: string): Promise<boolean> {
  const { mapAuth0UserId: fn } = await import("./oauth/connections");
  return fn(localUserId, auth0UserId);
}

// Token cache for connected account access tokens
// Implements caching to minimize calls to Auth0 token endpoint
interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - tokens typically last longer

/**
 * Get cache key for connection and optional userId
 */
function getCacheKey(connection: string, userId?: number): string {
  return userId ? `${userId}:${connection}` : connection;
}

/**
 * Get cached token if valid, otherwise returns null
 */
function getCachedToken(connection: string, userId?: number): string | null {
  const key = getCacheKey(connection, userId);
  const entry = tokenCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.token;
  }
  tokenCache.delete(key);
  return null;
}

/**
 * Cache a token for a connection and userId
 */
function cacheToken(connection: string, token: string, expiresIn: number = 3600, userId?: number): void {
  const key = getCacheKey(connection, userId);
  const ttl = Math.min(expiresIn * 1000, CACHE_TTL_MS);
  tokenCache.set(key, {
    token,
    expiresAt: Date.now() + ttl,
  });
}

/**
 * Clear cached token for a connection (all user scopes)
 */
export function clearCachedToken(connection: string): void {
  // Clear without userId first
  tokenCache.delete(connection);
  // Clear all entries that match this connection (with any userId)
  for (const key of tokenCache.keys()) {
    if (key.endsWith(`:${connection}`)) {
      tokenCache.delete(key);
    }
  }
}

/**
 * Clear cached tokens for a specific user
 */
export function clearCachedTokensForUser(userId: number): void {
  for (const key of tokenCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      tokenCache.delete(key);
    }
  }
}

/**
 * Clear all cached tokens (e.g., on logout)
 */
export function clearAllCachedTokens(): void {
  tokenCache.clear();
}

/**
 * Database operations for connected accounts persistence
 */

interface ConnectedAccountRecord {
  id?: number;
  user_id: number;
  provider: string;
  provider_account_id: string;
  provider_display_name?: string;
  access_token_encrypted?: string;
  refresh_token_encrypted?: string;
  token_expires_at?: string;
  scopes?: string;
  metadata?: string;
  created_at?: string;
  updated_at?: string;
  is_active?: boolean;
  last_accessed_at?: string;
}

/**
 * Save a connected account to the database
 */
export async function saveConnectedAccount(
  userId: number,
  provider: string,
  providerAccountId: string,
  providerDisplayName?: string,
  accessToken?: string,
  refreshToken?: string,
  tokenExpiresAt?: Date,
  scopes?: string[]
): Promise<boolean> {
  try {
    const db = getDatabase();
    
    const { encrypted: accessTokenEncrypted } = accessToken 
      ? encryptApiKey(accessToken) 
      : { encrypted: null };
    
    const { encrypted: refreshTokenEncrypted } = refreshToken 
      ? encryptApiKey(refreshToken) 
      : { encrypted: null };
    
    const stmt = db.prepare(`
      INSERT INTO external_connections 
      (user_id, provider, provider_account_id, provider_display_name, 
       access_token_encrypted, refresh_token_encrypted, token_expires_at, 
       scopes, updated_at, is_active, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, TRUE, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, provider, provider_account_id) 
      DO UPDATE SET
        provider_display_name = excluded.provider_display_name,
        access_token_encrypted = COALESCE(excluded.access_token_encrypted, external_connections.access_token_encrypted),
        refresh_token_encrypted = COALESCE(excluded.refresh_token_encrypted, external_connections.refresh_token_encrypted),
        token_expires_at = COALESCE(excluded.token_expires_at, external_connections.token_expires_at),
        scopes = COALESCE(excluded.scopes, external_connections.scopes),
        updated_at = CURRENT_TIMESTAMP,
        last_accessed_at = CURRENT_TIMESTAMP,
        is_active = TRUE
    `);
    
    stmt.run(
      userId,
      provider,
      providerAccountId,
      providerDisplayName || null,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt?.toISOString() || null,
      scopes ? scopes.join(',') : null
    );
    
    console.log(`[Auth0] Saved connected account: ${provider} for user ${userId}`);
    return true;
  } catch (error) {
    console.error('[Auth0] Failed to save connected account:', error);
    return false;
  }
}

/**
 * Get all connected accounts for a user
 */
export function getConnectedAccountsByUser(userId: number): ConnectedAccountRecord[] {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM external_connections 
      WHERE user_id = ? AND is_active = TRUE
      ORDER BY updated_at DESC
    `);
    return stmt.all(userId) as ConnectedAccountRecord[];
  } catch (error) {
    console.error('[Auth0] Failed to get connected accounts:', error);
    return [];
  }
}

/**
 * Check if a provider is connected for a user
 */
export function isProviderConnected(userId: number, provider: string): boolean {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT 1 FROM external_connections 
      WHERE user_id = ? AND provider = ? AND is_active = TRUE
      LIMIT 1
    `);
    return !!stmt.get(userId, provider);
  } catch (error) {
    console.error('[Auth0] Failed to check provider connection:', error);
    return false;
  }
}

/**
 * Disconnect a provider for a user
 */
export function disconnectProvider(userId: number, provider: string): boolean {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE external_connections 
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND provider = ?
    `);
    const result = stmt.run(userId, provider);
    
    // Clear from token cache
    clearCachedToken(provider);
    
    console.log(`[Auth0] Disconnected provider: ${provider} for user ${userId}`);
    return result.changes > 0;
  } catch (error) {
    console.error('[Auth0] Failed to disconnect provider:', error);
    return false;
  }
}

/**
 * Get decrypted access token for a connected account
 * Returns token with its expiration time to enable proper cache TTL management
 */
export function getStoredAccessToken(
  userId: number,
  provider: string
): { token: string; expiresAt?: Date } | null {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT access_token_encrypted, token_expires_at
      FROM external_connections
      WHERE user_id = ? AND provider = ? AND is_active = TRUE
      LIMIT 1
    `);

    const result = stmt.get(userId, provider) as { access_token_encrypted: string; token_expires_at?: string } | undefined;

    if (result?.access_token_encrypted) {
      const token = decryptApiKey(result.access_token_encrypted);
      const expiresAt = result.token_expires_at ? new Date(result.token_expires_at) : undefined;

      // Check if token is expired
      if (expiresAt && expiresAt < new Date()) {
        console.log(`[Auth0] Token expired for ${provider}, need to refresh`);
        return null;
      }

      return { token, expiresAt };
    }

    return null;
  } catch (error) {
    console.error('[Auth0] Failed to get stored access token:', error);
    return null;
  }
}

export const auth0 = new Auth0Client({
  // onCallback hook for post-auth redirects
  // NOTE: Database operations are NOT performed here — auth0.middleware() runs in
  // Edge Runtime which is incompatible with Node.js-only modules (better-sqlite3 via
  // CommonJS require). The hook must return a valid NextResponse to avoid a crash
  // in the SDK at handleCallbackError: response.cookies. Use /api/auth0/post-callback
  // (server runtime) for post-auth database operations.
  enableConnectAccountEndpoint: true,
  routes: {
    connectAccount: "/auth/connect",
  },
  async onCallback(error, context, session) {
    try {
      // Resolve base URL from context (provided by SDK), then app config env vars
      const baseUrl = context?.appBaseUrl
        || process.env.APP_BASE_URL
        || process.env.NEXT_PUBLIC_APP_URL
        || 'http://localhost:3000';
      console.log('[Auth0] onCallback invoked', {
        error: error ? {
          message: error.message,
          code: error.code,
          name: error.name,
          cause: error.cause,
        } : null,
        hasContext: !!context,
        hasSession: !!session,
        returnTo: context?.returnTo,
        sessionUser: session?.user ? { sub: (session.user as any).sub, email: (session.user as any).email } : null,
      });
      if (error) {
        const errorUrl = new URL('/auth/error', baseUrl);
        errorUrl.searchParams.set('error', 'callback_error');
        errorUrl.searchParams.set('error_description', error.message);
        return NextResponse.redirect(errorUrl.toString());
      }
      
      // Successful auth: redirect to the returnTo from context, or root.
      // Only allow same-origin redirects to prevent open redirect attacks
      const returnTo = context?.returnTo || '/';
      const parsedReturnTo = new URL(returnTo, baseUrl);
      const appOrigin = new URL(baseUrl).origin;
      const redirectUrl = parsedReturnTo.origin === appOrigin
        ? parsedReturnTo.toString()
        : new URL('/', baseUrl).toString();
      console.log('[Auth0] onCallback successful, redirecting to:', redirectUrl);
      return NextResponse.redirect(redirectUrl);
    } catch (e: any) {
      // Last-resort safeguard: never let onCallback throw
      console.error('[Auth0] onCallback threw:', e?.message, e?.stack);
      return NextResponse.redirect('http://localhost:3000/');
    }
  },
});

/**
 * Extended connection names for Auth0 social logins and enterprise connections
 * Includes all major providers supported by Auth0 Connected Accounts
 */
// NOTE: Microsoft connection uses 'windowslive' (Legacy Microsoft Accounts)
// For Azure AD / Microsoft Entra ID, a different Auth0 enterprise connection would be needed
export const AUTH0_CONNECTIONS = {
  // Social connections
  GITHUB: 'github',
  GOOGLE: 'google-oauth2',
  FACEBOOK: 'facebook',
  TWITTER: 'twitter',
  LINKEDIN: 'linkedin',
  // Microsoft / Azure AD
  // NOTE: If TOOL_PROVIDER_MAP resolves Outlook tools to 'microsoft' provider,
  // ensure getAuth0ConnectionForProvider() includes 'microsoft' in its mapping
  MICROSOFT: 'windowslive',
  // Apple
  APPLE: 'apple',
  // Amazon
  AMAZON: 'amazon',
  // Instagram
  INSTAGRAM: 'instagram',
  // Bitbucket
  BITBUCKET: 'bitbucket',
  // Yahoo
  YAHOO: 'yahoo',
  // Box
  BOX: 'box',
  // Salesforce
  SALESFORCE: 'salesforce',
  // Slack (also available via Nango)
  SLACK: 'slack',
} as const;

/**
 * Mapping of provider IDs to connection names for the IntegrationPanel
 */
export const PROVIDER_CONNECTION_MAP: Record<string, string> = {
  'github': 'github',
  'google': 'google-oauth2',
  'facebook': 'facebook',
  'twitter': 'twitter',
  'linkedin': 'linkedin',
  'microsoft': 'windowslive',
  'apple': 'apple',
  'instagram': 'instagram',
  'bitbucket': 'bitbucket',
  'slack': 'slack',
};

/**
 * Get Auth0 session if available
 * Returns null if user is not authenticated via Auth0
 */
export async function getAuth0Session() {
  try {
    return await auth0.getSession();
  } catch {
    return null;
  }
}

/**
 * Check if user is authenticated via Auth0
 */
export async function isAuth0Authenticated() {
  const session = await getAuth0Session();
  return session !== null;
}

/**
 * Get Auth0 access token for external API calls
 * Used by agent integrations to access 3rd party APIs
 */
export async function getAuth0AccessToken() {
  try {
    return await auth0.getAccessToken();
  } catch {
    return null;
  }
}

/**
 * Get access token for a specific connection (e.g., GitHub, Google)
 * Used to access external APIs with OAuth tokens from social logins
 * Uses token caching and database persistence for tokens
 *
 * SECURITY: When userId is provided, only return tokens scoped to that user.
 * When userId is not provided, use session-based approach.
 *
 * @param connection - The connection name (e.g., 'github', 'google-oauth2')
 * @param userId - Optional user ID to retrieve stored tokens from database
 * @returns The access token for the connection, or null if not available
 */
export async function getAccessTokenForConnection(connection: string, userId?: number) {
  // Check cache first with userId scope if provided
  const cachedToken = getCachedToken(connection, userId);
  if (cachedToken) {
    return cachedToken;
  }

  // If userId provided, check database for stored token and ONLY use that
  if (userId) {
    const storedToken = getStoredAccessToken(userId, connection);
    if (storedToken) {
      // Calculate remaining TTL based on actual token expiration
      const expiresIn = storedToken.expiresAt
        ? Math.max(0, Math.floor((storedToken.expiresAt.getTime() - Date.now()) / 1000))
        : 3600;

      // Only cache if token has remaining validity
      if (expiresIn > 0) {
        cacheToken(connection, storedToken.token, expiresIn, userId);
      }

      return storedToken.token;
    }
    // User-specific token not found, don't fall back to session token
    return null;
  }
  
  // No userId - use session-based approach (current behavior)
  try {
    const result = await auth0.getAccessTokenForConnection({ connection });
    if (result?.token) {
      // Don't cache session-based tokens globally to prevent cross-user exposure
      // The Auth0 SDK handles its own session-scoped caching
      return result.token;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get GitHub access token for the authenticated user
 * Requires user to have connected their GitHub account via Auth0
 *
 * @returns GitHub access token, or null if not available
 */
export async function getGitHubToken() {
  return getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB);
}

/**
 * List all connected accounts for the user
 * Returns connection status for all supported providers
 */
export async function getConnectedAccounts() {
  try {
    const connections = await Promise.all(
      Object.entries(AUTH0_CONNECTIONS).map(async ([name, connection]) => {
        const token = await getAccessTokenForConnection(connection);
        return {
          provider: name.toLowerCase(),
          connection,
          connected: !!token,
        };
      })
    );
    
    return connections;
  } catch {
    return [];
  }
}
