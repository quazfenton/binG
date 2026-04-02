/**
 * Zine Engine - Unbounded Display Automation System
 * 
 * Main export file
 */

import { ZineEngine, type ZineEngineProps } from "./index";
export { ZineEngine, type ZineEngineProps };
export { ZineAdminPanel, type ZineAdminConfig } from "./admin-panel";
export {
  fetchRSSFeed,
  createWebhookHandler,
  fetchFromOAuthPlatform,
  WebSocketDataSource,
  createDataSource,
  type OAuthPlatformConfig,
} from "./data-sources";

export type {
  DataSourceType,
  ContentType,
  LayoutStyle,
  AnimationStyle,
  ZineContent,
  ContentStyle,
  ContentPosition,
  DataSource,
  ZineTemplate,
} from "./index";

// Default templates
export { DEFAULT_TEMPLATES } from "./index";
