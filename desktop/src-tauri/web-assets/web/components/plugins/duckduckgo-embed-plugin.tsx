"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import {
  Search as SearchIcon,
  X,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Bookmark,
  BookmarkCheck,
  Shield,
  Eye,
  EyeOff,
  Globe,
  Clock,
  Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import useIframeLoader from '@/hooks/use-iframe-loader';
import { IframeUnavailableScreen } from '../ui/iframe-unavailable-screen';
import { IframeLoadingOverlay } from '../ui/iframe-loading-overlay';

interface BookmarkEntry {
  url: string;
  title: string;
  query: string;
  timestamp: number;
}

interface SearchHistoryEntry {
  query: string;
  timestamp: number;
}

type SafeSearch = 'strict' | 'moderate' | 'off';
type Region = 'wt-wt' | 'en-us' | 'en-gb' | 'de-de' | 'fr-fr' | 'es-es' | 'it-it' | 'jp-jp' | 'cn-cn';

const DuckDuckGoEmbedPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [iframeUrl, setIframeUrl] = useState('https://duckduckgo.com/html');
  const [searchQuery, setSearchQuery] = useState('');
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [isReloading, setIsReloading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'search' | 'bookmarks' | 'history'>('search');

  // Settings
  const [safeSearch, setSafeSearch] = useState<SafeSearch>('moderate');
  const [region, setRegion] = useState<Region>('wt-wt');
  const [showSettings, setShowSettings] = useState(false);

  // Use iframe loader hook with fallback
  const {
    isLoading,
    isLoaded,
    isFailed,
    failureReason,
    errorMessage,
    retryCount,
    canRetry,
    isUsingFallback,
    fallbackLevel,
    fallbackUrl,
    loadingProgress,
    handleLoad,
    handleRetry,
    handleReset,
    handleFallback,
    handleLoadSuccess,
  } = useIframeLoader({
    url: iframeUrl,
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 5000,
    enableAutoRetry: true,
    enableFallback: true,
    onLoaded: () => {
      setIsReloading(false);
      setIframeError(null);
    },
    onFailed: (reason, error) => {
      setIsReloading(false);
      setIframeError(error || 'Failed to load content');
    },
  });

  const regions: { code: Region; name: string }[] = [
    { code: 'wt-wt', name: 'All Regions' },
    { code: 'en-us', name: 'United States' },
    { code: 'en-gb', name: 'United Kingdom' },
    { code: 'de-de', name: 'Germany' },
    { code: 'fr-fr', name: 'France' },
    { code: 'es-es', name: 'Spain' },
    { code: 'it-it', name: 'Italy' },
    { code: 'jp-jp', name: 'Japan' },
    { code: 'cn-cn', name: 'China' },
  ];

  useEffect(() => {
    try {
      const savedBookmarks = localStorage.getItem('ddg-bookmarks');
      const savedHistory = localStorage.getItem('ddg-search-history');
      const savedSettings = localStorage.getItem('ddg-settings');
      if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
      if (savedHistory) setSearchHistory(JSON.parse(savedHistory));
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        if (settings.safeSearch) setSafeSearch(settings.safeSearch);
        if (settings.region) setRegion(settings.region);
      }
    } catch (e) {
      console.error('Failed to load from localStorage:', e);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReloading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [iframeKey]);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchQuery.trim()) return;

    const params = new URLSearchParams({
      q: searchQuery,
      kl: region,
    });

    // Use DuckDuckGo's 'kp' parameter for safe-search (not 'ch')
    if (safeSearch === 'strict') {
      params.set('kp', '1');
    } else if (safeSearch === 'off') {
      params.set('kp', '-1');
    } else {
      params.set('kp', '-2'); // moderate
    }

    const searchUrl = `https://duckduckgo.com/html/?${params.toString()}`;
    setIframeUrl(searchUrl);
    setActiveTab('search');

    // Add to history
    const newHistory = [
      { query: searchQuery, timestamp: Date.now() },
      ...searchHistory.filter(h => h.query !== searchQuery)
    ].slice(0, 30);
    setSearchHistory(newHistory);
    localStorage.setItem('ddg-search-history', JSON.stringify(newHistory));

    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleReload = () => {
    setIframeError(null);
    setIsReloading(true);
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleOpenExternal = () => {
    const newWindow = window.open(iframeUrl, '_blank', 'noopener,noreferrer');
    if (newWindow) {
      newWindow.opener = null;
    }
  };

  const toggleBookmark = () => {
    const existing = bookmarks.find(b => b.url === iframeUrl);
    let newBookmarks;
    
    if (existing) {
      newBookmarks = bookmarks.filter(b => b.url !== iframeUrl);
      toast.success('Removed from bookmarks');
    } else {
      const title = `DDG: ${searchQuery || 'Search'}`;
      newBookmarks = [{ url: iframeUrl, title, query: searchQuery, timestamp: Date.now() }, ...bookmarks];
      toast.success('Added to bookmarks');
    }
    
    setBookmarks(newBookmarks);
    localStorage.setItem('ddg-bookmarks', JSON.stringify(newBookmarks));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const saveSettings = () => {
    localStorage.setItem('ddg-settings', JSON.stringify({ safeSearch, region }));
    toast.success('Settings saved');
    
    // Re-run search with new settings if there's a query
    if (searchQuery.trim()) {
      handleSearch();
    }
  };

  const loadBookmark = (bookmark: BookmarkEntry) => {
    setIframeUrl(bookmark.url);
    setSearchQuery(bookmark.query);
    setActiveTab('search');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const loadHistoryItem = (query: string) => {
    setSearchQuery(query);
    const params = new URLSearchParams({ q: query, kl: region });
    if (safeSearch === 'strict') params.set('kp', '1');
    else if (safeSearch === 'off') params.set('kp', '-1');
    else params.set('kp', '-2');
    
    const searchUrl = `https://duckduckgo.com/html/?${params.toString()}`;
    setIframeUrl(searchUrl);
    setActiveTab('search');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const clearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem('ddg-search-history');
    toast.success('Search history cleared');
  };

  const isBookmarked = bookmarks.some(b => b.url === iframeUrl);

  return (
    <div className={`h-full flex flex-col bg-gradient-to-br from-orange-950 via-red-950 to-slate-900 text-white ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <CardHeader className="p-4 border-b border-orange-800/50 bg-orange-950/80 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-red-500">
              <SearchIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">
                DuckDuckGo
              </CardTitle>
              <p className="text-xs text-orange-200/60">Privacy-Focused Search</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(!showSettings)}
              className="hover:bg-orange-800/50"
            >
              <Settings className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReload}
              disabled={isReloading}
              className="hover:bg-orange-800/50"
            >
              <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="hover:bg-orange-800/50"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleBookmark}
              className="hover:bg-orange-800/50"
            >
              {isBookmarked ? (
                <BookmarkCheck className="w-4 h-4 text-orange-400" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-orange-800/50">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Settings Panel */}
      {showSettings && (
        <div className="p-4 border-b border-orange-800/50 bg-orange-950/50 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-medium">Safe Search</span>
          </div>
          <div className="flex gap-2">
            {(['strict', 'moderate', 'off'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={safeSearch === mode ? 'default' : 'outline'}
                onClick={() => setSafeSearch(mode)}
                className={safeSearch === mode 
                  ? 'bg-orange-600 hover:bg-orange-500' 
                  : 'border-orange-700 hover:bg-orange-800/50'}
              >
                {mode === 'strict' && <EyeOff className="w-4 h-4 mr-1" />}
                {mode === 'moderate' && <Shield className="w-4 h-4 mr-1" />}
                {mode === 'off' && <Eye className="w-4 h-4 mr-1" />}
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Button>
            ))}
          </div>
          
          <div className="flex items-center gap-2 pt-2">
            <Globe className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-medium">Region</span>
          </div>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as Region)}
            className="w-full px-3 py-2 bg-orange-900/50 border border-orange-700 rounded text-sm text-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            {regions.map(r => (
              <option key={r.code} value={r.code}>{r.name}</option>
            ))}
          </select>
          
          <Button onClick={saveSettings} className="w-full bg-orange-600 hover:bg-orange-500">
            Save Settings
          </Button>
        </div>
      )}

      <CardContent className="flex-1 overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-orange-800/50 bg-orange-950/50 px-4 py-2">
            <TabsTrigger value="search" className="data-[state=active]:bg-orange-800/50">
              <SearchIcon className="w-4 h-4 mr-2" />
              Search
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="data-[state=active]:bg-orange-800/50">
              <Bookmark className="w-4 h-4 mr-2" />
              Bookmarks
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-orange-800/50">
              <Clock className="w-4 h-4 mr-2" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* Search Bar */}
              <form onSubmit={handleSearch} className="p-3 border-b border-orange-800/50 bg-orange-950/30 flex gap-2">
                <div className="relative flex-1">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-400/60" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search the web privately..."
                    className="bg-orange-900/30 border-orange-700 text-white placeholder:text-orange-400/60 pl-10"
                  />
                </div>
                <Button type="submit" className="bg-orange-600 hover:bg-orange-500">
                  <SearchIcon className="w-4 h-4" />
                </Button>
                <Button type="button" onClick={handleOpenExternal} variant="outline" className="border-orange-700 hover:bg-orange-800/50">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </form>

              {/* Iframe */}
              <div className="flex-1 relative bg-orange-950">
                {isFailed || iframeError ? (
                  <div className="absolute inset-0">
                    <IframeUnavailableScreen
                      url={iframeUrl}
                      reason={failureReason || 'failed'}
                      errorMessage={errorMessage || iframeError || undefined}
                      onRetry={handleRetry}onOpenExternal={handleOpenExternal}
                      onClose={onClose}
                      autoRetryCount={retryCount}
                      maxRetries={3}
                    />
                  </div>
                ) : (
                  <>
                    {/* Shared loading overlay with progress bar */}
                    <IframeLoadingOverlay
                      progress={loadingProgress}
                      isLoading={isLoading}
                      isUsingFallback={isUsingFallback}
                      fallbackLevel={fallbackLevel}
                      label="Loading DuckDuckGo"
                    />
                    <iframe
                      key={iframeKey}
                      src={isUsingFallback && fallbackUrl ? fallbackUrl : iframeUrl}
                      className="w-full h-full border-0"
                      title="DuckDuckGo"
                      onLoad={() => {
                        setIsReloading(false);
                        handleLoadSuccess();
                      }}
                      onError={() => {
                        setIframeError('Failed to load DuckDuckGo. Note: DuckDuckGo limits iframe embedding. Try using the external link button.');
                        setIsReloading(false);
                      }}
                      sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation allow-top-navigation-by-user-activation"
                      allow="fullscreen"
                      referrerPolicy="no-referrer"
                    />
                  </>
                )}
              </div>

              {/* Info Footer */}
              <div className="p-2 border-t border-orange-800/50 bg-orange-950/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-orange-200/60">
                  <Shield className="w-3 h-3" />
                  <span>No Tracking</span>
                </div>
                <div className="flex items-center gap-2 text-orange-200/60">
                  <Globe className="w-3 h-3" />
                  <span>Region: {regions.find(r => r.code === region)?.name || 'All'}</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="bookmarks" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {bookmarks.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <Bookmark className="w-12 h-12 mx-auto text-orange-500/40" />
                    <p className="text-orange-200/60">No bookmarked searches</p>
                    <p className="text-xs text-orange-400/40">Click the bookmark icon to save searches</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((bookmark, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-orange-800/50 bg-orange-900/30 hover:bg-orange-900/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <SearchIcon className="w-5 h-5 text-orange-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{bookmark.title}</p>
                            <p className="text-xs text-orange-200/40 truncate">"{bookmark.query}"</p>
                            <p className="text-xs text-orange-200/30">
                              {new Date(bookmark.timestamp).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => loadBookmark(bookmark)}
                            className="hover:bg-orange-800/50"
                          >
                            <SearchIcon className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newWindow = window.open(bookmark.url, '_blank', 'noopener,noreferrer');
                              if (newWindow) {
                                newWindow.opener = null;
                              }
                            }}
                            className="hover:bg-orange-800/50"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newBookmarks = bookmarks.filter((_, i) => i !== idx);
                              setBookmarks(newBookmarks);
                              localStorage.setItem('ddg-bookmarks', JSON.stringify(newBookmarks));
                              toast.success('Bookmark removed');
                            }}
                            className="hover:bg-red-900/30 text-red-400"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="history" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-orange-400" />
                  Search History
                </h3>
                {searchHistory.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearHistory}
                    className="text-orange-400 hover:bg-red-900/30"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
              {searchHistory.length === 0 ? (
                <div className="flex items-center justify-center h-48">
                  <div className="text-center space-y-2">
                    <Clock className="w-8 h-8 mx-auto text-orange-500/40" />
                    <p className="text-orange-200/60">No search history</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {searchHistory.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-orange-800/50 bg-orange-900/30 hover:bg-orange-900/50 transition-colors cursor-pointer"
                      onClick={() => loadHistoryItem(item.query)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <SearchIcon className="w-4 h-4 text-orange-400" />
                          <span className="font-medium">{item.query}</span>
                        </div>
                        <span className="text-xs text-orange-200/40">
                          {new Date(item.timestamp).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
};

export default DuckDuckGoEmbedPlugin;
