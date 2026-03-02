/**
 * Tambo Component Examples
 *
 * Production-ready generative UI components for Tambo.
 * Includes both generative and interactable components.
 *
 * @see https://tambo.ai/docs
 * @see lib/tambo/react-hooks.ts
 */

'use client';

import React, { useState, useEffect } from 'react';
import { z } from 'zod';
import type { TamboComponent } from '@/lib/tambo/tambo-service';

// ===========================================
// Generative Components
// ===========================================

/**
 * Data visualization chart component
 * 
 * Props are streamed progressively from Tambo
 */
export function Chart({
  data,
  type = 'bar',
  title,
}: {
  data: Array<{ name: string; value: number }>;
  type?: 'line' | 'bar' | 'pie';
  title?: string;
}) {
  const maxValue = Math.max(...data.map(d => d.value), 1);

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      
      <div className="space-y-2">
        {data.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-24 text-sm text-gray-600 truncate">
              {item.name}
            </span>
            <div className="flex-1 bg-gray-200 rounded-full h-6">
              <div
                className="bg-blue-500 h-6 rounded-full transition-all duration-300"
                style={{ width: `${(item.value / maxValue) * 100}%` }}
              >
                <span className="px-2 text-xs text-white font-medium">
                  {item.value}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Data table component
 */
export function DataTable({
  columns,
  data,
  title,
}: {
  columns: Array<{ key: string; label: string }>;
  data: Record<string, any>[];
  title?: string;
}) {
  return (
    <div className="p-4 bg-white rounded-lg shadow overflow-x-auto">
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            {columns.map((col, index) => (
              <th
                key={index}
                className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {data.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((col, colIndex) => (
                <td key={colIndex} className="px-4 py-2 text-sm text-gray-900">
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Summary card component
 */
export function SummaryCard({
  title,
  value,
  change,
  icon,
}: {
  title: string;
  value: string | number;
  change?: { value: number; positive: boolean };
  icon?: React.ReactNode;
}) {
  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
      
      {change && (
        <div className="mt-4 flex items-center">
          <span
            className={`text-sm font-medium ${
              change.positive ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {change.positive ? '↑' : '↓'} {Math.abs(change.value)}%
          </span>
          <span className="ml-2 text-sm text-gray-500">vs last period</span>
        </div>
      )}
    </div>
  );
}

// ===========================================
// Interactable Components
// ===========================================

/**
 * Task board component (interactable)
 * 
 * Persists across conversations and updates by ID
 */
export function TaskBoard({
  tasks,
  onTaskUpdate,
}: {
  tasks: Array<{
    id: string;
    title: string;
    status: 'todo' | 'in-progress' | 'done';
    assignee?: string;
  }>;
  onTaskUpdate?: (taskId: string, updates: any) => void;
}) {
  const [localTasks, setLocalTasks] = useState(tasks);

  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  const updateTask = (taskId: string, updates: any) => {
    setLocalTasks(prev =>
      prev.map(task =>
        task.id === taskId ? { ...task, ...updates } : task
      )
    );
    onTaskUpdate?.(taskId, updates);
  };

  const columns = ['todo', 'in-progress', 'done'] as const;

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">Task Board</h3>
      
      <div className="grid grid-cols-3 gap-4">
        {columns.map(column => (
          <div key={column} className="space-y-2">
            <h4 className="font-medium text-gray-700 capitalize">
              {column.replace('-', ' ')}
            </h4>
            
            <div className="space-y-2">
              {localTasks
                .filter(task => task.status === column)
                .map(task => (
                  <div
                    key={task.id}
                    className="p-3 bg-gray-50 rounded border cursor-pointer hover:bg-gray-100"
                    onClick={() => {
                      const nextStatus =
                        column === 'todo'
                          ? 'in-progress'
                          : column === 'in-progress'
                          ? 'done'
                          : 'todo';
                      updateTask(task.id, { status: nextStatus });
                    }}
                  >
                    <p className="text-sm font-medium">{task.title}</p>
                    {task.assignee && (
                      <p className="text-xs text-gray-500 mt-1">
                        {task.assignee}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Shopping cart component (interactable)
 */
export function ShoppingCart({
  items,
  onItemUpdate,
}: {
  items: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  onItemUpdate?: (itemId: string, quantity: number) => void;
}) {
  const [localItems, setLocalItems] = useState(items);

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  const updateQuantity = (itemId: string, delta: number) => {
    setLocalItems(prev =>
      prev.map(item =>
        item.id === itemId
          ? { ...item, quantity: Math.max(0, item.quantity + delta) }
          : item
      )
    );
    
    const item = localItems.find(i => i.id === itemId);
    if (item) {
      onItemUpdate?.(itemId, item.quantity + delta);
    }
  };

  const total = localItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">Shopping Cart</h3>
      
      <div className="space-y-3">
        {localItems.map(item => (
          <div
            key={item.id}
            className="flex items-center justify-between p-3 bg-gray-50 rounded"
          >
            <div>
              <p className="font-medium">{item.name}</p>
              <p className="text-sm text-gray-500">
                ${item.price.toFixed(2)} × {item.quantity}
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateQuantity(item.id, -1)}
                className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
              >
                -
              </button>
              <span className="w-8 text-center">{item.quantity}</span>
              <button
                onClick={() => updateQuantity(item.id, 1)}
                className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-4 pt-4 border-t">
        <div className="flex items-center justify-between">
          <span className="font-medium">Total:</span>
          <span className="text-xl font-bold">${total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

// ===========================================
// Component Registration
// ===========================================

/**
 * Register all example components with Tambo
 *
 * @returns Array of registered components
 *
 * @example
 * ```tsx
 * import { registerTamboExamples } from '@/lib/tambo/components';
 *
 * const components = registerTamboExamples();
 *
 * <TamboProvider components={components}>
 *   <App />
 * </TamboProvider>
 * ```
 */
export function registerTamboExamples(): TamboComponent[] {
  return [
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
        data: z.array(z.record(z.any())),
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
        onTaskUpdate: z.function().optional(),
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
        onItemUpdate: z.function().optional(),
      }),
      type: 'interactable',
    },
  ];
}
