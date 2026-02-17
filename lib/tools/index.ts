// Tool integration module re-exports
export { ToolIntegrationManager, TOOL_REGISTRY, parseIntentToTool, formatToolOutput } from './tool-integration-system';
export type { ToolConfig, ToolExecutionContext, ToolExecutionResult, IntegrationConfig } from './tool-integration-system';
export { ToolUtilities, createToolUtilities } from './tool-utilities';

import { ToolIntegrationManager } from './tool-integration-system';

let _toolManager: ToolIntegrationManager | null = null;

export function getToolManager(): ToolIntegrationManager {
  if (!_toolManager) {
    _toolManager = new ToolIntegrationManager({
      arcade: {
        apiKey: process.env.ARCADE_API_KEY || '',
      },
      nango: {
        apiKey: process.env.NANGO_API_KEY || '',
        host: process.env.NANGO_HOST || 'https://api.nango.dev',
      },
    });
  }
  return _toolManager;
}

// Composio is integrated through lib/api/composio-service.ts
// and is used via the priority-request-router.ts
// This provides access to 800+ toolkits with advanced authentication
export {
  initializeComposioService,
  getComposioService,
  isComposioAvailable,
  getOrCreateComposioServiceFromEnv,
  type ComposioServiceConfig,
  type ComposioToolRequest,
  type ComposioToolResponse,
} from '../api/composio-service';
