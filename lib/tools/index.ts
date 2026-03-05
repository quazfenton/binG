// Tool integration module re-exports
export { ToolIntegrationManager, TOOL_REGISTRY, parseIntentToTool, formatToolOutput } from './tool-integration-system';
export type { ToolConfig, ToolExecutionContext, ToolExecutionResult, IntegrationConfig } from './tool-integration-system';
export { ToolUtilities, createToolUtilities } from './tool-utilities';

// New unified registry and services
export { 
  UnifiedToolRegistry, 
  getUnifiedToolRegistry, 
  initializeUnifiedToolRegistry,
  type UnifiedToolRegistryConfig,
  type ToolInfo,
} from './registry';

export { 
  ToolErrorHandler, 
  getToolErrorHandler,
  type ToolError,
  type ErrorCategory,
} from './error-handler';

export { 
  ToolDiscoveryService, 
  getToolDiscoveryService,
  initializeToolDiscoveryService,
  type DiscoveryOptions,
  type DiscoveredTool,
  type ToolUsageStats,
} from './discovery';

// Tambo service
export {
  TamboService,
  createTamboService,
  getTamboService,
  initializeTamboService,
  type TamboConfig,
  type TamboComponent,
  type TamboTool,
  type TamboMessage,
  type TamboThread,
  type TamboExecutionResult,
} from '../tambo/tambo-service';

// Arcade service
export {
  ArcadeService,
  createArcadeService,
  getArcadeService,
  initializeArcadeService,
  type ArcadeConfig,
  type ArcadeTool,
  type ArcadeConnection,
  type ArcadeExecutionResult,
} from '../api/arcade-service';

// Nango service
export {
  NangoService,
  createNangoService,
  getNangoService,
  initializeNangoService,
  type NangoConfig,
  type NangoConnection,
  type NangoProxyRequest,
  type NangoProxyResponse,
  type NangoExecutionResult,
} from '../api/nango-service';

// Smithery provider
export {
  SmitheryProvider,
  createSmitheryProvider,
  type SmitheryConfig,
  type SmitheryServerConfig,
  type SmitheryTool,
  DEFAULT_SMITHERY_SERVERS,
} from '../tool-integration/providers/smithery';

import { ToolIntegrationManager } from './tool-integration-system';

let _toolManager: ToolIntegrationManager | null = null;

export function getToolManager(): ToolIntegrationManager {
  if (!_toolManager) {
    const nangoKey = process.env.NANGO_SECRET_KEY || process.env.NANGO_API_KEY || '';
    const composioDefaultToolkits = (process.env.COMPOSIO_DEFAULT_TOOLKITS || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    _toolManager = new ToolIntegrationManager({
      arcade: {
        apiKey: process.env.ARCADE_API_KEY || '',
      },
      nango: {
        apiKey: nangoKey,
        host: process.env.NANGO_HOST || 'https://api.nango.dev',
      },
      composio: {
        apiKey: process.env.COMPOSIO_API_KEY || '',
        baseUrl: process.env.COMPOSIO_BASE_URL,
        defaultToolkits: composioDefaultToolkits.length > 0 ? composioDefaultToolkits : undefined,
        manageConnections: process.env.COMPOSIO_MANAGE_CONNECTIONS === 'true',
      },
      mcp: {
        gatewayUrl: process.env.MCP_GATEWAY_URL,
        authToken: process.env.MCP_GATEWAY_AUTH_TOKEN,
        timeoutMs: Number(process.env.MCP_GATEWAY_TIMEOUT_MS || 15000),
      },
      tambo: {
        enabled: process.env.NEXT_PUBLIC_TAMBO_ENABLED === 'true',
      },
      smithery: {
        apiKey: process.env.SMITHERY_API_KEY || '',
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
