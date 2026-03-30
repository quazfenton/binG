"use client"

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Alert, AlertDescription } from '../ui/alert'
import { 
  Store, 
  Search, 
  Download, 
  Star, 
  Shield, 
  Zap,
  CheckCircle,
  AlertTriangle,
  ExternalLink
} from 'lucide-react'
import { toast } from 'sonner'

interface Plugin {
  id: string
  name: string
  description: string
  version: string
  author: string
  category: string
  icon?: string
  installed: boolean
  enabled?: boolean
  downloads?: number
  rating?: number
  tags?: string[]
  size?: string
  lastUpdated?: string
  verified?: boolean
  featured?: boolean
  price?: number
  compatible?: boolean
}

interface PluginMarketplaceProps {
  onClose?: () => void
  onInstall?: (pluginId: string) => void
}

export default function PluginMarketplace({ onClose, onInstall }: PluginMarketplaceProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [installedPlugins, setInstalledPlugins] = useState<Set<string>>(new Set())
  const [showOnlyFree, setShowOnlyFree] = useState(false)
  const [showOnlyCompatible, setShowOnlyCompatible] = useState(true)
  const [sortBy, setSortBy] = useState<'rating' | 'downloads' | 'name' | 'updated'>('rating')
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null)

  // Load plugins from API or use mock data
  useEffect(() => {
    loadPlugins()
  }, [])

  const loadPlugins = async () => {
    try {
      setLoading(true)
      
      // Try to fetch from API
      try {
        const marketplaceRes = await fetch('/api/plugins/marketplace')
        const installedRes = await fetch('/api/plugins/installed')
        
        if (marketplaceRes.ok && installedRes.ok) {
          const marketplaceData = await marketplaceRes.json()
          const installedData = await installedRes.json()
          
          const installedIds = new Set<string>((installedData.plugins || []).map((p: any) => p.id))
          setInstalledPlugins(installedIds)
          
          const merged = (marketplaceData.plugins || []).map((plugin: any) => ({
            ...plugin,
            installed: installedIds.has(plugin.id),
          }))
          
          setPlugins(merged)
          setLoading(false)
          return
        }
      } catch (e) {
        // API not available, use mock data
        console.log('[PluginMarketplace] API not available, using mock data')
      }
      
      // Mock data when API is not available
      const mockPlugins: Plugin[] = [
        {
          id: 'calculator',
          name: 'Calculator',
          description: 'Advanced calculator with scientific functions and history',
          version: '1.2.0',
          author: 'binG Team',
          category: 'utility',
          rating: 4.8,
          downloads: 15420,
          size: '2.1 MB',
          lastUpdated: '2024-01-15',
          verified: true,
          featured: true,
          tags: ['math', 'calculator', 'utility'],
          price: 0,
          installed: false,
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
          tags: ['json', 'validator', 'formatter', 'developer'],
          price: 0,
          installed: false,
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
          tags: ['url', 'validator', 'shortener', 'web'],
          price: 0,
          installed: false,
          compatible: true
        },
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
          tags: ['color', 'design', 'picker', 'palette'],
          price: 0,
          installed: false,
          compatible: false
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
          tags: ['markdown', 'editor', 'text', 'preview'],
          price: 2.99,
          installed: false,
          compatible: true
        }
      ]
      
      setPlugins(mockPlugins)
    } catch (err: any) {
      console.error('[PluginMarketplace] Failed to load plugins:', err)
      toast.error('Failed to load plugins')
    } finally {
      setLoading(false)
    }
  }

  const filteredPlugins = React.useMemo(() => {
    let filtered = [...plugins]

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(plugin =>
        plugin.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        plugin.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (plugin.tags && plugin.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())))
      )
    }

    // Apply category filter
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(plugin => plugin.category === selectedCategory)
    }

    // Apply price filter
    if (showOnlyFree) {
      filtered = filtered.filter(plugin => plugin.price === 0)
    }

    // Apply compatibility filter
    if (showOnlyCompatible) {
      filtered = filtered.filter(plugin => plugin.compatible !== false)
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'rating':
          return (b.rating || 0) - (a.rating || 0)
        case 'downloads':
          return (b.downloads || 0) - (a.downloads || 0)
        case 'updated':
          return new Date(b.lastUpdated || '').getTime() - new Date(a.lastUpdated || '').getTime()
        default:
          return 0
      }
    })

    return filtered
  }, [plugins, searchTerm, selectedCategory, showOnlyFree, showOnlyCompatible, sortBy])

  const handleInstall = async (plugin: Plugin) => {
    try {
      // Try API first
      try {
        const response = await fetch(`/api/plugins/${plugin.id}/install`, {
          method: 'POST',
        })
        
        const result = await response.json()
        
        if (result.success) {
          setPlugins(prev => prev.map(p =>
            p.id === plugin.id ? { ...p, installed: true } : p
          ))
          setInstalledPlugins(prev => new Set(prev).add(plugin.id))
          toast.success(`Installed ${plugin.name}`)
          onInstall?.(plugin.id)
          return
        }
      } catch (e) {
        // API not available, simulate installation
      }
      
      // Simulate installation
      setPlugins(prev => prev.map(p =>
        p.id === plugin.id ? { ...p, installed: true } : p
      ))
      setInstalledPlugins(prev => new Set(prev).add(plugin.id))
      toast.success(`Installed ${plugin.name}`)
      onInstall?.(plugin.id)
    } catch (err: any) {
      console.error('Installation failed:', err)
      toast.error(err.message || 'Installation failed')
    }
  }

  const handleUninstall = async (plugin: Plugin) => {
    try {
      setPlugins(prev => prev.map(p =>
        p.id === plugin.id ? { ...p, installed: false } : p
      ))
      setInstalledPlugins(prev => {
        const next = new Set(prev)
        next.delete(plugin.id)
        return next
      })
      toast.success(`Uninstalled ${plugin.name}`)
    } catch (err: any) {
      console.error('Uninstallation failed:', err)
      toast.error(err.message || 'Uninstallation failed')
    }
  }

  const getCategories = () => {
    const categories = [...new Set(plugins.map(p => p.category))]
    return categories.sort()
  }

  const formatNumber = (num?: number): string => {
    if (!num) return '0'
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'utility': return <Zap className="w-4 h-4" />
      case 'security': return <Shield className="w-4 h-4" />
      case 'design': return <Star className="w-4 h-4" />
      default: return <Store className="w-4 h-4" />
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-7xl bg-black/90 backdrop-blur-xl border border-white/20 rounded-lg text-white p-12 text-center">
        <Store className="w-12 h-12 mx-auto mb-4 animate-pulse text-purple-400" />
        <p className="text-white/60">Loading plugins...</p>
      </div>
    )
  }

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
              <p className="text-xs text-white/40 mt-1">Catalog last updated: Jan 20, 2024</p>
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
                            <CheckCircle className="w-4 h-4 text-blue-400" />
                          )}
                          {plugin.featured && (
                            <Star className="w-4 h-4 text-yellow-400" />
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
                    {plugin.tags?.slice(0, 3).map(tag => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-white/60">
                    <span>v{plugin.version}</span>
                    <span>{plugin.size}</span>
                    <span>{plugin.lastUpdated ? new Date(plugin.lastUpdated).toLocaleDateString() : 'N/A'}</span>
                  </div>
                  
                  {plugin.compatible === false && (
                    <Alert className="border-yellow-500/50 bg-yellow-500/10">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        This plugin may not be compatible with your current setup
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  <div className="flex gap-2">
                    {plugin.installed ? (
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleUninstall(plugin)}
                        className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                      >
                        Uninstall
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleInstall(plugin)}
                        disabled={plugin.compatible === false}
                        className="flex-1 bg-purple-600 hover:bg-purple-700"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        {plugin.price && plugin.price > 0 ? `$${plugin.price}` : 'Install'}
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
  )
}