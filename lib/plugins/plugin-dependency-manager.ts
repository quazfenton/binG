/**
 * Plugin Dependency Management System
 * Handles plugin dependencies, compatibility checking, and versioning
 */

export interface PluginDependency {
  pluginId: string;
  version: string;
  optional: boolean;
  fallback?: string; // Fallback plugin ID if dependency is missing
}

export interface PluginVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export interface DependencyStatus {
  pluginId: string;
  required: boolean;
  available: boolean;
  version?: string;
  compatibleVersion: boolean;
  fallbackAvailable: boolean;
  fallbackId?: string;
}

export interface PluginCompatibility {
  compatible: boolean;
  missingDependencies: string[];
  incompatibleVersions: string[];
  availableFallbacks: string[];
  warnings: string[];
}

export class PluginDependencyManager {
  private registeredPlugins = new Map<string, any>();
  private dependencyGraph = new Map<string, PluginDependency[]>();
  private versionCache = new Map<string, PluginVersion>();
  private fallbackMap = new Map<string, string[]>();

  /**
   * Register a plugin with its dependencies
   */
  registerPlugin(plugin: any): void {
    this.registeredPlugins.set(plugin.id, plugin);
    
    if (plugin.dependencies) {
      this.dependencyGraph.set(plugin.id, plugin.dependencies);
    }

    // Cache version information
    if (plugin.version) {
      this.versionCache.set(plugin.id, this.parseVersion(plugin.version));
    }

    // Register fallback mappings
    if (plugin.dependencies) {
      plugin.dependencies.forEach((dep: PluginDependency) => {
        if (dep.fallback) {
          const fallbacks = this.fallbackMap.get(dep.pluginId) || [];
          fallbacks.push(dep.fallback);
          this.fallbackMap.set(dep.pluginId, fallbacks);
        }
      });
    }
  }

  /**
   * Check if a plugin can be loaded based on its dependencies
   */
  async checkDependencies(pluginId: string): Promise<PluginCompatibility> {
    const plugin = this.registeredPlugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const dependencies = this.dependencyGraph.get(pluginId) || [];
    const missingDependencies: string[] = [];
    const incompatibleVersions: string[] = [];
    const availableFallbacks: string[] = [];
    const warnings: string[] = [];

    for (const dep of dependencies) {
      const status = await this.checkDependency(dep);
      
      if (!status.available && !dep.optional) {
        if (status.fallbackAvailable && status.fallbackId) {
          availableFallbacks.push(status.fallbackId);
          warnings.push(`Using fallback ${status.fallbackId} for missing dependency ${dep.pluginId}`);
        } else {
          missingDependencies.push(dep.pluginId);
        }
      } else if (status.available && !status.compatibleVersion) {
        incompatibleVersions.push(`${dep.pluginId}@${dep.version}`);
      } else if (!status.available && dep.optional) {
        warnings.push(`Optional dependency ${dep.pluginId} is not available`);
      }
    }

    return {
      compatible: missingDependencies.length === 0 && incompatibleVersions.length === 0,
      missingDependencies,
      incompatibleVersions,
      availableFallbacks,
      warnings
    };
  }

  /**
   * Check a single dependency
   */
  private async checkDependency(dependency: PluginDependency): Promise<DependencyStatus> {
    const depPlugin = this.registeredPlugins.get(dependency.pluginId);
    const available = !!depPlugin;
    let compatibleVersion = false;
    let fallbackAvailable = false;
    let fallbackId: string | undefined;

    if (available && depPlugin.version) {
      compatibleVersion = this.isVersionCompatible(depPlugin.version, dependency.version);
    }

    // Check for fallbacks if dependency is not available or incompatible
    if (!available || !compatibleVersion) {
      if (dependency.fallback) {
        const fallbackPlugin = this.registeredPlugins.get(dependency.fallback);
        if (fallbackPlugin) {
          fallbackAvailable = true;
          fallbackId = dependency.fallback;
        }
      }

      // Check registered fallbacks
      const fallbacks = this.fallbackMap.get(dependency.pluginId) || [];
      for (const fallback of fallbacks) {
        const fallbackPlugin = this.registeredPlugins.get(fallback);
        if (fallbackPlugin) {
          fallbackAvailable = true;
          fallbackId = fallback;
          break;
        }
      }
    }

    return {
      pluginId: dependency.pluginId,
      required: !dependency.optional,
      available,
      version: depPlugin?.version,
      compatibleVersion,
      fallbackAvailable,
      fallbackId
    };
  }

  /**
   * Resolve dependencies for a plugin, including fallbacks
   */
  async resolveDependencies(pluginId: string): Promise<{
    resolved: string[];
    fallbacks: { [key: string]: string };
    warnings: string[];
  }> {
    const compatibility = await this.checkDependencies(pluginId);
    const resolved: string[] = [];
    const fallbacks: { [key: string]: string } = {};
    const warnings: string[] = [...compatibility.warnings];

    const dependencies = this.dependencyGraph.get(pluginId) || [];

    for (const dep of dependencies) {
      const status = await this.checkDependency(dep);

      if (status.available && status.compatibleVersion) {
        resolved.push(dep.pluginId);
      } else if (status.fallbackAvailable && status.fallbackId) {
        resolved.push(status.fallbackId);
        fallbacks[dep.pluginId] = status.fallbackId;
        warnings.push(`Using ${status.fallbackId} as fallback for ${dep.pluginId}`);
      } else if (!dep.optional) {
        throw new Error(`Required dependency ${dep.pluginId} cannot be resolved`);
      }
    }

    return { resolved, fallbacks, warnings };
  }

  /**
   * Get dependency tree for a plugin
   */
  getDependencyTree(pluginId: string): {
    plugin: string;
    dependencies: Array<{
      plugin: string;
      version: string;
      optional: boolean;
      status: 'available' | 'missing' | 'incompatible';
      fallback?: string;
    }>;
  } {
    const dependencies = this.dependencyGraph.get(pluginId) || [];
    
    return {
      plugin: pluginId,
      dependencies: dependencies.map(dep => {
        const depPlugin = this.registeredPlugins.get(dep.pluginId);
        let status: 'available' | 'missing' | 'incompatible' = 'missing';
        
        if (depPlugin) {
          if (this.isVersionCompatible(depPlugin.version, dep.version)) {
            status = 'available';
          } else {
            status = 'incompatible';
          }
        }

        return {
          plugin: dep.pluginId,
          version: dep.version,
          optional: dep.optional,
          status,
          fallback: dep.fallback
        };
      })
    };
  }

  /**
   * Find plugins that depend on a given plugin
   */
  findDependents(pluginId: string): string[] {
    const dependents: string[] = [];

    for (const [plugin, dependencies] of this.dependencyGraph.entries()) {
      if (dependencies.some(dep => dep.pluginId === pluginId)) {
        dependents.push(plugin);
      }
    }

    return dependents;
  }

  /**
   * Check for circular dependencies
   */
  checkCircularDependencies(pluginId: string, visited = new Set<string>()): boolean {
    if (visited.has(pluginId)) {
      return true; // Circular dependency found
    }

    visited.add(pluginId);
    const dependencies = this.dependencyGraph.get(pluginId) || [];

    for (const dep of dependencies) {
      if (this.checkCircularDependencies(dep.pluginId, new Set(visited))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get load order for plugins based on dependencies
   */
  getLoadOrder(pluginIds: string[]): string[] {
    const loadOrder: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (pluginId: string) => {
      if (visiting.has(pluginId)) {
        throw new Error(`Circular dependency detected involving ${pluginId}`);
      }
      
      if (visited.has(pluginId)) {
        return;
      }

      visiting.add(pluginId);
      const dependencies = this.dependencyGraph.get(pluginId) || [];

      // Visit dependencies first
      for (const dep of dependencies) {
        if (!dep.optional && pluginIds.includes(dep.pluginId)) {
          visit(dep.pluginId);
        }
      }

      visiting.delete(pluginId);
      visited.add(pluginId);
      loadOrder.push(pluginId);
    };

    for (const pluginId of pluginIds) {
      if (!visited.has(pluginId)) {
        visit(pluginId);
      }
    }

    return loadOrder;
  }

  /**
   * Parse semantic version string
   */
  private parseVersion(versionString: string): PluginVersion {
    const match = versionString.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match) {
      throw new Error(`Invalid version format: ${versionString}`);
    }

    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[4]
    };
  }

  /**
   * Check if a version satisfies a requirement
   */
  private isVersionCompatible(availableVersion: string, requiredVersion: string): boolean {
    try {
      const available = this.parseVersion(availableVersion);
      const required = this.parseVersion(requiredVersion);

      // Simple compatibility check: major version must match, minor/patch can be higher
      if (available.major !== required.major) {
        return false;
      }

      if (available.minor < required.minor) {
        return false;
      }

      if (available.minor === required.minor && available.patch < required.patch) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn(`Version compatibility check failed: ${error}`);
      return false;
    }
  }

  /**
   * Update plugin version and check compatibility
   */
  updatePluginVersion(pluginId: string, newVersion: string): {
    success: boolean;
    affectedPlugins: string[];
    warnings: string[];
  } {
    const plugin = this.registeredPlugins.get(pluginId);
    if (!plugin) {
      return {
        success: false,
        affectedPlugins: [],
        warnings: [`Plugin ${pluginId} not found`]
      };
    }

    const oldVersion = plugin.version;
    const dependents = this.findDependents(pluginId);
    const warnings: string[] = [];
    const affectedPlugins: string[] = [];

    // Check if update breaks any dependents
    for (const dependent of dependents) {
      const dependencies = this.dependencyGraph.get(dependent) || [];
      const dependency = dependencies.find(dep => dep.pluginId === pluginId);
      
      if (dependency && !this.isVersionCompatible(newVersion, dependency.version)) {
        affectedPlugins.push(dependent);
        warnings.push(`Update may break compatibility with ${dependent}`);
      }
    }

    // Update version
    plugin.version = newVersion;
    this.versionCache.set(pluginId, this.parseVersion(newVersion));

    return {
      success: true,
      affectedPlugins,
      warnings
    };
  }

  /**
   * Get plugin registry information
   */
  getRegistryInfo(): {
    totalPlugins: number;
    pluginsWithDependencies: number;
    totalDependencies: number;
    circularDependencies: string[];
  } {
    const totalPlugins = this.registeredPlugins.size;
    const pluginsWithDependencies = this.dependencyGraph.size;
    let totalDependencies = 0;
    const circularDependencies: string[] = [];

    for (const dependencies of this.dependencyGraph.values()) {
      totalDependencies += dependencies.length;
    }

    // Check for circular dependencies
    for (const pluginId of this.registeredPlugins.keys()) {
      if (this.checkCircularDependencies(pluginId)) {
        circularDependencies.push(pluginId);
      }
    }

    return {
      totalPlugins,
      pluginsWithDependencies,
      totalDependencies,
      circularDependencies
    };
  }

  /**
   * Clear all registered plugins and dependencies
   */
  clear(): void {
    this.registeredPlugins.clear();
    this.dependencyGraph.clear();
    this.versionCache.clear();
    this.fallbackMap.clear();
  }
}

// Global instance
export const pluginDependencyManager = new PluginDependencyManager();