/**
 * Nango Integration Index
 *
 * Central export for all Nango integrations:
 * - Proxy API calls (existing)
 * - Sync Manager (NEW)
 * - Webhook Manager (NEW)
 */

export { nangoTools, nangoGitHubTools, nangoSlackTools, nangoNotionTools } from './nango-tools';
export { nangoConnectionManager } from '../stateful-agent/tools/nango-connection';
export { nangoRateLimiter } from '../stateful-agent/tools/nango-rate-limit';

// NEW: Sync Manager
export {
  triggerSync,
  getSyncStatus,
  getSyncRecords,
  listSyncs,
  startContinuousSync,
  getSyncHistory,
  handleSyncRequest,
  type SyncConfig,
  type SyncStatus,
} from './nango-sync-manager';

// NEW: Webhook Manager
export {
  subscribeToWebhooks,
  unsubscribeFromWebhooks,
  verifyWebhookSignature,
  processWebhook,
  listWebhookSubscriptions,
  createWebhookHandler,
  handleWebhookRequest,
  type WebhookSubscription,
  type WebhookEvent,
} from './nango-webhook-manager';
