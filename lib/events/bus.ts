/**
 * Event Bus
 * 
 * The main interface for LLM tools to emit events.
 * Based on trigger.md design - this is the ONLY thing the LLM touches.
 * 
 * LLM → emitEvent → writes event to store → background worker handles it
 */

import { AnyEvent, AnyEvent as EventType } from './schema';
import { createEvent } from './store';

/**
 * Emit an event to the event bus
 * This is the main entry point for LLM tools to create background tasks
 * 
 * @param input - The event payload (validated against Zod schema)
 * @returns The event ID and status
 */
export async function emitEvent(input: unknown): Promise<{
  eventId: string;
  status: 'queued';
  type: string;
}> {
  // Validate the input against our event schemas
  const parsed = EventType.parse(input);
  
  // Create the event in the store
  const event = await createEvent(parsed);
  
  return {
    eventId: event.id,
    status: 'queued',
    type: event.type,
  };
}

/**
 * Validate and emit an event (with more control)
 * Use this when you need to pass additional options
 */
export async function emitEventWithOptions(
  input: unknown,
  options?: {
    priority?: 'low' | 'normal' | 'high';
    delay?: number; // ms to delay execution
  }
): Promise<{
  eventId: string;
  status: 'queued' | 'delayed';
  type: string;
}> {
  const parsed = EventType.parse(input);
  const event = await createEvent(parsed);
  
  if (options?.delay && options.delay > 0) {
    // In production, you'd add delay logic here
    console.log(`[EventBus] Event ${event.id} queued with ${options.delay}ms delay`);
  }
  
  return {
    eventId: event.id,
    status: options?.delay ? 'delayed' : 'queued',
    type: event.type,
  };
}

/**
 * Helper to check if an event type is supported
 */
export function isValidEventType(type: string): boolean {
  const validTypes = [
    'HACKER_NEWS_DAILY',
    'RESEARCH_TASK',
    'REPO_DIGEST',
    'SEND_EMAIL',
    'WEBHOOK',
    'SANDBOX_COMMAND',
    'NULLCLAW_AGENT',
  ];
  return validTypes.includes(type);
}