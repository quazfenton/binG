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
import { agentSessionManager } from '@/lib/session/agent/agent-session-manager';
import { executeV2Task, executeV2TaskStreaming } from '@bing/shared/agent';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:AgentV2:Execute');

const executeTaskSchema = z.object({
  sessionId: z.string().min(1),
  task: z.string().min(1),
  stream: z.boolean().optional().default(false),
  conversationId: z.string().optional(),
  preferredAgent: z.enum(['opencode', 'nullclaw', 'cli']).optional(),
  cliCommand: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
  }).optional(),
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

    const { sessionId, task, stream, conversationId, preferredAgent, cliCommand } = validation.data;

    // Type guard for cliCommand - ensure command is defined when passed
    const normalizedCliCommand = cliCommand?.command
      ? { command: cliCommand.command, args: cliCommand.args }
      : undefined;

    // Resolve session - prefer explicit conversationId, otherwise lookup by session UUID
    // Note: sessionId is a UUID (e.g., "550e8400-e29b-41d4-a716-446655440000")
    // Session lookup uses agentSessionManager.getSessionById() which handles UUIDs correctly
    const resolvedConversationId =
      conversationId ||
      agentSessionManager.getSessionById(sessionId)?.conversationId ||
      sessionId;

    const session = agentSessionManager.getSession(userId, resolvedConversationId);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or expired' },
        { status: 404 },
      );
    }

    logger.info(`Executing task in session ${session.id}`);

    // Update session state
    agentSessionManager.setSessionState(userId, resolvedConversationId, 'busy');

    try {
      if (stream) {
        const streamBody = executeV2TaskStreaming({
          userId,
          conversationId: resolvedConversationId,
          task,
          preferredAgent,
          cliCommand: normalizedCliCommand,
          stream: true,
        });

        return new Response(streamBody, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      }

      const result = await executeV2Task({
        userId,
        conversationId: resolvedConversationId,
        task,
        preferredAgent,
        cliCommand: normalizedCliCommand,
      });

      return NextResponse.json(result);

    } catch (error: any) {
      logger.error('Task execution failed', error);
      return NextResponse.json(
        { error: error.message || 'Task execution failed' },
        { status: 500 },
      );
    } finally {
      // Update session state back to ready
      agentSessionManager.setSessionState(userId, resolvedConversationId, 'ready');
      agentSessionManager.updateActivity(userId, resolvedConversationId);
    }

  } catch (error: any) {
    logger.error('Failed to execute task', error);
    return NextResponse.json(
      { error: error.message || 'Task execution failed' },
      { status: 500 },
    );
  }
}
