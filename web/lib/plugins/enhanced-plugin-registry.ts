/**
 * Enhanced Plugin Registry with Dependency Management
 */

import { EnhancedPlugin } from './enhanced-plugin-manager';
import { PluginDependency } from './plugin-dependency-manager';
import { pluginRegistry } from './plugin-registry';

// Helper to create enhanced plugins from basic registry entries
function createEnhancedPlugin(baseId: string, version: string, deps: PluginDependency[] = [], options: Partial<EnhancedPlugin> = {}): EnhancedPlugin {
  const base = pluginRegistry.find(p => p.id === baseId);
  if (!base) throw new Error(`Plugin not found: ${baseId}`);
  return {
    ...base,
    ...options,
    version,
    dependencies: deps,
    defaultSize: options.defaultSize || { width: 320, height: 400 },
    minSize: options.minSize || { width: 280, height: 300 },
  } as EnhancedPlugin;
}

// Convert basic plugins to enhanced plugins with dependency information
export const enhancedPluginRegistry: EnhancedPlugin[] = [
  createEnhancedPlugin('calculator', '1.0.0', []),
  createEnhancedPlugin('simple-calculator', '1.0.0', []),
  createEnhancedPlugin('code-formatter', '1.2.0', [], { category: 'code', defaultSize: { width: 400, height: 300 }, minSize: { width: 300, height: 200 } }),
  createEnhancedPlugin('note-taker', '2.1.0', [], { defaultSize: { width: 350, height: 450 }, minSize: { width: 280, height: 350 } }),
  createEnhancedPlugin('advanced-calculator', '2.0.0', [
    { pluginId: 'calculator', version: '1.0.0', optional: false, fallback: 'simple-calculator' }
  ], { defaultSize: { width: 400, height: 500 }, minSize: { width: 320, height: 400 } }),
  {
    id: 'data-analyzer',
    name: 'Data Analyzer',
    version: '1.5.0',
    description: 'Analyze and visualize data with advanced tools',
    category: 'data',
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
    maxSize: { width: 1200, height: 900 },
    resourceLimits: {
      maxMemoryMB: 200,
      maxCpuPercent: 40,
      maxNetworkRequests: 20,
      maxStorageKB: 5120,
      timeoutMs: 30000
    },
    dependencies: [
      { pluginId: 'calculator', version: '1.0.0', optional: false, fallback: 'simple-calculator' },
      { pluginId: 'note-taker', version: '2.0.0', optional: true },
      { pluginId: 'code-formatter', version: '1.0.0', optional: true }
    ],
  },
  {
    id: 'advanced-code-editor',
    name: 'Advanced Code Editor',
    version: '3.0.0',
    description: 'Full-featured code editor with syntax highlighting',
    category: 'code',
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
    maxSize: { width: 1400, height: 1000 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 300,
      maxCpuPercent: 50,
      maxNetworkRequests: 15,
      maxStorageKB: 10240,
      timeoutMs: 45000
    },
    dependencies: [
      { pluginId: 'code-formatter', version: '1.2.0', optional: false }
    ],
  },
  {
    id: 'basic-text-editor',
    name: 'Basic Text Editor',
    version: '1.0.0',
    description: 'Simple text editor for basic editing tasks',
    category: 'utility',
    defaultSize: { width: 500, height: 400 },
    minSize: { width: 400, height: 300 },
    maxSize: { width: 700, height: 600 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 50,
      maxCpuPercent: 10,
      maxNetworkRequests: 0,
      maxStorageKB: 256,
      timeoutMs: 10000
    },
    dependencies: [],
  },
  createEnhancedPlugin('json-validator', '1.0.0', []),
  createEnhancedPlugin('url-utilities', '1.0.0', []),
];

// Dependency mapping for fallback resolution
export const dependencyFallbacks: { [key: string]: string[] } = {
  'calculator': ['simple-calculator'],
  'code-formatter': ['basic-text-editor'],
  'advanced-calculator': ['calculator', 'simple-calculator'],
  'advanced-code-editor': ['code-formatter', 'basic-text-editor'],
  'data-analyzer': ['calculator', 'note-taker']
};

// Plugin compatibility matrix
export const compatibilityMatrix: { [key: string]: { [key: string]: string[] } } = {
  'calculator': {
    '1.0.0': ['advanced-calculator@2.0.0', 'data-analyzer@1.5.0']
  },
  'code-formatter': {
    '1.2.0': ['advanced-code-editor@3.0.0'],
    '1.0.0': ['data-analyzer@1.5.0']
  },
  'note-taker': {
    '2.1.0': ['data-analyzer@1.5.0'],
    '2.0.0': ['data-analyzer@1.5.0']
  }
};

// Helper functions
export const getEnhancedPluginById = (id: string): EnhancedPlugin | undefined => {
  return enhancedPluginRegistry.find(plugin => plugin.id === id);
};

export const getPluginsByCategory = (category: string): EnhancedPlugin[] => {
  return enhancedPluginRegistry.filter(plugin => plugin.category === category);
};

export const getPluginsWithDependencies = (): EnhancedPlugin[] => {
  return enhancedPluginRegistry.filter(plugin => plugin.dependencies && plugin.dependencies.length > 0);
};

export const getPluginsWithoutDependencies = (): EnhancedPlugin[] => {
  return enhancedPluginRegistry.filter(plugin => !plugin.dependencies || plugin.dependencies.length === 0);
};

export const getFallbackPlugins = (pluginId: string): string[] => {
  return dependencyFallbacks[pluginId] || [];
};

export const getCompatiblePlugins = (pluginId: string, version: string): string[] => {
  return compatibilityMatrix[pluginId]?.[version] || [];
};

// Validation functions
export const validatePluginRegistry = (): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pluginIds = new Set<string>();

  // Check for duplicate IDs
  for (const plugin of enhancedPluginRegistry) {
    if (pluginIds.has(plugin.id)) {
      errors.push(`Duplicate plugin ID: ${plugin.id}`);
    }
    pluginIds.add(plugin.id);
  }

  // Check dependencies
  for (const plugin of enhancedPluginRegistry) {
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        const depId = typeof dep === 'string' ? dep : (dep as any).pluginId;
        const depOptional = typeof dep === 'string' ? false : (dep as any).optional;
        const depFallback = typeof dep === 'string' ? null : (dep as any).fallback;
        
        const depPlugin = enhancedPluginRegistry.find(p => p.id === depId);
        if (!depPlugin) {
          if (depOptional) {
            warnings.push(`Optional dependency ${depId} not found for plugin ${plugin.id}`);
          } else {
            errors.push(`Required dependency ${depId} not found for plugin ${plugin.id}`);
          }
        }

        // Check fallback exists
        if (depFallback) {
          const fallbackPlugin = enhancedPluginRegistry.find(p => p.id === depFallback);
          if (!fallbackPlugin) {
            warnings.push(`Fallback plugin ${depFallback} not found for dependency ${depId} in plugin ${plugin.id}`);
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

// Initialize and validate registry
const validation = validatePluginRegistry();
if (!validation.valid) {
  console.error('Plugin registry validation failed:', validation.errors);
}
if (validation.warnings.length > 0) {
  console.warn('Plugin registry warnings:', validation.warnings);
}
