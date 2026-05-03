import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { loadState, workforceManager } from '@bing/shared/agent';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:AgentV2:Workforce');

const spawnSchema = z.object({
  conversationId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  agent: z.enum(['opencode', 'nullclaw', 'cli']).default('opencode'),
  scope: z.string().optional(),
  cliCommand: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
  }).optional(),
});

const processSchema = z.object({
  conversationId: z.string().min(1),
});

export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';

    const conversationId = request.nextUrl.searchParams.get('conversationId');
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    const state = await loadState(userId, conversationId);
    return NextResponse.json({ success: true, data: state });
  } catch (error: any) {
    logger.error('Failed to load workforce state', error);
    return NextResponse.json({ error: error.message || 'Failed to load state' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';

    const body = await request.json();
    if (body?.action === 'process') {
      const validation = processSchema.safeParse(body);
      if (!validation.success) {
        return NextResponse.json({ error: 'Invalid request', details: validation.error.errors }, { status: 400 });
      }

      await workforceManager.processPending(userId, validation.data.conversationId);
      return NextResponse.json({ success: true, message: 'Processing pending tasks' });
    }

    const validation = spawnSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request', details: validation.error.errors }, { status: 400 });
    }

    const { cliCommand } = validation.data;
    
    // Type guard for cliCommand
    const normalizedCliCommand = cliCommand?.command 
      ? { command: cliCommand.command, args: cliCommand.args }
      : undefined;

    const task = await workforceManager.spawnTask(
      userId,
      validation.data.conversationId,
      {
        title: validation.data.title,
        description: validation.data.description,
        agent: validation.data.agent,
        scope: validation.data.scope,
        cliCommand: normalizedCliCommand,
      },
    );

    return NextResponse.json({ success: true, data: task });
  } catch (error: any) {
    logger.error('Failed to spawn task', error);
    return NextResponse.json({ error: error.message || 'Failed to spawn task' }, { status: 500 });
  }
}
