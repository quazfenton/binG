"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import useIframeLoader from '@/hooks/use-iframe-loader';
import { IframeUnavailableScreen } from '../ui/iframe-unavailable-screen';
import { IframeLoadingOverlay } from '../ui/iframe-loading-overlay';
import {
  Archive,
  X,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Search,
  Bookmark,
  BookmarkCheck,
  Clock,
  Calendar,
  Image,
  FileText,
  Video,
  Music,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';

interface BookmarkEntry {
  url: string;
  title: string;
  timestamp: number;
}

interface SavedUrlEntry {
  url: string;
  savedAt: string;
  timestamp: number;
}

const ArchiveOrgEmbedPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [iframeUrl, setIframeUrl] = useState('https://archive.org');
  const [urlInput, setUrlInput] = useState('');
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Use iframe loader hook with fallback
  const {
    isLoading: hookIsLoading,
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
      setIframeError(null);
    },
    onFailed: (reason, error) => {
      setIframeError(error || 'Failed to load content');
    },
  });
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [savedUrls, setSavedUrls] = useState<SavedUrlEntry[]>([]);
  const [mediaType, setMediaType] = useState<'all' | 'web' | 'texts' | 'video' | 'audio' | 'image'>('all');
  const [isReloading, setIsReloading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'browse' | 'wayback' | 'bookmarks' | 'saved'>('browse');

  useEffect(() => {
    try {
      const savedBookmarks = localStorage.getItem('archive-bookmarks');
      const savedUrlsData = localStorage.getItem('archive-saved-urls');
      if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
      if (savedUrlsData) setSavedUrls(JSON.parse(savedUrlsData));
    } catch (e) {
      console.error('Failed to load from localStorage:', e);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [iframeKey]);

  const handleWaybackLookup = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!urlInput.trim()) return;

    let url = urlInput.trim();
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    const waybackUrl = `https://web.archive.org/web/*/${url}`;
    setIframeUrl(waybackUrl);
    setActiveTab('wayback');

    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleReload = () => {
    setIframeError(null);
    setIsLoading(true);
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
      const title = `Archive: ${new URL(iframeUrl).hostname || 'Page'}`;
      newBookmarks = [{ url: iframeUrl, title, timestamp: Date.now() }, ...bookmarks];
      toast.success('Added to bookmarks');
    }
    
    setBookmarks(newBookmarks);
    localStorage.setItem('archive-bookmarks', JSON.stringify(newBookmarks));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleMediaTypeChange = (type: string) => {
    setMediaType(type as any);
    const typeUrls: Record<string, string> = {
      all: 'https://archive.org',
      web: 'https://web.archive.org',
      texts: 'https://archive.org/details/texts',
      video: 'https://archive.org/details/movies',
      audio: 'https://archive.org/details/audio',
      image: 'https://archive.org/details/image',
    };
    setIframeUrl(typeUrls[type] || 'https://archive.org');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const saveUrl = () => {
    if (!urlInput.trim()) {
      toast.error('Please enter a URL');
      return;
    }

    let url = urlInput.trim();
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    const newEntry = {
      url,
      savedAt: new Date().toISOString(),
      timestamp: Date.now(),
    };

    const newSaved = [newEntry, ...savedUrls.filter(u => u.url !== url)].slice(0, 50);
    setSavedUrls(newSaved);
    localStorage.setItem('archive-saved-urls', JSON.stringify(newSaved));
    toast.success('URL saved for archiving');
  };

  const loadBookmark = (bookmark: BookmarkEntry) => {
    setIframeUrl(bookmark.url);
    setActiveTab('browse');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const isBookmarked = bookmarks.some(b => b.url === iframeUrl);

  const mediaTypeIcons: Record<string, React.ElementType> = {
    all: Archive,
    web: Clock,
    texts: FileText,
    video: Video,
    audio: Music,
    image: Image,
  };

  return (
    <div className={`h-full flex flex-col bg-gradient-to-br from-indigo-950 via-purple-950 to-slate-900 text-white ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <CardHeader className="p-4 border-b border-indigo-800/50 bg-indigo-950/80 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500">
              <Archive className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Internet Archive
              </CardTitle>
              <p className="text-xs text-indigo-200/60">Wayback Machine & Digital Library</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReload}
              disabled={isReloading}
              className="hover:bg-indigo-800/50"
            >
              <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="hover:bg-indigo-800/50"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleBookmark}
              className="hover:bg-indigo-800/50"
            >
              {isBookmarked ? (
                <BookmarkCheck className="w-4 h-4 text-indigo-400" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-indigo-800/50">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-indigo-800/50 bg-indigo-950/50 px-4 py-2">
            <TabsTrigger value="browse" className="data-[state=active]:bg-indigo-800/50">
              <Archive className="w-4 h-4 mr-2" />
              Browse
            </TabsTrigger>
            <TabsTrigger value="wayback" className="data-[state=active]:bg-indigo-800/50">
              <Clock className="w-4 h-4 mr-2" />
              Wayback
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="data-[state=active]:bg-indigo-800/50">
              <Bookmark className="w-4 h-4 mr-2" />
              Bookmarks
            </TabsTrigger>
            <TabsTrigger value="saved" className="data-[state=active]:bg-indigo-800/50">
              <Save className="w-4 h-4 mr-2" />
              Saved URLs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* Media Type Filter */}
              <div className="p-3 border-b border-indigo-800/50 bg-indigo-950/30 flex gap-2 overflow-x-auto">
                {(['all', 'web', 'texts', 'video', 'audio', 'image'] as const).map((type) => {
                  const Icon = mediaTypeIcons[type];
                  return (
                    <Button
                      key={type}
                      size="sm"
                      variant={mediaType === type ? 'default' : 'outline'}
                      onClick={() => handleMediaTypeChange(type)}
                      className={mediaType === type 
                        ? 'bg-indigo-600 hover:bg-indigo-500' 
                        : 'border-indigo-700 hover:bg-indigo-800/50'}
                    >
                      <Icon className="w-4 h-4 mr-1" />
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Button>
                  );
                })}
              </div>

              {/* Iframe */}
              <div className="flex-1 relative bg-indigo-950">
                {isFailed || iframeError ? (
                  <div className="absolute inset-0">
                    <IframeUnavailableScreen
                      url={iframeUrl}
                      reason={failureReason || 'failed'}
                      errorMessage={errorMessage || iframeError || undefined}
                      onRetry={handleRetry}
                      onOpenExternal={handleOpenExternal}
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
                      isLoading={hookIsLoading || isLoading}
                      isUsingFallback={isUsingFallback}
                      fallbackLevel={fallbackLevel}
                      label="Loading Archive.org"
                    />
                    <iframe
                      key={iframeKey}
                      src={isUsingFallback && fallbackUrl ? fallbackUrl : iframeUrl}
                      className="w-full h-full border-0"
                      title="Internet Archive"
                      onLoad={() => {
                        setIsLoading(false);
                        handleLoadSuccess();
                      }}
                      onError={() => {
                        setIframeError('Failed to load Archive.org. The site may not allow embedding.');
                        setIsLoading(false);
                      }}
                      sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation allow-top-navigation-by-user-activation"
                      allow="fullscreen"
                      referrerPolicy="no-referrer"
                    />
                  </>
                )}
              </div>

              {/* Info Footer */}
              <div className="p-2 border-t border-indigo-800/50 bg-indigo-950/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-indigo-200/60">
                  <Calendar className="w-3 h-3" />
                  <span>Preserving Digital History</span>
                </div>
                <div className="flex items-center gap-2 text-indigo-200/60">
                  <Archive className="w-3 h-3" />
                  <span>Non-Profit Library</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="wayback" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* Wayback Machine Input */}
              <form onSubmit={handleWaybackLookup} className="p-4 border-b border-indigo-800/50 bg-indigo-950/30 space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400/60" />
                    <Input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="Enter URL to view archived versions..."
                      className="bg-indigo-900/30 border-indigo-700 text-white placeholder:text-indigo-400/60 pl-10"
                    />
                  </div>
                  <Button type="submit" className="bg-indigo-600 hover:bg-indigo-500">
                    <Search className="w-4 h-4" />
                  </Button>
                  <Button type="button" onClick={saveUrl} className="bg-purple-600 hover:bg-purple-500">
                    <Save className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-indigo-200/40">
                  Explore the history of any website using the Wayback Machine
                </p>
              </form>

              {/* Wayback Iframe */}
              <div className="flex-1 relative bg-indigo-950">
                <iframe
                  key={iframeKey}
                  src={iframeUrl}
                  className="w-full h-full border-0"
                  title="Wayback Machine"
                  onLoad={() => {
                    setIsLoading(false);
                    handleLoadSuccess();
                  }}
                  sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation allow-top-navigation-by-user-activation"
                  allow="fullscreen"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="bookmarks" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {bookmarks.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <Bookmark className="w-12 h-12 mx-auto text-indigo-500/40" />
                    <p className="text-indigo-200/60">No bookmarked pages</p>
                    <p className="text-xs text-indigo-400/40">Click the bookmark icon to save pages</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((bookmark, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-indigo-800/50 bg-indigo-900/30 hover:bg-indigo-900/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <Archive className="w-5 h-5 text-indigo-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{bookmark.title}</p>
                            <p className="text-xs text-indigo-200/40 truncate">{bookmark.url}</p>
                            <p className="text-xs text-indigo-200/30">
                              {new Date(bookmark.timestamp).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => loadBookmark(bookmark)}
                            className="hover:bg-indigo-800/50"
                          >
                            <Archive className="w-4 h-4" />
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
                            className="hover:bg-indigo-800/50"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newBookmarks = bookmarks.filter((_, i) => i !== idx);
                              setBookmarks(newBookmarks);
                              localStorage.setItem('archive-bookmarks', JSON.stringify(newBookmarks));
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

          <TabsContent value="saved" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {savedUrls.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <Save className="w-12 h-12 mx-auto text-indigo-500/40" />
                    <p className="text-indigo-200/60">No saved URLs</p>
                    <p className="text-xs text-indigo-400/40">Enter a URL and click Save to archive it</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {savedUrls.map((entry, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-indigo-800/50 bg-indigo-900/30 hover:bg-indigo-900/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{entry.url}</p>
                          <p className="text-xs text-indigo-200/40">
                            Saved: {new Date(entry.savedAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const waybackUrl = `https://web.archive.org/web/*/${entry.url}`;
                              setIframeUrl(waybackUrl);
                              setActiveTab('wayback');
                              setIsReloading(true);
                              setIframeKey(prev => prev + 1);
                              setTimeout(() => setIsReloading(false), 1000);
                            }}
                            className="hover:bg-indigo-800/50"
                          >
                            <Clock className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newWindow = window.open(entry.url, '_blank', 'noopener,noreferrer');
                              if (newWindow) {
                                newWindow.opener = null;
                              }
                            }}
                            className="hover:bg-indigo-800/50"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newSaved = savedUrls.filter((_, i) => i !== idx);
                              setSavedUrls(newSaved);
                              localStorage.setItem('archive-saved-urls', JSON.stringify(newSaved));
                              toast.success('URL removed');
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
        </Tabs>
      </CardContent>
    </div>
  );
};

export default ArchiveOrgEmbedPlugin;
