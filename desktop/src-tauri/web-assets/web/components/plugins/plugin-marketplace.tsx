"use client"

import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardContent } from '../ui/card'
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
  ExternalLink,
  Sparkles,
  ArrowRight,
  Info,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'

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

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function formatNumber(num?: number): string {
  if (!num) return '0'
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
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

  // Memoize categories to prevent recomputation on every render
  const categories = useMemo(() => {
    return [...new Set(plugins.map(p => p.category))].sort()
  }, [plugins])

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
              {categories.map(category => (
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
            <AnimatePresence>
              {filteredPlugins.map((plugin, index) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  index={index}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onViewDetails={() => toast.info(`${plugin.name} details are coming soon`)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Redesigned Plugin Card Component
// ---------------------------------------------------------------------------

function PluginCard({
  plugin,
  index,
  onInstall,
  onUninstall,
  onViewDetails,
}: {
  plugin: Plugin
  index: number
  onInstall: (plugin: Plugin) => void
  onUninstall: (plugin: Plugin) => void
  onViewDetails: () => void
}) {
  const [isHovered, setIsHovered] = useState(false)

  const categoryColors: Record<string, string> = {
    utility: 'from-emerald-500/20 to-teal-500/20 border-emerald-500/30',
    security: 'from-red-500/20 to-orange-500/20 border-red-500/30',
    design: 'from-pink-500/20 to-purple-500/20 border-pink-500/30',
    dev: 'from-blue-500/20 to-cyan-500/20 border-blue-500/30',
    social: 'from-indigo-500/20 to-violet-500/20 border-indigo-500/30',
    media: 'from-green-500/20 to-emerald-500/20 border-green-500/30',
  }

  const gradientClass = categoryColors[plugin.category] || 'from-purple-500/20 to-pink-500/20 border-purple-500/30'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative"
    >
      {/* Gradient Border Glow */}
      <div className={`absolute -inset-0.5 bg-gradient-to-r ${gradientClass} rounded-xl blur opacity-30 group-hover:opacity-60 transition duration-500`} />
      
      {/* Card Content */}
      <Card className="relative bg-black/80 backdrop-blur-xl border-white/10 rounded-xl overflow-hidden h-full">
        {/* Featured/Verified Badges */}
        {(plugin.featured || plugin.verified) && (
          <div className="absolute top-3 right-3 flex gap-1 z-10">
            {plugin.featured && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border border-yellow-500/30 rounded-full p-1.5"
              >
                <Sparkles className="w-3 h-3 text-yellow-400" />
              </motion.div>
            )}
            {plugin.verified && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-500/30 rounded-full p-1.5"
              >
                <CheckCircle className="w-3 h-3 text-blue-400" />
              </motion.div>
            )}
          </div>
        )}

        <CardContent className="p-5 space-y-4">
          {/* Header Section */}
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-white truncate group-hover:text-purple-300 transition-colors">
                  {plugin.name}
                </h3>
                <p className="text-xs text-white/50">by {plugin.author}</p>
              </div>
            </div>

            {/* Rating & Downloads */}
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1 text-yellow-400">
                <Star className="w-3.5 h-3.5 fill-current" />
                <span className="font-medium">{plugin.rating}</span>
              </div>
              <div className="flex items-center gap-1 text-white/60">
                <Download className="w-3 h-3" />
                <span>{formatNumber(plugin.downloads)}</span>
              </div>
              {plugin.size && (
                <span className="text-white/40">•</span>
              )}
              {plugin.size && (
                <span className="text-white/50">{plugin.size}</span>
              )}
            </div>
          </div>

          {/* Description - Shows full on hover */}
          <div className="relative min-h-[3.5rem]">
            <AnimatePresence mode="wait">
              {isHovered ? (
                <motion.p
                  key="hover"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="text-sm text-white/80 leading-relaxed"
                >
                  {plugin.description}
                </motion.p>
              ) : (
                <motion.p
                  key="default"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="text-sm text-white/70 line-clamp-2 leading-relaxed"
                >
                  {plugin.description}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            {plugin.tags?.slice(0, 4).map((tag, i) => (
              <motion.div
                key={tag}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
              >
                <Badge
                  variant="outline"
                  className="text-xs bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-default"
                >
                  {tag}
                </Badge>
              </motion.div>
            ))}
          </div>

          {/* Compatibility Warning */}
          {plugin.compatible === false && (
            <Alert className="border-yellow-500/30 bg-yellow-500/5">
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
              <AlertDescription className="text-xs text-yellow-500/80">
                Compatibility issues detected
              </AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2 border-t border-white/5">
            {plugin.installed ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (window.confirm(`Are you sure you want to uninstall "${plugin.name}"?`)) {
                    onUninstall(plugin);
                  }
                }}
                className="flex-1 bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition-all duration-300"
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                Uninstall
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => onInstall(plugin)}
                disabled={plugin.compatible === false}
                className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white border-0 transition-all duration-300 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                {plugin.price && plugin.price > 0 ? `$${plugin.price}` : 'Install'}
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={onViewDetails}
              className="border-white/10 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-all duration-300"
            >
              <Info className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Hover Arrow Indicator */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: isHovered ? 1 : 0, x: isHovered ? 0 : -10 }}
            className="absolute bottom-5 right-5 text-purple-400"
          >
            <ArrowRight className="w-4 h-4" />
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
