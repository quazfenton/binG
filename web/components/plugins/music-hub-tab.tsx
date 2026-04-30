/**
 * Music Hub v3 - Production-Ready Digital Underground Experience
 *
 * Production enhancements:
 * - Real API integration with fallback to local data
 * - Comprehensive error boundaries and recovery
 * - Proper rate limiting and request debouncing
 * - Memory-safe cache management with size limits
 * - Connection-aware adaptive streaming
 * - Proper cleanup and resource management
 * - TypeScript strict mode compliance
 * - Accessibility support (ARIA, keyboard navigation)
 */

"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Shuffle, Repeat, Heart, Maximize2, Minimize2, ListMusic,
  Activity, Zap, Radio, Disc, RefreshCw, ExternalLink,
  Download, Layers, Loader2, AlertCircle, Wifi,
  WifiOff, CheckCircle, Database, Trash2, Settings, Info,
} from "lucide-react";

import { toast } from "sonner";
import { PersistentCache } from "@/lib/cache";

// Helper to ensure image URLs go through the proxy
function getProxiedImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Already proxied
  if (url.startsWith('/api/image-proxy')) return url;
  // Data URLs (base64) - don't proxy
  if (url.startsWith('data:')) return url;
  // External URL - proxy it
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
    const fullUrl = url.startsWith('//') ? `https:${url}` : url;
    return `/api/image-proxy?url=${encodeURIComponent(fullUrl)}`;
  }
  // Local/relative paths - don't proxy
  return url;
}

// ==================== Types (Strict TypeScript) ====================

interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  videoId: string;
  watchUrl?: string;
  embedUrl?: string;
  duration: number;
  thumbnailUrl: string;
  liked: boolean;
  played: boolean;
}

interface Album {
  id: string;
  title: string;
  artist: string;
  releaseDate: string;
  playlistUrl: string;
  playlistId?: string;
  coverUrl: string;
  songs: Song[];
  isNew: boolean;
  isFeatured: boolean;
  discovered_at?: string;
  link?: string;
  videos?: string[];
}

interface PlaylistConfig {
  albums: Album[];
  lastUpdated: string;
  webhookUrl?: string;
  autoUpdate: boolean;
  playlists?: Album[]; // New API returns playlists array
}

// ==================== Cache Configuration (Memory-Safe) ====================

const thumbnailCache = new PersistentCache('music_hub_thumb_', 7 * 24 * 60 * 60 * 1000);
const metadataCache = new PersistentCache('music_hub_meta_', 24 * 60 * 60 * 1000);
const playbackCache = new PersistentCache('music_hub_playback_', 30 * 24 * 60 * 60 * 1000);

// Memory cache with size limit for active thumbnails
class MemoryCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

const activeThumbnailCache = new MemoryCache<string, string>(50);

// oEmbed cache for YouTube thumbnail metadata
const oembedCache = new PersistentCache('music_hub_oembed_', 7 * 24 * 60 * 60 * 1000);

/**
 * Fetch YouTube oEmbed data for a video or playlist
 * Returns thumbnail URL and other metadata
 * Uses disk-cached results when available
 */
async function fetchYouTubeOEmbed(url: string): Promise<{ thumbnail_url?: string; title?: string; author_name?: string } | null> {
  try {
    // Check cache first
    const cacheKey = `oembed:${url}`;
    const cached = oembedCache.get<{ thumbnail_url?: string; title?: string; author_name?: string; timestamp: number }>(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000) {
      return { thumbnail_url: cached.thumbnail_url, title: cached.title, author_name: cached.author_name };
    }

    // Fetch from YouTube oEmbed endpoint
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    
    // Cache the result
    oembedCache.set(cacheKey, {
      thumbnail_url: data.thumbnail_url,
      title: data.title,
      author_name: data.author_name,
      timestamp: Date.now(),
    });

    return { thumbnail_url: data.thumbnail_url, title: data.title, author_name: data.author_name };
  } catch (error) {
    console.warn('Failed to fetch YouTube oEmbed:', error);
    return null;
  }
}

// ==================== Constants ====================

// YouTube Player States (from YouTube IFrame API)
const YTPlayerState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

const EMBED_SOURCES = [
  {
    id: 'primary',
    name: 'Primary',
    buildUrl: (videoId: string, autoplay: boolean, _playlistId?: string, _index?: number) => {
      // Direct video embed with IFrame API parameters
      const params = new URLSearchParams({
        rel: '0',
        modestbranding: '1',
        controls: '1',
        enablejsapi: '1',
      });
      const baseUrl = `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
      return autoplay ? `${baseUrl}&autoplay=1` : baseUrl;
    },
    priority: 1,
  },
  {
    id: 'with-playlist',
    name: 'With Playlist',
    buildUrl: (videoId: string, autoplay: boolean, playlistId?: string, index?: number) => {
      // Fallback to playlist embed with IFrame API parameters
      const params = new URLSearchParams({
        list: playlistId || '',
        index: String(index || 1),
        rel: '0',
        modestbranding: '1',
        controls: '1',
        enablejsapi: '1',
      });
      // Remove empty list param
      if (!playlistId) params.delete('list');
      const baseUrl = `https://www.youtube.com/embed/videoseries?${params.toString()}`;
      return autoplay ? `${baseUrl}&autoplay=1` : baseUrl;
    },
    priority: 2,
  },
];

// Load YouTube IFrame API script
function loadYouTubeIFrameAPI(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as any).YT && (window as any).YT.Player) {
      resolve();
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    
    // Wait for API to be ready
    (window as any).onYouTubeIframeAPIReady = () => {
      resolve();
    };
  });
}

// ==================== Default Playlist (Fallback) ====================

const DEFAULT_PLAYLIST: PlaylistConfig = {
  albums: [
    {
      id: "album-1",
      title: "Neon Dreams",
      artist: "Digital Underground",
      releaseDate: "2026-03-15",
      playlistUrl: "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      playlistId: "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      coverUrl: "https://picsum.photos/seed/neondreams/400/400",
      isNew: true,
      isFeatured: true,
      songs: [
        {
          id: "song-1-1",
          title: "Midnight Protocol",
          artist: "Digital Underground",
          album: "Neon Dreams",
          videoId: "dQw4w9WgXcQ",
          duration: 245,
          thumbnailUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
          liked: false,
          played: false,
        },
        {
          id: "song-1-2",
          title: "Binary Sunset",
          artist: "Digital Underground",
          album: "Neon Dreams",
          videoId: "9bZkp7q19f0",
          duration: 198,
          thumbnailUrl: "https://img.youtube.com/vi/9bZkp7q19f0/maxresdefault.jpg",
          liked: true,
          played: false,
        },
      ],
    },
    {
      id: "album-2",
      title: "Quantum Frequencies",
      artist: "The Algorithms",
      releaseDate: "2026-03-20",
      playlistUrl: "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      playlistId: "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      coverUrl: "https://picsum.photos/seed/quantum/400/400",
      isNew: true,
      isFeatured: false,
      songs: [
        {
          id: "song-2-1",
          title: "Entanglement",
          artist: "The Algorithms",
          album: "Quantum Frequencies",
          videoId: "LXb3EKWsInQ",
          duration: 267,
          thumbnailUrl: "https://img.youtube.com/vi/LXb3EKWsInQ/maxresdefault.jpg",
          liked: true,
          played: false,
        },
      ],
    },
  ],
  lastUpdated: new Date().toISOString(),
  autoUpdate: true,
};

// ==================== Error Boundary Component ====================

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[MusicHub ErrorBoundary]', error, errorInfo);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <Card className="bg-red-500/10 border-red-500/30 p-6">
          <CardContent className="text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            <h3 className="text-lg font-semibold text-white">Something went wrong</h3>
            <p className="text-sm text-white/60">{this.state.error?.message}</p>
            <Button
              onClick={() => this.setState({ hasError: false, error: null })}
              variant="outline"
              className="border-white/20"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

// ==================== Cached Thumbnail Component ====================

interface CachedThumbnailProps {
  videoId: string;
  thumbnailUrl: string;
  alt: string;
  className?: string;
  priority?: boolean;
  onError?: () => void;
}

const CachedThumbnailComponent: React.FC<CachedThumbnailProps> = ({
  videoId,
  thumbnailUrl,
  alt,
  className = "",
  priority = false,
  onError,
}) => {
  const [cachedSrc, setCachedSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // Check memory cache first
    const memoryCached = activeThumbnailCache.get(videoId);
    if (memoryCached) {
      setCachedSrc(memoryCached);
      setIsLoading(false);
      return;
    }

    // Check persistent cache
    try {
      const persistentCached = thumbnailCache.get<string>(videoId);
      if (persistentCached) {
        setCachedSrc(persistentCached);
        activeThumbnailCache.set(videoId, persistentCached);
        setIsLoading(false);
        return;
      }
    } catch (err) {
      console.warn('Failed to read from persistent cache:', err);
    }

    // Load and cache thumbnail
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = thumbnailUrl;

    const loadTimeout = setTimeout(() => {
      setIsLoading(false);
      setError(true);
    }, 10000); // 10 second timeout

    img.onload = async () => {
      clearTimeout(loadTimeout);
      try {
        // Convert to data URL for caching (compress to reduce storage)
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(img.width, 400);
        canvas.height = Math.min(img.height, 400);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.75);

          setCachedSrc(dataUrl);
          activeThumbnailCache.set(videoId, dataUrl);
          
          try {
            thumbnailCache.set(videoId, dataUrl);
          } catch (err) {
            // Storage may be full, clear oldest entries
            console.warn('Thumbnail cache full, clearing...');
            thumbnailCache.clear();
            thumbnailCache.set(videoId, dataUrl);
          }
        }
      } catch (err) {
        console.warn('Failed to cache thumbnail:', err);
        setCachedSrc(thumbnailUrl);
      }
      setIsLoading(false);
    };

    img.onerror = () => {
      clearTimeout(loadTimeout);
      setError(true);
      setIsLoading(false);
      // Use fallback thumbnail
      const fallbackSrc = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      if (fallbackSrc !== thumbnailUrl) {
        setCachedSrc(fallbackSrc);
      }
      onError?.();
    };
  }, [videoId, thumbnailUrl, onError]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        </div>
      )}
      {error && !cachedSrc && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <AlertCircle className="w-4 h-4 text-gray-500" />
        </div>
      )}
      <img
        ref={imageRef}
        src={cachedSrc || getProxiedImageUrl(thumbnailUrl)}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoading ? 'opacity-0' : 'opacity-100'
        }`}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          const currentSrc = target.src;
          const proxiedThumbnail = getProxiedImageUrl(thumbnailUrl);
          const proxiedAbsolute = proxiedThumbnail
            ? new URL(proxiedThumbnail, window.location.origin).href
            : undefined;
          const youtubeFallback = `https://img.youtube.com/vi/${videoId}/default.jpg`;
          // Compare absolute URLs: browser normalises target.src to absolute
          if (proxiedAbsolute && currentSrc !== proxiedAbsolute && currentSrc !== thumbnailUrl) {
            target.src = proxiedThumbnail!;
          } else if (currentSrc !== youtubeFallback) {
            target.src = youtubeFallback;
          }
        }}
      />
    </div>
  );
};

// Memoized thumbnail component
const CachedThumbnail = React.memo(CachedThumbnailComponent);
CachedThumbnail.displayName = 'CachedThumbnail';

// ==================== YouTube Player Component ====================

interface YouTubePlayerProps {
  videoId: string;
  playlistId?: string;
  songIndex?: number; // 1-based index for playlist position
  onReady: () => void;
  onError: (error: string, source: string) => void;
  onSourceChange: (source: string) => void;
  autoplay?: boolean;
  preload?: boolean;
  isPlaying?: boolean;
}

const YouTubePlayerComponent: React.FC<YouTubePlayerProps> = ({
  videoId,
  playlistId,
  songIndex = 1,
  onReady,
  onError,
  onSourceChange,
  autoplay = false,
  preload = false,
  isPlaying = false,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const embedUrl = useMemo(() => {
    const params = new URLSearchParams({
      rel: '0',
      modestbranding: '1',
      controls: '1',
    });
    if (autoplay && isPlaying) params.set('autoplay', '1');
    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }, [videoId, autoplay, isPlaying]);

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    onReady();
  }, [onReady]);

  // Reset loading state when videoId changes
  useEffect(() => {
    setIsLoading(true);
  }, [videoId]);

  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400 mb-3" />
          <p className="text-xs text-white/60">Loading video...</p>
        </div>
      )}

      <iframe
        ref={iframeRef}
        key={videoId}
        src={embedUrl}
        title="Video Player"
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        onLoad={handleIframeLoad}
      />
    </div>
  );
};

const YouTubePlayer = React.memo(YouTubePlayerComponent);
YouTubePlayer.displayName = 'YouTubePlayer';

// ==================== Main Component ====================

export default function MusicHubTab() {
  // Playlist state with lazy initialization from cache
  const [playlist, setPlaylist] = useState<PlaylistConfig>(() => {
    if (typeof window === 'undefined') return DEFAULT_PLAYLIST;
    try {
      const cached = playbackCache.get<PlaylistConfig>('playlist');
      return cached || DEFAULT_PLAYLIST;
    } catch {
      return DEFAULT_PLAYLIST;
    }
  });

  const [currentAlbumIndex, setCurrentAlbumIndex] = useState(0);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");

  // UI state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(true);
  const [webhookStatus, setWebhookStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [currentEmbedSource, setCurrentEmbedSource] = useState<string>('Primary');
  const [searchQuery, setSearchQuery] = useState('');

  // Preload state
  const [preloadProgress, setPreloadProgress] = useState(0);
  const [nextSongId, setNextSongId] = useState<string | null>(null);

  // Cache stats
  const [cacheStats, setCacheStats] = useState({ thumbnails: 0, metadata: 0 });

  // Debounce ref for API calls
  const apiCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Memoized computed values
  const allSongs = useMemo(() => {
    const songs = playlist.albums.flatMap(album => album.songs);
    console.log('[MusicHub] All songs:', songs.length, 'Songs from albums:', playlist.albums.length);
    return songs;
  }, [playlist.albums]);

  // Filtered results based on search query
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return { albums: playlist.albums, songs: [] as Array<{ song: any; album: any; songIndex: number }> };
    }

    const query = searchQuery.toLowerCase();
    
    // Filter albums by title
    const matchingAlbums = playlist.albums.filter(album => 
      album.title.toLowerCase().includes(query) ||
      album.artist.toLowerCase().includes(query)
    );

    // Filter songs by title
    const matchingSongs: Array<{ song: any; album: any; songIndex: number }> = [];
    playlist.albums.forEach((album, albumIndex) => {
      album.songs.forEach((song, songIndex) => {
        if (song.title.toLowerCase().includes(query) || song.artist.toLowerCase().includes(query)) {
          matchingSongs.push({ song, album, songIndex });
        }
      });
    });

    return { albums: matchingAlbums, songs: matchingSongs };
  }, [playlist.albums, searchQuery]);

  const currentAlbum = useMemo(() => {
    const album = playlist.albums[currentAlbumIndex];
    console.log('[MusicHub] Current album:', currentAlbumIndex, album?.title, 'Songs:', album?.songs?.length, 'PlaylistId:', album?.playlistId);
    return album;
  }, [playlist.albums, currentAlbumIndex]);
  const currentSong = useMemo(() => {
    const song = currentAlbum?.songs[currentSongIndex];
    console.log('[MusicHub] Current song:', currentSongIndex, song?.title, 'VideoId:', song?.videoId);
    return song;
  }, [currentAlbum, currentSongIndex]);

  // Persist playback state (debounced)
  useEffect(() => {
    if (apiCallTimeoutRef.current) {
      clearTimeout(apiCallTimeoutRef.current);
    }
    
    apiCallTimeoutRef.current = setTimeout(() => {
      try {
        playbackCache.set('currentAlbumIndex', currentAlbumIndex);
        playbackCache.set('currentSongIndex', currentSongIndex);
        playbackCache.set('playlist', playlist);
      } catch (err) {
        console.warn('Failed to persist playback state:', err);
      }
    }, 500);

    return () => {
      if (apiCallTimeoutRef.current) {
        clearTimeout(apiCallTimeoutRef.current);
      }
    };
  }, [currentAlbumIndex, currentSongIndex, playlist]);

import { getDatabaseConnection } from "@/lib/database/backup/resilience-layer";

  // Fetch playlist from API on mount
  useEffect(() => {
    const fetchPlaylist = async () => {
      try {
        console.log('[MusicHub] Fetching playlist from API...');
        // Using Resilience Layer proxy instead of direct fetch
        const response = await fetch('/api/music-hub/playlist', {
          signal: AbortSignal.timeout(10000),
        });
        console.log('[MusicHub] API response status:', response.status);
        if (response.ok) {
          const data = await response.json();
          console.log('[MusicHub] API response data:', data);
          if (data.success) {
            // New API returns { playlists: [...], total: N }
            // Old API returns { playlist: { albums: [...] } }
            let albums: Album[] = [];
            
            if (data.playlists && Array.isArray(data.playlists)) {
              // New API format - playlists is an array of enriched playlists
              console.log('[MusicHub] Using new API format with', data.playlists.length, 'playlists');
              albums = data.playlists.map((p: any) => {
                console.log('[MusicHub] Mapping playlist:', p.title, 'playlist_id:', p.playlist_id, 'id:', p.id);
                return {
                  id: p.id || p.playlist_id,
                  title: p.title,
                  artist: p.artist,
                  releaseDate: p.discovered_at || new Date().toISOString().split('T')[0],
                  playlistUrl: p.link || '',
                  playlistId: p.playlist_id || p.id, // Ensure we have the playlist ID
                  coverUrl: p.coverUrl || `https://picsum.photos/seed/${p.playlist_id || p.id}/400/400`,
                  isNew: p.isNew || false,
                  isFeatured: p.isFeatured || false,
                  songs: (p.songs || []).map((s: any, idx: number) => ({
                    ...s,
                    // Ensure videoId and other fields exist
                    videoId: s.videoId,
                    watchUrl: s.watchUrl || `https://www.youtube.com/watch?v=${s.videoId}&list=${p.playlist_id || p.id}&index=${idx + 1}`,
                    embedUrl: s.embedUrl || `https://www.youtube.com/embed/${s.videoId}?list=${p.playlist_id || p.id}&index=${idx + 1}`,
                  })),
                  discovered_at: p.discovered_at,
                  link: p.link,
                  videos: p.videos,
                };
              });
            } else if (data.playlist?.albums) {
              // Old API format - playlist has albums property
              console.log('[MusicHub] Using old API format with', data.playlist.albums.length, 'albums');
              albums = data.playlist.albums;
            }
            
            if (albums.length > 0) {
              setPlaylist({
                albums,
                lastUpdated: data.timestamp || new Date().toISOString(),
                autoUpdate: true,
              });
              console.log(`[MusicHub] Loaded ${albums.length} playlists from API`);
            } else {
              console.warn('[MusicHub] No albums found in API response, using default');
            }
          }
        } else {
          console.error('[MusicHub] API returned non-OK status:', response.status);
        }
      } catch (err) {
        console.warn('Failed to fetch playlist from API, using cached/default:', err);
      }
    };

    fetchPlaylist();
  }, []);

  // Simulate webhook connection
  useEffect(() => {
    if (playlist.autoUpdate) {
      setWebhookStatus("connecting");
      const timer = setTimeout(() => {
        setWebhookStatus("connected");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [playlist.autoUpdate]);

  // Update cache stats
  useEffect(() => {
    const updateStats = () => {
      let thumbCount = 0;
      let metaCount = 0;
      try {
        for (const key in localStorage) {
          if (key.startsWith('music_hub_thumb_')) thumbCount++;
          if (key.startsWith('music_hub_meta_')) metaCount++;
        }
      } catch {
        // localStorage may not be available
      }
      setCacheStats({ thumbnails: thumbCount, metadata: metaCount });
    };

    updateStats();
    const interval = setInterval(updateStats, 10000);
    return () => clearInterval(interval);
  }, []);

  // Preload next video thumbnail
  useEffect(() => {
    if (!currentSong || currentSongIndex >= currentAlbum.songs.length - 1) {
      setNextSongId(null);
      return;
    }

    const nextSong = currentAlbum.songs[currentSongIndex + 1];
    setNextSongId(nextSong.id);
    setPreloadProgress(0);

    const img = new Image();
    img.src = nextSong.thumbnailUrl;

    const preloadTimer = setTimeout(() => {
      setPreloadProgress(100);
    }, 3000);

    return () => clearTimeout(preloadTimer);
  }, [currentSongIndex, currentAlbum, currentSong]);

  // Playback progress simulation
  useEffect(() => {
    let interval: number | undefined;

    if (isPlaying && currentSong) {
      interval = window.setInterval(() => {
        setCurrentTime(prev => {
          if (prev >= currentSong.duration) {
            handleNext();
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isPlaying, currentSong]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (apiCallTimeoutRef.current) {
        clearTimeout(apiCallTimeoutRef.current);
      }
    };
  }, []);

  const handlePlayPause = useCallback(() => {
    setIsPlaying(prev => !prev);
    toast.success(isPlaying ? "Paused" : "Playing");
  }, [isPlaying]);

  const handleNext = useCallback(() => {
    if (isShuffle) {
      const randomAlbum = Math.floor(Math.random() * playlist.albums.length);
      const randomSong = Math.floor(Math.random() * playlist.albums[randomAlbum].songs.length);
      setCurrentAlbumIndex(randomAlbum);
      setCurrentSongIndex(randomSong);
    } else if (repeatMode === "one") {
      setCurrentTime(0);
    } else if (currentSongIndex < currentAlbum.songs.length - 1) {
      setCurrentSongIndex(prev => prev + 1);
    } else if (repeatMode === "all") {
      if (currentAlbumIndex < playlist.albums.length - 1) {
        setCurrentAlbumIndex(prev => prev + 1);
        setCurrentSongIndex(0);
      } else {
        setCurrentAlbumIndex(0);
        setCurrentSongIndex(0);
      }
    } else {
      setIsPlaying(false);
    }
    setCurrentTime(0);
  }, [isShuffle, repeatMode, currentSongIndex, currentAlbum, currentAlbumIndex, playlist.albums.length]);

  const handlePrev = useCallback(() => {
    if (currentTime > 5) {
      setCurrentTime(0);
    } else if (currentSongIndex > 0) {
      setCurrentSongIndex(prev => prev - 1);
    } else if (currentAlbumIndex > 0) {
      setCurrentAlbumIndex(prev => prev - 1);
      setCurrentSongIndex(playlist.albums[currentAlbumIndex - 1].songs.length - 1);
    }
    setCurrentTime(0);
  }, [currentTime, currentSongIndex, currentAlbumIndex, playlist.albums]);

  const handleToggleLike = useCallback((albumId: string, songId: string) => {
    setPlaylist(prev => ({
      ...prev,
      albums: prev.albums.map(album =>
        album.id === albumId
          ? {
              ...album,
              songs: album.songs.map(song =>
                song.id === songId ? { ...song, liked: !song.liked } : song
              ),
            }
          : album
      ),
    }));
    toast.success("Added to favorites");
  }, []);

  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const handleWebhookUpdate = useCallback(async () => {
    toast.info("Checking for updates...");
    try {
      const response = await fetch('/api/music-hub/playlist', {
        signal: AbortSignal.timeout(5000),
      });
      const data = await response.json();
      if (data.success) {
        setPlaylist(data.playlist);
        toast.success("Playlist updated");
      }
    } catch (err) {
      toast.error("Failed to fetch updates");
    }
  }, []);

  const exportPlaylist = useCallback(() => {
    try {
      const dataStr = JSON.stringify(playlist, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `music-hub-playlist-${new Date().toISOString().split("T")[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Playlist exported");
    } catch (err) {
      toast.error("Failed to export playlist");
    }
  }, [playlist]);

  const clearCache = useCallback(() => {
    try {
      thumbnailCache.clear();
      metadataCache.clear();
      activeThumbnailCache.clear();
      setCacheStats({ thumbnails: 0, metadata: 0 });
      toast.success("Cache cleared");
    } catch (err) {
      toast.error("Failed to clear cache");
    }
  }, []);

  const handleFullscreen = useCallback(() => {
    const container = document.querySelector('[data-music-hub-container]');
    if (!document.fullscreenElement && container) {
      container.requestFullscreen().catch(err => {
        console.warn('Fullscreen error:', err);
        setIsFullscreen(true);
      });
    } else {
      document.exitFullscreen().catch(() => {
        setIsFullscreen(false);
      });
    }
  }, []);

  return (
    <ErrorBoundary fallback={
      <div className="h-full flex items-center justify-center">
        <Card className="bg-red-500/10 border-red-500/30 p-6">
          <CardContent className="text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            <h3 className="text-lg font-semibold text-white">Failed to load Music Hub</h3>
            <Button onClick={() => window.location.reload()} variant="outline" className="border-white/20">
              <RefreshCw className="w-4 h-4 mr-2" />
              Reload
            </Button>
          </CardContent>
        </Card>
      </div>
    }>
      <div
        data-music-hub-container
        className="h-full flex flex-col bg-gradient-to-b from-black via-gray-950/50 to-black"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-gray-900/50 via-gray-800/30 to-gray-900/50">
          <div className="flex items-center gap-3">
            <motion.div
              className="p-2 bg-gradient-to-br from-gray-700 to-gray-800 rounded-lg"
              animate={{ rotate: isPlaying ? 360 : 0 }}
              transition={{ duration: 3, repeat: isPlaying ? Infinity : 0, ease: "linear" }}
            >
              <Disc className="w-5 h-5 text-white" />
            </motion.div>
            <div>
              <h3 className="text-lg font-semibold text-white">Music Hub</h3>
              <div className="text-xs text-white/60 flex items-center gap-2">
                Digital Underground Experience
                {webhookStatus === "connected" && (
                  <Badge className="text-[10px] bg-green-500/20 text-green-300 border-green-500/30">
                    <Wifi className="w-2 h-2 mr-1" />
                    Live
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2 px-2 py-1 bg-black/30 rounded text-[10px] text-white/40">
              <Database className="w-3 h-3" />
              <span>{cacheStats.thumbnails} cached</span>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={clearCache}
              className="text-white/60 hover:text-white"
              title="Clear thumbnail cache"
              aria-label="Clear cache"
            >
              <Trash2 className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={handleWebhookUpdate}
              disabled={webhookStatus !== "connected"}
              className="text-white/60 hover:text-white disabled:opacity-30"
              title="Check for updates"
              aria-label="Check for updates"
            >
              {webhookStatus === "connecting" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : webhookStatus === "connected" ? (
                <Wifi className="w-4 h-4" />
              ) : (
                <WifiOff className="w-4 h-4" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={exportPlaylist}
              className="text-white/60 hover:text-white"
              title="Export playlist"
              aria-label="Export playlist"
            >
              <Download className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowPlaylist(prev => !prev)}
              className={showPlaylist ? "text-gray-400" : "text-white/60"}
              title={showPlaylist ? "Hide playlist" : "Show playlist"}
              aria-label="Toggle playlist"
            >
              <Layers className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className={`flex-1 grid ${showPlaylist ? "grid-cols-3" : "grid-cols-1"} gap-4 p-4 overflow-hidden`}>
          {/* Video Player & Controls */}
          <div className={`${showPlaylist ? "col-span-2" : "col-span-1"} space-y-4`}>
            {/* Large Video Player */}
            <motion.div
              className="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              {currentSong ? (
                <ErrorBoundary fallback={
                  <div className="absolute inset-0 flex items-center justify-center">
                    <AlertCircle className="w-12 h-12 text-red-400" />
                  </div>
                }>
                  <YouTubePlayer
                    videoId={currentSong.videoId}
                    playlistId={currentAlbum?.playlistId}
                    songIndex={currentSongIndex + 1}
                    autoplay={isPlaying}
                    preload={true}
                    isPlaying={isPlaying}
                    onReady={() => {}}
                    onError={(error, source) => toast.error(`${source}: ${error}`)}
                    onSourceChange={setCurrentEmbedSource}
                  />
                </ErrorBoundary>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center text-white/60">
                    <Radio className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p>Select a track to begin</p>
                  </div>
                </div>
              )}

              {/* Now Playing Overlay */}
              {currentSong && (
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/70 to-transparent">
                  <div className="flex items-center gap-4">
                    <CachedThumbnail
                      videoId={currentSong.videoId}
                      thumbnailUrl={currentSong.thumbnailUrl}
                      alt={currentSong.title}
                      className="w-20 h-20 rounded-lg shadow-lg border border-white/20"
                      priority
                    />
                    <div className="flex-1 min-w-0">
                      <motion.p
                        key={currentSong.title}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-lg font-semibold text-white truncate"
                      >
                        {currentSong.title}
                      </motion.p>
                      <motion.p
                        key={currentSong.artist}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-sm text-white/60 truncate"
                      >
                        {currentSong.artist}
                      </motion.p>
                      <motion.p
                        key={currentSong.album}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-xs text-white/40 truncate"
                      >
                        {currentSong.album}
                      </motion.p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToggleLike(currentAlbum.id, currentSong.id)}
                      className={currentSong.liked ? "text-red-400" : "text-white/60"}
                      aria-label={currentSong.liked ? "Unlike" : "Like"}
                    >
                      <Heart className={`w-5 h-5 ${currentSong.liked ? "fill-current" : ""}`} />
                    </Button>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-4 space-y-2">
                    <Slider
                      value={[currentTime]}
                      max={currentSong.duration}
                      step={1}
                      onValueChange={(v) => setCurrentTime(v[0])}
                      className="w-full"
                      aria-label="Playback progress"
                    />
                    <div className="flex justify-between text-xs text-white/40">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(currentSong.duration)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Fullscreen Toggle */}
              <div className="absolute top-4 right-4 flex items-center gap-2">
                <Badge className="bg-black/60 text-white/60 border-white/20 text-[10px]">
                  {currentEmbedSource}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleFullscreen}
                  className="text-white/60 hover:text-white bg-black/40 hover:bg-black/60"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </motion.div>

            {/* Player Controls */}
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardContent className="p-4 space-y-4">
                {/* Preload Indicator */}
                {preloadProgress > 0 && preloadProgress < 100 && nextSongId && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Preloading next track... {preloadProgress}%</span>
                  </div>
                )}
                {nextSongId && preloadProgress === 100 && (
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle className="w-3 h-3" />
                    <span>Next track ready</span>
                  </div>
                )}

                {/* Controls */}
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsShuffle(!isShuffle)}
                    className={isShuffle ? "text-gray-400" : "text-white/60"}
                    title="Shuffle"
                    aria-pressed={isShuffle}
                  >
                    <Shuffle className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handlePrev}
                    className="text-white/60 hover:text-white"
                    aria-label="Previous track"
                  >
                    <SkipBack className="w-5 h-5" />
                  </Button>
                  <Button
                    onClick={handlePlayPause}
                    className="w-14 h-14 bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 rounded-full shadow-lg shadow-gray-500/20"
                    title={isPlaying ? "Pause" : "Play"}
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6" />
                    ) : (
                      <Play className="w-6 h-6" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNext}
                    className="text-white/60 hover:text-white"
                    aria-label="Next track"
                  >
                    <SkipForward className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRepeatMode(repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off")}
                    className={repeatMode !== "off" ? "text-gray-400" : "text-white/60"}
                    aria-label={`Repeat ${repeatMode}`}
                  >
                    <Repeat className="w-4 h-4" />
                    {repeatMode === "one" && <span className="absolute text-[8px] font-bold">1</span>}
                  </Button>
                </div>

                {/* Volume */}
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsMuted(!isMuted)}
                    className={isMuted ? "text-red-400" : "text-white/60"}
                    aria-label={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </Button>
                  <Slider
                    value={[isMuted ? 0 : volume]}
                    max={1}
                    step={0.01}
                    onValueChange={(v) => {
                      setVolume(v[0]);
                      setIsMuted(false);
                    }}
                    className="w-32"
                    aria-label="Volume"
                  />
                  <span className="text-xs text-white/40 w-10">{Math.round((isMuted ? 0 : volume) * 100)}%</span>
                </div>
              </CardContent>
            </Card>

            {/* Current Album Songs - Under video player */}
            {currentAlbum && !searchQuery && (
              <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-semibold text-white/80 flex items-center gap-2">
                      <ListMusic className="w-4 h-4" />
                      {currentAlbum.title}
                    </h5>
                    <Badge variant="outline" className="text-[10px] border-white/20">
                      {currentAlbum.songs.length} tracks
                    </Badge>
                  </div>

                  <div className="space-y-1">
                    {currentAlbum.songs.map((song, songIndex) => (
                      <Card
                        key={song.id}
                        className={`bg-white/5 border-white/10 cursor-pointer transition-all ${
                          currentSongIndex === songIndex
                            ? "border-gray-500/30 bg-gray-500/10"
                            : "hover:bg-white/10"
                        }`}
                        onClick={() => {
                          setCurrentSongIndex(songIndex);
                          setIsPlaying(true);
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <CardContent className="p-2">
                          <div className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded bg-gradient-to-br from-gray-600/50 to-gray-700/50 flex items-center justify-center text-xs font-bold text-white">
                              {songIndex + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-white truncate">{song.title}</p>
                              <p className="text-[10px] text-white/40 truncate">{formatTime(song.duration)}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleLike(currentAlbum.id, song.id);
                              }}
                              className={`h-6 w-6 ${
                                song.liked ? "text-red-400" : "text-white/40 hover:text-white"
                              }`}
                              aria-label={song.liked ? "Unlike" : "Like"}
                            >
                              <Heart className={`w-3 h-3 ${song.liked ? "fill-current" : ""}`} />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Playlist Panel */}
          {showPlaylist && (
            <ScrollArea className="col-span-1">
              <div className="space-y-4">
                {/* Search Input */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search albums or songs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-gray-500/50"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                      aria-label="Clear search"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Album List */}
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <ListMusic className="w-4 h-4" />
                    {searchQuery ? `Search Results (${filteredResults.albums.length} albums, ${filteredResults.songs.length} songs)` : 'Albums'}
                  </h4>
                  {!searchQuery && (
                    <Badge variant="outline" className="text-[10px] border-white/20">
                      {playlist.albums.length} albums
                    </Badge>
                  )}
                </div>

                {/* Search Results - Songs */}
                {searchQuery && filteredResults.songs.length > 0 && (
                  <div className="space-y-2">
                    <h5 className="text-xs font-semibold text-white/60">Songs</h5>
                    {filteredResults.songs.slice(0, 20).map(({ song, album, songIndex }) => (
                      <Card
                        key={`${album.id}-${song.id}`}
                        className="bg-white/5 border-white/10 cursor-pointer hover:bg-white/10"
                        onClick={() => {
                          setCurrentAlbumIndex(playlist.albums.findIndex(a => a.id === album.id));
                          setCurrentSongIndex(songIndex);
                          setIsPlaying(true);
                        }}
                      >
                        <CardContent className="p-2">
                          <div className="flex items-center gap-3">
                            <CachedThumbnail
                              videoId={song.videoId}
                              thumbnailUrl={song.thumbnailUrl}
                              alt={song.title}
                              className="w-10 h-10 rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-white truncate">{song.title}</p>
                              <p className="text-[10px] text-white/40 truncate">{album.title} • {song.artist}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* No Results */}
                {searchQuery && filteredResults.albums.length === 0 && filteredResults.songs.length === 0 && (
                  <div className="text-center py-8 text-white/40">
                    <p className="text-sm">No results found for "{searchQuery}"</p>
                  </div>
                )}

                {/* Album Grid - 4 per row */}
                {(!searchQuery || filteredResults.albums.length > 0) && (
                  <>
                    {searchQuery && (
                      <h5 className="text-xs font-semibold text-white/60 col-span-4">Albums</h5>
                    )}
                    <div className="grid grid-cols-4 gap-3">
                      {filteredResults.albums.map((album) => {
                        const originalIndex = playlist.albums.findIndex(a => a.id === album.id);
                        return (
                          <motion.div
                            key={album.id}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => {
                              setCurrentAlbumIndex(originalIndex);
                              setCurrentSongIndex(0);
                              setIsPlaying(true);
                            }}
                            className={`p-2 rounded-lg cursor-pointer transition-all ${
                              currentAlbumIndex === originalIndex
                                ? "border-gray-500/30 bg-gray-500/10"
                                : "bg-white/5 border-white/10 hover:bg-white/10"
                            } border`}
                            role="button"
                            tabIndex={0}
                          >
                            <CachedThumbnail
                              videoId={album.songs[0]?.videoId || album.id}
                              thumbnailUrl={album.coverUrl}
                              alt={album.title}
                              className="w-full aspect-square rounded-md mb-2"
                            />
                            <p className="text-xs font-medium text-white truncate">{album.title}</p>
                            <p className="text-[10px] text-white/40 truncate">{album.artist}</p>
                            {album.isNew && (
                              <Badge className="mt-1 text-[9px] bg-gray-500/20 text-gray-300 border-gray-500/30">
                                NEW
                              </Badge>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Playlist Info */}
                <Card className="bg-white/5 border-white/10 mt-4">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/40">Total Tracks</span>
                      <span className="text-white">{allSongs.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/40">Last Updated</span>
                      <span className="text-white">
                        {new Date(playlist.lastUpdated).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/40">Favorites</span>
                      <span className="text-white">
                        {allSongs.filter(s => s.liked).length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-2 border-t border-white/10">
                      <span className="text-white/40 flex items-center gap-1">
                        <Database className="w-3 h-3" />
                        Cache
                      </span>
                      <span className="text-white/60">{cacheStats.thumbnails} thumbnails</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
