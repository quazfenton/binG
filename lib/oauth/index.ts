/**
 * OAuth Integration Module
 * 
 * Unified API for OAuth connections across Arcade, Nango, and Composio.
 * 
 * Features:
 * - Initiate OAuth connections
 * - List user connections
 * - Revoke connections
 * - Execute tools with authorization checking
 * 
 * @example
 * ```typescript
 * import { oauthIntegration } from '@/lib/oauth';
 * 
 * // Initiate connection
 * const result = await oauthIntegration.connect('gmail', 'user_123');
 * if (result.success) {
 *   window.location.href = result.authUrl;
 * }
 * 
 * // List connections
 * const connections = await oauthIntegration.listConnections('user_123');
 * 
 * // Execute tool
 * const toolResult = await oauthIntegration.execute('gmail', 'send_email', {
 *   to: 'user@example.com',
 *   subject: 'Hello',
 *   body: 'Test email',
 * }, 'user_123', 'conversation_456');
 * ```
 */

// Import services for internal use
import { oauthService } from '../auth/oauth-service';
import { toolAuthManager, type OAuthInitiateResult, type OAuthListResult, type OAuthRevokeResult, type OAuthExecuteResult } from '../tools/tool-authorization-manager';
import { toolContextManager, type OAuthCapabilityResult } from '../tools/tool-context-manager';

// Re-export types and services for convenience
export type {
  OAuthConnection,
  OAuthSession,
} from '../auth/oauth-service';
export { oauthService, OAuthService } from '../auth/oauth-service';

export type {
  ToolAuthorizationContext,
  OAuthConnectionResult,
  OAuthInitiateResult,
  OAuthListResult,
  OAuthRevokeResult,
  OAuthExecuteResult,
} from '../tools/tool-authorization-manager';
export { toolAuthManager, ToolAuthorizationManager } from '../tools/tool-authorization-manager';

export type {
  ToolDetectionResult,
  ToolProcessingResult,
  OAuthCapabilityResult,
} from '../tools/tool-context-manager';
export { toolContextManager, ToolContextManager } from '../tools/tool-context-manager';

// Centralized provider mapping (single source of truth for Arcade/Nango/Composio/Auth0)
export {
  TOOL_PROVIDER_MAP,
  NO_AUTH_TOOLS,
  ARCADE_PLATFORMS,
  NANGO_PLATFORMS,
  getToolServiceForPlatform,
  getAuth0ConnectionForPlatform,
  getOAuthPlatformForTool,
  toolsShareAuth,
  getAuthorizationUrlForPlatform,
} from './provider-map';

/**
 * OAuth Integration Class
 * 
 * Unified API for all OAuth operations.
 */
export class OAuthIntegration {
  /**
   * Initiate OAuth connection for a provider
   * 
   * @param provider - Provider name (e.g., 'gmail', 'github', 'slack')
   * @param userId - User identifier
   * @returns Authorization URL for user consent
   */
  async connect(provider: string, userId: string): Promise<OAuthInitiateResult> {
    return toolAuthManager.initiateConnection(userId, provider);
  }

  /**
   * List all OAuth connections for a user
   * 
   * @param userId - User identifier
   * @param provider - Optional provider filter
   * @returns List of active connections
   */
  async listConnections(userId: string, provider?: string): Promise<OAuthListResult> {
    return toolAuthManager.listConnections(userId, provider);
  }

  /**
   * Revoke OAuth connection for a provider
   * 
   * @param provider - Provider name to revoke
   * @param userId - User identifier
   * @param connectionId - Optional specific connection ID to revoke
   * @returns Revocation result
   */
  async revoke(provider: string, userId: string, connectionId?: string): Promise<OAuthRevokeResult> {
    return toolAuthManager.revokeConnection(userId, provider, connectionId);
  }

  /**
   * Execute a tool via integration provider
   * 
   * @param provider - Provider name
   * @param action - Tool/action name (e.g., 'send_email', 'create_issue')
   * @param params - Tool parameters
   * @param userId - User identifier
   * @param conversationId - Optional conversation ID for context
   * @returns Execution result
   */
  async execute(
    provider: string,
    action: string,
    params: any,
    userId: string,
    conversationId?: string
  ): Promise<OAuthExecuteResult> {
    // Check authorization first
    const toolName = `${provider}.${action}`;
    const isAuthorized = await toolAuthManager.isAuthorized(userId, toolName);

    if (!isAuthorized) {
      const authUrl = toolAuthManager.getAuthorizationUrl(provider);
      return {
        success: false,
        requiresAuth: true,
        authUrl,
        error: `Authorization required for ${provider}.${action}`,
      };
    }

    // For actual tool execution, delegate to toolContextManager
    // This provides full tool execution with error handling
    if (conversationId) {
      const result = await toolContextManager.processOAuthCapability(
        'integration.execute',
        { provider, action, params },
        userId,
        conversationId
      );
      
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          requiresAuth: (result as any).requiresAuth,
          authUrl: (result as any).authUrl,
        };
      }

      return {
        success: true,
        output: result.output,
      };
    }

    // Fallback to direct execution
    return toolAuthManager.executeTool(provider, action, params, userId);
  }

  /**
   * Get authorization URL for a provider
   * 
   * @param provider - Provider name
   * @returns Authorization URL
   */
  getAuthUrl(provider: string): string {
    return toolAuthManager.getAuthorizationUrl(provider);
  }

  /**
   * Check if user is authorized for a tool
   * 
   * @param userId - User identifier
   * @param toolName - Tool name (e.g., 'gmail.send_email')
   * @returns True if authorized
   */
  async isAuthorized(userId: string, toolName: string): Promise<boolean> {
    return toolAuthManager.isAuthorized(userId, toolName);
  }

  /**
   * Get available tools for a user based on their connections
   * 
   * @param userId - User identifier
   * @returns List of available tool names
   */
  async getAvailableTools(userId: string): Promise<string[]> {
    return toolAuthManager.getAvailableTools(userId);
  }

  /**
   * Get connected providers for a user
   * 
   * @param userId - User identifier
   * @returns List of connected provider names
   */
  async getConnectedProviders(userId: string): Promise<string[]> {
    return toolAuthManager.getConnectedProviders(userId);
  }
}

/**
 * Singleton OAuth integration instance
 */
export const oauthIntegration = new OAuthIntegration();

/**
 * Convenience function: Connect to a provider
 */
export async function connectOAuth(provider: string, userId: string): Promise<OAuthInitiateResult> {
  return oauthIntegration.connect(provider, userId);
}

/**
 * Convenience function: List connections
 */
export async function listOAuthConnections(userId: string, provider?: string): Promise<OAuthListResult> {
  return oauthIntegration.listConnections(userId, provider);
}

/**
 * Convenience function: Revoke connection
 */
export async function revokeOAuthConnection(provider: string, userId: string, connectionId?: string): Promise<OAuthRevokeResult> {
  return oauthIntegration.revoke(provider, userId, connectionId);
}

/**
 * Convenience function: Execute tool
 */
export async function executeOAuthTool(
  provider: string,
  action: string,
  params: any,
  userId: string,
  conversationId?: string
): Promise<OAuthExecuteResult> {
  return oauthIntegration.execute(provider, action, params, userId, conversationId);
}
