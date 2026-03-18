"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import {
  Globe,
  X,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Search,
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
  MapPin,
  MessageSquare,
  Code,
  Terminal,
  BookOpen,
  Archive,
} from 'lucide-react';
import { toast } from 'sonner';
import { transformToEmbed, isEmbeddableUrl, detectEmbeddableLinks, EmbedInfo, formatUrlForDisplay } from '@/lib/utils/iframe-helper';
import { IframeUnavailableScreen } from '../ui/iframe-unavailable-screen';
import useIframeLoader from '@/hooks/use-iframe-loader';

interface BookmarkEntry {
  url: string;
  embedUrl: string;
  title: string;
  provider: string;
  timestamp: number;
}

interface HistoryEntry {
  url: string;
  embedUrl: string;
  timestamp: number;
}

const providerIcons: Record<string, React.ElementType> = {
  youtube: Film,
  vimeo: Film,
  tiktok: Film,
  spotify: Music,
  twitch: Film,
  twitter: MessageSquare,
  x: MessageSquare,
  reddit: MessageSquare,
  giphy: Film,
  soundcloud: Music,
  wikipedia: BookOpen,
  archive: Archive,
  openstreetmap: MapPin,
  duckduckgo: Search,
  codesandbox: Code,
  stackblitz: Terminal,
  github: Code,
  unknown: Globe,
};

const providerColors: Record<string, string> = {
  youtube: 'from-red-600 to-red-500',
  vimeo: 'from-blue-600 to-blue-500',
  tiktok: 'from-pink-600 to-black',
  spotify: 'from-green-600 to-green-500',
  twitch: 'from-purple-600 to-purple-500',
  twitter: 'from-blue-400 to-blue-500',
  x: 'from-gray-600 to-black',
  reddit: 'from-orange-500 to-orange-400',
  giphy: 'from-pink-500 to-purple-500',
  soundcloud: 'from-orange-600 to-orange-500',
  wikipedia: 'from-amber-500 to-yellow-500',
  archive: 'from-indigo-600 to-purple-500',
  openstreetmap: 'from-emerald-600 to-teal-500',
  duckduckgo: 'from-orange-500 to-red-500',
  codesandbox: 'from-cyan-600 to-blue-500',
  stackblitz: 'from-violet-600 to-purple-500',
  github: 'from-gray-700 to-gray-600',
  unknown: 'from-slate-600 to-slate-500',
};

const GenericEmbedPlugin: React.FC<{ onClose: () => void, initialUrl?: string }> = ({ onClose, initialUrl }) => {
  const [inputUrl, setInputUrl] = useState(() => {
    // Try to get URL from sessionStorage first (from message link click)
    if (typeof window !== 'undefined') {
      const storedUrl = sessionStorage.getItem('embed-plugin-initial-url');
      if (storedUrl) {
        sessionStorage.removeItem('embed-plugin-initial-url'); // Clean up
        return storedUrl;
      }
    }
    return initialUrl || '';
  });
  const [currentUrl, setCurrentUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      const storedUrl = sessionStorage.getItem('embed-plugin-initial-url');
      if (storedUrl) {
        return transformToEmbed(storedUrl).embedUrl;
      }
    }
    return initialUrl || 'https://duckduckgo.com/html';
  });
  const [embedInfo, setEmbedInfo] = useState<EmbedInfo | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isReloading, setIsReloading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'embed' | 'bookmarks' | 'history'>('embed');
  const [copied, setCopied] = useState(false);
  const [detectedLinks, setDetectedLinks] = useState<Array<{ url: string; provider: string; embedUrl: string }>>([]);

  // Use iframe loader hook
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
    url: currentUrl,
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

  const [iframeError, setIframeError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedBookmarks = localStorage.getItem('generic-embed-bookmarks');
      const savedHistory = localStorage.getItem('generic-embed-history');
      if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
      if (savedHistory) setHistory(JSON.parse(savedHistory));
    } catch (e) {
      console.error('Failed to load from localStorage:', e);
    }
  }, []);

  useEffect(() => {
    if (initialUrl) {
      handleLoadUrl(initialUrl);
    }
  }, [initialUrl]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReloading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [iframeKey]);

  const handleLoadUrl = useCallback((url: string) => {
    if (!url.trim()) return;

    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    const info = transformToEmbed(cleanUrl, window.location.hostname);
    setEmbedInfo(info);
    setCurrentUrl(info.embedUrl);
    setInputUrl(cleanUrl);
    setActiveTab('embed');

    // Add to history
    const newHistory = [
      { url: cleanUrl, embedUrl: info.embedUrl, timestamp: Date.now() },
      ...history.filter(h => h.url !== cleanUrl)
    ].slice(0, 30);
    setHistory(newHistory);
    localStorage.setItem('generic-embed-history', JSON.stringify(newHistory));

    // Detect other embeddable links in the URL text
    const links = detectEmbeddableLinks(cleanUrl);
    setDetectedLinks(links);

    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  }, [history]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    handleLoadUrl(inputUrl);
  };

  const handleReload = () => {
    setIframeError(null);
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleOpenExternal = () => {
    window.open(currentUrl, '_blank', 'noopener,noreferrer');
  };

  const toggleBookmark = () => {
    if (!embedInfo) return;

    const existing = bookmarks.find(b => b.url === inputUrl);
    let newBookmarks;
    
    if (existing) {
      newBookmarks = bookmarks.filter(b => b.url !== inputUrl);
      toast.success('Removed from bookmarks');
    } else {
      const ProviderIcon = providerIcons[embedInfo.provider] || Globe;
      newBookmarks = [{
        url: inputUrl,
        embedUrl: currentUrl,
        title: `${embedInfo.provider}: ${formatUrlForDisplay(inputUrl, 30)}`,
        provider: embedInfo.provider,
        timestamp: Date.now(),
      }, ...bookmarks];
      toast.success('Added to bookmarks');
    }
    
    setBookmarks(newBookmarks);
    localStorage.setItem('generic-embed-bookmarks', JSON.stringify(newBookmarks));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(currentUrl);
    setCopied(true);
    toast.success('Embed URL copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const loadBookmark = (bookmark: BookmarkEntry) => {
    setInputUrl(bookmark.url);
    setCurrentUrl(bookmark.embedUrl);
    setEmbedInfo({
      provider: bookmark.provider as any,
      embedUrl: bookmark.embedUrl,
      originalUrl: bookmark.url,
    });
    setActiveTab('embed');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const loadHistoryItem = (item: HistoryEntry) => {
    handleLoadUrl(item.url);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('generic-embed-history');
    toast.success('History cleared');
  };

  const isBookmarked = bookmarks.some(b => b.url === inputUrl);
  const ProviderIcon = embedInfo ? providerIcons[embedInfo.provider] || Globe : Globe;
  const gradientColor = embedInfo ? providerColors[embedInfo.provider] : 'from-slate-600 to-slate-500';

  return (
    <div className={`h-full flex flex-col bg-gradient-to-br from-slate-950 via-gray-950 to-slate-900 text-white ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <CardHeader className="p-4 border-b border-slate-700 bg-slate-950/80 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-gradient-to-br ${gradientColor}`}>
              <ProviderIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                {embedInfo ? `${embedInfo.provider.charAt(0).toUpperCase() + embedInfo.provider.slice(1)} Embed` : 'Universal Embed'}
              </CardTitle>
              <p className="text-xs text-slate-400">
                {embedInfo?.provider === 'unknown' ? 'Generic iframe viewer' : 'Auto-transformed embed'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopyUrl}
              className="hover:bg-slate-800"
              title="Copy embed URL"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReload}
              disabled={isReloading}
              className="hover:bg-slate-800"
            >
              <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="hover:bg-slate-800"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleBookmark}
              className="hover:bg-slate-800"
            >
              {isBookmarked ? (
                <BookmarkCheck className="w-4 h-4 text-blue-400" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-slate-800">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-slate-700 bg-slate-950/50 px-4 py-2">
            <TabsTrigger value="embed" className="data-[state=active]:bg-slate-800">
              <Globe className="w-4 h-4 mr-2" />
              Embed
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="data-[state=active]:bg-slate-800">
              <Bookmark className="w-4 h-4 mr-2" />
              Bookmarks
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-slate-800">
              <Clock className="w-4 h-4 mr-2" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="embed" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* Address Bar */}
              <form onSubmit={handleSubmit} className="p-3 border-b border-slate-700 bg-slate-950/30 space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="Paste any URL (YouTube, Spotify, Reddit, etc.)..."
                      className="bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 pl-10"
                    />
                  </div>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-500">
                    <Search className="w-4 h-4" />
                  </Button>
                  <Button type="button" onClick={handleOpenExternal} variant="outline" className="border-slate-600 hover:bg-slate-800">
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>

                {/* Provider Info & Detected Links */}
                {embedInfo && (
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="border-slate-600 text-slate-300">
                      <ProviderIcon className="w-3 h-3 mr-1" />
                      {embedInfo.provider}
                    </Badge>
                    {embedInfo.id && (
                      <Badge variant="outline" className="border-slate-600 text-slate-400">
                        ID: {embedInfo.id}
                      </Badge>
                    )}
                    {detectedLinks.length > 0 && (
                      <span className="text-slate-500">
                        {detectedLinks.length} link{detectedLinks.length > 1 ? 's' : ''} detected
                      </span>
                    )}
                  </div>
                )}
              </form>

              {/* Iframe */}
              <div className="flex-1 relative bg-slate-950">
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-10">
                    <div className="text-center space-y-4">
                      <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500" />
                      <p className="text-slate-400">Loading embed...</p>
                    </div>
                  </div>
                )}

                {isFailed || iframeError ? (
                  <div className="absolute inset-0">
                    <IframeUnavailableScreen
                      url={currentUrl}
                      reason={failureReason || 'failed'}
                      errorMessage={errorMessage || iframeError || undefined}
                      onRetry={() => {
                        setIframeError(null);
                        handleRetry();
                      }}
                      onTryFallback={() => {
                        setIframeError(null);
                        handleFallback();
                      }}
                      onOpenExternal={handleOpenExternal}
                      onClose={onClose}
                      autoRetryCount={retryCount}
                      maxRetries={3}
                    />
                  </div>
                ) : (
                  <iframe
                    key={iframeKey}
                    src={isUsingFallback && fallbackUrl ? fallbackUrl : currentUrl}
                    className="w-full h-full border-0"
                    title="Embed"
                    onLoad={() => {
                      setIsReloading(false);
                      setIframeError(null);
                      handleLoad(); // Sync with useIframeLoader hook
                    }}
                    onError={() => {
                      setIframeError('Failed to load content. This site may block embedding. Try opening externally.');
                    }}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-autoplay allow-top-navigation allow-top-navigation-by-user-activation"
                    allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>

              {/* Info Footer */}
              <div className="p-2 border-t border-slate-700 bg-slate-950/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-slate-400">
                  <Shield className="w-3 h-3" />
                  <span>Sandboxed iframe</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <LinkIcon className="w-3 h-3" />
                  <span className="truncate max-w-xs">{formatUrlForDisplay(currentUrl, 40)}</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="bookmarks" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {bookmarks.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <Bookmark className="w-12 h-12 mx-auto text-slate-600" />
                    <p className="text-slate-400">No bookmarked embeds</p>
                    <p className="text-xs text-slate-500">Load a URL and click bookmark to save</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((bookmark, idx) => {
                    const BookmarkIcon = providerIcons[bookmark.provider] || Globe;
                    return (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:bg-slate-900 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className={`p-1.5 rounded bg-gradient-to-br ${providerColors[bookmark.provider] || 'from-slate-600 to-slate-500'}`}>
                              <BookmarkIcon className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{bookmark.title}</p>
                              <p className="text-xs text-slate-400 truncate">{bookmark.url}</p>
                              <p className="text-xs text-slate-500">
                                {new Date(bookmark.timestamp).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => loadBookmark(bookmark)}
                              className="hover:bg-slate-800"
                            >
                              <Globe className="w-4 h-4" />
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
                              className="hover:bg-slate-800"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                const newBookmarks = bookmarks.filter((_, i) => i !== idx);
                                setBookmarks(newBookmarks);
                                localStorage.setItem('generic-embed-bookmarks', JSON.stringify(newBookmarks));
                                toast.success('Bookmark removed');
                              }}
                              className="hover:bg-red-900/30 text-red-400"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="history" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  Recent Embeds
                </h3>
                {history.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearHistory}
                    className="text-slate-400 hover:bg-red-900/30"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
              {history.length === 0 ? (
                <div className="flex items-center justify-center h-48">
                  <div className="text-center space-y-2">
                    <Clock className="w-8 h-8 mx-auto text-slate-600" />
                    <p className="text-slate-400">No history yet</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((item, idx) => {
                    const info = transformToEmbed(item.url);
                    const HistoryIcon = providerIcons[info.provider] || Globe;
                    return (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:bg-slate-900 transition-colors cursor-pointer"
                        onClick={() => loadHistoryItem(item)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <HistoryIcon className="w-4 h-4 text-slate-400" />
                            <div>
                              <p className="font-medium text-sm">{formatUrlForDisplay(item.url, 50)}</p>
                              <p className="text-xs text-slate-500">
                                {new Date(item.timestamp).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <Badge variant="outline" className="border-slate-600 text-xs">
                            {info.provider}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
};

export default GenericEmbedPlugin;
