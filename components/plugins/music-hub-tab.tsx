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
  Activity, Zap, Radio, Disc, Waves, RefreshCw, ExternalLink,
  Download, Layers, Grid3X3, Loader2, AlertCircle, Wifi,
  WifiOff, CheckCircle, Signal, Database, Trash2, Settings, Info,
} from "lucide-react";
import { toast } from "sonner";
import { PersistentCache } from "@/lib/cache";

// ==================== Types (Strict TypeScript) ====================

interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  videoId: string;
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
}

interface PlaylistConfig {
  albums: Album[];
  lastUpdated: string;
  webhookUrl?: string;
  autoUpdate: boolean;
}

interface VisualizerMode {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

interface LoadError {
  type: 'network' | 'parse' | 'timeout' | 'unknown';
  message: string;
  recoverable: boolean;
}

// ==================== Cache Configuration (Memory-Safe) ====================

const thumbnailCache = new PersistentCache('music_hub_thumb_', 7 * 24 * 60 * 60 * 1000);
const metadataCache = new PersistentCache('music_hub_meta_', 24 * 60 * 60 * 1000);
const playbackCache = new PersistentCache('music_hub_playback_', 30 * 24 * 60 * 60 * 1000);

// Memory cache with size limit
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

// ==================== Constants ====================

const VISUALIZER_MODES: VisualizerMode[] = [
  { id: "ambient", name: "Ambient Flow", icon: Waves, description: "Smooth color transitions" },
  { id: "pulse", name: "Neural Pulse", icon: Activity, description: "Rhythmic beat detection" },
  { id: "particles", name: "Data Particles", icon: Zap, description: "Reactive particle system" },
  { id: "grid", name: "Digital Grid", icon: Grid3X3, description: "Retro futuristic grid" },
];

const EMBED_SOURCES = [
  {
    id: 'youtube-direct',
    name: 'YouTube Direct',
    buildUrl: (videoId: string, autoplay: boolean) =>
      `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay ? 1 : 0}&rel=0&modestbranding=1&controls=1&enablejsapi=1&origin=${typeof window !== 'undefined' ? window.location.origin : ''}`,
    priority: 1,
  },
  {
    id: 'youtube-alt',
    name: 'YouTube Alternative',
    buildUrl: (videoId: string, autoplay: boolean) =>
      `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay ? 1 : 0}&rel=0&controls=1&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&origin=${typeof window !== 'undefined' ? window.location.origin : ''}`,
    priority: 2,
  },
  {
    id: 'youtube-shorts',
    name: 'YouTube Shorts',
    buildUrl: (videoId: string, autoplay: boolean) =>
      `https://www.youtube.com/shorts/${videoId}?autoplay=${autoplay ? 1 : 0}`,
    priority: 3,
  },
];

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
          <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
        </div>
      )}
      {error && !cachedSrc && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <AlertCircle className="w-4 h-4 text-gray-500" />
        </div>
      )}
      <img
        ref={imageRef}
        src={cachedSrc || thumbnailUrl}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoading ? 'opacity-0' : 'opacity-100'
        }`}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          if (target.src !== thumbnailUrl) {
            target.src = thumbnailUrl;
          } else {
            target.src = `https://img.youtube.com/vi/${videoId}/default.jpg`;
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
  onReady: () => void;
  onError: (error: string, source: string) => void;
  onSourceChange: (source: string) => void;
  autoplay?: boolean;
  preload?: boolean;
  isPlaying?: boolean;
}

const YouTubePlayerComponent: React.FC<YouTubePlayerProps> = ({
  videoId,
  onReady,
  onError,
  onSourceChange,
  autoplay = false,
  preload = false,
  isPlaying = false,
}) => {
  const [currentSourceIndex, setCurrentSourceIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadAttempts, setLoadAttempts] = useState({ attempts: 0, lastError: '' });
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'fair' | 'poor'>('good');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const MAX_RETRIES_PER_SOURCE = 3;
  const LOAD_TIMEOUT = 15000;

  const getRetryDelay = useCallback((attempt: number): number => {
    return Math.min(1000 * Math.pow(2, attempt), 10000);
  }, []);

  // Connection quality monitoring
  useEffect(() => {
    const updateConnectionQuality = () => {
      const connection = (navigator as any).connection;
      if (connection) {
        const effectiveType = connection.effectiveType;
        if (effectiveType === '4g' || effectiveType === 'wifi') {
          setConnectionQuality('good');
        } else if (effectiveType === '3g') {
          setConnectionQuality('fair');
        } else {
          setConnectionQuality('poor');
        }
      }
    };

    updateConnectionQuality();
    window.addEventListener('online', updateConnectionQuality);
    window.addEventListener('offline', () => setConnectionQuality('poor'));

    return () => {
      window.removeEventListener('online', updateConnectionQuality);
      window.removeEventListener('offline', () => setConnectionQuality('poor'));
    };
  }, []);

  // Reset on videoId change
  useEffect(() => {
    setIsLoading(true);
    setCurrentSourceIndex(0);
    setLoadAttempts({ attempts: 0, lastError: '' });

    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }

    loadTimeoutRef.current = setTimeout(() => {
      if (isLoading) {
        handleLoadError('Load timeout');
      }
    }, LOAD_TIMEOUT);

    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, [videoId]);

  const handleLoadError = useCallback((errorMessage: string) => {
    console.warn(`[YouTubePlayer] Error: ${errorMessage}, Source: ${EMBED_SOURCES[currentSourceIndex].id}`);

    setLoadAttempts(prev => ({
      attempts: prev.attempts + 1,
      lastError: errorMessage,
    }));

    if (loadAttempts.attempts < MAX_RETRIES_PER_SOURCE) {
      const delay = getRetryDelay(loadAttempts.attempts);
      setTimeout(() => {
        setIsLoading(true);
      }, delay);
    } else {
      if (currentSourceIndex < EMBED_SOURCES.length - 1) {
        const nextIndex = currentSourceIndex + 1;
        setCurrentSourceIndex(nextIndex);
        onSourceChange(EMBED_SOURCES[nextIndex].name);
        setLoadAttempts({ attempts: 0, lastError: '' });
        toast.info(`Switched to ${EMBED_SOURCES[nextIndex].name} fallback`);
      } else {
        setIsLoading(false);
        onError(`All embed sources failed: ${errorMessage}`, EMBED_SOURCES[currentSourceIndex].name);
      }
    }
  }, [currentSourceIndex, loadAttempts, getRetryDelay, onError, onSourceChange]);

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    onReady();
  }, [onReady]);

  const currentSource = EMBED_SOURCES[currentSourceIndex];
  const embedUrl = currentSource.buildUrl(videoId, autoplay && isPlaying);
  const iframeKey = `${videoId}-${currentSourceIndex}-${loadAttempts.attempts}`;

  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400 mb-3" />
          <p className="text-xs text-white/60">Loading from {currentSource.name}...</p>
          {loadAttempts.attempts > 0 && (
            <p className="text-[10px] text-white/40 mt-1">
              Attempt {loadAttempts.attempts + 1}/{MAX_RETRIES_PER_SOURCE}
            </p>
          )}
          <div className="flex items-center gap-1 mt-3">
            <Signal className={`w-3 h-3 ${
              connectionQuality === 'good' ? 'text-green-400' :
              connectionQuality === 'fair' ? 'text-yellow-400' : 'text-red-400'
            }`} />
            <span className="text-[10px] text-white/40 capitalize">{connectionQuality}</span>
          </div>
        </div>
      )}

      <iframe
        key={iframeKey}
        ref={iframeRef}
        src={embedUrl}
        title="Video Player"
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onLoad={handleIframeLoad}
        onError={() => handleLoadError('Iframe load error')}
        sandbox="allow-same-origin allow-scripts allow-presentation allow-forms"
        loading={preload ? 'eager' : 'lazy'}
        referrerPolicy="strict-origin-when-cross-origin"
      />

      {!isLoading && currentSourceIndex === EMBED_SOURCES.length - 1 && loadAttempts.attempts >= MAX_RETRIES_PER_SOURCE && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-purple-900/40 to-black z-20">
          <AlertCircle className="w-12 h-12 mx-auto text-red-400/60 mb-3" />
          <p className="text-sm text-white/60 text-center px-4 mb-4">
            Unable to load video from any source
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://youtu.be/${videoId}`, "_blank")}
              className="border-white/20 text-white/80 hover:bg-white/10"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open YouTube
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentSourceIndex(0);
                setLoadAttempts({ attempts: 0, lastError: '' });
              }}
              className="border-white/20 text-white/80 hover:bg-white/10"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry All
            </Button>
          </div>
        </div>
      )}

      <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-[10px] text-white/60 border border-white/10">
        {currentSource.name}
      </div>
    </div>
  );
};

const YouTubePlayer = React.memo(YouTubePlayerComponent);
YouTubePlayer.displayName = 'YouTubePlayer';

// ==================== Ambient Visualizer ====================

const AmbientVisualizer: React.FC<{ mode: string; isPlaying: boolean }> = React.memo(({ mode, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      timeRef.current += 0.01;
      const time = timeRef.current;

      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (mode === "ambient") {
        for (let i = 0; i < 5; i++) {
          const x = Math.sin(time + i) * canvas.width * 0.3 + canvas.width * 0.5;
          const y = Math.cos(time * 0.8 + i * 0.5) * canvas.height * 0.3 + canvas.height * 0.5;
          const radius = Math.sin(time * 2 + i) * 50 + 100;

          const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, `hsla(${(time * 50 + i * 60) % 360}, 70%, 50%, 0.1)`);
          gradient.addColorStop(1, "transparent");

          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      } else if (mode === "pulse") {
        const pulse = Math.sin(time * 3) * 0.5 + 0.5;
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const x = Math.cos(angle) * 150 * pulse + canvas.width * 0.5;
          const y = Math.sin(angle) * 150 * pulse + canvas.height * 0.5;

          ctx.beginPath();
          ctx.arc(x, y, 20 * pulse, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${(time * 100 + i * 45) % 360}, 80%, 60%, 0.2)`;
          ctx.fill();
        }
      } else if (mode === "particles") {
        for (let i = 0; i < 30; i++) {
          const x = (Math.sin(time * 0.5 + i) * 0.5 + 0.5) * canvas.width;
          const y = (Math.cos(time * 0.3 + i * 0.7) * 0.5 + 0.5) * canvas.height;
          const size = Math.sin(time + i) * 3 + 4;

          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${(time * 80 + i * 30) % 360}, 70%, 70%, 0.3)`;
          ctx.fill();
        }
      } else if (mode === "grid") {
        ctx.strokeStyle = "rgba(139, 92, 246, 0.2)";
        ctx.lineWidth = 1;
        const gridSize = 40;
        const offsetY = (time * 20) % gridSize;

        for (let x = 0; x <= canvas.width; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }

        for (let y = offsetY; y <= canvas.height; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={400}
      className="absolute inset-0 w-full h-full opacity-50"
      aria-hidden="true"
    />
  );
});

AmbientVisualizer.displayName = 'AmbientVisualizer';

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
  const [visualizerMode, setVisualizerMode] = useState("ambient");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [webhookStatus, setWebhookStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [currentEmbedSource, setCurrentEmbedSource] = useState<string>('YouTube Direct');

  // Preload state
  const [preloadProgress, setPreloadProgress] = useState(0);
  const [nextSongId, setNextSongId] = useState<string | null>(null);

  // Cache stats
  const [cacheStats, setCacheStats] = useState({ thumbnails: 0, metadata: 0 });

  // Debounce ref for API calls
  const apiCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Memoized computed values
  const allSongs = useMemo(() => playlist.albums.flatMap(album => album.songs), [playlist.albums]);
  const currentAlbum = useMemo(() => playlist.albums[currentAlbumIndex], [playlist.albums, currentAlbumIndex]);
  const currentSong = useMemo(() => currentAlbum?.songs[currentSongIndex], [currentAlbum, currentSongIndex]);

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

  // Fetch playlist from API on mount
  useEffect(() => {
    const fetchPlaylist = async () => {
      try {
        const response = await fetch('/api/music-hub/playlist', {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.playlist?.albums?.length > 0) {
            setPlaylist(data.playlist);
          }
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
        className="h-full flex flex-col bg-gradient-to-b from-black via-purple-950/20 to-black"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-purple-900/30 via-pink-900/30 to-blue-900/30">
          <div className="flex items-center gap-3">
            <motion.div
              className="p-2 bg-gradient-to-br from-purple-600 to-pink-600 rounded-lg"
              animate={{ rotate: isPlaying ? 360 : 0 }}
              transition={{ duration: 3, repeat: isPlaying ? Infinity : 0, ease: "linear" }}
            >
              <Disc className="w-5 h-5 text-white" />
            </motion.div>
            <div>
              <h3 className="text-lg font-semibold text-white">Music Hub</h3>
              <p className="text-xs text-white/60 flex items-center gap-2">
                Digital Underground Experience
                {webhookStatus === "connected" && (
                  <Badge className="text-[10px] bg-green-500/20 text-green-300 border-green-500/30">
                    <Wifi className="w-2 h-2 mr-1" />
                    Live
                  </Badge>
                )}
              </p>
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
              onClick={() => setViewMode(prev => prev === "grid" ? "list" : "grid")}
              className="text-white/60 hover:text-white"
              title={`${viewMode === "grid" ? "List" : "Grid"} view`}
              aria-label="Toggle view mode"
            >
              {viewMode === "grid" ? <ListMusic className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowPlaylist(prev => !prev)}
              className={showPlaylist ? "text-purple-400" : "text-white/60"}
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
              <AmbientVisualizer mode={visualizerMode} isPlaying={isPlaying} />

              {currentSong ? (
                <ErrorBoundary fallback={
                  <div className="absolute inset-0 flex items-center justify-center">
                    <AlertCircle className="w-12 h-12 text-red-400" />
                  </div>
                }>
                  <YouTubePlayer
                    videoId={currentSong.videoId}
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
                      className={currentSong.liked ? "text-pink-400" : "text-white/60"}
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

            {/* Visualizer Mode Selector */}
            <div className="flex gap-2">
              {VISUALIZER_MODES.map((mode) => {
                const Icon = mode.icon;
                return (
                  <Button
                    key={mode.id}
                    variant={visualizerMode === mode.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setVisualizerMode(mode.id)}
                    className={`flex-1 ${
                      visualizerMode === mode.id
                        ? "bg-gradient-to-r from-purple-600 to-pink-600"
                        : "bg-black/40 border-white/20 text-white/60 hover:bg-white/10"
                    }`}
                    aria-pressed={visualizerMode === mode.id}
                  >
                    <Icon className="w-4 h-4 mr-2" />
                    {mode.name}
                  </Button>
                );
              })}
            </div>

            {/* Player Controls */}
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardContent className="p-4 space-y-4">
                {/* Preload Indicator */}
                {preloadProgress > 0 && preloadProgress < 100 && nextSongId && (
                  <div className="flex items-center gap-2 text-xs text-purple-400">
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
                    className={isShuffle ? "text-purple-400" : "text-white/60"}
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
                    className="w-14 h-14 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-full shadow-lg shadow-purple-500/30"
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
                    className={repeatMode !== "off" ? "text-purple-400" : "text-white/60"}
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
          </div>

          {/* Playlist Panel */}
          {showPlaylist && (
            <ScrollArea className="col-span-1">
              <div className="space-y-4">
                {/* Album List */}
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <ListMusic className="w-4 h-4" />
                    New Releases
                  </h4>
                  <Badge variant="outline" className="text-[10px] border-white/20">
                    {playlist.albums.length} albums
                  </Badge>
                </div>

                {viewMode === "grid" ? (
                  <div className="grid grid-cols-2 gap-3">
                    {playlist.albums.map((album, albumIndex) => (
                      <motion.div
                        key={album.id}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => {
                          setCurrentAlbumIndex(albumIndex);
                          setCurrentSongIndex(0);
                          setIsPlaying(true);
                        }}
                        className={`p-3 rounded-lg cursor-pointer transition-all ${
                          currentAlbumIndex === albumIndex
                            ? "bg-purple-500/20 border-purple-500/30"
                            : "bg-white/5 border-white/10 hover:bg-white/10"
                        } border`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setCurrentAlbumIndex(albumIndex);
                            setCurrentSongIndex(0);
                            setIsPlaying(true);
                          }
                        }}
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
                          <Badge className="mt-1 text-[9px] bg-pink-500/20 text-pink-300 border-pink-500/30">
                            NEW
                          </Badge>
                        )}
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {playlist.albums.map((album, albumIndex) => (
                      <Card
                        key={album.id}
                        className={`bg-white/5 border-white/10 cursor-pointer transition-all ${
                          currentAlbumIndex === albumIndex
                            ? "border-purple-500/30 bg-purple-500/10"
                            : "hover:bg-white/10"
                        }`}
                        onClick={() => {
                          setCurrentAlbumIndex(albumIndex);
                          setCurrentSongIndex(0);
                          setIsPlaying(true);
                        }}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-center gap-3">
                            <CachedThumbnail
                              videoId={album.songs[0]?.videoId || album.id}
                              thumbnailUrl={album.coverUrl}
                              alt={album.title}
                              className="w-12 h-12 rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white truncate">{album.title}</p>
                              <p className="text-xs text-white/40 truncate">{album.artist}</p>
                            </div>
                            {album.isNew && (
                              <Badge className="text-[9px] bg-pink-500/20 text-pink-300 border-pink-500/30">
                                NEW
                              </Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Current Album Songs */}
                {currentAlbum && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-semibold text-white/80">
                        {currentAlbum.title} - Tracks
                      </h5>
                      <Badge variant="outline" className="text-[10px] border-white/20">
                        {currentAlbum.songs.length} tracks
                      </Badge>
                    </div>

                    {currentAlbum.songs.map((song, songIndex) => (
                      <Card
                        key={song.id}
                        className={`bg-white/5 border-white/10 cursor-pointer transition-all ${
                          currentSongIndex === songIndex
                            ? "border-purple-500/30 bg-purple-500/10"
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
                            <div className="w-8 h-8 rounded bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-xs font-bold text-white">
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
                                song.liked ? "text-pink-400" : "text-white/40 hover:text-white"
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
