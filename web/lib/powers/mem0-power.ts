/**
 * Mem0 Persistent Memory Power
 * 
 * Provides persistent memory capabilities using the Mem0 Platform API.
 * Enables the agent to remember user preferences, conversation context,
 * and retrieve relevant memories across sessions.
 * 
 * Actions:
 * - add: Store memories from a conversation
 * - search: Retrieve relevant memories for a query
 * - get_all: Get all memories for a user
 * - update: Update an existing memory
 * - delete: Delete a specific memory
 * - delete_all: Delete all memories for a user
 */

import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('Powers:Mem0');

// ============================================================================
// Types
// ============================================================================

export interface Mem0Config {
  apiKey?: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
}

// Memory entry from Mem0
export interface Mem0Memory {
  id: string;
  memory: string;
  score?: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// Mem0 Client (simplified wrapper around mem0ai)
// ============================================================================

class Mem0Client {
  private apiKey: string;
  private baseUrl = 'https://api.mem0.ai';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Add memories from conversation messages
   */
  async add(
    messages: Array<{ role: string; content: string }>,
    options: { userId?: string; agentId?: string; sessionId?: string } = {}
  ): Promise<{ results?: Mem0Memory[]; message?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/memories/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${this.apiKey}`,
        },
        body: JSON.stringify({
          messages,
          user_id: options.userId,
          agent_id: options.agentId,
          run_id: options.sessionId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to add memories');
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 add failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Search memories for a query
   */
  async search(
    query: string,
    options: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      limit?: number;
      filters?: Record<string, any>;
    } = {}
  ): Promise<{ results?: Mem0Memory[] }> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/memories/search/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          user_id: options.userId,
          agent_id: options.agentId,
          run_id: options.sessionId,
          limit: options.limit || 10,
          filters: options.filters,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to search memories');
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 search failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Get all memories for a user/agent
   */
  async getAll(
    options: { userId?: string; agentId?: string; limit?: number } = {}
  ): Promise<{ results?: Mem0Memory[] }> {
    try {
      const params = new URLSearchParams();
      if (options.userId) params.append('user_id', options.userId);
      if (options.agentId) params.append('agent_id', options.agentId);
      if (options.limit) params.append('limit', String(options.limit));

      const response = await fetch(`${this.baseUrl}/v1/memories/?${params}`, {
        method: 'GET',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to get memories');
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 get_all failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Update a memory
   */
  async update(memoryId: string, text: string): Promise<{ message?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/memories/${memoryId}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${this.apiKey}`,
        },
        body: JSON.stringify({ memory: text }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to update memory');
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 update failed', { error: err.message, memoryId });
      throw err;
    }
  }

  /**
   * Delete a memory
   */
  async delete(memoryId: string): Promise<{ message?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/memories/${memoryId}/`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete memory');
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 delete failed', { error: err.message, memoryId });
      throw err;
    }
  }

  /**
   * Delete all memories for a user/agent
   */
  async deleteAll(options: { userId?: string; agentId?: string } = {}): Promise<{ message?: string }> {
    try {
      const params = new URLSearchParams();
      if (options.userId) params.append('user_id', options.userId);
      if (options.agentId) params.append('agent_id', options.agentId);

      const response = await fetch(`${this.baseUrl}/v1/memories/?${params}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete memories');
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 delete_all failed', { error: err.message });
      throw err;
    }
  }
}

// ============================================================================
// Client instance management
// ============================================================================

let mem0Client: Mem0Client | null = null;

/**
 * Check if mem0 is configured with API key
 */
export function isMem0Configured(): boolean {
  return !!process.env.MEM0_API_KEY && process.env.MEM0_API_KEY.length > 0;
}

/**
 * Initialize or get the Mem0 client
 */
export function getMem0Client(apiKey?: string): Mem0Client {
  const key = apiKey || process.env.MEM0_API_KEY;
  if (!key) {
    throw new Error('MEM0_API_KEY not configured. Please set MEM0_API_KEY environment variable.');
  }
  
  if (!mem0Client) {
    mem0Client = new Mem0Client(key);
  }
  return mem0Client;
}

/**
 * Reset the client (for testing or reconfiguration)
 */
export function resetMem0Client(): void {
  mem0Client = null;
}

// ============================================================================
// Power Actions
// ============================================================================

/**
 * Action: Add memories from conversation
 */
export async function mem0Add(
  args: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    userId?: string;
    agentId?: string;
    sessionId?: string;
  },
  config: Mem0Config = {}
): Promise<{ success: boolean; results?: Mem0Memory[]; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    const result = await client.add(args.messages, {
      userId: args.userId || config.userId,
      agentId: args.agentId || config.agentId,
      sessionId: args.sessionId || config.sessionId,
    });
    log.info('Mem0 memories added', { count: result.results?.length || 0 });
    return { success: true, results: result.results };
  } catch (err: any) {
    log.error('mem0_add failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Action: Search memories
 */
export async function mem0Search(
  args: {
    query: string;
    userId?: string;
    agentId?: string;
    sessionId?: string;
    limit?: number;
    filters?: Record<string, any>;
  },
  config: Mem0Config = {}
): Promise<{ success: boolean; results?: Mem0Memory[]; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    const result = await client.search(args.query, {
      userId: args.userId || config.userId,
      agentId: args.agentId || config.agentId,
      sessionId: args.sessionId || config.sessionId,
      limit: args.limit,
      filters: args.filters,
    });
    log.info('Mem0 search completed', { query: args.query, count: result.results?.length || 0 });
    return { success: true, results: result.results };
  } catch (err: any) {
    log.error('mem0_search failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Action: Get all memories
 */
export async function mem0GetAll(
  args: {
    userId?: string;
    agentId?: string;
    limit?: number;
  },
  config: Mem0Config = {}
): Promise<{ success: boolean; results?: Mem0Memory[]; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    const result = await client.getAll({
      userId: args.userId || config.userId,
      agentId: args.agentId || config.agentId,
      limit: args.limit,
    });
    log.info('Mem0 get_all completed', { count: result.results?.length || 0 });
    return { success: true, results: result.results };
  } catch (err: any) {
    log.error('mem0_get_all failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Action: Update a memory
 */
export async function mem0Update(
  args: {
    memoryId: string;
    text: string;
  },
  config: Mem0Config = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    await client.update(args.memoryId, args.text);
    log.info('Mem0 memory updated', { memoryId: args.memoryId });
    return { success: true };
  } catch (err: any) {
    log.error('mem0_update failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Action: Delete a memory
 */
export async function mem0Delete(
  args: { memoryId: string },
  config: Mem0Config = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    await client.delete(args.memoryId);
    log.info('Mem0 memory deleted', { memoryId: args.memoryId });
    return { success: true };
  } catch (err: any) {
    log.error('mem0_delete failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Action: Delete all memories
 */
export async function mem0DeleteAll(
  args: { userId?: string; agentId?: string },
  config: Mem0Config = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    await client.deleteAll({
      userId: args.userId || config.userId,
      agentId: args.agentId || config.agentId,
    });
    log.info('Mem0 all memories deleted', { userId: args.userId, agentId: args.agentId });
    return { success: true };
  } catch (err: any) {
    log.error('mem0_delete_all failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

// ============================================================================
// Power Manifest
// ============================================================================

export const mem0PowerManifest = {
  id: 'mem0-memory',
  name: 'Mem0 Persistent Memory',
  version: '1.0.0',
  description: 'Add persistent memory to remember user preferences, conversation context, and retrieve relevant memories across sessions using Mem0 Platform.',
  triggers: ['remember', 'memory', 'persistent', 'preferences', 'context', 'user info', 'past conversations'],
  actions: [
    {
      name: 'add',
      description: 'Store memories from a conversation. Call after each user-agent interaction to build persistent context.',
      paramsSchema: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          userId: { type: 'string', description: 'User identifier for scoping memories' },
          agentId: { type: 'string', description: 'Agent identifier (optional)' },
          sessionId: { type: 'string', description: 'Session/thread identifier (optional)' },
        },
        required: ['messages'],
      },
    },
    {
      name: 'search',
      description: 'Search memories for relevant context before responding. Use before generating responses to personalize based on user history.',
      paramsSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          userId: { type: 'string', description: 'User identifier' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_all',
      description: 'Retrieve all stored memories for a user. Useful for debugging or displaying user profile.',
      paramsSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User identifier' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'update',
      description: 'Update an existing memory by ID. Use when user corrects information.',
      paramsSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID to update' },
          text: { type: 'string', description: 'New memory text' },
        },
        required: ['memoryId', 'text'],
      },
    },
    {
      name: 'delete',
      description: 'Delete a specific memory by ID.',
      paramsSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID to delete' },
        },
        required: ['memoryId'],
      },
    },
    {
      name: 'delete_all',
      description: 'Delete all memories for a user. Use when user requests data reset.',
      paramsSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User identifier' },
        },
      },
    },
  ],
  permissions: {
    allowedHosts: ['api.mem0.ai'],
  },
  source: 'marketplace' as const,
  enabled: true,
};

// ============================================================================
// Tool Builder
// ============================================================================

/**
 * Build Vercel AI tools from the mem0 power
 */
export async function buildMem0Tools(context: { userId?: string; sessionId?: string } = {}) {
  const { tool } = await import('ai');

  const userId = context.userId || 'default-user';
  const sessionId = context.sessionId;

  const tools: Record<string, any> = {};

  tools.mem0_add = tool({
    description: 'Store memories from a conversation for persistent context. Call after each user-agent interaction.',
    parameters: z.object({
      messages: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      })),
      userId: z.string().optional(),
    }),
    execute: async (args: any) => mem0Add(args, { userId, sessionId }),
  } as any);

  tools.mem0_search = tool({
    description: 'Search memories for relevant context before responding. Use to personalize responses based on user history.',
    parameters: z.object({
      query: z.string(),
      userId: z.string().optional(),
      limit: z.number().optional(),
    }),
    execute: async (args: any) => mem0Search(args, { userId, sessionId }),
  } as any);

  tools.mem0_get_all = tool({
    description: 'Retrieve all stored memories for a user.',
    parameters: z.object({
      userId: z.string().optional(),
      limit: z.number().optional(),
    }),
    execute: async (args: any) => mem0GetAll(args, { userId, sessionId }),
  } as any);

  tools.mem0_update = tool({
    description: 'Update an existing memory by ID.',
    parameters: z.object({
      memoryId: z.string(),
      text: z.string(),
    }),
    execute: async (args: any) => mem0Update(args, { userId, sessionId }),
  } as any);

  tools.mem0_delete = tool({
    description: 'Delete a specific memory by ID.',
    parameters: z.object({
      memoryId: z.string(),
    }),
    execute: async (args: any) => mem0Delete(args, { userId, sessionId }),
  } as any);

  tools.mem0_delete_all = tool({
    description: 'Delete all memories for a user.',
    parameters: z.object({
      userId: z.string().optional(),
    }),
    execute: async (args: any) => mem0DeleteAll(args, { userId, sessionId }),
  } as any);

  return tools;
}

// ============================================================================
// System Prompt Block
// ============================================================================

/**
 * Build system prompt with memory context (for auto-retrieval)
 * @param memories Array of memory objects to include in prompt
 */
export function buildMem0SystemPrompt(memories: Mem0Memory[]): string {
  if (!memories || memories.length === 0) {
    return '';
  }
  
  const memoryList = memories
    .map(m => `- ${m.memory}`)
    .join('\n');
  
  return `\n## Relevant User Memories\n\n${memoryList}\n`;
}

export function buildMem0SystemPromptLegacy(): string {
  return `
## Mem0 Persistent Memory

You have access to Mem0 for persistent memory storage and retrieval.

### When to use

1. **After each user interaction**: Call mem0_add to store the conversation for future context
2. **Before generating responses**: Call mem0_search to retrieve relevant memories and personalize
3. **User preferences**: Remember dietary restrictions, communication style, project preferences
4. **Context recall**: Remember previous discussions, decisions, code patterns used

### Available tools

- \`mem0_add\` - Store conversation memories
- \`mem0_search\` - Search for relevant context
- \`mem0_get_all\` - Get all user memories
- \`mem0_update\` - Update a memory
- \`mem0_delete\` - Delete a memory
- \`mem0_delete_all\` - Clear all user memories

### Integration pattern

1. At the start of a conversation, search for existing memories
2. Include relevant memories in your context
3. After each significant interaction, add the exchange to memory
4. When user provides preferences or corrections, update the memory

### Configuration

Requires MEM0_API_KEY environment variable. Get one at https://app.mem0.ai/dashboard/api-keys
`;
}