/**
 * Agent V2 API Routes
 * 
 * API endpoints for OpenCode V2 Engine with Nullclaw integration.
 * Provides session management, task execution, and cloud offload.
 */

import { NextRequest, NextResponse } from 'next/server';


import { z } from 'zod';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { agentSessionManager } from '@/lib/session/agent/agent-session-manager';
import { nullclawIntegration, type NullclawTask, cloudAgentOffload } from '@bing/shared/agent';
import { sandboxFilesystemSync } from '@/lib/virtual-filesystem/sync/sandbox-filesystem-sync';
import { createOpenCodeEngine } from '@/lib/session/agent/opencode-engine-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:AgentV2');

// Request schemas
const createSessionSchema = z.object({
  conversationId: z.string().min(1),
  mode: z.enum(['opencode', 'nullclaw', 'hybrid']).optional().default('opencode'),
  enableNullclaw: z.boolean().optional().default(false),
  enableCloudOffload: z.boolean().optional().default(false),
  enableMCP: z.boolean().optional().default(true),
  timeout: z.number().optional().default(3600),
});

const executeTaskSchema = z.object({
  sessionId: z.string().min(1),
  task: z.string().min(1),
  stream: z.boolean().optional().default(false),
});

const syncSchema = z.object({
  sessionId: z.string().min(1),
  direction: z.enum(['to-sandbox', 'from-sandbox', 'bidirectional']).default('bidirectional'),
});

const cloudOffloadSchema = z.object({
  sessionId: z.string().min(1),
  task: z.string().min(1),
  provider: z.enum(['daytona', 'e2b']).default('daytona'),
  resources: z.object({
    cpu: z.number().optional().default(2),
    memory: z.number().optional().default(4),
  }).optional(),
  timeout: z.number().optional().default(1800),
});

/**
 * POST /api/agent/v2/session
 * Create or get agent session
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';

    // Parse request
    const body = await request.json();
    const validation = createSessionSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 },
      );
    }

    const { conversationId, mode, enableNullclaw, enableCloudOffload, enableMCP, timeout } = validation.data;

    logger.info(`Creating V2 session for ${userId}:${conversationId} (mode: ${mode})`);

    // Get or create session
    const session = await agentSessionManager.getOrCreateSession(userId, conversationId, {
      mode,
      enableNullclaw,
      enableCloudOffload,
      enableMCP,
      timeout,
    });

    // Initialize Nullclaw if enabled
    let nullclawAvailable = false;
    if (enableNullclaw) {
      const { initializeNullclaw, isNullclawAvailable } = await import('@bing/shared/agent/nullclaw-integration');
      await initializeNullclaw();
      nullclawAvailable = isNullclawAvailable();
    }

    // Sync VFS to sandbox
    if (session.sandboxHandle?.id) {
      await sandboxFilesystemSync.syncVFSToSandbox(session.sandboxHandle.id, userId);
    }

    return NextResponse.json({
      success: true,
      data: {
        sessionId: session.id,
        sessionKey: `${session.userId}$${session.conversationId}`,
        userId: session.userId,
        conversationId: session.conversationId,
        status: session.state,
        workspacePath: session.workspacePath,
        nullclawAvailable,
        v2SessionId: session.v2SessionId,
        mcpServerUrl: process.env.MCP_CLI_PORT
          ? `http://localhost:${process.env.MCP_CLI_PORT}`
          : undefined,
        createdAt: session.createdAt,
      },
    });

  } catch (error: any) {
    logger.error('Failed to create V2 session', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create session' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/agent/v2/session
 * Get session info
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';

    const searchParams = request.nextUrl.searchParams;
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 },
      );
    }

    const session = agentSessionManager.getSession(userId, conversationId);

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        sessionId: session.id,
        sessionKey: `${session.userId}$${session.conversationId}`,
        userId: session.userId,
        conversationId: session.conversationId,
        status: session.state,
        workspacePath: session.workspacePath,
        nullclawEndpoint: session.nullclawEndpoint,
        v2SessionId: session.v2SessionId,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
      },
    });

  } catch (error: any) {
    logger.error('Failed to get session', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get session' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/agent/v2/session
 * Destroy session
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';

    const searchParams = request.nextUrl.searchParams;
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 },
      );
    }

    await agentSessionManager.destroySession(userId, conversationId);

    return NextResponse.json({
      success: true,
      message: 'Session destroyed',
    });

  } catch (error: any) {
    logger.error('Failed to destroy session', error);
    return NextResponse.json(
      { error: error.message || 'Failed to destroy session' },
      { status: 500 },
    );
  }
}
