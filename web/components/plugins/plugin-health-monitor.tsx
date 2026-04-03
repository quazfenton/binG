"use client"

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { Button } from '../ui/button';
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  Pause,
  Play,
  Trash2
} from 'lucide-react';
import { enhancedPluginManager } from '../../lib/plugins/enhanced-plugin-manager';

interface PluginHealthData {
  pluginId: string;
  pluginName: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  instances: number;
  errors: number;
  restarts: number;
  resourceUsage: any[];
}

const DEMO_HEALTH_DATA: PluginHealthData[] = [
  { pluginId: 'calculator', pluginName: 'Calculator', status: 'healthy', instances: 1, errors: 0, restarts: 0, resourceUsage: [{ memoryMB: 12.4 }] },
  { pluginId: 'json-validator', pluginName: 'JSON Validator', status: 'healthy', instances: 1, errors: 2, restarts: 0, resourceUsage: [{ memoryMB: 8.7 }] },
  { pluginId: 'url-utilities', pluginName: 'URL Utilities', status: 'degraded', instances: 1, errors: 5, restarts: 1, resourceUsage: [{ memoryMB: 15.2 }] },
];

export const PluginHealthMonitor: React.FC = () => {
  const [healthData, setHealthData] = useState<PluginHealthData[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    if (!isVisible) return;

    const updateHealthData = () => {
      try {
        const plugins = enhancedPluginManager.getAllPlugins();
        if (plugins.length === 0) throw new Error('No plugins');
        const data: PluginHealthData[] = plugins.map(plugin => {
          const health = enhancedPluginManager.getPluginHealth(plugin.id);
          return {
            pluginId: plugin.id,
            pluginName: plugin.name,
            status: health.status,
            instances: health.instances,
            errors: health.errors,
            restarts: health.restarts,
            resourceUsage: health.resourceUsage
          };
        });
        setHealthData(data);
        setIsDemo(false);
      } catch {
        setHealthData(DEMO_HEALTH_DATA);
        setIsDemo(true);
      }
    };

    // Initial update
    updateHealthData();

    // Set up periodic updates
    const interval = setInterval(updateHealthData, 2000);

    return () => clearInterval(interval);
  }, [isVisible]);

  const handleRestartPlugin = async (pluginId: string) => {
    const instances = enhancedPluginManager.getPluginInstances(pluginId);
    for (const instance of instances) {
      try {
        await enhancedPluginManager.restartPlugin(instance.id);
      } catch (error) {
        console.error(`Failed to restart plugin ${pluginId}:`, error);
      }
    }
  };

  const handlePausePlugin = (pluginId: string) => {
    const instances = enhancedPluginManager.getPluginInstances(pluginId);
    instances.forEach(instance => {
      enhancedPluginManager.pausePlugin(instance.id);
    });
  };

  const handleResumePlugin = (pluginId: string) => {
    const instances = enhancedPluginManager.getPluginInstances(pluginId);
    instances.forEach(instance => {
      enhancedPluginManager.resumePlugin(instance.id);
    });
  };

  const handleUnloadPlugin = async (pluginId: string) => {
    const instances = enhancedPluginManager.getPluginInstances(pluginId);
    for (const instance of instances) {
      try {
        await enhancedPluginManager.unloadPlugin(instance.id);
      } catch (error) {
        console.error(`Failed to unload plugin ${pluginId}:`, error);
      }
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'degraded':
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
      case 'unhealthy':
        return <XCircle className="w-4 h-4 text-red-400" />;
      default:
        return <Activity className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'degraded':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      case 'unhealthy':
        return 'bg-red-500/20 text-red-300 border-red-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    }
  };

  if (!isVisible) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 bg-black/60 backdrop-blur-sm border-white/20"
      >
        <Activity className="w-4 h-4 mr-2" />
        Plugin Health
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-4 right-4 w-96 max-h-96 bg-black/90 backdrop-blur-xl border-white/20 text-white overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            Plugin Health Monitor
            {isDemo && <Badge className="ml-2 text-xs bg-yellow-500/20 text-yellow-300 border-yellow-500/30">Demo Data</Badge>}
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsVisible(false)}
            className="text-white/60 hover:text-white"
          >
            ×
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3 max-h-64 overflow-y-auto">
        {healthData.length === 0 ? (
          <div className="text-center text-white/60 py-4">
            No enhanced plugins running
          </div>
        ) : (
          healthData.map(plugin => (
            <div
              key={plugin.pluginId}
              className="p-3 bg-white/5 rounded-lg border border-white/10"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getStatusIcon(plugin.status)}
                  <span className="font-medium">{plugin.pluginName}</span>
                </div>
                <Badge className={`text-xs ${getStatusColor(plugin.status)}`}>
                  {plugin.status}
                </Badge>
              </div>
              
              <div className="grid grid-cols-3 gap-2 text-xs text-white/80 mb-2">
                <div>Instances: {plugin.instances}</div>
                <div>Errors: {plugin.errors}</div>
                <div>Restarts: {plugin.restarts}</div>
              </div>
              
              {plugin.resourceUsage.length > 0 && (
                <div className="space-y-1 mb-2">
                  {plugin.resourceUsage[0] && (
                    <>
                      <div className="flex justify-between text-xs">
                        <span>Memory</span>
                        <span>{plugin.resourceUsage[0].memoryMB?.toFixed(1)} MB</span>
                      </div>
                      <Progress 
                        value={(plugin.resourceUsage[0].memoryMB / 100) * 100} 
                        className="h-1"
                      />
                    </>
                  )}
                </div>
              )}
              
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRestartPlugin(plugin.pluginId)}
                  className="text-xs px-2 py-1 h-6"
                >
                  <RefreshCw className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handlePausePlugin(plugin.pluginId)}
                  className="text-xs px-2 py-1 h-6"
                >
                  <Pause className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleResumePlugin(plugin.pluginId)}
                  className="text-xs px-2 py-1 h-6"
                >
                  <Play className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleUnloadPlugin(plugin.pluginId)}
                  className="text-xs px-2 py-1 h-6 text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};

export default PluginHealthMonitor;