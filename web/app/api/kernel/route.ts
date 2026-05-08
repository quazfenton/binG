import { NextRequest, NextResponse } from 'next/server';
import { getAgentKernel } from '@bing/shared/agent';

// GET /api/kernel/stats | /api/kernel/agents/list
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  // /api/kernel/agents/list — exact segment match to avoid false positives like /api/kernel/agents/foo/bar
  if (segments.length === 4 && segments[2] === 'agents' && segments[3] === 'list') {
    try {
      const kernel = getAgentKernel();
      const agents = kernel.listAgents();
      const simplified = agents.map((a: any) => ({
        id: a.id,
        type: a.config?.type,
        userId: a.config?.userId,
        status: a.status,
        priority: a.config?.priority,
        createdAt: a.createdAt,
        iterations: a.iterations,
        quotas: a.config?.quotas,
      }));
      return NextResponse.json(
        { success: true, agents: simplified, count: simplified.length },
        { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
      );
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // /api/kernel/stats
  if (segments.length === 3 && segments[2] === 'stats') {
    try {
      const kernel = getAgentKernel();
      const stats = await kernel.getStats();
      return NextResponse.json(
        { success: true, stats },
        { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
      );
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// POST /api/kernel/agents — spawn a new agent
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const kernel = getAgentKernel();
    const agent = await kernel.spawnAgent({
      type: body.type,
      userId: body.userId,
      goal: body.goal,
      priority: body.priority,
    });
    return NextResponse.json({ success: true, agent });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/kernel/agents?id=<id> — terminate an agent
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }
    const kernel = getAgentKernel();
    await kernel.terminateAgent(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}