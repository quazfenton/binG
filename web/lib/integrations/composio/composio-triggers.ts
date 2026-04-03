/**
 * Composio Triggers Integration
 * 
 * Provides event subscription and trigger management for Composio tools.
 * Triggers allow you to subscribe to external events and automatically
 * execute workflows when those events occur.
 * 
 * Features:
 * - Trigger creation and management
 * - Event subscription
 * - Webhook handling
 * - Trigger execution tracking
 * 
 * @see https://docs.composio.dev/triggers
 */

export interface ComposioTrigger {
  id: string;
  name: string;
  description: string;
  toolkit: string;
  status: 'active' | 'inactive' | 'error';
  config: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
  triggerCount: number;
}

export interface ComposioTriggerConfig {
  /** Trigger name/slug */
  name: string;
  /** Toolkit this trigger belongs to */
  toolkit: string;
  /** Trigger configuration parameters */
  config?: Record<string, any>;
  /** Webhook URL for receiving events */
  webhookUrl?: string;
  /** Filter conditions for trigger */
  filters?: Record<string, any>;
}

export interface ComposioTriggerEvent {
  triggerId: string;
  triggerName: string;
  toolkit: string;
  payload: Record<string, any>;
  receivedAt: string;
  processed: boolean;
}

export interface ComposioTriggerExecution {
  id: string;
  triggerId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  input: Record<string, any>;
  output?: Record<string, any>;
  error?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface ComposioTriggersConfig {
  /** Composio API key */
  apiKey?: string;
  /** Base URL (default: https://backend.composio.dev) */
  baseUrl?: string;
}

/**
 * Composio Triggers Service
 */
export class ComposioTriggersService {
  private apiKey?: string;
  private baseUrl: string;

  constructor(config: ComposioTriggersConfig = {}) {
    this.apiKey = config.apiKey || process.env.COMPOSIO_API_KEY;
    this.baseUrl = config.baseUrl || 'https://backend.composio.dev';
  }

  /**
   * Get authentication headers
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    return headers;
  }

  /**
   * List all available triggers across toolkits
   * 
   * @example
   * ```typescript
   * const triggers = await triggersService.listAvailableTriggers();
   * ```
   */
  async listAvailableTriggers(options?: {
    toolkit?: string;
    limit?: number;
  }): Promise<any[]> {
    const params = new URLSearchParams();

    if (options?.toolkit) params.append('toolkit', options.toolkit);
    if (options?.limit) params.append('limit', String(options.limit));

    const response = await fetch(
      `${this.baseUrl}/api/v1/triggers?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to list triggers: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create a new trigger subscription
   * 
   * @example
   * ```typescript
   * const trigger = await triggersService.createTrigger({
   *   name: 'github-issue-created',
   *   toolkit: 'github',
   *   config: {
   *     repo: 'myorg/myrepo',
   *     event: 'issues.opened'
   *   },
   *   webhookUrl: 'https://myapp.com/webhooks/composio'
   * });
   * ```
   */
  async createTrigger(config: ComposioTriggerConfig): Promise<ComposioTrigger> {
    const response = await fetch(`${this.baseUrl}/api/v1/triggers`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Failed to create trigger: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get trigger details by ID
   * 
   * @example
   * ```typescript
   * const trigger = await triggersService.getTrigger('trigger-123');
   * ```
   */
  async getTrigger(triggerId: string): Promise<ComposioTrigger> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/triggers/${triggerId}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get trigger: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Update trigger configuration
   * 
   * @example
   * ```typescript
   * await triggersService.updateTrigger('trigger-123', {
   *   config: { repo: 'neworg/newrepo' }
   * });
   * ```
   */
  async updateTrigger(
    triggerId: string,
    updates: Partial<ComposioTriggerConfig>
  ): Promise<ComposioTrigger> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/triggers/${triggerId}`,
      {
        method: 'PATCH',
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to update trigger: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Activate a trigger
   * 
   * @example
   * ```typescript
   * await triggersService.activateTrigger('trigger-123');
   * ```
   */
  async activateTrigger(triggerId: string): Promise<ComposioTrigger> {
    return this.updateTrigger(triggerId, { config: { status: 'active' } as any });
  }

  /**
   * Deactivate a trigger
   * 
   * @example
   * ```typescript
   * await triggersService.deactivateTrigger('trigger-123');
   * ```
   */
  async deactivateTrigger(triggerId: string): Promise<ComposioTrigger> {
    return this.updateTrigger(triggerId, { config: { status: 'inactive' } as any });
  }

  /**
   * Delete a trigger
   * 
   * @example
   * ```typescript
   * await triggersService.deleteTrigger('trigger-123');
   * ```
   */
  async deleteTrigger(triggerId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/triggers/${triggerId}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete trigger: ${response.statusText}`);
    }
  }

  /**
   * List trigger executions
   * 
   * @example
   * ```typescript
   * const executions = await triggersService.listExecutions('trigger-123');
   * ```
   */
  async listExecutions(triggerId: string, options?: {
    limit?: number;
    status?: 'pending' | 'running' | 'success' | 'failed';
  }): Promise<ComposioTriggerExecution[]> {
    const params = new URLSearchParams();

    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.status) params.append('status', options.status);

    const response = await fetch(
      `${this.baseUrl}/api/v1/triggers/${triggerId}/executions?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to list executions: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get trigger execution details
   * 
   * @example
   * ```typescript
   * const execution = await triggersService.getExecution('trigger-123', 'exec-456');
   * ```
   */
  async getExecution(triggerId: string, executionId: string): Promise<ComposioTriggerExecution> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/triggers/${triggerId}/executions/${executionId}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get execution: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Retry a failed trigger execution
   * 
   * @example
   * ```typescript
   * await triggersService.retryExecution('trigger-123', 'exec-456');
   * ```
   */
  async retryExecution(triggerId: string, executionId: string): Promise<ComposioTriggerExecution> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/triggers/${triggerId}/executions/${executionId}/retry`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to retry execution: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get trigger statistics
   * 
   * @example
   * ```typescript
   * const stats = await triggersService.getStats('trigger-123');
   * ```
   */
  async getStats(triggerId: string): Promise<{
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageDurationMs: number;
    lastTriggeredAt?: string;
  }> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/triggers/${triggerId}/stats`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get stats: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Handle incoming webhook from Composio
   * 
   * @example
   * ```typescript
   * app.post('/webhooks/composio', async (req, res) => {
   *   const event = await triggersService.handleWebhook(req.body, req.headers);
   *   
   *   if (event) {
   *     console.log(`Trigger ${event.triggerName} fired with payload:`, event.payload);
   *     // Process event...
   *   }
   *   
   *   res.json({ received: true });
   * });
   * ```
   */
  async handleWebhook(
    body: any,
    headers: Record<string, string | undefined>
  ): Promise<ComposioTriggerEvent | null> {
    // Verify webhook signature if secret is configured
    const signature = headers['x-composio-signature'];
    if (signature && process.env.COMPOSIO_WEBHOOK_SECRET) {
      const isValid = await this.verifyWebhookSignature(body, signature);
      if (!isValid) {
        throw new Error('Invalid webhook signature');
      }
    }

    // Parse trigger event
    if (!body.trigger_id || !body.trigger_name) {
      return null;
    }

    return {
      triggerId: body.trigger_id,
      triggerName: body.trigger_name,
      toolkit: body.toolkit,
      payload: body.payload || {},
      receivedAt: new Date().toISOString(),
      processed: false,
    };
  }

  /**
   * Verify webhook signature
   * 
   * Uses timing-safe comparison to prevent timing attacks
   * Validates buffer lengths before comparison
   */
  private async verifyWebhookSignature(payload: any, signature: string): Promise<boolean> {
    try {
      const crypto = await import('node:crypto');
      const secret = process.env.COMPOSIO_WEBHOOK_SECRET!;

      // Validate signature format (should be hex string)
      if (!/^[a-fA-F0-9]{64}$/.test(signature)) {
        console.warn('[Composio] Invalid signature format');
        return false;
      }

      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

      // Convert to buffers for timing-safe comparison
      const signatureBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      // Validate buffer lengths match (both should be 32 bytes for SHA256)
      if (signatureBuffer.length !== expectedBuffer.length) {
        console.warn('[Composio] Signature length mismatch');
        return false;
      }

      return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    } catch (error: any) {
      console.error('[Composio] Signature verification error:', error.message);
      return false;
    }
  }

  /**
   * Subscribe to trigger events (polling-based)
   * 
   * @example
   * ```typescript
   * const unsubscribe = await triggersService.subscribe(
   *   'trigger-123',
   *   (event) => {
   *     console.log('Trigger fired:', event);
   *   },
   *   { pollIntervalMs: 5000 }
   * );
   * 
   * // Later...
   * unsubscribe();
   * ```
   */
  async subscribe(
    triggerId: string,
    callback: (event: ComposioTriggerEvent) => void,
    options?: {
      pollIntervalMs?: number;
      onError?: (error: Error) => void;
    }
  ): Promise<() => void> {
    const pollInterval = options?.pollIntervalMs || 5000;
    let lastEventId = '';
    let stopped = false;

    const poll = async () => {
      if (stopped) return;

      try {
        const executions = await this.listExecutions(triggerId, { limit: 1 });
        
        if (executions.length > 0 && executions[0].id !== lastEventId) {
          lastEventId = executions[0].id;
          
          const event: ComposioTriggerEvent = {
            triggerId,
            triggerName: executions[0].id, // Will be filled with actual name
            toolkit: '',
            payload: executions[0].input,
            receivedAt: executions[0].startedAt,
            processed: executions[0].status === 'success',
          };

          callback(event);
        }
      } catch (error: any) {
        if (options?.onError) {
          options.onError(error);
        }
      }

      setTimeout(poll, pollInterval);
    };

    // Start polling
    poll();

    // Return unsubscribe function
    return () => {
      stopped = true;
    };
  }
}

/**
 * Create Composio Triggers service instance
 */
export function createComposioTriggersService(
  config?: ComposioTriggersConfig
): ComposioTriggersService {
  return new ComposioTriggersService(config);
}
