import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getDatabase } from '../database/connection';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required');
  return Buffer.from(key, 'hex');
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
  const [ivHex, authTagHex, encrypted] = data.split(':');
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
  userId: number;
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
  userId: number | null;
  provider: string;
  state: string;
  nonce: string | null;
  redirectUri: string | null;
  expiresAt: Date;
  isCompleted: boolean;
}

export class OAuthService {
  private db: any;

  constructor() {
    this.db = getDatabase();
  }

  async createOAuthSession(params: {
    userId: number;
    provider: string;
    redirectUri?: string;
  }): Promise<OAuthSession> {
    const id = randomUUID();
    const state = randomUUID();
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    const stmt = this.db.prepare(`
      INSERT INTO oauth_sessions (id, user_id, provider, state, nonce, redirect_uri, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, params.userId, params.provider, state, nonce, params.redirectUri ?? null, expiresAt.toISOString());

    return { id, userId: params.userId, provider: params.provider, state, nonce, redirectUri: params.redirectUri ?? null, expiresAt, isCompleted: false };
  }

  async getOAuthSessionByState(state: string): Promise<OAuthSession | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM oauth_sessions WHERE state = ? AND is_completed = FALSE AND expires_at > datetime('now')
    `);
    const row = stmt.get(state) as any;
    if (!row) return null;
    return {
      id: row.id, userId: row.user_id, provider: row.provider,
      state: row.state, nonce: row.nonce, redirectUri: row.redirect_uri,
      expiresAt: new Date(row.expires_at), isCompleted: !!row.is_completed,
    };
  }

  async completeOAuthSession(state: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE oauth_sessions SET is_completed = TRUE, completed_at = datetime('now') WHERE state = ?
    `);
    stmt.run(state);
  }

  async saveConnection(params: {
    userId: number;
    provider: string;
    providerAccountId: string;
    providerDisplayName?: string;
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    scopes?: string[];
  }): Promise<OAuthConnection> {
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

    return this.getUserConnections(params.userId, params.provider).then(c => c[0]);
  }

  async getUserConnections(userId: number, provider?: string): Promise<OAuthConnection[]> {
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

  async getDecryptedToken(connectionId: number, userId: number): Promise<{ accessToken: string; refreshToken?: string } | null> {
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

  async revokeConnection(connectionId: number, userId: number): Promise<boolean> {
    const stmt = this.db.prepare(`
      UPDATE external_connections SET is_active = FALSE, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `);
    const result = stmt.run(connectionId, userId);
    return result.changes > 0;
  }
}

export const oauthService = new OAuthService();
