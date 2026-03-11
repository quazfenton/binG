/**
 * Blaxel Async Manager
 * Provides async execution and webhook handling for Blaxel functions.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { generateSecureId } from '@/lib/utils';

export interface AsyncTriggerConfig {
  webhookUrl?: string;
  callbackUrl?: string;
  timeout?: number;
}

export interface AsyncExecutionResult {
  success: boolean;
  executionId?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface BlaxelWebhookPayload {
  executionId: string;
  status: string;
  result?: any;
  error?: string;
  timestamp: number;
}

export class BlaxelAsyncManager {
  private executions: Map<string, AsyncExecutionResult> = new Map();

  async executeAsync(
    fn: () => Promise<any>,
    config?: AsyncTriggerConfig
  ): Promise<AsyncExecutionResult> {
    const executionId = generateSecureId('exec');
    
    this.executions.set(executionId, {
      success: false,
      executionId,
      status: 'pending',
    });

    // Execute asynchronously - wrap in Promise.resolve to handle synchronous throws
    Promise.resolve()
      .then(() => fn())
      .then((result) => {
        this.executions.set(executionId, {
          success: true,
          executionId,
          status: 'completed',
          result,
        });
      })
      .catch((error) => {
        this.executions.set(executionId, {
          success: false,
          executionId,
          status: 'failed',
          error: error.message,
        });
      });

    return {
      success: true,
      executionId,
      status: 'pending',
    };
  }

  getExecutionStatus(executionId: string): AsyncExecutionResult | undefined {
    return this.executions.get(executionId);
  }
}

export const blaxelAsyncManager = new BlaxelAsyncManager();

/**
 * Verify webhook signature from request
 * Implements HMAC-SHA256 signature verification with timestamp validation
 *
 * @param request - Request object with body and headers
 * @param secret - Webhook secret for signature verification
 * @returns True if signature is valid, false otherwise
 */
export function verifyWebhookFromRequest(
  request: {
    body: string;
    headers: Record<string, string | undefined>;
  },
  secret: string
): boolean {
  if (!secret) {
    console.warn('[BlaxelWebhook] No webhook secret configured - rejecting all webhooks');
    return false;
  }

  const signature = request.headers['x-blaxel-signature'];
  const timestamp = request.headers['x-blaxel-timestamp'];

  if (!signature || !timestamp) {
    return false;
  }

  // Verify timestamp is recent (within 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  const timestampNum = parseInt(timestamp, 10);
  if (isNaN(timestampNum) || Math.abs(now - timestampNum) > 300) {
    console.warn('[BlaxelWebhook] Webhook timestamp too old or invalid');
    return false;
  }

  // Compute expected signature
  const payload = `${timestamp}.${request.body}`;
  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Verify signature format (sha256=<hex>)
  if (!signature.startsWith('sha256=')) {
    return false;
  }

  const receivedSignature = signature.substring(7);

  // Use timing-safe comparison to prevent timing attacks
  let signatureBuffer: Buffer;
  let expectedBuffer: Buffer;
  try {
    signatureBuffer = Buffer.from(receivedSignature, 'hex');
    expectedBuffer = Buffer.from(expectedSignature, 'hex');
  } catch {
    // Invalid hex encoding in signature
    return false;
  }

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}
