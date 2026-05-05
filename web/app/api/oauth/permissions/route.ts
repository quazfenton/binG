/**
 * OAuth Permissions Management API
 *
 * GET /api/oauth/permissions - Get all permissions for current user
 * POST /api/oauth/permissions/grant - Grant a permission
 * POST /api/oauth/permissions/revoke - Revoke a permission
 * GET /api/oauth/permissions/automation - Get permissions for automation tools
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { auth0 } from '@/lib/auth0';
import {
  getUserConnectionPermissions,
  grantServicePermission,
  revokeServicePermission,
  getAutomationToolPermissions,
  hasServicePermission,
  type PermissionLevel,
  type ServiceType,
} from '@/lib/oauth/permission-tracker';

// Use Auth0 user ID as the user identifier
function getUserId(session: any): string {
  return session.user.sub;
}

export async function GET(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await auth0.getSession(request);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = getUserId(session);
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // Get automation tool permissions
    if (action === 'automation') {
      const permissions = await getAutomationToolPermissions(userId as any);
      return NextResponse.json({
        success: true,
        permissions,
        userId,
      });
    }

    // Get all permissions
    const permissions = await getUserConnectionPermissions(userId as any);
    return NextResponse.json({
      success: true,
      permissions,
      userId,
    });
  } catch (error: any) {
    console.error('[OAuth Permissions] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = getUserId(session);
    const body = await request.json();
    const { action, connectionId, serviceName, permissionLevel } = body;

    if (!action) {
      return NextResponse.json({ error: 'Action required' }, { status: 400 });
    }

    // Grant permission
    if (action === 'grant') {
      if (!connectionId || !serviceName) {
        return NextResponse.json({
          error: 'connectionId and serviceName required'
        }, { status: 400 });
      }

      // Validate service name
      const validServices = ['gmail', 'drive', 'calendar', 'contacts', 'docs', 'sheets', 'slides', 'tasks', 'keep', 'photos', 'youtube', 'maps', 'custom'];
      if (!validServices.includes(serviceName)) {
        return NextResponse.json({
          error: `Invalid service. Must be one of: ${validServices.join(', ')}`
        }, { status: 400 });
      }

      // Validate permission level
      const validLevels = ['read', 'write', 'full'];
      if (permissionLevel && !validLevels.includes(permissionLevel)) {
        return NextResponse.json({
          error: `Invalid permission level. Must be one of: ${validLevels.join(', ')}`
        }, { status: 400 });
      }

      await grantServicePermission(
        userId as any,
        connectionId,
        serviceName as ServiceType,
        permissionLevel as PermissionLevel
      );

      return NextResponse.json({
        success: true,
        message: 'Permission granted',
        userId,
        connectionId,
        serviceName,
      });
    }

    // Revoke permission
    if (action === 'revoke') {
      if (!connectionId || !serviceName) {
        return NextResponse.json({
          error: 'connectionId and serviceName required'
        }, { status: 400 });
      }

      await revokeServicePermission(
        userId as any,
        connectionId,
        serviceName as ServiceType
      );

      return NextResponse.json({
        success: true,
        message: 'Permission revoked',
        userId,
        connectionId,
        serviceName,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('[OAuth Permissions] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
