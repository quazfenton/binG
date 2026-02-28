/**
 * Nango Webhooks API
 *
 * Handles incoming webhooks from Nango for:
 * - Sync completion notifications
 * - Auth success/failure notifications
 * - Connection updates
 *
 * @see https://nango.dev/docs/webhooks
 */

import { NextRequest, NextResponse } from 'next/server';
import { getNangoService } from '@/lib/api/nango-service';

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
 * Handle incoming Nango webhooks
 * 
 * Webhook types:
 * - auth.success: OAuth connection successful
 * - auth.failure: OAuth connection failed
 * - sync.success: Sync completed successfully
 * - sync.error: Sync failed
 * - connection.deleted: Connection was deleted
 */
export async function POST(request: NextRequest) {
  try {
    const payload: NangoWebhookPayload = await request.json();
    
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
    
    // Still return 200 to prevent Nango from retrying
    // We don't want to lose webhooks due to processing errors
    return NextResponse.json({
      success: false,
      error: error.message,
      processedAt: new Date().toISOString(),
    });
  }
}

/**
 * Handle successful OAuth connection
 */
async function handleAuthSuccess(payload: NangoWebhookPayload): Promise<void> {
  console.log('[Nango Webhook] Auth success:', {
    connectionId: payload.connection.connectionId,
    provider: payload.connection.provider,
  });

  // TODO: Update connection status in database
  // TODO: Notify user of successful connection
  // TODO: Trigger initial sync if configured
}

/**
 * Handle failed OAuth connection
 */
async function handleAuthFailure(payload: NangoWebhookPayload): Promise<void> {
  console.log('[Nango Webhook] Auth failure:', {
    connectionId: payload.connection.connectionId,
    provider: payload.connection.provider,
    error: payload.data?.error,
  });

  // TODO: Update connection status in database
  // TODO: Notify user of failed connection
  // TODO: Log error for debugging
}

/**
 * Handle successful sync completion
 */
async function handleSyncSuccess(payload: NangoWebhookPayload): Promise<void> {
  console.log('[Nango Webhook] Sync success:', {
    connectionId: payload.connection.connectionId,
    provider: payload.connection.provider,
    syncName: payload.data?.syncName,
    recordsUpdated: payload.data?.recordsUpdated,
  });

  // TODO: Update sync status in database
  // TODO: Invalidate cached data
  // TODO: Notify subscribers of new data
  // TODO: Trigger dependent workflows
}

/**
 * Handle sync error
 */
async function handleSyncError(payload: NangoWebhookPayload): Promise<void> {
  console.log('[Nango Webhook] Sync error:', {
    connectionId: payload.connection.connectionId,
    provider: payload.connection.provider,
    syncName: payload.data?.syncName,
    error: payload.data?.error,
  });

  // TODO: Update sync status in database
  // TODO: Notify user of sync failure
  // TODO: Log error for debugging
  // TODO: Trigger retry if appropriate
}

/**
 * Handle connection deletion
 */
async function handleConnectionDeleted(payload: NangoWebhookPayload): Promise<void> {
  console.log('[Nango Webhook] Connection deleted:', {
    connectionId: payload.connection.connectionId,
    provider: payload.connection.provider,
  });

  // TODO: Remove connection from database
  // TODO: Clean up cached data
  // TODO: Notify user
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
