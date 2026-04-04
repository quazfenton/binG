import type { z } from 'zod';

export type IntegrationProvider = 'arcade' | 'nango' | 'composio' | 'tambo' | 'mcp' | 'smithery' | 'builtin';

export interface ToolConfig {
  provider: IntegrationProvider;
  toolName: string;
  description: string;
  category: string;
  requiresAuth: boolean;
  inputSchema?: z.ZodSchema;
  outputSchema?: z.ZodSchema;
}

export interface ToolExecutionContext {
  userId: string;
  conversationId?: string;
  metadata?: Record<string, any>;
}

export interface ToolExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  authRequired?: boolean;
  authUrl?: string;
  provider?: IntegrationProvider;
  fallbackChain?: IntegrationProvider[];
}

export interface IntegrationConfig {
  arcade?: {
    apiKey: string;
    baseUrl?: string;
  };
  nango?: {
    apiKey: string;
    host?: string;
    connectionId?: string;
  };
  composio?: {
    apiKey: string;
    baseUrl?: string;
    defaultToolkits?: string[];
    manageConnections?: boolean;
  };
  mcp?: {
    gatewayUrl?: string;
    authToken?: string;
    timeoutMs?: number;
  };
  tambo?: {
    enabled?: boolean;
  };
  smithery?: {
    apiKey: string;
  };
}

export interface ProviderExecutionRequest {
  toolKey: string;
  config: ToolConfig;
  input: any;
  context: ToolExecutionContext;
}

export interface ToolProvider {
  readonly name: IntegrationProvider;
  isAvailable(): boolean;
  supports(request: ProviderExecutionRequest): boolean;
  execute(request: ProviderExecutionRequest): Promise<ToolExecutionResult>;
}
