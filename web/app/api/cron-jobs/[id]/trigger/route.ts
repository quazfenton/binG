import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { resolveFilesystemOwner } from '@/lib/virtual-filesystem/resolve-filesystem-owner';

// Scheduler service connection
const SCHEDULER_URL = process.env.SCHEDULER_URL || 'http://localhost:3007';

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
    if (!response.ok) {
      console.error(`[CronJobs] Fetch task ${taskId} failed: ${response.status} ${response.statusText}`);
      return null;
    }
    return await response.json() as ScheduledTask;
  } catch (error: any) {
    console.error(`[CronJobs] Fetch task ${taskId} error:`, error.message);
    return null;
  }
}

// Helper to trigger task via scheduler
async function triggerSchedulerTask(taskId: string): Promise<{ success: boolean; output?: string; error?: string; duration: number } | null> {
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks/${taskId}/trigger`, {
      method: 'POST',
    });
    if (!response.ok) {
      console.error(`[CronJobs] Trigger task ${taskId} failed: ${response.status} ${response.statusText}`);
      return null;
    }
    return await response.json() as { success: boolean; output?: string; error?: string; duration: number };
  } catch (error: any) {
    console.error(`[CronJobs] Trigger task ${taskId} error:`, error.message);
    return null;
  }
}

// POST /api/cron-jobs/[id]/trigger - Manually trigger a cron job
export async function POST(
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

    // Trigger via scheduler service
    const result = await triggerSchedulerTask(id);
    if (!result) {
      return NextResponse.json(
        { error: 'Failed to trigger task in scheduler service' },
        { status: 500 }
      );
    }

    // Log only non-sensitive metadata (avoid logging output/error which may contain sensitive data)
    console.log(`[CronJobs API] Triggered job ${id} for user ${auth.ownerId}`, {
      success: result.success,
      duration: result.duration,
    });

    return NextResponse.json({
      success: result.success,
      output: result.output,
      error: result.error,
      duration: result.duration,
    });
  } catch (error: any) {
    console.error('[CronJobs API] Trigger error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to trigger cron job' },
      { status: 500 }
    );
  }
}