/**
 * Desktop API Endpoint - Dynamic Route for /api/desktop/:id
 *
 * Handles GET and DELETE operations for desktop sandbox management
 */

import { NextRequest, NextResponse } from 'next/server';
import { e2bDesktopProvider } from '@/lib/computer/e2b-desktop-provider-enhanced';

// Store active desktop sessions (in production, use Redis)
const activeDesktops = new Map<string, {
  desktop: any;
  createdAt: number;
  lastUsed: number;
}>();

/**
 * GET /api/desktop/:id
 * Get desktop sandbox info
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if desktop exists in active sessions
    const activeDesktop = activeDesktops.get(id);
    if (!activeDesktop) {
      return NextResponse.json(
        { success: false, error: 'Desktop not found or expired' },
        { status: 404 }
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
 * Close desktop sandbox
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const activeDesktop = activeDesktops.get(id);
    if (activeDesktop) {
      // Stop desktop
      await activeDesktop.desktop.stop();
      activeDesktops.delete(id);
      console.log('[Desktop API] Desktop closed:', id);
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

// Export activeDesktops for use in action route
export { activeDesktops };
