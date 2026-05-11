# 9Router OAuth Token Refresh Endpoint

## Overview

Add `/api/oauth/[provider]/refresh` endpoint to enable automatic token refresh for OAuth connections.

## Implementation

### 1. Create Migration for refresh Token Storage

**File: `src/lib/db/migrations/003-refresh-token-tracking.js`**

```javascript
export async function up(db) {
  // Track refresh attempts to prevent infinite loops
  db.run(`
    CREATE TABLE IF NOT EXISTS refresh_token_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connectionId TEXT NOT NULL,
      attemptedAt TEXT NOT NULL,
      success INTEGER DEFAULT 0,
      error TEXT,
      FOREIGN KEY (connectionId) REFERENCES providerConnections(id)
    )
  `)
  
  // Index for fast lookups
  db.run(`CREATE INDEX idx_refresh_history_connectionId ON refresh_token_history(connectionId)`)
  
  // Add last refresh timestamp to connections
  db.run(`ALTER TABLE providerConnections ADD COLUMN lastRefreshAt TEXT`)
}

export async function down(db) {
  db.run(`DROP TABLE IF EXISTS refresh_token_history`)
  db.run(`DROP INDEX IF EXISTS idx_refresh_history_connectionId`)
  db.run(`ALTER TABLE providerConnections DROP COLUMN lastRefreshAt`)
}
```

### 2. Add Refresh Function to connectionsRepo

**File: `src/lib/db/repos/connectionsRepo.js`**

Add these functions:

```javascript
/**
 * Get connection by provider and userId for refresh
 */
export async function getConnectionForRefresh(provider, userId) {
  const db = await getAdapter();
  
  const row = db.get(`
    SELECT * FROM providerConnections 
    WHERE provider = ? AND userId = ? AND isActive = 1
  `, [provider, userId])
  
  if (!row) return null
  
  const conn = rowToConn(row)
  
  // Check if we have a refresh token
  if (!conn.refreshToken) {
    return { error: 'No refresh token available', connection: conn }
  }
  
  // Check if token is actually expired (with 60s buffer)
  if (conn.expiresAt) {
    const expiryDate = new Date(conn.expiresAt)
    const now = Date.now()
    const bufferMs = 60 * 1000
    
    if (expiryDate.getTime() - now > bufferMs) {
      return { error: 'Token not yet expired', connection: conn, notExpired: true }
    }
  }
  
  return { connection: conn }
}

/**
 * Update connection after successful token refresh
 */
export async function updateConnectionTokens(connectionId, tokenData) {
  const db = await getAdapter();
  const now = new Date().toISOString()
  
  db.run(`
    UPDATE providerConnections SET
      accessToken = ?,
      refreshToken = ?,
      tokenExpiresAt = ?,
      lastRefreshAt = ?,
      updatedAt = ?
    WHERE id = ?
  `, [
    tokenData.accessToken,
    tokenData.refreshToken || null,  // May not be new refresh token
    tokenData.expiresAt || null,
    now,
    now,
    connectionId
  ])
}

/**
 * Record refresh attempt for debugging
 */
export async function recordRefreshAttempt(connectionId, success, error = null) {
  const db = await getAdapter();
  
  db.run(`
    INSERT INTO refresh_token_history (connectionId, attemptedAt, success, error)
    VALUES (?, ?, ?, ?)
  `, [connectionId, new Date().toISOString(), success ? 1 : 0, error])
}
```

### 3. Create Provider Token Refresh Handler

**File: `src/lib/oauth/refreshHandlers.js`**

```javascript
/**
 * Refresh tokens for each provider type.
 * Returns the new token data or throws an error.
 */

export async function refreshProviderToken(provider, refreshToken, connection) {
  const config = getProviderConfig(provider)
  
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`)
  }
  
  switch (provider) {
    case 'claude-code':
      return await refreshClaudeCodeToken(config, refreshToken)
    case 'github':
      return await refreshGitHubToken(config, refreshToken)
    case 'cursor':
      return await refreshCursorToken(config, refreshToken)
    case 'copilot':
      return await refreshCopilotToken(config, refreshToken)
    default:
      throw new Error(`Refresh not supported for provider: ${provider}`)
  }
}

async function refreshClaudeCodeToken(config, refreshToken) {
  // Claude Code uses standard OAuth refresh
  const response = await fetch('https://api.claude.ai/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude Code token refresh failed: ${error}`)
  }
  
  return await response.json()
}

async function refreshGitHubToken(config, refreshToken) {
  // GitHub OAuth does NOT support token refresh by default
  // GitHub uses long-lived tokens that don't expire
  // If user needs a new token, they must re-authorize
  throw new Error('REFRESH_NOT_SUPPORTED: GitHub OAuth does not support token refresh. User must re-authorize.')

async function refreshCursorToken(config, refreshToken) {
  // Cursor may use different OAuth endpoint - check their docs
  const response = await fetch('https://cursor.sh/api/oauth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Cursor token refresh failed: ${error}`)
  }
  
  return await response.json()
}

async function refreshCopilotToken(config, refreshToken) {
  // Microsoft/ Copilot uses Azure AD refresh
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scopes || 'openid profile email',
    }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Copilot token refresh failed: ${error}`)
  }
  
  return await response.json()
}
```

### 4. Create the OAuth Refresh Route

**File: `src/app/api/oauth/[provider]/refresh/route.js`**

```javascript
import { getConnectionForRefresh, updateConnectionTokens, recordRefreshAttempt } from '@/lib/db/repos/connectionsRepo'
import { refreshProviderToken } from '@/lib/oauth/refreshHandlers'
import { getProviderConfig } from '@/lib/oauth/providerConfig'

// Verify admin key for internal endpoint protection
function verifyAdminAuth(request) {
  const adminKey = request.headers.get('Authorization')?.replace('Bearer ', '')
  const expectedKey = process.env.NINEROUTER_ADMIN_KEY
  
  if (!expectedKey) {
    console.warn('NINEROUTER_ADMIN_KEY not set - endpoint is not protected')
    return true // Skip auth if not configured (development only)
  }
  
  if (!adminKey || adminKey !== expectedKey) {
    return false
  }
  
  return true
}

export async function POST(request, { params }) {
  const { provider } = params
  
  // Verify admin key for internal-only endpoint
  if (!verifyAdminAuth(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  // Get userId from header (set by your app)
  const userId = request.headers.get('x-user-id')
  
  if (!userId) {
    return new Response(JSON.stringify({ error: 'x-user-id header required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  try {
    // Get the connection and verify we have a refresh token
    const result = await getConnectionForRefresh(provider, userId)
    
    if (!result) {
      return new Response(JSON.stringify({ error: 'Connection not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    if (result.error === 'No refresh token available') {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    if (result.notExpired) {
      // Token still valid - return current token info
      return new Response(JSON.stringify({
        message: 'Token not yet expired',
        expiresAt: result.connection.expiresAt,
        refreshed: false
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    // Attempt to refresh the token
    const { connection } = result
    
    try {
      const newTokens = await refreshProviderToken(provider, connection.refreshToken, connection)
      
      // Calculate new expiry
      const expiresIn = newTokens.expires_in || newTokens.expiresIn || 3600
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
      
      // Update the connection with new tokens
      await updateConnectionTokens(connection.id, {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token || connection.refreshToken, // Keep old if not provided
        expiresAt,
      })
      
      // Record successful refresh
      await recordRefreshAttempt(connection.id, true)
      
      return new Response(JSON.stringify({
        message: 'Token refreshed successfully',
        expiresAt,
        refreshed: true
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
      
    } catch (refreshError) {
      // Record failed refresh attempt
      await recordRefreshAttempt(connection.id, false, refreshError.message)
      
      // Check for specific OAuth error codes from the response
      const errorMessage = refreshError.message
      const isInvalidGrant = errorMessage.includes('invalid_grant') || 
                             errorMessage.includes('REFRESH_TOKEN_EXPIRED') ||
                             errorMessage.includes('refresh_token is expired')
      const isRefreshNotSupported = errorMessage.includes('REFRESH_NOT_SUPPORTED')
      
      if (isRefreshNotSupported) {
        return new Response(JSON.stringify({
          error: 'Refresh not supported',
          message: errorMessage.split(': ')[1] || 'Provider does not support token refresh',
          code: 'REFRESH_NOT_SUPPORTED'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      
      if (isInvalidGrant) {
        // Refresh token is expired - user needs to re-authenticate
        return new Response(JSON.stringify({
          error: 'Refresh token expired',
          message: 'User needs to re-authenticate',
          code: 'REFRESH_TOKEN_EXPIRED'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      
      throw refreshError
    }
    
  } catch (error) {
    console.error(`Token refresh error for ${provider}:`, error)
    
    return new Response(JSON.stringify({
      error: 'Token refresh failed',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

// GET endpoint to check refresh status without actually refreshing
export async function GET(request, { params }) {
  const { provider } = params
  
  // Verify admin key for internal-only endpoint
  if (!verifyAdminAuth(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  const userId = request.headers.get('x-user-id')
  
  if (!userId) {
    return new Response(JSON.stringify({ error: 'x-user-id header required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  try {
    const result = await getConnectionForRefresh(provider, userId)
    
    if (!result) {
      return new Response(JSON.stringify({ error: 'Connection not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    return new Response(JSON.stringify({
      hasRefreshToken: !!result.connection.refreshToken,
      expiresAt: result.connection.expiresAt,
      lastRefreshAt: result.connection.lastRefreshAt,
      needsRefresh: !result.notExpired && !!result.connection.refreshToken
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
```

### 5. Update Provider Config

**File: `src/lib/oauth/providerConfig.js`**

Add refresh token endpoint configuration:

```javascript
export function getProviderConfig(provider) {
  const configs = {
    'claude-code': {
      clientId: process.env.CLAUDE_CODE_CLIENT_ID,
      clientSecret: process.env.CLAUDE_CODE_CLIENT_SECRET,
      scopes: 'openid profile email',
      // OAuth endpoints
      authUrl: 'https://auth.claude.ai/oauth/authorize',
      tokenUrl: 'https://api.claude.ai/oauth/token',
      refreshUrl: 'https://api.claude.ai/oauth/token', // Same as token URL
    },
    'github': {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      scopes: 'read:user user:email repo',
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      refreshUrl: null, // GitHub doesn't support token refresh by default
    },
    'cursor': {
      clientId: process.env.CURSOR_CLIENT_ID,
      clientSecret: process.env.CURSOR_CLIENT_SECRET,
      scopes: 'openid profile email',
      authUrl: 'https://cursor.sh/oauth/authorize',
      tokenUrl: 'https://cursor.sh/api/oauth/token',
      refreshUrl: 'https://cursor.sh/api/oauth/refresh',
    },
    'copilot': {
      clientId: process.env.COPILOT_CLIENT_ID,
      clientSecret: process.env.COPILOT_CLIENT_SECRET,
      scopes: 'openid profile email offline_access',
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      refreshUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    },
  }
  
  return configs[provider] || null
}
```

## Testing

### Test the refresh endpoint

```bash
# Check refresh status (GET)
curl -X GET http://localhost:20128/api/oauth/claude-code/refresh \\
  -H 'x-user-id: user-123'

# Refresh tokens (POST)
curl -X POST http://localhost:20128/api/oauth/claude-code/refresh \\
  -H 'x-user-id: user-123' \\
  -H 'Content-Type: application/json'
```

### Expected Responses

**Success (token was refreshed):**
```json
{
  message: 'Token refreshed successfully',
  expiresAt: '2024-01-15T12:00:00.000Z',
  refreshed: true
}
```

**Token still valid:**
```json
{
  message: 'Token not yet expired',
  expiresAt: '2024-01-15T12:00:00.000Z',
  refreshed: false
}
```

**No refresh token:**
```json
{
  error: 'No refresh token available'
}
```

**Refresh token expired:**
```json
{
  error: 'Refresh token expired',
  message: 'User needs to re-authenticate',
  code: 'REFRESH_TOKEN_EXPIRED'
}
```

## Integration with binG

The binG `token-refresh.ts` service calls this endpoint:

```typescript
// web/lib/9router/token-refresh.ts

async function refreshTokenWith9Router(
  provider: string,
  refreshToken: string,
  userId: string,
  adminKey: string
): Promise<RefreshResult> {
  const response = await fetch(
    `${baseUrl}/api/oauth/${provider}/refresh`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
        'Authorization': `Bearer ${adminKey}`,
      },
    }
  )
  
  const data = await response.json()
  
  if (!response.ok) {
    return { 
      refreshed: false, 
      error: data.error || data.message || 'Refresh failed' 
    }
  }
  
  return {
    refreshed: true,
    expiresAt: data.expiresAt,
  }
}
```

## Notes

- Most OAuth providers don't issue a new refresh token on each refresh - they typically reuse the same one
- Handle `invalid_grant` errors to detect when the refresh token itself has expired
- Consider adding rate limiting to prevent abuse
- The endpoint should be protected by the admin key or internal network access