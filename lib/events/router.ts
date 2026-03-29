/**
 * Event Router
 * 
 * The execution layer that routes events to their handlers.
 * Based on trigger.md design.
 * 
 * This replaces brittle "if/else taskType" logic with a clean switch.
 */

import { AnyEvent, EventRecord } from './schema';
import { markEventComplete, markEventFailed } from './store';

// Import handlers
import { handleHackerNews } from './trigger/handlers/hacker-news';
import { handleResearch } from './trigger/handlers/research';
import { handleRepoDigest } from './trigger/handlers/repo-digest';
import { handleSendEmail } from './trigger/handlers/email';
import { handleWebhook } from './trigger/handlers/webhook';
import { handleSandboxCommand } from './trigger/handlers/sandbox';
import { handleNullclawAgent } from './trigger/handlers/nullclaw';

/**
 * Route an event to its handler based on type
 * 
 * @param eventRecord - The stored event record
 * @returns The result of handling the event
 */
export async function routeEvent(eventRecord: EventRecord): Promise<Record<string, any>> {
  const event = eventRecord.payload as AnyEvent;
  
  console.log(`[EventRouter] Routing event ${eventRecord.id} of type ${event.type}`);
  
  try {
    let result: Record<string, any>;
    
    switch (event.type) {
      case 'HACKER_NEWS_DAILY':
        result = await handleHackerNews(event);
        break;
        
      case 'RESEARCH_TASK':
        result = await handleResearch(event);
        break;
        
      case 'REPO_DIGEST':
        result = await handleRepoDigest(event);
        break;
        
      case 'SEND_EMAIL':
        result = await handleSendEmail(event);
        break;
        
      case 'WEBHOOK':
        result = await handleWebhook(event);
        break;
        
      case 'SANDBOX_COMMAND':
        result = await handleSandboxCommand(event);
        break;
        
      case 'NULLCLAW_AGENT':
        result = await handleNullclawAgent(event);
        break;
        
      default:
        throw new Error(`Unknown event type: ${(event as AnyEvent).type}`);
    }
    
    // Mark as completed
    await markEventComplete(eventRecord.id, result);
    
    console.log(`[EventRouter] Event ${eventRecord.id} handled successfully`);
    return result;
    
  } catch (err: any) {
    // Mark as failed
    await markEventFailed(eventRecord.id, err.message);
    
    console.error(`[EventRouter] Event ${eventRecord.id} failed:`, err.message);
    throw err;
  }
}

/**
 * Get handler name for an event type (for logging/monitoring)
 */
export function getHandlerName(eventType: string): string {
  const handlerNames: Record<string, string> = {
    HACKER_NEWS_DAILY: 'HackerNewsDailyHandler',
    RESEARCH_TASK: 'ResearchTaskHandler',
    REPO_DIGEST: 'RepoDigestHandler',
    SEND_EMAIL: 'EmailHandler',
    WEBHOOK: 'WebhookHandler',
    SANDBOX_COMMAND: 'SandboxCommandHandler',
    NULLCLAW_AGENT: 'NullclawAgentHandler',
  };
  
  return handlerNames[eventType] || 'UnknownHandler';
}