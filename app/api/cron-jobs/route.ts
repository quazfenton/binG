import { NextRequest, NextResponse } from 'next/server';
import { resolveFilesystemOwner } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { z } from 'zod';

// Scheduler service connection - connects to the BullMQ-based scheduler
const SCHEDULER_URL = process.env.SCHEDULER_URL || 'http://localhost:3007';

// Scheduler fetch timeout - prevents hanging on scheduler stalls
const SCHEDULER_TIMEOUT_MS = 8000;

/**
 * Fetch with timeout to prevent hanging requests
 * Uses AbortController to cancel fetch after timeout
 */
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number = SCHEDULER_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Max jobs per user (quota limit)
const MAX_JOBS_PER_USER = 1;

/**
 * Validate cron expression
 * Uses a more accurate validation than regex alone
 */
function isValidCronExpression(expression: string): boolean {
  // Basic regex check
  const cronRegex = /^(((\d+,)+\d+|(\d+(\/|-)\d+)|\d+|\*) ?){5}$/;
  if (!cronRegex.test(expression)) return false;
  
  // Additional validation for each field
  const fields = expression.split(' ');
  if (fields.length !== 5) return false;
  
  const ranges = [
    { min: 0, max: 59 },   // Minutes
    { min: 0, max: 23 },   // Hours
    { min: 1, max: 31 },   // Day of month
    { min: 1, max: 12 },   // Month
    { min: 0, max: 6 },    // Day of week
  ];
  
  for (let i = 0; i < 5; i++) {
    const field = fields[i];
    const { min, max } = ranges[i];
    
    // Skip wildcard
    if (field === '*') continue;
    
    // Validate each part (handles comma-separated values)
    const parts = field.split(',');
    for (const part of parts) {
      // Handle step values (e.g., */5, 1-10/2)
      const [range, step] = part.split('/');
      if (step && isNaN(parseInt(step))) return false;
      
      // Handle ranges (e.g., 1-5)
      if (range.includes('-')) {
        const [start, end] = range.split('-').map(Number);
        if (isNaN(start) || isNaN(end) || start < min || end > max) return false;
      } else {
        const num = parseInt(range);
        if (isNaN(num) || num < min || num > max) return false;
      }
    }
  }
  
  return true;
}

// Request validation schemas
const createJobSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['sandbox-command', 'nullclaw-agent', 'http-webhook', 'workspace-index', 'sandbox-cleanup', 'health-check', 'custom']),
  schedule: z.string().refine(
    (val) => isValidCronExpression(val),
    { message: 'Invalid cron expression. Expected format: minute hour day month weekday (e.g., "0 * * * *")' }
  ),
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
 * Fetch job count from the scheduler service for a user
 * More efficient than fetching all jobs when we only need the count
 */
async function fetchSchedulerJobCount(ownerId: string): Promise<number> {
  try {
    const response = await fetchWithTimeout(`${SCHEDULER_URL}/tasks?ownerId=${ownerId}&count=true`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error('[CronJobs] Scheduler count fetch failed:', response.status);
      throw new Error(`Scheduler service returned ${response.status}`);
    }
    const data = await response.json() as { count: number };
    if (typeof data.count !== 'number' || !Number.isFinite(data.count)) {
      console.error('[CronJobs] Scheduler returned invalid count:', data);
      throw new Error('Scheduler service returned malformed response');
    }
    return data.count;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[CronJobs] Scheduler count fetch timed out');
      throw new Error('Scheduler service timeout');
    }
    console.error('[CronJobs] Failed to fetch job count:', error);
    throw error;
  }
}

/**
 * Fetch all tasks from the scheduler service
 * Filters by ownerId to get user's tasks
 */
async function fetchSchedulerTasks(ownerId: string): Promise<ScheduledTask[]> {
  try {
    const response = await fetchWithTimeout(`${SCHEDULER_URL}/tasks`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error('[CronJobs] Scheduler fetch failed:', response.status);
      throw new Error(`Scheduler service returned ${response.status}`);
    }
    const data = await response.json() as { tasks: ScheduledTask[] };
    if (!Array.isArray(data.tasks)) {
      console.error('[CronJobs] Scheduler returned invalid tasks (not an array):', data);
      throw new Error('Scheduler service returned malformed response');
    }
    // Filter by ownerId
    return data.tasks.filter((t: ScheduledTask) => t.ownerId === ownerId);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[CronJobs] Scheduler fetch timed out');
      throw new Error('Scheduler service timeout');
    }
    console.error('[CronJobs] Failed to fetch tasks:', error);
    throw error;
  }
}

/**
 * Create a task via scheduler service
 */
async function createSchedulerTask(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'runCount'>): Promise<ScheduledTask | null> {
  try {
    const response = await fetchWithTimeout(`${SCHEDULER_URL}/tasks`, {
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
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[CronJobs] Scheduler create timed out');
      return null;
    }
    console.error('[CronJobs] Failed to create task:', error);
    return null;
  }
}

/**
 * Delete a task via scheduler service
 */
async function deleteSchedulerTask(taskId: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${SCHEDULER_URL}/tasks/${taskId}`, {
      method: 'DELETE',
    });
    return response.ok;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[CronJobs] Scheduler delete timed out');
      return false;
    }
    console.error('[CronJobs] Failed to delete task:', error);
    return false;
  }
}

// GET /api/cron-jobs - List user's cron jobs
export async function GET(request: NextRequest) {
  try {
    const auth = await resolveFilesystemOwner(request);

    if (!auth.isAuthenticated || !auth.ownerId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (auth.ownerId.startsWith('anon:')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Fetch user's jobs from scheduler service
    const jobs = await fetchSchedulerTasks(auth.ownerId);
    return NextResponse.json({ jobs });
  } catch (error: any) {
    console.error('[CronJobs API] GET error:', error);
    // Fail closed: return 502/503 for scheduler failures instead of masking with empty list
    const status = error.message?.includes('timeout') ? 504 : 502;
    return NextResponse.json(
      { error: error.message || 'Failed to fetch cron jobs' },
      { status }
    );
  }
}

// POST /api/cron-jobs - Create a new cron job
export async function POST(request: NextRequest) {
  try {
    const auth = await resolveFilesystemOwner(request);

    if (!auth.isAuthenticated || !auth.ownerId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Only allow authenticated (non-anon) users
    if (auth.ownerId.startsWith('anon:')) {
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

    // Check quota - fetch job count from scheduler (more efficient than fetching all jobs)
    // Note: For perfect atomicity, quota should be enforced at the scheduler service level
    let jobCount: number;
    try {
      jobCount = await fetchSchedulerJobCount(auth.ownerId);
    } catch (quotaError: any) {
      console.error('[CronJobs API] Quota check failed:', quotaError);
      // Fail closed: can't verify quota, return 502
      return NextResponse.json(
        { error: 'Unable to verify job quota (scheduler service unavailable)' },
        { status: 502 }
      );
    }
    
    if (jobCount >= MAX_JOBS_PER_USER) {
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
      ownerId: auth.ownerId,
      tags: parsed.data.tags,
    });

    if (!task) {
      return NextResponse.json(
        { error: 'Failed to create task in scheduler service' },
        { status: 500 }
      );
    }

    console.log(`[CronJobs API] Created task ${task.id} for user ${auth.ownerId}`);
    return NextResponse.json(task, { status: 201 });
  } catch (error: any) {
    console.error('[CronJobs API] POST error:', error);
    // Fail closed: return 502/503 for scheduler failures
    const status = error.message?.includes('timeout') ? 504 : 502;
    return NextResponse.json(
      { error: error.message || 'Failed to create cron job' },
      { status }
    );
  }
}