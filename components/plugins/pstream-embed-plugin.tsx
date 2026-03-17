/**
 * P-Stream Movie Embed Plugin
 * 
 * Embeds movies and TV shows from pstream.net
 * Provides a clean iframe wrapper with search and favorites
 */

"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import {
  Film,
  X,
  ExternalLink,
  Maximize2,
  Minimize2,
  Search,
  Bookmark,
  Clock,
  Copy,
  Check,
  AlertCircle,
  Tv,
  Star,
  Play,
} from 'lucide-react';
import { toast } from 'sonner';

interface FavoriteEntry {
  id: string;
  title: string;
  url: string;
  timestamp: number;
  type: 'movie' | 'series';
}

interface HistoryEntry {
  id: string;
  title: string;
  url: string;
  timestamp: number;
}

const PStreamEmbedPlugin: React.FC<{ onClose: () => void, initialUrl?: string }> = ({ onClose, initialUrl }) => {
  const [inputUrl, setInputUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('pstream-initial-url');
      if (stored) {
        sessionStorage.removeItem('pstream-initial-url');
        return stored;
      }
    }
    return initialUrl || '';
  });
  
  const [embedUrl, setEmbedUrl] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [videoTitle, setVideoTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load favorites and history from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const savedFavorites = localStorage.getItem('pstream-favorites');
      const savedHistory = localStorage.getItem('pstream-history');
      
      if (savedFavorites) {
        setFavorites(JSON.parse(savedFavorites));
      }
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch (e) {
      console.error('Failed to load P-Stream data:', e);
    }
  }, []);

  // Save favorites to localStorage
  const saveFavorites = useCallback((newFavorites: FavoriteEntry[]) => {
    setFavorites(newFavorites);
    if (typeof window !== 'undefined') {
      localStorage.setItem('pstream-favorites', JSON.stringify(newFavorites));
    }
  }, []);

  // Save history to localStorage
  const saveHistory = useCallback((newHistory: HistoryEntry[]) => {
    setHistory(newHistory);
    if (typeof window !== 'undefined') {
      localStorage.setItem('pstream-history', JSON.stringify(newHistory.slice(0, 20))); // Keep last 20
    }
  }, []);

  // Parse P-Stream URL and extract embed URL
  const parsePStreamUrl = useCallback((url: string): { embedUrl: string; title: string } | null => {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      
      // Check if it's a pstream.net URL
      if (!hostname.includes('pstream.net') && !hostname.includes('pstream')) {
        return null;
      }

      // Extract video ID from URL
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const videoId = pathParts[pathParts.length - 1] || pathParts.find(p => /^\d+$/.test(p));
      
      if (!videoId) {
        return null;
      }

      // Determine if it's a movie or series
      const isSeries = urlObj.pathname.includes('/series/') || urlObj.pathname.includes('/tv/');
      const type = isSeries ? 'series' : 'movie';
      
      // Construct embed URL
      const embedPath = isSeries ? '/embed/series/' : '/embed/';
      const embedUrl = `https://www.pstream.net${embedPath}${videoId}`;
      
      // Extract title from URL or use default
      const titleMatch = urlObj.pathname.match(/\/([^/]+)-\d+/);
      const title = titleMatch ? titleMatch[1].replace(/-/g, ' ') : 'P-Stream Video';
      
      return {
        embedUrl,
        title: title.charAt(0).toUpperCase() + title.slice(1),
      };
    } catch {
      return null;
    }
  }, []);

  // Load video
  const loadVideo = useCallback((url: string, title?: string) => {
    setIsLoading(true);
    setError(null);
    
    const parsed = parsePStreamUrl(url);
    
    if (!parsed) {
      setError('Invalid P-Stream URL. Please copy the URL from pstream.net');
      setIsLoading(false);
      return;
    }

    setEmbedUrl(parsed.embedUrl);
    setVideoTitle(title || parsed.title);
    setIsLoading(false);

    // Add to history
    const newHistory: HistoryEntry = {
      id: Date.now().toString(),
      title: title || parsed.title,
      url,
      timestamp: Date.now(),
    };
    saveHistory([newHistory, ...history]);

    toast.success('Video loaded', {
      description: title || parsed.title,
    });
  }, [parsePStreamUrl, saveHistory, history]);

  // Handle URL submission
  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputUrl.trim()) {
      toast.error('Please enter a URL');
      return;
    }
    
    let urlToLoad = inputUrl.trim();
    if (!urlToLoad.startsWith('http')) {
      urlToLoad = 'https://' + urlToLoad;
    }
    
    loadVideo(urlToLoad);
  }, [inputUrl, loadVideo]);

  // Add to favorites
  const addToFavorites = useCallback(() => {
    if (!embedUrl || !videoTitle) return;

    const exists = favorites.some(f => f.url === inputUrl);
    if (exists) {
      toast.info('Already in favorites');
      return;
    }

    const isSeries = embedUrl.includes('/series/');
    const newFavorite: FavoriteEntry = {
      id: Date.now().toString(),
      title: videoTitle,
      url: inputUrl,
      timestamp: Date.now(),
      type: isSeries ? 'series' : 'movie',
    };

    saveFavorites([newFavorite, ...favorites]);
    toast.success('Added to favorites');
  }, [embedUrl, videoTitle, inputUrl, favorites, saveFavorites]);

  // Remove from favorites
  const removeFromFavorites = useCallback((id: string) => {
    const newFavorites = favorites.filter(f => f.id !== id);
    saveFavorites(newFavorites);
    toast.success('Removed from favorites');
  }, [favorites, saveFavorites]);

  // Load from favorites
  const loadFromFavorites = useCallback((favorite: FavoriteEntry) => {
    setInputUrl(favorite.url);
    loadVideo(favorite.url, favorite.title);
    setShowFavorites(false);
  }, [loadVideo]);

  // Load from history
  const loadFromHistory = useCallback((entry: HistoryEntry) => {
    setInputUrl(entry.url);
    loadVideo(entry.url, entry.title);
    setShowHistory(false);
  }, [loadVideo]);

  // Copy current URL
  const copyUrl = useCallback(() => {
    if (!inputUrl) return;
    navigator.clipboard.writeText(inputUrl);
    toast.success('URL copied to clipboard');
  }, [inputUrl]);

  // Open in new tab
  const openInNewTab = useCallback(() => {
    if (!inputUrl) return;
    window.open(inputUrl, '_blank', 'noopener,noreferrer');
  }, [inputUrl]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Clear history
  const clearHistory = useCallback(() => {
    saveHistory([]);
    toast.success('History cleared');
  }, [saveHistory]);

  return (
    <Card className={`w-full h-full flex flex-col bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 border-purple-500/20 ${isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'rounded-xl'}`}>
      {/* Header */}
      <CardHeader className="flex flex-row items-center justify-between p-4 border-b border-purple-500/20 bg-black/40">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-gradient-to-br from-purple-600 to-pink-600 rounded-lg">
            <Film className="w-5 h-5 text-white" />
          </div>
          <div>
            <CardTitle className="text-lg text-white">P-Stream Movies</CardTitle>
            {videoTitle && (
              <p className="text-xs text-purple-300 truncate max-w-[200px]">{videoTitle}</p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            className="h-8 w-8 text-purple-300 hover:text-white hover:bg-purple-500/20"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-purple-300 hover:text-white hover:bg-purple-500/20"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      {/* Content */}
      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        {/* URL Input */}
        <div className="p-4 border-b border-purple-500/20 bg-black/20">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Paste P-Stream movie/series URL..."
                className="bg-black/40 border-purple-500/30 text-white placeholder:text-purple-400/50 pr-20"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={copyUrl}
                  className="h-6 w-6 text-purple-400 hover:text-white"
                  title="Copy URL"
                >
                  <Copy className="w-3 h-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={openInNewTab}
                  className="h-6 w-6 text-purple-400 hover:text-white"
                  title="Open in new tab"
                >
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <Button 
              type="submit" 
              disabled={!inputUrl.trim() || isLoading}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-4"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            </Button>
          </form>

          {/* Quick Actions */}
          <div className="flex gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFavorites(!showFavorites)}
              className="flex-1 bg-black/30 border-purple-500/30 text-purple-300 hover:bg-purple-500/20 hover:text-white"
            >
              <Bookmark className="w-3 h-3 mr-2" />
              Favorites ({favorites.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              className="flex-1 bg-black/30 border-purple-500/30 text-purple-300 hover:bg-purple-500/20 hover:text-white"
            >
              <Clock className="w-3 h-3 mr-2" />
              History ({history.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={addToFavorites}
              disabled={!embedUrl}
              className="bg-black/30 border-purple-500/30 text-purple-300 hover:bg-purple-500/20 hover:text-white disabled:opacity-50"
            >
              <Star className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-4 bg-red-500/10 border-b border-red-500/20">
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4" />
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 relative bg-black">
          {embedUrl ? (
            <>
              <iframe
                src={embedUrl}
                className="w-full h-full"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                title={videoTitle || 'P-Stream Video'}
                onLoad={() => setIsLoading(false)}
              />
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="text-center">
                    <RefreshCw className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-2" />
                    <p className="text-purple-300 text-sm">Loading video...</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md p-8">
                <div className="p-4 bg-gradient-to-br from-purple-600/20 to-pink-600/20 rounded-full inline-block mb-4">
                  <Film className="w-16 h-16 text-purple-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Watch Movies & TV Shows</h3>
                <p className="text-purple-300/80 mb-4">
                  Paste a P-Stream URL to start watching your favorite movies and TV shows
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-purple-400/60">
                  <Tv className="w-4 h-4" />
                  <span>Movies & Series Supported</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Favorites Panel */}
        {showFavorites && (
          <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black via-black/95 to-black/90 border-t border-purple-500/20">
            <div className="flex items-center justify-between p-3 border-b border-purple-500/20">
              <h4 className="text-sm font-medium text-white flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-purple-400" />
                Favorites
              </h4>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowFavorites(false)}
                className="h-6 w-6 text-purple-300 hover:text-white"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
            <ScrollArea className="h-[calc(100%-40px)]">
              {favorites.length === 0 ? (
                <div className="p-8 text-center text-purple-400/60 text-sm">
                  <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No favorites yet</p>
                  <p className="text-xs mt-1">Click the star icon to add videos</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {favorites.map((fav) => (
                    <div
                      key={fav.id}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-purple-500/10 group"
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => loadFromFavorites(fav)}
                        className="h-8 w-8 text-purple-300 hover:text-white"
                      >
                        <Play className="w-3 h-3" />
                      </Button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{fav.title}</p>
                        <div className="flex items-center gap-2 text-xs text-purple-400/60">
                          <Badge variant="outline" className="text-[10px] border-purple-500/30">
                            {fav.type === 'series' ? 'TV Series' : 'Movie'}
                          </Badge>
                          <span>{new Date(fav.timestamp).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFromFavorites(fav.id)}
                        className="h-6 w-6 text-purple-400 hover:text-red-400 opacity-0 group-hover:opacity-100"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* History Panel */}
        {showHistory && (
          <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black via-black/95 to-black/90 border-t border-purple-500/20">
            <div className="flex items-center justify-between p-3 border-b border-purple-500/20">
              <h4 className="text-sm font-medium text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-400" />
                Watch History
              </h4>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearHistory}
                  className="h-6 text-xs text-purple-300 hover:text-red-400"
                >
                  Clear
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowHistory(false)}
                  className="h-6 w-6 text-purple-300 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[calc(100%-40px)]">
              {history.length === 0 ? (
                <div className="p-8 text-center text-purple-400/60 text-sm">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No watch history</p>
                  <p className="text-xs mt-1">Videos you watch will appear here</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {history.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-purple-500/10 group"
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => loadFromHistory(entry)}
                        className="h-8 w-8 text-purple-300 hover:text-white"
                      >
                        <Play className="w-3 h-3" />
                      </Button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{entry.title}</p>
                        <p className="text-xs text-purple-400/60">
                          {new Date(entry.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PStreamEmbedPlugin;
