/**
 * MCP Gateway Integration
 *
 * Registers tools from MCP gateway into ToolIntegrationManager.
 * Enables dynamic tool discovery and execution via gateway.
 *
 * Usage:
 * ```typescript
 * const gateway = new MCPGateway();
 * await gateway.registerGatewayTools('http://localhost:8080');
 * ```
 */

import { createLogger } from '../utils/logger';
import type { ToolIntegrationManager } from '../tools/tool-integration-system';

const logger = createLogger('MCP:Gateway');

export interface GatewayTool {
  name: string;
  description: string;
  capability?: string;
  inputSchema?: any;
  outputSchema?: any;
  metadata?: {
    latency?: 'low' | 'medium' | 'high';
    cost?: 'low' | 'medium' | 'high';
    reliability?: number;
  };
}

export class MCPGateway {
  private gatewayUrl: string;
  private registeredTools = new Set<string>();

  constructor(gatewayUrl: string) {
    this.gatewayUrl = gatewayUrl;
  }

  /**
   * Register all tools from MCP gateway
   */
  async registerGatewayTools(toolManager: ToolIntegrationManager): Promise<number> {
    let count = 0;

    try {
      // Fetch tools from gateway
      const response = await fetch(`${this.gatewayUrl}/tools`);
      if (!response.ok) {
        throw new Error(`Gateway returned ${response.status}`);
      }

      const gatewayTools: GatewayTool[] = await response.json();
      logger.info(`Fetched ${gatewayTools.length} tools from gateway`);

      // Register each tool
      for (const tool of gatewayTools) {
        const toolKey = `gateway:${tool.name}`;

        // Skip if already registered
        if (this.registeredTools.has(toolKey)) {
          continue;
        }

        await toolManager.registerTool(toolKey, {
          provider: 'gateway' as any,
          toolName: tool.name,
          description: tool.description,
          category: tool.capability || 'integration',
          requiresAuth: false,
          inputSchema: tool.inputSchema,
        });

        this.registeredTools.add(toolKey);
        logger.debug(`Registered gateway tool: ${toolKey}`);
        count++;
      }

      logger.info(`Registered ${count} tools from MCP gateway`);
    } catch (error: any) {
      logger.error('Failed to register gateway tools', { error: error.message, gatewayUrl: this.gatewayUrl });
    }

    return count;
  }

  /**
   * Execute tool via gateway
   */
  async executeTool(
    toolName: string,
    args: Record<string, any>,
    context: { userId: string; conversationId?: string }
  ): Promise<any> {
    try {
      const response = await fetch(`${this.gatewayUrl}/tools/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: toolName,
          args,
          context,
        }),
      });

      if (!response.ok) {
        throw new Error(`Gateway returned ${response.status}`);
      }

      const result = await response.json();
      return {
        success: result.success ?? true,
        output: result.output || result,
        error: result.error,
      };
    } catch (error: any) {
      logger.error('Gateway tool execution failed', { toolName, error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get list of registered tools
   */
  getRegisteredTools(): string[] {
    return Array.from(this.registeredTools);
  }

  /**
   * Clear registered tools (for testing)
   */
  clearRegisteredTools(): void {
    this.registeredTools.clear();
  }
}

/**
 * Create MCP gateway instance
 */
export function createMCPGateway(gatewayUrl: string): MCPGateway {
  return new MCPGateway(gatewayUrl);
}
