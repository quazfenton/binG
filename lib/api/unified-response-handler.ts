/**
 * Unified Response Handler - Handles responses from all sources consistently
 * Provides structured response format, commands extraction, and quality metrics
 */

export interface UnifiedResponse {
  success: boolean;
  content: string;
  source: string;
  priority: number;
  data: {
    content: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    model?: string;
    provider?: string;
    toolCalls?: any[];
    files?: any[];
    chainedAgents?: string[];
    qualityScore?: number;
    processingSteps?: any[];
    reflectionResults?: any[];
    multiModalContent?: any[];
    iterations?: number;
    classifications?: Record<string, any>;
    optimizations?: Record<string, any>;
    isFallback?: boolean;
    fallbackReason?: string;
    requiresAuth?: boolean;
    authUrl?: string;
    toolName?: string;
    authProvider?: string;
    messageMetadata?: Record<string, any>;
  };
  commands?: {
    request_files?: string[];
    write_diffs?: Array<{ path: string; diff: string }>;
  };
  metadata?: {
    duration?: number;
    routedThrough?: string;
    fallbackChain?: string[];
    triedEndpoints?: number;
    timestamp: string;
  };
}

export class UnifiedResponseHandler {
  /**
   * Process and unify response from any source
   */
  processResponse(response: any, requestId?: string): UnifiedResponse {
    const content = this.extractContent(response);
    const commands = this.extractCommands(content);
    const toolName = response.data?.toolName;
    const authProvider =
      response.data?.provider ||
      response.data?.authProvider ||
      this.inferProviderFromToolName(toolName);
    const requiresAuth = !!response.data?.requiresAuth;
    const messageMetadata = requiresAuth
      ? {
          requiresAuth: true,
          authUrl: response.data?.authUrl,
          toolName,
          provider: authProvider,
        }
      : undefined;

    return {
      success: response.success !== false,
      content,
      source: response.source || 'unknown',
      priority: response.priority || 999,
      data: {
        content,
        usage: this.calculateUsage(response),
        model: response.metadata?.actualModel || response.data?.model || response.model,
        provider: response.metadata?.actualProvider || response.data?.provider || response.provider,
        toolCalls: response.data?.toolCalls,
        files: response.data?.files,
        chainedAgents: response.data?.chainedAgents,
        qualityScore: response.data?.qualityScore,
        processingSteps: response.data?.processingSteps,
        reflectionResults: response.data?.reflectionResults,
        multiModalContent: response.data?.multiModalContent,
        iterations: response.data?.iterations,
        classifications: response.data?.classifications,
        optimizations: response.data?.optimizations,
        isFallback: response.data?.isFallback,
        fallbackReason: response.data?.fallbackReason,
        requiresAuth,
        authUrl: response.data?.authUrl,
        toolName,
        authProvider,
        messageMetadata,
      },
      commands,
      metadata: {
        duration: response.metadata?.duration,
        routedThrough: response.metadata?.routedThrough || response.source,
        fallbackChain: response.fallbackChain || response.metadata?.fallbackChain,
        triedEndpoints: response.metadata?.triedEndpoints,
        actualProvider: response.metadata?.actualProvider,
        actualModel: response.metadata?.actualModel,
        timestamp: new Date().toISOString(),
        messageMetadata,
      }
    };
  }

  private inferProviderFromToolName(toolName?: string): string | undefined {
    if (!toolName || typeof toolName !== 'string') return undefined;
    const normalized = toolName.toLowerCase();
    if (normalized.startsWith('gmail.') || normalized.startsWith('google')) return 'google';
    if (normalized.startsWith('github.')) return 'github';
    if (normalized.startsWith('slack.')) return 'slack';
    if (normalized.startsWith('notion.')) return 'notion';
    if (normalized.startsWith('discord.')) return 'discord';
    if (normalized.startsWith('twitter.') || normalized.startsWith('x.')) return 'twitter';
    if (normalized.startsWith('spotify.')) return 'spotify';
    if (normalized.startsWith('twilio.')) return 'twilio';
    return normalized.split('.')[0];
  }

  /**
   * Extract content from various response formats
   */
  private extractContent(response: any): string {
    if (typeof response.content === 'string') {
      return response.content;
    }
    
    if (response.data?.content) {
      return response.data.content;
    }
    
    if (response.choices?.[0]?.message?.content) {
      return response.choices[0].message.content;
    }
    
    return '';
  }

  /**
   * Extract commands from content
   */
  private extractCommands(content: string): { request_files?: string[]; write_diffs?: Array<{ path: string; diff: string }> } | undefined {
    try {
      const match = content.match(/=== COMMANDS_START ===([\s\S]*?)=== COMMANDS_END ===/);
      if (!match) return undefined;

      const block = match[1];
      
      // Parse request_files
      const reqMatch = block.match(/request_files:\s*\[(.*?)\]/s);
      const request_files = reqMatch
        ? JSON.parse(`[${reqMatch[1]}]`.replace(/([a-zA-Z0-9_\-\/\.]+)(?=\s*[\],])/g, '"$1"'))
        : [];

      // Parse write_diffs
      let write_diffs: Array<{ path: string; diff: string }> = [];
      const diffsMatch = block.match(/write_diffs:\s*\[([\s\S]*?)\]/);
      if (diffsMatch) {
        const items = diffsMatch[1]
          .split(/},/)
          .map(s => (s.endsWith('}') ? s : s + '}'))
          .map(s => s.trim())
          .filter(Boolean);
        
        write_diffs = items.map(raw => {
          const pathMatch = raw.match(/path:\s*"([^"]+)"/);
          const diffMatch = raw.match(/diff:\s*"([\s\S]*)"/);
          return {
            path: pathMatch?.[1] || '',
            diff: (diffMatch?.[1] || '').replace(/\\n/g, '\n')
          };
        });
      }

      return { request_files, write_diffs };
    } catch (error) {
      console.warn('[UnifiedResponseHandler] Failed to parse commands:', error);
      return undefined;
    }
  }

  /**
   * Calculate usage statistics
   */
  private calculateUsage(response: any): { promptTokens: number; completionTokens: number; totalTokens: number } {
    // If usage data is provided, use it
    if (response.usage || response.data?.usage) {
      const usage = response.usage || response.data.usage;
      return {
        promptTokens: usage.promptTokens || usage.prompt_tokens || 0,
        completionTokens: usage.completionTokens || usage.completion_tokens || 0,
        totalTokens: usage.totalTokens || usage.total_tokens || 0
      };
    }

    // Estimate based on content length
    const content = this.extractContent(response);
    const estimatedTokens = Math.ceil(content.length / 4); // Rough estimate: 1 token ≈ 4 characters
    
    return {
      promptTokens: 0,
      completionTokens: estimatedTokens,
      totalTokens: estimatedTokens
    };
  }

  /**
   * Create streaming events from unified response
   */
  createStreamingEvents(response: UnifiedResponse, requestId: string): string[] {
    const events: string[] = [];
    const encoder = new TextEncoder();

    // Init event
    events.push(this.createEvent('init', {
      requestId,
      startTime: Date.now(),
      provider: response.data.provider,
      model: response.data.model,
      source: response.source,
      priority: response.priority
    }));

    // Processing steps if available
    if (response.data.processingSteps?.length) {
      response.data.processingSteps.forEach((step, index) => {
        events.push(this.createEvent('step', {
          requestId,
          stepIndex: index,
          ...step
        }));
      });
    }

    // Content tokens (chunked)
    const content = response.content;
    const chunks = this.chunkContent(content, 30);
    chunks.forEach((chunk, index) => {
      events.push(this.createEvent('token', {
        type: 'token',
        content: chunk,
        requestId,
        timestamp: Date.now(),
        offset: index * 30
      }));
    });

    // Tool calls if available
    if (response.data.toolCalls?.length) {
      events.push(this.createEvent('tools', {
        requestId,
        toolCalls: response.data.toolCalls
      }));
    }

    // Files if available
    if (response.data.files?.length) {
      events.push(this.createEvent('files', {
        requestId,
        files: response.data.files
      }));
    }

    // Reflection results if available
    if (response.data.reflectionResults?.length) {
      events.push(this.createEvent('reflection', {
        requestId,
        reflections: response.data.reflectionResults,
        qualityScore: response.data.qualityScore
      }));
    }

    // Multimodal content if available
    if (response.data.multiModalContent?.length) {
      response.data.multiModalContent.forEach((item, index) => {
        events.push(this.createEvent('multimodal', {
          requestId,
          index,
          ...item
        }));
      });
    }

    // Commands if available
    if (response.commands) {
      events.push(this.createEvent('commands', {
        requestId,
        commands: response.commands
      }));
    }

    // Done event
    events.push(this.createEvent('done', {
      requestId,
      success: response.success,
      totalTokens: response.data.usage?.totalTokens || content.length,
      qualityScore: response.data.qualityScore,
      source: response.source,
      metadata: response.metadata,
      messageMetadata: response.data.messageMetadata || response.metadata?.messageMetadata
    }));

    return events;
  }

  /**
   * Create SSE event string
   */
  private createEvent(eventType: string, data: any): string {
    if (eventType === 'token') {
      return `data: ${JSON.stringify(data)}\n\n`;
    }
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  /**
   * Chunk content for streaming
   */
  private chunkContent(content: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    let offset = 0;

    while (offset < content.length) {
      let endOffset = Math.min(offset + chunkSize, content.length);
      
      // Try to break at word boundaries
      if (endOffset < content.length) {
        const nextSpace = content.indexOf(' ', endOffset);
        const nextNewline = content.indexOf('\n', endOffset);
        
        if (nextSpace !== -1 && nextSpace - endOffset < 20) {
          endOffset = nextSpace;
        } else if (nextNewline !== -1 && nextNewline - endOffset < 30) {
          endOffset = nextNewline + 1;
        }
      }

      chunks.push(content.slice(offset, endOffset));
      offset = endOffset;
    }

    return chunks;
  }
}

export const unifiedResponseHandler = new UnifiedResponseHandler();
