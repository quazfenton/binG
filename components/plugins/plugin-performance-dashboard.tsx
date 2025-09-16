"use client"

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { 
  BarChart3, 
  Cpu, 
  HardDrive, 
  Network, 
  Zap,
  Clock,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Trash2,
  Settings
} from 'lucide-react';
import { 
  pluginPerformanceManager,
  PluginPerformanceMetrics,
  ResourcePool,
  BackgroundTask
} from '../../lib/plugins/plugin-performance-manager';
import { enhancedPluginManager } from '../../lib/plugins/enhanced-plugin-manager';

interface PerformanceDashboardProps {
  onClose?: () => void;
}

export const PluginPerformanceDashboard: React.FC<PerformanceDashboardProps> = ({
  onClose
}) => {
  const [metrics, setMetrics] = useState<Map<string, PluginPerformanceMetrics>>(new Map());
  const [resourcePools, setResourcePools] = useState<ResourcePool[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    updateDashboard();
    
    if (autoRefresh) {
      const interval = setInterval(updateDashboard, 2000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const updateDashboard = () => {
    // Get all plugin metrics
    const plugins = enhancedPluginManager.getAllPlugins();
    const metricsMap = new Map<string, PluginPerformanceMetrics>();
    
    plugins.forEach(plugin => {
      const pluginMetrics = pluginPerformanceManager.getMetrics(plugin.id);
      if (pluginMetrics) {
        metricsMap.set(plugin.id, pluginMetrics);
      }
    });
    
    setMetrics(metricsMap);
    setResourcePools(pluginPerformanceManager.getResourcePoolStatus());
    setBackgroundTasks(pluginPerformanceManager.getBackgroundTasks());
    setCacheStats(pluginPerformanceManager.getCacheStats());
  };

  const handleOptimizePlugin = (pluginId: string) => {
    pluginPerformanceManager.optimizePlugin(pluginId);
    updateDashboard();
  };

  const handleClearCache = (pluginId: string) => {
    pluginPerformanceManager.clearPluginCache(pluginId);
    updateDashboard();
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getResourceIcon = (type: string) => {
    switch (type) {
      case 'memory': return <HardDrive className="w-4 h-4" />;
      case 'cpu': return <Cpu className="w-4 h-4" />;
      case 'network': return <Network className="w-4 h-4" />;
      case 'storage': return <HardDrive className="w-4 h-4" />;
      default: return <Settings className="w-4 h-4" />;
    }
  };

  const getResourceColor = (usage: number, capacity: number) => {
    const percentage = (usage / capacity) * 100;
    if (percentage > 80) return 'text-red-400';
    if (percentage > 60) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getTaskStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'running': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'failed': return 'bg-red-500/20 text-red-300 border-red-500/30';
      default: return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    }
  };

  return (
    <div className="w-full max-w-6xl bg-black/90 backdrop-blur-xl border border-white/20 rounded-lg text-white overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-purple-400" />
            <h2 className="text-xl font-semibold">Plugin Performance Dashboard</h2>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`border-white/20 ${autoRefresh ? 'bg-green-500/20' : ''}`}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
              Auto Refresh
            </Button>
            
            <Button size="sm" onClick={updateDashboard}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            
            {onClose && (
              <Button size="sm" variant="ghost" onClick={onClose}>
                ×
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6 max-h-[80vh] overflow-y-auto">
        {/* Resource Pools Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {resourcePools.map(pool => (
            <Card key={pool.id} className="bg-black/40 border-white/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  {getResourceIcon(pool.type)}
                  <span className="text-sm font-medium capitalize">{pool.type}</span>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Used</span>
                    <span className={getResourceColor(pool.used, pool.capacity)}>
                      {pool.type === 'memory' || pool.type === 'storage' 
                        ? formatBytes(pool.used * 1024) 
                        : `${pool.used}${pool.type === 'cpu' ? '%' : ''}`
                      }
                    </span>
                  </div>
                  
                  <Progress 
                    value={(pool.used / pool.capacity) * 100} 
                    className="h-2"
                  />
                  
                  <div className="text-xs text-white/60">
                    {pool.waitingQueue.length > 0 && (
                      <span>{pool.waitingQueue.length} waiting</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Cache Statistics */}
        {cacheStats && (
          <Card className="bg-black/40 border-white/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-400" />
                Cache Statistics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div>
                  <div className="text-white/60">Total Entries</div>
                  <div className="text-lg font-semibold">{cacheStats.totalEntries}</div>
                </div>
                <div>
                  <div className="text-white/60">Total Size</div>
                  <div className="text-lg font-semibold">{formatBytes(cacheStats.totalSize)}</div>
                </div>
                <div>
                  <div className="text-white/60">Hit Rate</div>
                  <div className="text-lg font-semibold">{(cacheStats.hitRate * 100).toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-white/60">Oldest Entry</div>
                  <div className="text-lg font-semibold">
                    {cacheStats.oldestEntry ? formatTime(Date.now() - cacheStats.oldestEntry) : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-white/60">Newest Entry</div>
                  <div className="text-lg font-semibold">
                    {cacheStats.newestEntry ? formatTime(Date.now() - cacheStats.newestEntry) : 'N/A'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Plugin Performance Metrics */}
        <Card className="bg-black/40 border-white/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-400" />
              Plugin Performance Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.size === 0 ? (
              <div className="text-center text-white/60 py-8">
                No performance data available
              </div>
            ) : (
              <div className="space-y-4">
                {Array.from(metrics.entries()).map(([pluginId, metric]) => (
                  <div key={pluginId} className="p-4 bg-white/5 rounded-lg border border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{pluginId}</span>
                        {metric.errorRate > 0.1 && (
                          <Badge className="text-xs bg-red-500/20 text-red-300 border-red-500/30">
                            {(metric.errorRate * 100).toFixed(1)}% errors
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOptimizePlugin(pluginId)}
                          className="text-xs px-2 py-1 h-6"
                        >
                          <Zap className="w-3 h-3 mr-1" />
                          Optimize
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleClearCache(pluginId)}
                          className="text-xs px-2 py-1 h-6"
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Clear Cache
                        </Button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                      <div>
                        <div className="text-white/60">Load Time</div>
                        <div className="font-semibold">{formatTime(metric.loadTime)}</div>
                      </div>
                      <div>
                        <div className="text-white/60">Render Time</div>
                        <div className="font-semibold">{formatTime(metric.renderTime)}</div>
                      </div>
                      <div>
                        <div className="text-white/60">Memory Usage</div>
                        <div className="font-semibold">{formatBytes(metric.memoryUsage * 1024 * 1024)}</div>
                      </div>
                      <div>
                        <div className="text-white/60">Network Requests</div>
                        <div className="font-semibold">{metric.networkRequests}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Background Tasks */}
        <Card className="bg-black/40 border-white/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="w-5 h-5 text-green-400" />
              Background Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {backgroundTasks.length === 0 ? (
              <div className="text-center text-white/60 py-4">
                No background tasks
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {backgroundTasks.map(task => (
                  <div key={task.id} className="p-3 bg-white/5 rounded border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{task.type}</span>
                        <Badge className={`text-xs ${getTaskStatusColor(task.status)}`}>
                          {task.status}
                        </Badge>
                        <span className="text-xs text-white/60">{task.pluginId}</span>
                      </div>
                      
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${
                          task.priority === 'high' ? 'border-red-500/30 text-red-300' :
                          task.priority === 'medium' ? 'border-yellow-500/30 text-yellow-300' :
                          'border-green-500/30 text-green-300'
                        }`}
                      >
                        {task.priority}
                      </Badge>
                    </div>
                    
                    {task.status === 'running' && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Progress</span>
                          <span>{task.progress.toFixed(0)}%</span>
                        </div>
                        <Progress value={task.progress} className="h-1" />
                      </div>
                    )}
                    
                    {task.error && (
                      <div className="text-xs text-red-300 mt-2">
                        Error: {task.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PluginPerformanceDashboard;