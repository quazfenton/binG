import Arcade from '@arcadeai/arcadejs';
import { Nango } from '@nangohq/node';
import { Composio } from '@composio/core';

import { authService } from '@/lib/auth/auth-service';

import type {
  IntegrationConfig,
  ProviderExecutionRequest,
  ToolExecutionResult,
  ToolProvider,
} from '../types';
import { tamboLocalTools } from './tambo-local-tools';

function buildProviderAuthUrl(provider: string): string {
  const appBase = process.env.NEXT_PUBLIC_APP_URL || '';
  const normalized = provider.toLowerCase();
  const arcadeProviders = ['google', 'gmail', 'googledocs', 'googlesheets', 'googlecalendar', 'googledrive', 'googlemaps', 'exa', 'twilio', 'spotify', 'vercel', 'railway'];
  const nangoProviders = ['github', 'slack', 'discord', 'twitter', 'reddit'];

  if (arcadeProviders.includes(normalized)) {
    return `${appBase}/api/auth/arcade/authorize?provider=${encodeURIComponent(normalized)}&redirect=1`;
  }
  if (nangoProviders.includes(normalized)) {
    return `${appBase}/api/auth/nango/authorize?provider=${encodeURIComponent(normalized)}&redirect=1`;
  }

  return `${appBase}/api/auth/oauth/initiate?provider=${encodeURIComponent(normalized)}`;
}

async function resolveArcadeUserId(userId: string): Promise<string> {
  const strategy = (process.env.ARCADE_USER_ID_STRATEGY || 'email').toLowerCase();
  if (strategy !== 'email') {
    return userId;
  }

  const numericUserId = Number(userId);
  if (Number.isNaN(numericUserId)) {
    return userId;
  }

  const user = await authService.getUserById(numericUserId);
  return user?.email || userId;
}

function extractNangoAction(toolName: string): { integrationId: string; actionName: string } {
  const raw = String(toolName || '');
  const parts = raw.split(/[-_.:]/).filter(Boolean);
  const integrationId = parts[0] || raw;

  if (raw.includes(':')) {
    const [integration, action] = raw.split(':', 2);
    return { integrationId: integration, actionName: action };
  }

  if (raw.startsWith(`${integrationId}-`)) {
    return { integrationId, actionName: raw.slice(integrationId.length + 1) };
  }

  return { integrationId, actionName: raw };
}

export class ArcadeToolProvider implements ToolProvider {
  readonly name = 'arcade' as const;
  private readonly client: Arcade | null;

  constructor(private readonly config: IntegrationConfig) {
    this.client = config.arcade?.apiKey
      ? new Arcade({
          apiKey: config.arcade.apiKey,
          ...(config.arcade.baseUrl ? { baseURL: config.arcade.baseUrl } : {}),
        })
      : null;
  }

  isAvailable(): boolean {
    return !!this.client;
  }

  supports(request: ProviderExecutionRequest): boolean {
    return request.config.provider === 'arcade';
  }

  async execute(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    if (!this.client) {
      return { success: false, error: 'Arcade client not initialized', provider: this.name };
    }

    try {
      const userId = await resolveArcadeUserId(request.context.userId);
      if (request.config.requiresAuth) {
        const authResponse = await this.client.tools.authorize({
          tool_name: request.config.toolName,
          user_id: userId,
        });

        if (authResponse.status !== 'completed') {
          return {
            success: false,
            authRequired: true,
            authUrl: authResponse.url,
            error: `Authorization required for ${request.config.toolName}`,
            provider: this.name,
          };
        }
      }

      const response = await this.client.tools.execute({
        tool_name: request.config.toolName,
        user_id: userId,
        input: request.input,
      });

      if (response.success === false && response.output?.error) {
        return {
          success: false,
          error: response.output.error.message,
          provider: this.name,
        };
      }

      return {
        success: true,
        output: response.output?.value,
        provider: this.name,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Arcade tool execution failed',
        provider: this.name,
      };
    }
  }
}

export class NangoToolProvider implements ToolProvider {
  readonly name = 'nango' as const;
  private readonly client: Nango | null;

  constructor(private readonly config: IntegrationConfig) {
    this.client = config.nango?.apiKey
      ? new Nango({
          secretKey: config.nango.apiKey,
          ...(config.nango.host ? { host: config.nango.host } : {}),
        })
      : null;
  }

  isAvailable(): boolean {
    return !!this.client;
  }

  supports(request: ProviderExecutionRequest): boolean {
    return request.config.provider === 'nango';
  }

  async execute(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    if (!this.client) {
      return { success: false, error: 'Nango client not initialized', provider: this.name };
    }

    try {
      const connectionId = this.config.nango?.connectionId || request.context.userId;
      const { integrationId, actionName } = extractNangoAction(request.config.toolName);

      const output = await this.client.triggerAction(
        integrationId,
        connectionId,
        actionName,
        request.input,
      );

      return {
        success: true,
        output,
        provider: this.name,
      };
    } catch (error: any) {
      const message = String(error?.message || 'Nango tool execution failed');
      const authRequired = /unauthorized|forbidden|auth|connect/i.test(message);

      return {
        success: false,
        error: message,
        authRequired,
        authUrl: authRequired ? buildProviderAuthUrl(extractNangoAction(request.config.toolName).integrationId) : undefined,
        provider: this.name,
      };
    }
  }
}

export class ComposioToolProvider implements ToolProvider {
  readonly name = 'composio' as const;
  private readonly client: Composio | null;

  constructor(private readonly config: IntegrationConfig) {
    this.client = config.composio?.apiKey
      ? new Composio({
          apiKey: config.composio.apiKey,
          ...(config.composio.baseUrl ? { baseURL: config.composio.baseUrl } : {}),
        } as any)
      : null;
  }

  isAvailable(): boolean {
    return !!this.client;
  }

  supports(request: ProviderExecutionRequest): boolean {
    return request.config.provider === 'composio';
  }

  private getToolkitsFromRequest(request: ProviderExecutionRequest): string[] | undefined {
    if (Array.isArray(request.input?.toolkits) && request.input.toolkits.length > 0) {
      return request.input.toolkits.map((toolkit: any) => String(toolkit).trim()).filter(Boolean);
    }
    return this.config.composio?.defaultToolkits;
  }

  private async createSessionIfSupported(request: ProviderExecutionRequest): Promise<any | null> {
    if (!this.client || typeof (this.client as any).create !== 'function') {
      return null;
    }

    const toolkits = this.getToolkitsFromRequest(request);
    const sessionConfig =
      toolkits?.length || this.config.composio?.manageConnections
        ? {
            ...(toolkits?.length ? { toolkits } : {}),
            ...(this.config.composio?.manageConnections ? { manageConnections: true } : {}),
          }
        : undefined;

    try {
      return await (this.client as any).create(request.context.userId, sessionConfig);
    } catch (error) {
      console.warn('[ComposioToolProvider] Failed to create tool-router session, falling back to low-level API:', error);
      return null;
    }
  }

  async execute(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    if (!this.client) {
      return { success: false, error: 'Composio client not initialized', provider: this.name };
    }

    try {
      // Handle different types of Composio requests
      if (request.toolKey === 'composio.search_tools') {
        return await this.handleSearchTools(request);
      } else if (request.toolKey === 'composio.execute_tool') {
        return await this.handleExecuteTool(request);
      } else if (request.toolKey === 'composio.agentic_loop') {
        return await this.handleAgenticLoop(request);
      } else if (request.toolKey === 'composio.mcp_config') {
        return await this.handleMcpConfig(request);
      }

      // Default to tool execution
      return await this.handleExecuteTool(request);
    } catch (error: any) {
      const message = String(error?.message || 'Composio tool execution failed');
      const authRequired = /auth|required|connect/i.test(message);
      return {
        success: false,
        error: message,
        authRequired,
        authUrl: authRequired ? buildProviderAuthUrl('google') : undefined,
        provider: this.name,
      };
    }
  }

  /**
   * Handle tool search requests
   */
  private async handleSearchTools(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    const searchQuery = String(request.input?.search || '').trim().toLowerCase();
    const limit = Number(request.input?.limit || 20);
    const session = await this.createSessionIfSupported(request);
    
    let tools: any = null;

    if (session && typeof session.tools === 'function') {
      tools = await session.tools();
    } else {
      tools = await (this.client as any).tools.get(request.context.userId, {
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(this.getToolkitsFromRequest(request)?.length
          ? { toolkits: this.getToolkitsFromRequest(request) }
          : {}),
        limit,
      });
    }

    const normalized = Array.isArray(tools?.items) ? tools.items : Array.isArray(tools) ? tools : [];
    const filtered = searchQuery
      ? normalized.filter((tool: any) => {
          const haystack = `${tool?.slug || ''} ${tool?.name || ''} ${tool?.description || ''}`.toLowerCase();
          return haystack.includes(searchQuery);
        })
      : normalized;

    return {
      success: true,
      output: filtered.slice(0, Number.isFinite(limit) ? limit : 20),
      provider: this.name,
    };
  }

  /**
   * Handle individual tool execution
   */
  private async handleExecuteTool(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    const toolSlug = String(request.input?.toolSlug || request.config.toolName || '').trim();
    const session = await this.createSessionIfSupported(request);
    
    const args = request.input?.arguments || request.input || {};
    const result = await (this.client as any).tools.execute(toolSlug, {
      userId: request.context.userId,
      arguments: args,
      dangerouslySkipVersionCheck: true,
    });

    const authRequired = result?.successful === false && /auth|required|connect/i.test(JSON.stringify(result));
    return {
      success: !authRequired,
      output: {
        ...result,
        ...(session?.mcp?.url
          ? {
              mcp: {
                url: session.mcp.url,
                headers: session.mcp.headers,
              },
            }
          : {}),
      },
      error: authRequired ? 'Authorization required for Composio tool' : undefined,
      authRequired,
      authUrl: authRequired ? buildProviderAuthUrl(String(toolSlug).split('_')[0].toLowerCase()) : undefined,
      provider: this.name,
    };
  }

  /**
   * Handle agentic loop with multiple tool calls
   */
  private async handleAgenticLoop(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    const { task, model, maxIterations = 10 } = request.input || {};
    if (!task) {
      return {
        success: false,
        error: 'Task is required for agentic loop',
        provider: this.name,
      };
    }

    try {
      // This would integrate with AI provider to run the full agentic loop
      // For now, we'll simulate the functionality
      const session = await this.createSessionIfSupported(request);
      const tools = await session.tools();
      
      // In a full implementation, this would:
      // 1. Initialize an AI agent with the tools
      // 2. Run the agent with the given task
      // 3. Handle the complete loop including tool execution and result processing
      
      return {
        success: true,
        output: {
          task,
          toolsUsed: tools.slice(0, 5), // Return first 5 tools as example
          status: 'agentic_loop_initiated',
          mcpConfig: session?.mcp ? {
            url: session.mcp.url,
            headers: session.mcp.headers,
          } : undefined,
        },
        provider: this.name,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Agentic loop failed: ${error.message}`,
        provider: this.name,
      };
    }
  }

  /**
   * Handle MCP configuration requests
   */
  private async handleMcpConfig(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    try {
      const session = await this.createSessionIfSupported(request);
      
      if (!session?.mcp) {
        return {
          success: false,
          error: 'MCP configuration not available for this session',
          provider: this.name,
        };
      }

      return {
        success: true,
        output: {
          mcp: {
            url: session.mcp.url,
            headers: session.mcp.headers,
          },
        },
        provider: this.name,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `MCP config retrieval failed: ${error.message}`,
        provider: this.name,
      };
    }
  }
}

export class TamboToolProvider implements ToolProvider {
  readonly name = 'tambo' as const;

  constructor(private readonly config: IntegrationConfig) {}

  isAvailable(): boolean {
    return this.config.tambo?.enabled !== false;
  }

  supports(request: ProviderExecutionRequest): boolean {
    return request.config.provider === 'tambo';
  }

  async execute(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    const name = request.config.toolName;
    const tool = (tamboLocalTools as Record<string, (args: any) => Promise<any>>)[name];

    if (!tool) {
      return {
        success: false,
        error: `Unknown Tambo tool: ${name}`,
        provider: this.name,
      };
    }

    try {
      const output = await tool(request.input || {});
      return {
        success: true,
        output,
        provider: this.name,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Tambo tool execution failed',
        provider: this.name,
      };
    }
  }
}

export class MCPGatewayToolProvider implements ToolProvider {
  readonly name = 'mcp' as const;

  constructor(private readonly config: IntegrationConfig) {}

  isAvailable(): boolean {
    return process.env.MCP_GATEWAY_ENABLED === 'true' && !!(this.config.mcp?.gatewayUrl || process.env.MCP_GATEWAY_URL);
  }

  supports(request: ProviderExecutionRequest): boolean {
    return request.config.provider === 'mcp';
  }

  async execute(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    const gatewayUrl = this.config.mcp?.gatewayUrl || process.env.MCP_GATEWAY_URL;
    if (!gatewayUrl) {
      return { success: false, error: 'MCP gateway URL not configured', provider: this.name };
    }

    try {
      const toolName = request.input?.toolName || request.config.toolName;
      const argumentsPayload = request.input?.arguments || request.input || {};

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      const token = this.config.mcp?.authToken || process.env.MCP_GATEWAY_AUTH_TOKEN;
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `mcp-${Date.now()}`,
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: argumentsPayload,
          },
        }),
        signal: AbortSignal.timeout(this.config.mcp?.timeoutMs || Number(process.env.MCP_GATEWAY_TIMEOUT_MS || 15000)),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.error) {
        return {
          success: false,
          error: payload?.error?.message || `MCP gateway error (${response.status})`,
          provider: this.name,
        };
      }

      return {
        success: true,
        output: payload?.result,
        provider: this.name,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'MCP execution failed',
        provider: this.name,
      };
    }
  }
}

export function createDefaultProviders(config: IntegrationConfig): ToolProvider[] {
  return [
    new ArcadeToolProvider(config),
    new NangoToolProvider(config),
    new ComposioToolProvider(config),
    new TamboToolProvider(config),
    new MCPGatewayToolProvider(config),
  ];
}
