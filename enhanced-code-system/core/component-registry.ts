/**
 * Component Registry for Enhanced Code System
 * 
 * Provides a registry for modular, reusable components that can be integrated
 * across different mini-services and applications.
 */

import { EventEmitter } from 'events';
import { SystemError, ERROR_CODES } from './error-types';

export interface ComponentMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  dependencies: string[];
  category: 'prompt' | 'streaming' | 'agentic' | 'file-management' | 'orchestration' | 'validation' | 'diff';
  author: string;
  license: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ComponentInterface {
  id: string;
  metadata: ComponentMetadata;
  initialize(): Promise<void>;
  execute<T>(input: any): Promise<T>;
  validate?(input: any): boolean;
  cleanup?(): Promise<void>;
  getHealth?(): { status: 'healthy' | 'degraded' | 'unhealthy'; metrics?: any };
}

export interface ComponentConfig {
  [key: string]: any;
}

export interface ComponentEvent {
  type: string;
  payload: any;
  timestamp: Date;
  source: string;
}

export class ComponentRegistry extends EventEmitter {
  private components: Map<string, ComponentInterface> = new Map();
  private metadata: Map<string, ComponentMetadata> = new Map();
  private dependencies: Map<string, string[]> = new Map();
  private initializationStatus: Map<string, 'pending' | 'initialized' | 'failed'> = new Map();
  
  constructor() {
    super();
  }

  /**
   * Register a component with the registry
   */
  async register(component: ComponentInterface, config?: ComponentConfig): Promise<boolean> {
    try {
      // Validate component interface
      if (!this.validateComponent(component)) {
        const error = new Error(`Component ${component.id} does not implement required interface`);
        this.emit('registration_failed', {
          componentId: component.id,
          error: error.message,
          timestamp: new Date()
        });
        return false;
      }

      // Check if component is already registered
      if (this.components.has(component.id)) {
        const error = new Error(`Component ${component.id} is already registered`);
        this.emit('registration_failed', {
          componentId: component.id,
          error: error.message,
          timestamp: new Date()
        });
        return false;
      }

      // Check dependency resolution
      const missingDeps = this.checkDependencies(component.metadata.dependencies);
      if (missingDeps.length > 0) {
        console.warn(`Component ${component.id} has missing dependencies: ${missingDeps.join(', ')}`);
        // Note: We don't fail registration, some components might have optional dependencies
      }

      // Set initialization status
      this.initializationStatus.set(component.id, 'pending');

      // Initialize component
      await component.initialize();

      // Register component
      this.components.set(component.id, component);
      this.metadata.set(component.id, component.metadata);
      this.dependencies.set(component.id, component.metadata.dependencies);
      this.initializationStatus.set(component.id, 'initialized');

      // Emit registration event
      this.emit('component_registered', {
        componentId: component.id,
        metadata: component.metadata,
        timestamp: new Date()
      });

      return true;
    } catch (error) {
      this.initializationStatus.set(component.id, 'failed');
      console.error(`Failed to register component ${component.id}:`, error);
      this.emit('registration_failed', {
        componentId: component.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      });
      return false;
    }
  }

  /**
   * Get a registered component
   */
  get(id: string): ComponentInterface | undefined {
    const component = this.components.get(id);
    if (!component) {
      return undefined;
    }

    // Check initialization status
    const status = this.initializationStatus.get(id);
    if (status !== 'initialized') {
      return undefined;
    }

    return component;
  }

  /**
   * Execute a component with input
   */
  async execute<T>(id: string, input: any): Promise<T> {
    const component = this.get(id);
    if (!component) {
      throw createOrchestratorError(`Component ${id} not found in registry or not properly initialized`, {
        code: ERROR_CODES.ORCHESTRATOR.COMPONENT_NOT_FOUND,
        severity: 'high',
        recoverable: false,
        context: { componentId: id }
      });
    }

    // Validate input if component has validation method
    if (component.validate && !component.validate(input)) {
      throw createOrchestratorError(`Invalid input for component ${id}`, {
        code: ERROR_CODES.ORCHESTRATOR.INVALID_INPUT,
        severity: 'high',
        recoverable: false,
        context: { componentId: id, input }
      });
    }

    try {
      const result = await component.execute<T>(input);
      this.emit('component_executed', {
        componentId: id,
        input,
        result: typeof result === 'string' && result.length > 100 ? 
          `${result.substring(0, 100)}...` : result,
        timestamp: new Date()
      });
      return result;
    } catch (error) {
      this.emit('component_execution_failed', {
        componentId: id,
        input,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      });
      throw error;
    }
  }

  /**
   * Validate component interface
   */
  private validateComponent(component: ComponentInterface): boolean {
    if (!component.id || !component.metadata || !component.initialize || !component.execute) {
      return false;
    }

    // Validate metadata
    const metadata = component.metadata;
    if (!metadata.id || !metadata.name || !metadata.version || !metadata.category) {
      return false;
    }

    // Validate category
    const validCategories: Array<ComponentMetadata['category']> = [
      'prompt', 'streaming', 'agentic', 'file-management', 'orchestration', 'validation', 'diff'
    ];
    if (!validCategories.includes(metadata.category)) {
      return false;
    }

    return true;
  }

  /**
   * Check for missing dependencies
   */
  private checkDependencies(dependencies: string[]): string[] {
    const missing: string[] = [];

    for (const dep of dependencies) {
      if (!this.components.has(dep) || this.initializationStatus.get(dep) !== 'initialized') {
        missing.push(dep);
      }
    }

    return missing;
  }

  /**
   * Get all components in the registry
   */
  getAll(): ComponentInterface[] {
    return Array.from(this.components.values()).filter(comp => 
      this.initializationStatus.get(comp.id) === 'initialized'
    );
  }

  /**
   * Get components by category
   */
  getByCategory(category: ComponentMetadata['category']): ComponentInterface[] {
    return this.getAll().filter(comp => comp.metadata.category === category);
  }

  /**
   * Unregister a component
   */
  async unregister(id: string): Promise<boolean> {
    const component = this.get(id);
    if (!component) {
      return false;
    }

    try {
      // Cleanup component if it has a cleanup method
      if (component.cleanup) {
        await component.cleanup();
      }

      // Remove from registry
      this.components.delete(id);
      this.metadata.delete(id);
      this.dependencies.delete(id);
      this.initializationStatus.delete(id);

      // Emit unregistration event
      this.emit('component_unregistered', {
        componentId: id,
        timestamp: new Date()
      });

      return true;
    } catch (error) {
      this.emit('unregistration_failed', {
        componentId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      });
      return false;
    }
  }

  /**
   * Get registry health
   */
  getHealth(): {
    totalComponents: number;
    initializedComponents: number;
    failedComponents: number;
    pendingComponents: number;
    categories: { [category: string]: number };
    components: Array<{ id: string; status: 'healthy' | 'degraded' | 'unhealthy'; health?: any }>;
  } {
    const allComponents = Array.from(this.components.values());
    const healthReport = {
      totalComponents: allComponents.length,
      initializedComponents: 0,
      failedComponents: 0,
      pendingComponents: 0,
      categories: {} as { [category: string]: number },
      components: [] as Array<{ id: string; status: 'healthy' | 'degraded' | 'unhealthy'; health?: any }>
    };

    // Count by initialization status
    for (const comp of allComponents) {
      const status = this.initializationStatus.get(comp.id);
      if (status === 'initialized') {
        healthReport.initializedComponents++;
      } else if (status === 'failed') {
        healthReport.failedComponents++;
      } else if (status === 'pending') {
        healthReport.pendingComponents++;
      }

      const category = comp.metadata.category;
      healthReport.categories[category] = (healthReport.categories[category] || 0) + 1;

      // Check component health
      let statusResult: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      let health: any;

      if (comp.getHealth) {
        try {
          health = comp.getHealth();
          statusResult = health.status;
        } catch (error) {
          statusResult = 'unhealthy';
          health = { error: error instanceof Error ? error.message : 'Health check failed' };
        }
      }

      healthReport.components.push({
        id: comp.id,
        status: statusResult,
        health
      });
    }

    return healthReport;
  }

  /**
   * Get component initialization status
   */
  getComponentStatus(id: string): 'not_registered' | 'pending' | 'initialized' | 'failed' {
    if (!this.components.has(id)) {
      return 'not_registered';
    }
    return this.initializationStatus.get(id) || 'not_registered';
  }

  /**
   * Wait for component initialization
   */
  async waitForComponentInitialization(id: string, timeoutMs: number = 10000): Promise<boolean> {
    if (this.getComponentStatus(id) === 'initialized') {
      return true;
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkStatus = () => {
        const status = this.getComponentStatus(id);
        if (status === 'initialized') {
          resolve(true);
        } else if (status === 'failed') {
          resolve(false);
        } else if (Date.now() - startTime > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(checkStatus, 100);
        }
      };

      checkStatus();
    });
  }
}

// Global registry instance
export const componentRegistry = new ComponentRegistry();