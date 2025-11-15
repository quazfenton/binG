"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { 
  Search, 
  Grid3X3, 
  List, 
  Filter,
  Code,
  Database,
  Brain,
  Wrench,
  Layout,
  FileText,
  Globe,
  Cpu,
  Github,
  Cog,
  Zap,
  Star,
  Download,
  ExternalLink,
  Plus,
  XCircle
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import type { Plugin } from './plugin-manager';
import { enhancedPluginRegistry } from '../../lib/plugins/enhanced-plugin-registry';
import { toast } from 'sonner';

interface PluginMarketplaceProps {
  onPluginLaunch?: (pluginId: string) => void;
  onPluginClose?: () => void;
  viewMode?: 'grid' | 'list';
}

// Map categories to icons
const categoryIcons: Record<string, React.ComponentType<any>> = {
  ai: Brain,
  code: Code,
  data: Database,
  utility: Wrench,
  design: Layout,
  media: Layout,
  default: Cog
};

const PluginMarketplace: React.FC<PluginMarketplaceProps> = ({ 
  onPluginLaunch,
  onPluginClose,
  viewMode = 'grid'
}) => {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [displayMode, setDisplayMode] = useState<'grid' | 'list'>(viewMode);

  // Load plugins
  useEffect(() => {
    const loadPlugins = async () => {
      setIsLoading(true);
      try {
        const allPlugins = await enhancedPluginRegistry.getAllPlugins();
        setPlugins(allPlugins);
      } catch (error) {
        console.error('Failed to load plugins:', error);
        toast.error('Failed to load plugins');
      } finally {
        setIsLoading(false);
      }
    };

    loadPlugins();
  }, []);

  // Filter plugins based on search and category
  const filteredPlugins = plugins.filter(plugin => {
    const matchesSearch = plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          plugin.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || plugin.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  // Get unique categories
  const categories = ['all', ...enhancedPluginRegistry.getCategories()];

  const handleLaunch = (pluginId: string) => {
    if (onPluginLaunch) {
      onPluginLaunch(pluginId);
    }
    toast.success(`Launching ${pluginId}...`);
  };

  const renderPluginCard = (plugin: Plugin) => {
    const IconComponent = categoryIcons[plugin.category] || categoryIcons.default;
    
    return (
      <Card 
        key={plugin.id} 
        className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer border-white/10 hover:border-white/30"
        onClick={() => handleLaunch(plugin.id)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-black/40">
                <IconComponent className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {plugin.name}
                  {plugin.enhanced && (
                    <Badge variant="secondary" className="text-xs">Enhanced</Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  {plugin.description}
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-xs">
              {plugin.category}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              <Badge variant="secondary" className="text-xs">v1.0</Badge>
              <Badge variant="outline" className="text-xs">Utility</Badge>
            </div>
            <Button size="sm" variant="outline" className="text-xs">
              <Plus className="w-3 h-3 mr-1" />
              Launch
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderPluginListItem = (plugin: Plugin) => {
    const IconComponent = categoryIcons[plugin.category] || categoryIcons.default;
    
    return (
      <Card 
        key={plugin.id} 
        className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer border-white/10 hover:border-white/30 mb-2"
        onClick={() => handleLaunch(plugin.id)}
      >
        <CardContent className="p-4 flex items-center gap-4">
          <div className="p-2 rounded-lg bg-black/40">
            <IconComponent className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{plugin.name}</h3>
              {plugin.enhanced && (
                <Badge variant="secondary" className="text-xs">Enhanced</Badge>
              )}
            </div>
            <p className="text-sm text-white/70 mt-1">{plugin.description}</p>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="text-xs">
                {plugin.category}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                v1.0
              </Badge>
            </div>
          </div>
          <Button size="sm">
            <Plus className="w-3 h-3 mr-1" />
            Launch
          </Button>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Grid3X3 className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold">Plugin Marketplace</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onPluginClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search plugins..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-black/40 border-white/20"
            />
          </div>
          
          <Tabs 
            value={selectedCategory} 
            onValueChange={setSelectedCategory}
            className="w-full sm:w-auto"
          >
            <TabsList className="bg-black/40 flex flex-wrap sm:flex-nowrap">
              {categories.map(category => (
                <TabsTrigger 
                  key={category} 
                  value={category} 
                  className="data-[state=active]:bg-blue-500/20 text-xs"
                >
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="p-4 flex items-center justify-between">
        <div className="text-sm text-white/60">
          {filteredPlugins.length} of {plugins.length} plugins
        </div>
        <div className="flex gap-2">
          <Button 
            size="sm" 
            variant={displayMode === 'grid' ? 'default' : 'outline'}
            onClick={() => setDisplayMode('grid')}
          >
            <Grid3X3 className="w-4 h-4" />
          </Button>
          <Button 
            size="sm" 
            variant={displayMode === 'list' ? 'default' : 'outline'}
            onClick={() => setDisplayMode('list')}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
        ) : filteredPlugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 text-white/60">
            <Search className="w-12 h-12 mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-1">No plugins found</h3>
            <p className="text-sm">Try a different search term or category</p>
          </div>
        ) : displayMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPlugins.map(renderPluginCard)}
          </div>
        ) : (
          <div>
            {filteredPlugins.map(renderPluginListItem)}
          </div>
        )}
      </ScrollArea>

      {plugins.length > 0 && (
        <div className="p-4 border-t border-white/10 text-center text-xs text-white/60">
          {enhancedPluginRegistry.getPluginStats().enhanced} enhanced plugins available
        </div>
      )}
    </div>
  );
};

export default PluginMarketplace;