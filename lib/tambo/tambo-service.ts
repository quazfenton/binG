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
  component: any;
  type?: 'generative' | 'interactable';
  interactableId?: string;
}

export interface TamboContextHelper {
  name: string;
  fn: () => any;
}

export interface TamboContextAttachment {
  context: any;
  displayName: string;
  type: string;
}

// ... (existing message/thread interfaces)

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

export interface TamboTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  execute: (args: any) => Promise<any>;
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

export class TamboService {
  private config: TamboConfig;
  private threads = new Map<string, TamboThread>();
  private components = new Map<string, TamboComponent>();
  private tools = new Map<string, TamboTool>();
  private contextHelpers = new Map<string, TamboContextHelper>();
  private contextAttachments = new Map<string, TamboContextAttachment[]>();
  private client: any = null;
  private initialized = false;

  constructor(config: TamboConfig) {
    this.config = config;
  }

  /**
   * Initialize Tambo client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const { TamboAI } = await import('@tambo-ai/typescript-sdk');
      this.client = new TamboAI({
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });
      this.initialized = true;
    } catch (error: any) {
      console.error('[TamboService] Failed to initialize:', error.message);
      throw new Error(`Tambo SDK not available. Error: ${error.message}`);
    }
  }

  /**
   * Add a context attachment for the next message
   */
  addContextAttachment(userId: string, attachment: TamboContextAttachment): void {
    if (!this.contextAttachments.has(userId)) {
      this.contextAttachments.set(userId, []);
    }
    this.contextAttachments.get(userId)!.push(attachment);
  }

  /**
   * Register a context helper function
   */
  registerContextHelper(helper: TamboContextHelper): void {
    this.contextHelpers.set(helper.name, helper);
  }

  /**
   * Send message to Tambo with full context
   */
  async sendMessage(
    threadId: string,
    content: string
  ): Promise<{ response: string; component?: any; props?: any }> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    // 1. Gather all context
    const helpersContext: Record<string, any> = {};
    for (const helper of this.contextHelpers.values()) {
      helpersContext[helper.name] = helper.fn();
    }

    const userAttachments = this.contextAttachments.get(thread.userId) || [];
    this.contextAttachments.delete(thread.userId); // Clear after use

    const fullContext = {
      helpers: helpersContext,
      attachments: userAttachments,
    };

    // 2. Add user message
    const userMessage: TamboMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: [
        { type: 'text', text: content },
        { type: 'context', data: fullContext }
      ],
      timestamp: Date.now(),
    };
    thread.messages.push(userMessage);

    try {
      if (this.client) {
        const response = await this.client.sendMessage({
          threadId,
          message: content,
          context: fullContext,
          components: Array.from(this.components.values()).map(c => ({
            name: c.name,
            description: c.description,
            propsSchema: c.propsSchema,
            type: c.type || 'generative',
          })),
        });

        // ... (assistant response logic same as before)
      }
      // ... (fallback logic)
    } catch (error) { /* ... */ }
  }

  /**
   * Update props for an interactable component
   */
  async updateInteractableProps(
    threadId: string,
    interactableId: string,
    props: any
  ): Promise<void> {
    await this.initialize();
    if (this.client?.updateInteractable) {
      await this.client.updateInteractable({
        threadId,
        interactableId,
        props,
      });
    }
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
 * 
 * Note: Uses NEXT_PUBLIC_TAMBO_API_KEY because Tambo's SDK requires
 * client-side API key access. This is intentional per Tambo's design.
 * @see https://tambo.ai/docs
 */
export function getTamboService(): TamboService | null {
  if (!tamboServiceInstance) {
    const apiKey = process.env.NEXT_PUBLIC_TAMBO_API_KEY;
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

  const apiKey = config?.apiKey || process.env.NEXT_PUBLIC_TAMBO_API_KEY;
  if (!apiKey) {
    return null;
  }

  tamboServiceInstance = createTamboService({
    apiKey,
    ...config,
  });

  return tamboServiceInstance;
}
