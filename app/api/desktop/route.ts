/**
 * Desktop API Endpoint
 *
 * Provides REST API for desktop sandbox management (E2B-based)
 * Replaces direct server-side imports in client components
 *
 * Endpoints:
 * - POST /api/desktop - Create desktop sandbox
 * 
 * Dynamic routes (handled in separate files):
 * - GET /api/desktop/:id - Get desktop info (see [id]/route.ts)
 * - DELETE /api/desktop/:id - Close desktop (see [id]/route.ts)
 * - POST /api/desktop/:id/action - Execute action (see [id]/[action]/route.ts)
 * - POST /api/desktop/:id/screenshot - Take screenshot (see [id]/[action]/route.ts)
 * - POST /api/desktop/:id/terminal - Execute terminal command (see [id]/[action]/route.ts)
 * - POST /api/desktop/:id/agent - Run agent loop (see [id]/[action]/route.ts)
 */

import { NextRequest, NextResponse } from 'next/server';
import { e2bDesktopProvider } from '@/lib/computer/e2b-desktop-provider-enhanced';

// Store active desktop sessions (in production, use Redis)
export const activeDesktops = new Map<string, {
  desktop: any;
  createdAt: number;
  lastUsed: number;
}>();

/**
 * POST /api/desktop
 * Create a new desktop sandbox
 */
export async function POST(request: NextRequest) {
  try {
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

    // Store in active sessions
    activeDesktops.set(sandboxId, {
      desktop: desktopHandle,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });

    console.log('[Desktop API] Created desktop:', sandboxId);

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
