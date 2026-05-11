/**
 * 9Router Token Store
 * 
 * Provides retrieval of decrypted OAuth tokens for forwarding chat
 * requests to 9Router. Uses the existing OAuthService with AES-256-GCM
 * encrypted token storage.
 * 
 * Usage:
 * ```ts
 * const tokens = await getUserRouterTokens(userId, provider)
 * if (tokens) {
 *   const response = await routerClient.chat(tokens.accessToken, chatRequest)
 * }
 * ```
 */

import { oauthService } from '@/lib/auth/oauth-service'
import type { OAuthConnection } from '@/lib/auth/oauth-service'

export interface RouterTokenResult {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  connectionId: string
}

/**
 * Get decrypted tokens for a user's 9Router provider connection.
 * Returns null if no active connection exists.
 */
export async function getUserRouterTokens(
  userId: string,
  provider: string
): Promise<RouterTokenResult | null> {
  try {
    const connections = await oauthService.getUserConnections(userId, provider)
    
    if (!connections || connections.length === 0) {
      return null
    }

    // Get the most recent active connection
    const connection = connections[0] // Already sorted by most recent via SQL

    // Decrypt the tokens
    const decrypted = await oauthService.getDecryptedToken(connection.id, userId)
    
    if (!decrypted || !decrypted.accessToken) {
      console.warn(`[RouterTokenStore] No decrypted token for user ${userId} provider ${provider}`)
      return null
    }

    return {
      accessToken: decrypted.accessToken,
      refreshToken: decrypted.refreshToken,
      expiresAt: connection.tokenExpiresAt || undefined,
      connectionId: connection.providerAccountId, // 9Router connection ID
    }
  } catch (error) {
    console.error(`[RouterTokenStore] Failed to get tokens for user ${userId}:`, error)
    return null
  }
}

/**
 * Get all active 9Router provider connections for a user.
 * Useful for listing connected providers in the UI.
 */
export async function getUserRouterConnections(userId: string): Promise<OAuthConnection[]> {
  try {
    return await oauthService.getUserConnections(userId)
  } catch (error) {
    console.error(`[RouterTokenStore] Failed to get connections for user ${userId}:`, error)
    return []
  }
}

/**
 * Revoke a user's 9Router provider connection.
 * Returns true if successful, false otherwise.
 */
export async function revokeUserRouterConnection(
  userId: string,
  provider: string
): Promise<boolean> {
  try {
    const connections = await oauthService.getUserConnections(userId, provider)
    
    if (!connections || connections.length === 0) {
      return false
    }

    return await oauthService.revokeConnection(connections[0].id, userId)
  } catch (error) {
    console.error(`[RouterTokenStore] Failed to revoke connection for user ${userId}:`, error)
    return false
  }
}

/**
 * Check if a user's token is expired or about to expire.
 * Returns true if token is valid and not expiring within the given buffer.
 */
export function isTokenExpiringSoon(expiresAt: Date | null, bufferMinutes = 5): boolean {
  if (!expiresAt) return false // No expiry info means don't check
  const bufferMs = bufferMinutes * 60 * 1000
  return expiresAt.getTime() - Date.now() < bufferMs
}

/**
 * Get the best available API key for a provider.
 * Prefers user-stored OAuth tokens over fallback API keys.
 * 
 * Note: This is for 9Router's /v1 endpoint which uses API keys for routing,
 * not for direct provider API calls.
 */
export async function getRouterApiKey(
  userId: string,
  provider: string
): Promise<{ key: string; type: 'oauth' | 'fallback'; expiresAt?: Date } | null> {
  // First try OAuth tokens from 9Router connections
  const oauthTokens = await getUserRouterTokens(userId, provider)
  
  if (oauthTokens && !isTokenExpiringSoon(oauthTokens.expiresAt)) {
    return {
      key: oauthTokens.accessToken,
      type: 'oauth',
      expiresAt: oauthTokens.expiresAt,
    }
  }

  return null
}