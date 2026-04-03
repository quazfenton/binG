/**
 * Kernel Agents List API
 * 
 * Lists all agents in the Agent Kernel.
 * GET /api/kernel/agents/list
 */

import { NextResponse } from 'next/server';
import { getAgentKernel } from '@/lib/agent/agent-kernel';

export async function GET() {
  try {
    const kernel = getAgentKernel();
    const agents = kernel.listAgents();
    
    // Return simplified agent data for UI
    const simplifiedAgents = agents.map(agent => ({
      id: agent.id,
      config: {
        type: agent.config.type,
        goal: agent.config.goal,
        userId: agent.config.userId,
        priority: agent.priority,
      },
      status: agent.status,
      priority: agent.priority,
      createdAt: agent.createdAt,
      iterations: agent.iterations,
      quota: {
        computeMs: agent.quota.computeMs,
        memoryBytes: agent.quota.memoryBytes,
      },
    }));
    
    return NextResponse.json(simplifiedAgents, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error: any) {
    console.error('[API.kernel.agents.list] Error:', error.message);
    return NextResponse.json(
      { error: 'Failed to get kernel agents', details: error.message },
      { status: 500 }
    );
  }
}