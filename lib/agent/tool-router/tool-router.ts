/**
 * Tool Router - Routes tool calls to appropriate handlers
 * 
 * Responsibilities:
 * - Route tool calls to MCP, Nullclaw, Sandbox, or Memory
 * - Provide unified interface for tool execution
 * - Handle tool result formatting
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Agent:ToolRouter');

export interface ToolRequest {
  tool: string;
  args: Record<string, any>;
  sessionId?: string;
  userId?: string;
}

export interface ToolResponse {
  success: boolean;
  output: string;
  exitCode: number;
  metadata?: Record<string, any>;
}

export type ToolHandler = (args: Record<string, any>) => Promise<ToolResponse>;

class ToolRouter {
  private handlers: Map<string, ToolHandler> = new Map();

  constructor() {
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers() {
    // MCP handlers are registered separately
  }

  /**
   * Register a tool handler
   */
  register(toolPrefix: string, handler: ToolHandler) {
    this.handlers.set(toolPrefix, handler);
    logger.info('Registered tool handler', { prefix: toolPrefix });
  }

  /**
   * Execute a tool by name
   */
  async execute(request: ToolRequest): Promise<ToolResponse> {
    const { tool, args } = request;
    const prefix = this.getToolPrefix(tool);

    const handler = this.handlers.get(prefix);
    
    if (!handler) {
      logger.warn('No handler found for tool', { tool, prefix });
      return {
        success: false,
        output: `Unknown tool: ${tool}`,
        exitCode: 1,
      };
    }

    try {
      logger.debug('Executing tool', { tool, args: Object.keys(args) });
      const result = await handler(args);
      return result;
    } catch (error: any) {
      logger.error('Tool execution failed', { tool, error: error.message });
      return {
        success: false,
        output: `Tool execution failed: ${error.message}`,
        exitCode: 1,
      };
    }
  }

  /**
   * Get tool prefix (e.g., "filesystem", "nullclaw", "memory")
   */
  private getToolPrefix(tool: string): string {
    const colonIndex = tool.indexOf(':');
    if (colonIndex > 0) {
      return tool.substring(0, colonIndex);
    }
    const underscoreIndex = tool.indexOf('_');
    if (underscoreIndex > 0) {
      return tool.substring(0, underscoreIndex);
    }
    return tool;
  }

  /**
   * List all registered tools
   */
  listTools(): string[] {
    return Array.from(this.handlers.keys());
  }
}

// Singleton instance
export const toolRouter = new ToolRouter();

/**
 * Helper to create MCP tool handler
 */
export function createMcpToolHandler(mcpServerUrl: string): ToolHandler {
  return async (args: Record<string, any>): Promise<ToolResponse> => {
    const response = await fetch(`${mcpServerUrl}/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      return {
        success: false,
        output: `MCP error: ${response.statusText}`,
        exitCode: 1,
      };
    }

    const result = await response.json();
    return {
      success: result.success ?? true,
      output: result.output ?? JSON.stringify(result),
      exitCode: result.success ? 0 : 1,
    };
  };
}

/**
 * Helper to create Nullclaw tool handler
 */
export function createNullclawToolHandler(nullclawUrl: string): ToolHandler {
  return async (args: Record<string, any>): Promise<ToolResponse> => {
    const response = await fetch(`${nullclawUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      return {
        success: false,
        output: `Nullclaw error: ${response.statusText}`,
        exitCode: 1,
      };
    }

    const result = await response.json();
    return {
      success: result.status === 'completed',
      output: result.result ?? JSON.stringify(result),
      exitCode: result.status === 'completed' ? 0 : 1,
    };
  };
}
