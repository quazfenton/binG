/**
 * Tool Discovery Service
 *
 * Unified tool discovery across all providers.
 * Provides search, filtering, and schema retrieval.
 *
 * Features:
 * - Multi-provider search
 * - Schema validation
 * - Category filtering
 * - Usage statistics
 */

import { z } from 'zod';
import { getToolManager } from './index';
import type { ToolInfo } from './registry';
import { getArcadeService } from '../platforms/arcade-service';
import { getNangoService } from '../platforms/nango-service';
import { getTamboService } from '../tambo/tambo-service';
import { createLogger } from '../utils/logger';

const logger = createLogger('Tools:Discovery');

export interface DiscoveryOptions {
  /** Search query */
  query?: string;
  /** Filter by category */
  category?: string;
  /** Filter by provider */
  provider?: string;
  /** Filter by auth requirement */
  requiresAuth?: boolean;
  /** Maximum results */
  limit?: number;
  /** User ID for personalized results */
  userId?: string;
}

export interface ToolUsageStats {
  toolName: string;
  executionCount: number;
  successRate: number;
  avgExecutionTime: number;
  lastUsed?: number;
}

export interface DiscoveredTool {
  /** Tool name/identifier */
  name: string;
  /** Tool description */
  description: string;
  /** Provider (arcade, nango, composio, etc.) */
  provider: string;
  /** Tool category */
  category?: string;
  /** Whether tool requires authentication */
  requiresAuth: boolean;
  /** Input schema */
  inputSchema?: z.ZodSchema;
  /** Provider-specific tool ID */
  providerToolId?: string;
  /** Example usage */
  examples?: string[];
  /** Related tools */
  relatedTools?: string[];
  /** Usage statistics */
  stats?: ToolUsageStats;
}

/**
 * Tool Discovery Service Class
 */
export class ToolDiscoveryService {
  private static instance: ToolDiscoveryService;
  private usageStats = new Map<string, ToolUsageStats>();
  private toolManager = getToolManager();

  static getInstance(): ToolDiscoveryService {
    if (!ToolDiscoveryService.instance) {
      ToolDiscoveryService.instance = new ToolDiscoveryService();
    }
    return ToolDiscoveryService.instance;
  }

  /**
   * Search for tools
   */
  async search(options: DiscoveryOptions = {}): Promise<DiscoveredTool[]> {
    const {
      query = '',
      category,
      provider,
      requiresAuth,
      limit = 50,
      userId,
    } = options;

    logger.debug('Tool search started', {
      query: query || '(all tools)',
      category,
      provider,
      requiresAuth,
      limit,
      userId,
    });

    let results: DiscoveredTool[] = [];

    // Use consolidated ToolIntegrationManager for tool search
    const tools = this.toolManager.searchTools(query || '');
    logger.debug(`Found ${tools.length} tools from tool manager`, { query });

    // Convert to DiscoveredTool format
    results = tools.map(tool => ({
      name: tool.toolName,
      description: tool.description,
      provider: tool.provider,
      category: tool.category,
      requiresAuth: tool.requiresAuth,
      inputSchema: tool.inputSchema,
      providerToolId: `${tool.provider}:${tool.toolName}`,
    }));

    // Apply filters
    if (category) {
      const beforeCount = results.length;
      results = results.filter(tool =>
        tool.category?.toLowerCase() === category.toLowerCase()
      );
      logger.debug(`Category filter applied: ${category}`, {
        before: beforeCount,
        after: results.length,
      });
    }

    if (provider) {
      const beforeCount = results.length;
      results = results.filter(tool =>
        tool.provider.toLowerCase() === provider.toLowerCase()
      );
      logger.debug(`Provider filter applied: ${provider}`, {
        before: beforeCount,
        after: results.length,
      });
    }

    if (requiresAuth !== undefined) {
      const beforeCount = results.length;
      results = results.filter(tool =>
        tool.requiresAuth === requiresAuth
      );
      logger.debug(`Auth filter applied: ${requiresAuth ? 'requires auth' : 'no auth required'}`, {
        before: beforeCount,
        after: results.length,
      });
    }

    // Add usage stats
    results = results.map(tool => ({
      ...tool,
      stats: this.usageStats.get(tool.name),
    }));

    // Sort by relevance (search score) and usage
    results = this.sortResults(results, query);

    // Apply limit
    const finalResults = results.slice(0, limit);
    
    logger.info('Tool search completed', {
      query,
      totalFound: results.length,
      returned: finalResults.length,
      limited: results.length > limit,
    });

    return finalResults;
  }

  /**
   * Get tool by name
   */
  async getTool(toolName: string, userId?: string): Promise<DiscoveredTool | null> {
    const results = await this.search({
      query: toolName,
      limit: 1,
      userId,
    });

    // Exact match
    const exactMatch = results.find(
      tool => tool.name.toLowerCase() === toolName.toLowerCase()
    );

    if (exactMatch) {
      return exactMatch;
    }

    // Partial match
    return results[0] || null;
  }

  /**
   * Get tool schema
   */
  getToolSchema(toolName: string): z.ZodSchema | null {
    return this.registry.getToolSchema(toolName) || null;
  }

  /**
   * Get tool examples
   */
  getToolExamples(toolName: string): string[] {
    // Generate examples based on tool name and category
    const examples: string[] = [];
    
    const tool = this.getToolFromName(toolName);
    if (!tool) {
      return examples;
    }

    // Generate example based on tool type
    if (tool.name.includes('send') || tool.name.includes('create')) {
      examples.push(`Use ${tool.name} to create a new resource`);
      examples.push(`Example: ${tool.name}({ name: "example", ... })`);
    }

    if (tool.name.includes('get') || tool.name.includes('read') || tool.name.includes('list')) {
      examples.push(`Use ${tool.name} to retrieve information`);
      examples.push(`Example: ${tool.name}({ id: "123" })`);
    }

    if (tool.name.includes('search')) {
      examples.push(`Use ${tool.name} to find resources matching criteria`);
      examples.push(`Example: ${tool.name}({ query: "search term" })`);
    }

    return examples;
  }

  /**
   * Get related tools
   */
  getRelatedTools(toolName: string, limit = 5): Promise<DiscoveredTool[]> {
    const tool = this.getToolFromName(toolName);
    if (!tool) {
      return Promise.resolve([]);
    }

    // Find tools in same category or from same provider
    return this.search({
      category: tool.category,
      provider: tool.provider,
      limit: limit + 1, // +1 to account for the original tool
    }).then(tools => 
      tools.filter(t => t.name !== toolName).slice(0, limit)
    );
  }

  /**
   * Record tool usage
   */
  recordUsage(toolName: string, success: boolean, executionTime: number): void {
    const stats = this.usageStats.get(toolName) || {
      toolName,
      executionCount: 0,
      successRate: 100,
      avgExecutionTime: 0,
    };

    stats.executionCount++;
    
    // Update success rate
    const totalSuccess = stats.successRate * (stats.executionCount - 1) / 100;
    const newSuccess = success ? totalSuccess + 1 : totalSuccess;
    stats.successRate = (newSuccess / stats.executionCount) * 100;

    // Update average execution time
    stats.avgExecutionTime = (
      (stats.avgExecutionTime * (stats.executionCount - 1)) + executionTime
    ) / stats.executionCount;

    stats.lastUsed = Date.now();

    this.usageStats.set(toolName, stats);
  }

  /**
   * Get usage statistics
   */
  getUsageStats(toolName?: string): ToolUsageStats | Map<string, ToolUsageStats> {
    if (toolName) {
      return this.usageStats.get(toolName);
    }
    return this.usageStats;
  }

  /**
   * Get popular tools
   */
  async getPopularTools(limit = 10): Promise<DiscoveredTool[]> {
    const stats = Array.from(this.usageStats.values())
      .sort((a, b) => b.executionCount - a.executionCount)
      .slice(0, limit);

    const tools: DiscoveredTool[] = [];
    for (const stat of stats) {
      const tool = await this.getTool(stat.toolName);
      if (tool) {
        tool.stats = stat;
        tools.push(tool);
      }
    }

    return tools;
  }

  /**
   * Get recently used tools
   */
  async getRecentlyUsedTools(limit = 10): Promise<DiscoveredTool[]> {
    const stats = Array.from(this.usageStats.values())
      .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
      .slice(0, limit);

    const tools: DiscoveredTool[] = [];
    for (const stat of stats) {
      const tool = await this.getTool(stat.toolName);
      if (tool) {
        tool.stats = stat;
        tools.push(tool);
      }
    }

    return tools;
  }

  /**
   * Get tools by category
   */
  async getToolsByCategory(category: string, userId?: string): Promise<DiscoveredTool[]> {
    return this.search({ category, userId });
  }

  /**
   * Get tools by provider
   */
  async getToolsByProvider(provider: string, userId?: string): Promise<DiscoveredTool[]> {
    return this.search({ provider, userId });
  }

  /**
   * Clear usage statistics
   */
  clearUsageStats(toolName?: string): void {
    if (toolName) {
      this.usageStats.delete(toolName);
    } else {
      this.usageStats.clear();
    }
  }

  /**
   * Sort results by relevance
   */
  private sortResults(results: DiscoveredTool[], query: string): DiscoveredTool[] {
    if (!query) {
      // Sort by usage when no query
      return results.sort((a, b) => {
        const aCount = a.stats?.executionCount || 0;
        const bCount = b.stats?.executionCount || 0;
        return bCount - aCount;
      });
    }

    // Sort by relevance when query exists
    const queryLower = query.toLowerCase();
    
    return results.sort((a, b) => {
      const aNameScore = a.name.toLowerCase().includes(queryLower) ? 2 : 0;
      const bNameScore = b.name.toLowerCase().includes(queryLower) ? 2 : 0;
      
      const aDescScore = a.description.toLowerCase().includes(queryLower) ? 1 : 0;
      const bDescScore = b.description.toLowerCase().includes(queryLower) ? 1 : 0;

      const aUsageScore = (a.stats?.executionCount || 0) / 100;
      const bUsageScore = (b.stats?.executionCount || 0) / 100;

      return (bNameScore + bDescScore + bUsageScore) - (aNameScore + aDescScore + aUsageScore);
    });
  }

  /**
   * Get tool from name (helper)
   */
  private getToolFromName(toolName: string): ToolInfo | null {
    // This is a simplified lookup - in production would query registry
    return {
      name: toolName,
      description: '',
      provider: 'unknown',
      requiresAuth: false,
    };
  }
}

/**
 * Get tool discovery service instance
 */
export function getToolDiscoveryService(): ToolDiscoveryService {
  return ToolDiscoveryService.getInstance();
}

/**
 * Initialize tool discovery service
 */
export function initializeToolDiscoveryService(): ToolDiscoveryService {
  return ToolDiscoveryService.getInstance();
}
