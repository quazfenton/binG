"use client"

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { 
  GitBranch, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  Eye,
  EyeOff
} from 'lucide-react';
import { enhancedPluginManager } from '../../lib/plugins/enhanced-plugin-manager';
import { PluginCompatibility } from '../../lib/plugins/plugin-dependency-manager';

interface DependencyNode {
  id: string;
  name: string;
  version: string;
  status: 'available' | 'missing' | 'incompatible';
  optional: boolean;
  fallback?: string;
  dependencies: DependencyNode[];
}

interface PluginDependencyVisualizerProps {
  pluginId?: string;
  onClose?: () => void;
}

export const PluginDependencyVisualizer: React.FC<PluginDependencyVisualizerProps> = ({
  pluginId,
  onClose
}) => {
  const [selectedPlugin, setSelectedPlugin] = useState<string>(pluginId || '');
  const [dependencyTree, setDependencyTree] = useState<any>(null);
  const [compatibility, setCompatibility] = useState<PluginCompatibility | null>(null);
  const [availablePlugins, setAvailablePlugins] = useState<string[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [registryInfo, setRegistryInfo] = useState<any>(null);

  useEffect(() => {
    // Get available plugins
    const plugins = enhancedPluginManager.getAllPlugins();
    setAvailablePlugins(plugins.map(p => p.id));
    
    // Get registry information
    setRegistryInfo(enhancedPluginManager.getDependencyRegistryInfo());
  }, []);

  useEffect(() => {
    if (selectedPlugin) {
      updateDependencyInfo();
    }
  }, [selectedPlugin]);

  const updateDependencyInfo = async () => {
    if (!selectedPlugin) return;

    try {
      const depInfo = enhancedPluginManager.getPluginDependencies(selectedPlugin);
      setDependencyTree(depInfo.tree);
      
      const compat = await depInfo.compatibility;
      setCompatibility(compat);
    } catch (error) {
      console.error('Failed to get dependency info:', error);
      setDependencyTree(null);
      setCompatibility(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'available':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'missing':
        return <XCircle className="w-4 h-4 text-red-400" />;
      case 'incompatible':
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available':
        return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'missing':
        return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'incompatible':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    }
  };

  const renderDependencyNode = (dep: any, level = 0) => {
    const indent = level * 20;
    
    return (
      <div key={dep.plugin} className="mb-2">
        <div 
          className="flex items-center gap-2 p-2 bg-white/5 rounded border border-white/10"
          style={{ marginLeft: indent }}
        >
          {getStatusIcon(dep.status)}
          <span className="font-medium">{dep.plugin}</span>
          <Badge className={`text-xs ${getStatusColor(dep.status)}`}>
            {dep.status}
          </Badge>
          <span className="text-xs text-white/60">v{dep.version}</span>
          
          {dep.optional && (
            <Badge variant="outline" className="text-xs">
              optional
            </Badge>
          )}
          
          {dep.fallback && (
            <Badge variant="secondary" className="text-xs">
              fallback: {dep.fallback}
            </Badge>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className="w-full max-w-4xl bg-black/90 backdrop-blur-xl border-white/20 text-white">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-blue-400" />
            Plugin Dependency Visualizer
          </CardTitle>
          {onClose && (
            <Button size="sm" variant="ghost" onClick={onClose}>
              ×
            </Button>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Plugin Selection */}
        <div className="flex items-center gap-2">
          <select
            value={selectedPlugin}
            onChange={(e) => setSelectedPlugin(e.target.value)}
            className="bg-black/40 border border-white/20 rounded px-3 py-2 text-white"
          >
            <option value="">Select a plugin...</option>
            {availablePlugins.map(pluginId => (
              <option key={pluginId} value={pluginId}>
                {pluginId}
              </option>
            ))}
          </select>
          
          <Button
            size="sm"
            onClick={updateDependencyInfo}
            disabled={!selectedPlugin}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div>

        {/* Registry Overview */}
        {registryInfo && showDetails && (
          <Alert className="border-blue-500/50 bg-blue-500/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>Total Plugins: {registryInfo.totalPlugins}</div>
                <div>With Dependencies: {registryInfo.pluginsWithDependencies}</div>
                <div>Total Dependencies: {registryInfo.totalDependencies}</div>
                <div>Circular Dependencies: {registryInfo.circularDependencies.length}</div>
              </div>
              {registryInfo.circularDependencies.length > 0 && (
                <div className="mt-2 text-red-300">
                  Circular dependencies detected: {registryInfo.circularDependencies.join(', ')}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Compatibility Status */}
        {compatibility && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {compatibility.compatible ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className="font-medium">
                {compatibility.compatible ? 'Compatible' : 'Incompatible'}
              </span>
            </div>

            {compatibility.missingDependencies.length > 0 && (
              <Alert className="border-red-500/50 bg-red-500/10">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  Missing dependencies: {compatibility.missingDependencies.join(', ')}
                </AlertDescription>
              </Alert>
            )}

            {compatibility.incompatibleVersions.length > 0 && (
              <Alert className="border-yellow-500/50 bg-yellow-500/10">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Incompatible versions: {compatibility.incompatibleVersions.join(', ')}
                </AlertDescription>
              </Alert>
            )}

            {compatibility.availableFallbacks.length > 0 && (
              <Alert className="border-blue-500/50 bg-blue-500/10">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Available fallbacks: {compatibility.availableFallbacks.join(', ')}
                </AlertDescription>
              </Alert>
            )}

            {compatibility.warnings.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-yellow-300">Warnings:</div>
                {compatibility.warnings.map((warning, index) => (
                  <div key={index} className="text-xs text-yellow-200 pl-4">
                    • {warning}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dependency Tree */}
        {dependencyTree && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-blue-400" />
              <span className="font-medium">Dependency Tree</span>
            </div>
            
            <div className="bg-black/20 rounded-lg p-4 border border-white/10">
              <div className="mb-3">
                <div className="flex items-center gap-2 font-medium">
                  <span>{dependencyTree.plugin}</span>
                  <Badge variant="outline" className="text-xs">
                    root
                  </Badge>
                </div>
              </div>
              
              {dependencyTree.dependencies.length === 0 ? (
                <div className="text-white/60 text-sm">No dependencies</div>
              ) : (
                <div className="space-y-1">
                  {dependencyTree.dependencies.map((dep: any) => renderDependencyNode(dep, 1))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Load Order */}
        {selectedPlugin && showDetails && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-green-400" />
              <span className="font-medium">Recommended Load Order</span>
            </div>
            
            <div className="bg-black/20 rounded-lg p-4 border border-white/10">
              {(() => {
                try {
                  const loadOrder = enhancedPluginManager.getLoadOrder([selectedPlugin]);
                  return (
                    <div className="space-y-1">
                      {loadOrder.map((pluginId, index) => (
                        <div key={pluginId} className="flex items-center gap-2 text-sm">
                          <span className="text-white/60 w-6">{index + 1}.</span>
                          <span>{pluginId}</span>
                          {pluginId === selectedPlugin && (
                            <Badge variant="outline" className="text-xs">
                              target
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                } catch (error) {
                  return (
                    <div className="text-red-300 text-sm">
                      Error calculating load order: {error instanceof Error ? error.message : 'Unknown error'}
                    </div>
                  );
                }
              })()}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PluginDependencyVisualizer;