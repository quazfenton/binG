"use client";

import React, { useState, useEffect } from 'react';
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
  XCircle,
  Code,
  FileText,
  Zap,
  Shield,
  Cpu,
  Database,
  Layers
} from 'lucide-react';
import { Alert, AlertDescription } from '../ui/alert';
import { Progress } from '../ui/progress';
import { toast } from 'sonner';
import type { PluginProps } from './plugin-manager';
import BasePlugin, { BasePluginActions, BasePluginState } from './base-plugin';

// Define specific state and props for this test plugin
interface ModularTestPluginState extends BasePluginState {
  moduleName: string;
  moduleVersion: string;
  moduleDescription: string;
  testResults: Array<{
    id: string;
    timestamp: number;
    operation: string;
    result: string;
    status: 'success' | 'error' | 'pending';
  }>;
  moduleConfig: {
    enabled: boolean;
    debugMode: boolean;
    maxRetries: number;
    timeout: number;
  };
}

interface ModularTestPluginProps extends PluginProps {
  // Add plugin-specific props here if needed
}

// Modular Test Plugin Implementation
const ModularTestPlugin: React.FC<ModularTestPluginProps> = ({
  onClose,
  onResult,
  initialData
}) => {
  const [state, setState] = useState<ModularTestPluginState>({
    isLoading: false,
    isProcessing: false,
    hasError: false,
    errorMessage: undefined,
    history: [],
    settings: {},
    activeTab: 'main',
    lastOperation: null,
    moduleName: initialData?.moduleName || 'TestModule',
    moduleVersion: initialData?.moduleVersion || '1.0.0',
    moduleDescription: initialData?.moduleDescription || 'A test module for the plugin system',
    testResults: initialData?.testResults || [],
    moduleConfig: initialData?.moduleConfig || {
      enabled: true,
      debugMode: false,
      maxRetries: 3,
      timeout: 10000
    }
  });

  const actions: BasePluginActions = {
    executeOperation: async (operation: string, data?: any) => {
      setState(prev => ({ ...prev, isProcessing: true, hasError: false }));
      
      try {
        let result: any;
        
        switch(operation) {
          case 'test-module':
            result = await testModule(state.moduleName);
            break;
          case 'validate':
            result = await validateModule(state.moduleName);
            break;
          case 'benchmark':
            result = await benchmarkModule();
            break;
          case 'reset':
            result = await resetModule();
            break;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
        
        // Add test result
        const testResult = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          operation,
          result: typeof result === 'string' ? result : JSON.stringify(result),
          status: 'success' as const
        };
        
        setState(prev => ({
          ...prev,
          isProcessing: false,
          hasError: false,
          lastOperation: operation,
          testResults: [testResult, ...prev.testResults.slice(0, 9)] // Keep last 10 results
        }));
        
        onResult?.(result);
        
        // Add to history
        addToHistory(operation, result, { 
          moduleName: state.moduleName,
          config: state.moduleConfig,
          result: testResult 
        });
        
        toast.success(`${operation.charAt(0).toUpperCase() + operation.slice(1)} completed`);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const testResult = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          operation: data?.operation || 'unknown',
          result: errorMsg,
          status: 'error' as const
        };
        
        setState(prev => ({
          ...prev,
          isProcessing: false,
          hasError: true,
          errorMessage: errorMsg,
          testResults: [testResult, ...prev.testResults.slice(0, 9)]
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
      setState(prev => ({ 
        ...prev, 
        history: [],
        testResults: []
      }));
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
  const testModule = async (moduleName: string): Promise<string> => {
    // Simulate module testing
    await new Promise(resolve => setTimeout(resolve, 1500));
    return `Module ${moduleName} tested successfully`;
  };

  const validateModule = async (moduleName: string): Promise<string> => {
    // Simulate module validation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (!moduleName || moduleName.trim() === '') {
      throw new Error('Module name is required');
    }
    
    if (moduleName.length < 3) {
      throw new Error('Module name must be at least 3 characters');
    }
    
    return `Module ${moduleName} validation passed`;
  };

  const benchmarkModule = async (): Promise<string> => {
    // Simulate module benchmarking
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const performanceMetrics = {
      executionTime: 1542,
      memoryUsage: 23.4,
      cpuUsage: 12.7,
      requests: 42,
      errors: 0
    };
    
    return `Benchmark complete:\n- Execution time: ${performanceMetrics.executionTime}ms\n- Memory usage: ${performanceMetrics.memoryUsage}MB\n- CPU usage: ${performanceMetrics.cpuUsage}%\n- Requests: ${performanceMetrics.requests}\n- Errors: ${performanceMetrics.errors}`;
  };

  const resetModule = async (): Promise<string> => {
    // Simulate module reset
    await new Promise(resolve => setTimeout(resolve, 800));
    
    setState(prev => ({
      ...prev,
      moduleConfig: {
        enabled: true,
        debugMode: false,
        maxRetries: 3,
        timeout: 10000
      }
    }));
    
    return 'Module reset to default configuration';
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
    moduleName,
    moduleVersion,
    moduleDescription,
    testResults,
    moduleConfig,
    history
  } = state;

  const statusColor = (status: string) => {
    switch(status) {
      case 'success': return 'bg-green-500/30 text-green-400';
      case 'error': return 'bg-red-500/30 text-red-400';
      default: return 'bg-yellow-500/30 text-yellow-400';
    }
  };

  return (
    <div className="h-full flex flex-col bg-black text-white">
      {/* Header */}
      <CardHeader className="border-b border-white/10 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-400" />
            <CardTitle className="text-lg">Modular Test Plugin</CardTitle>
            <Badge variant="secondary">System</Badge>
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

        <Tabs 
          value={state.activeTab} 
          onValueChange={(value) => setState(prev => ({ ...prev, activeTab: value }))} 
          className="h-full flex flex-col"
        >
          <TabsList className="grid grid-cols-4 w-full mb-4">
            <TabsTrigger value="main">
              <Layers className="w-3 h-3 mr-1" />
              Module
            </TabsTrigger>
            <TabsTrigger value="test">
              <Zap className="w-3 h-3 mr-1" />
              Tests
            </TabsTrigger>
            <TabsTrigger value="config">
              <Settings className="w-3 h-3 mr-1" />
              Config
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="w-3 h-3 mr-1" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="main" className="flex-1 overflow-auto">
            <div className="space-y-4">
              <Card className="bg-white/5">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Module Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-white/60">Module Name</label>
                      <Input
                        value={moduleName}
                        onChange={(e) => setState(prev => ({ ...prev, moduleName: e.target.value }))}
                        placeholder="Enter module name"
                        className="bg-black/40 border-white/20"
                      />
                    </div>
                    
                    <div>
                      <label className="text-xs text-white/60">Version</label>
                      <Input
                        value={moduleVersion}
                        onChange={(e) => setState(prev => ({ ...prev, moduleVersion: e.target.value }))}
                        placeholder="Module version"
                        className="bg-black/40 border-white/20"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-xs text-white/60">Description</label>
                    <Textarea
                      value={moduleDescription}
                      onChange={(e) => setState(prev => ({ ...prev, moduleDescription: e.target.value }))}
                      placeholder="Module description"
                      className="bg-black/40 border-white/20 min-h-[80px]"
                    />
                  </div>
                  
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => actions.executeOperation('test-module')}
                      disabled={isProcessing || !moduleName}
                      className="flex-1"
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4 mr-2" />
                          Test Module
                        </>
                      )}
                    </Button>
                    
                    <Button 
                      onClick={() => actions.executeOperation('validate')}
                      disabled={isProcessing || !moduleName}
                      variant="outline"
                    >
                      <Shield className="w-4 h-4 mr-2" />
                      Validate
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Status Indicators */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="bg-white/5 p-3 text-center">
                  <Shield className="w-6 h-6 mx-auto text-green-400 mb-1" />
                  <div className="text-sm font-medium">Security</div>
                  <div className="text-xs text-white/60">Active</div>
                </Card>
                
                <Card className="bg-white/5 p-3 text-center">
                  <Cpu className="w-6 h-6 mx-auto text-blue-400 mb-1" />
                  <div className="text-sm font-medium">Performance</div>
                  <div className="text-xs text-white/60">Optimal</div>
                </Card>
                
                <Card className="bg-white/5 p-3 text-center">
                  <Database className="w-6 h-6 mx-auto text-purple-400 mb-1" />
                  <div className="text-sm font-medium">Resources</div>
                  <div className="text-xs text-white/60">Normal</div>
                </Card>
                
                <Card className="bg-white/5 p-3 text-center">
                  <CheckCircle className="w-6 h-6 mx-auto text-green-400 mb-1" />
                  <div className="text-sm font-medium">Status</div>
                  <div className="text-xs text-white/60">Operational</div>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="test" className="flex-1 overflow-auto">
            <div className="space-y-4">
              <Card className="bg-white/5">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>Module Tests</span>
                    <Button 
                      size="sm" 
                      onClick={() => actions.executeOperation('benchmark')}
                      disabled={isProcessing}
                    >
                      <Zap className="w-3 h-3 mr-1" />
                      Benchmark
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {testResults.length === 0 ? (
                      <div className="text-center py-8 text-white/60">
                        <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>No test results yet</p>
                        <p className="text-sm">Run tests to see results</p>
                      </div>
                    ) : (
                      testResults.map((result) => (
                        <Card key={result.id} className="bg-black/40">
                          <CardContent className="p-3 flex items-center justify-between">
                            <div>
                              <div className="font-medium text-sm">{result.operation}</div>
                              <div className="text-xs text-white/60">
                                {new Date(result.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <Badge className={statusColor(result.status)}>
                                {result.status}
                              </Badge>
                              <Button 
                                size="sm" 
                                variant="ghost"
                                onClick={() => navigator.clipboard.writeText(result.result)}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/5">
                <CardHeader>
                  <CardTitle className="text-sm">Test Controls</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Button 
                      onClick={() => actions.executeOperation('test-module')}
                      disabled={isProcessing}
                    >
                      <Zap className="w-4 h-4 mr-2" />
                      Quick Test
                    </Button>
                    
                    <Button 
                      onClick={() => actions.executeOperation('validate')}
                      disabled={isProcessing}
                      variant="outline"
                    >
                      <Shield className="w-4 h-4 mr-2" />
                      Validate
                    </Button>
                  </div>
                  
                  <Button 
                    onClick={() => actions.executeOperation('reset')}
                    disabled={isProcessing}
                    variant="secondary"
                    className="w-full"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reset Module
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="config" className="space-y-4">
            <Card className="bg-white/5">
              <CardHeader>
                <CardTitle className="text-sm">Module Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Module Enabled</label>
                    <p className="text-xs text-white/60">Allow this module to run</p>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={moduleConfig.enabled} 
                    onChange={(e) => setState(prev => ({
                      ...prev,
                      moduleConfig: { ...prev.moduleConfig, enabled: e.target.checked }
                    }))}
                    className="toggle"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Debug Mode</label>
                    <p className="text-xs text-white/60">Enable detailed logging</p>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={moduleConfig.debugMode} 
                    onChange={(e) => setState(prev => ({
                      ...prev,
                      moduleConfig: { ...prev.moduleConfig, debugMode: e.target.checked }
                    }))}
                    className="toggle"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium">Max Retries: {moduleConfig.maxRetries}</label>
                  <input 
                    type="range" 
                    min="1" 
                    max="10" 
                    value={moduleConfig.maxRetries} 
                    onChange={(e) => setState(prev => ({
                      ...prev,
                      moduleConfig: { ...prev.moduleConfig, maxRetries: parseInt(e.target.value) }
                    }))}
                    className="w-full mt-2"
                  />
                  <div className="flex justify-between text-xs text-white/60">
                    <span>1</span>
                    <span>10</span>
                  </div>
                </div>
                
                <div>
                  <label className="text-sm font-medium">Timeout (ms): {moduleConfig.timeout}</label>
                  <input 
                    type="range" 
                    min="1000" 
                    max="30000" 
                    step="1000"
                    value={moduleConfig.timeout} 
                    onChange={(e) => setState(prev => ({
                      ...prev,
                      moduleConfig: { ...prev.moduleConfig, timeout: parseInt(e.target.value) }
                    }))}
                    className="w-full mt-2"
                  />
                  <div className="flex justify-between text-xs text-white/60">
                    <span>1s</span>
                    <span>30s</span>
                  </div>
                </div>
                
                <Button 
                  size="sm" 
                  onClick={() => actions.updateSettings(moduleConfig)}
                  className="w-full"
                >
                  Save Configuration
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-medium">Operation History</h3>
              <div className="flex gap-2">
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
            </div>

            {history.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No operation history yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((item) => (
                  <Card key={item.id} className="bg-white/5">
                    <CardContent className="p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium">{item.operation}</div>
                          <div className="text-sm text-white/60">
                            {new Date(item.timestamp).toLocaleString()}
                          </div>
                        </div>
                        <Badge variant="outline">
                          {item.metadata?.moduleName || 'N/A'}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs font-mono bg-black p-2 rounded max-h-24 overflow-auto">
                        {typeof item.result === 'string' 
                          ? item.result.substring(0, 200) + (item.result.length > 200 ? '...' : '')
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

export default ModularTestPlugin;