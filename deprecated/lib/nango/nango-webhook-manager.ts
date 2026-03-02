/**
 * Nango Webhook Manager
 * 
 * Real-time event subscriptions from external APIs
 * Use cases:
 * - GitHub issue notifications
 * - Slack message alerts
 * - Salesforce lead updates
 * 
 * Documentation: docs/sdk/nango-llms-full.txt
 */

import { Nango } from '@nangohq/node';
import { createHmac, timingSafeEqual } from 'crypto';

const nango = new Nango({
  secretKey: process.env.NANGO_SECRET_KEY || '',
});

export interface WebhookSubscription {
  providerConfigKey: string;
  connectionId: string;
  types: string[];
  webhookUrl?: string;
}

export interface WebhookEvent {
  type: string;
  provider: string;
  connectionId: string;
  data: any;
  timestamp: Date;
}

/**
 * Subscribe to webhook events
 */
export async function subscribeToWebhooks(
  config: WebhookSubscription
): Promise<{
  success: boolean;
  subscriptionId?: string;
  error?: string;
}> {
  try {
    if (!process.env.NANGO_SECRET_KEY) {
      return {
        success: false,
        error: 'NANGO_SECRET_KEY not configured',
      };
    }

    // Nango webhooks API - using internal method
    // @ts-ignore - Nango v4 API
    const result = await (nango as any).webhooks?.subscribe({
      providerConfigKey: config.providerConfigKey,
      connectionId: config.connectionId,
      types: config.types,
      webhookUrl: config.webhookUrl,
    });

    return {
      success: true,
      subscriptionId: result?.subscription_id,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Unsubscribe from webhook events
 */
export async function unsubscribeFromWebhooks(
  subscriptionId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    if (!process.env.NANGO_SECRET_KEY) {
      return {
        success: false,
        error: 'NANGO_SECRET_KEY not configured',
      };
    }

    // @ts-ignore - Nango v4 API\n    await (nango as any).webhooks?.unsubscribe(subscriptionId);

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Process incoming webhook
 */
export async function processWebhook(
  payload: any,
  signature: string
): Promise<{
  success: boolean;
  event?: WebhookEvent;
  error?: string;
}> {
  try {
    // Verify signature
    const isValid = verifyWebhookSignature(
      JSON.stringify(payload),
      signature,
      process.env.NANGO_WEBHOOK_SECRET || ''
    );

    if (!isValid) {
      return {
        success: false,
        error: 'Invalid webhook signature',
      };
    }

    // Parse webhook event
    const event: WebhookEvent = {
      type: payload.type,
      provider: payload.provider_config_key,
      connectionId: payload.connection_id,
      data: payload.data,
      timestamp: new Date(),
    };

    return {
      success: true,
      event,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * List webhook subscriptions
 */
export async function listWebhookSubscriptions(
  providerConfigKey?: string
): Promise<{
  success: boolean;
  subscriptions?: Array<{
    id: string;
    providerConfigKey: string;
    connectionId: string;
    types: string[];
    createdAt: Date;
  }>;
  error?: string;
}> {
  try {
    if (!process.env.NANGO_SECRET_KEY) {
      return {
        success: false,
        error: 'NANGO_SECRET_KEY not configured',
      };
    }

    const subscriptions = await nango.webhooks.listSubscriptions(
      providerConfigKey ? { providerConfigKey } : undefined
    );

    return {
      success: true,
      subscriptions: subscriptions.map((s: any) => ({
        id: s.id,
        providerConfigKey: s.provider_config_key,
        connectionId: s.connection_id,
        types: s.types,
        createdAt: new Date(s.created_at),
      })),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Webhook handler for Express/Next.js
 */
export function createWebhookHandler(secret: string) {
  return async (req: {
    body: any;
    headers: Record<string, string | undefined>;
  }): Promise<{
    success: boolean;
    event?: WebhookEvent;
    error?: string;
  }> => {
    const signature = req.headers['x-nango-signature'] || '';
    
    if (!signature) {
      return {
        success: false,
        error: 'Missing webhook signature',
      };
    }

    return processWebhook(req.body, signature);
  };
}

/**
 * Helper for API routes
 */
export async function handleWebhookRequest(
  userId: string,
  action: 'subscribe' | 'unsubscribe' | 'list',
  params: Record<string, any>
): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  try {
    switch (action) {
      case 'subscribe': {
        const result = await subscribeToWebhooks({
          providerConfigKey: params.provider,
          connectionId: userId,
          types: params.types,
          webhookUrl: params.webhookUrl,
        });
        
        return result.success
          ? { success: true, data: { subscriptionId: result.subscriptionId } }
          : { success: false, error: result.error };
      }

      case 'unsubscribe': {
        const result = await unsubscribeFromWebhooks(params.subscriptionId);
        
        return result.success
          ? { success: true, data: { message: 'Unsubscribed successfully' } }
          : { success: false, error: result.error };
      }

      case 'list': {
        const result = await listWebhookSubscriptions(params.provider);
        
        return result.success
          ? { success: true, data: { subscriptions: result.subscriptions } }
          : { success: false, error: result.error };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}
