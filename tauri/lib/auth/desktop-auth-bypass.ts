/**
 * Desktop Auth Bypass Middleware
 *
 * In desktop mode, the user is already authenticated locally via the Tauri app.
 * This module provides middleware to bypass cloud-based authentication (Auth0/OAuth)
 * and use local authentication instead.
 *
 * Desktop mode uses a simple local user identification rather than JWT-based auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDesktopMode } from '@/lib/utils/desktop-env';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('DesktopAuth');

/**
 * Desktop user context
 */
export interface DesktopUserContext {
  userId: string;
  email?: string;
  displayName?: string;
  isLocalUser: boolean;
}

/**
 * Get desktop user context from local storage/environment
 */
export function getDesktopUserContext(): DesktopUserContext | null {
  if (!isDesktopMode()) {
    return null;
  }

  // In desktop mode, use local user identification
  // This could be from Tauri invoke or environment variables
  const userId = process.env.DESKTOP_USER_ID || 'local-desktop-user';
  const email = process.env.DESKTOP_USER_EMAIL;
  const displayName = process.env.DESKTOP_USER_NAME || 'Local User';

  // CRITICAL: Validate userId is not empty
  if (!userId || userId.trim().length === 0) {
    log.error('Invalid DESKTOP_USER_ID environment variable', {
      userIdLength: userId?.length,
      hasValue: !!userId,
    });
    return null;
  }

  return {
    userId,
    email,
    displayName,
    isLocalUser: true,
  };
}

/**
 * Check if request should bypass authentication in desktop mode
 */
export function shouldBypassAuth(request: NextRequest): boolean {
  if (!isDesktopMode()) {
    return false;
  }

  const path = request.nextUrl.pathname;

  // Bypass auth for these paths in desktop mode
  const bypassPaths = [
    '/api/health',
    '/api/desktop',
    '/api/filesystem/snapshot',
    '/api/agent/stream',
  ];

  return bypassPaths.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Desktop auth middleware for API routes
 * In desktop mode, uses local user context instead of JWT verification
 * 
 * FIX: Removed async wrapper - returns handler function directly, not Promise of handler
 * The original `async` made it return Promise<NextResponse> which breaks Next.js middleware chaining
 */
export function withDesktopAuth<T extends NextResponse>(
  handler: (request: NextRequest, user: DesktopUserContext) => Promise<T>,
  options: { allowAnonymous?: boolean } = {}
) {
  return async (request: NextRequest): Promise<T | NextResponse> => {
    // Only apply desktop auth in desktop mode
    if (!isDesktopMode()) {
      // Fall back to standard auth (import dynamically to avoid circular deps)
      const { checkAuth } = await import('@/lib/auth/enhanced-middleware');
      const auth = await checkAuth(request, { allowAnonymous: options.allowAnonymous });

      if (!auth.authenticated) {
        return NextResponse.json(
          { error: auth.error || 'Authentication required' },
          { status: auth.statusCode || 401 }
        ) as T;
      }

      const standardUser: DesktopUserContext = {
        userId: auth.userId || 'unknown',
        email: auth.email,
        isLocalUser: false,
      };

      return handler(request, standardUser);
    }

    // Desktop mode: use local user context
    const user = getDesktopUserContext();

    if (!user && !options.allowAnonymous) {
      log.warn('No desktop user context found', { path: request.nextUrl.pathname });
      return NextResponse.json(
        { error: 'Local user context required for desktop mode' },
        { status: 401 }
      ) as T;
    }

    // Allow anonymous in desktop mode if configured
    if (!user && options.allowAnonymous) {
      return handler(request, {
        userId: 'anonymous',
        isLocalUser: true,
      });
    }

    // CRITICAL: Validate user object structure before proceeding
    if (!user || !user.userId || user.userId.trim().length === 0) {
      log.error('Invalid desktop user context', { 
        path: request.nextUrl.pathname,
        hasUserId: !!user?.userId,
        userIdLength: user?.userId?.length 
      });
      return NextResponse.json(
        { error: 'Invalid user context: userId is required' },
        { status: 500 }
      ) as T;
    }

    log.debug('Desktop auth bypassed', {
      path: request.nextUrl.pathname,
      userId: user.userId,
    });

    return handler(request, user);
  };
}

/**
 * Hook for getting current user in desktop mode (for client-side)
 */
export function useDesktopUser(): DesktopUserContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  // Check for desktop user in localStorage or session
  const desktopUserStr = localStorage.getItem('desktop_user');
  if (desktopUserStr) {
    try {
      return JSON.parse(desktopUserStr);
    } catch {
      return null;
    }
  }

  // Default local user
  return {
    userId: 'local-desktop-user',
    displayName: 'Local User',
    isLocalUser: true,
  };
}

/**
 * Set desktop user in localStorage (called from Tauri on login)
 */
export function setDesktopUser(user: DesktopUserContext): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('desktop_user', JSON.stringify(user));
  }
}

/**
 * Clear desktop user (logout)
 */
export function clearDesktopUser(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('desktop_user');
  }
}