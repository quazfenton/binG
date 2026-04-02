/**
 * Event Schemas - Zod-validated event types for durable execution
 *
 * This module defines all event types that can be emitted to the event store.
 * Each event type is validated with Zod for type safety.
 *
 * @module events/schema
 */

import { z } from 'zod';

/**
 * Scheduled task events (user-defined cron jobs)
 */
export const ScheduledTaskEvent = z.object({
  type: z.literal('SCHEDULED_TASK'),
  taskType: z.enum(['HACKER_NEWS_DAILY', 'RESEARCH_TASK', 'SEND_EMAIL', 'CUSTOM']),
  userId: z.string(),
  payload: z.record(z.any()),
  cronExpression: z.string().optional(),
  scheduledAt: z.string().optional(),
});

/**
 * Background job events (long-running processes)
 */
export const BackgroundJobEvent = z.object({
  type: z.literal('BACKGROUND_JOB'),
  jobId: z.string(),
  sessionId: z.string(),
  sandboxId: z.string(),
  command: z.string(),
  interval: z.number().positive().optional(),
  userId: z.string(),
  quotaCategory: z.enum(['compute', 'io', 'api']).optional(),
});

/**
 * Orchestration step events (agent phase transitions)
 */
export const OrchestrationStepEvent = z.object({
  type: z.literal('ORCHESTRATION_STEP'),
  sessionId: z.string(),
  phase: z.enum(['planning', 'acting', 'verifying', 'responding']),
  iteration: z.number().int().min(0),
  userId: z.string(),
  metadata: z.record(z.any()).optional(),
});

/**
 * Workflow events (template-based execution)
 */
export const WorkflowEvent = z.object({
  type: z.literal('WORKFLOW'),
  templateId: z.string(),
  sessionId: z.string(),
  userId: z.string(),
  phase: z.enum(['started', 'step_completed', 'completed', 'failed']),
  stepId: z.string().optional(),
  result: z.any().optional(),
  error: z.string().optional(),
});

/**
 * Bash execution events (shell command execution)
 */
export const BashExecutionEvent = z.object({
  type: z.literal('BASH_EXECUTION'),
  command: z.string(),
  agentId: z.string(),
  sessionId: z.string(),
  persist: z.boolean().default(true),
  workingDir: z.string().optional(),
  env: z.record(z.string()).optional(),
});

/**
 * DAG execution events (pipeline workflows)
 */
export const DAGExecutionEvent = z.object({
  type: z.literal('DAG_EXECUTION'),
  dag: z.object({
    nodes: z.array(z.object({
      id: z.string(),
      type: z.enum(['bash', 'tool', 'container']),
      command: z.string().optional(),
      tool: z.string().optional(),
      args: z.any().optional(),
      dependsOn: z.array(z.string()).default([]),
      outputs: z.array(z.string()).optional(),
    })),
  }),
  agentId: z.string(),
  sessionId: z.string(),
});

/**
 * Human approval events (wait for user input)
 */
export const HumanApprovalEvent = z.object({
  type: z.literal('HUMAN_APPROVAL'),
  eventId: z.string(),
  action: z.string(),
  details: z.record(z.any()),
  timeout: z.number().positive().optional(), // milliseconds
  userId: z.string(),
});

/**
 * Self-healing events (automatic error recovery)
 */
export const SelfHealingEvent = z.object({
  type: z.literal('SELF_HEALING'),
  originalEventId: z.string(),
  error: z.string(),
  attempt: z.number().int().min(1),
  fix: z.string().optional(),
  success: z.boolean().optional(),
  userId: z.string(),
});

/**
 * Notification events (user notifications)
 */
export const NotificationEvent = z.object({
  type: z.literal('NOTIFICATION'),
  userId: z.string(),
  title: z.string(),
  message: z.string(),
  channel: z.enum(['email', 'sms', 'push', 'in-app']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  metadata: z.record(z.any()).optional(),
});

/**
 * Integration events (OAuth provider updates)
 */
export const IntegrationEvent = z.object({
  type: z.literal('INTEGRATION'),
  provider: z.string(),
  eventType: z.string(),
  userId: z.string(),
  data: z.record(z.any()),
  integrationId: z.string().optional(),
});

/**
 * Any event - discriminated union of all event types
 */
export const AnyEvent = z.discriminatedUnion('type', [
  ScheduledTaskEvent,
  BackgroundJobEvent,
  OrchestrationStepEvent,
  WorkflowEvent,
  BashExecutionEvent,
  DAGExecutionEvent,
  HumanApprovalEvent,
  SelfHealingEvent,
  NotificationEvent,
  IntegrationEvent,
]);

// Export types
export type ScheduledTaskEvent = z.infer<typeof ScheduledTaskEvent>;
export type BackgroundJobEvent = z.infer<typeof BackgroundJobEvent>;
export type OrchestrationStepEvent = z.infer<typeof OrchestrationStepEvent>;
export type WorkflowEvent = z.infer<typeof WorkflowEvent>;
export type BashExecutionEvent = z.infer<typeof BashExecutionEvent>;
export type DAGExecutionEvent = z.infer<typeof DAGExecutionEvent>;
export type HumanApprovalEvent = z.infer<typeof HumanApprovalEvent>;
export type SelfHealingEvent = z.infer<typeof SelfHealingEvent>;
export type NotificationEvent = z.infer<typeof NotificationEvent>;
export type IntegrationEvent = z.infer<typeof IntegrationEvent>;
export type AnyEvent = z.infer<typeof AnyEvent>;

// Export event type enum
export const EventTypes = {
  SCHEDULED_TASK: 'SCHEDULED_TASK',
  BACKGROUND_JOB: 'BACKGROUND_JOB',
  ORCHESTRATION_STEP: 'ORCHESTRATION_STEP',
  WORKFLOW: 'WORKFLOW',
  BASH_EXECUTION: 'BASH_EXECUTION',
  DAG_EXECUTION: 'DAG_EXECUTION',
  HUMAN_APPROVAL: 'HUMAN_APPROVAL',
  SELF_HEALING: 'SELF_HEALING',
  NOTIFICATION: 'NOTIFICATION',
  INTEGRATION: 'INTEGRATION',
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];
