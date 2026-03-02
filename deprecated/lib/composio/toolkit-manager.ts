/**
 * Composio Toolkit Manager
 * 
 * Manages Composio toolkits - enabling, disabling, and configuring tool access.
 * Provides fine-grained control over which tools are available to agents.
 * 
 * @see https://docs.composio.dev/docs/cli Composio CLI
 */

import { EventEmitter } from 'events';

/**
 * Toolkit information
 */
export interface ToolkitInfo {
  /**
   * Toolkit slug
   */
  slug: string;
  
  /**
   * Toolkit name
   */
  name: string;
  
  /**
   * Toolkit description
   */
  description: string;
  
  /**
   * Whether toolkit is enabled
   */
  enabled: boolean;
  
  /**
   * Number of tools in toolkit
   */
  toolCount: number;
  
  /**
   * Toolkit categories
   */
  categories: string[];
  
  /**
   * Authentication required
   */
  requiresAuth: boolean;
  
  /**
   * Auth scheme type
   */
  authScheme?: 'OAUTH2' | 'API_KEY' | 'BASIC';
}

/**
 * Toolkit configuration
 */
export interface ToolkitConfig {
  /**
   * Toolkits to enable
   */
  enable?: string[];
  
  /**
   * Toolkits to disable
   */
  disable?: string[];
  
  /**
   * Default toolkits if none specified
   */
  defaults?: string[];
}

/**
 * Composio Toolkit Manager
 * 
 * Manages toolkit availability and configuration.
 */
export class ComposioToolkitManager extends EventEmitter {
  private enabledToolkits: Set<string> = new Set();
  private disabledToolkits: Set<string> = new Set();
  private toolkitCache: Map<string, ToolkitInfo> = new Map();
  private readonly DEFAULT_TOOLKITS = ['github', 'gmail', 'slack', 'notion'];

  constructor(defaultToolkits?: string[]) {
    super();
    
    // Initialize with defaults
    const toolkits = defaultToolkits || this.DEFAULT_TOOLKITS;
    for (const toolkit of toolkits) {
      this.enabledToolkits.add(toolkit);
    }
  }

  /**
   * Enable toolkit
   * 
   * @param slug - Toolkit slug
   * @returns Whether toolkit was enabled
   */
  enableToolkit(slug: string): boolean {
    if (this.enabledToolkits.has(slug)) {
      return false;
    }

    this.enabledToolkits.add(slug);
    this.disabledToolkits.delete(slug);
    this.emit('toolkit-enabled', slug);

    return true;
  }

  /**
   * Disable toolkit
   * 
   * @param slug - Toolkit slug
   * @returns Whether toolkit was disabled
   */
  disableToolkit(slug: string): boolean {
    if (!this.enabledToolkits.has(slug)) {
      return false;
    }

    this.enabledToolkits.delete(slug);
    this.disabledToolkits.add(slug);
    this.emit('toolkit-disabled', slug);

    return true;
  }

  /**
   * Check if toolkit is enabled
   * 
   * @param slug - Toolkit slug
   * @returns Whether toolkit is enabled
   */
  isToolkitEnabled(slug: string): boolean {
    return this.enabledToolkits.has(slug);
  }

  /**
   * Get enabled toolkits
   * 
   * @returns Array of enabled toolkit slugs
   */
  getEnabledToolkits(): string[] {
    return Array.from(this.enabledToolkits);
  }

  /**
   * Get disabled toolkits
   * 
   * @returns Array of disabled toolkit slugs
   */
  getDisabledToolkits(): string[] {
    return Array.from(this.disabledToolkits);
  }

  /**
   * Configure toolkits
   * 
   * @param config - Toolkit configuration
   * @returns Configuration result
   */
  configureToolkits(config: ToolkitConfig): {
    enabled: string[];
    disabled: string[];
  } {
    const enabled: string[] = [];
    const disabled: string[] = [];

    if (config.enable) {
      for (const slug of config.enable) {
        if (this.enableToolkit(slug)) {
          enabled.push(slug);
        }
      }
    }

    if (config.disable) {
      for (const slug of config.disable) {
        if (this.disableToolkit(slug)) {
          disabled.push(slug);
        }
      }
    }

    return { enabled, disabled };
  }

  /**
   * Reset to default toolkits
   */
  resetToDefaults(): void {
    this.enabledToolkits.clear();
    this.disabledToolkits.clear();
    
    for (const toolkit of this.DEFAULT_TOOLKITS) {
      this.enabledToolkits.add(toolkit);
    }
    
    this.emit('reset');
  }

  /**
   * Get toolkit info
   * 
   * @param slug - Toolkit slug
   * @returns Toolkit info or null
   */
  async getToolkitInfo(slug: string): Promise<ToolkitInfo | null> {
    // Check cache
    const cached = this.toolkitCache.get(slug);
    if (cached) {
      return cached;
    }

    // In production, this would fetch from Composio API
    // For now, return mock data
    const info: ToolkitInfo = {
      slug,
      name: slug.charAt(0).toUpperCase() + slug.slice(1),
      description: `${slug} toolkit`,
      enabled: this.enabledToolkits.has(slug),
      toolCount: 0,
      categories: [],
      requiresAuth: true,
      authScheme: 'OAUTH2',
    };

    this.toolkitCache.set(slug, info);
    return info;
  }

  /**
   * List all available toolkits
   * 
   * @returns Array of toolkit info
   */
  async listToolkits(): Promise<ToolkitInfo[]> {
    // In production, this would fetch from Composio API
    const knownToolkits = [
      'github', 'gmail', 'slack', 'notion', 'discord',
      'twitter', 'reddit', 'spotify', 'vercel', 'aws',
      'openai', 'anthropic', 'google', 'microsoft',
    ];

    const toolkits: ToolkitInfo[] = [];
    
    for (const slug of knownToolkits) {
      const info = await this.getToolkitInfo(slug);
      if (info) {
        toolkits.push(info);
      }
    }

    return toolkits;
  }

  /**
   * Search toolkits
   * 
   * @param query - Search query
   * @returns Array of matching toolkit info
   */
  async searchToolkits(query: string): Promise<ToolkitInfo[]> {
    const allToolkits = await this.listToolkits();
    const queryLower = query.toLowerCase();

    return allToolkits.filter(toolkit =>
      toolkit.slug.toLowerCase().includes(queryLower) ||
      toolkit.name.toLowerCase().includes(queryLower) ||
      toolkit.description.toLowerCase().includes(queryLower) ||
      toolkit.categories.some(cat => cat.toLowerCase().includes(queryLower))
    );
  }

  /**
   * Get toolkits by category
   * 
   * @param category - Category name
   * @returns Array of toolkit info
   */
  async getToolkitsByCategory(category: string): Promise<ToolkitInfo[]> {
    const allToolkits = await this.listToolkits();
    return allToolkits.filter(toolkit =>
      toolkit.categories.includes(category)
    );
  }

  /**
   * Clear toolkit cache
   */
  clearCache(): void {
    this.toolkitCache.clear();
  }

  /**
   * Get toolkit statistics
   */
  getStats(): {
    totalEnabled: number;
    totalDisabled: number;
    enabledList: string[];
    disabledList: string[];
  } {
    return {
      totalEnabled: this.enabledToolkits.size,
      totalDisabled: this.disabledToolkits.size,
      enabledList: Array.from(this.enabledToolkits),
      disabledList: Array.from(this.disabledToolkits),
    };
  }
}

// Singleton instance
export const toolkitManager = new ComposioToolkitManager();

/**
 * Create toolkit manager
 * 
 * @param defaultToolkits - Default toolkits to enable
 * @returns Toolkit manager
 */
export function createToolkitManager(defaultToolkits?: string[]): ComposioToolkitManager {
  return new ComposioToolkitManager(defaultToolkits);
}

/**
 * Get available tools for user based on enabled toolkits
 * 
 * @param userId - User ID
 * @param toolkitManager - Toolkit manager
 * @returns Array of available tool names
 */
export async function getAvailableTools(
  userId: string,
  toolkitManager: ComposioToolkitManager
): Promise<string[]> {
  const enabledToolkits = toolkitManager.getEnabledToolkits();
  const tools: string[] = [];

  // In production, this would fetch from Composio API
  // For now, return mock tool names
  for (const toolkit of enabledToolkits) {
    tools.push(`${toolkit}_tool_1`);
    tools.push(`${toolkit}_tool_2`);
  }

  return tools;
}
