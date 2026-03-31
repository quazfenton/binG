/**
 * MCP Store & Discovery UI Component
 *
 * Features:
 * - Browse and search MCP servers
 * - Install/uninstall servers
 * - Manage API keys
 * - View server status
 * - Add custom servers
 * - Smithery integration
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { mcpStoreService, type MCPServerPackage, type MCPApiKeyConfig } from "@/lib/mcp/mcp-store-service";
import { mcpToolRegistry } from "@/lib/mcp/registry";

import {
  Search,
  Package,
  Download,
  Trash2,
  Settings,
  Key,
  Plus,
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
  Star,
  Shield,
  Zap,
  Globe,
  Terminal,
  Save,
  RefreshCw,
  Filter,
  Tag,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface MCPServerCardProps {
  server: MCPServerPackage;
  onInstall: (server: MCPServerPackage) => void;
  onUninstall: (server: MCPServerPackage) => void;
  onToggleEnabled: (server: MCPServerPackage) => void;
  onManageApiKeys: (server: MCPServerPackage) => void;
}

interface APIKeyDialogProps {
  server: MCPServerPackage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (keys: Record<string, string>) => void;
}

interface AddCustomServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (config: {
    name: string;
    displayName: string;
    description: string;
    mcpUrl: string;
    transportType: 'stdio' | 'http' | 'websocket';
    apiKeys?: MCPApiKeyConfig[];
    tags?: string[];
  }) => void;
}

// ============================================================================
// MCP Server Card Component
// ============================================================================

function MCPServerCard({
  server,
  onInstall,
  onUninstall,
  onToggleEnabled,
  onManageApiKeys,
}: MCPServerCardProps) {
  const [isInstalling, setIsInstalling] = useState(false);

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      const success = await mcpStoreService.installServer(server.id);
      if (success) {
        toast.success(`Installed ${server.displayName}`);
        onInstall(server);
      } else {
        toast.error(`Failed to install ${server.displayName}`);
      }
    } catch (error: any) {
      toast.error(`Installation error: ${error.message}`);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleUninstall = async () => {
    if (!confirm(`Uninstall ${server.displayName}?`)) return;

    try {
      const success = await mcpStoreService.uninstallServer(server.id);
      if (success) {
        toast.success(`Uninstalled ${server.displayName}`);
        onUninstall(server);
      }
    } catch (error: any) {
      toast.error(`Uninstall error: ${error.message}`);
    }
  };

  return (
    <Card className={cn(
      "transition-all duration-200",
      server.installed && server.enabled ? "border-green-400/50 bg-green-500/5" : "",
      server.installed && !server.enabled ? "border-yellow-400/50 bg-yellow-500/5" : "",
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {server.iconUrl ? (
              <img
                src={server.iconUrl}
                alt={server.displayName}
                className="w-10 h-10 rounded-lg object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                <Package className="w-5 h-5 text-white" />
              </div>
            )}
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {server.displayName}
                {server.verified && (
                  <Shield className="w-4 h-4 text-blue-400" />
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                {server.author && <span>{server.author} • </span>}
                <span className="capitalize">{server.source}</span>
              </CardDescription>
            </div>
          </div>
          {server.starCount !== undefined && server.starCount > 0 && (
            <div className="flex items-center gap-1 text-yellow-400">
              <Star className="w-4 h-4 fill-current" />
              <span className="text-xs font-medium">{server.starCount}</span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-white/70 line-clamp-2">{server.description}</p>

        {/* Tags */}
        {server.tags && server.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {server.tags.map((tag, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">
                <Tag className="w-2.5 h-2.5 mr-1" />
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Status & Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-white/10">
          <div className="flex items-center gap-2">
            {server.installed ? (
              <Badge className="bg-green-500/20 text-green-400 border-green-400/50">
                <CheckCircle className="w-3 h-3 mr-1" />
                Installed
              </Badge>
            ) : (
              <Badge variant="outline" className="text-white/50">
                Not installed
              </Badge>
            )}
            {server.installed && (
              <Switch
                checked={server.enabled}
                onCheckedChange={(checked) => onToggleEnabled({ ...server, enabled: checked })}
                className="scale-75"
              />
            )}
          </div>

          <div className="flex items-center gap-1">
            {server.installed ? (
              <>
                {server.apiKeys && server.apiKeys.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onManageApiKeys(server)}
                    title="Manage API keys"
                  >
                    <Key className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-400 hover:text-red-300"
                  onClick={handleUninstall}
                  disabled={isInstalling}
                  title="Uninstall"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="h-8"
                onClick={handleInstall}
                disabled={isInstalling}
              >
                {isInstalling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-1" />
                    Install
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// API Key Management Dialog
// ============================================================================

function APIKeyDialog({
  server,
  open,
  onOpenChange,
  onSave,
}: APIKeyDialogProps) {
  const [keys, setKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && server.apiKeys) {
      const existingKeys: Record<string, string> = {};
      for (const apiKey of server.apiKeys) {
        const storedValue = mcpStoreService.getApiKey(server.id, apiKey.name);
        if (storedValue) {
          existingKeys[apiKey.name] = storedValue;
        }
      }
      setKeys(existingKeys);
    }
  }, [open, server]);

  const handleSave = () => {
    onSave(keys);
    onOpenChange(false);
    toast.success("API keys saved");
  };

  if (!server.apiKeys || server.apiKeys.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage API Keys</DialogTitle>
          <DialogDescription>
            Configure API keys for {server.displayName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {server.apiKeys.map((apiKey) => (
            <div key={apiKey.name} className="space-y-2">
              <Label htmlFor={`key-${apiKey.name}`}>
                {apiKey.name}
                {apiKey.required && <span className="text-red-400 ml-1">*</span>}
              </Label>
              <Input
                id={`key-${apiKey.name}`}
                type="password"
                placeholder={`Enter ${apiKey.name}`}
                value={keys[apiKey.name] || ''}
                onChange={(e) => setKeys({ ...keys, [apiKey.name]: e.target.value })}
                className="bg-white/5 border-white/20"
              />
              {apiKey.description && (
                <p className="text-xs text-white/50">{apiKey.description}</p>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Save Keys
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Add Custom Server Dialog
// ============================================================================

function AddCustomServerDialog({
  open,
  onOpenChange,
  onAdd,
}: AddCustomServerDialogProps) {
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    description: '',
    mcpUrl: '',
    transportType: 'http' as 'stdio' | 'http' | 'websocket',
  });

  const handleSubmit = () => {
    if (!formData.name || !formData.mcpUrl) {
      toast.error("Name and MCP URL are required");
      return;
    }

    onAdd({
      ...formData,
      tags: ['custom'],
    });
    onOpenChange(false);
    setFormData({
      name: '',
      displayName: '',
      description: '',
      mcpUrl: '',
      transportType: 'http',
    });
    toast.success("Custom server added");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Custom MCP Server</DialogTitle>
          <DialogDescription>
            Add a custom MCP server configuration
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="custom-name">Name (ID)</Label>
            <Input
              id="custom-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="my-custom-server"
              className="bg-white/5 border-white/20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-display">Display Name</Label>
            <Input
              id="custom-display"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="My Custom Server"
              className="bg-white/5 border-white/20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-desc">Description</Label>
            <Input
              id="custom-desc"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Description of your server"
              className="bg-white/5 border-white/20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-url">MCP URL</Label>
            <Input
              id="custom-url"
              value={formData.mcpUrl}
              onChange={(e) => setFormData({ ...formData, mcpUrl: e.target.value })}
              placeholder="http://localhost:3001/mcp"
              className="bg-white/5 border-white/20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-transport">Transport Type</Label>
            <select
              id="custom-transport"
              value={formData.transportType}
              onChange={(e) => setFormData({ ...formData, transportType: e.target.value as any })}
              className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-md text-sm text-white"
            >
              <option value="http">HTTP</option>
              <option value="stdio">Stdio</option>
              <option value="websocket">WebSocket</option>
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            <Plus className="w-4 h-4 mr-2" />
            Add Server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Main MCP Store Component
// ============================================================================

export function MCPStore() {
  const [servers, setServers] = useState<MCPServerPackage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState<'all' | MCPServerPackage['source']>('all');
  const [filterInstalled, setFilterInstalled] = useState<'all' | 'installed' | 'not-installed'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedServer, setSelectedServer] = useState<MCPServerPackage | null>(null);
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showAddCustomDialog, setShowAddCustomDialog] = useState(false);
  const [stats, setStats] = useState(mcpStoreService.getStats());

  // Load servers on mount
  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = useCallback(() => {
    setIsLoading(true);
    const allServers = mcpStoreService.getAllServers();
    setServers(allServers);
    setStats(mcpStoreService.getStats());
    setIsLoading(false);
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const config = mcpStoreService.getConfig();
      if (!config.smitheryApiKey) {
        toast.error("Smithery API key is not configured");
        setIsSyncing(false);
        return;
      }
      
      const newServers = await mcpStoreService.syncWithSmithery();
      toast.success(`Synced ${newServers.length} servers from Smithery`);
      loadServers();
    } catch (error: any) {
      toast.error(`Sync failed: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleInstall = useCallback((server: MCPServerPackage) => {
    loadServers();
  }, [loadServers]);

  const handleUninstall = useCallback((server: MCPServerPackage) => {
    loadServers();
  }, [loadServers]);

  const handleToggleEnabled = useCallback((server: MCPServerPackage) => {
    mcpStoreService.setServerEnabled(server.id, server.enabled);
    loadServers();
  }, [loadServers]);

  const handleManageApiKeys = useCallback((server: MCPServerPackage) => {
    setSelectedServer(server);
    setShowApiKeyDialog(true);
  }, []);

  const handleSaveApiKeys = useCallback((keys: Record<string, string>) => {
    if (!selectedServer) return;
    for (const [keyName, value] of Object.entries(keys)) {
      mcpStoreService.storeApiKey(selectedServer.id, keyName, value);
    }
  }, [selectedServer]);

  const handleAddCustomServer = useCallback((config: any) => {
    mcpStoreService.addCustomServer(config);
    loadServers();
  }, [loadServers]);

  // Filter servers
  const filteredServers = servers.filter(server => {
    if (filterSource !== 'all' && server.source !== filterSource) return false;
    if (filterInstalled === 'installed' && !server.installed) return false;
    if (filterInstalled === 'not-installed' && server.installed) return false;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        server.name.toLowerCase().includes(query) ||
        server.displayName.toLowerCase().includes(query) ||
        server.description.toLowerCase().includes(query)
      );
    }
    
    return true;
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
        <div>
          <h2 className="text-lg font-semibold text-white">MCP Store</h2>
          <p className="text-xs text-white/60">
            {stats.installedServers} installed • {stats.activeServers} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={isSyncing}
            className="border-white/20"
          >
            {isSyncing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Sync Smithery
          </Button>
          <Button
            size="sm"
            onClick={() => setShowAddCustomDialog(true)}
            className="bg-purple-500 hover:bg-purple-600"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Custom
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search MCP servers..."
            className="pl-10 bg-white/5 border-white/20"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-white/40" />
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value as any)}
            className="px-3 py-2 bg-white/5 border border-white/20 rounded-md text-sm text-white"
          >
            <option value="all">All Sources</option>
            <option value="smithery">Smithery</option>
            <option value="local">Local</option>
            <option value="custom">Custom</option>
          </select>
          
          <select
            value={filterInstalled}
            onChange={(e) => setFilterInstalled(e.target.value as any)}
            className="px-3 py-2 bg-white/5 border border-white/20 rounded-md text-sm text-white"
          >
            <option value="all">All</option>
            <option value="installed">Installed</option>
            <option value="not-installed">Not Installed</option>
          </select>
        </div>
      </div>

      {/* Server Grid */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            </div>
          ) : filteredServers.length === 0 ? (
            <div className="text-center py-12 text-white/60">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No MCP servers found</p>
              <p className="text-sm mt-1">Try adjusting your filters or sync with Smithery</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredServers.map((server) => (
                <MCPServerCard
                  key={server.id}
                  server={server}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onToggleEnabled={handleToggleEnabled}
                  onManageApiKeys={handleManageApiKeys}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Dialogs */}
      {selectedServer && (
        <APIKeyDialog
          server={selectedServer}
          open={showApiKeyDialog}
          onOpenChange={setShowApiKeyDialog}
          onSave={handleSaveApiKeys}
        />
      )}

      <AddCustomServerDialog
        open={showAddCustomDialog}
        onOpenChange={setShowAddCustomDialog}
        onAdd={handleAddCustomServer}
      />
    </div>
  );
}

export default MCPStore;
