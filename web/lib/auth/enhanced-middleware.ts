/**
 * Enhanced Authentication Middleware
 * 
 * Combines existing auth-service with new security utilities
 * for comprehensive API protection.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from './jwt';
import { authManager } from '@/lib/backend/auth';
import { RateLimiter, securityHeaders } from '@/lib/security';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Auth:Middleware');

/**
 * Rate limiter for auth endpoints
 * 100 requests per minute per IP
 */
const authRateLimiter = new RateLimiter(100, 60 * 1000);

/**
 * Rate limiter for general API endpoints
 * 1000 requests per minute per IP
 */
const apiRateLimiter = new RateLimiter(1000, 60 * 1000);

/**
 * Authentication middleware options
 */
export interface AuthMiddlewareOptions {
  /** Allow anonymous access (default: false) */
  allowAnonymous?: boolean;
  /** Required roles (empty = any authenticated user) */
  requiredRoles?: Array<'user' | 'admin' | 'service'>;
  /** Apply rate limiting (default: true) */
  rateLimit?: boolean;
  /** Add security headers (default: true) */
  securityHeaders?: boolean;
  /** Custom rate limiter key (default: IP address) */
  rateLimitKey?: (request: NextRequest) => string;
}

/**
 * Authentication result with extended info
 */
export interface EnhancedAuthResult {
  authenticated: boolean;
  success: boolean;
  userId?: string;
  email?: string;
  error?: string;
  statusCode?: number;
  rateLimitRemaining?: number;
}

/**
 * Get client IP from request
 * Handles Cloudflare, Cloudfront, and other proxy headers
 */
export function getClientIP(request: NextRequest): string {
  // Check various proxy headers
  const headers = [
    'cf-connecting-ip',      // Cloudflare
    'x-forwarded-for',       // Standard proxy
    'x-real-ip',             // Nginx
    'true-client-ip',        // Akamai
    'x-client-ip',           // Standard
  ];

  for (const header of headers) {
    const value = request.headers.get(header);
    if (value) {
      // x-forwarded-for can contain multiple IPs, take the first
      return value.split(',')[0].trim();
    }
  }

  // Fallback to direct connection
  return (request as any).ip || 'unknown';
}

/**
 * Enhanced authentication middleware for Next.js API routes
 * 
 * Features:
 * - JWT validation
 * - Rate limiting
 * - Security headers
 * - Account lockout protection
 * - Request logging
 * 
 * @example
 * ```typescript
 * // In route.ts
 * import { withAuth } from '@/lib/auth/enhanced-middleware';
 * 
 * export const GET = withAuth(
 *   async (request: NextRequest, auth: EnhancedAuthResult) => {
 *     // auth.userId is available here
 *     return NextResponse.json({ userId: auth.userId });
 *   },
 *   { requiredRoles: ['user'] }
 * );
 * ```
 */
export function withAuth<T extends NextResponse>(
  handler: (request: NextRequest, auth: EnhancedAuthResult) => Promise<T>,
  options: AuthMiddlewareOptions = {}
) {
  const {
    allowAnonymous = false,
    requiredRoles = [],
    rateLimit = true,
    securityHeaders: addSecurityHeaders = true,
    rateLimitKey = getClientIP,
  } = options;

  return async (request: NextRequest): Promise<T | NextResponse> => {
    const startTime = Date.now();
    const clientIP = rateLimitKey(request);
    
    // Initialize auth result
    const authResult: EnhancedAuthResult = {
      authenticated: false,
      success: false,
      rateLimitRemaining: 0,
    };

    try {
      // Rate limiting check
      if (rateLimit) {
        const limiter = requiredRoles.length > 0 ? authRateLimiter : apiRateLimiter;
        
        if (!limiter.isAllowed(clientIP)) {
          const retryAfter = limiter.getRetryAfter(clientIP);
          
          logger.warn('Rate limit exceeded', { 
            ip: clientIP, 
            path: request.nextUrl.pathname,
            retryAfter,
          });

          const response = NextResponse.json(
            { 
              error: 'Too many requests', 
              retryAfter,
            },
            { 
              status: 429,
              headers: {
                'Retry-After': retryAfter.toString(),
                'X-RateLimit-Limit': limiter.maxRequests.toString(),
                'X-RateLimit-Remaining': '0',
              },
            }
          );

          if (addSecurityHeaders) {
            Object.entries(securityHeaders).forEach(([key, value]) => {
              response.headers.set(key, value);
            });
          }

          return response as T;
        }

        authResult.rateLimitRemaining = limiter.getRemaining(clientIP);
      }

      // Authentication check
      const authHeader = request.headers.get('authorization');
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        if (allowAnonymous) {
          authResult.authenticated = true;
          authResult.success = true;
        } else {
          logger.warn('Missing authorization header', {
            path: request.nextUrl.pathname,
            ip: clientIP,
          });

          const response = NextResponse.json(
            { error: 'Authorization required' },
            { status: 401 }
          );

          if (addSecurityHeaders) {
            Object.entries(securityHeaders).forEach(([key, value]) => {
              response.headers.set(key, value);
            });
          }

          return response as T;
        }
      } else {
        // Verify JWT using existing auth-service
        const token = authHeader.substring(7);
        const verifyResult = await verifyAuth(request);

        if (!verifyResult.success) {
          logger.warn('Invalid token', {
            path: request.nextUrl.pathname,
            ip: clientIP,
            error: verifyResult.error,
          });

          const response = NextResponse.json(
            { error: 'Invalid token', details: verifyResult.error },
            { status: 401 }
          );

          if (addSecurityHeaders) {
            Object.entries(securityHeaders).forEach(([key, value]) => {
              response.headers.set(key, value);
            });
          }

          return response as T;
        }

        // Extract user info
        authResult.authenticated = true;
        authResult.success = true;
        authResult.userId = verifyResult.userId;
        authResult.email = verifyResult.email;

        // Role checking (if required)
        if (requiredRoles.length > 0) {
          const userRole = (verifyResult as any).role || 'user';
          
          if (!requiredRoles.includes(userRole as any)) {
            logger.warn('Insufficient permissions', {
              userId: authResult.userId,
              path: request.nextUrl.pathname,
              required: requiredRoles,
              actual: userRole,
            });

            return NextResponse.json(
              { error: 'Insufficient permissions' },
              { status: 403 }
            ) as T;
          }
        }
      }

      // Add security headers to response
      const response = await handler(request, authResult);

      if (addSecurityHeaders && response instanceof NextResponse) {
        Object.entries(securityHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });

        // Add timing header
        const duration = Date.now() - startTime;
        response.headers.set('X-Response-Time', `${duration}ms`);
      }

      // Add rate limit headers
      if (rateLimit && response instanceof NextResponse) {
        response.headers.set(
          'X-RateLimit-Remaining',
          authResult.rateLimitRemaining?.toString() || '0'
        );
      }

      return response;

    } catch (error) {
      logger.error('Auth middleware error', {
        path: request.nextUrl.pathname,
        ip: clientIP,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      });

      const response = NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );

      if (addSecurityHeaders) {
        Object.entries(securityHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      }

      return response as T;
    }
  };
}

/**
 * Simple auth checker for quick use
 * 
 * @example
 * ```typescript
 * export async function POST(request: NextRequest) {
 *   const auth = await checkAuth(request);
 *   if (!auth.authenticated) {
 *     return NextResponse.json({ error: auth.error }, { status: auth.statusCode });
 *   }
 *   // Proceed with auth.userId
 * }
 * ```
 */
export async function checkAuth(
  request: NextRequest,
  options: { allowAnonymous?: boolean } = {}
): Promise<EnhancedAuthResult> {
  const { allowAnonymous = false } = options;
  
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (allowAnonymous) {
      return { authenticated: true, success: true };
    }
    return {
      authenticated: false,
      success: false,
      error: 'Authorization required',
      statusCode: 401,
    };
  }

  const verifyResult = await verifyAuth(request);
  
  if (!verifyResult.success) {
    return {
      authenticated: false,
      success: false,
      error: verifyResult.error,
      statusCode: 401,
    };
  }

  return {
    authenticated: true,
    success: true,
    userId: verifyResult.userId,
    email: verifyResult.email,
  };
}

/**
 * Extract user ID from request (convenience function)
 * 
 * @throws Error if not authenticated
 */
export async function requireUserId(request: NextRequest): Promise<string> {
  const auth = await checkAuth(request);
  if (!auth.authenticated || !auth.userId) {
    throw new Error(auth.error || 'Authentication required');
  }
  return auth.userId;
}

/**
 * Log security event for audit trail
 */
export function logSecurityEvent(
  event: {
    type: string;
    userId?: string;
    ip?: string;
    details?: Record<string, any>;
  },
  request?: NextRequest
): void {
  const clientIP = request ? getClientIP(request) : 'unknown';
  
  logger.info('Security event', {
    eventType: event.type,
    userId: event.userId,
    ip: event.ip || clientIP,
    ...event.details,
  });
}
