/**
 * Vercel Media Site Embed Plugin
 * 
 * Embed custom Vercel-deployed sites with media content
 * Supports: portfolios, galleries, media players, interactive experiences
 */

"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import {
  Globe,
  X,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Bookmark,
  BookmarkCheck,
  Clock,
  Shield,
  Link as LinkIcon,
  Copy,
  Check,
  AlertCircle,
  Film,
  Music,
  Image,
  Layout,
  Plus,
  Trash,
  Edit,
  Save,
  Settings,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';

interface SiteEntry {
  id: string;
  name: string;
  url: string;
  category: 'portfolio' | 'gallery' | 'player' | 'interactive' | 'other';
  thumbnail?: string;
  isFavorite: boolean;
  lastVisited?: number;
}

interface VercelMediaEmbedPluginProps {
  onClose?: () => void;
  initialUrl?: string;
}

const DEFAULT_SITES: SiteEntry[] = [
  {
    id: '1',
    name: 'Vercel Showcase',
    url: 'https://vercel.com/showcase',
    category: 'gallery',
    isFavorite: true,
  },
  {
    id: '2',
    name: 'Next.js Examples',
    url: 'https://nextjs.org/examples',
    category: 'portfolio',
    isFavorite: true,
  },
  {
    id: '3',
    name: 'Vercel Design Gallery',
    url: 'https://vercel.com/design',
    category: 'gallery',
    isFavorite: false,
  },
];

const CATEGORIES = [
  { id: 'all', label: 'All', icon: Layout },
  { id: 'portfolio', label: 'Portfolios', icon: Image },
  { id: 'gallery', label: 'Galleries', icon: Image },
  { id: 'player', label: 'Media Players', icon: Film },
  { id: 'interactive', label: 'Interactive', icon: Globe },
  { id: 'other', label: 'Other', icon: Globe },
];

export default function VercelMediaEmbedPlugin({ onClose, initialUrl }: VercelMediaEmbedPluginProps) {
  const [inputUrl, setInputUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('vercel-embed-initial-url');
      if (stored) {
        sessionStorage.removeItem('vercel-embed-initial-url');
        return stored;
      }
    }
    return initialUrl || '';
  });
  
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sites, setSites] = useState<SiteEntry[]>(DEFAULT_SITES);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [showAddSite, setShowAddSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteUrl, setNewSiteUrl] = useState('');
  const [newSiteCategory, setNewSiteCategory] = useState<SiteEntry['category']>('other');
  const [copied, setCopied] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  // Load sites from localStorage
  useEffect(() => {
    try {
      const savedSites = localStorage.getItem('vercel-media-sites');
      if (savedSites) {
        setSites(JSON.parse(savedSites));
      }
    } catch (e) {
      console.error('Failed to load sites:', e);
    }
  }, []);

  // Save sites to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('vercel-media-sites', JSON.stringify(sites));
    } catch (e) {
      console.error('Failed to save sites:', e);
    }
  }, [sites]);

  const handleLoadUrl = useCallback((url: string) => {
    if (!url.trim()) {
      toast.error('Please enter a valid URL');
      return;
    }

    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    // Validate URL
    try {
      new URL(cleanUrl);
    } catch {
      toast.error('Invalid URL format');
      return;
    }

    setCurrentUrl(cleanUrl);
    setInputUrl(cleanUrl);
    setIsLoading(true);
    setIframeError(null);
    setIframeKey(prev => prev + 1);

    // Update last visited for existing site
    setSites(prev => prev.map(site => 
      site.url === cleanUrl 
        ? { ...site, lastVisited: Date.now() }
        : site
    ));

    toast.success('Loading site...');
  }, []);

  const handleReload = () => {
    setIframeKey(prev => prev + 1);
    setIsLoading(true);
    setIframeError(null);
    toast.info('Reloading...');
  };

  const handleOpenExternal = () => {
    if (!currentUrl) return;
    window.open(currentUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyUrl = () => {
    if (!currentUrl) return;
    navigator.clipboard.writeText(currentUrl);
    setCopied(true);
    toast.success('URL copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleFavorite = (siteId: string) => {
    setSites(prev => prev.map(site =>
      site.id === siteId
        ? { ...site, isFavorite: !site.isFavorite }
        : site
    ));
    toast.success('Favorite updated');
  };

  const handleAddSite = () => {
    if (!newSiteName.trim() || !newSiteUrl.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    let cleanUrl = newSiteUrl.trim();
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    const newSite: SiteEntry = {
      id: `site-${Date.now()}`,
      name: newSiteName.trim(),
      url: cleanUrl,
      category: newSiteCategory,
      isFavorite: false,
      lastVisited: Date.now(),
    };

    setSites(prev => [newSite, ...prev]);
    setNewSiteName('');
    setNewSiteUrl('');
    setNewSiteCategory('other');
    setShowAddSite(false);
    toast.success('Site added to collection');
  };

  const handleDeleteSite = (siteId: string) => {
    setSites(prev => prev.filter(site => site.id !== siteId));
    toast.success('Site removed');
  };

  const handleSelectSite = (site: SiteEntry) => {
    handleLoadUrl(site.url);
  };

  const filteredSites = activeCategory === 'all'
    ? sites
    : sites.filter(site => site.category === activeCategory);

  const favoriteSites = sites.filter(site => site.isFavorite);

  return (
    <Card className={`w-full h-full flex flex-col bg-gradient-to-br from-slate-900 via-indigo-900/20 to-slate-900 border-indigo-500/20 ${isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'rounded-xl'}`}>
      {/* Header */}
      <CardHeader className="flex flex-row items-center justify-between p-4 border-b border-indigo-500/20 bg-black/40">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <CardTitle className="text-lg text-white">Vercel Media Sites</CardTitle>
            {currentUrl && (
              <p className="text-xs text-indigo-300 truncate max-w-[200px]">
                {new URL(currentUrl).hostname}
              </p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowAddSite(!showAddSite)}
            className="h-8 w-8 text-indigo-300 hover:text-white hover:bg-indigo-500/20"
            title="Add new site"
          >
            <Plus className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="h-8 w-8 text-indigo-300 hover:text-white hover:bg-indigo-500/20"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-indigo-300 hover:text-white hover:bg-indigo-500/20"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        {/* URL Input Bar */}
        <div className="p-4 border-b border-indigo-500/20 bg-black/20">
          <form onSubmit={(e) => { e.preventDefault(); handleLoadUrl(inputUrl); }} className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Enter Vercel site URL (e.g., https://my-site.vercel.app)"
                className="bg-black/40 border-indigo-500/30 text-white placeholder:text-indigo-400/50 pr-20"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleCopyUrl}
                  className="h-6 w-6 text-indigo-400 hover:text-white"
                  title="Copy URL"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleOpenExternal}
                  className="h-6 w-6 text-indigo-400 hover:text-white"
                  title="Open externally"
                >
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <Button 
              type="submit" 
              disabled={!inputUrl.trim() || isLoading}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-4"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            </Button>
          </form>

          {/* Quick Categories */}
          <div className="flex gap-2 mt-3 overflow-x-auto">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <Button
                  key={cat.id}
                  variant={activeCategory === cat.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`h-7 text-xs whitespace-nowrap ${
                    activeCategory === cat.id
                      ? 'bg-indigo-600 hover:bg-indigo-700'
                      : 'bg-black/30 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20'
                  }`}
                >
                  <Icon className="w-3 h-3 mr-1" />
                  {cat.label}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Add Site Panel */}
        {showAddSite && (
          <div className="p-4 border-b border-indigo-500/20 bg-indigo-900/10">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <Label className="text-xs text-indigo-300">Site Name</Label>
                <Input
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  placeholder="My Portfolio"
                  className="bg-black/40 border-indigo-500/30 text-white text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-indigo-300">URL</Label>
                <Input
                  value={newSiteUrl}
                  onChange={(e) => setNewSiteUrl(e.target.value)}
                  placeholder="https://my-site.vercel.app"
                  className="bg-black/40 border-indigo-500/30 text-white text-xs"
                />
              </div>
            </div>
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <Label className="text-xs text-indigo-300">Category</Label>
                <select
                  value={newSiteCategory}
                  onChange={(e) => setNewSiteCategory(e.target.value as SiteEntry['category'])}
                  className="w-full bg-black/40 border border-indigo-500/30 rounded text-white text-xs px-2 py-1"
                >
                  {CATEGORIES.filter(c => c.id !== 'all').map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleAddSite}
                size="sm"
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              >
                <Save className="w-3 h-3 mr-2" />
                Save Site
              </Button>
              <Button
                onClick={() => setShowAddSite(false)}
                variant="outline"
                size="sm"
                className="border-indigo-500/30"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 relative bg-black">
          {currentUrl ? (
            <>
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
                  <div className="text-center space-y-4">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-500" />
                    <p className="text-indigo-300">Loading site...</p>
                  </div>
                </div>
              )}

              {iframeError ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center space-y-4 max-w-md p-6">
                    <AlertCircle className="w-12 h-12 mx-auto text-red-500" />
                    <p className="text-indigo-300">{iframeError}</p>
                    <div className="flex gap-2 justify-center">
                      <Button onClick={handleReload} className="bg-indigo-600 hover:bg-indigo-700">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Retry
                      </Button>
                      <Button onClick={handleOpenExternal} variant="outline" className="border-indigo-500/30">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Open Externally
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <iframe
                  key={iframeKey}
                  src={currentUrl}
                  className="w-full h-full border-0"
                  title="Vercel Media Site"
                  onLoad={() => setIsLoading(false)}
                  onError={() => {
                    setIframeError('Failed to load site. The site may not allow embedding.');
                    setIsLoading(false);
                  }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                  allow="autoplay; encrypted-media; fullscreen"
                  referrerPolicy="no-referrer"
                />
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md p-8">
                <div className="p-4 bg-gradient-to-br from-indigo-600/20 to-purple-600/20 rounded-full inline-block mb-4">
                  <Globe className="w-16 h-16 text-indigo-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Browse Vercel Media Sites</h3>
                <p className="text-indigo-300/80 mb-4">
                  Enter a URL or select from your saved sites to explore portfolios, galleries, and interactive experiences
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-indigo-400/60">
                  <Layout className="w-4 h-4" />
                  <span>Portfolios • Galleries • Media Players</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sites Sidebar */}
        <Tabs defaultValue="sites" className="border-t border-indigo-500/20">
          <TabsList className="w-full justify-start rounded-none bg-black/40 border-b border-indigo-500/20">
            <TabsTrigger value="sites" className="data-[state=active]:bg-indigo-600">
              <Globe className="w-3 h-3 mr-2" />
              Sites
            </TabsTrigger>
            <TabsTrigger value="favorites" className="data-[state=active]:bg-indigo-600">
              <Bookmark className="w-3 h-3 mr-2" />
              Favorites ({favoriteSites.length})
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-indigo-600">
              <Clock className="w-3 h-3 mr-2" />
              Recent
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sites" className="m-0 p-4">
            <ScrollArea className="h-48">
              {filteredSites.length === 0 ? (
                <div className="flex items-center justify-center h-32">
                  <div className="text-center space-y-2">
                    <Globe className="w-8 h-8 mx-auto text-indigo-600" />
                    <p className="text-indigo-300 text-sm">No sites in this category</p>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setShowAddSite(true)}
                      className="text-indigo-400"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add your first site
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSites.map((site) => (
                    <div
                      key={site.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-indigo-500/10 group border border-transparent hover:border-indigo-500/20 transition-all"
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleSelectSite(site)}
                        className="h-10 w-10 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300"
                      >
                        <Globe className="w-4 h-4" />
                      </Button>
                      <div className="flex-1 min-w-0" onClick={() => handleSelectSite(site)}>
                        <p className="text-sm text-white truncate cursor-pointer">{site.name}</p>
                        <p className="text-xs text-indigo-400/60 truncate">{new URL(site.url).hostname}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-indigo-500/30">
                        {site.category}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleFavorite(site.id)}
                        className={`h-6 w-6 ${
                          site.isFavorite ? 'text-yellow-400' : 'text-indigo-400 opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        {site.isFavorite ? <BookmarkCheck className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteSite(site.id)}
                        className="h-6 w-6 text-indigo-400 hover:text-red-400 opacity-0 group-hover:opacity-100"
                      >
                        <Trash className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="favorites" className="m-0 p-4">
            <ScrollArea className="h-48">
              {favoriteSites.length === 0 ? (
                <div className="flex items-center justify-center h-32">
                  <div className="text-center space-y-2">
                    <Bookmark className="w-8 h-8 mx-auto text-indigo-600" />
                    <p className="text-indigo-300 text-sm">No favorites yet</p>
                    <p className="text-xs text-indigo-400/60">Click the bookmark icon to add sites</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {favoriteSites.map((site) => (
                    <div
                      key={site.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-indigo-500/10 group border border-transparent hover:border-indigo-500/20 transition-all"
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleSelectSite(site)}
                        className="h-10 w-10 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400"
                      >
                        <BookmarkCheck className="w-4 h-4" />
                      </Button>
                      <div className="flex-1 min-w-0" onClick={() => handleSelectSite(site)}>
                        <p className="text-sm text-white truncate cursor-pointer">{site.name}</p>
                        <p className="text-xs text-indigo-400/60 truncate">{new URL(site.url).hostname}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleFavorite(site.id)}
                        className="h-6 w-6 text-yellow-400"
                      >
                        <BookmarkCheck className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="history" className="m-0 p-4">
            <ScrollArea className="h-48">
              {sites.filter(s => s.lastVisited).sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0)).length === 0 ? (
                <div className="flex items-center justify-center h-32">
                  <div className="text-center space-y-2">
                    <Clock className="w-8 h-8 mx-auto text-indigo-600" />
                    <p className="text-indigo-300 text-sm">No recent sites</p>
                    <p className="text-xs text-indigo-400/60">Sites you visit will appear here</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {sites
                    .filter(s => s.lastVisited)
                    .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0))
                    .slice(0, 10)
                    .map((site) => (
                      <div
                        key={site.id}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-indigo-500/10 group border border-transparent hover:border-indigo-500/20 transition-all"
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleSelectSite(site)}
                          className="h-10 w-10 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300"
                        >
                          <Globe className="w-4 h-4" />
                        </Button>
                        <div className="flex-1 min-w-0" onClick={() => handleSelectSite(site)}>
                          <p className="text-sm text-white truncate cursor-pointer">{site.name}</p>
                          <p className="text-xs text-indigo-400/60">
                            {new Date(site.lastVisited!).toLocaleString()}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleFavorite(site.id)}
                          className={`h-6 w-6 ${
                            site.isFavorite ? 'text-yellow-400' : 'text-indigo-400 opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          {site.isFavorite ? <BookmarkCheck className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
