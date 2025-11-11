"use client";

/**
 * Tambo Components Registry
 * Define UI components that Tambo can dynamically render
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Example: Code Display Component
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
        <pre className="bg-muted p-4 rounded-lg overflow-x-auto">
          <code>{code}</code>
        </pre>
      </CardContent>
    </Card>
  );
}

// Example: Data Visualization Component
function DataCard({ title, value, description }: { title: string; value: string; description?: string }) {
  return (
    <Card className="my-2">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

// Example: Interactive Button List
function ActionList({ actions }: { actions: Array<{ label: string; action: string }> }) {
  return (
    <div className="flex flex-col gap-2 my-4">
      {actions.map((action, index) => (
        <Button
          key={index}
          variant="outline"
          className="w-full justify-start"
          onClick={() => console.log('Action:', action.action)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

// Example: Status Alert
function StatusAlert({ status, message }: { status: 'success' | 'error' | 'warning' | 'info'; message: string }) {
  return (
    <Alert className="my-4">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

// Example: File Tree Component
function FileTree({ files }: { files: Array<{ name: string; type: 'file' | 'folder' }> }) {
  return (
    <Card className="my-4">
      <CardHeader>
        <CardTitle className="text-sm">Files</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li key={index} className="flex items-center gap-2 text-sm">
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

// Register components for Tambo to use
export const tamboComponents = {
  CodeDisplay,
  DataCard,
  ActionList,
  StatusAlert,
  FileTree,
  // Add more custom components as needed
};

// Export types for TypeScript
export type TamboComponentName = keyof typeof tamboComponents;
