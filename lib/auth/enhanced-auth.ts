/**
 * Enhanced Authentication Helpers
 * 
 * Provides cookie-based authentication and enhanced security features
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/security/jwt-auth';
import type { TokenPayload } from '@/lib/security/jwt-auth';

export interface EnhancedAuthResult {
  success: boolean;
  userId?: string;
  source: 'jwt' | 'session' | 'cookie' | 'anonymous' | 'none';
  error?: string;
  token?: string;
}

export interface EnhancedAuthOptions {
  allowAnonymous?: boolean;
  requireCookie?: boolean;
  allowCookie?: boolean;
  anonymousHeaderName?: string;
}

/**
 * Extract auth token from multiple sources (header, cookie, query)
 * Priority: Authorization header > Cookie > Query param (deprecated)
 */
export function extractAuthToken(req: NextRequest): string | null {
  // 1. Try Authorization header first (most secure)
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // 2. Try httpOnly cookie (set by auth middleware)
  const cookie = req.cookies.get('auth_token');
  if (cookie?.value) {
    return cookie.value;
  }

  // 3. Try session cookie
  const sessionCookie = req.cookies.get('session_id');
  if (sessionCookie?.value) {
    return sessionCookie.value;
  }

  // 4. Fallback to query param (deprecated, less secure)
  // Only used for backward compatibility - should be removed in future
  const url = new URL(req.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    console.warn('[Auth] Token passed via query parameter - this is less secure and will be removed');
    return queryToken;
  }

  return null;
}

/**
 * Enhanced authentication resolution with cookie support
 */
export async function resolveEnhancedRequestAuth(
  req: NextRequest,
  options: EnhancedAuthOptions = {}
): Promise<EnhancedAuthResult> {
  const { 
    allowAnonymous = false, 
    requireCookie = false,
    allowCookie = true,
    anonymousHeaderName = 'x-anonymous-session-id' 
  } = options;

  // Extract token from all sources
  const token = extractAuthToken(req);

  // 1. Try JWT authentication
  if (token) {
    try {
      const result = await verifyToken(token);
      if (result.valid && result.payload) {
        const userId = result.payload.userId || result.payload.sub;

        if (userId) {
          return {
            success: true,
            userId: userId as string,
            source: 'jwt',
            token,
          };
        }
      }
    } catch (error: any) {
      // Token invalid, continue to other methods
      console.debug('[Auth] JWT verification failed:', error.message);
    }
  }

  // 2. Try session cookie authentication
  if (allowCookie) {
    const sessionId = req.cookies.get('session_id')?.value;
    if (sessionId) {
      // Session validation would happen here if session service is available
      // For now, treat as valid session
      return {
        success: true,
        userId: `session:${sessionId}`,
        source: 'session',
      };
    }
  }

  // 3. Try anonymous authentication
  if (allowAnonymous) {
    const anonRaw = req.headers.get(anonymousHeaderName);
    if (anonRaw) {
      const normalized = normalizeAnonymousId(anonRaw);
      if (normalized) {
        return {
          success: true,
          userId: `anon:${normalized}`,
          source: 'anonymous',
        };
      }
    }
  }

  // 4. Auth failed
  return {
    success: false,
    error: 'Authentication required',
    source: 'none',
  };
}

/**
 * Normalize anonymous session ID
 */
function normalizeAnonymousId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128) return null;

  // Keep only predictable safe chars for in-memory session keys
  const normalized = trimmed.replace(/[^a-zA-Z0-9:_-]/g, '');
  if (!normalized) return null;
  return normalized;
}

/**
 * Set auth token as httpOnly cookie in response
 * This is more secure than localStorage (prevents XSS attacks)
 */
export function setAuthCookie(
  response: NextResponse,
  token: string,
  options?: {
    maxAge?: number;
    secure?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
    path?: string;
  }
): void {
  const {
    maxAge = 86400, // 24 hours
    secure = process.env.NODE_ENV === 'production',
    sameSite = 'strict',
    path = '/',
  } = options || {};

  response.cookies.set('auth_token', token, {
    httpOnly: true, // Prevents JavaScript access (XSS protection)
    secure, // Only send over HTTPS in production
    sameSite, // Prevent CSRF
    path,
    maxAge,
  });
}

/**
 * Clear auth cookie (logout)
 */
export function clearAuthCookie(response: NextResponse): void {
  response.cookies.set('auth_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0, // Immediately expire
  });
}

/**
 * Extract WebSocket authentication token from various sources
 * Priority: Subprotocol > Cookie > Header > Query (deprecated)
 */
export function extractWebSocketToken(
  headers: { [key: string]: string | undefined },
  url?: string
): string | null {
  // 1. Try WebSocket subprotocol (Bearer token)
  const protocol = headers['sec-websocket-protocol'];
  if (protocol && protocol.startsWith('Bearer ')) {
    return protocol.substring(7);
  }

  // 2. Try cookie from headers
  const cookieHeader = headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    }, {} as Record<string, string>);
    
    if (cookies['auth_token']) {
      return cookies['auth_token'];
    }
  }

  // 3. Try Authorization header
  const authHeader = headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // 4. Fallback to query param (deprecated, less secure)
  if (url) {
    try {
      const urlObj = new URL(url);
      const queryToken = urlObj.searchParams.get('token');
      if (queryToken) {
        console.warn('[WebSocket Auth] Token passed via query parameter - this is less secure');
        return queryToken;
      }
    } catch {
      // Invalid URL, ignore
    }
  }

  return null;
}

/**
 * Verify sandbox ownership for WebSocket connections
 */
export async function verifySandboxOwnership(
  userId: string,
  sandboxId: string,
  sessionId?: string
): Promise<{ allowed: boolean; error?: string }> {
  // Dynamic import to avoid circular dependencies
  const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');
  
  const userSession = sandboxBridge.getSessionByUserId(userId);
  
  if (!userSession) {
    return {
      allowed: false,
      error: 'No active sandbox session found',
    };
  }
  
  if (userSession.sandboxId !== sandboxId) {
    console.warn(
      `[Sandbox Ownership] User ${userId} tried to access sandbox ${sandboxId}, owns ${userSession.sandboxId}`
    );
    return {
      allowed: false,
      error: 'Unauthorized: sandbox not owned by this user',
    };
  }
  
  if (sessionId && userSession.sessionId !== sessionId) {
    return {
      allowed: false,
      error: 'Unauthorized: invalid session',
    };
  }
  
  return { allowed: true };
}
