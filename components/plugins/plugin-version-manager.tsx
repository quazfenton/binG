"use client"

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { 
  Package, 
  AlertTriangle, 
  CheckCircle, 
  Upload,
  Download,
  RefreshCw,
  History
} from 'lucide-react';
import { enhancedPluginManager } from '../../lib/plugins/enhanced-plugin-manager';

interface PluginVersionInfo {
  id: string;
  name: string;
  currentVersion: string;
  dependents: string[];
  canUpdate: boolean;
  updateWarnings: string[];
}

export const PluginVersionManager: React.FC = () => {
  const [plugins, setPlugins] = useState<PluginVersionInfo[]>([]);
  const [selectedPlugin, setSelectedPlugin] = useState<string>('');
  const [newVersion, setNewVersion] = useState<string>('');
  const [updateResult, setUpdateResult] = useState<any>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    loadPluginVersions();
  }, []);

  const loadPluginVersions = () => {
    const allPlugins = enhancedPluginManager.getAllPlugins();
    const versionInfo: PluginVersionInfo[] = allPlugins.map(plugin => {
      const dependents = enhancedPluginManager.getPluginDependencies(plugin.id).dependents;
      
      return {
        id: plugin.id,
        name: plugin.name,
        currentVersion: plugin.version,
        dependents,
        canUpdate: true, // Simplified - in real implementation, check for update availability
        updateWarnings: dependents.length > 0 ? [`${dependents.length} plugins depend on this`] : []
      };
    });
    
    setPlugins(versionInfo);
  };

  const handleVersionUpdate = async () => {
    if (!selectedPlugin || !newVersion) return;

    setIsUpdating(true);
    try {
      const result = enhancedPluginManager.updatePluginVersion(selectedPlugin, newVersion);
      setUpdateResult(result);
      
      if (result.success) {
        loadPluginVersions(); // Refresh the list
        setNewVersion('');
      }
    } catch (error) {
      setUpdateResult({
        success: false,
        affectedPlugins: [],
        warnings: [error instanceof Error ? error.message : 'Unknown error']
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const validateVersion = (version: string): boolean => {
    const versionRegex = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9-]+)?$/;
    return versionRegex.test(version);
  };

  const getVersionBadgeColor = (version: string) => {
    if (version.includes('-')) {
      return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'; // Pre-release
    }
    return 'bg-blue-500/20 text-blue-300 border-blue-500/30'; // Stable
  };

  const selectedPluginInfo = plugins.find(p => p.id === selectedPlugin);

  return (
    <Card className="w-full max-w-4xl bg-black/90 backdrop-blur-xl border-white/20 text-white">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Package className="w-5 h-5 text-purple-400" />
          Plugin Version Manager
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Plugin List */}
        <div className="space-y-2">
          <h3 className="text-md font-medium flex items-center gap-2">
            <History className="w-4 h-4" />
            Installed Plugins
          </h3>
          
          <div className="grid gap-2 max-h-64 overflow-y-auto">
            {plugins.map(plugin => (
              <div
                key={plugin.id}
                className={`p-3 bg-white/5 rounded border border-white/10 cursor-pointer transition-colors ${
                  selectedPlugin === plugin.id ? 'bg-purple-500/20 border-purple-500/30' : 'hover:bg-white/10'
                }`}
                onClick={() => setSelectedPlugin(plugin.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{plugin.name}</span>
                    <Badge className={`text-xs ${getVersionBadgeColor(plugin.currentVersion)}`}>
                      v{plugin.currentVersion}
                    </Badge>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {plugin.dependents.length > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {plugin.dependents.length} dependents
                      </Badge>
                    )}
                    
                    {plugin.canUpdate && (
                      <Badge className="text-xs bg-green-500/20 text-green-300 border-green-500/30">
                        updatable
                      </Badge>
                    )}
                  </div>
                </div>
                
                {plugin.updateWarnings.length > 0 && (
                  <div className="mt-2 text-xs text-yellow-300">
                    ⚠️ {plugin.updateWarnings.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Version Update Section */}
        {selectedPluginInfo && (
          <div className="space-y-4 p-4 bg-black/20 rounded-lg border border-white/10">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-green-400" />
              <span className="font-medium">Update {selectedPluginInfo.name}</span>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  Current Version
                </label>
                <div className="p-2 bg-black/40 rounded border border-white/20">
                  <Badge className={`${getVersionBadgeColor(selectedPluginInfo.currentVersion)}`}>
                    v{selectedPluginInfo.currentVersion}
                  </Badge>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  New Version
                </label>
                <div className="flex gap-2">
                  <Input
                    value={newVersion}
                    onChange={(e) => setNewVersion(e.target.value)}
                    placeholder="e.g., 1.2.0"
                    className="bg-black/40 border-white/20"
                  />
                  <Button
                    onClick={handleVersionUpdate}
                    disabled={!newVersion || !validateVersion(newVersion) || isUpdating}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {isUpdating ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                {newVersion && !validateVersion(newVersion) && (
                  <div className="text-xs text-red-300 mt-1">
                    Invalid version format. Use semantic versioning (e.g., 1.2.0)
                  </div>
                )}
              </div>
            </div>

            {/* Dependents Warning */}
            {selectedPluginInfo.dependents.length > 0 && (
              <Alert className="border-yellow-500/50 bg-yellow-500/10">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-2">
                    <div>This plugin has {selectedPluginInfo.dependents.length} dependents:</div>
                    <div className="flex flex-wrap gap-1">
                      {selectedPluginInfo.dependents.map(dependent => (
                        <Badge key={dependent} variant="outline" className="text-xs">
                          {dependent}
                        </Badge>
                      ))}
                    </div>
                    <div className="text-sm">
                      Updating this plugin may affect these dependent plugins.
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Update Result */}
        {updateResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {updateResult.success ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-400" />
              )}
              <span className="font-medium">
                Update {updateResult.success ? 'Successful' : 'Failed'}
              </span>
            </div>

            {updateResult.success && updateResult.affectedPlugins.length > 0 && (
              <Alert className="border-yellow-500/50 bg-yellow-500/10">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-2">
                    <div>Affected plugins that may need attention:</div>
                    <div className="flex flex-wrap gap-1">
                      {updateResult.affectedPlugins.map((pluginId: string) => (
                        <Badge key={pluginId} variant="outline" className="text-xs">
                          {pluginId}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {updateResult.warnings.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-yellow-300">Warnings:</div>
                {updateResult.warnings.map((warning: string, index: number) => (
                  <div key={index} className="text-xs text-yellow-200 pl-4">
                    • {warning}
                  </div>
                ))}
              </div>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setUpdateResult(null)}
              className="text-white/60 hover:text-white"
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Version History (Placeholder) */}
        <div className="space-y-2">
          <h3 className="text-md font-medium flex items-center gap-2">
            <History className="w-4 h-4" />
            Version History
          </h3>
          
          <div className="p-4 bg-black/20 rounded-lg border border-white/10 text-center text-white/60">
            <div className="text-sm">Version history tracking coming soon...</div>
            <div className="text-xs mt-1">
              This will show previous versions, rollback options, and change logs.
            </div>
          </div>
        </div>

        {/* Bulk Operations */}
        <div className="space-y-2">
          <h3 className="text-md font-medium">Bulk Operations</h3>
          
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={loadPluginVersions}
              className="border-white/20"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh All
            </Button>
            
            <Button
              size="sm"
              variant="outline"
              disabled
              className="border-white/20 opacity-50"
            >
              <Download className="w-4 h-4 mr-2" />
              Check Updates
            </Button>
            
            <Button
              size="sm"
              variant="outline"
              disabled
              className="border-white/20 opacity-50"
            >
              <Upload className="w-4 h-4 mr-2" />
              Update All
            </Button>
          </div>
          
          <div className="text-xs text-white/60">
            Bulk operations will be available in a future update.
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PluginVersionManager;