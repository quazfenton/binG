/**
 * E2B MCP Gateway Integration
 * 
 * Connects E2B sandboxes to 200+ Docker MCP tools from the Docker MCP Catalog.
 * Provides seamless MCP tool integration for AI agents running in E2B sandboxes.
 * 
 * @see https://e2b.dev/docs/mcp E2B MCP Docs
 * @see https://hub.docker.com/mcp Docker MCP Catalog
 */

import type { SandboxHandle } from '../sandbox/providers/sandbox-provider';

/**
 * MCP Tool configuration
 */
export interface MCPToolConfig {
  /**
   * Tool name/identifier
   */
  name: string;
  
  /**
   * Tool-specific configuration
   * Varies by tool (e.g., API keys, project IDs)
   */
  config?: Record<string, any>;
}

/**
 * MCP Gateway configuration
 */
export interface MCPGatewayConfig {
  /**
   * MCP tools to enable
   */
  tools: Record<string, MCPToolConfig>;
  
  /**
   * Gateway URL (auto-generated if not provided)
   */
  gatewayUrl?: string;
  
  /**
   * Access token (auto-generated if not provided)
   */
  accessToken?: string;
}

/**
 * MCP Gateway result
 */
export interface MCPGatewayResult {
  /**
   * Gateway URL for MCP clients to connect
   */
  url: string;
  
  /**
   * Access token for authentication
   */
  token: string;
  
  /**
   * Enabled tools
   */
  tools: string[];
  
  /**
   * Connection string for Claude MCP
   */
  claudeConnection: string;
}

/**
 * E2B MCP Gateway Manager
 * 
 * Manages MCP gateway setup and configuration for E2B sandboxes.
 * Provides access to 200+ pre-built Docker MCP tools.
 * 
 * @example
 * ```typescript
 * const mcpManager = new E2BMCPGatewayManager(sandbox);
 * 
 * // Configure MCP tools
 * const result = await mcpManager.configureGateway({
 *   tools: {
 *     browserbase: {
 *       apiKey: process.env.BROWSERBASE_API_KEY,
 *       projectId: process.env.BROWSERBASE_PROJECT_ID,
 *     },
 *     fetch: {},
 *     filesystem: {
 *       readOnly: false,
 *     },
 *   },
 * });
 * 
 * // Add MCP tools to Claude
 * await sandbox.commands.run(
 *   `claude mcp add --transport http e2b-mcp-gateway ${result.url} --header "Authorization: Bearer ${result.token}"`
 * );
 * ```
 */
export class E2BMCPGatewayManager {
  private sandbox: SandboxHandle;
  private configuredTools: Map<string, MCPToolConfig> = new Map();
  private gatewayResult: MCPGatewayResult | null = null;

  constructor(sandbox: SandboxHandle) {
    this.sandbox = sandbox;
  }

  /**
   * Configure MCP gateway with tools
   * 
   * @param config - Gateway configuration
   * @returns Gateway connection details
   */
  async configureGateway(config: MCPGatewayConfig): Promise<MCPGatewayResult> {
    // Store configured tools
    for (const [name, toolConfig] of Object.entries(config.tools)) {
      this.configuredTools.set(name, toolConfig);
    }

    // Generate gateway URL and token
    // In production, this would call E2B's MCP gateway API
    const gatewayUrl = config.gatewayUrl || await this.createGatewayUrl();
    const accessToken = config.accessToken || await this.generateAccessToken();

    // Build Claude connection string
    const claudeConnection = `claude mcp add --transport http e2b-mcp-gateway ${gatewayUrl} --header "Authorization: Bearer ${accessToken}"`;

    this.gatewayResult = {
      url: gatewayUrl,
      token: accessToken,
      tools: Array.from(this.configuredTools.keys()),
      claudeConnection,
    };

    return this.gatewayResult;
  }

  /**
   * Create gateway URL
   */
  private async createGatewayUrl(): Promise<string> {
    // In production, this would call E2B's MCP gateway API
    // For now, generate a placeholder URL
    const sandboxId = this.sandbox.id;
    return `https://mcp-${sandboxId}.e2b.app`;
  }

  /**
   * Generate access token
   */
  private async generateAccessToken(): Promise<string> {
    // In production, this would call E2B's MCP gateway API
    // For now, generate a random token
    const crypto = await import('crypto');
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Add MCP tools to Claude
   * 
   * @param options - Claude configuration options
   */
  async addToClaude(options?: {
    /**
     * MCP server name
     * @default 'e2b-mcp-gateway'
     */
    name?: string;
    
    /**
     * Transport type
     * @default 'http'
     */
    transport?: 'http' | 'stdio';
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!this.gatewayResult) {
      return {
        success: false,
        error: 'Gateway not configured. Call configureGateway() first.',
      };
    }

    const name = options?.name || 'e2b-mcp-gateway';
    const transport = options?.transport || 'http';

    try {
      const result = await this.sandbox.executeCommand(
        `claude mcp add --transport ${transport} ${name} ${this.gatewayResult.url} --header "Authorization: Bearer ${this.gatewayResult.token}"`
      );

      if (result.success) {
        return {
          success: true,
          message: `MCP gateway '${name}' added to Claude successfully`,
        };
      } else {
        return {
          success: false,
          error: result.output || 'Failed to add MCP gateway to Claude',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to add MCP gateway to Claude',
      };
    }
  }

  /**
   * Add MCP tools to Codex
   * 
   * @param options - Codex configuration options
   */
  async addToCodex(options?: {
    /**
     * MCP server name
     * @default 'e2b-mcp-gateway'
     */
    name?: string;
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!this.gatewayResult) {
      return {
        success: false,
        error: 'Gateway not configured. Call configureGateway() first.',
      };
    }

    const name = options?.name || 'e2b-mcp-gateway';

    try {
      const result = await this.sandbox.executeCommand(
        `codex mcp add ${name} ${this.gatewayResult.url} --header "Authorization: Bearer ${this.gatewayResult.token}"`
      );

      if (result.success) {
        return {
          success: true,
          message: `MCP gateway '${name}' added to Codex successfully`,
        };
      } else {
        return {
          success: false,
          error: result.output || 'Failed to add MCP gateway to Codex',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to add MCP gateway to Codex',
      };
    }
  }

  /**
   * Get gateway status
   */
  getStatus(): {
    configured: boolean;
    tools: string[];
    url?: string;
    token?: string;
  } {
    return {
      configured: !!this.gatewayResult,
      tools: Array.from(this.configuredTools.keys()),
      url: this.gatewayResult?.url,
      token: this.gatewayResult?.token,
    };
  }

  /**
   * Get gateway result
   */
  getResult(): MCPGatewayResult | null {
    return this.gatewayResult;
  }

  /**
   * Clear gateway configuration
   */
  clear(): void {
    this.configuredTools.clear();
    this.gatewayResult = null;
  }
}

/**
 * Pre-configured MCP tools from Docker MCP Catalog
 */
export const PRECONFIGURED_MCP_TOOLS: Record<string, {
  description: string;
  config?: Record<string, any>;
  envVars?: string[];
}> = {
  // Browser & Web Automation
  browserbase: {
    description: 'Browser automation for web scraping and testing',
    config: {
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
    },
    envVars: ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID'],
  },
  
  // File Operations
  filesystem: {
    description: 'Local filesystem access',
    config: {
      readOnly: false,
    },
  },
  
  fetch: {
    description: 'HTTP requests and web scraping',
  },
  
  // Database
  postgres: {
    description: 'PostgreSQL database access',
    config: {
      connectionString: process.env.DATABASE_URL,
    },
    envVars: ['DATABASE_URL'],
  },
  
  mongodb: {
    description: 'MongoDB database access',
    config: {
      connectionString: process.env.MONGODB_URL,
    },
    envVars: ['MONGODB_URL'],
  },
  
  // Search & Information
  brave: {
    description: 'Brave Search API',
    config: {
      apiKey: process.env.BRAVE_API_KEY,
    },
    envVars: ['BRAVE_API_KEY'],
  },
  
  tavily: {
    description: 'Tavily AI search',
    config: {
      apiKey: process.env.TAVILY_API_KEY,
    },
    envVars: ['TAVILY_API_KEY'],
  },
  
  // Communication
  slack: {
    description: 'Slack messaging',
    config: {
      botToken: process.env.SLACK_BOT_TOKEN,
    },
    envVars: ['SLACK_BOT_TOKEN'],
  },
  
  gmail: {
    description: 'Gmail access',
    config: {
      credentials: process.env.GMAIL_CREDENTIALS,
    },
    envVars: ['GMAIL_CREDENTIALS'],
  },
  
  // Development
  github: {
    description: 'GitHub API access',
    config: {
      token: process.env.GITHUB_TOKEN,
    },
    envVars: ['GITHUB_TOKEN'],
  },
  
  gitlab: {
    description: 'GitLab API access',
    config: {
      token: process.env.GITLAB_TOKEN,
    },
    envVars: ['GITLAB_TOKEN'],
  },
  
  // Cloud Services
  vercel: {
    description: 'Vercel deployment',
    config: {
      token: process.env.VERCEL_TOKEN,
    },
    envVars: ['VERCEL_TOKEN'],
  },
  
  aws: {
    description: 'AWS services',
    config: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION,
    },
    envVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
  },
  
  // AI Services
  openai: {
    description: 'OpenAI API access',
    config: {
      apiKey: process.env.OPENAI_API_KEY,
    },
    envVars: ['OPENAI_API_KEY'],
  },
  
  anthropic: {
    description: 'Anthropic API access',
    config: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    envVars: ['ANTHROPIC_API_KEY'],
  },
};

/**
 * Create MCP gateway manager for sandbox
 * 
 * @param sandbox - Sandbox handle
 * @returns MCP gateway manager
 */
export function createMCPGatewayManager(sandbox: SandboxHandle): E2BMCPGatewayManager {
  return new E2BMCPGatewayManager(sandbox);
}

/**
 * Quick setup MCP gateway with pre-configured tools
 * 
 * @param sandbox - Sandbox handle
 * @param toolNames - Names of tools to enable
 * @returns Gateway result
 */
export async function quickSetupMCP(
  sandbox: SandboxHandle,
  toolNames: string[]
): Promise<MCPGatewayResult> {
  const manager = createMCPGatewayManager(sandbox);
  
  const tools: Record<string, MCPToolConfig> = {};
  for (const toolName of toolNames) {
    const toolConfig = PRECONFIGURED_MCP_TOOLS[toolName];
    if (toolConfig) {
      tools[toolName] = {
        name: toolName,
        config: toolConfig.config,
      };
    }
  }
  
  return await manager.configureGateway({ tools });
}
