/**
 * CrewAI Context Window Management
 *
 * Handles context window limits with automatic summarization and truncation.
 * Integrated with LLM for actual summarization.
 *
 * @see https://docs.crewai.com/en/concepts/memory.md
 */

import type { Agent } from '@crewai/core';
import { getModel } from './model-router';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface ContextWindowConfig {
  maxTokens: number;
  model: string;
  summarizeWhenFull?: boolean;
  summarizeThreshold?: number;
  preserveSystemMessages?: boolean;
  maxMessagesToSummarize?: number;
  summaryPrompt?: string;
}

const DEFAULT_CONFIG: Required<ContextWindowConfig> = {
  maxTokens: 128000,
  model: 'gpt-4o-mini',
  summarizeWhenFull: true,
  summarizeThreshold: 0.9,
  preserveSystemMessages: true,
  maxMessagesToSummarize: 20,
  summaryPrompt: 'Summarize the following conversation concisely, preserving key information, decisions, code snippets, and important context. Keep it under 500 words:',
};

const TOKEN_ESTIMATES = {
  characters: 4,
  messages: 100,
  system: 100,
};

export class ContextWindowManager {
  private config: Required<ContextWindowConfig>;
  private messageHistory: Message[] = [];
  private tokenCount = 0;
  private summary?: string;
  private agent?: Agent;

  constructor(config: Partial<ContextWindowConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the agent to use for summarization
   */
  setAgent(agent: Agent): void {
    this.agent = agent;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / TOKEN_ESTIMATES.characters);
  }

  private estimateMessageTokens(msg: Message): number {
    let tokens = TOKEN_ESTIMATES.messages;

    if (msg.role === 'system') {
      tokens = TOKEN_ESTIMATES.system;
    }

    tokens += this.estimateTokens(msg.content);

    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        tokens += this.estimateTokens(tc.function.name + tc.function.arguments);
      }
    }

    return tokens;
  }

  getCurrentTokens(): number {
    let total = this.summary ? this.estimateTokens(`[Summary: ${this.summary}]`) : 0;

    for (const msg of this.messageHistory) {
      total += this.estimateMessageTokens(msg);
    }

    return total;
  }

  shouldSummarize(): boolean {
    if (!this.config.summarizeWhenFull) return false;

    const ratio = this.getCurrentTokens() / this.config.maxTokens;
    return ratio >= this.config.summarizeThreshold;
  }

  shouldTruncate(): boolean {
    return this.getCurrentTokens() > this.config.maxTokens && !this.config.summarizeWhenFull;
  }

  /**
   * Add a message to the context window
   */
  addMessage(message: Message): void {
    this.messageHistory.push(message);
    this.tokenCount += this.estimateMessageTokens(message);

    // Check if summarization is needed
    if (this.shouldSummarize()) {
      this.summarize();
    } else if (this.shouldTruncate()) {
      this.truncate();
    }
  }

  /**
   * Add multiple messages
   */
  addMessages(messages: Message[]): void {
    for (const msg of messages) {
      this.addMessage(msg);
    }
  }

  /**
   * Summarize the conversation using LLM
   */
  async summarize(): Promise<string> {
    // Get messages to summarize (exclude system messages if configured)
    let messagesToSummarize = this.messageHistory;
    
    if (this.config.preserveSystemMessages) {
      messagesToSummarize = messagesToSummarize.filter(m => m.role !== 'system');
    }

    // Limit number of messages
    messagesToSummarize = messagesToSummarize.slice(-this.config.maxMessagesToSummarize);

    if (messagesToSummarize.length === 0) {
      return this.summary || '';
    }

    // Use LLM for summarization
    const summarizer = this.agent || getModel('fast');
    
    const conversationText = messagesToSummarize
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n');

    const response = await summarizer.generate([
      { role: 'system', content: this.config.summaryPrompt },
      { role: 'user', content: conversationText },
    ]);

    this.summary = response.text;
    
    // Clear summarized messages
    if (this.config.preserveSystemMessages) {
      this.messageHistory = this.messageHistory.filter(m => m.role === 'system');
    } else {
      this.messageHistory = [];
    }

    // Recalculate token count
    this.tokenCount = this.estimateTokens(`[Summary: ${this.summary}]`);
    
    return this.summary;
  }

  /**
   * Truncate oldest messages
   */
  truncate(): void {
    // Keep system messages
    const systemMessages = this.config.preserveSystemMessages
      ? this.messageHistory.filter(m => m.role === 'system')
      : [];

    // Keep recent messages
    const recentMessages = this.messageHistory.slice(-10);

    this.messageHistory = [...systemMessages, ...recentMessages];
    this.recalculateTokens();
  }

  private recalculateTokens(): void {
    this.tokenCount = this.messageHistory.reduce(
      (sum, msg) => sum + this.estimateMessageTokens(msg),
      this.summary ? this.estimateTokens(`[Summary: ${this.summary}]`) : 0
    );
  }

  /**
   * Get messages for LLM API
   */
  getMessages(): Message[] {
    const messages: Message[] = [];

    // Add summary as system message if exists
    if (this.summary) {
      messages.push({
        role: 'system',
        content: `[Previous conversation summary]\n${this.summary}`,
      });
    }

    // Add preserved system messages
    if (this.config.preserveSystemMessages) {
      const systemMessages = this.messageHistory.filter(m => m.role === 'system');
      messages.push(...systemMessages);
    }

    // Add remaining messages
    const otherMessages = this.config.preserveSystemMessages
      ? this.messageHistory.filter(m => m.role !== 'system')
      : this.messageHistory;

    messages.push(...otherMessages);

    return messages;
  }

  /**
   * Clear the context window
   */
  clear(): void {
    this.messageHistory = [];
    this.summary = undefined;
    this.tokenCount = 0;
  }

  /**
   * Get context statistics
   */
  getStats(): {
    totalTokens: number;
    maxTokens: number;
    usagePercent: number;
    messageCount: number;
    hasSummary: boolean;
  } {
    return {
      totalTokens: this.tokenCount,
      maxTokens: this.config.maxTokens,
      usagePercent: (this.tokenCount / this.config.maxTokens) * 100,
      messageCount: this.messageHistory.length,
      hasSummary: !!this.summary,
    };
  }
}

/**
 * Create context window manager with agent integration
 */
export function createContextWindow(
  config: Partial<ContextWindowConfig> = {},
  agent?: Agent
): ContextWindowManager {
  const manager = new ContextWindowManager(config);
  
  if (agent) {
    manager.setAgent(agent);
  }
  
  return manager;
}
