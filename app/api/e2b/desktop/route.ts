/**
 * E2B Desktop API Endpoint
 * 
 * Provides REST API for E2B desktop sandbox management
 * Replaces direct server-side imports in client components
 * 
 * Endpoints:
 * - POST /api/e2b/desktop/create - Create desktop sandbox
 * - GET /api/e2b/desktop/:id - Get desktop info
 * - POST /api/e2b/desktop/:id/action - Execute computer use action
 * - POST /api/e2b/desktop/:id/screenshot - Take screenshot
 * - POST /api/e2b/desktop/:id/terminal - Execute terminal command
 * - DELETE /api/e2b/desktop/:id - Close desktop
 */

import { NextRequest, NextResponse } from 'next/server';
import { e2bDesktopProvider } from '@/lib/computer/e2b-desktop-provider-enhanced';
import { createComputerUseAgent, getComputerUseSystemPrompt } from '@/lib/sandbox/providers/computer-use-tools-enhanced';
import { openai } from '@ai-sdk/openai';

// Store active desktop sessions (in production, use Redis)
const activeDesktops = new Map<string, {
  desktop: any;
  createdAt: number;
  lastUsed: number;
}>();

/**
 * POST /api/e2b/desktop/create
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

    const sandboxId = desktopHandle.sandboxId;
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
  } catch (error: any) {
    console.error('[E2B Desktop API] Create failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to create desktop',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/e2b/desktop/:id
 * Get desktop info and stats
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
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
 * POST /api/e2b/desktop/:id/action
 * Execute computer use agent action
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const session = activeDesktops.get(id);

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Desktop not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { task, maxIterations = 50 } = body;

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task is required' },
        { status: 400 }
      );
    }

    const { desktop } = session;
    const actions: any[] = [];
    let iteration = 0;

    // Create computer use agent
    const agent = createComputerUseAgent({
      model: openai('gpt-4o'),
      systemPrompt: getComputerUseSystemPrompt(),
      tools: computerUseTools,
    });

    // Run agent loop
    while (iteration < maxIterations) {
      iteration++;
      
      // Get current screenshot
      const screenshot = desktop.getScreenshot();
      
      // Run agent iteration
      const result = await agent.run({
        task,
        screenshot,
        iteration,
      });

      if (result.action) {
        // Execute action on desktop
        const actionResult = await desktop.executeAction(result.action);
        actions.push({
          iteration,
          action: result.action,
          result: actionResult,
        });

        // Check if task is complete
        if (result.isComplete) {
          break;
        }
      }
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
  } catch (error: any) {
    console.error('[E2B Desktop API] Action failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to execute action' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/e2b/desktop/:id/screenshot
 * Take a screenshot
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const session = activeDesktops.get(id);

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Desktop not found' },
        { status: 404 }
      );
    }

    const { desktop } = session;
    const screenshot = desktop.getScreenshot();

    // Update last used
    session.lastUsed = Date.now();

    return NextResponse.json({
      success: true,
      data: { screenshot },
    });
  } catch (error: any) {
    console.error('[E2B Desktop API] Screenshot failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to take screenshot' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/e2b/desktop/:id/terminal
 * Execute terminal command
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const session = activeDesktops.get(id);

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Desktop not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { command } = body;

    if (!command) {
      return NextResponse.json(
        { success: false, error: 'Command is required' },
        { status: 400 }
      );
    }

    const { desktop } = session;
    const result = await desktop.executeCommand(command);

    // Update last used
    session.lastUsed = Date.now();

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('[E2B Desktop API] Terminal failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to execute command' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/e2b/desktop/:id
 * Close desktop sandbox
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
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
