/**
 * Nango Sync Tools
 *
 * Provides sync-related tools for Nango integration:
 * - Trigger sync
 * - Get sync status
 * - List syncs
 * - Force full resync
 *
 * @see https://nango.dev/docs/syncs
 */

import { getNangoService } from '@/lib/platforms/nango-service';

export interface SyncToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Trigger a Nango sync
 */
export async function triggerSync(
  userId: string,
  providerConfigKey: string,
  syncName: string,
  fullResync: boolean = false
): Promise<SyncToolResult> {
  const nangoService = getNangoService();
  
  if (!nangoService) {
    return {
      success: false,
      error: 'Nango service not configured',
    };
  }

  try {
    const result = await nangoService.triggerSync(
      providerConfigKey,
      userId, // Use userId as connectionId
      syncName,
      fullResync
    );

    if (result.success) {
      return {
        success: true,
        data: {
          jobId: result.jobId,
          message: `Sync '${syncName}' triggered successfully`,
        },
      };
    } else {
      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to trigger sync',
    };
  }
}

/**
 * Get sync status
 */
export async function getSyncStatus(
  userId: string,
  providerConfigKey: string,
  syncName: string
): Promise<SyncToolResult & {
  status?: string;
  lastSyncDate?: string;
  nextSyncDate?: string;
}> {
  const nangoService = getNangoService();
  
  if (!nangoService) {
    return {
      success: false,
      error: 'Nango service not configured',
    };
  }

  try {
    const status = await nangoService.getSyncStatus(
      providerConfigKey,
      userId, // Use userId as connectionId
      syncName
    );

    return {
      success: status.status !== 'ERROR',
      status: status.status,
      lastSyncDate: String(status.lastSyncDate),
      error: status.error,
    } as SyncToolResult & { status: string; lastSyncDate?: string };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to get sync status',
    };
  }
}

/**
 * List all syncs for a user
 */
export async function listSyncs(
  userId: string,
  providerConfigKey: string
): Promise<SyncToolResult & {
  syncs?: Array<{
    name: string;
    status: string;
    lastSyncDate?: string;
    nextSyncDate?: string;
  }>;
}> {
  const nangoService = getNangoService();
  
  if (!nangoService) {
    return {
      success: false,
      error: 'Nango service not configured',
    };
  }

  try {
    const syncs = await nangoService.listSyncs(
      providerConfigKey,
      userId // Use userId as connectionId
    );

    return {
      success: true,
      syncs,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to list syncs',
    };
  }
}

/**
 * Force a full resync
 */
export async function forceFullResync(
  userId: string,
  providerConfigKey: string,
  syncName: string
): Promise<SyncToolResult> {
  return triggerSync(userId, providerConfigKey, syncName, true);
}

/**
 * Create Nango sync tools for agent use
 */
export function createNangoSyncTools() {
  return [
    {
      name: 'nango_trigger_sync',
      description: 'Trigger a Nango sync to update data from an external API',
      inputSchema: {
        type: 'object',
        properties: {
          providerConfigKey: {
            type: 'string',
            description: 'Nango provider config key (e.g., "github", "hubspot")',
          },
          syncName: {
            type: 'string',
            description: 'Name of the sync to trigger',
          },
          fullResync: {
            type: 'boolean',
            description: 'Whether to force a full resync (default: false)',
            default: false,
          },
        },
        required: ['providerConfigKey', 'syncName'],
      },
      execute: async (params: any) => {
        return triggerSync(
          params.userId,
          params.providerConfigKey,
          params.syncName,
          params.fullResync
        );
      },
    },
    {
      name: 'nango_get_sync_status',
      description: 'Get the status of a Nango sync',
      inputSchema: {
        type: 'object',
        properties: {
          providerConfigKey: {
            type: 'string',
            description: 'Nango provider config key',
          },
          syncName: {
            type: 'string',
            description: 'Name of the sync',
          },
        },
        required: ['providerConfigKey', 'syncName'],
      },
      execute: async (params: any) => {
        return getSyncStatus(
          params.userId,
          params.providerConfigKey,
          params.syncName
        );
      },
    },
    {
      name: 'nango_list_syncs',
      description: 'List all syncs for a provider connection',
      inputSchema: {
        type: 'object',
        properties: {
          providerConfigKey: {
            type: 'string',
            description: 'Nango provider config key',
          },
        },
        required: ['providerConfigKey'],
      },
      execute: async (params: any) => {
        return listSyncs(params.userId, params.providerConfigKey);
      },
    },
  ];
}

// Alias for backwards compatibility
export const nangoSyncTools = createNangoSyncTools;
