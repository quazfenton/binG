/**
 * JWT Authentication Utilities
 *
 * Secure JWT token generation, validation, and verification
 * using the jose library for cryptographic operations.
 */

import { SignJWT, jwtVerify, JWTPayload, errors } from 'jose';
const { JWTExpired, JWTInvalid, JOSEError } = errors;
import { createSecureHash } from './crypto-utils';

/**
 * JWT Token Payload Structure
 */
export interface TokenPayload extends JWTPayload {
  userId: string;
  email?: string;
  role?: 'user' | 'admin' | 'service';
  sessionId?: string;
}

/**
 * JWT Configuration
 */
export interface JWTConfig {
  secretKey: string;
  issuer: string;
  audience: string;
  expiresIn: string;
}

/**
 * Token Verification Result
 */
export interface VerificationResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
  expired?: boolean;
}

/**
 * Default configuration
 *
 * SECURITY: Throws error in production if JWT_SECRET not set
 */
const DEFAULT_CONFIG: JWTConfig = {
  secretKey: getSecretKey(),
  issuer: process.env.JWT_ISSUER || 'binG',
  audience: process.env.JWT_AUDIENCE || 'binG-app',
  expiresIn: process.env.JWT_EXPIRES_IN || '24h',
};

/**
 * Get secret key from environment
 * Throws error in production if not configured
 */
function getSecretKey(): string {
  const secretKey = process.env.JWT_SECRET;

  if (!secretKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CRITICAL: JWT_SECRET environment variable is required in production. ' +
        'Set a secure random string (min 32 characters).'
      );
    }
    // Development only - generate warning
    console.warn(
      '⚠️  WARNING: JWT_SECRET not set. Using insecure development key.\n' +
      'Set JWT_SECRET environment variable for production.'
    );
    return 'dev-insecure-key-change-in-production-' + Date.now();
  }

  // Validate key strength
  if (secretKey.length < 16) {
    throw new Error(
      'JWT_SECRET must be at least 16 characters. ' +
      'Use a secure random string (e.g., openssl rand -hex 32)'
    );
  }

  return secretKey;
}

/**
 * Get signing key from secret
 * 
 * In production, use a proper key pair (RS256/ES256)
 * For development, we use HS256 with a secret
 */
function getSigningKey(secretKey: string): Uint8Array {
  return new TextEncoder().encode(secretKey);
}

/**
 * Generate a JWT token
 * 
 * @param payload - Token payload with user information
 * @param config - JWT configuration (optional, uses defaults)
 * @returns Signed JWT token
 * 
 * @example
 * ```typescript
 * const token = await generateToken({
 *   userId: 'user-123',
 *   email: 'user@example.com',
 *   role: 'user',
 * });
 * ```
 */
export async function generateToken(
  payload: TokenPayload,
  config: Partial<JWTConfig> = {}
): Promise<string> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Validate required fields
  if (!payload.userId) {
    throw new Error('userId is required in token payload');
  }
  
  // Create and sign JWT
  const token = await new SignJWT({
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    sessionId: payload.sessionId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(fullConfig.issuer)
    .setAudience(fullConfig.audience)
    .setExpirationTime(fullConfig.expiresIn)
    .setSubject(payload.userId)
    .setJti(createSecureHash(24)) // Unique token ID
    .sign(getSigningKey(fullConfig.secretKey));
  
  return token;
}

/**
 * Verify a JWT token
 * 
 * @param token - JWT token to verify
 * @param config - JWT configuration (optional)
 * @returns Verification result with payload if valid
 * 
 * @example
 * ```typescript
 * const result = await verifyToken(token);
 * if (result.valid) {
 *   console.log('User ID:', result.payload?.userId);
 * } else {
 *   console.error('Invalid token:', result.error);
 * }
 * ```
 */
export async function verifyToken(
  token: string,
  config: Partial<JWTConfig> = {}
): Promise<VerificationResult> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  
  try {
    const { payload } = await jwtVerify(token, getSigningKey(fullConfig.secretKey), {
      issuer: fullConfig.issuer,
      audience: fullConfig.audience,
    });
    
    // Check token blacklist for revoked tokens
    // Note: In distributed environments, use RedisTokenBlacklist for consistent checks
    const jti = payload.jti;
    if (jti) {
      const revoked = globalBlacklist.isRevoked(jti);
      
      // Handle both sync and async blacklist implementations
      if (revoked instanceof Promise) {
        const isRevoked = await revoked;
        if (isRevoked) {
          return {
            valid: false,
            error: 'Token has been revoked',
          };
        }
      } else if (revoked) {
        return {
          valid: false,
          error: 'Token has been revoked',
        };
      }
    }
    
    // Validate required userId claim
    if (typeof payload.userId !== 'string' || payload.userId.trim() === '') {
      return {
        valid: false,
        error: 'Token contains invalid userId claim',
      };
    }
    
    return {
      valid: true,
      payload: payload as TokenPayload,
    };
  } catch (error) {
    if (error instanceof JWTExpired) {
      return {
        valid: false,
        error: 'Token has expired',
        expired: true,
      };
    }

    if (error instanceof JWTInvalid || error instanceof JOSEError) {
      const err = error as InstanceType<typeof JOSEError>;
      if (err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
        return {
          valid: false,
          error: 'Invalid token signature',
        };
      }
      if (err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
        return {
          valid: false,
          error: 'Token claim validation failed',
        };
      }
    }

    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}

/**
 * Extract token from Authorization header
 * 
 * @param authHeader - Authorization header value
 * @returns Token string or null
 * 
 * @example
 * ```typescript
 * const token = extractTokenFromHeader(request.headers.get('authorization'));
 * if (token) {
 *   const result = await verifyToken(token);
 *   // ...
 * }
 * ```
 */
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }
  
  // Support "Bearer <token>" format
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) {
    return match[1];
  }
  
  // Or return as-is if no Bearer prefix
  return authHeader.trim();
}

/**
 * Refresh a token (issue new token with extended expiry)
 * Revokes the old token after issuing a new one (rotation).
 * 
 * @param currentToken - Current valid token
 * @param config - JWT configuration
 * @returns New token with extended expiry
 */
export async function refreshToken(
  currentToken: string,
  config: Partial<JWTConfig> = {}
): Promise<string> {
  const verification = await verifyToken(currentToken, config);
  
  if (!verification.valid || !verification.payload) {
    throw new Error('Cannot refresh invalid or expired token');
  }
  
  // Generate new token with same payload
  const newToken = await generateToken(verification.payload, config);
  
  // Revoke old token to prevent reuse (token rotation)
  await revokeToken(currentToken, config);
  
  return newToken;
}

/**
 * Revoke a JWT token by adding its JTI to the blacklist.
 * The token remains blacklisted until its original expiry time.
 * 
 * @param token - JWT token to revoke
 * @param config - JWT configuration
 */
export async function revokeToken(
  token: string,
  config: Partial<JWTConfig> = {}
): Promise<void> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    const { payload } = await jwtVerify(token, getSigningKey(fullConfig.secretKey), {
      issuer: fullConfig.issuer,
      audience: fullConfig.audience,
    });

    const jti = payload.jti;
    const exp = payload.exp;

    if (jti && exp) {
      // Revoke in blacklist (supports both sync and async implementations)
      const result = globalBlacklist.revoke(jti, exp * 1000); // exp is in seconds, convert to ms
      
      // Handle async blacklist implementations (e.g., Redis)
      if (result instanceof Promise) {
        await result;
      }
    }
  } catch (error) {
    // Token is already expired or invalid — no need to blacklist
    // Log in debug mode for troubleshooting
    if (process.env.NODE_ENV === 'development') {
      console.debug('[JWT] Token already expired or invalid, skipping blacklist:', error);
    }
  }
}

/**
 * Middleware helper for Next.js API routes
 * 
 * @param request - Next.js request object
 * @param options - Authentication options
 * @returns Authentication result
 * 
 * @example
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   const auth = await authenticateRequest(request);
 *   if (!auth.authenticated) {
 *     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *   }
 *   // Proceed with authenticated user
 *   const userId = auth.payload?.userId;
 * }
 * ```
 */
export interface AuthOptions {
  allowAnonymous?: boolean;
  requiredRoles?: Array<'user' | 'admin' | 'service'>;
}

export interface AuthResult {
  authenticated: boolean;
  payload?: TokenPayload;
  error?: string;
  statusCode?: number;
}

export async function authenticateRequest(
  request: Request,
  options: AuthOptions = {}
): Promise<AuthResult> {
  const { allowAnonymous = false, requiredRoles = [] } = options;
  
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization');
  const token = extractTokenFromHeader(authHeader);
  
  if (!token) {
    if (allowAnonymous) {
      return { authenticated: true };
    }
    return {
      authenticated: false,
      error: 'Authorization header required',
      statusCode: 401,
    };
  }
  
  // Verify token
  const verification = await verifyToken(token);
  
  if (!verification.valid) {
    return {
      authenticated: false,
      error: verification.error,
      statusCode: verification.expired ? 401 : 403,
    };
  }
  
  // Check role requirements
  if (requiredRoles.length > 0 && verification.payload) {
    const userRole = verification.payload.role || 'user';
    if (!requiredRoles.includes(userRole)) {
      return {
        authenticated: false,
        error: `Insufficient permissions. Required: ${requiredRoles.join(' or ')}`,
        statusCode: 403,
      };
    }
  }
  
  return {
    authenticated: true,
    payload: verification.payload,
  };
}

/**
 * Generate API key (for service-to-service authentication)
 * 
 * @param userId - User/service ID
 * @param label - Optional label for the key
 * @returns API key (prefix + random part)
 */
export function generateApiKey(userId: string, label?: string): string {
  const prefix = label ? label.toLowerCase().replace(/[^a-z]/g, '') : 'key';
  const randomPart = createSecureHash(32);
  return `${prefix}_${userId}_${randomPart}`;
}

/**
 * Validate API key format
 * 
 * @param apiKey - API key to validate
 * @returns true if format is valid
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  // Format: prefix_userId_hash
  return /^[a-z]+_[a-zA-Z0-9_-]+_[a-f0-9]{64}$/.test(apiKey);
}

/**
 * Token Blacklist Interface
 * 
 * Abstract interface for token revocation storage.
 * 
 * IMPORTANT: For production/distributed environments, use Redis-backed implementation
 * to ensure consistent revocation checks across all server instances.
 * 
 * @example
 * ```typescript
 * // Single instance (development)
 * const blacklist = new InMemoryTokenBlacklist();
 * 
 * // Distributed (production)
 * const blacklist = new RedisTokenBlacklist(redisClient);
 * ```
 */
export interface TokenBlacklistProvider {
  /**
   * Revoke a token by JTI
   * @param tokenJti - Token JTI identifier
   * @param expiryTimestamp - When the revocation expires (ms)
   */
  revoke(tokenJti: string, expiryTimestamp: number): Promise<void> | void;
  
  /**
   * Check if token is revoked
   * @param tokenJti - Token JTI identifier
   * @returns true if revoked, false otherwise
   */
  isRevoked(tokenJti: string): Promise<boolean> | boolean;
  
  /**
   * Clean up expired entries
   */
  cleanup(): Promise<void> | void;
}

/**
 * In-Memory Token Blacklist (Development Only)
 * 
 * ⚠️ WARNING: This implementation is NOT suitable for production/distributed environments.
 * - Data is lost on process restart
 * - No synchronization across multiple server instances
 * - Race conditions possible with concurrent revocation checks
 * 
 * For production, use RedisTokenBlacklist or similar distributed store.
 */
export class InMemoryTokenBlacklist implements TokenBlacklistProvider {
  private revoked = new Map<string, number>(); // token JTI -> expiry timestamp

  /**
   * Revoke a token
   */
  revoke(tokenJti: string, expiryTimestamp: number): void {
    this.revoked.set(tokenJti, expiryTimestamp);
  }

  /**
   * Check if token is revoked
   * 
   * ⚠️ Note: In distributed environments, this check may be stale
   * if another instance revoked the token concurrently.
   */
  isRevoked(tokenJti: string): boolean {
    const expiry = this.revoked.get(tokenJti);
    if (!expiry) return false;

    // Clean up expired entries
    if (Date.now() > expiry) {
      this.revoked.delete(tokenJti);
      return false;
    }

    return true;
  }

  /**
   * Clean up all expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [jti, expiry] of this.revoked.entries()) {
      if (now > expiry) {
        this.revoked.delete(jti);
      }
    }
  }
}

// Export singleton instances
// SECURITY: Use Redis blacklist in production for distributed token revocation
// Falls back to in-memory for development/single-instance deployments
export const globalBlacklist: TokenBlacklistProvider = (() => {
  // Check if Redis is available (production environment)
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && process.env.NODE_ENV === 'production') {
    try {
      const { RedisTokenBlacklist } = require('./redis-token-blacklist');
      const redis = new (require('ioredis'))(redisUrl);
      const blacklist = new RedisTokenBlacklist(redis);
      console.log('[Security] Using Redis token blacklist for distributed revocation');
      return blacklist;
    } catch (error) {
      console.warn('[Security] Failed to initialize Redis blacklist, falling back to in-memory:', error);
    }
  }
  
  // Fallback to in-memory (development or Redis unavailable)
  console.log('[Security] Using in-memory token blacklist');
  return new InMemoryTokenBlacklist();
})();

// Periodic cleanup (every hour) - only for in-memory blacklist
if (typeof global !== 'undefined' && globalBlacklist instanceof InMemoryTokenBlacklist) {
  setInterval(() => {
    globalBlacklist.cleanup();
  }, 60 * 60 * 1000);
}
