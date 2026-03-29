import { NextRequest, NextResponse } from 'next/server';
import { resolveFilesystemOwner } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { z } from 'zod';

// Scheduler service connection - connects to the BullMQ-based scheduler
const SCHEDULER_URL = process.env.SCHEDULER_URL || 'http://localhost:3007';

// Max jobs per user (quota limit)
const MAX_JOBS_PER_USER = 1;

// Request validation schemas
const createJobSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['sandbox-command', 'nullclaw-agent', 'http-webhook', 'workspace-index', 'sandbox-cleanup', 'health-check', 'custom']),
  schedule: z.string().regex(/^(\*|[0-5]?\d)(-|\/([0-5]?\d))?(\s+(\*|[0-5]?\d)(-|\/([0-5]?\d))?){0,4}$/, 'Invalid cron expression'),
  timezone: z.string().optional(),
  payload: z.record(z.any()).optional(),
  enabled: z.boolean().default(true),
  maxRetries: z.number().min(0).max(10).optional(),
  timeout: z.number().min(1000).max(3600000).optional(),
  tags: z.array(z.string()).optional(),
});

// Interface matching scheduler service
interface ScheduledTask {
  id: string;
  name: string;
  type: string;
  schedule: string;
  timezone?: string;
  payload: Record<string, any>;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  lastResult?: {
    success: boolean;
    output?: string;
    error?: string;
    duration: number;
  };
  maxRetries?: number;
  timeout?: number;
  ownerId?: string;
  tags?: string[];
}

/**
 * Fetch all tasks from the scheduler service
 * Filters by ownerId to get user's tasks
 */
async function fetchSchedulerTasks(ownerId: string): Promise<ScheduledTask[]> {
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error('[CronJobs] Scheduler fetch failed:', response.status);
      return [];
    }
    const data = await response.json() as { tasks: ScheduledTask[] };
    // Filter by ownerId
    return (data.tasks || []).filter((t: ScheduledTask) => t.ownerId === ownerId);
  } catch (error) {
    console.error('[CronJobs] Failed to fetch tasks:', error);
    return [];
  }
}

/**
 * Create a task via scheduler service
 */
async function createSchedulerTask(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'runCount'>): Promise<ScheduledTask | null> {
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    if (!response.ok) {
      const error = await response.text();
      console.error('[CronJobs] Scheduler create failed:', response.status, error);
      return null;
    }
    return await response.json() as ScheduledTask;
  } catch (error) {
    console.error('[CronJobs] Failed to create task:', error);
    return null;
  }
}

/**
 * Delete a task via scheduler service
 */
async function deleteSchedulerTask(taskId: string): Promise<boolean> {
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks/${taskId}`, {
      method: 'DELETE',
    });
    return response.ok;
  } catch (error) {
    console.error('[CronJobs] Failed to delete task:', error);
    return false;
  }
}

// GET /api/cron-jobs - List user's cron jobs
export async function GET(request: NextRequest) {
  try {
    const auth = await resolveFilesystemOwner(request);
    
    if (!auth.isAuthenticated || !auth.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Only allow authenticated (non-anon) users
    if (auth.userId.startsWith('anon:')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Fetch jobs from scheduler service
    const jobs = await fetchSchedulerTasks(auth.userId);
    return NextResponse.json({ jobs });
  } catch (error: any) {
    console.error('[CronJobs API] GET error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch cron jobs' },
      { status: 500 }
    );
  }
}

// POST /api/cron-jobs - Create a new cron job
export async function POST(request: NextRequest) {
  try {
    const auth = await resolveFilesystemOwner(request);
    
    if (!auth.isAuthenticated || !auth.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Only allow authenticated (non-anon) users
    if (auth.userId.startsWith('anon:')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Validate input
    const parsed = createJobSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input: ' + parsed.error.errors.map(e => e.message).join(', ') },
        { status: 400 }
      );
    }

    // Check quota - fetch existing jobs from scheduler
    const existingJobs = await fetchSchedulerTasks(auth.userId);
    if (existingJobs.length >= MAX_JOBS_PER_USER) {
      return NextResponse.json(
        { error: `You can only have ${MAX_JOBS_PER_USER} cron job. Delete an existing one to create a new one.` },
        { status: 403 }
      );
    }

    // Create task via scheduler service
    const task = await createSchedulerTask({
      name: parsed.data.name,
      type: parsed.data.type,
      schedule: parsed.data.schedule,
      timezone: parsed.data.timezone,
      payload: parsed.data.payload || {},
      enabled: parsed.data.enabled,
      maxRetries: parsed.data.maxRetries,
      timeout: parsed.data.timeout,
      ownerId: auth.userId,
      tags: parsed.data.tags,
    });

    if (!task) {
      return NextResponse.json(
        { error: 'Failed to create task in scheduler service' },
        { status: 500 }
      );
    }

    console.log(`[CronJobs API] Created task ${task.id} for user ${auth.userId}`);
    return NextResponse.json(task, { status: 201 });
  } catch (error: any) {
    console.error('[CronJobs API] POST error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create cron job' },
      { status: 500 }
    );
  }
}