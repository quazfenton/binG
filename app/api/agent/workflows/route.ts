import { NextRequest, NextResponse } from "next/server";

interface WorkflowExecutor {
  execute(workflow: string, input: any, config?: any): Promise<any>;
}

const workflowExecutor: WorkflowExecutor = {
  async execute(workflow: string, input: any, config?: any): Promise<any> {
    console.log(`[Workflow] Executing workflow: ${workflow}`);
    
    const workflowUrl = process.env.WORKFLOW_SERVICE_URL;
    
    if (workflowUrl) {
      try {
        const response = await fetch(`${workflowUrl}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow, input, config }),
        });
        
        if (!response.ok) {
          throw new Error(`Workflow service returned ${response.status}`);
        }
        
        return await response.json();
      } catch (error) {
        console.error('[Workflow] External service error:', error);
      }
    }
    
    // Mock implementation for development
    return {
      workflow,
      input,
      result: `Mock result for ${workflow} workflow`,
      status: 'completed',
      timestamp: new Date().toISOString()
    };
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      workflow, // 'chaining', 'parallel', 'router', 'evaluator'
      input,
      config
    } = body;

    if (!workflow || !input) {
      return NextResponse.json(
        { error: 'Workflow type and input are required' },
        { status: 400 }
      );
    }

    // Validate workflow type
    const validWorkflows = ['chaining', 'parallel', 'router', 'evaluator'];
    if (!validWorkflows.includes(workflow)) {
      return NextResponse.json(
        { error: `Invalid workflow type. Must be one of: ${validWorkflows.join(', ')}` },
        { status: 400 }
      );
    }

    // Execute workflow
    try {
      const result = await workflowExecutor.execute(workflow, input, config);
      
      return NextResponse.json({
        success: true,
        workflow,
        result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Workflows API] Execution error:', error);
      return NextResponse.json({
        success: false,
        error: 'Workflow execution failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[Workflows API] Error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Workflow execution failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    availableWorkflows: [
      {
        name: 'chaining',
        description: 'Sequential agent execution with output passing'
      },
      {
        name: 'parallel',
        description: 'Concurrent agent execution with aggregation'
      },
      {
        name: 'router',
        description: 'Intelligent routing to specialized agents'
      },
      {
        name: 'evaluator',
        description: 'Quality assessment and output scoring'
      }
    ],
    status: 'Workflows available via Python scripts in /workflows directory',
    documentation: 'See workflows/README.md for usage'
  });
}
