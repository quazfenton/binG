"use client";

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Package,
  Settings,
  Activity,
  History,
  AlertTriangle,
  CheckCircle,
  Copy,
  Download,
  Upload,
  RefreshCw,
  Save,
  Play,
  Trash2,
  Plus,
  Search,
  Filter,
  Info,
  HelpCircle,
  Share2,
  ExternalLink,
  XCircle
} from 'lucide-react';
import { Alert, AlertDescription } from '../ui/alert';
import { Progress } from '../ui/progress';
import { toast } from 'sonner';
import type { PluginProps } from './plugin-manager';
import BasePlugin, { BasePluginActions, BasePluginState } from './base-plugin';

// Define specific state and props for this plugin
interface MyPluginState extends BasePluginState {
  // Add plugin-specific state here
  inputValue: string;
  outputValue: string;
  selectedOption: string;
  items: string[];
  // Example of plugin-specific state
}

interface MyPluginProps extends PluginProps {
  // Add plugin-specific props here if needed
}

// Plugin-specific implementation
const MyPluginTemplate: React.FC<MyPluginProps> = ({
  onClose,
  onResult,
  initialData
}) => {
  const [state, setState] = useState<MyPluginState>({
    isLoading: false,
    isProcessing: false,
    hasError: false,
    errorMessage: undefined,
    history: [],
    settings: {},
    activeTab: 'main',
    lastOperation: null,
    inputValue: initialData?.inputValue || '',
    outputValue: initialData?.outputValue || '',
    selectedOption: initialData?.selectedOption || 'option1',
    items: initialData?.items || []
  });

  const actions: BasePluginActions = {
    executeOperation: async (operation: string, data?: any) => {
      setState(prev => ({ ...prev, isProcessing: true, hasError: false }));
      
      try {
        let result: any;
        
        switch(operation) {
          case 'process':
            // Example operation - replace with actual logic
            result = await processInput(state.inputValue, state.selectedOption);
            setState(prev => ({ ...prev, outputValue: result as string }));
            break;
          case 'add':
            const newItem = data?.text || 'New Item';
            setState(prev => ({
              ...prev,
              items: [...prev.items, newItem],
              inputValue: ''
            }));
            result = `Added item: ${newItem}`;
            break;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
        
        setState(prev => ({
          ...prev,
          isProcessing: false,
          hasError: false,
          lastOperation: operation
        }));
        
        onResult?.(result);
        
        // Add to history if enabled
        if (true) { // Assuming history is enabled
          addToHistory(operation, result, { data });
        }
        
        toast.success(`Operation ${operation} completed`);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setState(prev => ({
          ...prev,
          isProcessing: false,
          hasError: true,
          errorMessage: errorMsg
        }));
        
        toast.error(`Operation failed: ${errorMsg}`);
        throw error;
      }
    },
    
    addToHistory: (operation, result, metadata = {}) => {
      const item = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        operation,
        result,
        metadata
      };
      
      setState(prev => ({
        ...prev,
        history: [item, ...prev.history.slice(0, 49)] // Keep last 50 items
      }));
    },
    
    clearHistory: () => {
      setState(prev => ({ ...prev, history: [] }));
      toast.success('History cleared');
    },
    
    updateSettings: (newSettings) => {
      setState(prev => ({
        ...prev,
        settings: { ...prev.settings, ...newSettings }
      }));
      toast.success('Settings updated');
    },
    
    setError: (error) => {
      setState(prev => ({
        ...prev,
        hasError: true,
        errorMessage: error
      }));
    },
    
    clearError: () => {
      setState(prev => ({
        ...prev,
        hasError: false,
        errorMessage: undefined
      }));
    }
  };

  // Plugin-specific helper functions
  const processInput = async (input: string, option: string): Promise<string> => {
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    return `Processed: ${input} with option ${option}`;
  };

  const addToHistory = (operation: string, result: any, metadata?: Record<string, any>) => {
    const item = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      operation,
      result,
      metadata
    };
    
    setState(prev => ({
      ...prev,
      history: [item, ...prev.history.slice(0, 49)] // Keep last 50 items
    }));
  };

  const { 
    isLoading, 
    isProcessing, 
    hasError, 
    errorMessage, 
    inputValue, 
    outputValue, 
    selectedOption,
    items,
    history
  } = state;

  return (
    <div className="h-full flex flex-col bg-black text-white">
      {/* Header */}
      <CardHeader className="border-b border-white/10 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-400" />
            <CardTitle className="text-lg">My Plugin Template</CardTitle>
            <Badge variant="secondary">Template</Badge>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onClose}>
              <XCircle className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        {hasError && (
          <Alert className="mb-4 border-red-500/50 bg-red-500/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="main" className="h-full flex flex-col">
          <TabsList className="grid grid-cols-3 w-full mb-4">
            <TabsTrigger value="main">Main</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="main" className="flex-1 overflow-auto">
            <div className="space-y-4">
              {/* Input Section */}
              <Card className="bg-white/5">
                <CardHeader>
                  <CardTitle className="text-sm">Input</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    value={inputValue}
                    onChange={(e) => setState(prev => ({ ...prev, inputValue: e.target.value }))}
                    placeholder="Enter input here..."
                  />
                  
                  <Select value={selectedOption} onValueChange={(value) => setState(prev => ({ ...prev, selectedOption: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select option" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="option1">Option 1</SelectItem>
                      <SelectItem value="option2">Option 2</SelectItem>
                      <SelectItem value="option3">Option 3</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Button 
                    onClick={() => actions.executeOperation('process')}
                    disabled={isProcessing || !inputValue}
                    className="w-full"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Process
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Output Section */}
              {outputValue && (
                <Card className="bg-white/5">
                  <CardHeader>
                    <CardTitle className="text-sm">Output</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-sm whitespace-pre-wrap bg-black p-3 rounded">
                      {outputValue}
                    </pre>
                    <div className="flex gap-2 mt-2">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => navigator.clipboard.writeText(outputValue)}
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        Copy
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => toast.success('Downloaded')}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Items List */}
              <Card className="bg-white/5">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center justify-between">
                    Items
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => actions.executeOperation('add', { text: `Item ${items.length + 1}` })}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {items.map((item, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-black/30 rounded">
                        <span>{item}</span>
                        <Badge variant="outline">{index + 1}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <Card className="bg-white/5">
              <CardHeader>
                <CardTitle className="text-sm">General Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Setting 1</label>
                  <Input placeholder="Enter value" />
                </div>
                
                <div>
                  <label className="text-sm font-medium">Setting 2</label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select option" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="option1">Option 1</SelectItem>
                      <SelectItem value="option2">Option 2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <Button size="sm" className="w-full">
                  Save Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-medium">Operation History</h3>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={actions.clearHistory}
                disabled={history.length === 0}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Clear
              </Button>
            </div>

            {history.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No history yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((item) => (
                  <Card key={item.id} className="bg-white/5">
                    <CardContent className="p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium">{item.operation}</div>
                          <div className="text-sm text-gray-400">
                            {new Date(item.timestamp).toLocaleString()}
                          </div>
                        </div>
                        <Badge variant="outline">
                          {item.operation}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm font-mono bg-black p-2 rounded">
                        {typeof item.result === 'string' 
                          ? item.result 
                          : JSON.stringify(item.result, null, 2)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
};

export default MyPluginTemplate;