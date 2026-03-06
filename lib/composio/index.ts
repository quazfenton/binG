/**
 * Composio Module
 * 
 * Provides Composio integration for tool access and management.
 * 
 * NOTE: Several modules moved to deprecated/lib/composio/ on 2026-03-01.
 * Active Composio integration uses lib/api/composio-service.ts
 */

export { composioAuthManager, ComposioAuthManager } from './composio-auth-manager';

export type AuthManagerConfig = {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
};
