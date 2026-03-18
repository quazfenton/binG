// ============================================================================
// Tool Integration Module Re-exports
// ============================================================================

export {
  ToolIntegrationManager,
  TOOL_REGISTRY,
  parseIntentToTool,
  formatToolOutput,
  type ToolConfig,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type IntegrationConfig,
} from './tool-integration-system';

export { ToolUtilities, createToolUtilities } from './tool-utilities';

// ============================================================================
// Tool Registry (Auto-Registration)
// ============================================================================

export {
  ToolRegistry,
  getToolRegistry,
  type RegisteredTool,
} from './registry';

// ============================================================================
// Bootstrap (Auto-Registration System)
// ============================================================================

export {
  bootstrapToolSystem,
  quickBootstrap,
  getToolsSummary,
  registerTool,
  registerTools,
  unregisterTool,
  clearAllTools,
  type BootstrapConfig,
  type BootstrapResult,
} from './bootstrap';

// Gateway bootstrap
export {
  registerGatewayTools,
  unregisterGatewayTools,
} from './bootstrap-gateway';

// ============================================================================
// Unified Registry (Backwards Compatibility)
// ============================================================================
// Note: UnifiedToolRegistry has been consolidated into ToolIntegrationManager
// Use getToolManager() for the singleton instance

// Re-export for backwards compatibility (getToolManager is defined locally below)
export {
  type ToolInfo,
  UnifiedToolRegistry,
  getUnifiedToolRegistry,
  initializeUnifiedToolRegistry,
  type UnifiedToolRegistryConfig,
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

// ============================================================================
// Service Exports
// ============================================================================

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
} from '../platforms/arcade-service';

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
} from '../platforms/nango-service';

// Smithery provider
export {
  SmitheryProvider,
  createSmitheryProvider,
  type SmitheryConfig,
  type SmitheryServerConfig,
  type SmitheryTool,
  DEFAULT_SMITHERY_SERVERS,
} from './tool-integration/providers/smithery';

// ============================================================================
// Singleton Tool Manager
// ============================================================================

import { ToolIntegrationManager } from './tool-integration-system';

let _toolManager: ToolIntegrationManager | null = null;

/**
 * Get or create the singleton ToolIntegrationManager instance.
 * This is the recommended entry point for tool operations.
 * 
 * The ToolIntegrationManager consolidates:
 * - ToolProviderRegistry (provider management)
 * - ToolProviderRouter (fallback execution)
 * - TOOL_REGISTRY (tool definitions)
 * - Tool discovery and search
 */
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

// ============================================================================
// NEW: Capability Layer (Recommended for new code)
// ============================================================================

// Capability definitions - semantic tool capabilities
export {
  // Capability definitions
  ALL_CAPABILITIES,
  CAPABILITY_BY_ID,
  CAPABILITIES_BY_CATEGORY,
  getCapability,
  getCapabilitiesByCategory,
  searchCapabilities,
  type CapabilityDefinition,
  type CapabilityCategory,
  // File capabilities
  FILE_READ_CAPABILITY,
  FILE_WRITE_CAPABILITY,
  FILE_DELETE_CAPABILITY,
  FILE_LIST_CAPABILITY,
  FILE_SEARCH_CAPABILITY,
  // Sandbox capabilities
  SANDBOX_EXECUTE_CAPABILITY,
  SANDBOX_SHELL_CAPABILITY,
  SANDBOX_SESSION_CAPABILITY,
  // Web capabilities
  WEB_BROWSE_CAPABILITY,
  WEB_SEARCH_CAPABILITY,
  // Repo capabilities
  REPO_SEARCH_CAPABILITY,
  REPO_GIT_CAPABILITY,
  REPO_CLONE_CAPABILITY,
  REPO_COMMIT_CAPABILITY,
  REPO_PUSH_CAPABILITY,
  REPO_PULL_CAPABILITY,
  REPO_SEMANTIC_SEARCH_CAPABILITY,
  REPO_ANALYZE_CAPABILITY,
  // Memory capabilities
  MEMORY_STORE_CAPABILITY,
  MEMORY_RETRIEVE_CAPABILITY,
  PROJECT_BUNDLE_CAPABILITY,
  WORKSPACE_GET_CHANGES_CAPABILITY,
  // Automation capabilities
  AUTOMATION_DISCORD_CAPABILITY,
  AUTOMATION_TELEGRAM_CAPABILITY,
  AUTOMATION_WORKFLOW_CAPABILITY,
  // OAuth Integration capabilities (Nango/Composio/Arcade)
  INTEGRATION_CONNECT_CAPABILITY,
  INTEGRATION_EXECUTE_CAPABILITY,
  INTEGRATION_LIST_CONNECTIONS_CAPABILITY,
  INTEGRATION_REVOKE_CAPABILITY,
  INTEGRATION_SEARCH_TOOLS_CAPABILITY,
  INTEGRATION_PROXY_CAPABILITY,
} from './capabilities';

// Capability router - maps capabilities to providers
export {
  getCapabilityRouter,
  initializeCapabilityRouter,
  executeCapability,
  executeCapabilityByName,
  type CapabilityProvider,
} from './router';

// ============================================================================
// Composio Integration
// ============================================================================

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
} from '../platforms/composio-service';
