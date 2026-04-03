/**
 * Authentication Module
 * JWT validation and user ID extraction
 * Migrated from ephemeral/auth.py
 */

import { jwtVerify, importSPKI } from 'jose';

/**
 * Import a symmetric secret key for JWT verification
 */
async function importAsymmetricKey(secret: string, algorithm: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);

  // Map JOSE algorithm identifiers to Web Crypto HMAC parameters
  let webCryptoAlgorithm: { name: string; hash: string };
  if (algorithm === 'HS256') {
    webCryptoAlgorithm = { name: 'HMAC', hash: 'SHA-256' };
  } else if (algorithm === 'HS384') {
    webCryptoAlgorithm = { name: 'HMAC', hash: 'SHA-384' };
  } else if (algorithm === 'HS512') {
    webCryptoAlgorithm = { name: 'HMAC', hash: 'SHA-512' };
  } else {
    throw new Error(`Unsupported symmetric algorithm: ${algorithm}`);
  }

  return crypto.subtle.importKey(
    'raw',
    keyData,
    webCryptoAlgorithm,
    false,
    ['verify']
  );
}

export interface AuthConfig {
  algorithm: string;
  expirationHours: number;
  issuer?: string;
  audience?: string;
  publicKey?: string;
  secretKey?: string;
}

// Lazy-loaded auth config to avoid build failures
let defaultAuthConfig: AuthConfig | null = null;

function getDefaultAuthConfig(): AuthConfig {
  if (defaultAuthConfig) return defaultAuthConfig;

  const env: any = typeof process !== 'undefined' ? process.env : {};

  // Skip validation during build - use dummy values
  const isBuild = env.SKIP_DB_INIT === 'true' ||
                  env.NEXT_BUILD === 'true' ||
                  env.NEXT_PHASE === 'phase-production-build' ||
                  env.NEXT_PHASE === 'build';
  
  if (isBuild) {
    console.warn('[Auth] Skipping auth config validation during build');
    defaultAuthConfig = {
      algorithm: 'HS256',
      expirationHours: 24,
      issuer: 'dummy-issuer',
      audience: 'dummy-audience',
      publicKey: 'dummy-public-key',
      secretKey: 'dummy-secret-key',
    };
    return defaultAuthConfig;
  }
  
  defaultAuthConfig = {
    algorithm: 'HS256',
    expirationHours: 24,
    issuer: env.IDP_ISSUER,
    audience: env.IDP_AUDIENCE,
    publicKey: env.AUTH_PUBLIC_KEY,
    secretKey: env.JWT_SECRET,
  };
  
  return defaultAuthConfig;
}

/**
 * Validate user ID to prevent path traversal and command injection
 */
export function validateUserId(userId: string): boolean {
  // Allow alphanumeric characters, hyphens, underscores, and pipe (for IdP formats like auth0|...)
  return /^[a-zA-Z0-9_\-\|]+$/.test(userId);
}

/**
 * Get and validate user ID from JWT token
 */
export async function getUserId(token: string, config?: AuthConfig): Promise<string> {
  const effectiveConfig = config || getDefaultAuthConfig();
  try {
    let key: CryptoKey;

    // Determine key type based on algorithm
    if (config.algorithm.startsWith('RS') || config.algorithm.startsWith('ES')) {
      // Asymmetric algorithm (RS256, ES256, etc.) - use public key
      if (!config.publicKey) {
        throw new Error('Public key required for asymmetric algorithm');
      }
      key = await importSPKI(config.publicKey, config.algorithm);
    } else {
      // Symmetric algorithm (HS256, HS384, HS512) - use secret key
      if (!config.secretKey) {
        throw new Error('Secret key required for symmetric algorithm');
      }
      key = await importAsymmetricKey(config.secretKey, config.algorithm);
    }

    // Verify and decode JWT
    const { payload } = await jwtVerify(token, key, {
      algorithms: [config.algorithm],
      issuer: config.issuer,
      audience: config.audience,
    });

    // Extract user ID from 'sub' claim
    const userId = payload.sub;
    if (!userId) {
      throw new Error('JWT missing "sub" claim');
    }

    // Validate user ID format
    if (!validateUserId(userId)) {
      throw new Error('Invalid user ID format');
    }

    return userId;
  } catch (error: any) {
    if (error.name === 'JWTExpired') {
      throw new Error('JWT token has expired');
    }
    if (error.name === 'JOSEError') {
      throw new Error('Invalid JWT token');
    }
    throw error;
  }
}

/**
 * Create JWT token (for testing/internal use)
 */
export async function createToken(
  userId: string,
  config?: AuthConfig
): Promise<string> {
  const effectiveConfig = config || getDefaultAuthConfig();
  const { SignJWT } = await import('jose');

  if (!effectiveConfig.secretKey) {
    throw new Error('Secret key required for token creation');
  }

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: effectiveConfig.algorithm })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${effectiveConfig.expirationHours}h`)
    .setIssuer(effectiveConfig.issuer)
    .setAudience(effectiveConfig.audience)
    .sign(new TextEncoder().encode(effectiveConfig.secretKey));

  return token;
}

/**
 * Extract user from Authorization header
 */
export async function getCurrentUser(authorization: string | null): Promise<string> {
  if (!authorization) {
    throw new Error('Authorization header required');
  }

  if (!authorization.startsWith('Bearer ')) {
    throw new Error('Authorization header must start with "Bearer "');
  }

  const token = authorization.substring(7); // Remove "Bearer " prefix
  return getUserId(token);
}

/**
 * Middleware-style auth checker for API routes
 */
export async function requireAuth(request: Request): Promise<string> {
  const authHeader = request.headers.get('Authorization');
  return getCurrentUser(authHeader);
}

/**
 * Check if token is valid without extracting user ID
 */
export async function validateToken(token: string, config?: AuthConfig): Promise<boolean> {
  const effectiveConfig = config || getDefaultAuthConfig();
  try {
    await getUserId(token, effectiveConfig);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get token expiration time
 */
export async function getTokenExpiration(token: string): Promise<Date | null> {
  try {
    const { decodeJwt } = await import('jose');
    const decoded = decodeJwt(token);
    
    if (decoded.exp) {
      return new Date(decoded.exp * 1000);
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Auth configuration validator
 */
export function validateAuthConfig(config: AuthConfig): void {
  const errors: string[] = [];

  if (!config.algorithm) {
    errors.push('Algorithm is required');
  }

  if (config.algorithm.startsWith('RS') || config.algorithm.startsWith('ES')) {
    if (!config.publicKey) {
      errors.push('Public key required for asymmetric algorithm');
    }
  } else if (config.algorithm.startsWith('HS')) {
    if (!config.secretKey) {
      errors.push('Secret key required for symmetric algorithm');
    }
  } else {
    errors.push(`Unsupported algorithm: ${config.algorithm}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid auth config: ${errors.join(', ')}`);
  }
}

// Singleton auth instance
export class AuthManager {
  private config: AuthConfig;
  private static instance: AuthManager | null = null;

  constructor(config?: AuthConfig) {
    const effectiveConfig = config || getDefaultAuthConfig();
    validateAuthConfig(effectiveConfig);
    this.config = effectiveConfig;
  }

  static getInstance(config?: AuthConfig): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager(config);
    }
    return AuthManager.instance;
  }

  async getUserId(token: string): Promise<string> {
    return getUserId(token, this.config);
  }

  async createToken(userId: string): Promise<string> {
    return createToken(userId, this.config);
  }

  async validateToken(token: string): Promise<boolean> {
    return validateToken(token, this.config);
  }

  async getCurrentUser(authorization: string | null): Promise<string> {
    if (!authorization) {
      throw new Error('Authorization header required');
    }
    const token = authorization.startsWith('Bearer ') ? authorization.substring(7) : authorization;
    return this.getUserId(token);
  }

  updateConfig(config: Partial<AuthConfig>): void {
    this.config = { ...this.config, ...config };
    validateAuthConfig(this.config);
  }

  getConfig(): AuthConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const authManager = AuthManager.getInstance();
