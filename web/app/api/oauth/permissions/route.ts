import { NextRequest, NextResponse } from 'next/server';

import { auth0 } from '@/lib/auth0';
import {
  getUserConnectionPermissions,
  grantServicePermission,
  revokeServicePermission,
  getAutomationToolPermissions,
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
    const path = request.nextUrl.pathname;
    const segments = path.split('/').filter(Boolean);

    // GET /api/oauth/permissions/automation
    if (segments.length === 4 && segments[3] === 'automation') {
      const permissions = await getAutomationToolPermissions(userId as any);
      return NextResponse.json({ success: true, permissions, userId });
    }

    // GET /api/oauth/permissions
    const permissions = await getUserConnectionPermissions(userId as any);
    return NextResponse.json({ success: true, permissions, userId });
  } catch (error: any) {
    console.error('[OAuth Permissions] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}

// POST /api/oauth/permissions/grant | /api/oauth/permissions/revoke
export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = getUserId(session);
    const path = request.nextUrl.pathname;
    const segments = path.split('/').filter(Boolean);
    const body = await request.json();
    const { connectionId, serviceName, permissionLevel } = body;

    if (segments.length !== 4) {
      return NextResponse.json({ error: 'Not found. Use /oauth/permissions/grant|/oauth/permissions/revoke' }, { status: 404 });
    }

    const action = segments[3];

    if (action === 'grant') {
      if (!connectionId || !serviceName) {
        return NextResponse.json({ error: 'connectionId and serviceName required' }, { status: 400 });
      }

      const validServices = ['gmail', 'drive', 'calendar', 'contacts', 'docs', 'sheets', 'slides', 'tasks', 'keep', 'photos', 'youtube', 'maps', 'custom'];
      if (!validServices.includes(serviceName)) {
        return NextResponse.json({ error: `Invalid service. Must be one of: ${validServices.join(', ')}` }, { status: 400 });
      }

      const validLevels = ['read', 'write', 'full'];
      if (permissionLevel && !validLevels.includes(permissionLevel)) {
        return NextResponse.json({ error: `Invalid permission level. Must be one of: ${validLevels.join(', ')}` }, { status: 400 });
      }

      await grantServicePermission(userId as any, connectionId, serviceName as ServiceType, permissionLevel as PermissionLevel);
      return NextResponse.json({ success: true, message: 'Permission granted', userId, connectionId, serviceName });
    }

    if (action === 'revoke') {
      if (!connectionId || !serviceName) {
        return NextResponse.json({ error: 'connectionId and serviceName required' }, { status: 400 });
      }

      await revokeServicePermission(userId as any, connectionId, serviceName as ServiceType);
      return NextResponse.json({ success: true, message: 'Permission revoked', userId, connectionId, serviceName });
    }

    return NextResponse.json({ error: 'Not found. Use /oauth/permissions/grant|/oauth/permissions/revoke' }, { status: 404 });
  } catch (error: any) {
    console.error('[OAuth Permissions] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
