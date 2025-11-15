// Enhanced Plugin Registry with Dynamic Plugin Discovery
import { Plugin } from '../components/plugins/plugin-manager';
import { getPluginConfigById } from './plugin-registry';
import { loadPluginComponent } from './plugin-loader';

// Enhanced plugin metadata interface
interface EnhancedPluginMetadata {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<any>;
  category: 'ai' | 'code' | 'data' | 'media' | 'utility' | 'design';
  version: string;
  author: string;
  tags: string[];
  dependencies: string[];
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maxSize?: { width: number; height: number };
  isEnhanced: boolean;
  resourceLimits?: {
    maxMemoryMB?: number;
    maxCpuPercent?: number;
    maxNetworkRequests?: number;
    maxStorageKB?: number;
    timeoutMs?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Plugin registry class for managing plugins
class PluginRegistry {
  private plugins: Map<string, EnhancedPluginMetadata> = new Map();
  private pluginComponents: Map<string, React.ComponentType<any>> = new Map();

  constructor() {
    this.initializeDefaultPlugins();
  }

  // Initialize with default plugins
  private initializeDefaultPlugins() {
    // Using the configurations we defined earlier
    const defaultConfigs = [
      { id: 'calculator', name: 'Calculator', description: 'Basic calculator with history', category: 'utility', version: '1.0.0', author: 'System' },
      { id: 'json-validator', name: 'JSON Validator', description: 'Validate, format, and minify JSON', category: 'code', version: '1.0.0', author: 'System' },
      { id: 'code-formatter', name: 'Code Formatter', description: 'Format code in various languages', category: 'code', version: '1.0.0', author: 'System' },
      { id: 'ai-prompt-library', name: 'AI Prompt Library', description: 'Collection of AI prompts and workflows', category: 'ai', version: '1.0.0', author: 'System' },
      { id: 'api-playground', name: 'API Playground Pro', description: 'Test and explore APIs', category: 'utility', version: '1.0.0', author: 'System' },
      { id: 'ai-agent-orchestrator', name: 'AI Agent Orchestrator', description: 'Orchestrate multiple AI agents', category: 'ai', version: '1.0.0', author: 'System' },
      { id: 'ai-enhancer', name: 'AI Enhancer', description: 'Enhance content with AI', category: 'ai', version: '1.0.0', author: 'System' },
      { id: 'creative-studio', name: 'Creative Studio', description: 'Creative tools and utilities', category: 'media', version: '1.0.0', author: 'System' },
      { id: 'data-science-workbench', name: 'Data Science Workbench', description: 'Data analysis and visualization tools', category: 'data', version: '1.0.0', author: 'System' },
      { id: 'data-visualization', name: 'Data Visualization Builder', description: 'Create charts and visualizations', category: 'data', version: '1.0.0', author: 'System' },
      { id: 'devops-command-center', name: 'DevOps Command Center', description: 'DevOps tools and utilities', category: 'utility', version: '1.0.0', author: 'System' },
      { id: 'github-explorer', name: 'GitHub Explorer', description: 'Explore GitHub repositories', category: 'code', version: '1.0.0', author: 'System' },
      { id: 'github-explorer-advanced', name: 'GitHub Explorer Pro', description: 'Advanced GitHub exploration tools', category: 'code', version: '1.0.0', author: 'System' },
      { id: 'huggingface-spaces', name: 'Hugging Face Spaces', description: 'Run and explore Hugging Face models', category: 'ai', version: '1.0.0', author: 'System' },
      { id: 'huggingface-spaces-pro', name: 'Hugging Face Spaces Pro', description: 'Advanced Hugging Face model tools', category: 'ai', version: '1.0.0', author: 'System' },
      { id: 'hyperagent-scraper', name: 'HyperAgent Scraper', description: 'Advanced web scraping agent', category: 'utility', version: '1.0.0', author: 'System' },
      { id: 'interactive-diagramming', name: 'Interactive Diagramming', description: 'Create interactive diagrams', category: 'design', version: '1.0.0', author: 'System' },
      { id: 'interactive-storyboard', name: 'Interactive Storyboard', description: 'Create visual storyboards', category: 'design', version: '1.0.0', author: 'System' },
      { id: 'legal-document', name: 'Legal Document Assistant', description: 'Assist with legal document creation', category: 'utility', version: '1.0.0', author: 'System' },
      { id: 'mcp-connector', name: 'MCP Connector', description: 'Connect to Model Context Protocol services', category: 'utility', version: '1.0.0', author: 'System' },
      { id: 'network-request', name: 'Network Request Builder', description: 'Build and test network requests', category: 'utility', version: '1.0.0', author: 'System' },
      { id: 'note-taker', name: 'Note Taker', description: 'Take and organize notes', category: 'utility', version: '1.0.0', author: 'System' },
      { id: 'regex-pattern-lab', name: 'Regex Pattern Lab', description: 'Test and build regex patterns', category: 'code', version: '1.0.0', author: 'System' },
      { id: 'url-utilities', name: 'URL Utilities', description: 'URL manipulation and analysis tools', category: 'utility', version: '1.0.0', author: 'System' },
      { id: 'webhook-debugger', name: 'Webhook Debugger', description: 'Debug webhook requests', category: 'utility', version: '1.0.0', author: 'System' },
      { id: 'wiki-knowledge', name: 'Wiki Knowledge Base', description: 'Access and search knowledge bases', category: 'data', version: '1.0.0', author: 'System' }
    ];

    defaultConfigs.forEach(config => {
      this.registerPluginMetadata({
        ...config,
        icon: () => null, // Placeholder - will be replaced when component loads
        tags: [],
        dependencies: [],
        defaultSize: { width: 700, height: 600 },
        minSize: { width: 500, height: 400 },
        isEnhanced: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });
  }

  // Register plugin metadata
  registerPluginMetadata(metadata: EnhancedPluginMetadata): void {
    this.plugins.set(metadata.id, metadata);
  }

  // Load plugin component and update metadata accordingly
  async loadPluginComponent(pluginId: string): Promise<React.ComponentType<any> | null> {
    const component = await loadPluginComponent(pluginId);
    if (component) {
      this.pluginComponents.set(pluginId, component);
      
      // Update metadata with icon from component if available
      if (component && (component as any).icon) {
        const existingMetadata = this.plugins.get(pluginId);
        if (existingMetadata) {
          existingMetadata.icon = (component as any).icon;
        }
      }
    }
    return component;
  }

  // Get a complete plugin object with component
  async getPlugin(pluginId: string): Promise<Plugin | null> {
    const config = getPluginConfigById(pluginId);
    if (!config) return null;

    let component = this.pluginComponents.get(pluginId);
    if (!component) {
      component = await this.loadPluginComponent(pluginId);
      if (!component) return null;
    }

    return {
      ...config,
      component
    } as Plugin;
  }

  // Get all available plugins
  async getAllPlugins(): Promise<Plugin[]> {
    const configIds = Array.from(this.plugins.keys());
    const plugins = await Promise.all(
      configIds.map(id => this.getPlugin(id))
    );
    
    return plugins.filter((plugin): plugin is Plugin => plugin !== null);
  }

  // Get plugins by category
  async getPluginsByCategory(category: string): Promise<Plugin[]> {
    const allPlugins = await this.getAllPlugins();
    return allPlugins.filter(plugin => plugin.category === category);
  }

  // Get plugin metadata
  getPluginMetadata(pluginId: string): EnhancedPluginMetadata | undefined {
    return this.plugins.get(pluginId);
  }

  // Get all categories
  getCategories(): string[] {
    const categories = new Set<string>();
    this.plugins.forEach(plugin => {
      categories.add(plugin.category);
    });
    return Array.from(categories);
  }

  // Check if a plugin exists
  hasPlugin(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  // Update plugin metadata
  updatePluginMetadata(pluginId: string, metadata: Partial<EnhancedPluginMetadata>): boolean {
    const existing = this.plugins.get(pluginId);
    if (!existing) return false;

    this.plugins.set(pluginId, { ...existing, ...metadata, updatedAt: new Date() } as EnhancedPluginMetadata);
    return true;
  }

  // Get plugin statistics
  getPluginStats(): {
    total: number;
    byCategory: Record<string, number>;
    enhanced: number;
  } {
    const byCategory: Record<string, number> = {};
    let enhancedCount = 0;
    
    this.plugins.forEach(plugin => {
      byCategory[plugin.category] = (byCategory[plugin.category] || 0) + 1;
      if (plugin.isEnhanced) enhancedCount++;
    });
    
    return {
      total: this.plugins.size,
      byCategory,
      enhanced: enhancedCount
    };
  }

  // Search plugins by name or tags
  searchPlugins(query: string): EnhancedPluginMetadata[] {
    const searchQuery = query.toLowerCase();
    return Array.from(this.plugins.values()).filter(plugin => 
      plugin.name.toLowerCase().includes(searchQuery) ||
      plugin.description.toLowerCase().includes(searchQuery) ||
      plugin.tags.some(tag => tag.toLowerCase().includes(searchQuery))
    );
  }
}

// Global instance
export const enhancedPluginRegistry = new PluginRegistry();

// Utility functions for external use
export const {
  getPlugin,
  getAllPlugins,
  getPluginsByCategory,
  getPluginMetadata,
  getCategories,
  hasPlugin,
  searchPlugins,
  getPluginStats
} = enhancedPluginRegistry;

// Export the registry class itself for direct access if needed
export default enhancedPluginRegistry;