/**
 * 9Router Token Refresh Service
 * 
 * Automatically refreshes OAuth tokens before they expire.
 * Integrates with 9Router's refresh endpoint and updates encrypted storage.
 * 
 * Usage:
 * ```ts
 * // Auto-refresh if expiring within 5 minutes
 * const tokens = await getOrRefreshUserTokens(userId, provider, routerClient)
 * 
 * // Or manual refresh check
 * const needsRefresh = await checkTokenNeedsRefresh(userId, provider)
 * ```
 */

import { oauthService } from '@/lib/auth/oauth-service'
import type { OAuthConnection } from '@/lib/auth/oauth-service'
import type { RouterClient } from './client'
import { getRouterClient } from './client'

// Default buffer: refresh tokens that will expire within 5 minutes
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000

export interface RefreshResult {
  success: boolean
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  refreshed: boolean // true if we actually refreshed, false if still valid
  error?: string
}

/**
 * Check if a token needs refresh and refresh it if necessary.
 * Returns the current (or refreshed) tokens.
 */
export async function getOrRefreshUserTokens(
  userId: string,
  provider: string,
  routerClient: RouterClient,
  bufferMs: number = DEFAULT_REFRESH_BUFFER_MS
): Promise<RefreshResult> {
  try {
    // Get current connection and tokens
    const connections = await oauthService.getUserConnections(userId, provider)
    
    if (!connections || connections.length === 0) {
      return { success: false, accessToken: '', refreshed: false, error: 'No connection found' }
    }

    const connection = connections[0]
    const decrypted = await oauthService.getDecryptedToken(connection.id, userId)
    
    if (!decrypted || !decrypted.accessToken) {
      return { success: false, accessToken: '', refreshed: false, error: 'No token available' }
    }

    // Check if token needs refresh
    const expiresAt = connection.tokenExpiresAt
    const now = Date.now()
    const timeUntilExpiry = expiresAt ? expiresAt.getTime() - now : Infinity
    
    if (timeUntilExpiry > bufferMs) {
      // Token is still valid and not expiring soon
      return {
        success: true,
        accessToken: decrypted.accessToken,
        refreshToken: decrypted.refreshToken,
        expiresAt,
        refreshed: false, // No refresh needed
      }
    }

    // Token is expired or expiring soon - try to refresh
    if (!decrypted.refreshToken) {
      // No refresh token available, return current token (may be expired)
      console.warn(`[TokenRefresh] No refresh token for ${provider}, cannot auto-refresh`)
      return {
        success: true, // Still return the token, even if expired
        accessToken: decrypted.accessToken,
        refreshToken: undefined,
        expiresAt,
        refreshed: false,
        error: 'No refresh token available',
      }
    }

    // Attempt to refresh via 9Router
    const refreshedTokens = await refreshTokenWith9Router(
      provider,
      decrypted.refreshToken,
      connection.providerAccountId,
      connection.userId // Pass userId for multi-tenancy
    )

    if (refreshedTokens.success && refreshedTokens.accessToken) {
      // Update stored tokens using saveConnection (handles encryption internally)
      await oauthService.saveConnection({
        userId: connection.userId,
        provider: connection.provider,
        providerAccountId: connection.providerAccountId,
        providerDisplayName: connection.providerDisplayName || undefined,
        accessToken: refreshedTokens.accessToken,
        refreshToken: refreshedTokens.refreshToken,
        expiresIn: refreshedTokens.expiresIn,
        scopes: connection.scopes,
      })

      return {
        success: true,
        accessToken: refreshedTokens.accessToken,
        refreshToken: refreshedTokens.refreshToken,
        expiresAt: refreshedTokens.expiresAt,
        refreshed: true,
      }
    }

    // Refresh failed, return current tokens
    return {
      success: true,
      accessToken: decrypted.accessToken,
      refreshToken: decrypted.refreshToken,
      expiresAt,
      refreshed: false,
      error: refreshedTokens.error || 'Refresh failed',
    }
  } catch (error) {
    console.error(`[TokenRefresh] Failed to refresh token for ${provider}:`, error)
    return { success: false, accessToken: '', refreshed: false, error: String(error) }
  }
}

/**
 * Check if a token needs refresh without actually refreshing it.
 * Useful for background jobs or pre-emptive checking.
 */
export async function checkTokenNeedsRefresh(
  userId: string,
  provider: string,
  bufferMs: number = DEFAULT_REFRESH_BUFFER_MS
): Promise<{ needsRefresh: boolean; expiresAt?: Date | null; error?: string }> {
  try {
    const connections = await oauthService.getUserConnections(userId, provider)
    
    if (!connections || connections.length === 0) {
      return { needsRefresh: true, error: 'No connection found' }
    }

    const connection = connections[0]
    const expiresAt = connection.tokenExpiresAt
    const now = Date.now()
    const timeUntilExpiry = expiresAt ? expiresAt.getTime() - now : Infinity

    return {
      needsRefresh: timeUntilExpiry <= bufferMs,
      expiresAt,
    }
  } catch (error) {
    return { needsRefresh: true, error: String(error) }
  }
}

/**
 * Refresh a token via 9Router's refresh endpoint.
 * Returns the new tokens on success.
 */
async function refreshTokenWith9Router(
  provider: string,
  refreshToken: string,
  connectionId: string,
  userId?: string
): Promise<{ success: boolean; accessToken?: string; refreshToken?: string; expiresAt?: Date; expiresIn?: number; error?: string }> {
  try {
    const client = getRouterClient()
    const { baseUrl, adminKey } = client.getAdminConfig()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminKey}`,
    }

    // Add userId header for multi-tenancy if provided
    if (userId) {
      headers['x-user-id'] = userId
    }

    const response = await fetch(`${baseUrl}/api/oauth/${provider}/refresh`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        refreshToken,
        connectionId,
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout for refresh
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      return { success: false, error: `Refresh failed: ${response.status} - ${errorText}` }
    }

    const result = await response.json()

    if (result.success && result.accessToken) {
      return {
        success: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        expiresAt: result.expiresIn ? new Date(Date.now() + result.expiresIn * 1000) : undefined,
      }
    }

    return { success: false, error: result.error || 'Refresh failed' }
  } catch (error: any) {
    // Timeout or network error - refresh endpoint may not exist
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return { success: false, error: 'Refresh endpoint timed out (may not exist)' }
    }
    return { success: false, error: String(error) }
  }
}

/**
 * Force refresh a token regardless of expiry time.
 * Useful for manual refresh triggered by user.
 */
export async function forceRefreshToken(
  userId: string,
  provider: string,
  routerClient: RouterClient
): Promise<RefreshResult> {
  // Temporarily set buffer to 0 to force refresh check
  return getOrRefreshUserTokens(userId, provider, routerClient, 0)
}

/**
 * Get all connections that need refresh (for background job).
 * Returns connections where tokens are expiring within the buffer.
 */
export async function getConnectionsNeedingRefresh(
  bufferMs: number = DEFAULT_REFRESH_BUFFER_MS
): Promise<Array<{ connection: OAuthConnection; userId: string }>> {
  try {
    // Note: In production, you'd want a more efficient way to track this
    // e.g., a separate table indexed by expiration time, or a background job
    // that periodically checks and queues refresh tasks
    
    const results: Array<{ connection: OAuthConnection; userId: string }> = []
    const now = Date.now()
    
    // This is a simplified approach - in production consider:
    // 1. A dedicated table for token expiration tracking
    // 2. Background job that periodically scans for expiring tokens
    // 3. Redis or message queue for refresh task scheduling
    
    // For now, we check each provider (this is O(n) per provider)
    const providers = ['claude-code', 'codex', 'cursor', 'copilot', 'github', 'kiro', 'gitlab', 'iflow', 'kimi-coding', 'kilocode', 'codebuddy']
    
    for (const provider of providers) {
      try {
        const connections = await oauthService.getUserConnections('', provider)
        for (const connection of connections) {
          const expiresAt = connection.tokenExpiresAt
          if (expiresAt && expiresAt.getTime() - now <= bufferMs) {
            results.push({ connection, userId: connection.userId })
          }
        }
      } catch {
        // Skip providers with no connections
      }
    }

    return results
  } catch (error) {
    console.error('[TokenRefresh] Failed to get connections needing refresh:', error)
    return []
  }
}

/**
 * Refresh all tokens that need refresh (background job).
 * Returns array of refresh results.
 */
export async function refreshAllExpiringTokens(
  bufferMs: number = DEFAULT_REFRESH_BUFFER_MS
): Promise<Array<{ userId: string; provider: string; result: RefreshResult }>> {
  const results: Array<{ userId: string; provider: string; result: RefreshResult }> = []
  const connections = await getConnectionsNeedingRefresh(bufferMs)
  const client = getRouterClient()

  for (const { userId, connection } of connections) {
    const result = await getOrRefreshUserTokens(userId, connection.provider, client, bufferMs)
    results.push({ userId, provider: connection.provider, result })
  }

  return results
}