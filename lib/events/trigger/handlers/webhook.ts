/**
 * Webhook Handler
 * 
 * Custom webhook event handler.
 */

import { z } from 'zod';

// Webhook event schema
const WebhookEventSchema = z.object({
  userId: z.string(),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  body: z.any().optional(),
  headers: z.record(z.string()).optional(),
});

export async function handleWebhook(event: z.infer<typeof WebhookEventSchema>) {
  console.log(`[WebhookHandler] Calling ${event.method} ${event.url}`);
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...event.headers,
    };
    
    const init: RequestInit = {
      method: event.method,
      headers,
    };
    
    if (event.method && event.method !== 'GET' && event.body) {
      init.body = JSON.stringify(event.body);
    }
    
    const response = await fetch(event.url, init);
    const responseText = await response.text();
    
    const result = {
      url: event.url,
      method: event.method,
      status: response.status,
      response: responseText.slice(0, 1000),
    };
    
    console.log(`[WebhookHandler] Webhook called: ${response.status}`);
    return result;
  } catch (error: any) {
    console.error('[WebhookHandler] Error:', error.message);
    throw new Error(`Webhook failed: ${error.message}`);
  }
}