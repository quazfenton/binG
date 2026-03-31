/**
 * Trigger Integration Layer
 * 
 * Bridges the event system with the tool capability system.
 * Enables LLM tools to emit events for background processing.
 */

import { emitEvent, emitEventWithOptions } from './bus';
import { AnyEvent } from './schema';
import { z } from 'zod';

// Schedule Task Input Schema
export const ScheduleTaskInput = z.object({
  taskType: z.enum([
    'HACKER_NEWS_DAILY',
    'RESEARCH_TASK', 
    'REPO_DIGEST',
    'SEND_EMAIL',
    'WEBHOOK',
    'SANDBOX_COMMAND',
    'NULLCLAW_AGENT',
    'CUSTOM_DAG',
  ]).describe('Type of background task'),
  
  schedule: z.object({
    type: z.enum(['cron', 'delay', 'immediate']).describe('Scheduling type'),
    expression: z.string().optional().describe('Cron expression'),
    delayMs: z.number().optional().describe('Delay in milliseconds'),
  }).describe('When to execute'),
  
  payload: z.record(z.any()).describe('Task-specific payload'),
  
  metadata: z.object({
    name: z.string().optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
    maxRetries: z.number().optional(),
    timeout: z.number().optional(),
  }).optional(),
  
  userId: z.string().describe('User identifier'),
});

export type ScheduleTaskInput = z.infer<typeof ScheduleTaskInput>;

// Task Result
export interface ScheduleTaskResult {
  success: boolean;
  taskId: string;
  status: 'scheduled' | 'delayed' | 'immediate';
  taskType: string;
  scheduledFor?: string;
  error?: string;
}

// Main Schedule Function
export async function scheduleTask(input: unknown): Promise<ScheduleTaskResult> {
  const parsed = ScheduleTaskInput.safeParse(input);
  
  if (!parsed.success) {
    return {
      success: false,
      taskId: '',
      status: 'immediate',
      taskType: 'UNKNOWN',
      error: 'Invalid input: ' + parsed.error.errors.map(e => e.message).join(', '),
    };
  }
  
  const { taskType, schedule, payload, metadata, userId } = parsed.data;
  const eventPayload = buildEventPayload(taskType, payload, userId);
  
  if (!eventPayload) {
    return {
      success: false,
      taskId: '',
      status: 'immediate',
      taskType,
      error: 'Unknown task type: ' + taskType,
    };
  }
  
  try {
    if (schedule.type === 'immediate') {
      const userId = 'system';
      const sessionId = (eventPayload as any).sessionId;
      const result = await emitEvent(eventPayload, userId, sessionId);
      return {
        success: true,
        taskId: result.eventId,
        status: 'immediate',
        taskType,
      };
    }
    
    if (schedule.type === 'delay' && schedule.delayMs) {
      const userId = 'system';
      const sessionId = (eventPayload as any).sessionId;
      const result = await emitEventWithOptions(eventPayload, {
        priority: metadata?.priority,
        delay: schedule.delayMs,
      }, userId, sessionId);
      return {
        success: true,
        taskId: result.eventId,
        status: 'delayed',
        taskType,
        scheduledFor: new Date(Date.now() + schedule.delayMs).toISOString(),
      };
    }
    
    if (schedule.type === 'cron' && schedule.expression) {
      const userId = 'system';
      const sessionId = (eventPayload as any).sessionId;
      const result = await emitEvent(eventPayload, userId, sessionId);
      return {
        success: true,
        taskId: result.eventId,
        status: 'scheduled',
        taskType,
        scheduledFor: 'cron: ' + schedule.expression,
      };
    }
    
    return {
      success: false,
      taskId: '',
      status: 'immediate',
      taskType,
      error: 'Invalid schedule configuration',
    };
  } catch (error: any) {
    return {
      success: false,
      taskId: '',
      status: 'immediate',
      taskType,
      error: error.message || 'Failed to schedule task',
    };
  }
}

// Event Payload Builders
function buildEventPayload(
  taskType: string,
  payload: Record<string, any>,
  userId: string
): AnyEvent | null {
  // Map task types to valid SCHEDULED_TASK taskType enum values
  const validTaskTypes = ['HACKER_NEWS_DAILY', 'RESEARCH_TASK', 'SEND_EMAIL', 'CUSTOM'] as const;
  
  // Handle custom task types not in the enum
  const normalizedTaskType = validTaskTypes.includes(taskType as any) 
    ? taskType as typeof validTaskTypes[number]
    : 'CUSTOM';

  return {
    type: 'SCHEDULED_TASK',
    taskType: normalizedTaskType,
    userId,
    payload,
    cronExpression: undefined,
    scheduledAt: undefined,
  };
}

// Task Status & Management
export async function getTaskStatus(taskId: string): Promise<{
  exists: boolean;
  status?: string;
  type?: string;
  createdAt?: string;
  completedAt?: string;
  error?: string;
}> {
  try {
    const { getEventById } = await import('./store');
    const event = await getEventById(taskId);
    if (!event) return { exists: false };
    return {
      exists: true,
      status: event.status,
      type: event.type,
      createdAt: event.createdAt,
      completedAt: event.completedAt,
      error: event.error,
    };
  } catch (error: any) {
    return { exists: false, error: error.message };
  }
}

export async function cancelTask(taskId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { cancelEvent } = await import('./router');
    await cancelEvent(taskId);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Utility: List Available Task Types
export function getAvailableTaskTypes(): Array<{
  type: string;
  description: string;
  examplePayload: Record<string, any>;
}> {
  return [
    { type: 'HACKER_NEWS_DAILY', description: 'Fetch and digest top Hacker News stories', examplePayload: { destination: 'user@example.com' } },
    { type: 'RESEARCH_TASK', description: 'Multi-step research task with depth control', examplePayload: { query: 'What is quantum computing?', depth: 5 } },
    { type: 'REPO_DIGEST', description: 'Regular repository digest', examplePayload: { repo: 'facebook/react', interval: 'daily' } },
    { type: 'SEND_EMAIL', description: 'Send an email', examplePayload: { to: 'user@example.com', subject: 'Hello', body: 'Message' } },
    { type: 'WEBHOOK', description: 'Call a webhook URL', examplePayload: { url: 'https://api.example.com/hook', method: 'POST', body: { data: 123 } } },
    { type: 'SANDBOX_COMMAND', description: 'Execute a command in sandbox', examplePayload: { command: 'echo hello', cwd: '/workspace', timeout: 30000 } },
    { type: 'NULLCLAW_AGENT', description: 'Trigger a nullclaw agent task', examplePayload: { prompt: 'Analyze this codebase', model: 'claude-3-opus' } },
    { type: 'CUSTOM_DAG', description: 'Execute a custom DAG workflow', examplePayload: { url: 'internal://dag', steps: [{ id: 1, action: 'build' }] } },
  ];
}