"use client"

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { 
  Store, 
  Search, 
  Download, 
  Star, 
  Shield, 
  Zap,
  Users,
  Calendar,
  Filter,
  TrendingUp,
  CheckCircle,
  AlertTriangle,
  ExternalLink
} from 'lucide-react';
import { enhancedPluginRegistry } from '../../lib/plugins/enhanced-plugin-registry';
import { enhancedPluginManager } from '../../lib/plugins/enhanced-plugin-manager';

interface MarketplacePlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  rating: number;
  downloads: number;
  size: string;
  lastUpdated: string;
  verified: boolean;
  featured: boolean;
  tags: string[];
  screenshots: string[];
  dependencies: string[];
  permissions: string[];
  price: number; // 0 for free
  installed: boolean;
  compatible: boolean;
}

interface PluginMarketplaceProps {
  onClose?: () => void;
  onInstall?: (pluginId: string) => void;
}

export const PluginMarketplace: React.FC<PluginMarketplaceProps> = ({
  onClose,
  onInstall
}) => {
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
  const [filteredPlugins, setFilteredPlugins] = useState<MarketplacePlugin[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'rating' | 'downloads' | 'updated'>('rating');
  const [showOnlyFree, setShowOnlyFree] = useState(false);
  const [showOnlyCompatible, setShowOnlyCompatible] = useState(true);
  const [selectedPlugin, setSelectedPlugin] = useState<MarketplacePlugin | null>(null);

  useEffect(() => {
    loadMarketplacePlugins();
  }, []);

  useEffect(() => {
    filterAndSortPlugins();
  }, [plugins, searchTerm, selectedCategory, sortBy, showOnlyFree, showOnlyCompatible]);

  const loadMarketplacePlugins = () => {
    // Simulate marketplace data - in real implementation, this would fetch from an API
    const installedPlugins = enhancedPluginManager.getAllPlugins().map(p => p.id);
    
    const marketplaceData: MarketplacePlugin[] = [
      {
        id: 'calculator',
        name: 'Calculator',
        description: 'A powerful calculator with history and memory functions',
        version: '1.0.0',
        author: 'Kiro Team',
        category: 'utility',
        rating: 4.8,
        downloads: 15420,
        size: '2.1 MB',
        lastUpdated: '2024-01-15',
        verified: true,
        featured: true,
        tags: ['math', 'calculator', 'utility'],
        screenshots: [],
        dependencies: [],
        permissions: ['storage'],
        price: 0,
        installed: installedPlugins.includes('calculator'),
        compatible: true
      },
      {
        id: 'json-validator',
        name: 'JSON Validator',
        description: 'Validate, format, and analyze JSON data with advanced features',
        version: '1.0.0',
        author: 'Kiro Team',
        category: 'utility',
        rating: 4.6,
        downloads: 8930,
        size: '1.8 MB',
        lastUpdated: '2024-01-10',
        verified: true,
        featured: false,
        tags: ['json', 'validator', 'formatter', 'developer'],
        screenshots: [],
        dependencies: [],
        permissions: ['clipboard'],
        price: 0,
        installed: installedPlugins.includes('json-validator'),
        compatible: true
      },
      {
        id: 'url-utilities',
        name: 'URL Utilities',
        description: 'Comprehensive URL validation, shortening, and analysis tools',
        version: '1.0.0',
        author: 'Kiro Team',
        category: 'utility',
        rating: 4.4,
        downloads: 6750,
        size: '2.3 MB',
        lastUpdated: '2024-01-08',
        verified: true,
        featured: false,
        tags: ['url', 'validator', 'shortener', 'web'],
        screenshots: [],
        dependencies: [],
        permissions: ['network', 'clipboard'],
        price: 0,
        installed: installedPlugins.includes('url-utilities'),
        compatible: true
      },
      // Simulated third-party plugins
      {
        id: 'password-generator',
        name: 'Password Generator Pro',
        description: 'Generate secure passwords with customizable options and strength analysis',
        version: '2.1.0',
        author: 'SecureTools Inc.',
        category: 'security',
        rating: 4.9,
        downloads: 23450,
        size: '1.5 MB',
        lastUpdated: '2024-01-20',
        verified: true,
        featured: true,
        tags: ['password', 'security', 'generator'],
        screenshots: [],
        dependencies: [],
        permissions: ['clipboard'],
        price: 4.99,
        installed: false,
        compatible: true
      },
      {
        id: 'color-picker',
        name: 'Advanced Color Picker',
        description: 'Professional color picker with palette management and format conversion',
        version: '1.3.2',
        author: 'DesignTools',
        category: 'design',
        rating: 4.7,
        downloads: 12340,
        size: '3.2 MB',
        lastUpdated: '2024-01-12',
        verified: false,
        featured: false,
        tags: ['color', 'design', 'picker', 'palette'],
        screenshots: [],
        dependencies: ['canvas-api'],
        permissions: ['clipboard', 'storage'],
        price: 0,
        installed: false,
        compatible: false // Simulated incompatibility
      },
      {
        id: 'markdown-editor',
        name: 'Markdown Editor Plus',
        description: 'Feature-rich markdown editor with live preview and export options',
        version: '3.0.1',
        author: 'TextTools',
        category: 'utility',
        rating: 4.5,
        downloads: 18920,
        size: '4.1 MB',
        lastUpdated: '2024-01-18',
        verified: true,
        featured: false,
        tags: ['markdown', 'editor', 'text', 'preview'],
        screenshots: [],
        dependencies: ['note-taker'],
        permissions: ['storage', 'filesystem'],
        price: 2.99,
        installed: false,
        compatible: true
      }
    ];

    setPlugins(marketplaceData);
  };

  const filterAndSortPlugins = () => {
    let filtered = [...plugins];

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(plugin =>
        plugin.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        plugin.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        plugin.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    // Apply category filter
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(plugin => plugin.category === selectedCategory);
    }

    // Apply price filter
    if (showOnlyFree) {
      filtered = filtered.filter(plugin => plugin.price === 0);
    }

    // Apply compatibility filter
    if (showOnlyCompatible) {
      filtered = filtered.filter(plugin => plugin.compatible);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'rating':
          return b.rating - a.rating;
        case 'downloads':
          return b.downloads - a.downloads;
        case 'updated':
          return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
        default:
          return 0;
      }
    });

    setFilteredPlugins(filtered);
  };

  const handleInstall = async (plugin: MarketplacePlugin) => {
    try {
      // Simulate installation process
      console.log(`Installing plugin: ${plugin.name}`);
      
      // Update plugin status
      setPlugins(prev => prev.map(p => 
        p.id === plugin.id ? { ...p, installed: true } : p
      ));

      onInstall?.(plugin.id);
    } catch (error) {
      console.error('Installation failed:', error);
    }
  };

  const getCategories = () => {
    const categories = [...new Set(plugins.map(p => p.category))];
    return categories.sort();
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'utility': return <Zap className="w-4 h-4" />;
      case 'security': return <Shield className="w-4 h-4" />;
      case 'design': return <Star className="w-4 h-4" />;
      default: return <Store className="w-4 h-4" />;
    }
  };

  return (
    <div className="w-full max-w-7xl bg-black/90 backdrop-blur-xl border border-white/20 rounded-lg text-white overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-white/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Store className="w-8 h-8 text-purple-400" />
            <div>
              <h1 className="text-2xl font-bold">Plugin Marketplace</h1>
              <p className="text-white/60">Discover and install plugins to extend functionality</p>
            </div>
          </div>
          
          {onClose && (
            <Button size="sm" variant="ghost" onClick={onClose}>
              ×
            </Button>
          )}
        </div>

        {/* Search and Filters */}
        <div className="mt-6 space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search plugins..."
                className="pl-10 bg-black/40 border-white/20"
              />
            </div>
            
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-black/40 border border-white/20 rounded px-3 py-2 text-white"
            >
              <option value="all">All Categories</option>
              {getCategories().map(category => (
                <option key={category} value={category}>
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </option>
              ))}
            </select>
            
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-black/40 border border-white/20 rounded px-3 py-2 text-white"
            >
              <option value="rating">Sort by Rating</option>
              <option value="downloads">Sort by Downloads</option>
              <option value="name">Sort by Name</option>
              <option value="updated">Sort by Updated</option>
            </select>
          </div>

          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyFree}
                onChange={(e) => setShowOnlyFree(e.target.checked)}
                className="rounded"
              />
              <span>Free only</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyCompatible}
                onChange={(e) => setShowOnlyCompatible(e.target.checked)}
                className="rounded"
              />
              <span>Compatible only</span>
            </label>
          </div>
        </div>
      </div>

      {/* Plugin Grid */}
      <div className="p-6">
        {filteredPlugins.length === 0 ? (
          <div className="text-center py-12 text-white/60">
            <Store className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No plugins found</h3>
            <p>Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPlugins.map(plugin => (
              <Card key={plugin.id} className="bg-black/40 border-white/20 hover:border-white/30 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {getCategoryIcon(plugin.category)}
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {plugin.name}
                          {plugin.verified && (
                            <CheckCircle className="w-4 h-4 text-blue-400" title="Verified" />
                          )}
                          {plugin.featured && (
                            <Star className="w-4 h-4 text-yellow-400" title="Featured" />
                          )}
                        </CardTitle>
                        <p className="text-sm text-white/60">by {plugin.author}</p>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm">
                        <Star className="w-3 h-3 text-yellow-400" />
                        <span>{plugin.rating}</span>
                      </div>
                      <div className="text-xs text-white/60">
                        {formatNumber(plugin.downloads)} downloads
                      </div>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  <p className="text-sm text-white/80 line-clamp-2">
                    {plugin.description}
                  </p>
                  
                  <div className="flex flex-wrap gap-1">
                    {plugin.tags.slice(0, 3).map(tag => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-white/60">
                    <span>v{plugin.version}</span>
                    <span>{plugin.size}</span>
                    <span>{new Date(plugin.lastUpdated).toLocaleDateString()}</span>
                  </div>
                  
                  {!plugin.compatible && (
                    <Alert className="border-yellow-500/50 bg-yellow-500/10">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        This plugin may not be compatible with your current setup
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  <div className="flex gap-2">
                    {plugin.installed ? (
                      <Button size="sm" disabled className="flex-1">
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Installed
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleInstall(plugin)}
                        disabled={!plugin.compatible}
                        className="flex-1 bg-purple-600 hover:bg-purple-700"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        {plugin.price > 0 ? `$${plugin.price}` : 'Install'}
                      </Button>
                    )}
                    
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedPlugin(plugin)}
                      className="border-white/20"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PluginMarketplace;