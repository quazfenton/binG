import { NextRequest, NextResponse } from 'next/server';
import { resolveFilesystemOwner } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { z } from 'zod';

// Scheduler service connection
const SCHEDULER_URL = process.env.SCHEDULER_URL || 'http://localhost:3007';

/**
 * Validate cron expression
 * Uses a more accurate regex that validates standard 5-field cron expressions
 */
function isValidCronExpression(expression: string): boolean {
  // More accurate cron validation regex
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

// Update job schema with better cron validation
const updateJobSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  schedule: z.string().optional().refine(
    (val) => val === undefined || isValidCronExpression(val),
    { message: 'Invalid cron expression. Expected format: minute hour day month weekday' }
  ),
  timezone: z.string().optional(),
  payload: z.record(z.any()).optional(),
  enabled: z.boolean().optional(),
  maxRetries: z.number().min(0).max(10).optional(),
  timeout: z.number().min(1000).max(3600000).optional(),
  tags: z.array(z.string()).optional(),
});

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
  ownerId?: string;
}

// Timeout constant for scheduler requests (5 seconds)
const SCHEDULER_REQUEST_TIMEOUT = 5000;

// Helper to fetch task from scheduler
async function fetchSchedulerTask(taskId: string): Promise<ScheduledTask | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCHEDULER_REQUEST_TIMEOUT);
  
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks/${taskId}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`[CronJobs] Fetch task ${taskId} failed: ${response.status} ${response.statusText}`);
      return null;
    }
    return await response.json() as ScheduledTask;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`[CronJobs] Fetch task ${taskId} timed out after ${SCHEDULER_REQUEST_TIMEOUT}ms`);
    } else {
      console.error(`[CronJobs] Fetch task ${taskId} error:`, error.message);
    }
    return null;
  }
}

// Helper to update task via scheduler
async function updateSchedulerTask(taskId: string, updates: Partial<ScheduledTask>): Promise<ScheduledTask | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCHEDULER_REQUEST_TIMEOUT);
  
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[CronJobs] Update task ${taskId} failed: ${response.status} ${errorText}`);
      return null;
    }
    return await response.json() as ScheduledTask;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`[CronJobs] Update task ${taskId} timed out after ${SCHEDULER_REQUEST_TIMEOUT}ms`);
    } else {
      console.error(`[CronJobs] Update task ${taskId} error:`, error.message);
    }
    return null;
  }
}

// Helper to delete task via scheduler
async function deleteSchedulerTask(taskId: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCHEDULER_REQUEST_TIMEOUT);
  
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks/${taskId}`, {
      method: 'DELETE',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`[CronJobs] Delete task ${taskId} failed: ${response.status} ${response.statusText}`);
      return false;
    }
    return true;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`[CronJobs] Delete task ${taskId} timed out after ${SCHEDULER_REQUEST_TIMEOUT}ms`);
    } else {
      console.error(`[CronJobs] Delete task ${taskId} error:`, error.message);
    }
    return false;
  }
}

// PUT /api/cron-jobs/[id] - Update a cron job
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Verify task exists and belongs to user
    const existingTask = await fetchSchedulerTask(id);
    if (!existingTask || existingTask.ownerId !== auth.ownerId) {
      return NextResponse.json(
        { error: 'Cron job not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = updateJobSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input: ' + parsed.error.errors.map(e => e.message).join(', ') },
        { status: 400 }
      );
    }

    // Update via scheduler service
    const updatedTask = await updateSchedulerTask(id, parsed.data);
    if (!updatedTask) {
      return NextResponse.json(
        { error: 'Failed to update task in scheduler service' },
        { status: 500 }
      );
    }

    console.log(`[CronJobs API] Updated job ${id} for user ${auth.ownerId}`);
    return NextResponse.json(updatedTask);
  } catch (error: any) {
    console.error('[CronJobs API] PUT error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update cron job' },
      { status: 500 }
    );
  }
}

// DELETE /api/cron-jobs/[id] - Delete a cron job
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Verify task exists and belongs to user
    const existingTask = await fetchSchedulerTask(id);
    if (!existingTask || existingTask.ownerId !== auth.ownerId) {
      return NextResponse.json(
        { error: 'Cron job not found' },
        { status: 404 }
      );
    }

    // Delete via scheduler service
    const deleted = await deleteSchedulerTask(id);
    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete task in scheduler service' },
        { status: 500 }
      );
    }

    console.log(`[CronJobs API] Deleted job ${id} for user ${auth.ownerId}`);
    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    console.error('[CronJobs API] DELETE error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete cron job' },
      { status: 500 }
    );
  }
}