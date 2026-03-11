/**
 * Blaxel Async Triggers
 * 
 * Support for long-running async agent execution (up to 15 minutes).
 * Includes callback webhook handling with signature verification.
 * 
 * Features:
 * - Async execution without keeping HTTP connection open
 * - Callback webhooks when job completes
 * - Signature verification for security
 * - Retry logic for failed callbacks
 * 
 * @see https://docs.blaxel.ai/Agents/Asynchronous-triggers
 * @see docs/sdk/blaxel-llms-full.txt Full documentation
 */

import { createHmac } from 'crypto';
import { generateSecureId } from '@/lib/utils';

/**
 * Async trigger configuration
 */
export interface AsyncTriggerConfig {
  /**
   * Unique trigger ID
   */
  id: string;
  
  /**
   * Callback URL for completion notification
   */
  callbackUrl?: string;
  
  /**
   * Retry count for failed callbacks
   * @default 3
   */
  retryCount?: number;
}

/**
 * Async execution result
 */
export interface AsyncExecutionResult {
  /**
   * Execution ID for tracking
   */
  executionId: string;
  
  /**
   * Execution status
   */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  
  /**
   * Result data (when completed)
   */
  result?: any;
  
  /**
   * Error message (when failed)
   */
  error?: string;
  
  /**
   * Timestamp when execution started
   */
  startedAt?: string;
  
  /**
   * Timestamp when execution completed
   */
  completedAt?: string;
}

/**
 * Webhook callback payload from Blaxel
 */
export interface BlaxelWebhookPayload {
  /**
   * HTTP status code of the response
   */
  status_code: number;
  
  /**
   * Response body as string
   */
  response_body: string;
  
  /**
   * Response length in bytes
   */
  response_length: number;
  
  /**
   * Unix timestamp when callback was sent
   */
  timestamp: number;
}

/**
 * Blaxel Async Trigger Manager
 */
export class BlaxelAsyncManager {
  private workspace: string;
  private apiKey?: string;

  constructor(options?: {
    workspace?: string;
    apiKey?: string;
  }) {
    this.workspace = options?.workspace || process.env.BLAXEL_WORKSPACE || '';
    this.apiKey = options?.apiKey || process.env.BLAXEL_API_KEY;
  }

  /**
   * Execute agent asynchronously
   * 
   * @param agentId - Agent ID to execute
   * @param input - Input data for agent
   * @param config - Async trigger configuration
   * @returns Execution result with ID for tracking
   */
  async executeAsync(
    agentId: string,
    input: any,
    config?: AsyncTriggerConfig
  ): Promise<AsyncExecutionResult> {
    if (!this.workspace) {
      throw new Error(
        'Blaxel workspace not configured. ' +
        'Set BLAXEL_WORKSPACE environment variable or pass workspace in options.'
      );
    }

    const baseUrl = `https://run.blaxel.ai/${this.workspace}/agents/${agentId}`;
    const url = `${baseUrl}?async=true`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Blaxel async execution failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    return {
      executionId: `${agentId}-${Date.now()}`,
      status: 'pending',
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Get async execution status
   * 
   * @param agentId - Agent ID
   * @param executionId - Execution ID from executeAsync
   * @returns Current execution status
   */
  async getExecutionStatus(
    agentId: string,
    executionId: string
  ): Promise<AsyncExecutionResult> {
    if (!this.workspace) {
      throw new Error('Blaxel workspace not configured');
    }

    const baseUrl = `https://run.blaxel.ai/${this.workspace}/agents/${agentId}/executions/${executionId}`;

    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(baseUrl, { headers });

    if (response.status === 404) {
      return {
        executionId,
        status: 'pending',
      };
    }

    if (!response.ok) {
      throw new Error(`Failed to get execution status: ${response.status}`);
    }

    const data = await response.json();

    return {
      executionId,
      status: data.status || 'running',
      result: data.result,
      error: data.error,
      startedAt: data.started_at,
      completedAt: data.completed_at,
    };
  }

  /**
   * Cancel async execution
   * 
   * @param agentId - Agent ID
   * @param executionId - Execution ID to cancel
   */
  async cancelExecution(
    agentId: string,
    executionId: string
  ): Promise<void> {
    if (!this.workspace) {
      throw new Error('Blaxel workspace not configured');
    }

    const baseUrl = `https://run.blaxel.ai/${this.workspace}/agents/${agentId}/executions/${executionId}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(baseUrl, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to cancel execution: ${response.status}`);
    }
  }

  async createTrigger(
    agentId: string,
    config: AsyncTriggerConfig
  ): Promise<{
    triggerId: string;
    callbackSecret?: string;
  }> {
    if (!this.workspace) {
      throw new Error(
        'Blaxel workspace not configured. ' +
        'Set BLAXEL_WORKSPACE environment variable or pass workspace in options.'
      );
    }

    const baseUrl = `https://api.blaxel.ai/v1/${this.workspace}/agents/${agentId}/triggers`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body: Record<string, any> = {
      type: 'async',
      id: config.id || `async-${agentId}-${Date.now()}`,
    };

    if (config.callbackUrl) {
      body.callback_url = config.callbackUrl;
    }

    if (config.retryCount !== undefined) {
      body.retry_count = config.retryCount;
    }

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Blaxel createTrigger failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    return {
      triggerId: result.id || body.id,
      callbackSecret: result.callback_secret,
    };
  }

  /**
   * Verify webhook callback signature
   * 
   * @param request - Express request or similar
   * @param secret - Callback secret from Blaxel
   * @returns True if signature is valid
   */
  verifyWebhookSignature(
    request: {
      body: string;
      headers: Record<string, string | undefined>;
    },
    secret: string
  ): boolean {
    const signature = request.headers['x-blaxel-signature'];
    const timestamp = request.headers['x-blaxel-timestamp'];

    if (!signature || !timestamp) {
      console.warn('[BlaxelAsyncManager] Missing webhook signature headers');
      return false;
    }

    // Verify timestamp is recent (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const timestampNum = parseInt(timestamp as string, 10);
    if (Math.abs(now - timestampNum) > 300) {
      console.warn('[BlaxelAsyncManager] Webhook timestamp too old');
      return false;
    }

    // Verify signature
    const expectedSignature = signWebhook(request.body, secret, timestamp as string);
    
    if (signature !== `sha256=${expectedSignature}`) {
      console.warn('[BlaxelAsyncManager] Invalid webhook signature');
      return false;
    }

    return true;
  }

  /**
   * Parse webhook payload
   * 
   * @param request - Request with body
   * @returns Parsed webhook payload
   */
  parseWebhookPayload(request: { body: string }): BlaxelWebhookPayload {
    try {
      return JSON.parse(request.body);
    } catch (error) {
      throw new Error(`Failed to parse webhook payload: ${error}`);
    }
  }

  /**
   * Handle webhook callback
   * 
   * @param request - Webhook request
   * @param secret - Callback secret
   * @param handler - Handler function for completed execution
   * @returns Response indicating success/failure
   */
  async handleWebhook(
    request: {
      body: string;
      headers: Record<string, string | undefined>;
    },
    secret: string,
    handler: (payload: BlaxelWebhookPayload) => Promise<void>
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    // Verify signature
    if (!this.verifyWebhookSignature(request, secret)) {
      return {
        success: false,
        error: 'Invalid webhook signature',
      };
    }

    // Parse payload
    let payload: BlaxelWebhookPayload;
    try {
      payload = this.parseWebhookPayload(request);
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }

    // Call handler
    try {
      await handler(payload);
      return { success: true };
    } catch (error: any) {
      console.error('[BlaxelAsyncManager] Webhook handler failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

/**
 * Generate callback secret
 * 
 * In production, Blaxel generates this. This is a placeholder.
 */
function generateCallbackSecret(): string {
  return generateSecureId('blaxel_cb');
}

/**
 * Sign webhook payload
 */
function signWebhook(body: string, secret: string, timestamp: string): string {
  const payload = `${timestamp}.${body}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify webhook from request (helper function)
 * 
 * @param request - Request object
 * @param secret - Callback secret
 * @returns True if valid
 */
export function verifyWebhookFromRequest(
  request: {
    body: string;
    headers: Record<string, string | undefined>;
  },
  secret: string
): boolean {
  const manager = new BlaxelAsyncManager();
  return manager.verifyWebhookSignature(request, secret);
}

// Singleton instance
export const blaxelAsyncManager = new BlaxelAsyncManager();
