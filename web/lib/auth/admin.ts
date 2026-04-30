/**
 * Admin Authentication Helper
 *
 * HIGH-6 fix: DB-first admin authorization with env var fallback.
 *
 * Priority order:
 * 1. Check user_roles table in DB (granular RBAC, audit trail)
 * 2. Fall back to ADMIN_USER_IDS env var if DB not configured (backward compat)
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
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Admin');

// =========================================================================
// Config
// =========================================================================

function getAdminUserIds(): string[] {
  return process.env.ADMIN_USER_IDS?.split(',').map(s => s.trim()).filter(Boolean) || [];
}

export function isAdminAccessConfigured(): boolean {
  // DB roles table exists (or will exist after migration) — always considered configured
  // Env var is a fallback for bootstrapping
  return checkDbRolesExist() || isEnvAdminConfigured();
}

/**
 * Check if any active roles exist in the database.
 * Used for error messaging (not for auth decisions).
 */
function checkDbRolesExist(): boolean {
  try {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) return false;
    const row = db.prepare('SELECT 1 FROM user_roles WHERE is_active = TRUE LIMIT 1').get();
    return !!row;
  } catch {
    return false; // Table may not exist yet
  }
}

export function isEnvAdminConfigured(): boolean {
  return getAdminUserIds().length > 0;
}

// =========================================================================
// DB-first Role Checking
// =========================================================================

/**
 * Check if a user has a specific role in the database.
 * Returns true if user has an active, non-expired role record.
 */
function checkDbRole(userId: string, role: string = 'admin'): boolean {
  try {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) return false;

    const row = db.prepare(`
      SELECT 1 FROM user_roles
      WHERE user_id = ? AND role = ? AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      LIMIT 1
    `).get(userId, role);

    return !!row;
  } catch (error) {
    // Table may not exist yet (migration not run) — log and fall through
    logger.debug('DB role check failed, falling back to env var', {
      userId,
      role,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if user is admin — DB-first, env var fallback.
 *
 * 1. Try user_roles table (supports granular RBAC)
 * 2. Fall back to ADMIN_USER_IDS env var (backward compatibility)
 */
function isAdminUser(userId: string): boolean {
  // DB check first
  if (checkDbRole(userId, 'admin')) {
    return true;
  }

  // Fallback: env var (backward compat)
  const envAdminIds = getAdminUserIds();
  if (envAdminIds.length > 0 && envAdminIds.includes(userId)) {
    return true;
  }

  return false;
}

// =========================================================================
// Admin Audit Logging
// =========================================================================

/**
 * Log an admin action to admin_audit_log table.
 * Non-blocking: failures are logged but don't affect the action.
 */
export function logAdminAction(params: {
  actorUserId: string;
  action: string;
  targetUserId?: string;
  targetResource?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): void {
  try {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) return;

    db.prepare(`
      INSERT INTO admin_audit_log (actor_user_id, action, target_user_id, target_resource, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.actorUserId,
      params.action,
      params.targetUserId || null,
      params.targetResource || null,
      params.details ? JSON.stringify(params.details) : null,
      params.ipAddress || null,
      params.userAgent || null
    );
  } catch (error) {
    logger.error('Failed to log admin action', error as Error);
  }
}

// =========================================================================
// Role Management (for admin API endpoints)
// =========================================================================

export interface RoleAssignment {
  userId: string;
  role: string;
  resource?: string;
  grantedBy: string;
  expiresAt?: Date;
}

/**
 * Grant a role to a user. Returns true on success.
 */
export function grantRole(params: RoleAssignment): { success: boolean; error?: string } {
  try {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) {
      return { success: false, error: 'Database not available' };
    }

    db.prepare(`
      INSERT OR REPLACE INTO user_roles (user_id, role, resource, granted_by, expires_at, is_active)
      VALUES (?, ?, ?, ?, ?, TRUE)
    `).run(
      params.userId,
      params.role,
      params.resource || null,
      params.grantedBy,
      params.expiresAt?.toISOString() || null
    );

    logger.info('Role granted', {
      userId: params.userId,
      role: params.role,
      grantedBy: params.grantedBy,
    });

    return { success: true };
  } catch (error) {
    logger.error('Failed to grant role', error as Error);
    return { success: false, error: 'Failed to grant role' };
  }
}

/**
 * Revoke a role from a user. Returns true on success.
 */
export function revokeRole(userId: string, role: string, resource?: string): { success: boolean; error?: string } {
  try {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) {
      return { success: false, error: 'Database not available' };
    }

    if (resource) {
      db.prepare(`
        UPDATE user_roles SET is_active = FALSE
        WHERE user_id = ? AND role = ? AND resource = ?
      `).run(userId, role, resource);
    } else {
      db.prepare(`
        UPDATE user_roles SET is_active = FALSE
        WHERE user_id = ? AND role = ? AND resource IS NULL
      `).run(userId, role);
    }

    logger.info('Role revoked', { userId, role, resource });
    return { success: true };
  } catch (error) {
    logger.error('Failed to revoke role', error as Error);
    return { success: false, error: 'Failed to revoke role' };
  }
}

/**
 * Get all active roles for a user.
 */
export function getUserRoles(userId: string): Array<{ role: string; resource: string | null; grantedBy: string; grantedAt: string }> {
  try {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) return [];

    return db.prepare(`
      SELECT role, resource, granted_by AS grantedBy, granted_at AS grantedAt
      FROM user_roles
      WHERE user_id = ? AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      ORDER BY granted_at DESC
    `).all(userId) as Array<{ role: string; resource: string | null; grantedBy: string; grantedAt: string }>;
  } catch (error) {
    logger.error('Failed to get user roles', error as Error);
    return [];
  }
}

// =========================================================================
// For API Routes
// =========================================================================

// HIGH-8 fix: email removed from AdminResult — caller should fetch from DB if needed
export interface AdminResult {
  userId: string;
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

  // HIGH-6 fix: DB-first check, then env var fallback
  if (!isAdminUser(authResult.userId)) {
    logger.warn('Admin access denied', {
      userId: authResult.userId,
      path: req.nextUrl?.pathname,
    });
    return null;
  }

  // HIGH-8 fix: email removed — caller fetches from DB if needed
  return { userId: authResult.userId };
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
        error: configured ? 'Forbidden: Admin access required' : 'Admin access not configured. Set ADMIN_USER_IDS in .env or grant roles via DB',
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
  // Check ALL known session/auth cookie names
  const authToken = cookieStore.get('auth-token')?.value
    || cookieStore.get('token')?.value
    || cookieStore.get('next-auth.session-token')?.value
    || cookieStore.get('session_id')?.value;

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

    // HIGH-6 fix: DB-first check, then env var fallback
    if (!isAdminUser(authResult.userId)) {
      logger.warn('Page access denied: user is not admin', { userId: authResult.userId });
      redirect('/?error=access_denied');
    }

    // HIGH-8 fix: email removed — caller fetches from DB if needed
    return { userId: authResult.userId };
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
