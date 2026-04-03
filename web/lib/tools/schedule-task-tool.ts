/**
 * Schedule Task Tool Handler
 * 
 * Wires the task.schedule capability to the event system.
 * Enables LLM agents to schedule background tasks for later execution.
 * 
 * Based on trigger.md patterns for persistent agent cognition.
 */

import { z } from 'zod';
import { scheduleTask, getTaskStatus, cancelTask, getAvailableTaskTypes } from '@/lib/events/trigger-integration';
import type { ToolMetadata } from './capabilities';

// ============================================================================
// Input/Output Schemas
// ============================================================================

export const ScheduleTaskInputSchema = z.object({
  taskType: z.enum([
    'HACKER_NEWS_DAILY',
    'RESEARCH_TASK', 
    'REPO_DIGEST',
    'SEND_EMAIL',
    'WEBHOOK',
    'SANDBOX_COMMAND',
    'NULLCLAW_AGENT',
    'CUSTOM_DAG',
  ]).describe('Type of background task to schedule'),
  
  schedule: z.object({
    type: z.enum(['cron', 'delay', 'immediate']).describe('When to execute'),
    expression: z.string().optional().describe('Cron expression (e.g., "*/5 * * * *")'),
    delayMs: z.number().optional().describe('Delay in milliseconds'),
  }).describe('Scheduling configuration'),
  
  payload: z.record(z.any()).describe('Task-specific payload data'),
  
  metadata: z.object({
    name: z.string().optional().describe('Optional task name'),
    priority: z.enum(['low', 'normal', 'high']).optional().describe('Task priority'),
    maxRetries: z.number().optional().describe('Max retry attempts'),
    timeout: z.number().optional().describe('Timeout in milliseconds'),
  }).optional(),
  
  userId: z.string().describe('User identifier'),
});

export type ScheduleTaskInput = z.infer<typeof ScheduleTaskInputSchema>;

export const ScheduleTaskOutputSchema = z.object({
  success: z.boolean(),
  taskId: z.string().describe('ID of the scheduled task'),
  status: z.enum(['scheduled', 'delayed', 'immediate']),
  taskType: z.string(),
  scheduledFor: z.string().optional(),
  error: z.string().optional(),
});

export type ScheduleTaskOutput = z.infer<typeof ScheduleTaskOutputSchema>;

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Execute schedule_task capability
 * 
 * This is called by the tool integration layer when the LLM invokes
 * the task.schedule capability.
 */
export async function executeScheduleTask(
  input: unknown,
  context?: { userId?: string }
): Promise<ScheduleTaskOutput> {
  // Validate input
  const parsed = ScheduleTaskInputSchema.safeParse(input);
  
  if (!parsed.success) {
    return {
      success: false,
      taskId: '',
      status: 'immediate',
      taskType: 'UNKNOWN',
      error: 'Invalid input: ' + parsed.error.errors.map(e => e.message).join(', '),
    };
  }
  
  // Add userId from context if not provided in input
  const userId = parsed.data.userId || context?.userId;
  
  // Require userId - don't allow anonymous task scheduling
  if (!userId) {
    return {
      success: false,
      taskId: '',
      status: 'immediate',
      taskType: parsed.data.taskType,
      error: 'userId is required. Task scheduling requires authentication.',
    };
  }
  
  // Call the event system
  const result = await scheduleTask({
    ...parsed.data,
    userId,
  });
  
  return result;
}

/**
 * Execute task.status capability
 */
export async function executeGetTaskStatus(
  input: unknown,
  _context?: { userId?: string }
): Promise<{
  exists: boolean;
  status?: string;
  type?: string;
  createdAt?: string;
  completedAt?: string;
  error?: string;
}> {
  const schema = z.object({
    taskId: z.string().describe('Task ID returned from task.schedule'),
  });
  
  const parsed = schema.safeParse(input);
  
  if (!parsed.success) {
    return { 
      exists: false, 
      error: 'Invalid input: ' + parsed.error.errors.map(e => e.message).join(', ') 
    };
  }
  
  return await getTaskStatus(parsed.data.taskId);
}

/**
 * Execute task.cancel capability
 */
export async function executeCancelTask(
  input: unknown,
  _context?: { userId?: string }
): Promise<{ success: boolean; error?: string }> {
  const schema = z.object({
    taskId: z.string().describe('Task ID to cancel'),
  });
  
  const parsed = schema.safeParse(input);
  
  if (!parsed.success) {
    return { 
      success: false, 
      error: 'Invalid input: ' + parsed.error.errors.map(e => e.message).join(', ') 
    };
  }
  
  return await cancelTask(parsed.data.taskId);
}

/**
 * Get available task types (for tool discovery)
 */
export function executeGetAvailableTaskTypes() {
  return getAvailableTaskTypes();
}

// ============================================================================
// Tool Metadata
// ============================================================================

export const SCHEDULE_TASK_TOOL_METADATA: ToolMetadata = {
  latency: 'low',
  cost: 'low',
  reliability: 0.95,
  tags: ['task', 'schedule', 'background', 'cron', 'event'],
};

// ============================================================================
// Registration Helper
// ============================================================================

/**
 * Register all task scheduling tools with the tool registry
 * Called during bootstrap
 */
export async function registerScheduleTaskTools(): Promise<void> {
  const { ToolRegistry } = await import('./registry');
  const registry = ToolRegistry.getInstance();
  
  // Register schedule_task
  await registry.registerTool({
    name: 'task.schedule',
    capability: 'task.schedule',
    provider: 'events',
    handler: executeScheduleTask,
    inputSchema: ScheduleTaskInputSchema,
    outputSchema: ScheduleTaskOutputSchema,
    metadata: SCHEDULE_TASK_TOOL_METADATA,
    permissions: ['task:schedule'],
  });
  
  // Register task.status
  await registry.registerTool({
    name: 'task.status',
    capability: 'task.status',
    provider: 'events',
    handler: executeGetTaskStatus,
    metadata: { latency: 'low', cost: 'low', reliability: 0.99 },
    permissions: ['task:read'],
  });
  
  // Register task.cancel
  await registry.registerTool({
    name: 'task.cancel',
    capability: 'task.cancel',
    provider: 'events',
    handler: executeCancelTask,
    metadata: { latency: 'low', cost: 'low', reliability: 0.95 },
    permissions: ['task:cancel'],
  });
  
  console.log('[ScheduleTaskTool] Registered task scheduling tools');
}