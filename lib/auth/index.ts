/**
 * Auth Module Exports
 *
 * Central export for all authentication utilities
 */

// Core auth service
export {
  authService,
  type User,
  type SessionInfo,
  type AuthResult,
} from './auth-service';

// JWT utilities
export {
  verifyAuth,
  generateToken,
  blacklistToken,
  isTokenBlacklisted,
  getBlacklistStats,
  type JwtPayload,
  type AuthResult as JwtAuthResult,
} from './jwt';

// OAuth service
export {
  oauthService,
} from './oauth-service';

// Auth cache (shared)
export {
  authCache,
  AuthCache,
  type ResolvedRequestAuth,
} from './auth-cache';

// Request auth helpers
export {
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
