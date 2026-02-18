"use client";

/**
 * Tambo Components Registry
 * Define UI components that Tambo can dynamically render
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Code Display Component with syntax highlighting
function CodeDisplay({ code, language }: { code: string; language: string }) {
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

// Data Visualization Component
function DataCard({ title, value, description, trend }: { 
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
            <Badge variant={trend === 'up' ? 'default' : trend === 'down' ? 'destructive' : 'secondary'}>
              {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Interactive Button List
function ActionList({ actions }: { actions: Array<{ label: string; action: string; variant?: string }> }) {
  return (
    <div className="flex flex-col gap-2 my-4">
      {actions.map((action, index) => (
        <Button
          key={index}
          variant={(action.variant as any) || "outline"}
          className="w-full justify-start"
          onClick={() => console.log('Action:', action.action)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

// Status Alert
function StatusAlert({ status, message, title }: { 
  status: 'success' | 'error' | 'warning' | 'info'; 
  message: string;
  title?: string;
}) {
  const variantMap = {
    success: 'default',
    error: 'destructive',
    warning: 'warning',
    info: 'info',
  };

  return (
    <Alert variant={variantMap[status] as any} className="my-4">
      {title && <CardTitle className="text-sm mb-1">{title}</CardTitle>}
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

// File Tree Component
function FileTree({ files, onSelect }: { 
  files: Array<{ name: string; type: 'file' | 'folder'; path?: string }>;
  onSelect?: (path: string) => void;
}) {
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
              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted p-1 rounded"
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

// Progress Indicator
function ProgressDisplay({ progress, label }: { progress: number; label?: string }) {
  return (
    <Card className="my-4">
      <CardContent className="pt-6">
        {label && <div className="text-sm text-muted-foreground mb-2">{label}</div>}
        <div className="w-full bg-muted rounded-full h-2.5">
          <div 
            className="bg-primary h-2.5 rounded-full transition-all" 
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
        <div className="text-xs text-muted-foreground mt-1">{progress}%</div>
      </CardContent>
    </Card>
  );
}

// Register components for Tambo to use
export const tamboComponents = {
  CodeDisplay,
  DataCard,
  ActionList,
  StatusAlert,
  FileTree,
  ProgressDisplay,
  // Add more custom components as needed
};

// Export types for TypeScript
export type TamboComponentName = keyof typeof tamboComponents;
