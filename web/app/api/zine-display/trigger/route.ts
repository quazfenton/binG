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

      // Use Trigger.dev integration layer (with fallback)
      const { executeTask, scheduleAgentLoop, scheduleDAGExecution, scheduleReflection } = await import('@/lib/events/trigger');

      // Handle scheduling for specific task types
      if (config.taskId === 'agent-loop' && config.schedule) {
        const result = await scheduleAgentLoop({
          ...(config.payload as any),
          schedule: config.schedule,
        });
        return NextResponse.json(result);
      }

      if (config.taskId === 'dag-runner' && config.schedule) {
        const result = await scheduleDAGExecution({
          ...(config.payload as any),
          schedule: config.schedule,
        });
        return NextResponse.json(result);
      }

      if (config.taskId === 'reflection' && config.schedule) {
        const result = await scheduleReflection({
          ...(config.payload as any),
          triggerEventId: `reflection-${Date.now()}`,
        });
        return NextResponse.json(result);
      }

      // For non-scheduled tasks, just execute
      const result = await executeTask(
        config.taskId as any,
        config.payload || {}
      );

      return NextResponse.json({
        success: true,
        result,
        executionMode: await import('@/lib/events/trigger').then(m => m.getExecutionMode()),
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

      // Execute immediately using Trigger.dev integration (with fallback)
      const { executeTask, getExecutionMode } = await import('@/lib/events/trigger');
      
      const result = await executeTask(taskId as any, payload || {});
      const mode = await getExecutionMode();

      return NextResponse.json({
        success: true,
        message: `Task "${(task as any).name}" executed`,
        result,
        executionMode: mode,
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

      // Build absolute URL for server-side fetch
      const origin = request.headers.get('x-forwarded-host') 
        ? `https://${request.headers.get('x-forwarded-host')}`
        : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      
      const feedUrl = `${origin}/api/zine-display/feed?action=fetch&source=${encodeURIComponent(source)}`;
      
      const feedResponse = await fetch(feedUrl);

      if (!feedResponse.ok) {
        return NextResponse.json(
          {
            success: false,
            error: `Feed fetch failed: ${feedResponse.status} ${feedResponse.statusText}`
          },
          { status: 502 }
        );
      }

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

/**
 * Execute task asynchronously (background execution)
 *
 * Delegates to Trigger.dev integration layer which handles:
 * - Trigger.dev SDK execution when available
 * - Automatic fallback to local execution
 * - Job status tracking
 */
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
    // Use Trigger.dev integration layer
    const { executeTask } = await import('@/lib/events/trigger');
    
    const result = await executeTask(
      config.taskId as any,
      config.payload || {}
    );

    // Update on completion
    const completedJob = JOBS.get(jobId);
    if (completedJob) {
      completedJob.status = 'completed';
      completedJob.result = { success: true, output: result };
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

/**
 * Execute task immediately and return result
 *
 * Delegates to Trigger.dev integration layer which handles:
 * - Trigger.dev SDK execution when available  
 * - Automatic fallback to local execution
 */
async function executeTaskNow(
  taskId: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const { executeTask, getExecutionMode } = await import('@/lib/events/trigger');
  
  const result = await executeTask(taskId as any, payload);
  const mode = await getExecutionMode();
  
  console.log(`[Zine-Trigger] Task executed in ${mode} mode`, { taskId });
  
  return result;
}

/**
 * Check if Trigger.dev SDK is available
 */
async function isTriggerAvailable(): Promise<boolean> {
  try {
    await import('@trigger.dev/sdk/v3');
    return true;
  } catch {
    return false;
  }
}