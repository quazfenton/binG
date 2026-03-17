/**
 * Desktop API Endpoint
 *
 * Provides REST API for desktop sandbox management (E2B-based)
 * Replaces direct server-side imports in client components
 *
 * Endpoints:
 * - POST /api/desktop - Create desktop sandbox
 * - GET /api/desktop/:id - Get desktop info
 * - POST /api/desktop/:id/action - Execute computer use action
 * - POST /api/desktop/:id/screenshot - Take screenshot
 * - POST /api/desktop/:id/terminal - Execute terminal command
 * - DELETE /api/desktop/:id - Close desktop
 */

import { NextRequest, NextResponse } from 'next/server';
import { e2bDesktopProvider, type DesktopAction, type AgentLoopResult } from '@/lib/computer/e2b-desktop-provider-enhanced';

// Store active desktop sessions (in production, use Redis)
const activeDesktops = new Map<string, {
  desktop: any;
  createdAt: number;
  lastUsed: number;
}>();

/**
 * POST /api/desktop
 * Create a new desktop sandbox or execute action based on path
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id?: string; action?: string }> }) {
  try {
    const { id, action } = await params;
    
    // If no id, create a new desktop
    if (!id) {
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

      return NextResponse.json({
        success: true,
        data: {
          sandboxId,
          streamUrl,
          resolution,
          createdAt: Date.now(),
        },
      });
    }

    // Get existing desktop session
    const session = activeDesktops.get(id);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Desktop not found' },
        { status: 404 }
      );
    }

    const { desktop } = session;

    // Handle different actions based on path
    if (action === 'action') {
      const body = await request.json();
      const { task, maxIterations = 50 } = body;

      if (!task) {
        return NextResponse.json(
          { success: false, error: 'Task is required' },
          { status: 400 }
        );
      }

      const actions: any[] = [];
      let iteration = 0;

      // Run agent loop
      while (iteration < maxIterations) {
        iteration++;

        // Get current screenshot
        const screenshot = desktop.getScreenshot();

        // TODO: Implement agent iteration logic
        // For now, just break after one iteration
        break;
      }

      // Update last used
      session.lastUsed = Date.now();

      return NextResponse.json({
        success: true,
        data: {
          iterations: iteration,
          actions,
          completed: iteration < maxIterations,
        },
      });
    }

    if (action === 'screenshot') {
      const screenshot = desktop.getScreenshot();

      // Update last used
      session.lastUsed = Date.now();

      return NextResponse.json({
        success: true,
        data: { screenshot },
      });
    }

    if (action === 'terminal') {
      const body = await request.json();
      const { command } = body;

      if (!command) {
        return NextResponse.json(
          { success: false, error: 'Command is required' },
          { status: 400 }
        );
      }

      const result = await desktop.executeCommand(command);

      // Update last used
      session.lastUsed = Date.now();

      return NextResponse.json({
        success: true,
        data: result,
      });
    }

    // Default: return desktop info
    const stats = desktop.getStats();
    const screenshot = desktop.getScreenshot();

    // Update last used
    session.lastUsed = Date.now();

    return NextResponse.json({
      success: true,
      data: {
        sandboxId: desktop.sandboxId,
        streamUrl: desktop.getStreamUrl(),
        stats,
        screenshot,
        lastUsed: session.lastUsed,
      },
    });
  } catch (error: any) {
    console.error('[E2B Desktop API] Request failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Request failed',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/desktop/:id
 * Get desktop info and stats
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = activeDesktops.get(id);

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Desktop not found' },
        { status: 404 }
      );
    }

    const { desktop } = session;

    // Update last used
    session.lastUsed = Date.now();

    // Get stats
    const stats = desktop.getStats();
    const screenshot = desktop.getScreenshot();

    return NextResponse.json({
      success: true,
      data: {
        sandboxId: desktop.sandboxId,
        streamUrl: desktop.getStreamUrl(),
        stats,
        screenshot,
        lastUsed: session.lastUsed,
      },
    });
  } catch (error: any) {
    console.error('[E2B Desktop API] Get failed:', error);
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
    const session = activeDesktops.get(id);

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Desktop not found' },
        { status: 404 }
      );
    }

    const { desktop } = session;

    // Close desktop
    await desktop.close();

    // Remove from active sessions
    activeDesktops.delete(id);

    return NextResponse.json({
      success: true,
      message: 'Desktop closed successfully',
    });
  } catch (error: any) {
    console.error('[E2B Desktop API] Close failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to close desktop' },
      { status: 500 }
    );
  }
}
