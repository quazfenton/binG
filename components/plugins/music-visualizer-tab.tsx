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
  BarChart3,
  Maximize2,
  Settings,
  Playlist,
  ListMusic,
  RefreshCw,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";

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

const MOCK_TRACKS: Track[] = [
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
  {
    id: "track-2",
    title: "Stargazing",
    artist: "Travis Scott",
    album: "ASTROWORLD",
    duration: 210,
    coverUrl: "https://picsum.photos/seed/album2/300/300",
    audioUrl: "",
    liked: false,
  },
  {
    id: "track-3",
    title: "Blinding Lights",
    artist: "The Weeknd",
    album: "After Hours",
    duration: 200,
    coverUrl: "https://picsum.photos/seed/album3/300/300",
    audioUrl: "",
    liked: true,
  },
  {
    id: "track-4",
    title: "Levitating",
    artist: "Dua Lipa",
    album: "Future Nostalgia",
    duration: 203,
    coverUrl: "https://picsum.photos/seed/album4/300/300",
    audioUrl: "",
    liked: false,
  },
  {
    id: "track-5",
    title: "Peaches",
    artist: "Justin Bieber",
    album: "Justice",
    duration: 198,
    coverUrl: "https://picsum.photos/seed/album5/300/300",
    audioUrl: "",
    liked: true,
  },
];

const VISUALIZER_MODES: VisualizerMode[] = [
  { id: "bars", name: "Frequency Bars", icon: BarChart3, description: "Classic frequency spectrum" },
  { id: "wave", name: "Waveform", icon: Waves, description: "Audio waveform display" },
  { id: "circle", name: "Circular", icon: Circle, description: "Radial frequency display" },
  { id: "particles", name: "Particles", icon: Zap, description: "Reactive particle system" },
];

export default function MusicVisualizerTab() {
  const [tracks, setTracks] = useState<Track[]>(MOCK_TRACKS);
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
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const currentTrack = tracks[currentTrackIndex];

  // Initialize audio context
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;
    
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  // Visualizer animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
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
    };

    draw();

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
        setCurrentTime(prev => {
          if (prev >= currentTrack.duration) {
            handleNext();
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [isPlaying, currentTrack]);

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
          src={currentTrack.coverUrl}
          alt={currentTrack.title}
          className="w-16 h-16 rounded-lg shadow-lg"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{currentTrack.title}</p>
          <p className="text-xs text-white/60 truncate">{currentTrack.artist}</p>
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
                  max={currentTrack.duration}
                  step={1}
                  onValueChange={(v) => setCurrentTime(v[0])}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-white/40">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(currentTrack.duration)}</span>
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
                  <Playlist className="w-4 h-4" />
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
                        src={track.coverUrl}
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
