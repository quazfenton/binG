/**
 * Agent V2 Sync API Route
 * 
 * Sync VFS ↔ Sandbox filesystem for agent sessions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { agentSessionManager } from '@/lib/agent/agent-session-manager';
import { agentFSBridge } from '@/lib/agent/agent-fs-bridge';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:AgentV2:Sync');

const syncSchema = z.object({
  sessionId: z.string().min(1),
  direction: z.enum(['to-sandbox', 'from-sandbox', 'bidirectional']).default('bidirectional'),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  conversationId: z.string().optional(),
});

/**
 * POST /api/agent/v2/sync
 * Sync VFS ↔ Sandbox
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';

    // Parse request
    const body = await request.json();
    const validation = syncSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 },
      );
    }

    const { sessionId, direction, includePatterns, excludePatterns, conversationId } = validation.data;

    // Get session
    const resolvedConversationId =
      conversationId ||
      sessionId.split(':')[1] ||
      agentSessionManager.getSessionById(sessionId)?.conversationId ||
      sessionId;
    const session = agentSessionManager.getSession(userId, resolvedConversationId);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or expired' },
        { status: 404 },
      );
    }

    logger.info(`Syncing session ${session.id} (direction: ${direction})`);

    let result;
    
    if (direction === 'bidirectional') {
      result = await agentFSBridge.syncBidirectional(userId, resolvedConversationId, {
        includePatterns,
        excludePatterns,
      });
    } else if (direction === 'to-sandbox') {
      result = await agentFSBridge.syncToSandbox(userId, resolvedConversationId, {
        direction: 'to-sandbox',
        includePatterns,
        excludePatterns,
      });
    } else {
      result = await agentFSBridge.syncFromSandbox(userId, resolvedConversationId, {
        direction: 'from-sandbox',
        includePatterns,
        excludePatterns,
      });
    }

    return NextResponse.json({
      success: result.success,
      data: result,
    });

  } catch (error: any) {
    logger.error('Sync failed', error);
    return NextResponse.json(
      { error: error.message || 'Sync failed' },
      { status: 500 },
    );
  }
}
