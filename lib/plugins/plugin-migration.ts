/**
 * Plugin Migration Utilities
 * Handles tab restructuring and plugin categorization
 */

export interface PluginTabConfig {
  id: string;
  name: string;
  plugins: string[];
  categories: string[];
}

export interface PluginMigrationConfig {
  sourceTab: string;
  targetTab: string;
  pluginIds: string[];
  preserveOrder?: boolean;
}

export class PluginMigrationService {
  private static instance: PluginMigrationService;
  private tabConfigs: Map<string, PluginTabConfig> = new Map();
  private migrationHistory: PluginMigrationConfig[] = [];

  private constructor() {
    this.initializeDefaultTabs();
  }

  public static getInstance(): PluginMigrationService {
    if (!PluginMigrationService.instance) {
      PluginMigrationService.instance = new PluginMigrationService();
    }
    return PluginMigrationService.instance;
  }

  private initializeDefaultTabs(): void {
    // Initialize default tab configurations
    this.tabConfigs.set('plugins', {
      id: 'plugins',
      name: 'Plugins',
      plugins: ['modular-tools'],
      categories: ['utility', 'code', 'data']
    });

    this.tabConfigs.set('extra', {
      id: 'extra',
      name: 'Extra',
      plugins: ['advanced-ai-plugins', 'sample-images'],
      categories: ['ai', 'media', 'design']
    });
  }

  /**
   * Move plugins from one tab to another
   */
  public movePluginsToTab(pluginIds: string[], targetTab: string): boolean {
    try {
      const targetConfig = this.tabConfigs.get(targetTab);
      if (!targetConfig) {
        console.error(`Target tab '${targetTab}' not found`);
        return false;
      }

      // Find source tabs and remove plugins
      for (const [tabId, config] of this.tabConfigs.entries()) {
        if (tabId !== targetTab) {
          config.plugins = config.plugins.filter(id => !pluginIds.includes(id));
        }
      }

      // Add plugins to target tab
      targetConfig.plugins.push(...pluginIds);

      // Record migration
      this.migrationHistory.push({
        sourceTab: 'multiple', // Could be from multiple tabs
        targetTab,
        pluginIds,
        preserveOrder: true
      });

      return true;
    } catch (error) {
      console.error('Error moving plugins to tab:', error);
      return false;
    }
  }

  /**
   * Rename a tab
   */
  public renameTab(oldName: string, newName: string): boolean {
    try {
      for (const [tabId, config] of this.tabConfigs.entries()) {
        if (config.name === oldName) {
          config.name = newName;
          return true;
        }
      }
      console.error(`Tab with name '${oldName}' not found`);
      return false;
    } catch (error) {
      console.error('Error renaming tab:', error);
      return false;
    }
  }

  /**
   * Validate tab structure integrity
   */
  public validateTabStructure(): boolean {
    try {
      // Check that all tabs have valid configurations
      for (const [tabId, config] of this.tabConfigs.entries()) {
        if (!config.id || !config.name || !Array.isArray(config.plugins)) {
          console.error(`Invalid configuration for tab '${tabId}'`);
          return false;
        }
      }

      // Check for duplicate plugin assignments
      const allPlugins = new Set<string>();
      for (const config of this.tabConfigs.values()) {
        for (const pluginId of config.plugins) {
          if (allPlugins.has(pluginId)) {
            console.warn(`Plugin '${pluginId}' is assigned to multiple tabs`);
          }
          allPlugins.add(pluginId);
        }
      }

      return true;
    } catch (error) {
      console.error('Error validating tab structure:', error);
      return false;
    }
  }

  /**
   * Get tab configuration
   */
  public getTabConfig(tabId: string): PluginTabConfig | undefined {
    return this.tabConfigs.get(tabId);
  }

  /**
   * Get all tab configurations
   */
  public getAllTabConfigs(): Map<string, PluginTabConfig> {
    return new Map(this.tabConfigs);
  }

  /**
   * Update tab configuration
   */
  public updateTabConfig(tabId: string, config: Partial<PluginTabConfig>): boolean {
    try {
      const existingConfig = this.tabConfigs.get(tabId);
      if (!existingConfig) {
        console.error(`Tab '${tabId}' not found`);
        return false;
      }

      this.tabConfigs.set(tabId, { ...existingConfig, ...config });
      return true;
    } catch (error) {
      console.error('Error updating tab configuration:', error);
      return false;
    }
  }

  /**
   * Get migration history
   */
  public getMigrationHistory(): PluginMigrationConfig[] {
    return [...this.migrationHistory];
  }

  /**
   * Clear migration history
   */
  public clearMigrationHistory(): void {
    this.migrationHistory = [];
  }

  /**
   * Rollback last migration
   */
  public rollbackLastMigration(): boolean {
    try {
      const lastMigration = this.migrationHistory.pop();
      if (!lastMigration) {
        console.warn('No migrations to rollback');
        return false;
      }

      // Move plugins back to source tab
      return this.movePluginsToTab(lastMigration.pluginIds, lastMigration.sourceTab);
    } catch (error) {
      console.error('Error rolling back migration:', error);
      return false;
    }
  }

  /**
   * Export configuration for persistence
   */
  public exportConfiguration(): string {
    return JSON.stringify({
      tabs: Object.fromEntries(this.tabConfigs),
      migrations: this.migrationHistory
    }, null, 2);
  }

  /**
   * Import configuration from persistence
   */
  public importConfiguration(configJson: string): boolean {
    try {
      const config = JSON.parse(configJson);
      
      if (config.tabs) {
        this.tabConfigs = new Map(Object.entries(config.tabs));
      }
      
      if (config.migrations) {
        this.migrationHistory = config.migrations;
      }

      return this.validateTabStructure();
    } catch (error) {
      console.error('Error importing configuration:', error);
      return false;
    }
  }
}

/**
 * Plugin categorization utilities
 */
export class PluginCategorizer {
  private static categoryMappings: Record<string, string[]> = {
    'ai': ['ai-enhancer', 'huggingface-spaces', 'advanced-ai-plugins'],
    'code': ['code-formatter', 'github-explorer'],
    'utility': ['calculator', 'note-taker', 'network-request-builder', 'legal-document', 'cloud-storage'],
    'design': ['interactive-diagramming'],
    'data': ['data-visualization-builder'],
    'media': ['interactive-storyboard', 'sample-images']
  };

  /**
   * Get category for a plugin
   */
  public static getCategoryForPlugin(pluginId: string): string | undefined {
    for (const [category, plugins] of Object.entries(this.categoryMappings)) {
      if (plugins.includes(pluginId)) {
        return category;
      }
    }
    return undefined;
  }

  /**
   * Get plugins in a category
   */
  public static getPluginsInCategory(category: string): string[] {
    return this.categoryMappings[category] || [];
  }

  /**
   * Add plugin to category
   */
  public static addPluginToCategory(pluginId: string, category: string): void {
    if (!this.categoryMappings[category]) {
      this.categoryMappings[category] = [];
    }
    
    // Remove from other categories first
    this.removePluginFromAllCategories(pluginId);
    
    // Add to new category
    this.categoryMappings[category].push(pluginId);
  }

  /**
   * Remove plugin from all categories
   */
  public static removePluginFromAllCategories(pluginId: string): void {
    for (const category of Object.keys(this.categoryMappings)) {
      this.categoryMappings[category] = this.categoryMappings[category].filter(
        id => id !== pluginId
      );
    }
  }

  /**
   * Get all categories
   */
  public static getAllCategories(): string[] {
    return Object.keys(this.categoryMappings);
  }
}

// Export singleton instance
export const pluginMigrationService = PluginMigrationService.getInstance();