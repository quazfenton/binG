/**
 * Workflow Visualizer API
 *
 * GET /api/workflows/visualizer - List workflows and instances
 * POST /api/workflows/visualizer/execute - Execute workflow
 * GET /api/workflows/visualizer/:id/status - Get workflow status
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Workflows:Visualizer');

// GET - List workflows and recent instances
export async function GET() {
  try {
    // Get available workflow templates from orchestra
    const workflowTemplates = [
      {
        id: 'code-agent',
        name: 'Code Agent',
        description: 'Code generation with self-healing',
        steps: [
          { id: 'collective', name: 'Collective', type: 'custom' },
          { id: 'planner', name: 'Planner', type: 'planner' },
          { id: 'executor', name: 'Executor', type: 'executor' },
          { id: 'critic', name: 'Critic', type: 'critic' },
          { id: 'self-healing', name: 'Self-Healing', type: 'custom' },
        ],
      },
      {
        id: 'research',
        name: 'Research',
        description: 'Multi-source research & synthesis',
        steps: [
          { id: 'planner', name: 'Research Planner', type: 'planner' },
          { id: 'researcher', name: 'Researcher', type: 'researcher' },
          { id: 'analyst', name: 'Analyst', type: 'analyst' },
          { id: 'synthesizer', name: 'Synthesizer', type: 'synthesizer' },
        ],
      },
      {
        id: 'data-analysis',
        name: 'Data Analysis',
        description: 'Dataset analysis & visualization',
        steps: [
          { id: 'profiler', name: 'Data Profiler', type: 'custom' },
          { id: 'analyzer', name: 'Statistical Analyzer', type: 'analyst' },
          { id: 'designer', name: 'Visualization Designer', type: 'custom' },
          { id: 'reporter', name: 'Report Generator', type: 'synthesizer' },
        ],
      },
    ];

    // Get recent workflow instances from state store
    const recentInstances = getMockInstances();

    return NextResponse.json({
      success: true,
      templates: workflowTemplates,
      instances: recentInstances,
    });
  } catch (error: any) {
    logger.error('Failed to get workflows:', error);
    return NextResponse.json(
      { error: 'Failed to get workflows' },
      { status: 500 }
    );
  }
}

// POST - Execute workflow
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workflowId, input } = body;

    if (!workflowId) {
      return NextResponse.json(
        { error: 'Workflow ID is required' },
        { status: 400 }
      );
    }

    // Create new workflow instance
    const instanceId = `workflow-${Date.now()}`;
    
    // TODO: Connect to real Mastra workflow execution
    // For now, return mock instance
    const instance = {
      id: instanceId,
      workflowId,
      name: `${workflowId}-execution`,
      status: 'running' as const,
      steps: getMockStepsForWorkflow(workflowId),
      startedAt: Date.now(),
      progress: 0,
    };

    logger.info('Workflow execution started:', { instanceId, workflowId });

    return NextResponse.json({
      success: true,
      instance,
    });
  } catch (error: any) {
    logger.error('Failed to execute workflow:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to execute workflow' },
      { status: 500 }
    );
  }
}

// Mock data for demonstration
function getMockInstances() {
  const now = Date.now();
  return [
    {
      id: 'instance-1',
      workflowId: 'code-agent',
      name: 'Code Agent Execution',
      status: 'completed' as const,
      steps: [
        { id: 'collective', name: 'Collective', type: 'custom', status: 'completed' as const, duration: 234 },
        { id: 'planner', name: 'Planner', type: 'planner', status: 'completed' as const, duration: 567 },
        { id: 'executor', name: 'Executor', type: 'executor', status: 'completed' as const, duration: 1234 },
        { id: 'critic', name: 'Critic', type: 'critic', status: 'completed' as const, duration: 345 },
      ],
      startedAt: now - 300000,
      completedAt: now - 240000,
      progress: 100,
    },
    {
      id: 'instance-2',
      workflowId: 'research',
      name: 'Research Execution',
      status: 'running' as const,
      steps: [
        { id: 'planner', name: 'Research Planner', type: 'planner', status: 'completed' as const, duration: 456 },
        { id: 'researcher', name: 'Researcher', type: 'researcher', status: 'running' as const },
        { id: 'analyst', name: 'Analyst', type: 'analyst', status: 'pending' as const },
        { id: 'synthesizer', name: 'Synthesizer', type: 'synthesizer', status: 'pending' as const },
      ],
      startedAt: now - 180000,
      progress: 25,
    },
  ];
}

function getMockStepsForWorkflow(workflowId: string) {
  const workflows: Record<string, any[]> = {
    'code-agent': [
      { id: 'collective', name: 'Collective', type: 'custom', status: 'pending' as const },
      { id: 'planner', name: 'Planner', type: 'planner', status: 'pending' as const },
      { id: 'executor', name: 'Executor', type: 'executor', status: 'pending' as const },
      { id: 'critic', name: 'Critic', type: 'critic', status: 'pending' as const },
      { id: 'self-healing', name: 'Self-Healing', type: 'custom', status: 'pending' as const },
    ],
    'research': [
      { id: 'planner', name: 'Research Planner', type: 'planner', status: 'pending' as const },
      { id: 'researcher', name: 'Researcher', type: 'researcher', status: 'pending' as const },
      { id: 'analyst', name: 'Analyst', type: 'analyst', status: 'pending' as const },
      { id: 'synthesizer', name: 'Synthesizer', type: 'synthesizer', status: 'pending' as const },
    ],
    'data-analysis': [
      { id: 'profiler', name: 'Data Profiler', type: 'custom', status: 'pending' as const },
      { id: 'analyzer', name: 'Statistical Analyzer', type: 'analyst', status: 'pending' as const },
      { id: 'designer', name: 'Visualization Designer', type: 'custom', status: 'pending' as const },
      { id: 'reporter', name: 'Report Generator', type: 'synthesizer', status: 'pending' as const },
    ],
  };

  return workflows[workflowId] || [];
}
