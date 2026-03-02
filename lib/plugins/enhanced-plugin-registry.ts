/**
 * Enhanced Plugin Registry with Dependency Management
 */

import { EnhancedPlugin } from './enhanced-plugin-manager';
import { PluginDependency } from './plugin-dependency-manager';
import { pluginRegistry } from './plugin-registry';

// Convert basic plugins to enhanced plugins with dependency information
export const enhancedPluginRegistry: EnhancedPlugin[] = [
  {
    ...pluginRegistry.find(p => p.id === 'calculator')!,
    version: '1.0.0',
    dependencies: [], // No dependencies
  },
  {
    ...pluginRegistry.find(p => p.id === 'simple-calculator')!,
    version: '1.0.0',
    dependencies: [], // No dependencies
  },
  {
    ...pluginRegistry.find(p => p.id === 'code-formatter')!,
    version: '1.2.0',
    dependencies: [], // No dependencies for basic formatter
  },
  {
    ...pluginRegistry.find(p => p.id === 'note-taker')!,
    version: '2.1.0',
    dependencies: [], // No dependencies
  },
  {
    ...pluginRegistry.find(p => p.id === 'advanced-calculator')!,
    version: '2.0.0',
    dependencies: [
      {
        pluginId: 'calculator',
        version: '1.0.0',
        optional: false,
        fallback: 'simple-calculator'
      }
    ] as PluginDependency[],
  },
  // Example of a plugin with multiple dependencies
  {
    id: 'data-analyzer',
    name: 'Data Analyzer',
    version: '1.5.0',
    description: 'Analyze and visualize data with advanced tools',
    icon: pluginRegistry[0].icon, // Reusing icon for demo
    component: pluginRegistry[0].component, // Reusing component for demo
    category: 'data',
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
    maxSize: { width: 1200, height: 900 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 200,
      maxCpuPercent: 40,
      maxNetworkRequests: 20,
      maxStorageKB: 5120,
      timeoutMs: 30000
    },
    dependencies: [
      {
        pluginId: 'calculator',
        version: '1.0.0',
        optional: false,
        fallback: 'simple-calculator'
      },
      {
        pluginId: 'note-taker',
        version: '2.0.0',
        optional: true // Optional dependency
      },
      {
        pluginId: 'code-formatter',
        version: '1.0.0',
        optional: true
      }
    ] as PluginDependency[],
  },
  // Example of a plugin with version-specific dependencies
  {
    id: 'advanced-code-editor',
    name: 'Advanced Code Editor',
    version: '3.0.0',
    description: 'Full-featured code editor with syntax highlighting',
    icon: pluginRegistry[1].icon, // Reusing icon for demo
    component: pluginRegistry[1].component, // Reusing component for demo
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
      {
        pluginId: 'code-formatter',
        version: '1.2.0', // Requires specific version
        optional: false
      }
    ] as PluginDependency[],
  },
  // Example of a plugin that provides fallback functionality
  {
    id: 'basic-text-editor',
    name: 'Basic Text Editor',
    version: '1.0.0',
    description: 'Simple text editor for basic editing tasks',
    icon: pluginRegistry[2].icon, // Reusing icon for demo
    component: pluginRegistry[2].component, // Reusing component for demo
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
    dependencies: [], // No dependencies - can serve as fallback
  },
  // New utility plugins
  {
    ...pluginRegistry.find(p => p.id === 'json-validator')!,
    version: '1.0.0',
    dependencies: [], // No dependencies
  },
  {
    ...pluginRegistry.find(p => p.id === 'url-utilities')!,
    version: '1.0.0',
    dependencies: [], // No dependencies
  }
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
        const depPlugin = enhancedPluginRegistry.find(p => p.id === dep.pluginId);
        if (!depPlugin) {
          if (dep.optional) {
            warnings.push(`Optional dependency ${dep.pluginId} not found for plugin ${plugin.id}`);
          } else {
            errors.push(`Required dependency ${dep.pluginId} not found for plugin ${plugin.id}`);
          }
        }

        // Check fallback exists
        if (dep.fallback) {
          const fallbackPlugin = enhancedPluginRegistry.find(p => p.id === dep.fallback);
          if (!fallbackPlugin) {
            warnings.push(`Fallback plugin ${dep.fallback} not found for dependency ${dep.pluginId} in plugin ${plugin.id}`);
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