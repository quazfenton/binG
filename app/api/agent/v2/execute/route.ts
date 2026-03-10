/**
 * Agent V2 Execute API Route
 * 
 * Execute task in V2 agent session with automatic routing between:
 * - OpenCode: Coding tasks (file ops, bash, code generation)
 * - Nullclaw: Non-coding tasks (messaging, browsing, automation)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { agentSessionManager } from '@/lib/agent/agent-session-manager';
import { agentFSBridge } from '@/lib/agent/agent-fs-bridge';
import { taskRouter } from '@/lib/agent/task-router';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:AgentV2:Execute');

const executeTaskSchema = z.object({
  sessionId: z.string().min(1),
  task: z.string().min(1),
  stream: z.boolean().optional().default(false),
});

/**
 * POST /api/agent/v2/execute
 * Execute task in agent session with automatic routing
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';

    // Parse request
    const body = await request.json();
    const validation = executeTaskSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 },
      );
    }

    const { sessionId, task, stream } = validation.data;

    // Get session from sessionId
    const conversationId = sessionId.split(':')[1] || sessionId;
    const session = agentSessionManager.getSession(userId, conversationId);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or expired' },
        { status: 404 },
      );
    }

    logger.info(`Executing task in session ${session.id}`);

    // Update session state
    agentSessionManager.setSessionState(userId, conversationId, 'busy');

    try {
      // Use task router to automatically route to appropriate agent
      const result = await taskRouter.executeTask({
        id: `task-${Date.now()}`,
        userId,
        conversationId,
        task,
        stream,
      });

      // Sync back from sandbox after OpenCode execution
      if (result.agent === 'opencode') {
        await agentFSBridge.syncFromSandbox(userId, conversationId);
      }

      return NextResponse.json({
        success: result.success,
        data: result,
      });

    } catch (error: any) {
      logger.error('Task execution failed', error);
      return NextResponse.json(
        { error: error.message || 'Task execution failed' },
        { status: 500 },
      );
    } finally {
      // Update session state back to ready
      agentSessionManager.setSessionState(userId, conversationId, 'ready');
      agentSessionManager.updateActivity(userId, conversationId);
    }

  } catch (error: any) {
    logger.error('Failed to execute task', error);
    return NextResponse.json(
      { error: error.message || 'Task execution failed' },
      { status: 500 },
    );
  }
}
