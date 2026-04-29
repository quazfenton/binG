/**
 * Webhook Handler
 * 
 * Custom webhook event handler with HMAC signature validation
 * and per-target rate limiting.
 *
 * MED-9: Outbound webhooks now include HMAC-SHA256 signatures.
 * MED-10: Per-target rate limiting prevents webhook abuse.
 */

import { z } from 'zod';
import { createHmac } from 'crypto';

// Webhook event schema
const WebhookEventSchema = z.object({
  userId: z.string(),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  body: z.any().optional(),
  headers: z.record(z.string()).optional(),
});

// MED-10: Per-target rate limiting for outbound webhooks
const WEBHOOK_RATE_LIMITS = new Map<string, { count: number; windowStart: number }>();
const WEBHOOK_RATE_LIMIT_MAX = parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX || '100', 10) || 100;
const WEBHOOK_RATE_LIMIT_WINDOW_MS = parseInt(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000;

function checkWebhookRateLimit(targetHost: string): boolean {
  const now = Date.now();
  const entry = WEBHOOK_RATE_LIMITS.get(targetHost);
  
  if (!entry || now - entry.windowStart > WEBHOOK_RATE_LIMIT_WINDOW_MS) {
    WEBHOOK_RATE_LIMITS.set(targetHost, { count: 1, windowStart: now });
    return true;
  }
  
  if (entry.count >= WEBHOOK_RATE_LIMIT_MAX) {
    return false; // Rate limited
  }
  
  entry.count++;
  return true;
}

// Lazy-initialized cleanup timer for rate limit entries (prevents leak in serverless/edge)
let rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;

function startRateLimitCleanup(): void {
  if (rateLimitCleanupTimer) return;
  rateLimitCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [host, entry] of WEBHOOK_RATE_LIMITS) {
      if (now - entry.windowStart > WEBHOOK_RATE_LIMIT_WINDOW_MS * 2) {
        WEBHOOK_RATE_LIMITS.delete(host);
      }
    }
  }, 5 * 60 * 1000);
  // Don't prevent process exit in Node.js
  if (rateLimitCleanupTimer && typeof rateLimitCleanupTimer === 'object' && 'unref' in rateLimitCleanupTimer) {
    (rateLimitCleanupTimer as any).unref();
  }
}

// MED-9: Sign outbound webhook payload with HMAC-SHA256
function signWebhookPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export async function handleWebhook(event: z.infer<typeof WebhookEventSchema>) {
  // Lazy-init rate limit cleanup on first call
  startRateLimitCleanup();

  // MED-10: Check rate limit before sending
  let targetHost: string;
  try {
    targetHost = new URL(event.url).hostname;
  } catch {
    throw new Error(`Invalid webhook URL: ${event.url}`);
  }
  
  if (!checkWebhookRateLimit(targetHost)) {
    throw new Error(`Webhook rate limit exceeded for ${targetHost}. Max ${WEBHOOK_RATE_LIMIT_MAX} per minute.`);
  }
  
  console.log(`[WebhookHandler] Calling ${event.method} ${event.url}`);
  
  try {
    const bodyStr = event.body ? JSON.stringify(event.body) : '';
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...event.headers,
    };
    
    // MED-9: Add HMAC signature header if webhook secret is configured
    const webhookSecret = process.env.WEBHOOK_SIGNING_SECRET;
    if (webhookSecret && bodyStr) {
      const signature = signWebhookPayload(bodyStr, webhookSecret);
      headers['X-bing-Signature'] = `sha256=${signature}`;
      headers['X-bing-Signature-Algorithm'] = 'hmac-sha256';
    }
    
    const init: RequestInit = {
      method: event.method,
      headers,
    };
    
    if (event.method && event.method !== 'GET' && event.body) {
      init.body = bodyStr;
    }
    
    const response = await fetch(event.url, init);
    const responseText = await response.text();
    
    const result = {
      url: event.url,
      method: event.method,
      status: response.status,
      response: responseText.slice(0, 1000),
      signed: !!webhookSecret,
    };
    
    console.log(`[WebhookHandler] Webhook called: ${response.status}${webhookSecret ? ' (signed)' : ''}`);
    return result;
  } catch (error: any) {
    console.error('[WebhookHandler] Error:', error.message);
    throw new Error(`Webhook failed: ${error.message}`);
  }
}
