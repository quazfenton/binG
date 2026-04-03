/**
 * Kernel Agent Control API
 * 
 * Controls agents in the Agent Kernel.
 * POST /api/kernel/agents - Create/Spawn a new agent
 * DELETE /api/kernel/agents/[id] - Terminate an agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentKernel, type AgentConfig } from '@bing/shared/agent/agent-kernel';

// POST /api/kernel/agents - Spawn a new agent
export async function POST(request: NextRequest) {
  try {
    const kernel = getAgentKernel();
    const body = await request.json();
    
    const config: AgentConfig = {
      type: body.type || 'ephemeral',
      userId: body.userId || 'anonymous',
      goal: body.goal || 'Default task',
      priority: body.priority || 'normal',
      schedule: body.schedule,
      maxIterations: body.maxIterations,
      resources: body.resources,
      context: body.context,
    };
    
    const agentId = await kernel.spawnAgent(config);
    
    return NextResponse.json({ 
      success: true, 
      agentId,
      message: `Agent ${agentId} spawned successfully`
    });
  } catch (error: any) {
    console.error('[API.kernel.agents.POST] Error:', error.message);
    return NextResponse.json(
      { error: 'Failed to spawn agent', details: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/kernel/agents - Bulk terminate (for cleanup)
export async function DELETE(request: NextRequest) {
  try {
    const kernel = getAgentKernel();
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('id');
    
    if (agentId) {
      // Terminate specific agent
      const success = await kernel.terminateAgent(agentId);
      return NextResponse.json({ 
        success, 
        agentId,
        message: success ? `Agent ${agentId} terminated` : `Agent ${agentId} not found`
      });
    }
    
    // If no ID, return error
    return NextResponse.json(
      { error: 'Agent ID required' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('[API.kernel.agents.DELETE] Error:', error.message);
    return NextResponse.json(
      { error: 'Failed to terminate agent', details: error.message },
      { status: 500 }
    );
  }
}