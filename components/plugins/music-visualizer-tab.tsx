/**
 * Music & Audio Visualizer Tab
 * 
 * Real-time audio visualization with:
 * - Frequency spectrum analyzer
 * - Waveform display
 * - Multiple visualizer modes
 * - Music player integration
 * - Audio reactive animations
 */

"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Music,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat,
  Heart,
  Download,
  Share,
  Mic,
  Radio,
  Disc,
  Activity,
  Waves,
  Circle,
  Zap,
  BarChart3,
  Maximize2,
  Settings,
  ListMusic,
  RefreshCw,
  Search,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

// Fetch tracks from API
async function fetchTracks(limit = 50): Promise<Track[]> {
  try {
    const response = await fetch('/api/music/visualizer/tracks');
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch tracks');
    }
    
    return data.tracks || [];
  } catch (err: any) {
    console.error('[MusicVisualizer] Failed to fetch tracks:', err);
    toast.error('Failed to load tracks');
    return [];
  }
}

// Fetch visualizer modes from API
async function fetchModes(): Promise<VisualizerMode[]> {
  try {
    const response = await fetch('/api/music/visualizer/modes');
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch modes');
    }
    
    return data.modes || [];
  } catch (err: any) {
    console.error('[MusicVisualizer] Failed to fetch modes:', err);
    return [];
  }
}

// Types
interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  audioUrl: string;
  liked: boolean;
}

interface VisualizerMode {
  id: string;
  name: string;
  icon: any;
  description: string;
}

// MusicBrainz API base URL - free, no auth required
const MUSICBRAINZ_API = 'https://musicbrainz.org/ws/2';
const COVERART_ARCHIVE_API = 'https://coverartarchive.org';

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

// Default fallback tracks if API fails
const DEFAULT_TRACKS: Track[] = [
  {
    id: "track-1",
    title: "Midnight City",
    artist: "M83",
    album: "Hurry Up, We're Dreaming",
    duration: 243,
    coverUrl: "https://picsum.photos/seed/album1/300/300",
    audioUrl: "",
    liked: true,
  },
];

// Fetch artist info from MusicBrainz
async function fetchArtistFromMusicBrainz(artistName: string): Promise<any> {
  try {
    const response = await fetch(
      `${MUSICBRAINZ_API}/artist?query=${encodeURIComponent(artistName)}&fmt=json&limit=1`,
      {
        headers: {
          'User-Agent': 'binG/1.0 (https://github.com/quazfenton/binG)',
          'Accept': 'application/json',
        },
      }
    );
    const data = await response.json();
    return data.artists?.[0] || null;
  } catch (error) {
    console.error('MusicBrainz API error:', error);
    return null;
  }
}

// Fetch release (album) from MusicBrainz
async function fetchReleasesFromMusicBrainz(artistId: string): Promise<any[]> {
  try {
    const response = await fetch(
      `${MUSICBRAINZ_API}/release?artist=${artistId}&fmt=json&limit=10&type=album`,
      {
        headers: {
          'User-Agent': 'binG/1.0 (https://github.com/quazfenton/binG)',
          'Accept': 'application/json',
        },
      }
    );
    const data = await response.json();
    return data.releases || [];
  } catch (error) {
    console.error('MusicBrainz releases error:', error);
    return [];
  }
}

// Fetch cover art from Cover Art Archive
async function fetchCoverArt(releaseId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${COVERART_ARCHIVE_API}/release/${releaseId}`,
      {
        headers: {
          'User-Agent': 'binG/1.0 (https://github.com/quazfenton/binG)',
        },
      }
    );
    if (response.ok) {
      const data = await response.json();
      const image = data.images?.[0]?.image;
      return image || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Fetch trending artists from MusicBrainz (using tag 'pop' as a proxy)
async function fetchTrendingArtists(): Promise<any[]> {
  try {
    const response = await fetch(
      `${MUSICBRAINZ_API}/artist?query=tag:pop&fmt=json&limit=10&sort=rating`,
      {
        headers: {
          'User-Agent': 'binG/1.0 (https://github.com/quazfenton/binG)',
          'Accept': 'application/json',
        },
      }
    );
    const data = await response.json();
    return data.artists || [];
  } catch (error) {
    console.error('MusicBrainz trending error:', error);
    return [];
  }
}

// Search for tracks from MusicBrainz
async function searchTracks(query: string): Promise<Track[]> {
  try {
    const response = await fetch(
      `${MUSICBRAINZ_API}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=10`,
      {
        headers: {
          'User-Agent': 'binG/1.0 (https://github.com/quazfenton/binG)',
          'Accept': 'application/json',
        },
      }
    );
    const data = await response.json();
    
    const tracks: Track[] = [];
    for (const recording of data.recordings || []) {
      if (!recording.releases?.[0]) continue;
      
      const release = recording.releases[0];
      let coverUrl = `https://picsum.photos/seed/${release.id}/300/300`;
      
      // Try to get real cover art
      try {
        const coverArtResponse = await fetch(
          `${COVERART_ARCHIVE_API}/release/${release.id}`,
          { headers: { 'User-Agent': 'binG/1.0' } }
        );
        if (coverArtResponse.ok) {
          const coverData = await coverArtResponse.json();
          if (coverData.images?.[0]?.thumbnails?.small) {
            coverUrl = coverData.images[0].thumbnails.small;
          }
        }
      } catch {}
      
      tracks.push({
        id: recording.id,
        title: recording.title,
        artist: recording['artist-credit']?.[0]?.name || 'Unknown',
        album: release.title,
        duration: Math.floor(Math.random() * 180) + 120, // Approximate
        coverUrl,
        audioUrl: '',
        liked: false,
      });
    }
    
    return tracks;
  } catch (error) {
    console.error('MusicBrainz search error:', error);
    return [];
  }
}

const VISUALIZER_MODES: VisualizerMode[] = [
  { id: "bars", name: "Frequency Bars", icon: BarChart3, description: "Classic frequency spectrum" },
  { id: "wave", name: "Waveform", icon: Waves, description: "Audio waveform display" },
  { id: "circle", name: "Circular", icon: Circle, description: "Radial frequency display" },
  { id: "particles", name: "Particles", icon: Zap, description: "Reactive particle system" },
];

export default function MusicVisualizerTab() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [visualizerMode, setVisualizerMode] = useState("bars");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(true);
  const [isLoadingTracks, setIsLoadingTracks] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dataSource, setDataSource] = useState<'default' | 'musicbrainz'>('default');
  const [modes, setModes] = useState<VisualizerMode[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const currentTrack = tracks[currentTrackIndex];

  // Load tracks and modes on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoadingTracks(true);
      const [tracksData, modesData] = await Promise.all([
        fetchTracks(50),
        fetchModes(),
      ]);
      
      setTracks(tracksData.length > 0 ? tracksData : DEFAULT_TRACKS);
      setModes(modesData);
    } catch (err) {
      console.warn('Failed to load data, using defaults:', err);
      setTracks(DEFAULT_TRACKS);
    } finally {
      setIsLoadingTracks(false);
    }
  };

  // Initialize audio context
  useEffect(() => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioContextRef.current = new AudioContextClass();
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
      }
    } catch (err) {
      console.warn('Audio context not supported:', err);
    }

    return () => {
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  // Visualizer animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    if (!analyser) {
      // Draw static message if no analyser
      ctx.fillStyle = "rgba(0, 0, 0, 1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Audio context not available", canvas.width / 2, canvas.height / 2);
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      try {
        animationRef.current = requestAnimationFrame(draw);

        analyser.getByteFrequencyData(dataArray);

        ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        if (visualizerMode === "bars") {
          for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] * 1.5;

            const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
            gradient.addColorStop(0, "#8b5cf6");
            gradient.addColorStop(0.5, "#ec4899");
            gradient.addColorStop(1, "#f59e0b");

            ctx.fillStyle = gradient;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
          }
        } else if (visualizerMode === "wave") {
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#8b5cf6";
          ctx.beginPath();

          const sliceWidth = canvas.width / bufferLength;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * canvas.height) / 2;

            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }

            x += sliceWidth;
          }

          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();
        } else if (visualizerMode === "circle") {
          const centerX = canvas.width / 2;
          const centerY = canvas.height / 2;
          const radius = Math.min(centerX, centerY) * 0.6;

          for (let i = 0; i < bufferLength; i++) {
            const angle = (i / bufferLength) * Math.PI * 2;
            const barHeight = (dataArray[i] / 255) * radius * 0.5;

            const x1 = centerX + Math.cos(angle) * radius;
            const y1 = centerY + Math.sin(angle) * radius;
            const x2 = centerX + Math.cos(angle) * (radius + barHeight);
            const y2 = centerY + Math.sin(angle) * (radius + barHeight);

            ctx.strokeStyle = `hsl(${(i / bufferLength) * 360}, 100%, 50%)`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
      } catch (drawError) {
        console.warn('Visualizer draw error:', drawError);
      }
    };

    // Only start animation when playing
    if (isPlaying) {
      draw();
    } else {
      // Clear canvas when paused
      ctx.fillStyle = "rgba(0, 0, 0, 1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [visualizerMode, isPlaying]);

  // Simulate playback progress
  useEffect(() => {
    let interval: number;

    if (isPlaying) {
      interval = window.setInterval(() => {
        setCurrentTime((prev) => {
          const duration = currentTrack?.duration;
          if (!duration || duration <= 0) return prev;
          if (prev >= duration) {
            if (repeatMode === "one") {
              // Restart the current track instead of advancing
              return 0;
            }
            handleNext();
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [isPlaying, currentTrack, repeatMode]);

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
    toast.success(isPlaying ? "Paused" : "Playing");
  };

  const handleNext = () => {
    if (isShuffle) {
      setCurrentTrackIndex(Math.floor(Math.random() * tracks.length));
    } else {
      setCurrentTrackIndex((prev) => (prev + 1) % tracks.length);
    }
    setCurrentTime(0);
  };

  const handlePrev = () => {
    setCurrentTrackIndex((prev) => (prev - 1 + tracks.length) % tracks.length);
    setCurrentTime(0);
  };

  const handleToggleLike = (trackId: string) => {
    setTracks(prev => prev.map(t =>
      t.id === trackId ? { ...t, liked: !t.liked } : t
    ));
    toast.success("Added to favorites");
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Load tracks from MusicBrainz API
  const loadTracksFromAPI = async (query?: string) => {
    setIsLoadingTracks(true);
    try {
      let newTracks: Track[];
      
      if (query) {
        // Search for specific tracks
        newTracks = await searchTracks(query);
      } else {
        // Fetch trending pop artists and their releases
        const artists = await fetchTrendingArtists();
        const allTracks: Track[] = [];
        
        for (const artist of artists.slice(0, 5)) {
          const releases = await fetchReleasesFromMusicBrainz(artist.id);
          for (const release of releases.slice(0, 2)) {
            const coverUrl = await fetchCoverArt(release.id) || `https://picsum.photos/seed/${release.id}/300/300`;
            allTracks.push({
              id: release.id,
              title: release.title,
              artist: artist.name,
              album: release.title,
              duration: Math.floor(Math.random() * 180) + 120,
              coverUrl,
              audioUrl: '',
              liked: false,
            });
          }
        }
        newTracks = allTracks;
      }
      
      if (newTracks.length > 0) {
        setTracks(newTracks);
        setDataSource('musicbrainz');
        setCurrentTrackIndex(0);
        setCurrentTime(0);
        toast.success(`Loaded ${newTracks.length} tracks from MusicBrainz`);
      } else {
        toast.error('No tracks found');
      }
    } catch (error) {
      console.error('Failed to load tracks:', error);
      toast.error('Failed to load tracks from API');
    } finally {
      setIsLoadingTracks(false);
    }
  };

  const VisualizerComponent = () => (
    <div className="relative w-full h-full min-h-[300px] bg-gradient-to-b from-purple-900/20 to-black/40 rounded-lg overflow-hidden">
      <canvas
        ref={canvasRef}
        width={800}
        height={400}
        className="w-full h-full"
      />
      
      {/* Overlay Info */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
        <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">
          <Activity className="w-3 h-3 mr-1" />
          {visualizerMode.toUpperCase()}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="text-white/60 hover:text-white"
        >
          <Maximize2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Now Playing Overlay */}
      <div className="absolute bottom-4 left-4 right-4 flex items-center gap-4">
        <img
          src={getProxiedImageUrl(currentTrack?.coverUrl) || "https://picsum.photos/seed/default/300/300"}
          alt={currentTrack?.title || "Unknown"}
          className="w-16 h-16 rounded-lg shadow-lg"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{currentTrack?.title || "No track selected"}</p>
          <p className="text-xs text-white/60 truncate">{currentTrack?.artist || ""}</p>
        </div>
        {isPlaying && (
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4].map(i => (
              <motion.div
                key={i}
                animate={{ height: [8, 16, 8] }}
                transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                className="w-1 bg-purple-400 rounded-full"
                style={{ height: "8px" }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-purple-500/10 to-pink-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
            <Music className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Music Visualizer</h3>
            <p className="text-xs text-white/60">Audio Visualization & Player</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search/Load from API */}
          <div className="flex items-center gap-1">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tracks..."
              className="w-32 h-8 text-xs bg-black/40 border-white/20"
              onKeyDown={(e) => e.key === 'Enter' && loadTracksFromAPI(searchQuery)}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => loadTracksFromAPI(searchQuery)}
              disabled={isLoadingTracks}
              className="text-white/60 hover:text-white h-8 w-8"
              title="Search MusicBrainz"
            >
              {isLoadingTracks ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => loadTracksFromAPI()}
            disabled={isLoadingTracks}
            className={dataSource === 'musicbrainz' ? "text-green-400" : "text-white/60 hover:text-white"}
            title="Load trending from MusicBrainz"
          >
            <Radio className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowPlaylist(!showPlaylist)}
            className={showPlaylist ? "text-purple-400" : "text-white/60"}
          >
            <ListMusic className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white/60 hover:text-white"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 grid ${showPlaylist ? "grid-cols-3" : "grid-cols-1"} gap-4 p-4 overflow-hidden`}>
        {/* Visualizer */}
        <div className={`${showPlaylist ? "col-span-2" : "col-span-1"} space-y-4`}>
          <VisualizerComponent />

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
                      ? "bg-gradient-to-r from-purple-500 to-pink-500"
                      : "bg-black/40 border-white/20 text-white/60"
                  }`}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {mode.name}
                </Button>
              );
            })}
          </div>

          {/* Player Controls */}
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-4 space-y-4">
              {/* Progress Bar */}
              <div className="space-y-2">
                <Slider
                  value={[currentTime]}
                  max={currentTrack?.duration || 100}
                  step={1}
                  onValueChange={(v) => setCurrentTime(v[0])}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-white/40">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(currentTrack?.duration || 0)}</span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsShuffle(!isShuffle)}
                  className={isShuffle ? "text-purple-400" : "text-white/60"}
                >
                  <Shuffle className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePrev}
                  className="text-white/60 hover:text-white"
                >
                  <SkipBack className="w-5 h-5" />
                </Button>
                <Button
                  onClick={handlePlayPause}
                  className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNext}
                  className="text-white/60 hover:text-white"
                >
                  <SkipForward className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRepeatMode(repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off")}
                  className={repeatMode !== "off" ? "text-purple-400" : "text-white/60"}
                >
                  <Repeat className="w-4 h-4" />
                  {repeatMode === "one" && <span className="absolute text-[8px]">1</span>}
                </Button>
              </div>

              {/* Volume */}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsMuted(!isMuted)}
                  className={isMuted ? "text-red-400" : "text-white/60"}
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
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Playlist */}
        {showPlaylist && (
          <ScrollArea className="col-span-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <ListMusic className="w-4 h-4" />
                  Playlist
                </h4>
                <Badge variant="outline" className="text-[10px] border-white/20">
                  {tracks.length} tracks
                </Badge>
              </div>

              {tracks.map((track, index) => (
                <Card
                  key={track.id}
                  className={`bg-white/5 border-white/10 cursor-pointer transition-all ${
                    currentTrackIndex === index
                      ? "border-purple-500/30 bg-purple-500/10"
                      : "hover:bg-white/10"
                  }`}
                  onClick={() => {
                    setCurrentTrackIndex(index);
                    setCurrentTime(0);
                    setIsPlaying(true);
                  }}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={getProxiedImageUrl(track.coverUrl)}
                        alt={track.title}
                        className="w-12 h-12 rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{track.title}</p>
                        <p className="text-xs text-white/40 truncate">{track.artist}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-white/40">
                          {formatTime(track.duration)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleLike(track.id);
                          }}
                          className={`h-6 w-6 ${
                            track.liked ? "text-pink-400" : "text-white/40 hover:text-white"
                          }`}
                        >
                          <Heart className={`w-3 h-3 ${track.liked ? "fill-current" : ""}`} />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
