import type { ParserToolDefinition, ParsedToolCall } from './types';

export interface SelfHealingToolCallResult {
  accepted: ParsedToolCall[];
  rejected: Array<{ call: ParsedToolCall; reason: string }>;
}

/**
 * Healing cache entry
 */
interface HealingCacheEntry {
  originalArgs: string;
  healedArgs: Record<string, any>;
  successCount: number;
  lastUsed: number;
}

export class SelfHealingToolValidator {
  private healingCache: Map<string, HealingCacheEntry> = new Map();
  private readonly CACHE_MAX_SIZE = 1000;
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  async validate(calls: ParsedToolCall[], tools: ParserToolDefinition[]): Promise<SelfHealingToolCallResult> {
    const accepted: ParsedToolCall[] = [];
    const rejected: Array<{ call: ParsedToolCall; reason: string }> = [];

    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      if (!tool) {
        rejected.push({ call, reason: 'Unknown tool name' });
        continue;
      }

      if (!tool.inputSchema) {
        accepted.push(call);
        continue;
      }

      const parsed = tool.inputSchema.safeParse(call.arguments);
      if (parsed.success) {
        accepted.push({ ...call, arguments: parsed.data as Record<string, any> });
        continue;
      }

      // Try cache first (fastest)
      const cachedHealedArgs = this.getFromCache(call.name, call.arguments);
      if (cachedHealedArgs) {
        const healedParse = tool.inputSchema.safeParse(cachedHealedArgs);
        if (healedParse.success) {
          accepted.push({ ...call, arguments: healedParse.data as Record<string, any> });
          continue;
        }
      }

      // Try shallow healing first (fast, no LLM)
      const healedArgs = this.attemptShallowHeal(call.arguments);
      const healedParse = tool.inputSchema.safeParse(healedArgs);
      if (healedParse.success) {
        // Cache the successful heal
        this.addToCache(call.name, call.arguments, healedArgs);
        accepted.push({ ...call, arguments: healedParse.data as Record<string, any> });
        continue;
      }

      // Try deep healing with LLM (slower but more powerful)
      const deepHealedArgs = await this.attemptDeepHeal(call, tool, parsed.error);
      if (deepHealedArgs) {
        const deepHealedParse = tool.inputSchema.safeParse(deepHealedArgs);
        if (deepHealedParse.success) {
          // Cache the successful heal
          this.addToCache(call.name, call.arguments, deepHealedArgs);
          accepted.push({ ...call, arguments: deepHealedParse.data as Record<string, any> });
          continue;
        }
      }

      rejected.push({
        call,
        reason: parsed.error.errors.map((e) => e.message).join('; ') || 'Validation failed',
      });
    }

    return { accepted, rejected };
  }


  /**
   * Get healed args from cache
   */
  private getFromCache(toolName: string, args: Record<string, any>): Record<string, any> | null {
    const cacheKey = this.getCacheKey(toolName, args);
    const entry = this.healingCache.get(cacheKey);
    
    if (!entry) return null;
    
    // Check if cache entry is expired
    if (Date.now() - entry.lastUsed > this.CACHE_TTL_MS) {
      this.healingCache.delete(cacheKey);
      return null;
    }
    
    // Update success count and last used
    entry.successCount++;
    entry.lastUsed = Date.now();
    
    return entry.healedArgs;
  }

  /**
   * Add healed args to cache
   */
  private addToCache(toolName: string, originalArgs: Record<string, any>, healedArgs: Record<string, any>): void {
    const cacheKey = this.getCacheKey(toolName, originalArgs);
    
    // Enforce max cache size
    if (this.healingCache.size >= this.CACHE_MAX_SIZE) {
      this.evictOldestCacheEntry();
    }
    
    this.healingCache.set(cacheKey, {
      originalArgs: JSON.stringify(originalArgs),
      healedArgs,
      successCount: 1,
      lastUsed: Date.now(),
    });
  }

  /**
   * Get cache key for tool and args
   */
  private getCacheKey(toolName: string, args: Record<string, any>): string {
    return `${toolName}:${JSON.stringify(args)}`;
  }

  /**
   * Evict oldest cache entry
   */
  private evictOldestCacheEntry(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.healingCache.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.healingCache.delete(oldestKey);
    }
  }

  /**
   * Clear healing cache
   */
  clearCache(): void {
    this.healingCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; totalHits: number } {
    let totalHits = 0;
    for (const entry of this.healingCache.values()) {
      totalHits += entry.successCount;
    }
    
    return {
      size: this.healingCache.size,
      totalHits,
    };
  }

  private attemptShallowHeal(args: Record<string, any>): Record<string, any> {
    const healed: Record<string, any> = {};

    for (const [key, value] of Object.entries(args || {})) {
      if (typeof value !== 'string') {
        healed[key] = value;
        continue;
      }

      const trimmed = value.trim();
      if (trimmed === 'true') {
        healed[key] = true;
      } else if (trimmed === 'false') {
        healed[key] = false;
      } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        healed[key] = Number(trimmed);
      } else {
        healed[key] = value;
      }
    }

    return healed;
  }

  /**
   * Attempt to heal arguments using LLM-based semantic understanding
   * This is more powerful than shallow healing but slower
   */
  private async attemptDeepHeal(
    call: ParsedToolCall,
    tool: ParserToolDefinition,
    error: any
  ): Promise<Record<string, any> | null> {
    try {
      // Build healing prompt
      const healingPrompt = `The tool call failed validation. Please fix the arguments.

Tool: ${call.name}
Current Arguments: ${JSON.stringify(call.arguments, null, 2)}
Error: ${error.errors.map((e: any) => e.message).join('; ')}

Expected Schema:
${JSON.stringify(tool.inputSchema, null, 2)}

Fix the arguments to match the schema. Return ONLY the corrected JSON object, no explanation.`;

      // Try to use available LLM for healing
      const { generateText } = await import('ai');
      const { createOpenAI } = await import('@ai-sdk/openai');
      
      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
      const model = openai('gpt-4o-mini') as any; // Type assertion for compatibility

      const result = await generateText({
        model,
        prompt: healingPrompt,
        maxTokens: 500,
        temperature: 0.1,
      });

      // Parse the LLM response as JSON
      try {
        const healedArgs = JSON.parse(result.text);
        return healedArgs as Record<string, any>;
      } catch {
        return null;
      }
    } catch (llmError) {
      // LLM healing failed, return null to fall back to rejection
      console.warn('[SelfHealingToolValidator] LLM-based healing failed:', llmError);
      return null;
    }
  }
}
