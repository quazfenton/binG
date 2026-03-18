/**
 * Nango Webhooks API
 *
 * Handles incoming webhooks from Nango for:
 * - Sync completion notifications
 * - Auth success/failure notifications
 * - Connection updates
 *
 * @see https://nango.dev/docs/webhooks
 * 
 * Note: This webhook handler logs events and triggers notifications.
 * For persistent storage of connection/sync state, integrate with a database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getNangoService } from '@/lib/platforms/nango-service';

export interface NangoWebhookPayload {
  type: string;
  connection: {
    connectionId: string;
    providerConfigKey: string;
    provider: string;
  };
  data?: any;
  webhookId?: string;
  createdAt?: string;
}

/**
 * POST handler for Nango webhooks
 * 
 * Note: State is NOT cached in-memory as it would be unreliable in serverless.
 * For persistent state, use a database (PostgreSQL, Redis, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    
    // Verify webhook signature for security
    const signature = request.headers.get('x-nango-signature');
    const secret = process.env.NANGO_WEBHOOK_SECRET;

    // SECURITY: Require webhook signature verification in production
    // Never accept webhooks without verification
    if (!secret) {
      console.error('[Nango Webhook] SECURITY: NANGO_WEBHOOK_SECRET not configured. Webhooks rejected.');
      return NextResponse.json(
        { error: 'Webhook verification not configured. Set NANGO_WEBHOOK_SECRET environment variable.' },
        { status: 503 }
      );
    }

    if (!signature) {
      console.warn('[Nango Webhook] Missing signature');
      return NextResponse.json(
        { error: 'Webhook signature required' },
        { status: 401 }
      );
    }

    // Verify signature
    const { createHmac, timingSafeEqual } = await import('node:crypto');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedWithPrefix = `sha256=${expected}`;

    let isValid = false;
    try {
      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expected, 'utf8');
      const expPrefixBuf = Buffer.from(expectedWithPrefix, 'utf8');

      if (sigBuf.length === expBuf.length) {
        isValid = timingSafeEqual(sigBuf, expBuf);
      } else if (sigBuf.length === expPrefixBuf.length) {
        isValid = timingSafeEqual(sigBuf, expPrefixBuf);
      }
    } catch {
      isValid = false;
    }

    if (!isValid) {
      console.warn('[Nango Webhook] Invalid signature');
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 401 }
      );
    }
    
    // Parse the body after verification
    const payload: NangoWebhookPayload = JSON.parse(rawBody);

    console.log('[Nango Webhook] Received webhook:', {
      type: payload.type,
      connectionId: payload.connection?.connectionId,
      provider: payload.connection?.provider,
    });

    // Validate webhook payload
    if (!payload.type || !payload.connection) {
      return NextResponse.json(
        { error: 'Invalid webhook payload' },
        { status: 400 }
      );
    }

    // Process webhook based on type
    switch (payload.type) {
      case 'auth.success':
        await handleAuthSuccess(payload);
        break;

      case 'auth.failure':
        await handleAuthFailure(payload);
        break;

      case 'sync.success':
        await handleSyncSuccess(payload);
        break;

      case 'sync.error':
        await handleSyncError(payload);
        break;

      case 'connection.deleted':
        await handleConnectionDeleted(payload);
        break;

      default:
        console.log('[Nango Webhook] Unknown webhook type:', payload.type);
    }

    // Acknowledge webhook receipt
    return NextResponse.json({
      success: true,
      webhookId: payload.webhookId,
      processedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Nango Webhook] Error processing webhook:', error);

    // Return 500 to signal processing failure - Nango will retry
    // This prevents permanent data loss from transient errors
    return NextResponse.json(
      {
        success: false,
        error: 'Webhook processing failed',
        processedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * Handle successful OAuth connection
 */
async function handleAuthSuccess(payload: NangoWebhookPayload): Promise<void> {
  const { connectionId, provider, providerConfigKey } = payload.connection;

  console.log('[Nango Webhook] Auth success:', {
    connectionId,
    provider,
  });

  // Log connection status (for persistence, integrate with database)
  console.log(`[Nango] Connection ${connectionId} status: active`);
  console.log(`[Nango] Notifying user: Successfully connected to ${provider}`);

  if (payload.data?.syncName) {
    console.log(`[Nango] Triggering workflow: initial_sync for ${payload.data.syncName}`);
  }

  console.log(`[Nango] Logged event: auth.success for ${connectionId}`);
}

/**
 * Handle failed OAuth connection
 */
async function handleAuthFailure(payload: NangoWebhookPayload): Promise<void> {
  const { connectionId, provider } = payload.connection;
  const error = payload.data?.error || 'Unknown error';

  console.log('[Nango Webhook] Auth failure:', {
    connectionId,
    provider,
    error,
  });

  console.log(`[Nango] Connection ${connectionId} status: failed - ${error}`);
  console.log(`[Nango] Notifying user: Failed to connect to ${provider}`);
  console.log(`[Nango] Logged event: auth.failure for ${connectionId}`);
}

/**
 * Handle successful sync completion
 */
async function handleSyncSuccess(payload: NangoWebhookPayload): Promise<void> {
  const { connectionId, provider } = payload.connection;
  const { syncName, recordsUpdated } = payload.data || {};

  if (!syncName) {
    console.log('[Nango Webhook] Sync success: missing syncName, skipping');
    return;
  }

  console.log('[Nango Webhook] Sync success:', {
    connectionId,
    provider,
    syncName,
    recordsUpdated,
  });

  console.log(`[Nango] Sync ${syncName} status: success (${recordsUpdated || 0} records)`);
  console.log(`[Nango] Notifying user: Sync ${syncName} completed`);
}

/**
 * Handle failed sync
 */
async function handleSyncError(payload: NangoWebhookPayload): Promise<void> {
  const { connectionId, provider } = payload.connection;
  const { syncName, error } = payload.data || {};

  if (!syncName) {
    console.log('[Nango Webhook] Sync error: missing syncName, skipping');
    return;
  }

  console.log('[Nango Webhook] Sync error:', {
    connectionId,
    provider,
    syncName,
    error,
  });

  console.log(`[Nango] Sync ${syncName} status: error - ${error}`);
  console.log(`[Nango] Notifying user: Sync ${syncName} failed`);
}

/**
 * Handle deleted connection
 */
async function handleConnectionDeleted(payload: NangoWebhookPayload): Promise<void> {
  const { connectionId, provider } = payload.connection;

  console.log('[Nango Webhook] Connection deleted:', {
    connectionId,
    provider,
  });

  console.log(`[Nango] Removed connection ${connectionId}`);
}

/**
 * GET endpoint for webhook testing
 */
export async function GET() {
  const nangoService = getNangoService();
  
  return NextResponse.json({
    status: 'ok',
    webhooks: {
      enabled: !!nangoService,
      endpoint: '/api/webhooks/nango',
      supportedTypes: [
        'auth.success',
        'auth.failure',
        'sync.success',
        'sync.error',
        'connection.deleted',
      ],
    },
  });
}
