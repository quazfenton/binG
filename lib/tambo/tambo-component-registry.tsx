/**
 * Tambo Unified Component Registry
 * 
 * Single source of truth for all Tambo components
 * Consolidates:
 * - lib/tambo/components.tsx (registerTamboExamples)
 * - components/tambo/tambo-components.tsx (tamboComponents array)
 * 
 * Supports both generative and interactable components
 * 
 * @see https://tambo.ai/docs/concepts/generative-interfaces/generative-components
 * @see https://tambo.ai/docs/concepts/generative-interfaces/interactable-components
 */

'use client';

import React from 'react';
import { z } from 'zod';

/**
 * Tambo component definition
 */
export interface TamboComponent {
  name: string;
  description: string;
  component: React.ComponentType<any>;
  propsSchema: z.ZodSchema;
  type?: 'generative' | 'interactable';
}

/**
 * Interactable component wrapper props
 */
export interface InteractableComponentProps<T extends Record<string, any>> {
  componentId: string;
  initialProps: T;
  onUpdate?: (componentId: string, updates: Partial<T>) => void;
}

/**
 * Component registry singleton
 */
class TamboComponentRegistry {
  private components: Map<string, TamboComponent> = new Map();
  private interactableComponents = new Map<string, TamboComponent>();

  /**
   * Register a component
   */
  register(component: TamboComponent): void {
    if (this.components.has(component.name)) {
      console.warn(`[TamboComponentRegistry] Component "${component.name}" already registered, overwriting`);
    }
    this.components.set(component.name, component);
    
    if (component.type === 'interactable') {
      this.interactableComponents.set(component.name, component);
    }
  }

  /**
   * Register multiple components
   */
  registerMany(components: TamboComponent[]): void {
    for (const component of components) {
      this.register(component);
    }
  }

  /**
   * Get a component by name
   */
  get(name: string): TamboComponent | undefined {
    return this.components.get(name);
  }

  /**
   * Get all components
   */
  getAll(): TamboComponent[] {
    return Array.from(this.components.values());
  }

  /**
   * Get interactable components only
   */
  getInteractable(): TamboComponent[] {
    return Array.from(this.interactableComponents.values());
  }

  /**
   * Get components as array for TamboProvider
   */
  toArray(): Array<{
    name: string;
    description: string;
    component: React.ComponentType<any>;
    propsSchema: z.ZodSchema;
  }> {
    return this.getAll().map(component => ({
      name: component.name,
      description: component.description,
      component: component.component,
      propsSchema: component.propsSchema,
    }));
  }

  /**
   * Clear all components (for testing)
   */
  clear(): void {
    this.components.clear();
    this.interactableComponents.clear();
  }

  /**
   * Get component count
   */
  get count(): number {
    return this.components.size;
  }
}

// Singleton instance
export const tamboComponentRegistry = new TamboComponentRegistry();

/**
 * Create an interactable component wrapper
 * 
 * @see https://tambo.ai/docs/concepts/generative-interfaces/interactable-components
 */
export function withInteractable<T extends Record<string, any>>(
  Component: React.ComponentType<T>,
  config: {
    componentName: string;
    description: string;
    propsSchema: z.ZodSchema<T>;
  }
): TamboComponent & { WrappedComponent: React.ComponentType<T> } {
  const InteractableWrapper: React.FC<InteractableComponentProps<T>> = ({
    componentId,
    initialProps,
    onUpdate,
  }) => {
    const [props, setProps] = React.useState<T>(initialProps);

    const handleUpdate = React.useCallback(
      (updates: Partial<T>) => {
        setProps(prev => ({ ...prev, ...updates }));
        onUpdate?.(componentId, updates);
      },
      [componentId, onUpdate]
    );

    return (
      <Component
        {...props}
        onTaskUpdate={handleUpdate}
        onItemUpdate={handleUpdate}
      />
    );
  };

  InteractableWrapper.displayName = `Interactable(${config.componentName})`;

  const component: TamboComponent & { WrappedComponent: React.ComponentType<T> } = {
    name: config.componentName,
    description: config.description,
    component: InteractableWrapper,
    propsSchema: config.propsSchema,
    type: 'interactable',
    WrappedComponent: Component,
  };

  return component;
}

/**
 * Initialize default components
 */
export function initializeDefaultComponents(): void {
  if (tamboComponentRegistry.count > 0) {
    return; // Already initialized
  }

  // Import components dynamically to avoid SSR issues
  const registerDefaultComponents = async () => {
    try {
      const {
        Chart,
        DataTable,
        SummaryCard,
        TaskBoard,
        ShoppingCart,
        CodeDisplay,
        DataCard,
        ActionList,
        StatusAlert,
        FileTree,
        ProgressDisplay,
      } = await import('./tambo-default-components');

      tamboComponentRegistry.registerMany([
        // Generative components
        {
          name: 'Chart',
          description: 'Data visualization chart (bar, line, or pie)',
          component: Chart,
          propsSchema: z.object({
            data: z.array(z.object({
              name: z.string(),
              value: z.number(),
            })),
            type: z.enum(['line', 'bar', 'pie']).optional(),
            title: z.string().optional(),
          }),
          type: 'generative',
        },
        {
          name: 'DataTable',
          description: 'Display tabular data with columns',
          component: DataTable,
          propsSchema: z.object({
            columns: z.array(z.object({
              key: z.string(),
              label: z.string(),
            })),
            data: z.array(z.object({
              id: z.string(),
              name: z.string().optional(),
              value: z.union([z.string(), z.number(), z.boolean()]).optional(),
              label: z.string().optional(),
              status: z.string().optional(),
              type: z.string().optional(),
            })),
            title: z.string().optional(),
          }),
          type: 'generative',
        },
        {
          name: 'SummaryCard',
          description: 'Display summary metrics with optional change indicator',
          component: SummaryCard,
          propsSchema: z.object({
            title: z.string(),
            value: z.union([z.string(), z.number()]),
            change: z.object({
              value: z.number(),
              positive: z.boolean(),
            }).optional(),
            icon: z.any().optional(),
          }),
          type: 'generative',
        },
        {
          name: 'CodeDisplay',
          description: 'Display code with syntax highlighting',
          component: CodeDisplay,
          propsSchema: z.object({
            code: z.string(),
            language: z.string(),
          }),
          type: 'generative',
        },
        {
          name: 'DataCard',
          description: 'Display data card with title, value, and trend',
          component: DataCard,
          propsSchema: z.object({
            title: z.string(),
            value: z.string(),
            description: z.string().optional(),
            trend: z.enum(['up', 'down', 'neutral']).optional(),
          }),
          type: 'generative',
        },
        {
          name: 'StatusAlert',
          description: 'Display status alert (success, error, warning, info)',
          component: StatusAlert,
          propsSchema: z.object({
            status: z.enum(['success', 'error', 'warning', 'info']),
            message: z.string(),
            title: z.string().optional(),
          }),
          type: 'generative',
        },
        {
          name: 'ProgressDisplay',
          description: 'Display progress indicator (0-100%)',
          component: ProgressDisplay,
          propsSchema: z.object({
            progress: z.number().min(0).max(100),
            label: z.string().optional(),
          }),
          type: 'generative',
        },
        // Interactable components
        {
          name: 'TaskBoard',
          description: 'Interactive task board with todo, in-progress, and done columns',
          component: TaskBoard,
          propsSchema: z.object({
            tasks: z.array(z.object({
              id: z.string(),
              title: z.string(),
              status: z.enum(['todo', 'in-progress', 'done']),
              assignee: z.string().optional(),
            })),
            onTaskUpdate: z.function().args(z.string(), z.any()).optional(),
          }),
          type: 'interactable',
        },
        {
          name: 'ShoppingCart',
          description: 'Interactive shopping cart with quantity controls',
          component: ShoppingCart,
          propsSchema: z.object({
            items: z.array(z.object({
              id: z.string(),
              name: z.string(),
              price: z.number(),
              quantity: z.number(),
            })),
            onItemUpdate: z.function().args(z.string(), z.number()).optional(),
          }),
          type: 'interactable',
        },
        {
          name: 'ActionList',
          description: 'Interactive list of action buttons',
          component: ActionList,
          propsSchema: z.object({
            actions: z.array(z.object({
              label: z.string(),
              action: z.string(),
              variant: z.string().optional(),
            })),
          }),
          type: 'interactable',
        },
        {
          name: 'FileTree',
          description: 'Interactive file tree browser',
          component: FileTree,
          propsSchema: z.object({
            files: z.array(z.object({
              name: z.string(),
              type: z.enum(['file', 'folder']),
              path: z.string().optional(),
            })),
            onSelect: z.function().args(z.string()).optional(),
          }),
          type: 'interactable',
        },
      ]);

      console.log(`[TamboComponentRegistry] Initialized ${tamboComponentRegistry.count} default components`);
    } catch (error) {
      console.error('[TamboComponentRegistry] Failed to load default components:', error);
    }
  };

  // Trigger async registration
  registerDefaultComponents();
}

/**
 * Get the unified component registry
 */
export function getTamboComponentRegistry(): TamboComponentRegistry {
  if (tamboComponentRegistry.count === 0) {
    initializeDefaultComponents();
  }
  return tamboComponentRegistry;
}
