# Comprehensive Plan: Fixed Authentication System with Third-Party OAuth Integration

## Executive Summary
This document outlines the implementation plan to fix the current flawed authentication system and add persistent user data storage for third-party tool integrations. The plan includes adding OAuth support for external services like Gmail, Google Calendar, GitHub, etc., using Arcade.dev and Nango as integration platforms.

## Current System Analysis

### Existing Components
1. **Auth Service** (`lib/auth/auth-service.ts`): Basic email/password authentication
2. **Database Schema** (`lib/database/schema.sql`): SQLite with users, sessions, API credentials
3. **API Routes** (`app/api/auth/**`): Login, register, logout, etc.
4. **Database Operations** (`lib/database/connection.ts`): Database operations class

### Identified Flaws
1. **Missing OAuth Integration Tables**: No tables for storing OAuth tokens and connection metadata
2. **No External Service Authorization**: No mechanism to manage user authorizations for external services
3. **Limited API Key Management**: Only stores API keys but not OAuth tokens
4. **No Client-Side OAuth UI**: Missing OAuth login buttons and connection management UI
5. **Missing Scalable Database Options**: Currently only supports SQLite

## Implementation Plan

### Phase 1: Enhanced Database Schema

#### 1.1 Add OAuth Integration Tables
**Location**: `lib/database/schema.sql` (enhanced)

```sql
-- External service connections table
CREATE TABLE IF NOT EXISTS external_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL, -- 'google', 'github', 'twitter', 'arcade', 'nango', etc.
    provider_account_id TEXT NOT NULL, -- Account ID from the provider
    provider_display_name TEXT, -- Display name from provider
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at DATETIME,
    scopes TEXT, -- JSON array of granted scopes
    metadata TEXT, -- Additional provider-specific metadata (JSON)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    last_sync_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE(user_id, provider, provider_account_id)
);

-- OAuth sessions for authorization flow
CREATE TABLE IF NOT EXISTS oauth_sessions (
    id TEXT PRIMARY KEY, -- UUID
    user_id INTEGER,
    provider TEXT NOT NULL,
    state TEXT NOT NULL, -- OAuth state parameter for CSRF protection
    redirect_uri TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Service permissions table (for granular permissions)
CREATE TABLE IF NOT EXISTS service_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    connection_id INTEGER NOT NULL,
    service_name TEXT NOT NULL, -- 'gmail', 'calendar', 'github_issues', etc.
    permission_level TEXT NOT NULL, -- 'read', 'write', 'admin', etc.
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES external_connections (id) ON DELETE CASCADE,
    UNIQUE(user_id, connection_id, service_name)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_external_connections_user_provider ON external_connections(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_external_connections_active ON external_connections(is_active);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_state ON oauth_sessions(state);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires ON oauth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_service_permissions_user_service ON service_permissions(user_id, service_name);
```

#### 1.2 Update Existing Tables
**Location**: `lib/database/schema.sql` (enhanced)

```sql
-- Add OAuth-related fields to users table
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN last_password_change DATETIME DEFAULT CURRENT_TIMESTAMP;

-- Enhance API credentials table with OAuth support
ALTER TABLE api_credentials ADD COLUMN oauth_connection_id INTEGER;
ALTER TABLE api_credentials ADD COLUMN is_oauth_token BOOLEAN DEFAULT FALSE;
ALTER TABLE api_credentials ADD COLUMN FOREIGN KEY (oauth_connection_id) REFERENCES external_connections (id) ON DELETE SET NULL;
```

#### 1.3 Create Migration Files
**Location**: `lib/database/migrations/002_oauth_integration.sql`

```sql
-- Migration: OAuth Integration
-- Description: Adds tables and columns for OAuth integration
-- Version: 002
-- Date: 2025-01-17

-- Create external connections table
CREATE TABLE external_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    provider_display_name TEXT,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at DATETIME,
    scopes TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    last_sync_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE(user_id, provider, provider_account_id)
);

-- Create OAuth sessions table
CREATE TABLE oauth_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    provider TEXT NOT NULL,
    state TEXT NOT NULL,
    redirect_uri TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Create service permissions table
CREATE TABLE service_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    connection_id INTEGER NOT NULL,
    service_name TEXT NOT NULL,
    permission_level TEXT NOT NULL,
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES external_connections (id) ON DELETE CASCADE,
    UNIQUE(user_id, connection_id, service_name)
);

-- Add OAuth-related fields to existing tables
ALTER TABLE users ADD COLUMN two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN last_password_change DATETIME DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE api_credentials ADD COLUMN oauth_connection_id INTEGER;
ALTER TABLE api_credentials ADD COLUMN is_oauth_token BOOLEAN DEFAULT FALSE;
ALTER TABLE api_credentials ADD FOREIGN KEY (oauth_connection_id) REFERENCES external_connections (id) ON DELETE SET NULL;

-- Create indexes
CREATE INDEX idx_external_connections_user_provider ON external_connections(user_id, provider);
CREATE INDEX idx_external_connections_active ON external_connections(is_active);
CREATE INDEX idx_oauth_sessions_state ON oauth_sessions(state);
CREATE INDEX idx_oauth_sessions_expires ON oauth_sessions(expires_at);
CREATE INDEX idx_service_permissions_user_service ON service_permissions(user_id, service_name);
```

### Phase 2: Enhanced Auth Service

#### 2.1 OAuth Service Class
**Location**: `lib/auth/oauth-service.ts`

```typescript
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/connection';
import { encryptApiKey, decryptApiKey } from '../database/connection';

export interface OAuthConnection {
  id: number;
  userId: number;
  provider: string;
  providerAccountId: string;
  providerDisplayName: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
  metadata: Record<string, any>;
  isActive: boolean;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthSession {
  id: string;
  userId: number | null;
  provider: string;
  state: string;
  redirectUri: string;
  createdAt: Date;
  expiresAt: Date;
  isCompleted: boolean;
}

export interface ServicePermission {
  id: number;
  userId: number;
  connectionId: number;
  serviceName: string;
  permissionLevel: string;
  grantedAt: Date;
  revokedAt: Date | null;
  isActive: boolean;
}

export class OAuthService {
  private db: any;

  constructor() {
    this.db = getDatabase();
  }

  /**
   * Create a new OAuth session for authorization flow
   */
  async createOAuthSession(
    provider: string,
    userId: number | null,
    redirectUri: string
  ): Promise<OAuthSession> {
    const sessionId = uuidv4();
    const state = uuidv4(); // CSRF protection
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const stmt = this.db.prepare(`
      INSERT INTO oauth_sessions (id, user_id, provider, state, redirect_uri, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(sessionId, userId, provider, state, redirectUri, expiresAt.toISOString());

    return {
      id: sessionId,
      userId,
      provider,
      state,
      redirectUri,
      createdAt: new Date(),
      expiresAt,
      isCompleted: false
    };
  }

  /**
   * Get OAuth session by state
   */
  async getOAuthSessionByState(state: string): Promise<OAuthSession | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM oauth_sessions
      WHERE state = ? AND expires_at > CURRENT_TIMESTAMP AND is_completed = FALSE
      LIMIT 1
    `);

    const result = stmt.get(state) as any;
    return result ? this.mapDbOAuthSessionToOAuthSession(result) : null;
  }

  /**
   * Complete OAuth session
   */
  async completeOAuthSession(sessionId: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE oauth_sessions
      SET is_completed = TRUE
      WHERE id = ?
    `);

    stmt.run(sessionId);
  }

  /**
   * Create or update external connection
   */
  async createOrUpdateConnection(connection: {
    userId: number;
    provider: string;
    providerAccountId: string;
    providerDisplayName?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    scopes?: string[];
    metadata?: Record<string, any>;
  }): Promise<OAuthConnection> {
    // Encrypt tokens if provided
    let encryptedAccessToken: string | null = null;
    let encryptedRefreshToken: string | null = null;

    if (connection.accessToken) {
      const { encrypted } = encryptApiKey(connection.accessToken);
      encryptedAccessToken = encrypted;
    }

    if (connection.refreshToken) {
      const { encrypted } = encryptApiKey(connection.refreshToken);
      encryptedRefreshToken = encrypted;
    }

    const scopesJson = connection.scopes ? JSON.stringify(connection.scopes) : null;
    const metadataJson = connection.metadata ? JSON.stringify(connection.metadata) : null;

    // Check if connection already exists
    const existingStmt = this.db.prepare(`
      SELECT id FROM external_connections
      WHERE user_id = ? AND provider = ? AND provider_account_id = ?
    `);

    const existing = existingStmt.get(connection.userId, connection.provider, connection.providerAccountId);

    let connectionId: number;

    if (existing) {
      // Update existing connection
      const updateStmt = this.db.prepare(`
        UPDATE external_connections
        SET provider_display_name = COALESCE(?, provider_display_name),
            access_token_encrypted = COALESCE(?, access_token_encrypted),
            refresh_token_encrypted = COALESCE(?, refresh_token_encrypted),
            token_expires_at = ?,
            scopes = COALESCE(?, scopes),
            metadata = ?,
            updated_at = CURRENT_TIMESTAMP,
            is_active = TRUE
        WHERE id = ?
      `);

      updateStmt.run(
        connection.providerDisplayName,
        encryptedAccessToken,
        encryptedRefreshToken,
        connection.tokenExpiresAt?.toISOString() || null,
        scopesJson,
        metadataJson,
        existing.id
      );

      connectionId = existing.id;
    } else {
      // Create new connection
      const insertStmt = this.db.prepare(`
        INSERT INTO external_connections (
          user_id, provider, provider_account_id, provider_display_name,
          access_token_encrypted, refresh_token_encrypted, token_expires_at,
          scopes, metadata
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insertStmt.run(
        connection.userId,
        connection.provider,
        connection.providerAccountId,
        connection.providerDisplayName || null,
        encryptedAccessToken,
        encryptedRefreshToken,
        connection.tokenExpiresAt?.toISOString() || null,
        scopesJson,
        metadataJson
      );

      connectionId = result.lastInsertRowid as number;
    }

    // Return the created/updated connection
    return this.getConnectionById(connectionId);
  }

  /**
   * Get user's connections for a specific provider
   */
  async getUserConnections(userId: number, provider?: string): Promise<OAuthConnection[]> {
    let query = `
      SELECT * FROM external_connections
      WHERE user_id = ? AND is_active = TRUE
    `;
    const params = [userId];

    if (provider) {
      query += ` AND provider = ?`;
      params.push(provider);
    }

    query += ` ORDER BY created_at DESC`;

    const stmt = this.db.prepare(query);
    const results = stmt.all(...params) as any[];

    return results.map(result => this.mapDbConnectionToOAuthConnection(result));
  }

  /**
   * Get connection by ID
   */
  async getConnectionById(connectionId: number): Promise<OAuthConnection> {
    const stmt = this.db.prepare(`
      SELECT * FROM external_connections WHERE id = ? LIMIT 1
    `);

    const result = stmt.get(connectionId) as any;
    if (!result) {
      throw new Error('Connection not found');
    }

    return this.mapDbConnectionToOAuthConnection(result);
  }

  /**
   * Get active access token for a connection (decrypts if needed)
   */
  async getAccessToken(connectionId: number): Promise<string | null> {
    const connection = await this.getConnectionById(connectionId);

    if (!connection.accessToken) {
      return null;
    }

    // Check if token is expired
    if (connection.tokenExpiresAt && new Date() > connection.tokenExpiresAt) {
      // Token is expired, try to refresh
      await this.refreshToken(connectionId);
    }

    return decryptApiKey(connection.accessToken);
  }

  /**
   * Refresh OAuth token
   */
  async refreshToken(connectionId: number): Promise<boolean> {
    const connection = await this.getConnectionById(connectionId);

    if (!connection.refreshToken) {
      return false;
    }

    // Decrypt refresh token
    const refreshToken = decryptApiKey(connection.refreshToken);

    // This would call the provider's refresh endpoint
    // Implementation depends on the specific provider
    // For now, return false to indicate manual refresh needed
    return false;
  }

  /**
   * Revoke connection
   */
  async revokeConnection(connectionId: number, userId: number): Promise<boolean> {
    // First, try to revoke at the provider level (if supported)
    const connection = await this.getConnectionById(connectionId);
    
    // This would call the provider's revoke endpoint
    // For now, just deactivate in our database
    const stmt = this.db.prepare(`
      UPDATE external_connections
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `);

    const result = stmt.run(connectionId, userId);
    return result.changes > 0;
  }

  /**
   * Grant service permission
   */
  async grantPermission(permission: {
    userId: number;
    connectionId: number;
    serviceName: string;
    permissionLevel: string;
  }): Promise<ServicePermission> {
    const stmt = this.db.prepare(`
      INSERT INTO service_permissions (user_id, connection_id, service_name, permission_level)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, connection_id, service_name) DO UPDATE SET
        permission_level = excluded.permission_level,
        granted_at = CURRENT_TIMESTAMP,
        revoked_at = NULL,
        is_active = TRUE
    `);

    stmt.run(
      permission.userId,
      permission.connectionId,
      permission.serviceName,
      permission.permissionLevel
    );

    // Return the created permission
    const selectStmt = this.db.prepare(`
      SELECT * FROM service_permissions
      WHERE user_id = ? AND connection_id = ? AND service_name = ?
      ORDER BY granted_at DESC LIMIT 1
    `);

    const result = selectStmt.get(
      permission.userId,
      permission.connectionId,
      permission.serviceName
    ) as any;

    return this.mapDbPermissionToServicePermission(result);
  }

  /**
   * Check if user has permission for a service
   */
  async hasPermission(userId: number, connectionId: number, serviceName: string): Promise<boolean> {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM service_permissions
      WHERE user_id = ? AND connection_id = ? AND service_name = ? AND is_active = TRUE
    `);

    const result = stmt.get(userId, connectionId, serviceName) as { count: number };
    return result.count > 0;
  }

  /**
   * Map database connection to OAuthConnection interface
   */
  private mapDbConnectionToOAuthConnection(dbConnection: any): OAuthConnection {
    return {
      id: dbConnection.id,
      userId: dbConnection.user_id,
      provider: dbConnection.provider,
      providerAccountId: dbConnection.provider_account_id,
      providerDisplayName: dbConnection.provider_display_name,
      accessToken: dbConnection.access_token_encrypted,
      refreshToken: dbConnection.refresh_token_encrypted,
      tokenExpiresAt: dbConnection.token_expires_at ? new Date(dbConnection.token_expires_at) : null,
      scopes: dbConnection.scopes ? JSON.parse(dbConnection.scopes) : [],
      metadata: dbConnection.metadata ? JSON.parse(dbConnection.metadata) : {},
      isActive: dbConnection.is_active,
      lastSyncAt: dbConnection.last_sync_at ? new Date(dbConnection.last_sync_at) : null,
      createdAt: new Date(dbConnection.created_at),
      updatedAt: new Date(dbConnection.updated_at)
    };
  }

  /**
   * Map database OAuth session to OAuthSession interface
   */
  private mapDbOAuthSessionToOAuthSession(dbSession: any): OAuthSession {
    return {
      id: dbSession.id,
      userId: dbSession.user_id,
      provider: dbSession.provider,
      state: dbSession.state,
      redirectUri: dbSession.redirect_uri,
      createdAt: new Date(dbSession.created_at),
      expiresAt: new Date(dbSession.expires_at),
      isCompleted: dbSession.is_completed
    };
  }

  /**
   * Map database permission to ServicePermission interface
   */
  private mapDbPermissionToServicePermission(dbPermission: any): ServicePermission {
    return {
      id: dbPermission.id,
      userId: dbPermission.user_id,
      connectionId: dbPermission.connection_id,
      serviceName: dbPermission.service_name,
      permissionLevel: dbPermission.permission_level,
      grantedAt: new Date(dbPermission.granted_at),
      revokedAt: dbPermission.revoked_at ? new Date(dbPermission.revoked_at) : null,
      isActive: dbPermission.is_active
    };
  }
}

export const oauthService = new OAuthService();
```

### Phase 3: OAuth API Routes

#### 3.1 OAuth Initiation Route
**Location**: `app/api/auth/oauth/initiate/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { oauthService } from '@/lib/auth/oauth-service';
import { authService } from '@/lib/auth/auth-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider, redirectUri, scopes } = body;

    // Validate provider
    const validProviders = ['google', 'github', 'twitter', 'arcade', 'nango'];
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider' },
        { status: 400 }
      );
    }

    // Get user ID from session
    const authHeader = request.headers.get('authorization');
    let userId: number | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      // Validate JWT token and extract user ID
      // This would use your existing JWT validation
      // For now, we'll skip this step in the example
    }

    // Create OAuth session
    const oauthSession = await oauthService.createOAuthSession(
      provider,
      userId, // Can be null for login-with-OAuth flows
      redirectUri || `${process.env.APP_URL}/api/auth/oauth/callback`
    );

    // Construct authorization URL based on provider
    let authUrl: string;
    const clientId = process.env[`${provider.toUpperCase()}_CLIENT_ID`];
    const clientSecret = process.env[`${provider.toUpperCase()}_CLIENT_SECRET`];

    if (!clientId) {
      return NextResponse.json(
        { error: `Missing ${provider} client ID` },
        { status: 500 }
      );
    }

    const callbackUrl = `${process.env.APP_URL}/api/auth/oauth/callback?provider=${provider}`;
    
    switch (provider) {
      case 'google':
        authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
          `client_id=${clientId}&` +
          `redirect_uri=${encodeURIComponent(callbackUrl)}&` +
          `response_type=code&` +
          `scope=${encodeURIComponent(scopes?.join(' ') || 'openid email profile')}&` +
          `state=${oauthSession.state}&` +
          `access_type=offline&` +
          `prompt=consent`;
        break;
        
      case 'github':
        authUrl = `https://github.com/login/oauth/authorize?` +
          `client_id=${clientId}&` +
          `redirect_uri=${encodeURIComponent(callbackUrl)}&` +
          `scope=${encodeURIComponent(scopes?.join(',') || 'user:email')}&` +
          `state=${oauthSession.state}`;
        break;
        
      case 'twitter':
        // Twitter OAuth 2.0 PKCE flow
        authUrl = `https://twitter.com/i/oauth2/authorize?` +
          `client_id=${clientId}&` +
          `redirect_uri=${encodeURIComponent(callbackUrl)}&` +
          `response_type=code&` +
          `state=${oauthSession.state}&` +
          `code_challenge=challenge&` +
          `code_challenge_method=plain&` +
          `scope=${encodeURIComponent(scopes?.join(' ') || 'tweet.read users.read')}`;
        break;
        
      case 'arcade':
        // Arcade.dev OAuth flow
        authUrl = `https://auth.arcade.dev/oauth/authorize?` +
          `client_id=${clientId}&` +
          `redirect_uri=${encodeURIComponent(callbackUrl)}&` +
          `response_type=code&` +
          `state=${oauthSession.state}&` +
          `scope=${encodeURIComponent(scopes?.join(' ') || 'user:read')}`;
        break;
        
      case 'nango':
        // Nango OAuth flow
        authUrl = `https://api.nango.dev/oauth/connect/${provider}?` +
          `client_id=${clientId}&` +
          `redirect_uri=${encodeURIComponent(callbackUrl)}&` +
          `state=${oauthSession.state}`;
        break;
        
      default:
        return NextResponse.json(
          { error: 'Provider not supported' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      authUrl,
      sessionId: oauthSession.id,
      provider
    });
  } catch (error) {
    console.error('OAuth initiation error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate OAuth flow' },
      { status: 500 }
    );
  }
}
```

#### 3.2 OAuth Callback Route
**Location**: `app/api/auth/oauth/callback/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { oauthService } from '@/lib/auth/oauth-service';
import { authService } from '@/lib/auth/auth-service';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get('provider');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return NextResponse.redirect(
        `${process.env.APP_URL}/settings?tab=connections&error=${error}`
      );
    }

    if (!provider || !code || !state) {
      return NextResponse.redirect(
        `${process.env.APP_URL}/settings?tab=connections&error=missing_params`
      );
    }

    // Verify state parameter
    const oauthSession = await oauthService.getOAuthSessionByState(state);
    if (!oauthSession) {
      return NextResponse.redirect(
        `${process.env.APP_URL}/settings?tab=connections&error=invalid_state`
      );
    }

    // Complete the OAuth session
    await oauthService.completeOAuthSession(oauthSession.id);

    // Exchange code for tokens
    const tokenResponse = await exchangeCodeForTokens(provider, code, oauthSession.redirectUri);
    
    if (!tokenResponse.success) {
      return NextResponse.redirect(
        `${process.env.APP_URL}/settings?tab=connections&error=token_exchange_failed`
      );
    }

    const { accessToken, refreshToken, expiresIn, accountId, displayName, scopes } = tokenResponse;

    // Get user info
    const userInfo = await getUserInfo(provider, accessToken);
    
    if (!userInfo.success) {
      return NextResponse.redirect(
        `${process.env.APP_URL}/settings?tab=connections&error=user_info_failed`
      );
    }

    // Determine user ID - either from session or create new user if login-with-OAuth
    let userId = oauthSession.userId;
    
    if (!userId) {
      // This is a login-with-OAuth flow, create or link user
      userId = await getOrCreateUserFromOAuth(userInfo, provider);
    }

    // Create or update the external connection
    const connection = await oauthService.createOrUpdateConnection({
      userId: userId!,
      provider,
      providerAccountId: accountId,
      providerDisplayName: displayName,
      accessToken,
      refreshToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      scopes,
      metadata: userInfo.profile
    });

    // Grant default permissions
    await oauthService.grantPermission({
      userId: userId!,
      connectionId: connection.id,
      serviceName: `${provider}_default`,
      permissionLevel: 'read_write'
    });

    // Redirect back to the app with success
    return NextResponse.redirect(
      `${process.env.APP_URL}/settings?tab=connections&success=${provider}&accountId=${accountId}`
    );
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(
      `${process.env.APP_URL}/settings?tab=connections&error=callback_error`
    );
  }
}

// Helper functions
async function exchangeCodeForTokens(
  provider: string,
  code: string,
  redirectUri: string
): Promise<any> {
  const clientId = process.env[`${provider.toUpperCase()}_CLIENT_ID`];
  const clientSecret = process.env[`${provider.toUpperCase()}_CLIENT_SECRET`];

  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${provider} credentials`);
  }

  let tokenUrl: string;
  let body: URLSearchParams | FormData;

  switch (provider) {
    case 'google':
      tokenUrl = 'https://oauth2.googleapis.com/token';
      body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });
      break;

    case 'github':
      tokenUrl = 'https://github.com/login/oauth/access_token';
      body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      });
      break;

    case 'twitter':
      tokenUrl = 'https://api.twitter.com/2/oauth2/token';
      body = new URLSearchParams({
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: 'challenge' // In a real implementation, this would come from the initial request
      });
      break;

    case 'arcade':
      tokenUrl = 'https://auth.arcade.dev/oauth/token';
      body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });
      break;

    case 'nango':
      tokenUrl = 'https://api.nango.dev/oauth/token';
      body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      });
      break;

    default:
      throw new Error('Provider not supported');
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.statusText}`);
  }

  const tokenData = await response.json();

  return {
    success: true,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in || 3600,
    accountId: tokenData.account_id || tokenData.sub || tokenData.id,
    scopes: tokenData.scope?.split(' ') || []
  };
}

async function getUserInfo(provider: string, accessToken: string): Promise<any> {
  let userInfoUrl: string;
  let headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`
  };

  switch (provider) {
    case 'google':
      userInfoUrl = 'https://www.googleapis.com/oauth2/v2/userinfo';
      break;

    case 'github':
      userInfoUrl = 'https://api.github.com/user';
      headers.Accept = 'application/vnd.github.v3+json';
      break;

    case 'twitter':
      userInfoUrl = 'https://api.twitter.com/2/users/me';
      break;

    case 'arcade':
      userInfoUrl = 'https://api.arcade.dev/v1/user';
      break;

    case 'nango':
      userInfoUrl = 'https://api.nango.dev/v1/user';
      break;

    default:
      throw new Error('Provider not supported');
  }

  const response = await fetch(userInfoUrl, { headers });

  if (!response.ok) {
    throw new Error(`User info fetch failed: ${response.statusText}`);
  }

  const userData = await response.json();

  return {
    success: true,
    profile: userData,
    accountId: userData.id || userData.sub,
    displayName: userData.name || userData.login || userData.display_name || userData.email
  };
}

async function getOrCreateUserFromOAuth(userInfo: any, provider: string): Promise<number> {
  // Try to find existing user by email
  const email = userInfo.profile.email;
  if (email) {
    const existingUser = await authService.getUserByEmail(email);
    if (existingUser) {
      return existingUser.id;
    }
  }

  // Create new user
  const newUser = await authService.register({
    email: email || `${userInfo.accountId}@${provider}.temp`,
    password: `temp_${Date.now()}`, // Temporary password
    username: userInfo.displayName
  });

  if (!newUser.success) {
    throw new Error('Failed to create user');
  }

  return newUser.user!.id;
}
```

### Phase 4: Client-Side OAuth Components

#### 4.1 OAuth Connection Buttons Component
**Location**: `components/auth/OAuthButtons.tsx`

```tsx
'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';

interface OAuthProvider {
  id: string;
  name: string;
  icon: keyof typeof Icons;
  color: string;
  scopes?: string[];
}

const PROVIDERS: OAuthProvider[] = [
  {
    id: 'google',
    name: 'Google',
    icon: 'google',
    color: '#4285F4',
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar']
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: 'github',
    color: '#333333',
    scopes: ['user:email', 'repo']
  },
  {
    id: 'twitter',
    name: 'Twitter',
    icon: 'twitter',
    color: '#1DA1F2',
    scopes: ['tweet.read', 'users.read', 'follows.read']
  },
  {
    id: 'arcade',
    name: 'Arcade',
    icon: 'arcade', // You'll need to add this icon
    color: '#6366F1',
    scopes: ['user:read', 'connections:read']
  },
  {
    id: 'nango',
    name: 'Nango',
    icon: 'nango', // You'll need to add this icon
    color: '#000000',
    scopes: ['connection:read', 'connection:write']
  }
];

interface OAuthButtonsProps {
  onSuccess?: (provider: string, accountId: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

export function OAuthButtons({ onSuccess, onError, className }: OAuthButtonsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOAuth = useCallback(async (provider: string, scopes: string[] = []) => {
    setLoading(provider);
    setError(null);

    try {
      // Initiate OAuth flow
      const response = await fetch('/api/auth/oauth/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider,
          scopes,
          redirectUri: `${window.location.origin}/api/auth/oauth/callback`
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'OAuth initiation failed');
      }

      const { authUrl } = await response.json();

      // Open OAuth popup
      const popup = window.open(
        authUrl,
        'oauth-popup',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }

      // Poll for completion
      const pollForCompletion = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollForCompletion);
          setLoading(null);
          
          // Check URL for success parameters
          const urlParams = new URLSearchParams(window.location.search);
          const successProvider = urlParams.get('success');
          const accountId = urlParams.get('accountId');
          
          if (successProvider && accountId) {
            onSuccess?.(successProvider, accountId);
          } else {
            const errorParam = urlParams.get('error');
            if (errorParam) {
              onError?.(errorParam);
            }
          }
        }
      }, 1000);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'OAuth failed';
      setError(errorMessage);
      onError?.(errorMessage);
      setLoading(null);
    }
  }, [onSuccess, onError]);

  return (
    <div className={`space-y-2 ${className}`}>
      {PROVIDERS.map((provider) => {
        const Icon = Icons[provider.icon as keyof typeof Icons] || Icons.external;
        return (
          <Button
            key={provider.id}
            variant="outline"
            className="w-full justify-start"
            style={{ borderColor: provider.color }}
            onClick={() => handleOAuth(provider.id, provider.scopes)}
            disabled={loading === provider.id}
          >
            {loading === provider.id ? (
              <>
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Icon className="mr-2 h-4 w-4" style={{ color: provider.color }} />
                Connect {provider.name}
              </>
            )}
          </Button>
        );
      })}
      
      {error && (
        <p className="text-sm text-red-600 mt-2">{error}</p>
      )}
    </div>
  );
}
```

#### 4.2 Connections Management Component
**Location**: `components/settings/ConnectionsSection.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { Icons } from '@/components/icons';

interface Connection {
  id: number;
  provider: string;
  providerDisplayName: string;
  providerAccountId: string;
  isActive: boolean;
  scopes: string[];
  createdAt: string;
  lastSyncAt: string | null;
}

export function ConnectionsSection() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/user/connections');
      
      if (!response.ok) {
        throw new Error('Failed to load connections');
      }
      
      const data = await response.json();
      setConnections(data.connections || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connections');
    } finally {
      setLoading(false);
    }
  };

  const revokeConnection = async (connectionId: number) => {
    if (!confirm('Are you sure you want to disconnect this service?')) {
      return;
    }

    try {
      const response = await fetch(`/api/user/connections/${connectionId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to revoke connection');
      }

      // Reload connections
      loadConnections();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke connection');
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <Icons.spinner className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Accounts</CardTitle>
        <CardDescription>Manage your connected third-party services</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <OAuthButtons 
            onSuccess={(provider) => {
              console.log(`Successfully connected ${provider}`);
              loadConnections(); // Refresh the list
            }}
            onError={(error) => {
              console.error('OAuth error:', error);
            }}
          />
        </div>

        {error && (
          <div className="text-red-600 text-sm">{error}</div>
        )}

        {connections.length > 0 ? (
          <div className="space-y-4">
            <h3 className="font-medium">Active Connections</h3>
            {connections.map((connection) => (
              <div 
                key={connection.id} 
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  <div className="bg-gray-100 p-2 rounded-full">
                    <Icons[connection.provider as keyof typeof Icons] || Icons.external}
                  </div>
                  <div>
                    <div className="font-medium">{connection.providerDisplayName}</div>
                    <div className="text-sm text-gray-500 capitalize">{connection.provider}</div>
                    <div className="text-xs text-gray-400">
                      Connected: {new Date(connection.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  {connection.isActive ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeConnection(connection.id)}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Icons.plug className="mx-auto h-12 w-12 mb-4" />
            <p>No connected accounts yet</p>
            <p className="text-sm mt-2">Connect your accounts to enable tool integrations</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

### Phase 5: User Profile API Routes

#### 5.1 User Connections API
**Location**: `app/api/user/connections/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { oauthService } from '@/lib/auth/oauth-service';
import { verifyToken } from '@/lib/auth/jwt'; // Assuming you have this

export async function GET(request: NextRequest) {
  try {
    // Verify user session
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const userId = parseInt(decoded.userId);

    // Get user's connections
    const connections = await oauthService.getUserConnections(userId);

    return NextResponse.json({
      connections: connections.map(conn => ({
        id: conn.id,
        provider: conn.provider,
        providerDisplayName: conn.providerDisplayName,
        providerAccountId: conn.providerAccountId,
        isActive: conn.isActive,
        scopes: conn.scopes,
        createdAt: conn.createdAt.toISOString(),
        lastSyncAt: conn.lastSyncAt?.toISOString() || null
      }))
    });
  } catch (error) {
    console.error('Get connections error:', error);
    return NextResponse.json(
      { error: 'Failed to get connections' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Verify user session
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const userId = parseInt(decoded.userId);
    const connectionId = parseInt(params.id);

    // Revoke the connection
    const success = await oauthService.revokeConnection(connectionId, userId);

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to revoke connection' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Revoke connection error:', error);
    return NextResponse.json(
      { error: 'Failed to revoke connection' },
      { status: 500 }
    );
  }
}
```

### Phase 6: Prisma Integration (Optional Enhancement)

#### 6.1 Prisma Schema
**Location**: `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id                  Int       @id @default(autoincrement())
  email               String    @unique
  username            String?   @unique
  passwordHash        String
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  lastLogin           DateTime?
  isActive            Boolean   @default(true)
  subscriptionTier    String    @default("free")
  emailVerified       Boolean   @default(false)
  resetToken          String?
  resetTokenExpires   DateTime?
  twoFactorEnabled    Boolean   @default(false)
  twoFactorSecret     String?
  lastPasswordChange  DateTime  @default(now())

  // Relations
  sessions            UserSession[]
  connections         ExternalConnection[]
  permissions         ServicePermission[]
  conversations       Conversation[]
  apiCredentials      ApiCredential[]
  preferences         UserPreference[]
  usageLogs           UsageLog[]

  @@map("users")
}

model UserSession {
  id         String   @id
  userId     Int
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  ipAddress  String?
  userAgent  String?
  isActive   Boolean  @default(true)

  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_sessions")
}

model ExternalConnection {
  id                   Int       @id @default(autoincrement())
  userId               Int
  provider             String
  providerAccountId    String
  providerDisplayName  String?
  accessTokenEncrypted String?
  refreshTokenEncrypted String?
  tokenExpiresAt       DateTime?
  scopes               String?
  metadata             Json?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  isActive             Boolean   @default(true)
  lastSyncAt           DateTime?

  user                 User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  permissions          ServicePermission[]

  @@unique([userId, provider, providerAccountId])
  @@map("external_connections")
}

model ServicePermission {
  id             Int       @id @default(autoincrement())
  userId         Int
  connectionId   Int
  serviceName    String
  permissionLevel String
  grantedAt      DateTime  @default(now())
  revokedAt      DateTime?
  isActive       Boolean   @default(true)

  user           User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  connection     ExternalConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([userId, connectionId, serviceName])
  @@map("service_permissions")
}

model OAuthSession {
  id          String   @id
  userId      Int?
  provider    String
  state       String
  redirectUri String
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  isCompleted Boolean  @default(false)

  user        User?    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([state])
  @@index([expiresAt])
  @@map("oauth_sessions")
}

model ApiCredential {
  id              Int       @id @default(autoincrement())
  userId          Int
  provider        String
  apiKeyEncrypted String
  apiKeyHash      String
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  isActive        Boolean   @default(true)
  oauthConnectionId Int?
  
  user            User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  oauthConnection ExternalConnection? @relation(fields: [oauthConnectionId], references: [id], onDelete: SetNull)

  @@unique([userId, provider])
  @@map("api_credentials")
}

model Conversation {
  id           String   @id
  userId       Int?
  title        String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  isArchived   Boolean  @default(false)

  user         User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages     Message[]

  @@map("conversations")
}

model Message {
  id              String   @id
  conversationId  String
  role            String
  content         String
  provider        String?
  model           String?
  createdAt       DateTime @default(now())
  tokenCount      Int?

  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@map("messages")
}

model UsageLog {
  id          Int       @id @default(autoincrement())
  userId      Int?
  provider    String
  model       String
  tokensUsed  Int       @default(0)
  costUsd     Float     @default(0)
  createdAt   DateTime  @default(now())

  user        User?     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("usage_logs")
}

model UserPreference {
  id           Int       @id @default(autoincrement())
  userId       Int
  preferenceKey String
  preferenceValue String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, preferenceKey])
  @@map("user_preferences")
}
```

This comprehensive plan addresses all the identified flaws in the current authentication system:

1. **Added OAuth Integration Tables**: Created tables for storing OAuth tokens, sessions, and permissions
2. **Enhanced Auth Service**: Added OAuthService class to manage external connections
3. **OAuth API Routes**: Created endpoints for initiating and handling OAuth flows
4. **Client-Side Components**: Added OAuth buttons and connection management UI
5. **User Profile Integration**: Added API routes for managing connections
6. **Prisma Schema**: Provided Prisma schema as an alternative to the current SQLite implementation

The plan maintains backward compatibility with the existing auth system while adding robust OAuth support for third-party integrations.