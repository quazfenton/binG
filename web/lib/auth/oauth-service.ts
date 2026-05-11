import { randomUUID, createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { getDatabase } from '../database/connection';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV per NIST SP 800-38D (standard for GCM)
const AUTH_TAG_LENGTH = 16;

/**
 * PKCE (Proof Key for Code Exchange) Implementation
 * Prevents authorization code interception attacks
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 */

/**
 * Generate PKCE code verifier (43-128 characters)
 * Uses cryptographically secure random bytes
 */
export function generateCodeVerifier(): string {
  // Generate 32 bytes (256 bits) of random data
  const verifier = randomBytes(32).toString('base64url');
  // Ensure it's between 43-128 characters (RFC 7636 requirement)
  return verifier.slice(0, 128);
}

/**
 * Generate PKCE code challenge from verifier
 * Uses SHA-256 hash (S256 method - recommended)
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Verify PKCE code challenge matches verifier
 */
export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  const computedChallenge = generateCodeChallenge(verifier);
  return computedChallenge === challenge;
}

function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required');
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${key.length} hex characters`);
  }
  return buf;
}

function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(data: string): string {
  const parts = data.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format: expected iv:authTag:ciphertext');
  }
  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export interface OAuthConnection {
  id: number;
  userId: string;
  provider: string;
  providerAccountId: string;
  providerDisplayName: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthSession {
  id: string;
  userId: string | null;
  provider: string;
  state: string;
  nonce: string | null;
  redirectUri: string | null;
  expiresAt: Date;
  isCompleted: boolean;
  // PKCE parameters
  codeVerifier?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
}

export class OAuthService {
  private db: any;
  private schemaEnsured = false;

  constructor() {
    this.db = getDatabase();
    if (this.db) {
      this.ensureSchema();
    } else {
      console.warn('[OAuthService] Database not ready, schema will be ensured on first use');
    }
  }

  private ensureSchema(): void {
    if (this.schemaEnsured) return;
    if (!this.db) return;
    
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS external_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
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
          last_accessed_at DATETIME,
          refresh_attempts INTEGER DEFAULT 0,
          UNIQUE(user_id, provider, provider_account_id)
        );

        CREATE TABLE IF NOT EXISTS oauth_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          provider TEXT NOT NULL,
          state TEXT NOT NULL,
          nonce TEXT,
          redirect_uri TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          is_completed BOOLEAN DEFAULT FALSE,
          completed_at DATETIME,
          ip_address TEXT,
          user_agent TEXT,
          -- PKCE parameters (RFC 7636)
          code_verifier TEXT,
          code_challenge TEXT,
          code_challenge_method TEXT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_sessions_state ON oauth_sessions(state);
        CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires ON oauth_sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_ext_conn_user_provider ON external_connections(user_id, provider);
        CREATE INDEX IF NOT EXISTS idx_ext_conn_active ON external_connections(is_active);
      `);
      this.schemaEnsured = true;
    } catch (error) {
      console.error('[OAuthService] Failed to ensure OAuth schema:', error);
    }
  }

  /**
   * Get authorization URL with PKCE support
   * Use this to generate the OAuth authorization URL
   */
  getAuthorizationUrl(params: {
    provider: string;
    providerAuthUrl: string;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string;
    codeChallengeMethod?: string;
    state: string;
    nonce?: string;
  }): string {
    const url = new URL(params.providerAuthUrl);
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', params.scopes.join(' '));
    url.searchParams.set('state', params.state);
    
    // Add PKCE parameters if available
    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge);
      if (params.codeChallengeMethod) {
        url.searchParams.set('code_challenge_method', params.codeChallengeMethod);
      }
    }
    
    // Add nonce for OIDC
    if (params.nonce) {
      url.searchParams.set('nonce', params.nonce);
    }
    
    return url.toString();
  }

  async createOAuthSession(params: {
    userId: string;
    provider: string;
    redirectUri?: string;
    usePkce?: boolean; // Enable PKCE by default for public clients
  }): Promise<OAuthSession> {
    // HIGH-9 fix: Validate redirect URI against allowlist
    if (params.redirectUri) {
      const allowed = this.isRedirectUriAllowed(params.redirectUri);
      if (!allowed) {
        throw new Error(`Redirect URI not allowed: ${params.redirectUri}. Must match OAUTH_REDIRECT_URI_ALLOWLIST or app origin.`);
      }
    }
    // Ensure database is available
    if (!this.db) {
      console.warn("[OAuthService] Database not ready");
      return; // or throw error depending on method
    }
    const id = randomUUID();
    const state = randomUUID();
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    
    // Generate PKCE parameters if enabled
    const usePkce = params.usePkce ?? true;
    const codeVerifier = usePkce ? generateCodeVerifier() : undefined;
    const codeChallenge = usePkce && codeVerifier ? generateCodeChallenge(codeVerifier) : undefined;

    const stmt = this.db.prepare(`
      INSERT INTO oauth_sessions (
        id, user_id, provider, state, nonce, redirect_uri, expires_at,
        code_verifier, code_challenge, code_challenge_method
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id, 
      params.userId, 
      params.provider, 
      state, 
      nonce, 
      params.redirectUri ?? null, 
      expiresAt.toISOString(),
      codeVerifier ?? null,
      codeChallenge ?? null,
      usePkce ? 'S256' : null
    );

    return { 
      id, 
      userId: params.userId, 
      provider: params.provider, 
      state, 
      nonce, 
      redirectUri: params.redirectUri ?? null, 
      expiresAt, 
      isCompleted: false,
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: usePkce ? 'S256' : undefined,
    };
  }

  async getOAuthSessionByState(state: string): Promise<OAuthSession | null> {
    // Ensure database is available
    if (!this.db) {
      console.warn("[OAuthService] Database not ready");
      return; // or throw error depending on method
    }
    const stmt = this.db.prepare(`
      SELECT * FROM oauth_sessions 
      WHERE state = ? AND is_completed = FALSE AND datetime(expires_at) > datetime('now')
    `);
    const row = stmt.get(state) as any;
    if (!row) return null;
    return {
      id: row.id, 
      userId: row.user_id, 
      provider: row.provider,
      state: row.state, 
      nonce: row.nonce, 
      redirectUri: row.redirect_uri,
      expiresAt: new Date(row.expires_at), 
      isCompleted: !!row.is_completed,
      codeVerifier: row.code_verifier,
      codeChallenge: row.code_challenge,
      codeChallengeMethod: row.code_challenge_method as 'S256' | 'plain' | undefined,
    };
  }

  async completeOAuthSession(state: string): Promise<void> {
    // Ensure database is available
    if (!this.db) {
      console.warn("[OAuthService] Database not ready");
      return; // or throw error depending on method
    }
    const stmt = this.db.prepare(`
      UPDATE oauth_sessions SET is_completed = TRUE, completed_at = datetime('now') WHERE state = ?
    `);
    stmt.run(state);
  }

  /**
   * Exchange authorization code for tokens with PKCE verification
   * 
   * @param state - OAuth state parameter
   * @param code - Authorization code from provider
   * @param tokenEndpoint - Provider's token endpoint URL
   * @param clientId - OAuth client ID
   * @param redirectUri - Redirect URI used in authorization request
   * @returns Object with access_token and optionally refresh_token
   */
  /**
   * HIGH-9 fix: Validate redirect URI against allowlist to prevent open redirect attacks.
   * Checks OAUTH_REDIRECT_URI_ALLOWLIST env var (comma-separated) or falls back to
   * requiring the URI to match the app's origin.
   */
  isRedirectUriAllowed(redirectUri: string): boolean {
    try {
      const url = new URL(redirectUri);
      
      // Check explicit allowlist from env
      const allowlist = process.env.OAUTH_REDIRECT_URI_ALLOWLIST
        ?.split(',').map(s => s.trim()).filter(Boolean) || [];
      
      if (allowlist.length > 0) {
        return allowlist.some(allowed => {
          try {
            const allowedUrl = new URL(allowed);
            return url.origin === allowedUrl.origin && url.pathname.startsWith(allowedUrl.pathname);
          } catch {
            // Invalid allowlist entry — skip
            return false;
          }
        });
      }
      
      // No allowlist configured — only allow same-origin redirects
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (appUrl) {
        const appOrigin = new URL(appUrl).origin;
        return url.origin === appOrigin;
      }
      
      // No app URL configured — allow localhost in development, reject in production
      if (process.env.NODE_ENV !== 'production') {
        return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      }
      return false;
    } catch {
      // Invalid URL format — reject
      return false;
    }
  }

  async exchangeCodeForToken(params: {
    state: string;
    code: string;
    tokenEndpoint: string;
    clientId: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    // Get the OAuth session
    const session = await this.getOAuthSessionByState(params.state);
    if (!session) {
      throw new Error('Invalid or expired OAuth session');
    }

    // Verify PKCE code challenge if PKCE was used
    if (session.codeChallenge) {
      if (!session.codeVerifier) {
        throw new Error('Code verifier missing for PKCE session');
      }
      
      // Verify the code challenge matches
      const isValid = verifyCodeChallenge(session.codeVerifier, session.codeChallenge);
      if (!isValid) {
        throw new Error('PKCE code verification failed');
      }
    }

    // Exchange code for tokens
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
    });

    // Add code_verifier if PKCE was used
    if (session.codeVerifier) {
      tokenParams.set('code_verifier', session.codeVerifier);
    }

    const response = await fetch(params.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Token exchange failed: ${errorData.error_description || response.statusText}`);
    }

    const tokenData = await response.json();

    // Mark session as completed
    await this.completeOAuthSession(params.state);

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    };
  }

  async saveConnection(params: {
    userId: string;
    provider: string;
    providerAccountId: string;
    providerDisplayName?: string;
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    scopes?: string[];
  }): Promise<OAuthConnection> {
    // Ensure database is available
    if (!this.db) {
      console.warn("[OAuthService] Database not ready");
      return; // or throw error depending on method
    }
    // Only encrypt tokens if they are not empty strings
    // For Arcade/Nango connections, we store empty strings since they manage tokens internally
    const accessTokenEnc = params.accessToken ? encrypt(params.accessToken) : null;
    const refreshTokenEnc = params.refreshToken && params.refreshToken.trim() !== '' ? encrypt(params.refreshToken) : null;
    const expiresAt = params.expiresIn
      ? new Date(Date.now() + params.expiresIn * 1000).toISOString()
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO external_connections (user_id, provider, provider_account_id, provider_display_name,
        access_token_encrypted, refresh_token_encrypted, token_expires_at, scopes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider, provider_account_id) DO UPDATE SET
        access_token_encrypted = excluded.access_token_encrypted,
        refresh_token_encrypted = COALESCE(excluded.refresh_token_encrypted, external_connections.refresh_token_encrypted),
        token_expires_at = excluded.token_expires_at,
        scopes = excluded.scopes,
        is_active = TRUE,
        updated_at = datetime('now'),
        refresh_attempts = 0
    `);
    stmt.run(
      params.userId, params.provider, params.providerAccountId,
      params.providerDisplayName ?? null, accessTokenEnc, refreshTokenEnc,
      expiresAt, params.scopes ? JSON.stringify(params.scopes) : null,
    );

    // Fetch the saved/updated connection deterministically
    const connections = await this.getUserConnections(params.userId, params.provider);
    const connection = connections[0];
    if (!connection) {
      throw new Error(`Failed to retrieve saved connection for provider ${params.provider}`);
    }
    return connection;
  }

  async getUserConnections(userId: string, provider?: string): Promise<OAuthConnection[]> {
    // Ensure database is available
    if (!this.db) {
      console.warn("[OAuthService] Database not ready");
      return; // or throw error depending on method
    }
    const sql = provider
      ? `SELECT * FROM external_connections WHERE user_id = ? AND provider = ? AND is_active = TRUE`
      : `SELECT * FROM external_connections WHERE user_id = ? AND is_active = TRUE`;
    const stmt = this.db.prepare(sql);
    const rows = (provider ? stmt.all(userId, provider) : stmt.all(userId)) as any[];
    return rows.map(r => ({
      id: r.id, userId: r.user_id, provider: r.provider,
      providerAccountId: r.provider_account_id,
      providerDisplayName: r.provider_display_name,
      tokenExpiresAt: r.token_expires_at ? new Date(r.token_expires_at) : null,
      scopes: r.scopes ? JSON.parse(r.scopes) : [],
      isActive: !!r.is_active,
      createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at),
    }));
  }

  async getDecryptedToken(connectionId: number, userId: string): Promise<{ accessToken: string; refreshToken?: string } | null> {
    // Ensure database is available
    if (!this.db) {
      console.warn("[OAuthService] Database not ready");
      return; // or throw error depending on method
    }
    const stmt = this.db.prepare(`
      SELECT access_token_encrypted, refresh_token_encrypted FROM external_connections
      WHERE id = ? AND user_id = ? AND is_active = TRUE
    `);
    const row = stmt.get(connectionId, userId) as any;
    if (!row) return null;

    this.db.prepare(`UPDATE external_connections SET last_accessed_at = datetime('now') WHERE id = ?`).run(connectionId);

    // Handle cases where tokens might be null (for Arcade/Nango connections)
    return {
      accessToken: row.access_token_encrypted ? decrypt(row.access_token_encrypted) : '',
      refreshToken: row.refresh_token_encrypted ? decrypt(row.refresh_token_encrypted) : undefined,
    };
  }

  async revokeConnection(connectionId: number, userId: string): Promise<boolean> {
    // Ensure database is available
    if (!this.db) {
      console.warn("[OAuthService] Database not ready");
      return; // or throw error depending on method
    }
    const stmt = this.db.prepare(`
      UPDATE external_connections SET is_active = FALSE, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `);
    const result = stmt.run(connectionId, userId);
    return result.changes > 0;
  }
}

export const oauthService = new OAuthService();
