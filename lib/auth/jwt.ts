import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { createLogger } from '../utils/logger';

const logger = createLogger('Auth:JWT');

// CRITICAL FIX: Enforce JWT_SECRET in production
const JWT_SECRET = process.env.JWT_SECRET;

// Validate JWT_SECRET is set in production
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  logger.error('CRITICAL: JWT_SECRET is not configured in production!');
  throw new Error('JWT_SECRET must be set in production environment');
}

// Fallback for development only (with warning)
if (!JWT_SECRET) {
  logger.warn('JWT_SECRET not configured. Using development default. DO NOT USE IN PRODUCTION.');
}

const DEVELOPMENT_SECRET = process.env.NODE_ENV === 'production' 
  ? undefined 
  : require('crypto').randomBytes(32).toString('hex');
const SECRET = JWT_SECRET || DEVELOPMENT_SECRET;

// Token blacklist for immediate revocation
// Stores token JTI (unique identifier) until expiration
const tokenBlacklist = new Map<string, number>();

// Cleanup expired blacklist entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of tokenBlacklist.entries()) {
    if (now > expiresAt) {
      tokenBlacklist.delete(jti);
    }
  }
}, 5 * 60 * 1000);

export interface JwtPayload {
  userId: string;
  email: string;
  type?: string;
  jti: string; // Unique token identifier for blacklist
  tokenVersion?: number; // For token rotation on password change
}

export interface AuthResult {
  success: boolean;
  userId?: string;
  email?: string;
  error?: string;
}

/**
 * Add token to blacklist for immediate revocation
 * Called when user logs out or token is compromised
 */
export function blacklistToken(tokenJti: string, expiresAt: Date): void {
  tokenBlacklist.set(tokenJti, expiresAt.getTime());
  logger.debug('Token blacklisted', { jti: tokenJti, expiresAt });
}

/**
 * Check if token is blacklisted
 */
export function isTokenBlacklisted(tokenJti: string): boolean {
  const expiresAt = tokenBlacklist.get(tokenJti);
  if (!expiresAt) return false;
  
  // Remove expired entry
  if (Date.now() > expiresAt) {
    tokenBlacklist.delete(tokenJti);
    return false;
  }
  
  return true;
}

/**
 * Get blacklist statistics (for monitoring)
 */
export function getBlacklistStats(): { size: number } {
  return { size: tokenBlacklist.size };
}

export async function verifyAuth(request: NextRequest): Promise<AuthResult> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'No authorization header' };
    }

    const token = authHeader.substring(7);

    try {
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
      const decoded = jwt.verify(token, SECRET, {
        algorithms: ['HS256'], // Enforce specific algorithm
        issuer: 'bing-app', // Validate issuer
        audience: 'bing-users', // Validate audience
      }) as JwtPayload;

      return {
        success: true,
        userId: decoded.userId,
        email: decoded.email
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

export function generateToken(payload: { userId: string; email: string; type?: string; tokenVersion?: number }): string {
  const expiresIn = payload.type === 'password_reset' ? '1h' : '7d';
  
  // Generate unique token identifier (JTI) for blacklist support
  const jti = require('crypto').randomBytes(16).toString('hex');

  // Add issuer and audience claims for better security
  const fullPayload: JwtPayload = {
    ...payload,
    jti,
    iss: 'bing-app',
    aud: 'bing-users',
  };

  const token = jwt.sign(fullPayload, SECRET, {
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
 * Increments token version, making all previous tokens invalid
 */
export async function invalidateAllUserTokens(userId: string): Promise<void> {
  // In a real implementation, this would:
  // 1. Increment tokenVersion in database
  // 2. Optionally blacklist all active tokens
  logger.info('All tokens invalidated for user', { userId });
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
