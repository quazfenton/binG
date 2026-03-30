/**
 * Trigger.dev Integration for Zine Display
 * 
 * Enables:
 * - Scheduling data source polling via Trigger.dev jobs
 * - Real-time notifications pushed to Zine Display
 * - Background data fetching and processing
 * - Webhook triggers from external services
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTriggerTask, ALL_TRIGGER_TASKS } from '@/lib/events/trigger-dev-tasks';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

interface TriggerJobRequest {
  taskId: string;
  payload?: Record<string, unknown>;
  schedule?: {
    type: 'cron' | 'interval';
    expression: string;
  };
}

interface TriggerJobResponse {
  id: string;
  taskId: string;
  status: 'scheduled' | 'running' | 'completed' | 'failed';
  scheduledAt?: string;
  result?: unknown;
}

// In-memory job store (in production, use a database)
const JOBS: Map<string, TriggerJobResponse> = new Map();

// ---------------------------------------------------------------------
// GET - List available Trigger.dev tasks and running jobs
// ---------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');

  // List available Trigger.dev tasks
  if (action === 'tasks' || action === 'list') {
    const tasks = ALL_TRIGGER_TASKS.map(t => ({
      id: (t as any).id,
      name: (t as any).name,
      description: (t as any).description,
      schedule: 'schedule' in t ? (t as any).schedule : null,
    }));

    return NextResponse.json({
      success: true,
      service: 'Zine Display Trigger.dev Integration',
      tasks,
      count: tasks.length,
    });
  }

  // List running/completed jobs
  if (action === 'jobs') {
    const jobs = Array.from(JOBS.values()).map(j => ({
      id: j.id,
      taskId: j.taskId,
      status: j.status,
      scheduledAt: j.scheduledAt,
    }));

    return NextResponse.json({
      success: true,
      jobs,
      count: jobs.length,
    });
  }

  // Get specific job status
  if (action === 'status') {
    const jobId = searchParams.get('jobId');
    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'jobId is required' },
        { status: 400 }
      );
    }

    const job = JOBS.get(jobId);
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      job,
    });
  }

  // Default: return service info
  return NextResponse.json({
    service: 'Zine Display Trigger.dev Integration',
    version: '1.0.0',
    endpoints: {
      'GET /?action=tasks': 'List available Trigger.dev tasks',
      'GET /?action=jobs': 'List running jobs',
      'GET /?action=status&jobId={id}': 'Get job status',
      'POST /': 'Schedule a new Trigger.dev task',
    },
  });
}

// ---------------------------------------------------------------------
// POST - Schedule Trigger.dev tasks
// ---------------------------------------------------------------------

const scheduleJobSchema = z.object({
  taskId: z.string(),
  payload: z.record(z.unknown()).optional(),
  schedule: z.object({
    type: z.enum(['cron', 'interval']),
    expression: z.string(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle different actions
    if (body.action === 'schedule') {
      const config = scheduleJobSchema.parse(body);

      // Validate task exists
      const task = getTriggerTask(config.taskId);
      if (!task) {
        return NextResponse.json(
          { 
            success: false, 
            error: `Unknown task: ${config.taskId}. Available: ${ALL_TRIGGER_TASKS.map(t => (t as any).id).join(', ')}` 
          },
          { status: 400 }
        );
      }

      // Create job
      const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const job: TriggerJobResponse = {
        id: jobId,
        taskId: config.taskId,
        status: 'scheduled',
        scheduledAt: config.schedule 
          ? new Date().toISOString()
          : undefined,
      };

      JOBS.set(jobId, job);

      // Simulate task execution (in production, this would use actual Trigger.dev SDK)
      const taskRequest: TriggerJobRequest = {
        taskId: config.taskId,
        payload: config.payload,
      };
      if (config.schedule) {
        taskRequest.schedule = config.schedule as { type: 'cron' | 'interval'; expression: string };
      }
      executeTaskAsync(jobId, taskRequest);

      return NextResponse.json({
        success: true,
        message: `Task "${(task as any).name}" scheduled`,
        job,
      });
    }

    // Trigger a task immediately without scheduling
    if (body.action === 'trigger') {
      const { taskId, payload } = body;
      
      if (!taskId) {
        return NextResponse.json(
          { success: false, error: 'taskId is required' },
          { status: 400 }
        );
      }

      const task = getTriggerTask(taskId);
      if (!task) {
        return NextResponse.json(
          { 
            success: false, 
            error: `Unknown task: ${taskId}` 
          },
          { status: 400 }
        );
      }

      // Execute immediately
      const result = await executeTaskNow(taskId, payload || {});

      return NextResponse.json({
        success: true,
        message: `Task "${(task as any).name}" executed`,
        result,
      });
    }

    // Run a data source fetch task
    if (body.action === 'fetch-source') {
      const { source, poll = false, intervalMs = 60000 } = body;

      if (!source) {
        return NextResponse.json(
          { success: false, error: 'source is required' },
          { status: 400 }
        );
      }

      // This would integrate with the feed API
      const feedResponse = await fetch(
        `/api/zine-display/feed?action=fetch&source=${encodeURIComponent(source)}`
      );
      const feedData = await feedResponse.json();

      // Convert to Zine fragments and push to display
      return NextResponse.json({
        success: true,
        source,
        fetched: feedData.success,
        items: feedData.items || [],
        pollEnabled: poll,
        intervalMs: poll ? intervalMs : null,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action. Use schedule, trigger, or fetch-source' },
      { status: 400 }
    );

  } catch (error) {
    console.error('[Zine-Trigger] Error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// Task Execution Helpers
// ---------------------------------------------------------------------

async function executeTaskAsync(
  jobId: string, 
  config: TriggerJobRequest
) {
  // Update job status
  const job = JOBS.get(jobId);
  if (job) {
    job.status = 'running';
    JOBS.set(jobId, job);
  }

  try {
    // Simulate async task execution
    // In production, use actual Trigger.dev SDK:
    // const trigger = await import('@trigger.dev/sdk/v3');
    // await trigger.trigger(config.taskId, config.payload);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Update on completion
    const completedJob = JOBS.get(jobId);
    if (completedJob) {
      completedJob.status = 'completed';
      completedJob.result = { success: true, message: 'Task completed' };
      JOBS.set(jobId, completedJob);
    }
  } catch (error) {
    // Mark as failed
    const failedJob = JOBS.get(jobId);
    if (failedJob) {
      failedJob.status = 'failed';
      failedJob.result = { error: String(error) };
      JOBS.set(jobId, failedJob);
    }
  }
}

async function executeTaskNow(
  taskId: string, 
  payload: Record<string, unknown>
): Promise<unknown> {
  const task = getTriggerTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // Execute based on task type
  switch (taskId) {
    case 'research-agent':
      // Would perform actual research
      return { 
        query: payload.query || 'default', 
        results: ['Research result 1', 'Research result 2'] 
      };

    case 'dag-runner':
      // Would execute DAG
      const dagPayload = payload.dag as { nodes?: unknown[] } | undefined;
      return { 
        nodes: dagPayload?.nodes?.length || 0, 
        executed: true 
      };

    case 'reflection':
      // Would analyze results
      return { 
        analysis: 'Analysis complete', 
        improvements: ['Improvement 1'] 
      };

    default:
      return { 
        taskId, 
        executed: true, 
        payload 
      };
  }
}