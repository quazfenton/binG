/**
 * Tambo Service - AI-Powered React Component Rendering
 *
 * Provides integration with Tambo Cloud for generative UI components.
 * Supports both generative components and interactable components.
 *
 * Features:
 * - Thread management for conversations
 * - Component rendering based on user intent
 * - Streaming prop updates
 * - MCP integration for external data
 * - User authentication support
 *
 * @see https://tambo.ai/docs
 * @see https://github.com/tambo-ai/tambo
 */

import { z } from 'zod';

export interface TamboConfig {
  apiKey: string;
  baseUrl?: string;
  userId?: string;
  userToken?: string; // For authenticated users
  timeout?: number;
}

export interface TamboComponent {
  name: string;
  description: string;
  propsSchema: z.ZodSchema;
  component: React.ComponentType<any>;
  type?: 'generative' | 'interactable';
}

export interface TamboTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  execute: (args: any) => Promise<any>;
}

export interface TamboMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: string; text?: string; data?: any }>;
  renderedComponent?: any;
  timestamp: number;
}

export interface TamboThread {
  id: string;
  userId: string;
  messages: TamboMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface TamboExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  component?: string;
  props?: any;
  requiresAuth?: boolean;
  authUrl?: string;
}

/**
 * Tambo Service Class
 * 
 * Manages Tambo Cloud integration for generative UI
 */
export class TamboService {
  private config: TamboConfig;
  private threads = new Map<string, TamboThread>();
  private components = new Map<string, TamboComponent>();
  private tools = new Map<string, TamboTool>();
  private client: any = null;
  private initialized = false;

  constructor(config: TamboConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Initialize Tambo client
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Dynamic import for Tambo SDK
      const { Tambo } = await import('@tambo-ai/core');
      
      this.client = new Tambo({
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });

      this.initialized = true;
      console.log('[TamboService] Initialized successfully');
    } catch (error: any) {
      console.error('[TamboService] Failed to initialize:', error.message);
      throw new Error(`Tambo SDK not available. Install with: pnpm add @tambo-ai/core. Error: ${error.message}`);
    }
  }

  /**
   * Create a new thread for user
   */
  async createThread(userId: string): Promise<TamboThread> {
    await this.initialize();

    const thread: TamboThread = {
      id: `thread_${userId}_${Date.now()}`,
      userId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.threads.set(thread.id, thread);

    // Create Tambo session if client available
    if (this.client) {
      try {
        const session = await this.client.createSession({
          userId,
          userToken: this.config.userToken,
        });
        console.log(`[TamboService] Created session for user ${userId}`);
      } catch (error: any) {
        console.error('[TamboService] Failed to create session:', error.message);
      }
    }

    return thread;
  }

  /**
   * Get thread by ID
   */
  getThread(threadId: string): TamboThread | undefined {
    return this.threads.get(threadId);
  }

  /**
   * Send message to Tambo
   */
  async sendMessage(
    threadId: string,
    content: string
  ): Promise<{ response: string; component?: any; props?: any }> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    // Add user message
    const userMessage: TamboMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    thread.messages.push(userMessage);

    try {
      // Use Tambo client if available
      if (this.client) {
        const response = await this.client.sendMessage({
          threadId,
          message: content,
          components: Array.from(this.components.values()).map(c => ({
            name: c.name,
            description: c.description,
            propsSchema: c.propsSchema,
          })),
        });

        // Add assistant response
        const assistantMessage: TamboMessage = {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: response.text,
          renderedComponent: response.component,
          timestamp: Date.now(),
        };
        thread.messages.push(assistantMessage);
        thread.updatedAt = Date.now();

        return {
          response: response.text,
          component: response.component?.name,
          props: response.component?.props,
        };
      }

      // Fallback: Simple response without Tambo Cloud
      const fallbackResponse = {
        response: `Message received: ${content}`,
        component: undefined,
        props: undefined,
      };

      const assistantMessage: TamboMessage = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: fallbackResponse.response,
        timestamp: Date.now(),
      };
      thread.messages.push(assistantMessage);
      thread.updatedAt = Date.now();

      return fallbackResponse;
    } catch (error: any) {
      console.error('[TamboService] sendMessage failed:', error.message);
      throw error;
    }
  }

  /**
   * Register a component with Tambo
   */
  registerComponent(component: TamboComponent): void {
    this.components.set(component.name, component);
    console.log(`[TamboService] Registered component: ${component.name}`);
  }

  /**
   * Register a tool with Tambo
   */
  registerTool(tool: TamboTool): void {
    this.tools.set(tool.name, tool);
    console.log(`[TamboService] Registered tool: ${tool.name}`);
  }

  /**
   * Execute a Tambo tool
   */
  async executeTool(
    userId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<TamboExecutionResult> {
    await this.initialize();

    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool ${toolName} not found`,
      };
    }

    try {
      // Validate arguments
      const validatedArgs = tool.inputSchema.parse(args);

      // Execute tool
      const output = await tool.execute(validatedArgs);

      return {
        success: true,
        output,
      };
    } catch (error: any) {
      console.error('[TamboService] executeTool failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get available tools for user
   */
  getAvailableTools(): TamboTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get available components
   */
  getAvailableComponents(): TamboComponent[] {
    return Array.from(this.components.values());
  }

  /**
   * Search tools by query
   */
  searchTools(query: string): TamboTool[] {
    const queryLower = query.toLowerCase();
    return Array.from(this.tools.values()).filter(
      tool =>
        tool.name.toLowerCase().includes(queryLower) ||
        tool.description.toLowerCase().includes(queryLower)
    );
  }

  /**
   * Get thread history
   */
  getThreadHistory(threadId: string): TamboMessage[] {
    const thread = this.threads.get(threadId);
    return thread ? thread.messages : [];
  }

  /**
   * Clear thread history
   */
  clearThread(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.messages = [];
      thread.updatedAt = Date.now();
    }
  }

  /**
   * Delete thread
   */
  deleteThread(threadId: string): void {
    this.threads.delete(threadId);
  }

  /**
   * Get service status
   */
  getStatus(): {
    initialized: boolean;
    threadsCount: number;
    componentsCount: number;
    toolsCount: number;
  } {
    return {
      initialized: this.initialized,
      threadsCount: this.threads.size,
      componentsCount: this.components.size,
      toolsCount: this.tools.size,
    };
  }
}

/**
 * Create Tambo service instance
 */
export function createTamboService(config: TamboConfig): TamboService {
  return new TamboService(config);
}

/**
 * Singleton instance
 */
let tamboServiceInstance: TamboService | null = null;

/**
 * Get or create Tambo service instance
 */
export function getTamboService(): TamboService | null {
  if (!tamboServiceInstance) {
    const apiKey = process.env.TAMBO_API_KEY;
    if (!apiKey) {
      return null;
    }

    tamboServiceInstance = createTamboService({
      apiKey,
      baseUrl: process.env.TAMBO_BASE_URL,
      userId: process.env.TAMBO_DEFAULT_USER_ID,
    });
  }
  return tamboServiceInstance;
}

/**
 * Initialize Tambo service
 */
export function initializeTamboService(config?: Partial<TamboConfig>): TamboService | null {
  if (tamboServiceInstance) {
    return tamboServiceInstance;
  }

  const apiKey = config?.apiKey || process.env.TAMBO_API_KEY;
  if (!apiKey) {
    return null;
  }

  tamboServiceInstance = createTamboService({
    apiKey,
    ...config,
  });

  return tamboServiceInstance;
}
