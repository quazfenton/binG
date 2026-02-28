/**
 * Mastra Memory Integration
 *
 * Provides conversation history and context management for agents.
 * Integrates with existing PostgreSQL database for persistence.
 *
 * Features:
 * - Message history tracking
 * - Working memory for conversations
 * - Semantic recall (optional, requires embeddings)
 * - Cross-session context
 *
 * @see https://mastra.ai/docs/memory/overview
 */

import { Memory } from '@mastra/memory';
import type { Message } from '@mastra/core/memory';

// Memory configuration options
interface MemoryConfig {
  enabled: boolean;
  maxMessages?: number;
  workingMemory?: boolean;
  semanticRecall?: boolean;
}

// Default configuration
const DEFAULT_CONFIG: MemoryConfig = {
  enabled: process.env.MASTRA_MEMORY_ENABLED === 'true',
  maxMessages: parseInt(process.env.MASTRA_MEMORY_MAX_MESSAGES || '100', 10),
  workingMemory: process.env.MASTRA_MEMORY_WORKING === 'true',
  semanticRecall: process.env.MASTRA_MEMORY_SEMANTIC === 'true',
};

/**
 * Create memory instance with PostgreSQL storage
 *
 * Reuses existing DATABASE_URL for persistence
 */
export function createMemory(config: MemoryConfig = DEFAULT_CONFIG): Memory | null {
  if (!config.enabled) {
    console.log('[Memory] Memory integration disabled');
    return null;
  }

  try {
    const memory = new Memory({
      storage: {
        type: 'postgresql',
        uri: process.env.DATABASE_URL || 'postgresql://localhost:5432/bing',
        schema: 'mastra_memory',
      },
      options: {
        workingMemory: config.workingMemory,
        semanticRecall: config.semanticRecall,
        messageHistory: {
          maxMessages: config.maxMessages,
        },
      },
    });

    console.log('[Memory] Memory initialized with config:', config);
    return memory;
  } catch (error) {
    console.error('[Memory] Failed to initialize memory:', error);
    return null;
  }
}

/**
 * Singleton memory instance
 *
 * Created on first access to avoid initialization overhead
 */
let memoryInstance: Memory | null = null;

/**
 * Get or create memory instance
 *
 * @returns Memory instance or null if disabled
 */
export function getMemory(): Memory | null {
  if (memoryInstance === null || memoryInstance === undefined) {
    memoryInstance = createMemory();
  }
  return memoryInstance;
}

/**
 * Add message to memory
 *
 * @param threadId - Conversation thread ID
 * @param message - Message to add
 * @param metadata - Optional metadata
 */
export async function addMessage(
  threadId: string,
  message: Omit<Message, 'id' | 'createdAt'>,
  metadata?: Record<string, any>
): Promise<void> {
  const memory = getMemory();
  if (!memory) return;

  try {
    await memory.addMessage({
      threadId,
      message: {
        ...message,
        metadata,
      },
    });
  } catch (error) {
    console.error('[Memory] Failed to add message:', error);
  }
}

/**
 * Get conversation history
 *
 * @param threadId - Conversation thread ID
 * @param limit - Max messages to retrieve
 * @returns Array of messages
 */
export async function getHistory(
  threadId: string,
  limit?: number
): Promise<Message[]> {
  const memory = getMemory();
  if (!memory) return [];

  try {
    return await memory.getMessages({ threadId, limit });
  } catch (error) {
    console.error('[Memory] Failed to get history:', error);
    return [];
  }
}

/**
 * Get working memory for thread
 *
 * @param threadId - Conversation thread ID
 * @returns Working memory content
 */
export async function getWorkingMemory(threadId: string): Promise<string | null> {
  const memory = getMemory();
  if (!memory || !memory.getWorkingMemory) return null;

  try {
    const result = await memory.getWorkingMemory({ threadId });
    return result || null;
  } catch (error) {
    console.error('[Memory] Failed to get working memory:', error);
    return null;
  }
}

/**
 * Update working memory for thread
 *
 * @param threadId - Conversation thread ID
 * @param content - New working memory content
 */
export async function setWorkingMemory(
  threadId: string,
  content: string
): Promise<void> {
  const memory = getMemory();
  if (!memory || !memory.setWorkingMemory) return;

  try {
    await memory.setWorkingMemory({ threadId, text: content });
  } catch (error) {
    console.error('[Memory] Failed to set working memory:', error);
  }
}

/**
 * Search memory semantically
 *
 * @param threadId - Conversation thread ID
 * @param query - Search query
 * @param limit - Max results
 * @returns Matching messages
 */
export async function searchMemory(
  threadId: string,
  query: string,
  limit?: number
): Promise<Message[]> {
  const memory = getMemory();
  if (!memory || !memory.searchMessages) return [];

  try {
    return await memory.searchMessages({ threadId, query, limit });
  } catch (error) {
    console.error('[Memory] Failed to search memory:', error);
    return [];
  }
}

/**
 * Delete thread and all associated messages
 *
 * @param threadId - Thread ID to delete
 */
export async function deleteThread(threadId: string): Promise<void> {
  const memory = getMemory();
  if (!memory) return;

  try {
    await memory.deleteThread(threadId);
  } catch (error) {
    console.error('[Memory] Failed to delete thread:', error);
  }
}

/**
 * Create agent with memory integration
 *
 * @param agent - Base agent configuration
 * @param memory - Memory instance
 * @returns Agent with memory attached
 */
export function withMemory<T extends { id: string }>(
  agent: T,
  memory: Memory | null
): T {
  if (!memory) return agent;

  // Attach memory to agent (type-safe attachment)
  (agent as any).memory = memory;
  return agent;
}

/**
 * Memory middleware for API routes
 *
 * Adds memory context to request
 */
export function memoryMiddleware() {
  return async (req: Request, next: () => Promise<Response>) => {
    const memory = getMemory();
    
    // Add memory to request context
    const context = { memory };
    
    // Store in global context for access in handlers
    (global as any).__memoryContext = context;
    
    return next();
  };
}
