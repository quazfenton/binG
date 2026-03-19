/**
 * Desktop API Endpoint
 *
 * Provides REST API for desktop sandbox management (E2B-based)
 * Replaces direct server-side imports in client components
 *
 * SECURITY: All endpoints require authentication and enforce ownership verification
 * to prevent IDOR (Insecure Direct Object Reference) attacks.
 *
 * Endpoints:
 * - POST /api/desktop - Create desktop sandbox (requires auth)
 *
 * Dynamic routes (handled in separate files):
 * - GET /api/desktop/:id - Get desktop info (see [id]/route.ts) - requires auth + ownership
 * - DELETE /api/desktop/:id - Close desktop (see [id]/route.ts) - requires auth + ownership
 * - POST /api/desktop/:id/action - Execute action (see [id]/[action]/route.ts) - requires auth + ownership
 * - POST /api/desktop/:id/screenshot - Take screenshot (see [id]/[action]/route.ts) - requires auth + ownership
 * - POST /api/desktop/:id/terminal - Execute terminal command (see [id]/[action]/route.ts) - requires auth + ownership
 * - POST /api/desktop/:id/agent - Run agent loop (see [id]/[action]/route.ts) - requires auth + ownership
 */

import { NextRequest, NextResponse } from 'next/server';
import { e2bDesktopProvider } from '@/lib/computer/e2b-desktop-provider-enhanced';
import { verifyToken } from '@/lib/security/jwt-auth';

// Store active desktop sessions with user ownership (in production, use Redis)
const activeDesktops = new Map<string, {
  desktop: any;
  userId: string;
  createdAt: number;
  lastUsed: number;
}>();

// Export for use in other routes
export { activeDesktops };

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
 * POST /api/desktop
 * Create a new desktop sandbox (requires authentication)
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { resolution = [1024, 720], dpi = 96, timeoutMs = 300000 } = body;

    // Create desktop sandbox
    const desktopHandle = await e2bDesktopProvider.createDesktop({
      resolution,
      dpi,
      timeoutMs,
      startStreaming: true,
    });

    const sandboxId = desktopHandle.id;
    const streamUrl = desktopHandle.getStreamUrl();

    // Store in active sessions WITH USER OWNERSHIP
    activeDesktops.set(sandboxId, {
      desktop: desktopHandle,
      userId, // SECURITY: Track ownership
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });

    console.log('[Desktop API] Created desktop:', sandboxId, 'for user:', userId);

    return NextResponse.json({
      success: true,
      data: {
        sandboxId,
        streamUrl,
        createdAt: Date.now(),
      },
    });
  } catch (error: any) {
    console.error('[Desktop API] POST error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create desktop' },
      { status: 500 }
    );
  }
}
