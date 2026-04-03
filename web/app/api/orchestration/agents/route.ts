/**
 * Agent Orchestration API
 *
 * GET /api/orchestration/agents - List all agents
 * GET /api/orchestration/agents/:id - Get agent details
 * POST /api/orchestration/agents/:id/start - Start agent
 * POST /api/orchestration/agents/:id/stop - Stop agent
 * POST /api/orchestration/agents/:id/pause - Pause agent
 * POST /api/orchestration/agents/:id/resume - Resume agent
 * GET /api/orchestration/logs - Get agent logs
 * GET /api/orchestration/workflows - List workflows
 * POST /api/orchestration/workflows/:id/execute - Execute workflow
 * GET /api/orchestration/stats - Get statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAgents,
  getAgent,
  startAgent,
  stopAgent,
  pauseAgent,
  resumeAgent,
  getAgentLogs,
  getWorkflows,
  executeWorkflow,
  getStats,
} from '@/lib/orchestration/agent-orchestrator';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Orchestration');

// GET - List all agents
export async function GET() {
  try {
    const agents = await getAgents();
    
    return NextResponse.json({
      success: true,
      agents,
      count: agents.length,
    });
  } catch (error: any) {
    logger.error('Failed to get agents:', error);
    return NextResponse.json(
      { error: 'Failed to get agents' },
      { status: 500 }
    );
  }
}
