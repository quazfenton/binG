"use client";

/**
 * Tambo Tools Component
 * A component that displays available Tambo tools
 */

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Tool {
  name: string;
  description: string;
  category?: string;
}

interface TamboToolsProps {
  tools?: Tool[];
  onToolSelect?: (toolName: string) => void;
  selectedTool?: string;
}

export function TamboTools({ 
  tools = defaultTools, 
  onToolSelect,
  selectedTool 
}: TamboToolsProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = Array.from(new Set(tools.map(t => t.category || 'General')));

  const filteredTools = activeCategory
    ? tools.filter(t => (t.category || 'General') === activeCategory)
    : tools;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Tambo Tools</CardTitle>
        <CardDescription>
          Available tools for your workspace
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeCategory === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveCategory(null)}
          >
            All
          </Button>
          {categories.map(category => (
            <Button
              key={category}
              variant={activeCategory === category ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </Button>
          ))}
        </div>

        <ScrollArea className="h-[300px]">
          <div className="space-y-2">
            {filteredTools.map(tool => (
              <div
                key={tool.name}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedTool === tool.name
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted'
                }`}
                onClick={() => onToolSelect?.(tool.name)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{tool.name}</span>
                  {tool.category && (
                    <Badge variant="secondary" className="text-xs">
                      {tool.category}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-xs mt-1">
                  {tool.description}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

const defaultTools: Tool[] = [
  { name: 'format_code', description: 'Format code with proper indentation', category: 'Code' },
  { name: 'validate_input', description: 'Validate input against schema', category: 'Validation' },
  { name: 'calculate', description: 'Evaluate mathematical expressions', category: 'Math' },
  { name: 'search_docs', description: 'Search documentation', category: 'Search' },
  { name: 'get_file_info', description: 'Get file metadata', category: 'File' },
  { name: 'convert_units', description: 'Convert between units', category: 'Math' },
];
