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

// Sync Manager and Webhook Manager moved to deprecated/lib/nango/ on 2026-03-01
// Active Nango integration uses lib/api/nango-service.ts
