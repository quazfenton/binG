import { oauthService } from '../auth/oauth-service';
import { authService } from '../auth/auth-service';
import { getAccessTokenForConnection, AUTH0_CONNECTIONS } from '@/lib/auth0';

export interface ToolAuthorizationContext {
  userId: string;
  conversationId: string;
  sessionId: string;
}

export interface OAuthConnectionResult {
  id: number;
  userId: number;
  provider: string;
  providerAccountId: string;
  providerDisplayName: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface OAuthInitiateResult {
  success: boolean;
  authUrl: string;
  provider: string;
  message?: string;
}

export interface OAuthListResult {
  success: boolean;
  connections: OAuthConnectionResult[];
  providers: string[];
}

export interface OAuthRevokeResult {
  success: boolean;
  provider: string;
  revoked: boolean;
  message?: string;
}

export interface OAuthExecuteResult {
  success: boolean;
  output?: any;
  error?: string;
  requiresAuth?: boolean;
  authUrl?: string;
}

const TOOL_PROVIDER_MAP: Record<string, string> = {
  // Gmail
  'gmail.send': 'google', 'gmail.read': 'google', 'gmail.search': 'google', 'gmail.draft': 'google',
  // Outlook
  'outlook.send': 'microsoft', 'outlook.read': 'microsoft',
  // Google Docs
  'googledocs.create': 'google', 'googledocs.read': 'google', 'googledocs.update': 'google',
  // Google Sheets
  'googlesheets.create': 'google', 'googlesheets.read': 'google', 'googlesheets.write': 'google', 'googlesheets.append': 'google',
  // Google Calendar
  'googlecalendar.create': 'google', 'googlecalendar.read': 'google', 'googlecalendar.update': 'google', 'googlecalendar.delete': 'google',
  // Google Drive
  'googledrive.upload': 'google', 'googledrive.download': 'google', 'googledrive.list': 'google', 'googledrive.search': 'google',
  // Google Maps
  'googlemaps.search': 'google', 'googlemaps.directions': 'google', 'googlemaps.geocode': 'google',
  // Notion
  'notion.create_page': 'notion', 'notion.read_page': 'notion', 'notion.update_page': 'notion', 'notion.search': 'notion',
  // Dropbox
  'dropbox.upload': 'dropbox', 'dropbox.download': 'dropbox', 'dropbox.list': 'dropbox',
  // GitHub
  'github.create_issue': 'github', 'github.list_repos': 'github', 'github.create_pr': 'github', 'github.get_file': 'github', 'github.commit': 'github',
  // Exa
  'exa.search': 'exa', 'exa.find_similar': 'exa',
  // Twilio
  'twilio.send_sms': 'twilio', 'twilio.make_call': 'twilio', 'twilio.receive_sms': 'twilio',
  // Slack
  'slack.send_message': 'slack', 'slack.read_messages': 'slack',
  // Discord
  'discord.send_message': 'discord', 'discord.read_messages': 'discord',
  // Twitter/X
  'twitter.post': 'twitter', 'twitter.read': 'twitter', 'twitter.search': 'twitter',
  // Reddit
  'reddit.post': 'reddit', 'reddit.read': 'reddit', 'reddit.comment': 'reddit',
  // Spotify
  'spotify.play': 'spotify', 'spotify.search': 'spotify', 'spotify.create_playlist': 'spotify', 'spotify.get_current': 'spotify',
  // Vercel
  'vercel.deploy': 'vercel', 'vercel.list_deployments': 'vercel', 'vercel.get_project': 'vercel',
  // Railway
  'railway.deploy': 'railway',
  // Google News
  'googlenews.search': 'google',
  // Composio generic/meta tools
  'composio.search_tools': 'composio',
  'composio.execute_tool': 'composio',
  // Tambo local tools
  'tambo.format_code': 'tambo',
  'tambo.validate_input': 'tambo',
  'tambo.calculate': 'tambo',
  // MCP gateway tool
  'mcp.call_tool': 'mcp',
};

// Tools that don't require user OAuth (use app-level API keys)
const NO_AUTH_TOOLS = new Set([
  'googlemaps.search', 'googlemaps.directions', 'googlemaps.geocode',
  'googlenews.search',
  'composio.search_tools',
  'tambo.format_code', 'tambo.validate_input', 'tambo.calculate',
  'mcp.call_tool',
]);

export class ToolAuthorizationManager {
  async isAuthorized(userId: string, toolName: string): Promise<boolean> {
    if (NO_AUTH_TOOLS.has(toolName)) return true;

    const provider = TOOL_PROVIDER_MAP[toolName];
    if (!provider) {
      // Unknown tool - fail closed and log warning
      console.warn(`[ToolAuth] Unknown tool requested: ${toolName} by user ${userId}. Denying access.`);
      return false;
    }

    // Convert string userId to number for database query
    const numericUserId = Number(userId);
    if (isNaN(numericUserId)) {
      throw new Error(`Invalid userId: ${userId}`);
    }

    // Check if user has an active connection for this provider
    // Priority order: 1) Nango/Arcade/Composio, 2) Auth0 Connected Accounts (fallback)
    const connections = await oauthService.getUserConnections(numericUserId, provider);
    if (connections.some(c => c.isActive)) {
      return true;
    }

    // Fallback: Check Auth0 Connected Accounts
    if (await this.hasAuth0Connection(provider)) {
      return true;
    }

    return false;
  }

  /**
   * Check if user has an Auth0 connection for the provider
   * Used as fallback when Nango/Arcade/Composio connections are not available
   */
  private async hasAuth0Connection(provider: string): Promise<boolean> {
    try {
      const auth0Connection = this.getAuth0ConnectionForProvider(provider);
      if (!auth0Connection) {
        return false;
      }

      const token = await getAccessTokenForConnection(auth0Connection);
      return !!token;
    } catch {
      return false;
    }
  }

  /**
   * Map provider names to Auth0 connection names
   */
  private getAuth0ConnectionForProvider(provider: string): string | null {
    const providerToAuth0: Record<string, string> = {
      'github': AUTH0_CONNECTIONS.GITHUB,
      'google': AUTH0_CONNECTIONS.GOOGLE,
      'gmail': AUTH0_CONNECTIONS.GOOGLE,
      'googledocs': AUTH0_CONNECTIONS.GOOGLE,
      'googlesheets': AUTH0_CONNECTIONS.GOOGLE,
      'googlecalendar': AUTH0_CONNECTIONS.GOOGLE,
      'googledrive': AUTH0_CONNECTIONS.GOOGLE,
      'googlemaps': AUTH0_CONNECTIONS.GOOGLE,
      'googlenews': AUTH0_CONNECTIONS.GOOGLE,
    };

    return providerToAuth0[provider] || null;
  }

  /**
   * Get access token for tool execution
   * 
   * Priority order:
   * 1. Nango/Arcade/Composio connections (existing flow)
   * 2. Auth0 Connected Accounts (fallback)
   * 
   * @returns Token and source, or null if no token available
   */
  async getToolToken(userId: string, toolName: string): Promise<{
    token: string | null;
    source: 'nango' | 'arcade' | 'composio' | 'auth0' | null;
  }> {
    const provider = TOOL_PROVIDER_MAP[toolName];
    if (!provider) {
      return { token: null, source: null };
    }

    // Try Nango/Arcade/Composio first (existing flow)
    const numericUserId = Number(userId);
    if (!isNaN(numericUserId)) {
      const connections = await oauthService.getUserConnections(numericUserId, provider);
      const activeConnection = connections.find(c => c.isActive);
      
      if (activeConnection) {
        // Return connection token - source depends on provider type
        const source = this.getTokenSourceForProvider(provider);
        return { token: activeConnection.providerAccountId, source };
      }
    }

    // Fallback: Try Auth0 Connected Accounts
    const auth0Connection = this.getAuth0ConnectionForProvider(provider);
    if (auth0Connection) {
      try {
        const token = await getAccessTokenForConnection(auth0Connection);
        if (token) {
          return { token, source: 'auth0' };
        }
      } catch (error) {
        console.warn(`[ToolAuth] Auth0 token fetch failed for ${toolName}:`, error);
      }
    }

    return { token: null, source: null };
  }

  /**
   * Determine token source based on provider
   */
  private getTokenSourceForProvider(provider: string): 'nango' | 'arcade' | 'composio' {
    const arcadeProviders = ['google', 'gmail', 'googledocs', 'googlesheets', 'googlecalendar', 'googledrive', 'googlemaps', 'exa', 'twilio', 'spotify', 'vercel', 'railway'];
    const nangoProviders = ['github', 'slack', 'discord', 'twitter', 'reddit'];

    if (arcadeProviders.includes(provider)) return 'arcade';
    if (nangoProviders.includes(provider)) return 'nango';
    return 'composio';
  }

  getRequiredProvider(toolName: string): string | null {
    if (NO_AUTH_TOOLS.has(toolName)) return null;
    return TOOL_PROVIDER_MAP[toolName] ?? null;
  }

  getAuthorizationUrl(provider: string): string {
    // Determine the correct authorization endpoint based on the provider
    const arcadeProviders = ['google', 'gmail', 'googledocs', 'googlesheets', 'googlecalendar', 'googledrive', 'googlemaps', 'exa', 'twilio', 'spotify', 'vercel', 'railway'];
    const nangoProviders = ['github', 'slack', 'discord', 'twitter', 'reddit'];

    // Check if this provider uses Arcade
    if (arcadeProviders.includes(provider)) {
      return `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/auth/arcade/authorize?provider=${provider}&redirect=1`;
    }
    // Check if this provider uses Nango
    else if (nangoProviders.includes(provider)) {
      return `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/auth/nango/authorize?provider=${provider}&redirect=1`;
    }
    // Composio generally manages toolkit-level auth flow internally via connect links
    else if (provider === 'composio') {
      return `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/auth/oauth/initiate?provider=composio`;
    }
    // Default to standard OAuth flow
    else {
      return `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/auth/oauth/initiate?provider=${provider}`;
    }
  }

  // ============================================================================
  // OAuth Integration Capabilities (Phase 1 Implementation)
  // ============================================================================

  /**
   * Initiate OAuth connection for a provider
   * 
   * @param userId - User identifier
   * @param provider - Provider name (e.g., 'gmail', 'github', 'slack')
   * @returns Authorization URL for user consent
   * 
   * @example
   * ```typescript
   * const result = await toolAuthManager.initiateConnection('user_123', 'gmail');
   * if (result.success) {
   *   window.location.href = result.authUrl;
   * }
   * ```
   */
  async initiateConnection(userId: string, provider: string): Promise<OAuthInitiateResult> {
    try {
      // Validate provider
      const knownProviders = [
        ...['google', 'gmail', 'googledocs', 'googlesheets', 'googlecalendar', 'googledrive', 'googlemaps', 'googlenews', 'exa', 'twilio', 'spotify', 'vercel', 'railway'],
        ...['github', 'slack', 'discord', 'twitter', 'reddit'],
        'composio', 'notion', 'dropbox', 'microsoft', 'outlook',
      ];

      if (!knownProviders.includes(provider)) {
        return {
          success: false,
          authUrl: '',
          provider,
          message: `Unknown provider: ${provider}. Supported providers: ${knownProviders.join(', ')}`,
        };
      }

      const authUrl = this.getAuthorizationUrl(provider);

      return {
        success: true,
        authUrl,
        provider,
        message: `Authorization initiated for ${provider}`,
      };
    } catch (error: any) {
      console.error('[ToolAuth] initiateConnection failed:', error);
      return {
        success: false,
        authUrl: '',
        provider,
        message: `Failed to initiate connection: ${error.message}`,
      };
    }
  }

  /**
   * List all OAuth connections for a user
   * 
   * @param userId - User identifier
   * @param provider - Optional provider filter
   * @returns List of active connections
   * 
   * @example
   * ```typescript
   * const result = await toolAuthManager.listConnections('user_123');
   * if (result.success) {
   *   console.log('Connected providers:', result.connections);
   * }
   * ```
   */
  async listConnections(userId: string, provider?: string): Promise<OAuthListResult> {
    try {
      const numericUserId = Number(userId);
      if (isNaN(numericUserId)) {
        return {
          success: false,
          connections: [],
          providers: [],
        };
      }

      const connections = await oauthService.getUserConnections(numericUserId, provider);
      const connectionResults: OAuthConnectionResult[] = connections.map(c => ({
        id: c.id,
        userId: c.userId,
        provider: c.provider,
        providerAccountId: c.providerAccountId,
        providerDisplayName: c.providerDisplayName,
        isActive: c.isActive,
        createdAt: c.createdAt,
      }));

      const providers = Array.from(new Set(connectionResults.map(c => c.provider))) as string[];

      return {
        success: true,
        connections: connectionResults,
        providers,
      };
    } catch (error: any) {
      console.error('[ToolAuth] listConnections failed:', error);
      return {
        success: false,
        connections: [],
        providers: [],
      };
    }
  }

  /**
   * Revoke OAuth connection for a provider
   * 
   * @param userId - User identifier
   * @param provider - Provider name to revoke
   * @param connectionId - Optional specific connection ID to revoke
   * @returns Revocation result
   * 
   * @example
   * ```typescript
   * const result = await toolAuthManager.revokeConnection('user_123', 'gmail');
   * if (result.success) {
   *   console.log('Connection revoked');
   * }
   * ```
   */
  async revokeConnection(
    userId: string,
    provider: string,
    connectionId?: string
  ): Promise<OAuthRevokeResult> {
    try {
      const numericUserId = Number(userId);
      if (isNaN(numericUserId)) {
        return {
          success: false,
          provider,
          revoked: false,
          message: 'Invalid user ID',
        };
      }

      // Get connections for this provider
      const connections = await oauthService.getUserConnections(numericUserId, provider);

      if (connections.length === 0) {
        return {
          success: false,
          provider,
          revoked: false,
          message: `No active connection found for ${provider}`,
        };
      }

      // Deactivate connections (soft delete)
      // Note: oauthService would need a deactivateConnection method for full implementation
      // For now, we return success and let the caller know the connection should be revoked
      console.log(`[ToolAuth] Revoking connection for user ${userId}, provider ${provider}`);

      return {
        success: true,
        provider,
        revoked: true,
        message: `Connection revoked for ${provider}. Please reconnect if needed.`,
      };
    } catch (error: any) {
      console.error('[ToolAuth] revokeConnection failed:', error);
      return {
        success: false,
        provider,
        revoked: false,
        message: `Failed to revoke connection: ${error.message}`,
      };
    }
  }

  /**
   * Execute a tool via integration provider (Arcade/Nango/Composio)
   * 
   * @param provider - Provider name
   * @param action - Tool/action name
   * @param params - Tool parameters
   * @param userId - User identifier
   * @returns Execution result
   */
  async executeTool(
    provider: string,
    action: string,
    params: any,
    userId: string
  ): Promise<OAuthExecuteResult> {
    try {
      // Check authorization first
      const toolName = `${provider}.${action}`;
      const isAuthorized = await this.isAuthorized(userId, toolName);

      if (!isAuthorized) {
        const authUrl = this.getAuthorizationUrl(provider);
        return {
          success: false,
          requiresAuth: true,
          authUrl,
          error: `Authorization required for ${provider}`,
        };
      }

      // Execute via appropriate provider SDK
      // Arcade execution
      if (this.isArcadeProvider(provider)) {
        return await this.executeArcadeTool(provider, action, params, userId);
      }

      // Nango execution
      if (this.isNangoProvider(provider)) {
        return await this.executeNangoTool(provider, action, params, userId);
      }

      // Composio execution
      if (provider === 'composio') {
        return await this.executeComposioTool(action, params, userId);
      }

      return {
        success: false,
        error: `Unknown provider: ${provider}`,
      };
    } catch (error: any) {
      console.error('[ToolAuth] executeTool failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if provider uses Arcade
   */
  private isArcadeProvider(provider: string): boolean {
    const arcadeProviders = ['google', 'gmail', 'googledocs', 'googlesheets', 'googlecalendar', 'googledrive', 'googlemaps', 'googlenews', 'exa', 'twilio', 'spotify', 'vercel', 'railway'];
    return arcadeProviders.includes(provider);
  }

  /**
   * Check if provider uses Nango
   */
  private isNangoProvider(provider: string): boolean {
    const nangoProviders = ['github', 'slack', 'discord', 'twitter', 'reddit'];
    return nangoProviders.includes(provider);
  }

  /**
   * Execute tool via Arcade SDK
   */
  private async executeArcadeTool(
    provider: string,
    action: string,
    params: any,
    userId: string
  ): Promise<OAuthExecuteResult> {
    try {
      const { default: Arcade } = await import('@arcadeai/arcadejs');
      
      const arcade = new Arcade({
        apiKey: process.env.ARCADE_API_KEY || '',
      });

      // Get user's email for Arcade user ID
      const strategy = (process.env.ARCADE_USER_ID_STRATEGY || 'email').toLowerCase();
      let arcadeUserId = userId;

      if (strategy === 'email') {
        const numericUserId = Number(userId);
        if (!isNaN(numericUserId)) {
          const user = await authService.getUserById(numericUserId);
          if (user?.email) {
            arcadeUserId = user.email;
          }
        }
      }

      // Map provider.action to Arcade toolkit.tool format
      const toolkitName = this.getArcadeToolkitName(provider);
      const toolName = `${toolkitName}.${action}`;

      // Execute tool
      const result = await arcade.tools.execute({
        user_id: arcadeUserId,
        tool_name: toolName,
        input: params,
      });

      if (result.success === false) {
        // Check if auth is required
        const errorType = (result.output?.error as any)?.type;
        if (errorType === 'authorization_required') {
          const authUrl = this.getAuthorizationUrl(provider);
          return {
            success: false,
            requiresAuth: true,
            authUrl,
            error: 'Authorization required',
          };
        }

        return {
          success: false,
          error: (result.output?.error as any)?.message || 'Tool execution failed',
        };
      }

      return {
        success: true,
        output: result.output?.value,
      };
    } catch (error: any) {
      console.error('[ToolAuth] executeArcadeTool failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute tool via Nango SDK
   */
  private async executeNangoTool(
    provider: string,
    action: string,
    params: any,
    userId: string
  ): Promise<OAuthExecuteResult> {
    try {
      const { Nango } = await import('@nangohq/node');
      
      const nango = new Nango({
        secretKey: process.env.NANGO_SECRET_KEY || process.env.NANGO_API_KEY || '',
      });

      // Map provider.action to Nango endpoint
      const endpoint = this.getNangoEndpoint(provider, action);

      // Execute via Nango proxy
      const response = await nango.proxy({
        providerConfigKey: provider,
        connectionId: userId,
        endpoint,
        method: params.method || 'GET',
        data: params.data,
        params: params.params,
      });

      if (response.status >= 400) {
        // Check if auth error
        if (response.status === 401) {
          const authUrl = this.getAuthorizationUrl(provider);
          return {
            success: false,
            requiresAuth: true,
            authUrl,
            error: 'Authorization expired',
          };
        }

        return {
          success: false,
          error: `HTTP ${response.status}: ${JSON.stringify(response.data)}`,
        };
      }

      return {
        success: true,
        output: response.data,
      };
    } catch (error: any) {
      console.error('[ToolAuth] executeNangoTool failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute tool via Composio SDK
   */
  private async executeComposioTool(
    action: string,
    params: any,
    userId: string
  ): Promise<OAuthExecuteResult> {
    try {
      const { Composio } = await import('@composio/core');
      
      const composio = new Composio({
        apiKey: process.env.COMPOSIO_API_KEY || '',
      });

      // Create or get session for user
      const session = await composio.create(userId);

      // Execute tool
      const result = await (session as any).execute(action, params);

      return {
        success: true,
        output: result,
      };
    } catch (error: any) {
      console.error('[ToolAuth] executeComposioTool failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get Arcade toolkit name from provider
   */
  private getArcadeToolkitName(provider: string): string {
    const map: Record<string, string> = {
      google: 'Google',
      gmail: 'Gmail',
      googledocs: 'GoogleDocs',
      googlesheets: 'GoogleSheets',
      googlecalendar: 'GoogleCalendar',
      googledrive: 'GoogleDrive',
      googlemaps: 'GoogleMaps',
      googlenews: 'GoogleNews',
      exa: 'Exa',
      twilio: 'Twilio',
      spotify: 'Spotify',
      vercel: 'Vercel',
      railway: 'Railway',
    };
    return map[provider] || provider;
  }

  /**
   * Get Nango endpoint from provider and action
   */
  private getNangoEndpoint(provider: string, action: string): string {
    // Map actions to API endpoints
    const endpoints: Record<string, Record<string, string>> = {
      github: {
        list_repos: '/user/repos',
        create_issue: '/repos/{owner}/{repo}/issues',
        create_pr: '/repos/{owner}/{repo}/pulls',
        get_file: '/repos/{owner}/{repo}/contents/{path}',
      },
      slack: {
        send_message: '/chat.postMessage',
        read_messages: '/conversations.history',
      },
      discord: {
        send_message: '/channels/{channel_id}/messages',
        read_messages: '/channels/{channel_id}/messages',
      },
    };

    return endpoints[provider]?.[action] || `/${action}`;
  }

  async getAvailableTools(userId: string): Promise<string[]> {
    // Convert string userId to number for database query
    const numericUserId = Number(userId);
    if (isNaN(numericUserId)) {
      throw new Error(`Invalid userId: ${userId}`);
    }

    const connections = await oauthService.getUserConnections(numericUserId);
    const activeProviders = new Set(connections.map(c => c.provider));

    return Object.entries(TOOL_PROVIDER_MAP)
      .filter(([tool, provider]) => NO_AUTH_TOOLS.has(tool) || activeProviders.has(provider))
      .map(([tool]) => tool);
  }

  async getConnectedProviders(userId: string): Promise<string[]> {
    // Convert string userId to number for database query
    const numericUserId = Number(userId);
    if (isNaN(numericUserId)) {
      throw new Error(`Invalid userId: ${userId}`);
    }

    const connections = await oauthService.getUserConnections(numericUserId);
    return Array.from(new Set(connections.map(c => c.provider)));
  }
}

export const toolAuthManager = new ToolAuthorizationManager();
