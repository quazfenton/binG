/**
 * Event System Bootstrap
 * 
 * Registers the schedule task tools (task.schedule, task.status, task.cancel)
 * with the tool registry and connects the event system to the capability layer.
 * 
 * Based on trigger.md design patterns for persistent agent cognition.
 */

import { ToolRegistry } from '../registry';
import { executeScheduleTask, executeGetTaskStatus, executeCancelTask } from '../schedule-task-tool';
import type { ToolMetadata } from '../capabilities';
import { z } from 'zod';

const TOOL_METADATA: ToolMetadata = {
  latency: 'low',
  cost: 'low',
  reliability: 0.95,
  tags: ['task', 'schedule', 'background', 'cron', 'event'],
};

/**
 * Register event system tools with the registry
 */
export async function registerEventTools(
  registry: ToolRegistry,
  _config: { userId: string; workspace?: string; permissions?: string[] }
): Promise<number> {
  let count = 0;

  // Register task.schedule
  await registry.registerTool({
    name: 'task.schedule',
    capability: 'task.schedule',
    provider: 'events',
    handler: executeScheduleTask,
    inputSchema: z.object({
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
        expression: z.string().optional().describe('Cron expression'),
        delayMs: z.number().optional().describe('Delay in milliseconds'),
      }).describe('Scheduling configuration'),
      payload: z.record(z.any()).describe('Task-specific payload data'),
      metadata: z.object({
        name: z.string().optional(),
        priority: z.enum(['low', 'normal', 'high']).optional(),
        maxRetries: z.number().optional(),
        timeout: z.number().optional(),
      }).optional(),
      userId: z.string().describe('User identifier'),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      taskId: z.string(),
      status: z.enum(['scheduled', 'delayed', 'immediate']),
      taskType: z.string(),
      scheduledFor: z.string().optional(),
      error: z.string().optional(),
    }),
    metadata: TOOL_METADATA,
    permissions: ['task:schedule'],
  });
  count++;

  // Register task.status
  await registry.registerTool({
    name: 'task.status',
    capability: 'task.status',
    provider: 'events',
    handler: executeGetTaskStatus,
    inputSchema: z.object({
      taskId: z.string().describe('Task ID returned from task.schedule'),
    }),
    outputSchema: z.object({
      exists: z.boolean(),
      status: z.string().optional(),
      type: z.string().optional(),
      createdAt: z.number().optional(),
      processedAt: z.number().optional(),
      error: z.string().optional(),
    }),
    metadata: { latency: 'low', cost: 'low', reliability: 0.99 },
    permissions: ['task:read'],
  });
  count++;

  // Register task.cancel
  await registry.registerTool({
    name: 'task.cancel',
    capability: 'task.cancel',
    provider: 'events',
    handler: executeCancelTask,
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to cancel'),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
    metadata: { latency: 'low', cost: 'low', reliability: 0.95 },
    permissions: ['task:cancel'],
  });
  count++;

  console.log('[Bootstrap:Events] Registered event system tools:', count);
  
  return count;
}