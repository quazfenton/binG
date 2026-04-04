/**
 * Tambo Default Components
 * 
 * Shared component implementations used by both registries
 * Extracted to avoid duplication between lib/tambo/components.tsx
 * and components/tambo/tambo-components.tsx
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

/**
 * Code Display Component with syntax highlighting
 */
export function CodeDisplay({ code, language }: { code: string; language: string }) {
  return (
    <Card className="my-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Code</CardTitle>
          <Badge variant="outline">{language}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
          }}
        >
          {code}
        </SyntaxHighlighter>
      </CardContent>
    </Card>
  );
}

/**
 * Data Visualization Component
 */
export function DataCard({
  title,
  value,
  description,
  trend,
}: {
  title: string;
  value: string;
  description?: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <Card className="my-2">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <div className="text-3xl font-bold">{value}</div>
          {trend && (
            <Badge
              variant={trend === 'up' ? 'default' : trend === 'down' ? 'destructive' : 'secondary'}
            >
              {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Chart Component
 */
export function Chart({
  data,
  type = 'bar',
  title,
}: {
  data?: Array<{ name: string; value: number }>;
  type?: 'line' | 'bar' | 'pie';
  title?: string;
}) {
  if (!data || data.length === 0) {
    return (
      <Card className="my-4">
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">No data available</p>
        </CardContent>
      </Card>
    );
  }

  const maxValue = Math.max(...data.map(d => d.value), 1);

  return (
    <Card className="my-4">
      <CardHeader>
        <CardTitle className="text-lg">{title || 'Chart'}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-24 text-sm text-muted-foreground truncate">
                {item.name}
              </span>
              <div className="flex-1 bg-muted rounded-full h-6">
                <div
                  className="bg-primary h-6 rounded-full transition-all duration-300"
                  style={{ width: `${(item.value / maxValue) * 100}%` }}
                >
                  <span className="px-2 text-xs text-primary-foreground font-medium">
                    {item.value}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Data Table Component
 */
export function DataTable({
  columns,
  data,
  title,
}: {
  columns?: Array<{ key: string; label: string }>;
  data?: Record<string, any>[];
  title?: string;
}) {
  if (!columns || !data || columns.length === 0 || data.length === 0) {
    return (
      <Card className="my-4">
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">No data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="my-4">
      <CardHeader>
        <CardTitle className="text-lg">{title || 'Data Table'}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead>
              <tr>
                {columns.map((col, index) => (
                  <th
                    key={index}
                    className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((col, colIndex) => (
                    <td key={colIndex} className="px-4 py-2 text-sm">
                      {row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Summary Card Component
 */
export function SummaryCard({
  title,
  value,
  change,
  icon,
}: {
  title?: string;
  value?: string | number;
  change?: { value: number; positive: boolean };
  icon?: React.ReactNode;
}) {
  return (
    <Card className="my-4">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            {title && <p className="text-sm text-muted-foreground">{title}</p>}
            <p className="text-2xl font-bold mt-1">{value || '—'}</p>
          </div>
          {icon && <div className="text-muted-foreground">{icon}</div>}
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
            <span className="ml-2 text-sm text-muted-foreground">vs last period</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Task Board Component (Interactable)
 */
export function TaskBoard({
  tasks,
  onTaskUpdate,
}: {
  tasks?: Array<{
    id: string;
    title: string;
    status: 'todo' | 'in-progress' | 'done';
    assignee?: string;
  }>;
  onTaskUpdate?: (taskId: string, updates: any) => void;
}) {
  const [localTasks, setLocalTasks] = useState(tasks || []);

  useEffect(() => {
    if (tasks) {
      setLocalTasks(tasks);
    }
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

  if (!localTasks || localTasks.length === 0) {
    return (
      <Card className="my-4">
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">No tasks available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="my-4">
      <CardHeader>
        <CardTitle className="text-lg">Task Board</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {columns.map(column => (
            <div key={column} className="space-y-2">
              <h4 className="font-medium text-muted-foreground capitalize">
                {column.replace('-', ' ')}
              </h4>
              <div className="space-y-2 min-h-[100px] bg-muted/50 rounded-lg p-2">
                {localTasks
                  .filter(task => task.status === column)
                  .map(task => (
                    <div
                      key={task.id}
                      className="p-3 bg-background rounded border cursor-pointer hover:bg-accent transition-colors"
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
                        <p className="text-xs text-muted-foreground mt-1">
                          {task.assignee}
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Shopping Cart Component (Interactable)
 */
export function ShoppingCart({
  items,
  onItemUpdate,
}: {
  items?: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  onItemUpdate?: (itemId: string, quantity: number) => void;
}) {
  const [localItems, setLocalItems] = useState(items || []);

  useEffect(() => {
    if (items) {
      setLocalItems(items);
    }
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

  if (!localItems || localItems.length === 0) {
    return (
      <Card className="my-4">
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">Cart is empty</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="my-4">
      <CardHeader>
        <CardTitle className="text-lg">Shopping Cart</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {localItems.map(item => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 bg-muted rounded-lg"
            >
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-sm text-muted-foreground">
                  ${item.price.toFixed(2)} × {item.quantity}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => updateQuantity(item.id, -1)}
                  disabled={item.quantity <= 0}
                >
                  -
                </Button>
                <span className="w-8 text-center">{item.quantity}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => updateQuantity(item.id, 1)}
                >
                  +
                </Button>
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
      </CardContent>
    </Card>
  );
}

/**
 * Action List Component (Interactable)
 */
export function ActionList({
  actions,
}: {
  actions?: Array<{
    label: string;
    action: string;
    variant?: string;
  }>;
}) {
  if (!actions || actions.length === 0) {
    return (
      <Card className="my-4">
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">No actions available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2 my-4">
      {actions.map((action, index) => (
        <Button
          key={index}
          variant={(action.variant as any) || 'outline'}
          className="w-full justify-start"
          onClick={() => {
            console.log('Action:', action.action);
            // In a real implementation, this would trigger the action
          }}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Status Alert Component
 */
export function StatusAlert({
  status,
  message,
  title,
}: {
  status?: 'success' | 'error' | 'warning' | 'info';
  message?: string;
  title?: string;
}) {
  const variantMap: Record<string, any> = {
    success: 'default',
    error: 'destructive',
    warning: 'warning',
    info: 'info',
  };

  return (
    <Alert variant={variantMap[status || 'info']} className="my-4">
      {title && <CardTitle className="text-sm mb-1">{title}</CardTitle>}
      <AlertDescription>{message || 'No message provided'}</AlertDescription>
    </Alert>
  );
}

/**
 * File Tree Component (Interactable)
 */
export function FileTree({
  files,
  onSelect,
}: {
  files?: Array<{
    name: string;
    type: 'file' | 'folder';
    path?: string;
  }>;
  onSelect?: (path: string) => void;
}) {
  if (!files || files.length === 0) {
    return (
      <Card className="my-4">
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">No files available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="my-4">
      <CardHeader>
        <CardTitle className="text-sm">Files</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li
              key={index}
              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent p-1 rounded transition-colors"
              onClick={() => file.path && onSelect?.(file.path)}
            >
              <span className="text-muted-foreground">
                {file.type === 'folder' ? '📁' : '📄'}
              </span>
              {file.name}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Progress Display Component
 */
export function ProgressDisplay({
  progress,
  label,
}: {
  progress?: number;
  label?: string;
}) {
  const safeProgress = Math.min(100, Math.max(0, progress || 0));

  return (
    <Card className="my-4">
      <CardContent className="pt-6">
        {label && <div className="text-sm text-muted-foreground mb-2">{label}</div>}
        <div className="w-full bg-muted rounded-full h-2.5">
          <div
            className="bg-primary h-2.5 rounded-full transition-all"
            style={{ width: `${safeProgress}%` }}
          />
        </div>
        <div className="text-xs text-muted-foreground mt-1">{safeProgress.toFixed(0)}%</div>
      </CardContent>
    </Card>
  );
}
