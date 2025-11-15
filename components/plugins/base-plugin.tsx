"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Settings,
  Activity,
  History,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Copy,
  Download,
  Upload,
  RefreshCw,
  Save,
  Play,
  Pause,
  PlayCircle,
  PauseCircle,
  Trash2,
  Plus,
  Minus,
  Search,
  Filter,
  Info,
  HelpCircle,
  Share2,
  ExternalLink,
  Package,
  PackagePlus,
  PackageMinus
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Progress } from '../ui/progress';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { Slider } from '../ui/slider';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Checkbox } from '../ui/checkbox';
import { Skeleton } from '../ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { toast } from 'sonner';
import type { PluginProps } from './plugin-manager';

export interface BasePluginProps extends PluginProps {
  title: string;
  description?: string;
  icon?: React.ComponentType<any>;
  helpText?: string;
  defaultTab?: string;
  enableHistory?: boolean;
  enableSettings?: boolean;
  enableExport?: boolean;
  enableImport?: boolean;
}

export interface PluginHistoryItem {
  id: string;
  timestamp: number;
  operation: string;
  result: any;
  metadata?: Record<string, any>;
}

export interface PluginSettings {
  [key: string]: any;
}

export interface BasePluginState {
  isLoading: boolean;
  isProcessing: boolean;
  hasError: boolean;
  errorMessage?: string;
  history: PluginHistoryItem[];
  settings: PluginSettings;
  activeTab: string;
  lastOperation: string | null;
}

export interface BasePluginActions {
  executeOperation: (operation: string, data?: any) => Promise<any>;
  addToHistory: (operation: string, result: any, metadata?: Record<string, any>) => void;
  clearHistory: () => void;
  updateSettings: (newSettings: Partial<PluginSettings>) => void;
  setError: (error: string) => void;
  clearError: () => void;
}

export const BasePlugin: React.FC<BasePluginProps> = ({
  title,
  description = '',
  icon: IconComponent,
  helpText = '',
  defaultTab = 'main',
  enableHistory = true,
  enableSettings = false,
  enableExport = true,
  enableImport = true,
  onClose,
  onResult,
  initialData
}) => {
  const [state, setState] = useState<BasePluginState>({
    isLoading: false,
    isProcessing: false,
    hasError: false,
    errorMessage: undefined,
    history: [],
    settings: {},
    activeTab: defaultTab,
    lastOperation: null
  });

  // Initialize with initial data if provided
  useEffect(() => {
    if (initialData) {
      setState(prev => ({
        ...prev,
        ...initialData
      }));
    }
  }, [initialData]);

  const actions: BasePluginActions = {
    executeOperation: async (operation: string, data?: any) => {
      setState(prev => ({ ...prev, isProcessing: true, hasError: false }));
      
      try {
        // Placeholder for actual operation logic
        // This would be implemented by individual plugins
        console.log(`Executing operation: ${operation}`, data);
        
        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const result = `Operation ${operation} completed successfully`;
        
        setState(prev => ({
          ...prev,
          isProcessing: false,
          hasError: false,
          lastOperation: operation
        }));
        
        onResult?.(result);
        
        if (enableHistory) {
          actions.addToHistory(operation, result, { data });
        }
        
        return result;
      } catch (error) {
        setState(prev => ({
          ...prev,
          isProcessing: false,
          hasError: true,
          errorMessage: error instanceof Error ? error.message : String(error)
        }));
        
        toast.error(`Operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
      }
    },
    
    addToHistory: (operation, result, metadata = {}) => {
      const item: PluginHistoryItem = {
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

  const { isLoading, isProcessing, hasError, errorMessage, history, activeTab } = state;

  return (
    <div className="h-full flex flex-col bg-black text-white">
      {/* Header */}
      <CardHeader className="border-b border-white/10 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {IconComponent && <IconComponent className="w-5 h-5 text-blue-400" />}
            <CardTitle className="text-lg">{title}</CardTitle>
            {description && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="w-4 h-4 text-gray-400" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{description}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {enableSettings && (
              <Button variant="ghost" size="icon" onClick={() => toast.info('Settings panel would open')}>
                <Settings className="w-4 h-4" />
              </Button>
            )}
            
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
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <Tabs 
          value={activeTab} 
          onValueChange={(value) => setState(prev => ({ ...prev, activeTab: value }))} 
          className="h-full flex flex-col"
        >
          <TabsList className="grid grid-cols-2 w-full mb-4">
            <TabsTrigger value="main">Main</TabsTrigger>
            {enableHistory && (
              <TabsTrigger value="history" className="relative">
                History
                {history.length > 0 && (
                  <Badge className="ml-1" variant="secondary">{history.length}</Badge>
                )}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="main" className="flex-1 overflow-auto">
            <div className="space-y-4">
              {/* Loading State */}
              {isLoading && (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                  <p>Loading {title}...</p>
                </div>
              )}

              {/* Content will be provided by extending components */}
              <div className="space-y-4">
                <Card className="bg-white/5">
                  <CardHeader>
                    <CardTitle className="text-sm">Base Plugin</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p>This is a base plugin component. Extend this for specific functionality.</p>
                    <p className="text-sm text-gray-400 mt-2">{helpText}</p>
                  </CardContent>
                </Card>

                <div className="flex gap-2">
                  <Button 
                    onClick={() => actions.executeOperation('test')} 
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Execute
                      </>
                    )}
                  </Button>
                  
                  <Button variant="outline" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {enableHistory && (
            <TabsContent value="history" className="flex-1 overflow-auto">
              <div className="space-y-3">
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
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </div>
  );
};

export default BasePlugin;