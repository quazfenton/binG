/**
 * Security Module
 *
 * Central export for all security utilities
 */

export {
  // Path security
  safeJoin,
  isValidResourceId,
  validateRelativePath,

  // Schemas
  sandboxIdSchema,
  relativePathSchema,
  commandSchema,

  // Rate limiting
  RateLimiter,

  // Security utilities
  securityHeaders,
  sanitizeOutput,
  generateSecureId,
} from './security-utils';

export {
  // Safe command execution
  safeExec,
  safeSpawn,
  safeExecWithRetry,
  ALLOWED_COMMANDS,
  BLOCKED_PATTERNS,
  BLOCKED_METACHARACTERS,
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_OUTPUT_SIZE,

  // Types
  type SafeExecOptions,
  type SafeSpawnOptions,
  type ExecResult,
} from './safe-exec';

export {
  // JWT authentication
  generateToken,
  verifyToken,
  extractTokenFromHeader,
  refreshToken,
  authenticateRequest,
  generateApiKey,
  isValidApiKeyFormat,
  InMemoryTokenBlacklist as TokenBlacklist,
  globalBlacklist,

  // Types
  type TokenPayload,
  type JWTConfig,
  type VerificationResult,
  type AuthOptions,
  type AuthResult,
  type TokenBlacklistProvider,
} from './jwt-auth';

export {
  // Cryptographic utilities
  createSecureHash,
  createSecureRandomString,
  createUUID,
  hashString,
  createHMAC,
  verifyHMAC,
  constantTimeCompare,
  generatePassword,
  deriveKeyFromPassword,
} from './crypto-utils';
