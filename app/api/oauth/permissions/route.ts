/**
 * OAuth Permissions Management API
 * 
 * GET /api/oauth/permissions - Get all permissions for current user
 * POST /api/oauth/permissions/grant - Grant a permission
 * POST /api/oauth/permissions/revoke - Revoke a permission
 * GET /api/oauth/permissions/automation - Get permissions for automation tools
 */

import { NextRequest, NextResponse } from 'next/server';
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

export async function GET(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await auth0.getSession(request);
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // Get automation tool permissions
    if (action === 'automation') {
      // We need user ID from database - for now return Auth0 session
      // In production, map Auth0 user to local user ID
      return NextResponse.json({
        error: 'User ID mapping required',
        auth0User: session.user,
      }, { status: 501 });
    }

    // Get all permissions (requires local user ID)
    return NextResponse.json({
      error: 'User ID mapping required',
      auth0User: session.user,
    }, { status: 501 });
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

      // Note: Need to map Auth0 user to local user ID
      return NextResponse.json({
        error: 'User ID mapping required',
        request: body,
      }, { status: 501 });
    }

    // Revoke permission
    if (action === 'revoke') {
      if (!connectionId || !serviceName) {
        return NextResponse.json({ 
          error: 'connectionId and serviceName required' 
        }, { status: 400 });
      }

      // Note: Need to map Auth0 user to local user ID
      return NextResponse.json({
        error: 'User ID mapping required',
        request: body,
      }, { status: 501 });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('[OAuth Permissions] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
