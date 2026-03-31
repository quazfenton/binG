/**
 * Sandbox Command Handler
 * 
 * Execute commands in sandboxed environment.
 */

import { z } from 'zod';

// Sandbox command event schema
const SandboxCommandEventSchema = z.object({
  userId: z.string(),
  command: z.string(),
  cwd: z.string().optional(),
  timeout: z.number().optional(),
});

const SANDBOX_URL = process.env.SANDBOX_POOL_URL || 'http://sandbox:3005';

export async function handleSandboxCommand(event: z.infer<typeof SandboxCommandEventSchema>) {
  console.log(`[SandboxHandler] Executing command for user ${event.userId}`);
  
  try {
    // Acquire sandbox
    const acquireResp = await fetch(`${SANDBOX_URL}/acquire`, {
      method: 'POST',
    });
    
    if (!acquireResp.ok) {
      throw new Error('Failed to acquire sandbox');
    }
    
    const { sandboxId } = await acquireResp.json() as { sandboxId: string };
    
    try {
      // Execute command
      const execResp = await fetch(`${SANDBOX_URL}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sandboxId,
          command: event.command,
          cwd: event.cwd,
          timeout: event.timeout || 30000,
        }),
      });
      
      const result = await execResp.json();
      
      return {
        sandboxId,
        command: event.command,
        output: result?.output || result,
        exitCode: result?.exitCode,
      };
    } finally {
      // Release sandbox
      await fetch(`${SANDBOX_URL}/release/${sandboxId}`, {
        method: 'POST',
      }).catch(() => {});
    }
  } catch (error: any) {
    console.error('[SandboxHandler] Error:', error.message);
    throw new Error(`Sandbox command failed: ${error.message}`);
  }
}