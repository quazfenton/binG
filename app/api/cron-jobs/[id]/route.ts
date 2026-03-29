import { NextRequest, NextResponse } from 'next/server';
import { resolveFilesystemOwner } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { z } from 'zod';

// Scheduler service connection
const SCHEDULER_URL = process.env.SCHEDULER_URL || 'http://localhost:3007';

// Update job schema
const updateJobSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  schedule: z.string().regex(/^(\*|[0-5]?\d)(-|\/([0-5]?\d))?(\s+(\*|[0-5]?\d)(-|\/([0-5]?\d))?){0,4}$/).optional(),
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

// Helper to fetch task from scheduler
async function fetchSchedulerTask(taskId: string): Promise<ScheduledTask | null> {
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks/${taskId}`);
    if (!response.ok) return null;
    return await response.json() as ScheduledTask;
  } catch {
    return null;
  }
}

// Helper to update task via scheduler
async function updateSchedulerTask(taskId: string, updates: Partial<ScheduledTask>): Promise<ScheduledTask | null> {
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) return null;
    return await response.json() as ScheduledTask;
  } catch {
    return null;
  }
}

// Helper to delete task via scheduler
async function deleteSchedulerTask(taskId: string): Promise<boolean> {
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks/${taskId}`, {
      method: 'DELETE',
    });
    return response.ok;
  } catch {
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
    
    if (!auth.isAuthenticated || !auth.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (auth.userId.startsWith('anon:')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Verify task exists and belongs to user
    const existingTask = await fetchSchedulerTask(id);
    if (!existingTask || existingTask.ownerId !== auth.userId) {
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

    console.log(`[CronJobs API] Updated job ${id} for user ${auth.userId}`);
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
    
    if (!auth.isAuthenticated || !auth.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (auth.userId.startsWith('anon:')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Verify task exists and belongs to user
    const existingTask = await fetchSchedulerTask(id);
    if (!existingTask || existingTask.ownerId !== auth.userId) {
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

    console.log(`[CronJobs API] Deleted job ${id} for user ${auth.userId}`);
    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    console.error('[CronJobs API] DELETE error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete cron job' },
      { status: 500 }
    );
  }
}