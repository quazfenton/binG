import { tool } from 'ai';
import { z } from 'zod';
import { nangoConnectionManager } from './nango-connection';
import { nangoRateLimiter } from './nango-rate-limit';
import { getNangoService } from '@/lib/integrations/nango-service';
import { nangoWebhookTools } from './nango-webhook-tools';

interface NangoProxyOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  connectionId: string;
  body?: any;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

async function executeNangoProxy<T = any>(
  provider: string,
  options: NangoProxyOptions
): Promise<{ success: boolean; data?: T; error?: string }> {
  // Check rate limit first
  const rateLimit = await nangoRateLimiter.checkLimit(provider);
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: `Rate limit exceeded for ${provider}. Try again in ${rateLimit.retryAfter} seconds.`,
    };
  }

  // Retry logic with exponential backoff
  const maxRetries = 3;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await nangoConnectionManager.proxy<T>({
        ...options,
        providerConfigKey: provider,
      });

      if (result.success) {
        nangoRateLimiter.recordRequest(provider);
      }

      return result;
    } catch (error: any) {
      lastError = error.message || String(error);

      // Don't retry on certain errors
      if (
        (error as any).status === 401 ||
        (error as any).status === 403 ||
        (error as any).status === 404
      ) {
        return {
          success: false,
          error: lastError ?? undefined,
        };
      }

      if (attempt === maxRetries) {
        return {
          success: false,
          error: lastError ?? undefined,
        };
      }

      // Exponential backoff
      const backoffTime = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
  }

  return {
    success: false,
    error: lastError || 'Unknown error',
  };
}

export const nangoGitHubTools = {
  github_list_repos: tool({
    description: `List GitHub repositories for the authenticated user.

    USE CASES:
    - Find repositories to work with
    - Check repository existence
    - Get repository metadata

    RETURNS: Array of repository objects with name, owner, description, etc.`,
    parameters: z.object({
      connectionId: z.string().describe('Nango connection ID for GitHub'),
      page: z.number().optional().describe('Page number (default: 1)'),
      per_page: z.number().refine((val) => val <= 100, 'Items per page must be at most 100').optional().describe('Items per page (default: 30, max: 100)'),
    }),
    execute: async ({ connectionId, page = 1, per_page = 30 }, ctx: any) => {
      const result = await executeNangoProxy('github', {
        method: 'GET',
        endpoint: '/user/repos',
        connectionId,
        params: { page: page.toString(), per_page: per_page.toString() },
      });
      return result.success
        ? { success: true as const, repos: result.data }
        : { success: false as const, error: result.error };
    },
  } as any),

  github_create_issue: tool({
    description: `Create a new GitHub issue.

    USE CASES:
    - Report bugs
    - Request features
    - Track tasks

    REQUIRES: Repository owner, repo name, and issue title`,
    parameters: z.object({
      connectionId: z.string().describe('Nango connection ID for GitHub'),
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository name'),
      title: z.string().describe('Issue title'),
      body: z.string().optional().describe('Issue body/description'),
      labels: z.array(z.string()).optional().describe('Issue labels'),
    }),
    execute: async ({ connectionId, owner, repo, title, body, labels }, ctx: any) => {
      const result = await executeNangoProxy('github', {
        method: 'POST',
        endpoint: `/repos/${owner}/${repo}/issues`,
        connectionId,
        body: { title, body, labels },
      });
      return result.success
        ? { success: true as const, issue: result.data }
        : { success: false as const, error: result.error };
    },
  } as any),

  github_create_pull_request: tool({
    description: `Create a new GitHub pull request.

    USE CASES:
    - Propose code changes
    - Merge branches
    - Contribute to open source

    REQUIRES: Owner, repo, title, head branch, base branch`,
    parameters: z.object({
      connectionId: z.string().describe('Nango connection ID for GitHub'),
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
      title: z.string().describe('PR title'),
      head: z.string().describe('The name of the branch where your changes are implemented'),
      base: z.string().describe('The name of the branch you want the changes pulled into'),
      body: z.string().optional().describe('PR description'),
    }),
    execute: async ({ connectionId, owner, repo, title, head, base, body }, ctx: any) => {
      const result = await executeNangoProxy('github', {
        method: 'POST',
        endpoint: `/repos/${owner}/${repo}/pulls`,
        connectionId,
        body: { title, head, base, body },
      });
      return result.success
        ? { success: true as const, pull_request: result.data }
        : { success: false as const, error: result.error };
    },
  } as any),

  github_get_file: tool({
    description: `Get a file from a GitHub repository.

    USE CASES:
    - Read file contents
    - Check file existence
    - Get file metadata including SHA

    RETURNS: File content (decoded from base64) and SHA`,
    parameters: z.object({
      connectionId: z.string().describe('Nango connection ID for GitHub'),
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
      path: z.string().describe('Path to the file'),
      ref: z.string().optional().describe('Branch name or commit SHA (default: default branch)'),
    }),
    execute: async ({ connectionId, owner, repo, path, ref }, ctx: any) => {
      const endpoint = `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`;
      const result = await executeNangoProxy<any>('github', {
        method: 'GET',
        endpoint,
        connectionId,
      });

      if (!result.success || !result.data) {
        return { success: false as const, error: result.error };
      }

      // Decode base64 content
      try {
        const content = Buffer.from(result.data.content, 'base64').toString('utf-8');
        return { success: true as const, content, sha: result.data.sha };
      } catch (error) {
        return {
          success: false as const,
          error: `Failed to decode content: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    },
  } as any),
};

export const nangoSlackTools = {
  slack_send_message: tool({
    description: `Send a message to a Slack channel.

    USE CASES:
    - Send notifications
    - Post updates to team
    - Reply to threads

    REQUIRES: Channel ID (can get from slack_list_channels)`,
    parameters: z.object({
      connectionId: z.string().describe('Nango connection ID for Slack'),
      channel: z.string().describe('Slack channel ID (e.g., C0123456789)'),
      text: z.string().describe('Message text'),
      thread_ts: z.string().optional().describe('Thread timestamp to reply in a thread'),
    }),
    execute: async ({ connectionId, channel, text, thread_ts }, ctx: any) => {
      const result = await executeNangoProxy('slack', {
        method: 'POST',
        endpoint: '/chat.postMessage',
        connectionId,
        body: { channel, text, thread_ts },
      });
      return result.success
        ? { success: true as const, message: result.data }
        : { success: false as const, error: result.error };
    },
  } as any),

  slack_list_channels: tool({
    description: `List Slack channels.

    USE CASES:
    - Find channel IDs for sending messages
    - Discover available channels
    - Get channel metadata`,
    parameters: z.object({
      connectionId: z.string().describe('Nango connection ID for Slack'),
      limit: z.number().refine((val) => val <= 100, 'Limit must be at most 100').optional().describe('Maximum number of channels (default: 100)'),
    }),
    execute: async ({ connectionId, limit = 100 }, ctx: any) => {
      const result = await executeNangoProxy('slack', {
        method: 'GET',
        endpoint: '/conversations.list',
        connectionId,
        params: { limit: limit.toString() },
      });
      return result.success
        ? { success: true as const, channels: result.data?.channels || [] }
        : { success: false as const, error: result.error };
    },
  } as any),
};

export const nangoNotionTools = {
  notion_search: tool({
    description: `Search Notion pages and databases.

    USE CASES:
    - Find pages by title or content
    - Discover databases
    - Get page IDs for operations`,
    parameters: z.object({
      connectionId: z.string().describe('Nango connection ID for Notion'),
      query: z.string().describe('Search query'),
      filter: z.object({
        value: z.enum(['page', 'database']),
        property: z.literal('object'),
      }).optional().describe('Filter by object type'),
    }),
    execute: async ({ connectionId, query, filter }, ctx: any) => {
      const result = await executeNangoProxy('notion', {
        method: 'POST',
        endpoint: '/v1/search',
        connectionId,
        body: { query, filter },
      });
      return result.success
        ? { success: true as const, results: result.data?.results || [] }
        : { success: false as const, error: result.error };
    },
  } as any),

  notion_create_page: tool({
    description: `Create a new Notion page.

    USE CASES:
    - Create documentation pages
    - Add notes
    - Create database entries

    REQUIRES: Parent page ID (use notion_search to find)`,
    parameters: z.object({
      connectionId: z.string().describe('Nango connection ID for Notion'),
      parent_page_id: z.string().describe('Parent page ID'),
      title: z.string().describe('Page title'),
      content: z.string().optional().describe('Page content (markdown)'),
    }),
    execute: async ({ connectionId, parent_page_id, title, content }, ctx: any) => {
      const result = await executeNangoProxy('notion', {
        method: 'POST',
        endpoint: '/v1/pages',
        connectionId,
        body: {
          parent: { page_id: parent_page_id },
          properties: {
            title: {
              title: [{ text: { content: title } }],
            },
          },
          children: content
            ? [
                {
                  object: 'block',
                  type: 'paragraph',
                  paragraph: {
                    rich_text: [{ text: { content } }],
                  },
                },
              ]
            : undefined,
        },
      });
      return result.success
        ? { success: true as const, page: result.data }
        : { success: false as const, error: result.error };
    },
  } as any),
};

// ─── Nango Sync Tools (Vercel AI SDK tool() wrappers) ───────────────────────
export const nangoSyncToolWrappers = {
  nango_trigger_sync: tool({
    description: `Trigger a Nango sync to update data from an external API.

    USE CASES:
    - Sync GitHub issues, pull requests
    - Sync CRM contacts from HubSpot/Salesforce
    - Sync files from Google Drive/Dropbox
    - Trigger continuous data sync

    REQUIRES: Provider config key and sync name`,
    parameters: z.object({
      providerConfigKey: z.string().describe('Nango provider config key (e.g., "github", "hubspot")'),
      syncName: z.string().describe('Name of the sync to trigger'),
      fullResync: z.boolean().optional().describe('Force full resync (default: false)'),
      connectionId: z.string().optional().describe('Connection ID (defaults to user ID from context)'),
    }),
    execute: async ({ providerConfigKey, syncName, fullResync, connectionId }, ctx: any) => {
      const service = getNangoService();
      if (!service) return { success: false as const, error: 'Nango service not configured' };
      const userId = connectionId || ctx?.userId || 'default';
      const result = await service.triggerSync(providerConfigKey, userId, syncName, !!fullResync);
      return result.success
        ? { success: true as const, jobId: result.jobId, message: `Sync '${syncName}' triggered` }
        : { success: false as const, error: result.error };
    },
  } as any),

  nango_get_sync_status: tool({
    description: `Get the status of a Nango sync.

    USE CASES:
    - Check if sync completed successfully
    - Monitor sync progress
    - Debug sync failures

    RETURNS: Status (RUNNING/PAUSED/STOPPED/ERROR), last sync date`,
    parameters: z.object({
      providerConfigKey: z.string().describe('Nango provider config key'),
      syncName: z.string().describe('Name of the sync'),
      connectionId: z.string().optional().describe('Connection ID (defaults to user ID from context)'),
    }),
    execute: async ({ providerConfigKey, syncName, connectionId }, ctx: any) => {
      const service = getNangoService();
      if (!service) return { success: false as const, error: 'Nango service not configured' };
      const userId = connectionId || ctx?.userId || 'default';
      const status = await service.getSyncStatus(userId, providerConfigKey, syncName);
      return { success: status.status !== 'ERROR', status: status.status, lastSyncDate: status.lastSyncDate };
    },
  } as any),

  nango_list_syncs: tool({
    description: `List all syncs for a provider connection.

    USE CASES:
    - Discover available syncs
    - Get sync names for triggering
    - View sync schedules

    RETURNS: Array of syncs with name, status, last/next sync dates`,
    parameters: z.object({
      providerConfigKey: z.string().describe('Nango provider config key'),
      connectionId: z.string().optional().describe('Connection ID (defaults to user ID from context)'),
    }),
    execute: async ({ providerConfigKey, connectionId }, ctx: any) => {
      const service = getNangoService();
      if (!service) return { success: false as const, error: 'Nango service not configured', syncs: [] };
      const userId = connectionId || ctx?.userId || 'default';
      const syncs = await service.listSyncs(providerConfigKey, userId);
      return { success: true as const, syncs };
    },
  } as any),

  nango_get_records: tool({
    description: `Get synced records from Nango's cache.

    USE CASES:
    - Query synced data without calling external API
    - Get cached records from previous syncs
    - Access CRM contacts, issues, files

    REQUIRES: Provider config key and model name`,
    parameters: z.object({
      providerConfigKey: z.string().describe('Nango provider config key'),
      syncName: z.string().describe('Sync/model name to query records from'),
      model: z.string().optional().describe('Specific model name (defaults to syncName)'),
      connectionId: z.string().optional().describe('Connection ID'),
    }),
    execute: async ({ providerConfigKey, syncName, model, connectionId }, ctx: any) => {
      const service = getNangoService();
      if (!service) return { success: false as const, error: 'Nango service not configured', records: [] };
      const userId = connectionId || ctx?.userId || 'default';
      const records = await service.getRecords(userId, providerConfigKey, syncName, model);
      return { success: true as const, records, count: records.length };
    },
  } as any),
};

// ─── Nango Action Tools (write operations with OAuth) ─────────────────────
export const nangoActionToolWrappers = {
  nango_execute_action: tool({
    description: `Execute a Nango action (write operation with OAuth).

    USE CASES:
    - Create records in external APIs
    - Send messages, create issues
    - Perform write operations with OAuth

    REQUIRES: Provider config key, action name, and input parameters`,
    parameters: z.object({
      providerConfigKey: z.string().describe('Nango provider config key'),
      actionName: z.string().describe('Name of the action to execute'),
      input: z.object({}).passthrough().describe('Action input parameters'),
      connectionId: z.string().optional().describe('Connection ID'),
    }),
    execute: async ({ providerConfigKey, actionName, input, connectionId }, ctx: any) => {
      const service = getNangoService();
      if (!service) return { success: false as const, error: 'Nango service not configured' };
      const userId = connectionId || ctx?.userId || 'default';
      const result = await service.executeAction(userId, providerConfigKey, actionName, input);
      return result.success
        ? { success: true as const, data: result.data }
        : { success: false as const, error: result.error };
    },
  } as any),
};

// ─── Combined Export ──────────────────────────────────────────────────────
export const nangoTools = {
  ...nangoGitHubTools,
  ...nangoSlackTools,
  ...nangoNotionTools,
  ...nangoWebhookTools,
  ...nangoSyncToolWrappers,
  ...nangoActionToolWrappers,
};

export type NangoToolName = keyof typeof nangoTools;



