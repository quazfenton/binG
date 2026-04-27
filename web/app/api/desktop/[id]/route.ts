/**
 * Desktop API Endpoint - Dynamic Route for /api/desktop/:id
 *
 * Handles GET and DELETE operations for desktop sandbox management
 * 
 * SECURITY: All endpoints require authentication and enforce ownership verification
 * to prevent IDOR (Insecure Direct Object Reference) attacks.
 */

import { NextRequest, NextResponse } from 'next/server';
import { e2bDesktopProvider } from '@/lib/computer/e2b-desktop-provider-enhanced';
import { verifyToken } from '@/lib/security/jwt-auth';
import { activeDesktops } from '../active-desktops';

/**
 * Extract userId from request authorization header
 */
async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  try {
    const result = await verifyToken(token);
    if (result.valid && result.payload) {
      return result.payload.userId;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Verify user owns the desktop session
 */
function verifyOwnership(session: any, userId: string): boolean {
  return session && session.userId === userId;
}

/**
 * GET /api/desktop/:id
 * Get desktop sandbox info (requires authentication + ownership)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Require authentication
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Check if desktop exists in active sessions
    const activeDesktop = activeDesktops.get(id);
    if (!activeDesktop) {
      return NextResponse.json(
        { success: false, error: 'Desktop not found or expired' },
        { status: 404 }
      );
    }

    // SECURITY: Verify ownership
    if (!verifyOwnership(activeDesktop, userId)) {
      return NextResponse.json(
        { success: false, error: 'Access denied: You do not own this desktop session' },
        { status: 403 }
      );
    }

    // Update last used time
    activeDesktop.lastUsed = Date.now();

    const desktop = activeDesktop.desktop;
    const streamUrl = desktop.getStreamUrl();

    return NextResponse.json({
      success: true,
      data: {
        sandboxId: id,
        streamUrl,
        createdAt: activeDesktop.createdAt,
        lastUsed: activeDesktop.lastUsed,
      },
    });
  } catch (error: any) {
    console.error('[Desktop API] GET error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to get desktop info' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/desktop/:id
 * Close desktop sandbox (requires authentication + ownership)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Require authentication
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const activeDesktop = activeDesktops.get(id);
    if (!activeDesktop) {
      return NextResponse.json(
        { success: false, error: 'Desktop not found or expired' },
        { status: 404 }
      );
    }

    // SECURITY: Verify ownership
    if (!verifyOwnership(activeDesktop, userId)) {
      return NextResponse.json(
        { success: false, error: 'Access denied: You do not own this desktop session' },
        { status: 403 }
      );
    }

    if (activeDesktop) {
      // Stop desktop
      await activeDesktop.desktop.stop();
      activeDesktops.delete(id);
      console.log('[Desktop API] Desktop closed:', id, 'for user:', userId);
    }

    return NextResponse.json({
      success: true,
      message: 'Desktop closed successfully',
    });
  } catch (error: any) {
    console.error('[Desktop API] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to close desktop' },
      { status: 500 }
    );
  }
}
