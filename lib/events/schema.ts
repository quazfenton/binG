/**
 * Event Schema Layer
 * 
 * Strongly typed event system based on trigger.md design.
 * All events are validated with Zod before being stored or processed.
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// Event Type Definitions
// -----------------------------------------------------------------------------

/**
 * Hacker News Daily Digest Event
 * Fetches top HN stories and summarizes them
 */
export const HACKER_NEWS_DAILY_EVENT = z.object({
  type: z.literal('HACKER_NEWS_DAILY'),
  userId: z.string(),
  destination: z.string().optional(), // e.g., phone number, email, webhook URL
});

/**
 * Research Task Event
 * Multi-step research task with depth control
 */
export const RESEARCH_TASK_EVENT = z.object({
  type: z.literal('RESEARCH_TASK'),
  userId: z.string(),
  query: z.string(),
  depth: z.number().min(1).max(10),
  sources: z.array(z.string()).optional(),
});

/**
 * Repo Digest Event
 * Regular repository digest (daily/weekly)
 */
export const REPO_DIGEST_EVENT = z.object({
  type: z.literal('REPO_DIGEST'),
  userId: z.string(),
  repo: z.string(),
  interval: z.enum(['daily', 'weekly']),
});

/**
 * Send Email Event
 */
export const SEND_EMAIL_EVENT = z.object({
  type: z.literal('SEND_EMAIL'),
  userId: z.string(),
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
});

/**
 * Custom Webhook Event
 */
export const WEBHOOK_EVENT = z.object({
  type: z.literal('WEBHOOK'),
  userId: z.string(),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('POST'),
  body: z.record(z.any()).optional(),
  headers: z.record(z.string()).optional(),
});

/**
 * Sandbox Command Event
 * Execute a command in a sandboxed environment
 */
export const SANDBOX_COMMAND_EVENT = z.object({
  type: z.literal('SANDBOX_COMMAND'),
  userId: z.string(),
  command: z.string(),
  cwd: z.string().optional(),
  timeout: z.number().optional(),
});

/**
 * Nullclaw Agent Event
 * Trigger a nullclaw agent task
 */
export const NULLCLAW_AGENT_EVENT = z.object({
  type: z.literal('NULLCLAW_AGENT'),
  userId: z.string(),
  prompt: z.string(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  context: z.record(z.any()).optional(),
});

// -----------------------------------------------------------------------------
// Discriminated Union - Any Event Type
// -----------------------------------------------------------------------------

/**
 * Union of all event types - used for validation and routing
 */
export const AnyEvent = z.discriminatedUnion('type', [
  HACKER_NEWS_DAILY_EVENT,
  RESEARCH_TASK_EVENT,
  REPO_DIGEST_EVENT,
  SEND_EMAIL_EVENT,
  WEBHOOK_EVENT,
  SANDBOX_COMMAND_EVENT,
  NULLCLAW_AGENT_EVENT,
]);

export type AnyEvent = z.infer<typeof AnyEvent>;

// -----------------------------------------------------------------------------
// Event Status
// -----------------------------------------------------------------------------

export const EventStatus = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']);
export type EventStatus = z.infer<typeof EventStatus>;

// -----------------------------------------------------------------------------
// Event Record (stored in DB)
// -----------------------------------------------------------------------------

export const EventRecord = z.object({
  id: z.string(),
  type: z.string(),
  payload: AnyEvent,
  status: EventStatus,
  createdAt: z.number(),
  processedAt: z.number().optional(),
  error: z.string().optional(),
  result: z.record(z.any()).optional(),
  userId: z.string(),
});

export type EventRecord = z.infer<typeof EventRecord>;

// -----------------------------------------------------------------------------
// Event Schemas Map (for external use)
// -----------------------------------------------------------------------------

export const EventSchemas = {
  HACKER_NEWS_DAILY: HACKER_NEWS_DAILY_EVENT,
  RESEARCH_TASK: RESEARCH_TASK_EVENT,
  REPO_DIGEST: REPO_DIGEST_EVENT,
  SEND_EMAIL: SEND_EMAIL_EVENT,
  WEBHOOK: WEBHOOK_EVENT,
  SANDBOX_COMMAND: SANDBOX_COMMAND_EVENT,
  NULLCLAW_AGENT: NULLCLAW_AGENT_EVENT,
};

export type EventType = AnyEvent['type'];