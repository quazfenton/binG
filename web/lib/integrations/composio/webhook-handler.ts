/**
 * Composio Webhook Handler
 *
 * Handles incoming webhook events from Composio triggers.
 * Verifies webhook signatures and routes events to handlers.
 *
 * @see https://docs.composio.dev/webhook-verification
 * @see docs/sdk/composio-llms-full.txt
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';

/**
 * Webhook event types
 */
export enum WebhookEventType {
  TRIGGER_MESSAGE = 'TRIGGER_MESSAGE',
  TRIGGER_STATE = 'TRIGGER_STATE',
  ACCOUNT_CONNECTED = 'ACCOUNT_CONNECTED',
  ACCOUNT_DISCONNECTED = 'ACCOUNT_DISCONNECTED',
}

/**
 * Webhook payload structure (V3)
 */
export interface WebhookPayload {
  id: string;
  event_type: WebhookEventType;
  timestamp: string;
  metadata: {
    trigger_id: string;
    trigger_slug: string;
    trigger_name: string;
    connected_account_id: string;
    app_name: string;
    app_slug: string;
  };
  data: Record<string, any>;
  original_payload: Record<string, any>;
}

/**
 * Verify Composio webhook signature
 *
 * @param payload - Raw webhook payload
 * @param signature - X-Composio-Webhook-Signature header
 * @param secret - Webhook secret from Composio
 * @returns True if signature is valid
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');

  return signature === expectedSignature;
}

/**
 * Parse webhook payload
 *
 * @param body - Raw request body
 * @returns Parsed webhook payload
 */
export function parseWebhookPayload(body: string): WebhookPayload {
  try {
    const payload = JSON.parse(body);
    
    // Validate required fields
    if (!payload.event_type || !payload.metadata || !payload.data) {
      throw new Error('Invalid webhook payload structure');
    }

    return payload as WebhookPayload;
  } catch (error: any) {
    throw new Error(`Failed to parse webhook payload: ${error.message}`);
  }
}

/**
 * Handle Composio webhook
 *
 * @param request - Next.js request
 * @returns Next.js response
 *
 * @example
 * ```typescript
 * // app/api/webhooks/composio/route.ts
 * import { handleComposioWebhook } from '@/lib/integrations/composio/webhook-handler';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Integration:ComposioWebhook');
 *
 * export async function POST(request: NextRequest) {
 *   return handleComposioWebhook(request);
 * }
 * ```
 */
export async function handleComposioWebhook(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-composio-webhook-signature');
    const secret = process.env.COMPOSIO_WEBHOOK_SECRET;

    // Verify signature if secret is configured
    if (secret && signature) {
      const isValid = verifyWebhookSignature(body, signature, secret);
      if (!isValid) {
        return NextResponse.json(
          { error: 'Invalid webhook signature' },
          { status: 401 }
        );
      }
    } else if (secret && !signature) {
      return NextResponse.json(
        { error: 'Missing webhook signature' },
        { status: 401 }
      );
    }

    // Parse payload
    const payload = parseWebhookPayload(body);

    // Process the parsed payload
    return processWebhookPayload(payload);
  } catch (error: any) {
    logger.error('[ComposioWebhook] Error:', error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    );
  }
}

/**
 * Process webhook with pre-parsed payload (avoids re-reading request body)
 */
export async function handleComposioWebhookWithPayload(payload: WebhookPayload): Promise<NextResponse> {
  return processWebhookPayload(payload);
}

/**
 * Internal function to process parsed webhook payload
 */
async function processWebhookPayload(payload: WebhookPayload): Promise<NextResponse> {
  // Log event (sanitized)
  logger.info('[ComposioWebhook] Received event:', {
    type: payload.event_type,
    triggerSlug: payload.metadata.trigger_slug,
    appName: payload.metadata.app_name,
  });

  // Route event based on type
  switch (payload.event_type) {
    case WebhookEventType.TRIGGER_MESSAGE:
      await handleTriggerMessage(payload);
      break;

    case WebhookEventType.TRIGGER_STATE:
      await handleTriggerState(payload);
      break;

    case WebhookEventType.ACCOUNT_CONNECTED:
      await handleAccountConnected(payload);
      break;

    case WebhookEventType.ACCOUNT_DISCONNECTED:
      await handleAccountDisconnected(payload);
      break;

    default:
      logger.warn('[ComposioWebhook] Unknown event type:', payload.event_type);
  }

  return NextResponse.json({ success: true });
}

/**
 * Handle TRIGGER_MESSAGE events
 */
const triggerHandlers = new Map<string, (data: Record<string, any>) => Promise<void>>();

export function registerTriggerHandler(
  triggerSlug: string,
  handler: (data: Record<string, any>) => Promise<void>
): void {
  triggerHandlers.set(triggerSlug, handler);
}

async function handleTriggerMessage(payload: WebhookPayload): Promise<void> {
  const { trigger_slug, connected_account_id, app_name } = payload.metadata;
  const eventData = payload.data;

  logger.info('[ComposioWebhook] Trigger message:', {
    trigger: trigger_slug,
    account: connected_account_id,
    dataKeys: Object.keys(eventData),
  });

  const handler = triggerHandlers.get(trigger_slug);
  if (handler) {
    await handler(eventData);
  } else {
    logger.info(`[ComposioWebhook] No handler registered for trigger: ${trigger_slug}`);
  }
}

/**
 * Handle TRIGGER_STATE events
 */
async function handleTriggerState(payload: WebhookPayload): Promise<void> {
  const { trigger_slug } = payload.metadata;
  const state = payload.data.state;

  logger.info('[ComposioWebhook] Trigger state changed:', {
    trigger: trigger_slug,
    state,
  });
}

const connectedAccounts = new Map<string, {
  accountId: string;
  appName: string;
  appSlug: string;
  connectedAt: Date;
  status: 'connected' | 'disconnected';
}>();

/**
 * Handle ACCOUNT_CONNECTED events
 */
async function handleAccountConnected(payload: WebhookPayload): Promise<void> {
  const { app_name, app_slug, connected_account_id } = payload.metadata;

  logger.info('[ComposioWebhook] Account connected:', {
    app: app_name,
    account: connected_account_id,
  });

  connectedAccounts.set(connected_account_id, {
    accountId: connected_account_id,
    appName: app_name,
    appSlug: app_slug,
    connectedAt: new Date(),
    status: 'connected',
  });

  logger.info(`[ComposioWebhook] Updated connected account: ${connected_account_id} for app: ${app_name}`);
}

/**
 * Handle ACCOUNT_DISCONNECTED events
 */
async function handleAccountDisconnected(payload: WebhookPayload): Promise<void> {
  const { app_name, connected_account_id } = payload.metadata;

  logger.info('[ComposioWebhook] Account disconnected:', {
    app: app_name,
    account: connected_account_id,
  });

  const account = connectedAccounts.get(connected_account_id);
  if (account) {
    account.status = 'disconnected';
    connectedAccounts.set(connected_account_id, account);
  }

  logger.info(`[ComposioWebhook] Updated disconnected account: ${connected_account_id} for app: ${app_name}`);
}

/**
 * Register webhook event handler
 *
 * @param eventType - Event type to handle
 * @param handler - Event handler function
 *
 * @example
 * ```typescript
 * registerWebhookHandler(WebhookEventType.TRIGGER_MESSAGE, async (payload) => {
 *   if (payload.metadata.trigger_slug === 'GITHUB_COMMIT_EVENT') {
 *     // Handle GitHub commit
 *   }
 * });
 * ```
 */
export function registerWebhookHandler(
  eventType: WebhookEventType,
  handler: (payload: WebhookPayload) => Promise<void>
): void {
  // Store handlers in a map for routing
  // This would be implemented based on your application's architecture
  logger.info('[ComposioWebhook] Handler registered for:', eventType);
}
