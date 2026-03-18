"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import {
  BookOpen,
  X,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Search,
  Bookmark,
  BookmarkCheck,
  Globe,
  Clock,
  Star,
  FileText,
  Languages,
} from 'lucide-react';
import { toast } from 'sonner';
import useIframeLoader from '@/hooks/use-iframe-loader';
import { IframeUnavailableScreen } from '../ui/iframe-unavailable-screen';

interface BookmarkEntry {
  url: string;
  title: string;
  timestamp: number;
}

interface SearchHistoryEntry {
  query: string;
  timestamp: number;
}

const WikipediaEmbedPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [iframeUrl, setIframeUrl] = useState('https://en.wikipedia.org/wiki/Main_Page');
  const [searchQuery, setSearchQuery] = useState('');
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [language, setLanguage] = useState('en');
  const [isReloading, setIsReloading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'browse' | 'bookmarks' | 'history'>('browse');

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
    fallbackUrl,
    handleLoad,
    handleRetry,
    handleReset,
    handleFallback,
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

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'it', name: 'Italiano' },
    { code: 'pt', name: 'Português' },
    { code: 'ru', name: 'Русский' },
    { code: 'ja', name: '日本語' },
    { code: 'zh', name: '中文' },
    { code: 'ar', name: 'العربية' },
  ];

  useEffect(() => {
    try {
      const savedBookmarks = localStorage.getItem('wikipedia-bookmarks');
      const savedHistory = localStorage.getItem('wikipedia-search-history');
      if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
      if (savedHistory) setSearchHistory(JSON.parse(savedHistory));
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

    const searchUrl = `https://${language}.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(searchQuery)}`;
    setIframeUrl(searchUrl);
    setActiveTab('browse');

    // Add to history
    const newHistory = [
      { query: searchQuery, timestamp: Date.now() },
      ...searchHistory.filter(h => h.query !== searchQuery)
    ].slice(0, 20);
    setSearchHistory(newHistory);
    localStorage.setItem('wikipedia-search-history', JSON.stringify(newHistory));

    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleReload = () => {
    setIframeError(null);
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleOpenExternal = () => {
    window.open(iframeUrl, '_blank', 'noopener,noreferrer');
  };

  const toggleBookmark = () => {
    const existing = bookmarks.find(b => b.url === iframeUrl);
    let newBookmarks;
    
    if (existing) {
      newBookmarks = bookmarks.filter(b => b.url !== iframeUrl);
      toast.success('Removed from bookmarks');
    } else {
      const title = `Wikipedia: ${searchQuery || 'Page'}`;
      newBookmarks = [{ url: iframeUrl, title, timestamp: Date.now() }, ...bookmarks];
      toast.success('Added to bookmarks');
    }
    
    setBookmarks(newBookmarks);
    localStorage.setItem('wikipedia-bookmarks', JSON.stringify(newBookmarks));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    const newUrl = `https://${newLang}.wikipedia.org/wiki/Main_Page`;
    setIframeUrl(newUrl);
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const loadBookmark = (bookmark: BookmarkEntry) => {
    setIframeUrl(bookmark.url);
    setActiveTab('browse');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const loadHistoryItem = (query: string) => {
    setSearchQuery(query);
    const searchUrl = `https://${language}.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`;
    setIframeUrl(searchUrl);
    setActiveTab('browse');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const clearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem('wikipedia-search-history');
    toast.success('Search history cleared');
  };

  const isBookmarked = bookmarks.some(b => b.url === iframeUrl);

  return (
    <div className={`h-full flex flex-col bg-gradient-to-br from-amber-950 via-yellow-950 to-slate-900 text-white ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <CardHeader className="p-4 border-b border-amber-800/50 bg-amber-950/80 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-yellow-500">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold bg-gradient-to-r from-amber-400 to-yellow-400 bg-clip-text text-transparent">
                Wikipedia
              </CardTitle>
              <p className="text-xs text-amber-200/60">The Free Encyclopedia</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="px-2 py-1 bg-amber-900/50 border border-amber-700 rounded text-xs text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {languages.map(lang => (
                <option key={lang.code} value={lang.code}>{lang.name}</option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReload}
              disabled={isReloading}
              className="hover:bg-amber-800/50"
            >
              <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="hover:bg-amber-800/50"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleBookmark}
              className="hover:bg-amber-800/50"
            >
              {isBookmarked ? (
                <BookmarkCheck className="w-4 h-4 text-amber-400" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-amber-800/50">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-amber-800/50 bg-amber-950/50 px-4 py-2">
            <TabsTrigger value="browse" className="data-[state=active]:bg-amber-800/50">
              <BookOpen className="w-4 h-4 mr-2" />
              Browse
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="data-[state=active]:bg-amber-800/50">
              <Bookmark className="w-4 h-4 mr-2" />
              Bookmarks
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-amber-800/50">
              <Clock className="w-4 h-4 mr-2" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* Search Bar */}
              <form onSubmit={handleSearch} className="p-3 border-b border-amber-800/50 bg-amber-950/30 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400/60" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Wikipedia..."
                    className="bg-amber-900/30 border-amber-700 text-white placeholder:text-amber-400/60 pl-10"
                  />
                </div>
                <Button type="submit" className="bg-amber-600 hover:bg-amber-500">
                  <Search className="w-4 h-4" />
                </Button>
                <Button type="button" onClick={handleOpenExternal} variant="outline" className="border-amber-700 hover:bg-amber-800/50">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </form>

              {/* Iframe */}
              <div className="flex-1 relative bg-amber-950">
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-amber-950/80 z-10">
                    <div className="text-center space-y-4">
                      <RefreshCw className="w-8 h-8 animate-spin mx-auto text-amber-500" />
                      <p className="text-amber-200/60">Loading Wikipedia...</p>
                    </div>
                  </div>
                )}

                {isFailed || iframeError ? (
                  <div className="absolute inset-0">
                    <IframeUnavailableScreen
                      url={iframeUrl}
                      reason={failureReason || 'failed'}
                      errorMessage={errorMessage || iframeError || undefined}
                      onRetry={handleRetry}
                      onTryFallback={handleFallback}
                      onOpenExternal={handleOpenExternal}
                      onClose={onClose}
                      autoRetryCount={retryCount}
                      maxRetries={3}
                    />
                  </div>
                ) : (
                  <iframe
                    key={iframeKey}
                    src={isUsingFallback && fallbackUrl ? fallbackUrl : iframeUrl}
                    className="w-full h-full border-0"
                    title="Wikipedia"
                    onLoad={() => setIsReloading(false)}
                    onError={() => {
                      setIframeError('Failed to load Wikipedia. Note: Wikipedia restricts embedding in some contexts. Try using the external link button.');
                      setIsReloading(false);
                    }}
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation allow-top-navigation-by-user-activation"
                    allow="fullscreen"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>

              {/* Info Footer */}
              <div className="p-2 border-t border-amber-800/50 bg-amber-950/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-amber-200/60">
                  <Globe className="w-3 h-3" />
                  <span>{language}.wikipedia.org</span>
                </div>
                <div className="flex items-center gap-2 text-amber-200/60">
                  <FileText className="w-3 h-3" />
                  <span>Free Encyclopedia</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="bookmarks" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {bookmarks.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <Bookmark className="w-12 h-12 mx-auto text-amber-500/40" />
                    <p className="text-amber-200/60">No bookmarked pages</p>
                    <p className="text-xs text-amber-400/40">Click the bookmark icon to save pages</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((bookmark, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-amber-800/50 bg-amber-900/30 hover:bg-amber-900/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <BookOpen className="w-5 h-5 text-amber-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{bookmark.title}</p>
                            <p className="text-xs text-amber-200/40 truncate">{bookmark.url}</p>
                            <p className="text-xs text-amber-200/30">
                              {new Date(bookmark.timestamp).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => loadBookmark(bookmark)}
                            className="hover:bg-amber-800/50"
                          >
                            <BookOpen className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => window.open(bookmark.url, '_blank', 'noopener,noreferrer')}
                            className="hover:bg-amber-800/50"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newBookmarks = bookmarks.filter((_, i) => i !== idx);
                              setBookmarks(newBookmarks);
                              localStorage.setItem('wikipedia-bookmarks', JSON.stringify(newBookmarks));
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
                  <Clock className="w-4 h-4 text-amber-400" />
                  Search History
                </h3>
                {searchHistory.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearHistory}
                    className="text-amber-400 hover:bg-red-900/30"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
              {searchHistory.length === 0 ? (
                <div className="flex items-center justify-center h-48">
                  <div className="text-center space-y-2">
                    <Clock className="w-8 h-8 mx-auto text-amber-500/40" />
                    <p className="text-amber-200/60">No search history</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {searchHistory.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-amber-800/50 bg-amber-900/30 hover:bg-amber-900/50 transition-colors cursor-pointer"
                      onClick={() => loadHistoryItem(item.query)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Search className="w-4 h-4 text-amber-400" />
                          <span className="font-medium">{item.query}</span>
                        </div>
                        <span className="text-xs text-amber-200/40">
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

export default WikipediaEmbedPlugin;
