/**
 * CrewAI MCP Server
 *
 * Model Context Protocol server for exposing crew tools.
 * Enables remote tool execution and interop with MCP clients.
 *
 * @see https://docs.crewai.com/en/concepts/tools.md
 */

import { EventEmitter } from 'node:events';
import { z } from 'zod';
import type { Crew } from '../crew/crew';
import type { CrewOutput } from '../crew/crew';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  handler: (params: unknown) => Promise<unknown>;
}

export interface MCPServerConfig {
  name: string;
  version: string;
  description?: string;
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPEvent {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export class MCPServer extends EventEmitter {
  private tools: Map<string, MCPTool> = new Map();
  private crews: Map<string, Crew> = new Map();
  private config: MCPServerConfig;
  private requestHandlers: Map<string, (params?: unknown) => Promise<unknown>> = new Map();

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
    this.registerDefaultHandlers();
  }

  /**
   * Register a CrewAI crew as an MCP tool
   */
  registerCrew(name: string, crew: Crew, description?: string): void {
    this.crews.set(name, crew);
    
    // Register crew kickoff as MCP tool
    this.registerTool({
      name: `${name}_kickoff`,
      description: description || `Execute the ${name} crew`,
      inputSchema: z.object({ 
        input: z.string().describe('Input for the crew'),
        config: z.object({
          maxRPM: z.number().optional(),
          verbose: z.boolean().optional(),
        }).optional(),
      }),
      handler: async (params: any) => {
        try {
          const result: any = await crew.kickoff(params.input);
          this.emit('crew:completed', { name, result });
          return {
            success: true,
            result: result.raw || result,
            json: result.json || JSON.stringify(result),
            pydantic: result.pydantic,
          };
        } catch (error) {
          this.emit('crew:error', { name, error });
          throw error;
        }
      },
    });
    
    this.emit('crew:registered', { name });
  }

  /**
   * Register a custom tool
   */
  registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
    this.emit('tool:registered', { name: tool.name });
    
    // Emit list changed event
    this.emit('notification', {
      method: 'notifications/tools/list_changed',
    });
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): void {
    this.tools.delete(name);
    this.emit('tool:unregistered', { name });
    
    this.emit('notification', {
      method: 'notifications/tools/list_changed',
    });
  }

  /**
   * Get a registered tool
   */
  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tools
   */
  listTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Call a tool
   */
  async callTool(name: string, params: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    this.emit('tool:call:start', { name, params });
    
    try {
      const result = await tool.handler(params);
      this.emit('tool:call:complete', { name, result });
      return result;
    } catch (error) {
      this.emit('tool:call:error', { name, error });
      throw error;
    }
  }

  private registerDefaultHandlers(): void {
    // Initialize handler
    this.requestHandlers.set('initialize', async (params) => {
      return {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          prompts: { listChanged: true },
        },
        serverInfo: {
          name: this.config.name,
          version: this.config.version,
        },
      };
    });

    // Tools list handler
    this.requestHandlers.set('tools/list', async () => {
      return {
        tools: Array.from(this.tools.values()).map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: this.zodToJSONSchema(tool.inputSchema),
        })),
      };
    });

    // Tools call handler
    this.requestHandlers.set('tools/call', async (params: any) => {
      const { name, arguments: args } = params;
      
      try {
        const result = await this.callTool(name, args);
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        throw {
          code: -32603,
          message: error instanceof Error ? error.message : 'Tool call failed',
        };
      }
    });

    // Resources list handler
    this.requestHandlers.set('resources/list', async () => {
      return {
        resources: Array.from(this.crews.entries()).map(([name, crew]) => ({
          uri: `crew://${name}`,
          name: `Crew: ${name}`,
          description: `CrewAI crew: ${name}`,
          mimeType: 'application/json',
        })),
      };
    });

    // Resources read handler
    this.requestHandlers.set('resources/read', async (params: any) => {
      const { uri } = params;
      
      if (uri.startsWith('crew://')) {
        const crewName = uri.replace('crew://', '');
        const crew = this.crews.get(crewName);
        
        if (!crew) {
          throw new Error(`Crew not found: ${crewName}`);
        }
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ name: crewName, status: 'active' }),
            },
          ],
        };
      }
      
      throw new Error(`Unsupported resource URI: ${uri}`);
    });
  }

  /**
   * Handle an MCP request
   */
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const handler = this.requestHandlers.get(request.method);
    
    if (!handler) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      };
    }

    try {
      const result = await handler(request.params);
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
          data: error instanceof Error ? { stack: error.stack } : undefined,
        },
      };
    }
  }

  /**
   * Emit an MCP event/notification
   */
  emitEvent(event: MCPEvent): void {
    this.emit('mcp:event', event);
  }

  /**
   * Convert Zod schema to JSON Schema
   */
  private zodToJSONSchema(schema: z.ZodSchema): Record<string, unknown> {
    const jsonSchema: any = { type: 'object', properties: {}, required: [] };
    
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      
      for (const [key, value] of Object.entries(shape)) {
        if (value instanceof z.ZodString) {
          jsonSchema.properties[key] = { type: 'string' };
          jsonSchema.required.push(key);
        } else if (value instanceof z.ZodNumber) {
          jsonSchema.properties[key] = { type: 'number' };
          jsonSchema.required.push(key);
        } else if (value instanceof z.ZodBoolean) {
          jsonSchema.properties[key] = { type: 'boolean' };
          jsonSchema.required.push(key);
        } else if (value instanceof z.ZodOptional) {
          const inner = value.unwrap();
          if (inner instanceof z.ZodString) {
            jsonSchema.properties[key] = { type: 'string' };
          } else if (inner instanceof z.ZodNumber) {
            jsonSchema.properties[key] = { type: 'number' };
          } else if (inner instanceof z.ZodBoolean) {
            jsonSchema.properties[key] = { type: 'boolean' };
          }
        } else if (value instanceof z.ZodEnum) {
          jsonSchema.properties[key] = { 
            type: 'string', 
            enum: value.options 
          };
          jsonSchema.required.push(key);
        }
      }
    }
    
    return jsonSchema;
  }
}
