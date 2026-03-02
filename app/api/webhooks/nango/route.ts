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

interface ConnectionRecord {
  id: string;
  userId: string;
  provider: string;
  status: string;
  updatedAt: Date;
}

interface SyncRecord {
  id: string;
  connectionId: string;
  syncName: string;
  status: string;
  lastSyncAt?: Date;
  error?: string;
}

const connectionCache = new Map<string, ConnectionRecord>();
const syncStatusCache = new Map<string, SyncRecord>();

async function updateConnectionStatus(
  connectionId: string,
  provider: string,
  status: string,
  userId?: string
): Promise<void> {
  const record: ConnectionRecord = {
    id: connectionId,
    userId: userId || connectionId,
    provider,
    status,
    updatedAt: new Date(),
  };
  connectionCache.set(connectionId, record);
  console.log(`[Nango] Updated connection ${connectionId} status to ${status}`);
}

async function updateSyncStatus(
  connectionId: string,
  syncName: string,
  status: string,
  recordsUpdated?: number,
  error?: string
): Promise<void> {
  const key = `${connectionId}:${syncName}`;
  const record: SyncRecord = {
    id: key,
    connectionId,
    syncName,
    status,
    lastSyncAt: status === 'success' ? new Date() : undefined,
    error,
  };
  syncStatusCache.set(key, record);
  console.log(`[Nango] Updated sync ${syncName} status to ${status}`);
}

async function notifyUser(userId: string, notification: {
  type: string;
  title: string;
  message: string;
  data?: any;
}): Promise<void> {
  console.log(`[Nango] Notifying user ${userId}:`, notification.title);
}

async function logNangoEvent(event: {
  type: string;
  connectionId: string;
  provider: string;
  data?: any;
  timestamp: Date;
}): Promise<void> {
  console.log(`[Nango] Logged event: ${event.type} for ${event.connectionId}`);
}

async function triggerWorkflow(workflowName: string, input: any): Promise<void> {
  console.log(`[Nango] Triggering workflow: ${workflowName}`);
}

async function invalidateCache(connectionId: string, syncName?: string): Promise<void> {
  if (syncName) {
    syncStatusCache.delete(`${connectionId}:${syncName}`);
  } else {
    connectionCache.delete(connectionId);
  }
  console.log(`[Nango] Invalidated cache for ${connectionId}`);
}

async function removeConnection(connectionId: string): Promise<void> {
  connectionCache.delete(connectionId);
  for (const [key] of syncStatusCache.entries()) {
    if (key.startsWith(connectionId)) {
      syncStatusCache.delete(key);
    }
  }
  console.log(`[Nango] Removed connection ${connectionId} from database`);
}

async function cleanupCachedData(connectionId: string): Promise<void> {
  invalidateCache(connectionId);
  console.log(`[Nango] Cleaned up cached data for ${connectionId}`);
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
  const { connectionId, provider, providerConfigKey } = payload.connection;
  
  console.log('[Nango Webhook] Auth success:', {
    connectionId,
    provider,
  });

  await updateConnectionStatus(connectionId, provider, 'active');

  await notifyUser(connectionId, {
    type: 'connection_success',
    title: 'Connection Successful',
    message: `Successfully connected to ${provider}`,
    data: { connectionId, provider },
  });

  if (payload.data?.syncName) {
    await triggerWorkflow('initial_sync', {
      connectionId,
      providerConfigKey,
      syncName: payload.data.syncName,
    });
  }

  await logNangoEvent({
    type: 'auth.success',
    connectionId,
    provider,
    data: payload.data,
    timestamp: new Date(),
  });
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

  await updateConnectionStatus(connectionId, provider, 'failed');

  await notifyUser(connectionId, {
    type: 'connection_failed',
    title: 'Connection Failed',
    message: `Failed to connect to ${provider}: ${error}`,
    data: { connectionId, provider, error },
  });

  await logNangoEvent({
    type: 'auth.failure',
    connectionId,
    provider,
    data: { error },
    timestamp: new Date(),
  });
}

/**
 * Handle successful sync completion
 */
async function handleSyncSuccess(payload: NangoWebhookPayload): Promise<void> {
  const { connectionId, provider, providerConfigKey } = payload.connection;
  const { syncName, recordsUpdated } = payload.data || {};
  
  console.log('[Nango Webhook] Sync success:', {
    connectionId,
    provider,
    syncName,
    recordsUpdated,
  });

  await updateSyncStatus(connectionId, syncName, 'success', recordsUpdated);

  await invalidateCache(connectionId, syncName);

  await notifyUser(connectionId, {
    type: 'sync_complete',
    title: 'Sync Complete',
    message: `Synced ${recordsUpdated || 0} records from ${provider}`,
    data: { connectionId, syncName, recordsUpdated },
  });

  if (payload.data?.triggerWorkflow) {
    await triggerWorkflow(payload.data.triggerWorkflow, {
      connectionId,
      providerConfigKey,
      syncName,
      recordsUpdated,
    });
  }
}

/**
 * Handle sync error
 */
async function handleSyncError(payload: NangoWebhookPayload): Promise<void> {
  const { connectionId, provider } = payload.connection;
  const { syncName } = payload.data || {};
  const error = payload.data?.error || 'Unknown sync error';
  
  console.log('[Nango Webhook] Sync error:', {
    connectionId,
    provider,
    syncName,
    error,
  });

  await updateSyncStatus(connectionId, syncName, 'error', 0, error);

  await notifyUser(connectionId, {
    type: 'sync_error',
    title: 'Sync Failed',
    message: `Sync failed for ${syncName}: ${error}`,
    data: { connectionId, syncName, error },
  });

  await logNangoEvent({
    type: 'sync.error',
    connectionId,
    provider,
    data: { syncName, error },
    timestamp: new Date(),
  });

  if (payload.data?.retryEnabled) {
    setTimeout(async () => {
      await triggerWorkflow('retry_sync', {
        connectionId,
        syncName,
      });
    }, 60000);
  }
}

/**
 * Handle connection deletion
 */
async function handleConnectionDeleted(payload: NangoWebhookPayload): Promise<void> {
  const { connectionId, provider } = payload.connection;
  
  console.log('[Nango Webhook] Connection deleted:', {
    connectionId,
    provider,
  });

  await removeConnection(connectionId);

  await cleanupCachedData(connectionId);

  await notifyUser(connectionId, {
    type: 'connection_deleted',
    title: 'Connection Removed',
    message: `Connection to ${provider} has been removed`,
    data: { connectionId, provider },
  });
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
