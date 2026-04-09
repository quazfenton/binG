/**
 * Admin Authentication Helper
 *
 * Provides shared admin checks for API routes and server component pages.
 *
 * Security model:
 * - ADMIN_USER_IDS env var must contain comma-separated user IDs
 * - If empty → DENY ALL (no fallback)
 *
 * Usage in API routes:
 *   import { requireAdminApi } from '@/lib/auth/admin';
 *   const admin = await requireAdminApi(req);
 *   if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 *
 * Usage in server pages:
 *   import { requireAdminPage } from '@/lib/auth/admin';
 *   const admin = await requireAdminPage();  // redirects if not admin
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/jwt';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

// =========================================================================
// Config
// =========================================================================

function getAdminUserIds(): string[] {
  return process.env.ADMIN_USER_IDS?.split(',').map(s => s.trim()).filter(Boolean) || [];
}

export function isAdminAccessConfigured(): boolean {
  return getAdminUserIds().length > 0;
}

// =========================================================================
// For API Routes
// =========================================================================

export interface AdminResult {
  userId: string;
  email?: string;
}

/**
 * Verify admin access for API routes.
 * Returns null if not authenticated, not admin, or admin not configured.
 */
export async function requireAdminApi(req: NextRequest): Promise<AdminResult | null> {
  const authResult = await verifyAuth(req);
  if (!authResult.success || !authResult.userId) {
    return null;
  }

  const adminUserIds = getAdminUserIds();

  // ADMIN_USER_IDS must be configured
  if (adminUserIds.length === 0) {
    console.warn('[Admin] Access denied: ADMIN_USER_IDS not configured');
    return null;
  }

  if (!adminUserIds.includes(authResult.userId)) {
    return null;
  }

  return { userId: authResult.userId, email: authResult.email };
}

/**
 * Verify admin access for API routes.
 * Returns 403 response if not admin or not configured.
 */
export async function requireAdminApiOrForbidden(req: NextRequest): Promise<AdminResult | NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) {
    const configured = isAdminAccessConfigured();
    return NextResponse.json(
      {
        error: configured ? 'Forbidden: Admin access required' : 'Admin access not configured. Set ADMIN_USER_IDS in .env',
      },
      { status: 403 }
    );
  }
  return admin;
}

// =========================================================================
// For Server Components (page.tsx)
// =========================================================================

/**
 * Verify admin access for server component pages.
 * Redirects to /login if not authenticated, or /?error=access_denied if not admin.
 */
export async function requireAdminPage(): Promise<AdminResult> {
  const cookieStore = await cookies();
  const authToken = cookieStore.get('auth-token')?.value
    || cookieStore.get('token')?.value
    || cookieStore.get('next-auth.session-token')?.value;

  if (!authToken) {
    redirect('/login?redirect=' + encodeURIComponent(await getCurrentPath()));
  }

  const fakeUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const mockNextReq = {
    headers: new Headers({ authorization: `Bearer ${authToken}` }),
  } as any;

  try {
    const authResult = await verifyAuth(mockNextReq);
    if (!authResult.success || !authResult.userId) {
      redirect('/login?redirect=' + encodeURIComponent(await getCurrentPath()));
    }

    const adminUserIds = getAdminUserIds();

    // ADMIN_USER_IDS must be configured
    if (adminUserIds.length === 0) {
      console.warn('[Admin] Page access denied: ADMIN_USER_IDS not configured');
      redirect('/?error=admin_not_configured');
    }

    if (!adminUserIds.includes(authResult.userId)) {
      redirect('/?error=access_denied');
    }

    return { userId: authResult.userId, email: authResult.email };
  } catch {
    redirect('/login?redirect=' + encodeURIComponent(await getCurrentPath()));
  }
}

// =========================================================================
// Helpers
// =========================================================================

async function getCurrentPath(): Promise<string> {
  const headersList = await headers();
  const url = headersList.get('x-url') || headersList.get('referer') || '/admin';
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
