/**
 * Nango Sync Manager
 * 
 * Continuous data synchronization with external APIs
 * Use cases:
 * - CRM sync (HubSpot, Salesforce)
 * - File sync (Google Drive, Dropbox)
 * - Code sync (GitHub, GitLab issues/PRs)
 * 
 * Documentation: docs/sdk/nango-llms-full.txt
 * 
 * Note: Uses Nango v4+ API structure
 */

import { Nango } from '@nangohq/node';

const nango = new Nango({
  secretKey: process.env.NANGO_SECRET_KEY || '',
});

export interface SyncConfig {
  providerConfigKey: string;
  connectionId: string;
  syncName: string;
  fullResync?: boolean;
}

export interface SyncStatus {
  status: 'RUNNING' | 'SUCCESS' | 'ERROR' | 'PAUSED';
  recordsCount?: number;
  lastSyncDate?: Date;
  nextSyncDate?: Date;
  error?: string;
}

/**
 * Trigger sync for specific connection
 * Note: Nango v4 API uses positional arguments
 */
export async function triggerSync(config: SyncConfig): Promise<{
  success: boolean;
  syncId?: string;
  error?: string;
}> {
  try {
    if (!process.env.NANGO_SECRET_KEY) {
      return {
        success: false,
        error: 'NANGO_SECRET_KEY not configured',
      };
    }

    // Nango v4 API: triggerSync(providerConfigKey, syncs, connectionId, syncMode)
    const syncMode = config.fullResync ? 'full_refresh' : 'incremental';

    // @ts-ignore - Nango v4 API\n    await (nango as any).triggerSync(
      config.providerConfigKey,
      [config.syncName],
      config.connectionId,
      syncMode
    );

    return {
      success: true,
      syncId: `${config.providerConfigKey}:${config.syncName}:${config.connectionId}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get sync status
 */
export async function getSyncStatus(config: SyncConfig): Promise<SyncStatus> {
  try {
    if (!process.env.NANGO_SECRET_KEY) {
      return {
        status: 'ERROR',
        error: 'NANGO_SECRET_KEY not configured',
      };
    }

    // Nango v4 API: syncStatus(providerConfigKey, syncName, connectionId)
    const status = await nango.syncStatus(
      config.providerConfigKey,
      config.syncName,
      config.connectionId
    );

    return {
      status: (status as any).status || 'ERROR',
      recordsCount: (status as any).latestResult?.recordsCount,
      lastSyncDate: (status as any).latestResult?.createdAt ? new Date((status as any).latestResult.createdAt) : undefined,
      error: (status as any).latestResult?.error,
    };
  } catch (error: any) {
    return {
      status: 'ERROR',
      error: error.message,
    };
  }
}

/**
 * Get synced records
 */
export async function getSyncRecords(
  config: SyncConfig & { model: string; limit?: number }
): Promise<{
  success: boolean;
  records?: any[];
  error?: string;
}> {
  try {
    if (!process.env.NANGO_SECRET_KEY) {
      return {
        success: false,
        error: 'NANGO_SECRET_KEY not configured',
      };
    }

    // Nango v4 API: getRecords(providerConfigKey, connectionId, model, options)
    const records = await (nango as any).getRecords(
      config.providerConfigKey,
      config.connectionId,
      config.model,
      { limit: config.limit || 100 }
    );

    return {
      success: true,
      records: records?.records || [],
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * List all syncs for connection
 */
export async function listSyncs(connectionId: string): Promise<{
  success: boolean;
  syncs?: Array<{
    name: string;
    status: string;
    lastSyncDate?: Date;
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

    // Nango v4 API: isSync(connectionId) returns sync status
    const syncs = await (nango as any).isSync(connectionId);
    
    if (!syncs || typeof syncs !== 'object') {
      return {
        success: true,
        syncs: [],
      };
    }

    // Convert sync object to array
    const syncArray = Object.entries(syncs).map(([name, status]: [string, any]) => ({
      name,
      status: status.status || 'unknown',
      lastSyncDate: status.createdAt ? new Date(status.createdAt) : undefined,
    }));

    return {
      success: true,
      syncs: syncArray,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Start continuous sync for user
 */
export async function startContinuousSync(
  userId: string,
  provider: string,
  syncName: string
): Promise<{
  success: boolean;
  syncId?: string;
  error?: string;
}> {
  return triggerSync({
    providerConfigKey: provider,
    connectionId: userId,
    syncName,
    fullResync: false, // Incremental sync
  });
}

/**
 * Get sync history for connection
 * Note: Nango v4 doesn't have direct sync history API
 * This is a placeholder for future implementation
 */
export async function getSyncHistory(
  connectionId: string,
  syncName: string,
  limit: number = 10
): Promise<{
  success: boolean;
  history?: Array<{
    id: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  error?: string;
}> {
  try {
    // Nango v4 doesn't expose sync history directly
    // This would require custom implementation or webhook tracking
    return {
      success: false,
      error: 'Sync history not available in Nango v4 API. Use webhooks to track sync events.',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Sync helper for API routes
 */
export async function handleSyncRequest(
  userId: string,
  action: 'trigger' | 'status' | 'records',
  params: Record<string, any>
): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  try {
    switch (action) {
      case 'trigger': {
        const result = await triggerSync({
          providerConfigKey: params.provider,
          connectionId: userId,
          syncName: params.syncName,
          fullResync: params.fullResync || false,
        });
        
        return result.success 
          ? { success: true, data: { syncId: result.syncId } }
          : { success: false, error: result.error };
      }

      case 'status': {
        const status = await getSyncStatus({
          providerConfigKey: params.provider,
          connectionId: userId,
          syncName: params.syncName,
        });
        
        return { success: true, data: status };
      }

      case 'records': {
        const result = await getSyncRecords({
          providerConfigKey: params.provider,
          connectionId: userId,
          syncName: params.syncName,
          model: params.model,
          limit: params.limit,
        });
        
        return result.success
          ? { success: true, data: { records: result.records } }
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
