"use client"

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, RefreshCw, Pause, Play, X, Activity } from 'lucide-react';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { enhancedPluginManager, PluginInstance } from '../../lib/plugins/enhanced-plugin-manager';
import { PluginError, PluginSandbox } from '../../lib/plugins/plugin-isolation';
import type { PluginProps } from './plugin-manager';

interface EnhancedPluginWrapperProps extends PluginProps {
  pluginId: string;
  component: React.ComponentType<PluginProps>;
  onError?: (error: PluginError) => void;
  onStatusChange?: (status: string) => void;
}

export const EnhancedPluginWrapper: React.FC<EnhancedPluginWrapperProps> = ({
  pluginId,
  component: PluginComponent,
  onClose,
  onResult,
  initialData,
  onError,
  onStatusChange
}) => {
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [instance, setInstance] = useState<PluginInstance | null>(null);
  const [sandbox, setSandbox] = useState<PluginSandbox | null>(null);
  const [errors, setErrors] = useState<PluginError[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showResourceMonitor, setShowResourceMonitor] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize plugin instance
  useEffect(() => {
    let mounted = true;

    const initializePlugin = async () => {
      try {
        setIsLoading(true);
        const newInstanceId = await enhancedPluginManager.loadPlugin(pluginId, initialData);
        
        if (mounted) {
          setInstanceId(newInstanceId);
          setIsLoading(false);
        }
      } catch (error) {
        if (mounted) {
          console.error('Failed to initialize plugin:', error);
          setIsLoading(false);
          const pluginError: PluginError = {
            id: `init_error_${Date.now()}`,
            pluginId,
            type: 'runtime',
            message: `Failed to initialize plugin: ${error instanceof Error ? error.message : 'Unknown error'}`,
            timestamp: Date.now(),
            recoverable: true
          };
          setErrors(prev => [...prev, pluginError]);
          onError?.(pluginError);
        }
      }
    };

    initializePlugin();

    return () => {
      mounted = false;
    };
  }, [pluginId, initialData, onError]);

  // Monitor instance and sandbox status
  useEffect(() => {
    if (!instanceId) return;

    const updateStatus = () => {
      const currentInstance = enhancedPluginManager.getInstance(instanceId);
      const currentSandbox = currentInstance ? 
        enhancedPluginManager['isolationManager'].getSandboxInfo(currentInstance.sandboxId) : null;

      setInstance(currentInstance || null);
      setSandbox(currentSandbox || null);

      if (currentInstance) {
        onStatusChange?.(currentInstance.status);
      }

      // Update errors from sandbox
      if (currentSandbox?.errors) {
        setErrors(currentSandbox.errors);
      }
    };

    // Initial update
    updateStatus();

    // Set up periodic updates
    intervalRef.current = setInterval(updateStatus, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [instanceId, onStatusChange]);

  // Register error handler
  useEffect(() => {
    if (!pluginId) return;

    const handleError = (error: PluginError) => {
      setErrors(prev => [...prev, error]);
      onError?.(error);
    };

    enhancedPluginManager.onPluginError(pluginId, handleError);
  }, [pluginId, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (instanceId) {
        enhancedPluginManager.unloadPlugin(instanceId).catch(console.error);
      }
    };
  }, [instanceId]);

  const handleRestart = useCallback(async () => {
    if (!instanceId) return;

    try {
      setIsLoading(true);
      await enhancedPluginManager.restartPlugin(instanceId);
      setErrors([]);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to restart plugin:', error);
      setIsLoading(false);
    }
  }, [instanceId]);

  const handlePause = useCallback(() => {
    if (!instanceId) return;
    enhancedPluginManager.pausePlugin(instanceId);
  }, [instanceId]);

  const handleResume = useCallback(() => {
    if (!instanceId) return;
    enhancedPluginManager.resumePlugin(instanceId);
  }, [instanceId]);

  const handleClose = useCallback(async () => {
    if (instanceId) {
      await enhancedPluginManager.unloadPlugin(instanceId);
    }
    onClose();
  }, [instanceId, onClose]);

  const executePluginOperation = useCallback(async <T,>(
    operation: () => Promise<T>
  ): Promise<T> => {
    if (!instanceId) {
      throw new Error('Plugin not initialized');
    }

    return enhancedPluginManager.executePlugin(instanceId, operation);
  }, [instanceId]);

  // Enhanced onResult that executes safely
  const safeOnResult = useCallback(async (result: any) => {
    try {
      await executePluginOperation(async () => {
        onResult?.(result);
        return result;
      });
    } catch (error) {
      console.error('Error in plugin result handler:', error);
    }
  }, [executePluginOperation, onResult]);

  // Render loading state
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-400" />
          <p className="text-white/80">Loading plugin...</p>
        </div>
      </div>
    );
  }

  // Render error state
  if (!instance || instance.status === 'error' || instance.status === 'terminated') {
    const latestError = errors[errors.length - 1];
    
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Plugin Error
          </h3>
          <Button size="sm" variant="ghost" onClick={handleClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <Alert className="mb-4 border-red-500/50 bg-red-500/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {latestError?.message || 'Plugin encountered an error and cannot continue.'}
          </AlertDescription>
        </Alert>

        <div className="flex gap-2">
          <Button onClick={handleRestart} className="bg-blue-600 hover:bg-blue-700">
            <RefreshCw className="w-4 h-4 mr-2" />
            Restart Plugin
          </Button>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </div>

        {errors.length > 0 && (
          <div className="mt-4 p-3 bg-black/20 rounded-lg max-h-32 overflow-y-auto">
            <h4 className="text-sm font-medium text-white/80 mb-2">Error History</h4>
            {errors.slice(-5).map((error, index) => (
              <div key={error.id} className="text-xs text-red-300 mb-1">
                {new Date(error.timestamp).toLocaleTimeString()}: {error.message}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Plugin Status Bar */}
      <div className="flex items-center justify-between p-2 bg-black/20 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Badge 
            variant={
              instance.status === 'running' ? 'default' : 
              instance.status === 'paused' ? 'secondary' : 'destructive'
            }
            className="text-xs"
          >
            {instance.status}
          </Badge>
          
          {instance.errorCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {instance.errorCount} errors
            </Badge>
          )}
          
          {instance.restartCount > 0 && (
            <Badge variant="outline" className="text-xs">
              {instance.restartCount} restarts
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowResourceMonitor(!showResourceMonitor)}
            className="text-white/60 hover:text-white"
          >
            <Activity className="w-4 h-4" />
          </Button>
          
          {instance.status === 'running' ? (
            <Button size="sm" variant="ghost" onClick={handlePause}>
              <Pause className="w-4 h-4" />
            </Button>
          ) : instance.status === 'paused' ? (
            <Button size="sm" variant="ghost" onClick={handleResume}>
              <Play className="w-4 h-4" />
            </Button>
          ) : null}
          
          <Button size="sm" variant="ghost" onClick={handleRestart}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Resource Monitor */}
      {showResourceMonitor && sandbox && (
        <div className="p-3 bg-black/10 border-b border-white/10 space-y-2">
          <div className="text-xs text-white/80">Resource Usage</div>
          
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="flex justify-between">
                <span>Memory</span>
                <span>{sandbox.resourceUsage.memoryMB.toFixed(1)} MB</span>
              </div>
              <Progress 
                value={(sandbox.resourceUsage.memoryMB / 100) * 100} 
                className="h-1 mt-1"
              />
            </div>
            
            <div>
              <div className="flex justify-between">
                <span>CPU</span>
                <span>{sandbox.resourceUsage.cpuPercent.toFixed(1)}%</span>
              </div>
              <Progress 
                value={sandbox.resourceUsage.cpuPercent} 
                className="h-1 mt-1"
              />
            </div>
          </div>
          
          <div className="text-xs text-white/60">
            Runtime: {Math.floor((Date.now() - sandbox.createdAt) / 1000)}s | 
            Network: {sandbox.resourceUsage.networkRequests} requests
          </div>
        </div>
      )}

      {/* Plugin Content */}
      <div className="flex-1 overflow-hidden">
        {instance.status === 'running' ? (
          <PluginComponent
            onClose={handleClose}
            onResult={safeOnResult}
            initialData={initialData}
          />
        ) : (
          <div className="h-full flex items-center justify-center p-4">
            <div className="text-center text-white/60">
              <Pause className="w-8 h-8 mx-auto mb-2" />
              <p>Plugin is paused</p>
              <Button size="sm" onClick={handleResume} className="mt-2">
                Resume
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EnhancedPluginWrapper;