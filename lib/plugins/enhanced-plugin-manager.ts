/**
 * Enhanced Plugin Manager with Error Isolation and Resource Management
 */

import { 
  PluginIsolationManager, 
  PluginError, 
  PluginResourceLimits,
  PluginIsolationConfig,
  pluginIsolationManager 
} from './plugin-isolation';
import { 
  PluginDependencyManager, 
  PluginDependency,
  PluginCompatibility,
  pluginDependencyManager 
} from './plugin-dependency-manager';
import { 
  PluginPerformanceManager,
  pluginPerformanceManager 
} from './plugin-performance-manager';

export interface EnhancedPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: React.ComponentType<any>;
  component: React.ComponentType<any>;
  category: 'ai' | 'code' | 'data' | 'media' | 'utility' | 'design';
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maxSize?: { width: number; height: number };
  
  // Enhanced properties
  dependencies?: string[];
  resourceLimits?: Partial<PluginResourceLimits>;
  isolationConfig?: Partial<PluginIsolationConfig>;
  errorHandler?: (error: PluginError) => void;
  onLoad?: () => Promise<void>;
  onUnload?: () => Promise<void>;
}

export interface PluginInstance {
  id: string;
  pluginId: string;
  sandboxId: string;
  status: 'loading' | 'running' | 'paused' | 'error' | 'terminated';
  startTime: number;
  lastActivity: number;
  errorCount: number;
  restartCount: number;
}

export interface PluginExecutionContext {
  instanceId: string;
  pluginId: string;
  sandboxId: string;
  resourceLimits: PluginResourceLimits;
  startTime: number;
}

export class EnhancedPluginManager {
  private plugins = new Map<string, EnhancedPlugin>();
  private instances = new Map<string, PluginInstance>();
  private isolationManager: PluginIsolationManager;
  private dependencyManager: PluginDependencyManager;
  private performanceManager: PluginPerformanceManager;
  private errorCallbacks = new Map<string, (error: PluginError) => void>();

  constructor(
    isolationManager?: PluginIsolationManager,
    dependencyManager?: PluginDependencyManager,
    performanceManager?: PluginPerformanceManager
  ) {
    this.isolationManager = isolationManager || pluginIsolationManager;
    this.dependencyManager = dependencyManager || pluginDependencyManager;
    this.performanceManager = performanceManager || pluginPerformanceManager;
  }

  /**
   * Register a plugin with the manager
   */
  registerPlugin(plugin: EnhancedPlugin): void {
    // Validate plugin
    this.validatePlugin(plugin);
    
    // Register with dependency manager
    this.dependencyManager.registerPlugin(plugin);
    
    this.plugins.set(plugin.id, plugin);
    
    // Register error handler with isolation manager
    if (plugin.errorHandler) {
      this.isolationManager.registerErrorHandler(plugin.id, plugin.errorHandler);
    }
    
    // Register default error handler
    this.isolationManager.registerErrorHandler(plugin.id, (error) => {
      this.handlePluginError(plugin.id, error);
    });
  }

  /**
   * Validate plugin before registration
   */
  private validatePlugin(plugin: EnhancedPlugin): void {
    if (!plugin.id || !plugin.name || !plugin.component) {
      throw new Error('Plugin must have id, name, and component');
    }

    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin with id ${plugin.id} already registered`);
    }

    // Validate dependencies if specified
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          console.warn(`Plugin ${plugin.id} depends on ${dep} which is not registered`);
        }
      }
    }
  }

  /**
   * Load and create an instance of a plugin
   */
  async loadPlugin(
    pluginId: string, 
    initialData?: any
  ): Promise<string> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    // Check dependencies and resolve fallbacks
    const compatibility = await this.checkDependencies(plugin);
    const resolution = await this.dependencyManager.resolveDependencies(pluginId);
    
    // Log dependency resolution info
    if (resolution.warnings.length > 0) {
      console.warn(`Plugin ${pluginId} dependency warnings:`, resolution.warnings);
    }

    // Create sandbox
    const sandboxId = this.isolationManager.createSandbox(
      pluginId, 
      plugin.isolationConfig
    );

    // Create instance
    const instanceId = `instance_${pluginId}_${Date.now()}`;
    const instance: PluginInstance = {
      id: instanceId,
      pluginId,
      sandboxId,
      status: 'loading',
      startTime: Date.now(),
      lastActivity: Date.now(),
      errorCount: 0,
      restartCount: 0
    };

    this.instances.set(instanceId, instance);

    try {
      // Use lazy loading with performance tracking
      if (plugin.onLoad) {
        await this.performanceManager.lazyLoadPlugin(
          pluginId,
          async () => {
            await this.isolationManager.executeInSandbox(
              sandboxId,
              plugin.onLoad!
            );
            return true;
          }
        );
      }

      instance.status = 'running';
      instance.lastActivity = Date.now();

      // Update performance metrics
      this.performanceManager.updateMetrics(pluginId, {
        lastActivity: Date.now()
      });

      return instanceId;
    } catch (error) {
      instance.status = 'error';
      instance.errorCount++;
      
      const pluginError: PluginError = {
        id: `load_error_${Date.now()}`,
        pluginId,
        type: 'runtime',
        message: `Failed to load plugin: ${error instanceof Error ? error.message : 'Unknown error'}`,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: Date.now(),
        recoverable: true
      };

      await this.handlePluginError(pluginId, pluginError);
      throw error;
    }
  }

  /**
   * Execute plugin operation safely
   */
  async executePlugin<T>(
    instanceId: string,
    operation: () => Promise<T>,
    timeoutMs?: number
  ): Promise<T> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Plugin instance ${instanceId} not found`);
    }

    if (instance.status !== 'running') {
      throw new Error(`Plugin instance ${instanceId} is not running (status: ${instance.status})`);
    }

    const plugin = this.plugins.get(instance.pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${instance.pluginId} not found`);
    }

    try {
      const startTime = performance.now();
      
      const result = await this.isolationManager.executeInSandbox(
        instance.sandboxId,
        operation,
        timeoutMs
      );

      const executionTime = performance.now() - startTime;
      instance.lastActivity = Date.now();
      
      // Update performance metrics
      this.performanceManager.updateMetrics(instance.pluginId, {
        renderTime: executionTime,
        lastActivity: Date.now()
      });

      return result;
    } catch (error) {
      instance.errorCount++;
      instance.status = 'error';
      
      const pluginError: PluginError = {
        id: `exec_error_${Date.now()}`,
        pluginId: instance.pluginId,
        type: 'runtime',
        message: `Plugin execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: Date.now(),
        recoverable: true
      };

      await this.handlePluginError(instance.pluginId, pluginError);
      throw error;
    }
  }

  /**
   * Unload a plugin instance
   */
  async unloadPlugin(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return; // Already unloaded
    }

    const plugin = this.plugins.get(instance.pluginId);
    
    try {
      // Execute plugin unload hook in sandbox
      if (plugin?.onUnload) {
        await this.isolationManager.executeInSandbox(
          instance.sandboxId,
          plugin.onUnload
        );
      }
    } catch (error) {
      console.warn(`Error during plugin unload: ${error}`);
    } finally {
      // Clean up sandbox
      this.isolationManager.terminateSandbox(instance.sandboxId);
      
      // Remove instance
      this.instances.delete(instanceId);
    }
  }

  /**
   * Pause a plugin instance
   */
  pausePlugin(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance && instance.status === 'running') {
      instance.status = 'paused';
      this.isolationManager.pauseSandbox(instance.sandboxId);
    }
  }

  /**
   * Resume a paused plugin instance
   */
  resumePlugin(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance && instance.status === 'paused') {
      instance.status = 'running';
      instance.lastActivity = Date.now();
      this.isolationManager.resumeSandbox(instance.sandboxId);
    }
  }

  /**
   * Restart a failed plugin instance
   */
  async restartPlugin(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Plugin instance ${instanceId} not found`);
    }

    const plugin = this.plugins.get(instance.pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${instance.pluginId} not found`);
    }

    // Unload current instance
    await this.unloadPlugin(instanceId);

    // Create new instance
    const newInstanceId = await this.loadPlugin(instance.pluginId);
    
    // Update instance tracking
    const newInstance = this.instances.get(newInstanceId);
    if (newInstance) {
      newInstance.restartCount = instance.restartCount + 1;
      
      // Move the new instance to the old instance ID for consistency
      this.instances.delete(newInstanceId);
      this.instances.set(instanceId, {
        ...newInstance,
        id: instanceId
      });
    }
  }

  /**
   * Check plugin dependencies using dependency manager
   */
  private async checkDependencies(plugin: EnhancedPlugin): Promise<PluginCompatibility> {
    const compatibility = await this.dependencyManager.checkDependencies(plugin.id);
    
    if (!compatibility.compatible) {
      const errors: string[] = [];
      
      if (compatibility.missingDependencies.length > 0) {
        errors.push(`Missing dependencies: ${compatibility.missingDependencies.join(', ')}`);
      }
      
      if (compatibility.incompatibleVersions.length > 0) {
        errors.push(`Incompatible versions: ${compatibility.incompatibleVersions.join(', ')}`);
      }
      
      // Check if we can use fallbacks
      if (compatibility.availableFallbacks.length > 0) {
        console.warn(`Plugin ${plugin.id} using fallbacks: ${compatibility.availableFallbacks.join(', ')}`);
      } else if (errors.length > 0) {
        throw new Error(`Dependency issues for plugin ${plugin.id}: ${errors.join('; ')}`);
      }
    }
    
    // Log warnings
    compatibility.warnings.forEach(warning => {
      console.warn(`Plugin ${plugin.id}: ${warning}`);
    });
    
    return compatibility;
  }

  /**
   * Handle plugin errors with recovery strategies
   */
  private async handlePluginError(
    pluginId: string, 
    error: PluginError
  ): Promise<void> {
    console.error(`Plugin ${pluginId} error:`, error);

    // Find all instances of this plugin
    const instances = Array.from(this.instances.values())
      .filter(instance => instance.pluginId === pluginId);

    // Notify error callbacks
    const callback = this.errorCallbacks.get(pluginId);
    if (callback) {
      callback(error);
    }

    // Handle based on error type
    switch (error.type) {
      case 'resource':
        // Pause all instances to prevent further resource consumption
        for (const instance of instances) {
          this.pausePlugin(instance.id);
        }
        break;
        
      case 'timeout':
        // Restart instances if recoverable
        if (error.recoverable) {
          for (const instance of instances) {
            if (instance.restartCount < 3) {
              await this.restartPlugin(instance.id);
            } else {
              await this.unloadPlugin(instance.id);
            }
          }
        }
        break;
        
      case 'security':
        // Immediately terminate all instances
        for (const instance of instances) {
          await this.unloadPlugin(instance.id);
        }
        break;
        
      default:
        // Default recovery strategy
        if (error.recoverable) {
          for (const instance of instances) {
            if (instance.errorCount < 5 && instance.restartCount < 3) {
              await this.restartPlugin(instance.id);
            } else {
              await this.unloadPlugin(instance.id);
            }
          }
        }
    }
  }

  /**
   * Register error callback for a plugin
   */
  onPluginError(
    pluginId: string, 
    callback: (error: PluginError) => void
  ): void {
    this.errorCallbacks.set(pluginId, callback);
  }

  /**
   * Get plugin information
   */
  getPlugin(pluginId: string): EnhancedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): EnhancedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin instance information
   */
  getInstance(instanceId: string): PluginInstance | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * Get all instances for a plugin
   */
  getPluginInstances(pluginId: string): PluginInstance[] {
    return Array.from(this.instances.values())
      .filter(instance => instance.pluginId === pluginId);
  }

  /**
   * Get plugin health status
   */
  getPluginHealth(pluginId: string): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    instances: number;
    errors: number;
    restarts: number;
    resourceUsage: any;
  } {
    const instances = this.getPluginInstances(pluginId);
    const totalErrors = instances.reduce((sum, inst) => sum + inst.errorCount, 0);
    const totalRestarts = instances.reduce((sum, inst) => sum + inst.restartCount, 0);
    const runningInstances = instances.filter(inst => inst.status === 'running').length;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (totalErrors > 10 || totalRestarts > 5 || runningInstances === 0) {
      status = 'unhealthy';
    } else if (totalErrors > 3 || totalRestarts > 2) {
      status = 'degraded';
    }

    // Get resource usage from sandboxes
    const resourceUsage = instances.map(instance => {
      const sandbox = this.isolationManager.getSandboxInfo(instance.sandboxId);
      return sandbox?.resourceUsage;
    }).filter(Boolean);

    return {
      status,
      instances: instances.length,
      errors: totalErrors,
      restarts: totalRestarts,
      resourceUsage
    };
  }

  /**
   * Get plugin dependency information
   */
  getPluginDependencies(pluginId: string): {
    dependencies: PluginDependency[];
    dependents: string[];
    tree: any;
    compatibility: Promise<PluginCompatibility>;
  } {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    return {
      dependencies: plugin.dependencies || [],
      dependents: this.dependencyManager.findDependents(pluginId),
      tree: this.dependencyManager.getDependencyTree(pluginId),
      compatibility: this.dependencyManager.checkDependencies(pluginId)
    };
  }

  /**
   * Get optimal load order for multiple plugins
   */
  getLoadOrder(pluginIds: string[]): string[] {
    return this.dependencyManager.getLoadOrder(pluginIds);
  }

  /**
   * Update plugin version and check compatibility
   */
  updatePluginVersion(pluginId: string, newVersion: string): {
    success: boolean;
    affectedPlugins: string[];
    warnings: string[];
  } {
    const result = this.dependencyManager.updatePluginVersion(pluginId, newVersion);
    
    if (result.success) {
      const plugin = this.plugins.get(pluginId);
      if (plugin) {
        plugin.version = newVersion;
      }
    }
    
    return result;
  }

  /**
   * Check for circular dependencies
   */
  checkCircularDependencies(pluginId: string): boolean {
    return this.dependencyManager.checkCircularDependencies(pluginId);
  }

  /**
   * Get dependency registry information
   */
  getDependencyRegistryInfo(): {
    totalPlugins: number;
    pluginsWithDependencies: number;
    totalDependencies: number;
    circularDependencies: string[];
  } {
    return this.dependencyManager.getRegistryInfo();
  }

  /**
   * Load multiple plugins in dependency order
   */
  async loadPluginsInOrder(pluginIds: string[]): Promise<{
    loaded: string[];
    failed: { pluginId: string; error: string }[];
    instanceIds: string[];
  }> {
    const loadOrder = this.getLoadOrder(pluginIds);
    const loaded: string[] = [];
    const failed: { pluginId: string; error: string }[] = [];
    const instanceIds: string[] = [];

    for (const pluginId of loadOrder) {
      try {
        const instanceId = await this.loadPlugin(pluginId);
        loaded.push(pluginId);
        instanceIds.push(instanceId);
      } catch (error) {
        failed.push({
          pluginId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        // Stop loading if a required dependency fails
        const dependents = this.dependencyManager.findDependents(pluginId);
        const remainingPlugins = loadOrder.slice(loadOrder.indexOf(pluginId) + 1);
        
        for (const remaining of remainingPlugins) {
          if (dependents.includes(remaining)) {
            failed.push({
              pluginId: remaining,
              error: `Dependency ${pluginId} failed to load`
            });
          }
        }
        break;
      }
    }

    return { loaded, failed, instanceIds };
  }

  /**
   * Get plugin performance metrics
   */
  getPluginPerformanceMetrics(pluginId: string) {
    return this.performanceManager.getMetrics(pluginId);
  }

  /**
   * Optimize plugin performance
   */
  optimizePlugin(pluginId: string): string {
    return this.performanceManager.optimizePlugin(pluginId);
  }

  /**
   * Clear plugin cache
   */
  clearPluginCache(pluginId: string): void {
    this.performanceManager.clearPluginCache(pluginId);
  }

  /**
   * Get resource pool status
   */
  getResourcePoolStatus() {
    return this.performanceManager.getResourcePoolStatus();
  }

  /**
   * Get cache statistics
   */
  getCacheStatistics() {
    return this.performanceManager.getCacheStats();
  }

  /**
   * Get background tasks
   */
  getBackgroundTasks() {
    return this.performanceManager.getBackgroundTasks();
  }

  /**
   * Preload plugin for better performance
   */
  async preloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    // Schedule preload task
    this.performanceManager.scheduleBackgroundTask({
      pluginId,
      type: 'preload',
      priority: 'low'
    });
  }

  /**
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    // Unload all instances
    const instanceIds = Array.from(this.instances.keys());
    await Promise.all(instanceIds.map(id => this.unloadPlugin(id)));

    // Clear callbacks
    this.errorCallbacks.clear();
    
    // Clean up managers
    this.isolationManager.cleanup();
    this.dependencyManager.clear();
    this.performanceManager.cleanup();
  }
}

// Global instance
export const enhancedPluginManager = new EnhancedPluginManager();