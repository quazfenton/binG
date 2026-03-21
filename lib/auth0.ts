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

import { Auth0Client } from "@auth0/nextjs-auth0/server";

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
 */
export function getStoredAccessToken(userId: number, provider: string): string | null {
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
      // Check if token is expired
      if (result.token_expires_at) {
        const expiresAt = new Date(result.token_expires_at);
        if (expiresAt < new Date()) {
          console.log(`[Auth0] Token expired for ${provider}, need to refresh`);
          return null;
        }
      }
      return decryptApiKey(result.access_token_encrypted);
    }
    
    return null;
  } catch (error) {
    console.error('[Auth0] Failed to get stored access token:', error);
    return null;
  }
}

// onCallback hook to handle post-connection logic
export const auth0 = new Auth0Client({
  // Enable Connected Accounts endpoint at /auth/connect
  enableConnectAccountEndpoint: true,
  routes: {
    connectAccount: "/auth/connect",
  },
  // onCallback hook for post-connection handling
  async onCallback(error, context, session) {
    // Handle connected account callback (user links new social account)
    if (context?.connectedAccount) {
      console.log('[Auth0] Connected account linked:', context.connectedAccount);
      
      // Map Auth0 user ID to local user ID and save connected account
      if (session?.user?.sub) {
        try {
          const auth0UserId = session.user.sub;
          const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
          
          if (localUserId && context.connectedAccount.connection) {
            // Save connected account to database for persistence
            await saveConnectedAccount(
              localUserId,
              context.connectedAccount.connection,
              context.connectedAccount.id || 'unknown',
              context.connectedAccount.connection // Use connection name as display name
            );
            console.log('[Auth0] Saved connected account to database for user', localUserId);
          }
          
          // Clear any cached tokens for this connection to force refresh
          clearCachedToken(context.connectedAccount.connection);
        } catch (mappingError) {
          console.error('[Auth0] Failed to map/save connected account:', mappingError);
        }
      }
    }
    
    // Handle regular auth callback (user logs in via Auth0)
    if (error) {
      console.error('[Auth0] Callback error:', error.message);
      return null;
    }
    
    // Map Auth0 user ID to local user on successful login
    if (session?.user?.sub && session?.user?.email) {
      try {
        const auth0UserId = session.user.sub;
        const email = session.user.email;
        
        // Find or create local user based on email
        const db = getDatabase();
        let localUser = db.prepare('SELECT id FROM users WHERE email = ? AND is_active = TRUE').get(email) as { id: number } | undefined;
        
        let localUserId: number | null = null;
        
        if (localUser) {
          localUserId = localUser.id;
        } else {
          // Create new local user for Auth0 login (or use existing flow)
          // For now, we just map to existing users; new user creation would need additional logic
          console.log('[Auth0] No local user found for email:', email);
        }
        
        // If we have a local user, map the Auth0 ID
        if (localUserId) {
          await mapAuth0UserId(localUserId, auth0UserId);
          console.log('[Auth0] Mapped Auth0 user ID to local user:', localUserId);
        }
      } catch (mappingError) {
        console.error('[Auth0] Failed to map Auth0 user ID:', mappingError);
      }
    }
    
    // Return null to let SDK handle the redirect internally
    return null;
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
      cacheToken(connection, storedToken, 3600, userId);
      return storedToken;
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
