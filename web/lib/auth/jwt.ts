import { NextRequest } from 'next/server';
import { createLogger } from '../utils/logger';

const logger = createLogger('Auth:JWT');

// Check if we're in a build/Edge environment - ONLY use build-specific signals
// CRITICAL: SKIP_DB_INIT should NOT be used here as it may be set in runtime,
// which would enable token forgery with the known fallback secret
function shouldSkipValidation(): boolean {
  const env: any = typeof process !== 'undefined' ? process.env : {};
  return env.NEXT_BUILD === 'true' ||
         env.NEXT_BUILD === '1' ||
         env.NEXT_PHASE === 'build' ||
         env.NEXT_PHASE === 'export';
}

// Lazy-loaded JWT module and secret - only initialized at runtime
// CRITICAL: These must be at module scope for use in functions
let jwtModule: any = null;
let jwtSecret: string | null = null;

/**
 * Get JWT module (lazy-loaded to avoid bundling issues)
 */
function getJwtModule() {
  if (!jwtModule) {
    jwtModule = require('jsonwebtoken');
  }
  return jwtModule;
}

/**
 * Get JWT secret (lazy-loaded to avoid build failures)
 */
export function getJwtSecret(): string {
  if (jwtSecret) return jwtSecret;

  const env: any = typeof process !== 'undefined' ? process.env : {};
  const JWT_SECRET = env.JWT_SECRET;

  // Skip validation during build only - use random secret per process to prevent token forgery
  // CRITICAL: Never use a fixed fallback secret - generate one per process
  if (shouldSkipValidation()) {
    logger.warn('[JWT] Skipping JWT_SECRET validation during build');
    // Use random secret per process - cannot be predicted or forged
    jwtSecret = require('crypto').randomBytes(32).toString('hex');
    return jwtSecret;
  }

  // Validate JWT_SECRET is set in production
  if (env.NODE_ENV === 'production' && !JWT_SECRET) {
    logger.error('CRITICAL: JWT_SECRET is not configured in production!');
    throw new Error('JWT_SECRET is required in production environment');
  }

  // Validate JWT_SECRET format if provided
  if (JWT_SECRET && JWT_SECRET.length < 32) {
    logger.error('CRITICAL: JWT_SECRET must be at least 32 characters for security');
    throw new Error('JWT_SECRET must be at least 32 characters (256 bits)');
  }

  // Development fallback with prominent warning (only if not in production)
  if (!JWT_SECRET) {
    if (env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET is required in production environment');
    }
    logger.warn('⚠️  WARNING: JWT_SECRET not configured. Using random development key. DO NOT USE IN PRODUCTION.');
    logger.warn('Generate a secure key: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    jwtSecret = require('crypto').randomBytes(32).toString('hex');
    return jwtSecret;
  }
  
  jwtSecret = JWT_SECRET;
  return jwtSecret;
}

// Token blacklist for immediate revocation - lazy initialized
let tokenBlacklist: Map<string, number> | null = null;

function getTokenBlacklist(): Map<string, number> {
  if (!tokenBlacklist) {
    tokenBlacklist = new Map<string, number>();
    
    // Cleanup expired blacklist entries every 5 minutes
    setInterval(() => {
      if (!tokenBlacklist) return;
      const now = Date.now();
      for (const [jti, expiresAt] of tokenBlacklist.entries()) {
        if (now > expiresAt) {
          tokenBlacklist.delete(jti);
        }
      }
    }, 5 * 60 * 1000);
  }
  return tokenBlacklist;
}

export interface JwtPayload {
  userId: string;
  email: string;
  type?: string;
  jti: string; // Unique token identifier for blacklist
  tokenVersion: number; // HIGH-12 fix: Required — checked on verify against DB value
}

export interface AuthResult {
  success: boolean;
  userId?: string;
  email?: string;
  error?: string;
  tokenVersion?: number; // Exposed for downstream checks
}

/**
 * Add token to blacklist for immediate revocation
 * Called when user logs out or token is compromised
 */
export function blacklistToken(tokenJti: string, expiresAt: Date): void {
  getTokenBlacklist().set(tokenJti, expiresAt.getTime());
  logger.debug('Token blacklisted', { jti: tokenJti, expiresAt });
}

/**
 * Check if token is blacklisted
 */
export function isTokenBlacklisted(tokenJti: string): boolean {
  const blacklist = getTokenBlacklist();
  const expiresAt = blacklist.get(tokenJti);
  if (!expiresAt) return false;
  
  // Remove expired entry
  if (Date.now() > expiresAt) {
    blacklist.delete(tokenJti);
    return false;
  }
  
  return true;
}

/**
 * Get blacklist statistics (for monitoring)
 */
export function getBlacklistStats(): { size: number } {
  return { size: getTokenBlacklist().size };
}

export async function verifyAuth(request: NextRequest): Promise<AuthResult> {
  try {
    let token: string | null = null;

    // Check Authorization header first
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // Fall back to session cookie if no Bearer token
    if (!token) {
      const cookieHeader = request.headers.get('cookie');
      if (cookieHeader) {
        const cookies = Object.fromEntries(
          cookieHeader.split(';').map(c => {
            const [k, ...v] = c.trim().split('=');
            return [k, v.join('=')];
          })
        );
        token = cookies['session_id'] || cookies['auth-token'] || cookies['token'] || null;
      }
    }

    if (!token) {
      return { success: false, error: 'No authorization header or session cookie' };
    }

    try {
      const jwt = getJwtModule();
      
      // Decode without verification first to get JTI
      const decodedUnverified = jwt.decode(token) as JwtPayload | null;
      if (!decodedUnverified) {
        return { success: false, error: 'Invalid token format' };
      }

      // Check if token is blacklisted
      if (decodedUnverified.jti && isTokenBlacklisted(decodedUnverified.jti)) {
        logger.warn('Blacklisted token used', { jti: decodedUnverified.jti });
        return { success: false, error: 'Token has been revoked' };
      }

      // Add validation options for JWT verification
      const decoded = jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256'], // Enforce specific algorithm
        issuer: 'bing-app', // Validate issuer
        audience: 'bing-users', // Validate audience
      }) as JwtPayload;

      // HIGH-12 fix: Check tokenVersion against database value
      // If the user's tokenVersion has been incremented (password change, admin revocation),
      // all previously issued tokens are invalid.
      // HIGH-12 fix: Default to 1 for tokens missing tokenVersion (backward compat)
      // DB default is also 1, so existing tokens (with no version field) will match
      // and not be incorrectly rejected on deploy.
      const tokenVersion = decoded.tokenVersion ?? 1;
      try {
        const dbTokenVersion = getUserTokenVersion(decoded.userId);
        if (dbTokenVersion !== null && tokenVersion < dbTokenVersion) {
          logger.warn('Token version mismatch — token revoked by password change or admin action', {
            userId: decoded.userId,
            tokenVersion,
            dbTokenVersion,
          });
          return { success: false, error: 'Token has been revoked' };
        }
      } catch (versionError) {
        // If DB lookup fails, allow the token (fail open for availability)
        // but log loudly so ops can investigate
        logger.error('Token version check failed, allowing token (fail open)', versionError as Error);
      }

      return {
        success: true,
        userId: decoded.userId,
        email: decoded.email,
        tokenVersion,
      };
    } catch (jwtError) {
      const error = jwtError instanceof Error ? jwtError : new Error('JWT verification failed');

      // Provide specific error messages for debugging
      if (error.name === 'TokenExpiredError') {
        return { success: false, error: 'Token has expired' };
      } else if (error.name === 'InvalidSignatureError') {
        return { success: false, error: 'Invalid token signature' };
      } else if (error.name === 'JsonWebTokenError') {
        return { success: false, error: 'Invalid token format' };
      }

      return { success: false, error: 'Invalid token' };
    }
  } catch (error) {
    logger.error('Authentication failed', error as Error);
    return { success: false, error: 'Authentication failed' };
  }
}

/**
 * HIGH-12 fix: Get current token version for a user from the database.
 * Returns null if DB not available (fail open for availability).
 */
function getUserTokenVersion(userId: string): number | null {
  try {
    // Lazy load to avoid circular deps at module level
    const { getDatabase } = require('../database/connection');
    const db = getDatabase();
    if (!db) return null;
    const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId) as any;
    return row?.token_version ?? null;
  } catch {
    return null;
  }
}

/**
 * HIGH-12 fix: Increment a user's token version, invalidating all previous JWTs.
 * Called on password change, admin revocation, etc.
 */
export function incrementUserTokenVersion(userId: string): number {
  try {
    const { getDatabase } = require('../database/connection');
    const db = getDatabase();
    if (!db) {
      logger.error('Cannot increment token version — DB not available', { userId });
      return -1;
    }
    // NOTE: token_version column should be added via DB schema migration.
    // ALTER TABLE is NOT run here on every call — too expensive for hot path.
    // If column doesn't exist, the query below will throw and be caught.
    const result = db.prepare('UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?').run(userId);
    const newVersion = db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId) as any;
    logger.info('Token version incremented', { userId, newVersion: newVersion?.token_version });
    return newVersion?.token_version ?? -1;
  } catch (error) {
    logger.error('Failed to increment token version', error as Error);
    return -1;
  }
}

export function generateToken(payload: { userId: string; email: string; type?: string; tokenVersion?: number }): string {
  // MED-1 fix: Access token TTL reduced from 7 days to 1 hour.
  // Long-lived sessions should use refresh tokens, not long-lived JWTs.
  // Password reset tokens use shorter TTL (15 min) for security.
  const expiresIn = payload.type === 'password_reset' ? '15m' : '1h';
  
  // Generate unique token identifier (JTI) for blacklist support
  const jti = require('crypto').randomBytes(16).toString('hex');

  // HIGH-12 fix: Always include tokenVersion in JWT payload
  // Default to 1 if not provided (backward compatibility with existing tokens)
  const tokenVersion = payload.tokenVersion ?? 1;
  
  // Add issuer and audience claims for better security
  const fullPayload = {
    ...payload,
    tokenVersion,
    jti,
    iss: 'bing-app',
    aud: 'bing-users',
  } as any;

  const jwt = getJwtModule();
  const token = jwt.sign(fullPayload, getJwtSecret(), {
    expiresIn,
    algorithm: 'HS256', // Explicitly specify algorithm
  });

  logger.debug('Token generated', {
    userId: payload.userId,
    jti,
    expiresIn,
    type: payload.type
  });

  return token;
}

/**
 * Invalidate all tokens for a user (e.g., on password change)
 * HIGH-12 fix: Now actually increments tokenVersion in the database,
 * making all previously issued JWTs fail the version check on verify.
 */
export async function invalidateAllUserTokens(userId: string): Promise<void> {
  const newVersion = incrementUserTokenVersion(userId);
  if (newVersion < 0) {
    logger.error('Failed to invalidate tokens for user — token version not incremented', { userId });
  } else {
    logger.info('All tokens invalidated for user via token version increment', { userId, newVersion });
  }
}

/**
 * Check if token is expiring soon (within 5 minutes)
 * Used to determine if refresh is needed
 */
export function isTokenExpiringSoon(expiresAt: number, thresholdMinutes: number = 5): boolean {
  const now = Date.now();
  const expiresAtMs = expiresAt * 1000; // Convert from seconds
  const thresholdMs = thresholdMinutes * 60 * 1000;
  return expiresAtMs - now < thresholdMs;
}

/**
 * Get remaining token lifetime in seconds
 */
export function getTokenRemainingLifetime(expiresAt: number): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, expiresAt - now);
}
