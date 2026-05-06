/**
 * Desktop API Endpoint - Dynamic Route for /api/desktop/:id/:action
 *
 * Handles POST operations for desktop actions (screenshot, terminal, computer use)
 * 
 * SECURITY: All endpoints require authentication and enforce ownership verification
 * to prevent IDOR (Insecure Direct Object Reference) attacks.
 */

import { NextRequest, NextResponse } from 'next/server';


import { e2bDesktopProvider, type DesktopAction } from '@/lib/computer/e2b-desktop-provider-enhanced';
import { verifyToken } from '@/lib/security/jwt-auth';
import { activeDesktops } from '../../active-desktops';

/**
 * Extract userId from request authorization header
 */
async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const token = match[1];
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
 * POST /api/desktop/:id/:action
 * Execute action on desktop sandbox (requires authentication + ownership)
 *
 * Actions:
 * - action - Execute computer use action
 * - screenshot - Take screenshot
 * - terminal - Execute terminal command
 * - agent - Run agent loop
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  try {
    const { id, action } = await params;

    // Require authentication
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Check if desktop exists
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

    const body = await request.json();

    // Handle different actions
    switch (action) {
      case 'action': {
        // Execute computer use action
        const desktopAction = body.action as DesktopAction;
        const result = await desktop.executeAction(desktopAction);
        return NextResponse.json({
          success: true,
          data: result,
        });
      }

      case 'screenshot': {
        // Take screenshot
        const screenshotBase64 = await desktop.screenshotBase64();
        return NextResponse.json({
          success: true,
          data: {
            screenshotBase64,
            timestamp: Date.now(),
          },
        });
      }

      case 'terminal': {
        // Execute terminal command
        const { command } = body;
        if (!command) {
          return NextResponse.json(
            { success: false, error: 'Command is required' },
            { status: 400 }
          );
        }
        const result = await desktop.runCommand(command);
        return NextResponse.json({
          success: true,
          data: result,
        });
      }

      case 'agent': {
        // Run agent loop
        const { task, maxIterations = 50 } = body;
        if (!task) {
          return NextResponse.json(
            { success: false, error: 'Task is required' },
            { status: 400 }
          );
        }
        
        // Stream agent results
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const result of desktop.runAgentLoop(task, { maxIterations })) {
                controller.enqueue(encoder.encode(JSON.stringify(result) + '\n'));
              }
              controller.close();
            } catch (error: any) {
              controller.error(error);
            }
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error('[Desktop API] Action error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to execute action' },
      { status: 500 }
    );
  }
}
