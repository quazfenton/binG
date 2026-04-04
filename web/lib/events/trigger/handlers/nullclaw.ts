/**
 * Nullclaw Agent Handler
 * 
 * Trigger nullclaw agent tasks.
 */

import { z } from 'zod';

// Nullclaw agent event schema
const NullclawAgentEventSchema = z.object({
  userId: z.string(),
  prompt: z.string(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  context: z.record(z.any()).optional(),
});

const NULLCLAW_URL = process.env.NULLCLAW_URL || 'http://nullclaw:3000';

export async function handleNullclawAgent(event: z.infer<typeof NullclawAgentEventSchema>) {
  console.log(`[NullclawHandler] Starting agent task for user ${event.userId}`);
  
  try {
    const response = await fetch(`${NULLCLAW_URL}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: event.prompt,
        model: event.model,
        tools: event.tools,
        timeout: 120000, // 2 min default
        context: event.context,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Nullclaw agent failed (${response.status}): ${errorText}`);
    }
    
    const result = await response.json();
    
    return {
      prompt: event.prompt,
      model: event.model,
      result: typeof result === 'string' ? result : JSON.stringify(result),
    };
  } catch (error: any) {
    console.error('[NullclawHandler] Error:', error.message);
    throw new Error(`Nullclaw agent failed: ${error.message}`);
  }
}