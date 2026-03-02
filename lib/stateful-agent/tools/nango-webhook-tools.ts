/**
 * Nango Webhook Tools
 * 
 * Real-time event handling from external APIs using Nango Webhooks.
 * Supports webhook subscription, forwarding, and processing.
 * 
 * @see https://nango.dev/docs/webhooks
 * @see docs/sdk/nango-llms-full.txt Full documentation
 */

import { tool } from 'ai';
import { z } from 'zod';
import { Nango } from '@nangohq/node';

// Initialize Nango client
const nango = new Nango({
  secretKey: process.env.NANGO_SECRET_KEY || '',
});

/**
 * Subscribe to webhooks for a provider
 */
export const subscribeWebhookTool = tool({
  description: `Subscribe to webhooks for a provider connection.

USE CASES:
- Real-time notifications for CRM updates
- Instant file change notifications
- Live calendar event updates
- Real-time messaging updates

SUPPORTED EVENTS (varies by provider):
- GitHub: issue.created, issue.updated, pr.opened, pr.merged
- Gmail: message.new, message.updated
- Slack: message.created, channel.created
- Notion: page.created, page.updated, database.updated

EXAMPLES:
- GitHub issues: { webhookTypes: ['issue.created', 'issue.updated'] }
- Gmail messages: { webhookTypes: ['message.new'] }`,
  parameters: z.object({
    providerConfigKey: z.string().describe('Nango provider config key'),
    connectionId: z.string().describe('Connection ID for the user'),
    webhookTypes: z.array(z.string()).describe('Array of webhook event types to subscribe to'),
    webhookUrl: z.string().url().optional().describe('Custom webhook URL (uses Nango default if not provided)'),
  }),
  execute: async ({ providerConfigKey, connectionId, webhookTypes, webhookUrl }) => {
    try {
      // Subscribe to webhooks via Nango
      const result = await nango.webhooks.subscribe({
        providerConfigKey,
        connectionId,
        types: webhookTypes,
        webhookUrl,
      });

      return {
        success: true,
        message: `Subscribed to ${webhookTypes.length} webhook types`,
        subscription: {
          providerConfigKey,
          connectionId,
          types: webhookTypes,
          webhookUrl: webhookUrl || 'Nango default',
        },
        subscriptionId: result?.subscriptionId,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to subscribe to webhooks',
        details: {
          providerConfigKey,
          connectionId,
          webhookTypes,
        },
      };
    }
  },
});

/**
 * Unsubscribe from webhooks
 */
export const unsubscribeWebhookTool = tool({
  description: `Unsubscribe from webhooks for a provider connection.

USE CASES:
- Stop receiving notifications
- Clean up webhook subscriptions
- Change webhook configuration`,
  parameters: z.object({
    providerConfigKey: z.string().describe('Nango provider config key'),
    connectionId: z.string().describe('Connection ID for the user'),
    subscriptionId: z.string().describe('Subscription ID to unsubscribe'),
  }),
  execute: async ({ providerConfigKey, connectionId, subscriptionId }) => {
    try {
      await nango.webhooks.unsubscribe({
        providerConfigKey,
        connectionId,
        subscriptionId,
      });

      return {
        success: true,
        message: `Unsubscribed from webhook subscription ${subscriptionId}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to unsubscribe from webhooks',
        details: {
          providerConfigKey,
          connectionId,
          subscriptionId,
        },
      };
    }
  },
});

/**
 * List webhook subscriptions
 */
export const listWebhookSubscriptionsTool = tool({
  description: `List all webhook subscriptions for a provider connection.

USE CASES:
- View active webhook subscriptions
- Debug webhook issues
- Audit webhook configuration

RETURNS: Array of subscriptions with types, URLs, and status`,
  parameters: z.object({
    providerConfigKey: z.string().describe('Nango provider config key'),
    connectionId: z.string().optional().describe('Connection ID (optional, lists all if not provided)'),
  }),
  execute: async ({ providerConfigKey, connectionId }) => {
    try {
      const result = await nango.webhooks.listSubscriptions({
        providerConfigKey,
        connectionId,
      });

      return {
        success: true,
        subscriptions: result?.subscriptions || [],
        count: result?.subscriptions?.length || 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to list webhook subscriptions',
        details: {
          providerConfigKey,
          connectionId,
        },
      };
    }
  },
});

/**
 * Process incoming webhook (for custom webhook handling)
 */
export const processWebhookTool = tool({
  description: `Process an incoming webhook from Nango.

USE CASES:
- Handle webhook in custom backend
- Forward webhook to another service
- Log webhook events
- Trigger actions based on webhook

NOTE: This is for processing webhooks received at YOUR endpoint.
Nango can also process webhooks directly (see subscribe_webhook).`,
  parameters: z.object({
    webhookPayload: z.object({}).passthrough().describe('Webhook payload from Nango'),
    webhookSignature: z.string().optional().describe('Webhook signature for verification'),
    expectedProvider: z.string().optional().describe('Expected provider for validation'),
  }),
  execute: async ({ webhookPayload, webhookSignature, expectedProvider }) => {
    try {
      // Verify webhook signature if provided
      if (webhookSignature) {
        const isValid = await verifyWebhookSignature(webhookPayload, webhookSignature);
        if (!isValid) {
          return {
            success: false,
            error: 'Invalid webhook signature',
            verified: false,
          };
        }
      }

      // Process webhook based on type
      const webhookType = webhookPayload.type;
      const provider = webhookPayload.provider;

      // Validate provider if expected
      if (expectedProvider && provider !== expectedProvider) {
        return {
          success: false,
          error: `Unexpected provider: ${provider} (expected ${expectedProvider})`,
        };
      }

      // Process based on webhook type
      const processedData = await processWebhookByType(webhookType, webhookPayload);

      return {
        success: true,
        processed: true,
        webhookType,
        provider,
        data: processedData,
        verified: !!webhookSignature,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to process webhook',
        details: {
          payload: webhookPayload,
        },
      };
    }
  },
});

/**
 * Configure webhook forwarding
 */
export const configureWebhookForwardingTool = tool({
  description: `Configure Nango to forward webhooks to your endpoint.

USE CASES:
- Forward webhooks to your backend
- Set up custom webhook processing
- Integrate with external services

RETURNS: Webhook configuration with URL and secret`,
  parameters: z.object({
    providerConfigKey: z.string().describe('Nango provider config key'),
    webhookUrl: z.string().url().describe('Your webhook endpoint URL'),
    webhookTypes: z.array(z.string()).optional().describe('Specific webhook types to forward (forwards all if not provided)'),
  }),
  execute: async ({ providerConfigKey, webhookUrl, webhookTypes }) => {
    try {
      // Configure webhook forwarding via Nango
      const result = await nango.webhooks.configureForwarding({
        providerConfigKey,
        webhookUrl,
        types: webhookTypes,
      });

      return {
        success: true,
        message: 'Webhook forwarding configured successfully',
        config: {
          providerConfigKey,
          webhookUrl,
          types: webhookTypes || 'all',
          secret: result?.secret,
        },
        note: 'Use the secret to verify webhook signatures at your endpoint',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to configure webhook forwarding',
        details: {
          providerConfigKey,
          webhookUrl,
        },
      };
    }
  },
});

// ===========================================
// Helper Functions
// ===========================================

/**
 * Verify webhook signature
 */
async function verifyWebhookSignature(
  payload: any,
  signature: string
): Promise<boolean> {
  try {
    const crypto = await import('crypto');
    const secret = process.env.NANGO_WEBHOOK_SECRET;
    
    if (!secret) {
      console.warn('[NangoWebhooks] NANGO_WEBHOOK_SECRET not configured');
      return false;
    }

    const payloadString = JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');

    return signature === `sha256=${expectedSignature}`;
  } catch {
    return false;
  }
}

/**
 * Process webhook by type
 */
async function processWebhookByType(
  webhookType: string,
  payload: any
): Promise<any> {
  // Process based on webhook type
  switch (webhookType) {
    case 'auth.success':
      return {
        action: 'connection_authorized',
        connectionId: payload.connectionId,
        provider: payload.provider,
      };

    case 'auth.failure':
      return {
        action: 'connection_failed',
        connectionId: payload.connectionId,
        provider: payload.provider,
        error: payload.error,
      };

    case 'sync.success':
      return {
        action: 'sync_completed',
        connectionId: payload.connectionId,
        syncName: payload.syncName,
        records: payload.records,
      };

    case 'sync.error':
      return {
        action: 'sync_failed',
        connectionId: payload.connectionId,
        syncName: payload.syncName,
        error: payload.error,
      };

    default:
      // Provider-specific webhooks (github.*, gmail.*, etc.)
      return {
        action: 'webhook_received',
        type: webhookType,
        data: payload.data,
        connectionId: payload.connectionId,
      };
  }
}

// Export all webhook tools
export const nangoWebhookTools = {
  subscribe_webhook: subscribeWebhookTool,
  unsubscribe_webhook: unsubscribeWebhookTool,
  list_webhook_subscriptions: listWebhookSubscriptionsTool,
  process_webhook: processWebhookTool,
  configure_webhook_forwarding: configureWebhookForwardingTool,
};

export type NangoWebhookToolName = keyof typeof nangoWebhookTools;
