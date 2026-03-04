/**
 * Auth Module Exports
 * 
 * Central export for all authentication utilities
 */

// Core auth service
export {
  authService,
  type User,
  type Session,
  type AuthTokens,
} from './auth-service';

// JWT utilities
export {
  verifyAuth,
  generateToken,
  blacklistToken,
  isTokenBlacklisted,
  getBlacklistStats,
  type JwtPayload,
  type AuthResult,
} from './jwt';

// OAuth service
export {
  oauthService,
  type OAuthProvider,
  type OAuthConfig,
} from './oauth-service';

// Request auth helpers
export {
  authCache,
  getCachedUser,
  setCachedUser,
  invalidateUserCache,
} from './request-auth';

// Enhanced middleware (NEW)
export {
  withAuth,
  checkAuth,
  requireUserId,
  logSecurityEvent,
  getClientIP,
  type AuthMiddlewareOptions,
  type EnhancedAuthResult,
} from './enhanced-middleware';
