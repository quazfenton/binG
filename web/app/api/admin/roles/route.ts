/**
 * Admin Role Management API
 *
 * HIGH-6 fix: Database-backed admin role management.
 * Allows admins to grant/revoke roles and view user roles.
 * All actions are audited via admin_audit_log.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { requireAdminApiOrForbidden, grantRole, revokeRole, getUserRoles, logAdminAction } from '@/lib/auth/admin';
import { csrfCheckOrReject } from '@/lib/auth/csrf';

/**
 * GET /api/admin/roles?userId=...
 * List all active roles for a user.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdminApiOrForbidden(request);
  if (admin instanceof NextResponse) return admin;

  const userId = request.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ success: false, error: 'userId query parameter is required' }, { status: 400 });
  }

  const roles = await getUserRoles(userId);
  return NextResponse.json({ success: true, roles });
}

/**
 * POST /api/admin/roles
 * Grant a role to a user.
 *
 * Body: { userId, role, resource?, expiresAt? }
 */
export async function POST(request: NextRequest) {
  // CSRF protection
  const csrfReject = csrfCheckOrReject(request);
  if (csrfReject) return csrfReject;

  const admin = await requireAdminApiOrForbidden(request);
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await request.json();
    const { userId, role, resource, expiresAt } = body;

    if (!userId || !role) {
      return NextResponse.json(
        { success: false, error: 'userId and role are required' },
        { status: 400 }
      );
    }

    // Validate role name (allowlist)
    const ALLOWED_ROLES = ['admin', 'billing', 'moderator', 'support', 'developer'];
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json(
        { success: false, error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(', ')}` },
        { status: 400 }
      );
    }

    const result = await grantRole({
      userId,
      role,
      resource,
      grantedBy: admin.userId,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }

    // Audit log
    await logAdminAction({
      actorUserId: admin.userId,
      action: 'role:grant',
      targetUserId: userId,
      targetResource: resource || undefined,
      details: { role, expiresAt },
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ success: true, message: `Role '${role}' granted to user ${userId}` });
  } catch (error) {
    console.error('[Admin Roles] Grant error:', error);
    return NextResponse.json({ success: false, error: 'Failed to grant role' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/roles
 * Revoke a role from a user.
 *
 * Body: { userId, role, resource? }
 */
export async function DELETE(request: NextRequest) {
  // CSRF protection
  const csrfReject = csrfCheckOrReject(request);
  if (csrfReject) return csrfReject;

  const admin = await requireAdminApiOrForbidden(request);
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await request.json();
    const { userId, role, resource } = body;

    if (!userId || !role) {
      return NextResponse.json(
        { success: false, error: 'userId and role are required' },
        { status: 400 }
      );
    }

    const result = await revokeRole(userId, role, resource);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }

    // Audit log
    await logAdminAction({
      actorUserId: admin.userId,
      action: 'role:revoke',
      targetUserId: userId,
      targetResource: resource || undefined,
      details: { role },
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ success: true, message: `Role '${role}' revoked from user ${userId}` });
  } catch (error) {
    console.error('[Admin Roles] Revoke error:', error);
    return NextResponse.json({ success: false, error: 'Failed to revoke role' }, { status: 500 });
  }
}
