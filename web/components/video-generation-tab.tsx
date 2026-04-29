use client";

import React, { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { buildApiHeaders } from "@/lib/utils";
import {
  VideoIcon,
  Sparkles,
  Download,
  Trash2,
  Settings2,
  Zap,
  Maximize2,
  Shuffle,
  Loader2,
  AlertCircle,
  CheckCircle,
  Layers,
  Palette,
  Sliders,
  Eye,
  EyeOff,
  Expand,
  Shrink,
  ExternalLink,
  Copy,
  VideoOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clipboard } from "@bing/platform/clipboard";
import { useApiKeys } from '@/hooks/use-api-keys';
import { useBYOKFallback } from '@/hooks/use-byok-fallback';
import BYOKFadeInInput, { BYOKFadeInWrapper } from '@/components/byok-fade-in-input';
import { useState } from 'react';

/**
 * Video Generation Tab Component
 * Interface for AI video generation with multiple providers and models
 */
export interface VideoGenerationTabProps {
  /** Callback when video is generated */
  onVideoGenerated?: (videoUrl: string) => void;
}

interface GeneratedVideo {
  url: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
  duration: number;
  seed?: number;
  metadata?: Record<string, any>;
}

interface GenerationParams {
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  width: number;
  height: number;
  duration: number;
  quality: "low" | "medium" | "high" | "ultra";
  style: string;
  seed: number | "random";
  model: string;
  provider: string;
  motionStrength: number;
  cameraMovement: string;
  initImageUrl?: string;
}

// Import video generation utilities
import {
  getAllVideoModels,
  getVideoAspectRatios,
  getVideoStyles,
  getVideoQualityPresets
} from "@/lib/video-generation";

// Get models and presets from the video generation module
const VIDEO_ASPECT_RATIOS = getVideoAspectRatios();
const VIDEO_STYLES = getVideoStyles();
const QUALITY_PRESETS: Record<string, { duration: number; label: string }> = {
  low: { duration: 2, label: "Fast (2s)" },
  medium: { duration: 4, label: "Balanced (4s)" },
  high: { duration: 8, label: "High Quality (8s)" },
  ultra: { duration: 16, label: "Ultra Quality (16s)" },
};

const MOTION_STRENGTHS = [
  { value: "0", label: "None" },
  { value: "25", label: "Subtle" },
  { value: "50", label: "Moderate" },
  { value: "75", label: "Strong" },
  { value: "100", label: "Intense" },
];

const CAMERA_MOVEMENTS = [
  { value: "none", label: "None" },
  { value: "slight", label: "Slight" },
  { value: "moderate", label: "Moderate" },
  { value: "strong", label: "Strong" },
];

// Get all available video models
const ALL_VIDEO_MODELS = getAllVideoModels();

// Organize models by provider
const MODELS_BY_PROVIDER: Record<string, Array<{ value: string; label: string; provider: string; type?: string }>> = {};
ALL_VIDEO_MODELS.forEach(model => {
  if (!MODELS_BY_PROVIDER[model.provider]) {
    MODELS_BY_PROVIDER[model.provider] = [];
  }
  MODELS_BY_PROVIDER[model.provider].push({
    value: model.id,
    label: model.id.split('/').pop() || model.id,
    provider: model.provider,
    type: model.type
  });
});

const PROVIDERS = [
  { value: "auto", label: "Auto (with Fallback)" },
  { value: "vercel", label: "Vercel AI" },
  // Add more providers here as they become available
];

export default function VideoGenerationTab({ onVideoGenerated }: VideoGenerationTabProps) {
  // Check if video generation is enabled via environment variable
  const [isEnabled, setIsEnabled] = useState(false);
  
  // BYOK fade-in input state
  const { 
    showBYOKInput, 
    byokError, 
    setShowBYOKInput, 
    setByokError, 
    recordFailure,
    handleApiKeySave,
    handleRetry,
  } = useBYOKFallback();
  
  const { apiKeys, getApiKey } = useApiKeys();
  
  // Check if video generation feature is enabled
  React.useEffect(() => {
    // Check environment variable - VIDEO_GENERATION_ENABLED=true enables the feature
    const enabled = process.env.NEXT_PUBLIC_VIDEO_GENERATION_ENABLED === 'true';
    setIsEnabled(enabled);
  }, []);

  if (!isEnabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <div className="max-w-md">
          <div className="mb-6">
            <VideoIcon className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-2xl font-bold mb-2">Video Generation</h3>
            <Badge variant="secondary" className="mb-4">
              Coming Soon
            </Badge>
          </div>
          <p className="text-muted-foreground mb-6">
            Video generation is currently under development and will be available soon.
            This feature will allow you to generate videos from text prompts using
            advanced AI models.
          </p>
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Zap className="w-4 h-4" />
              <span>Powered by Vercel AI Video Models</span>
            </div>
            <div className="text-xs text-muted-foreground/70">
              <p>To enable this feature for development/testing, set:</p>
              <code className="bg-muted p-2 rounded mt-1 block">
                NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=true
              </code>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const [params, setParams] = useState<GenerationParams>({
    prompt: "",
    negativePrompt: "",
    aspectRatio: "16:9",
    width: 1792,
    height: 1024,
    duration: 4,
    quality: "medium",
    style: "None",
    seed: "random",
    model: "default",
    provider: "auto",
    motionStrength: 50,
    cameraMovement: "slight",
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedVideos, setGeneratedVideos] = useState<GeneratedVideo[]>(() => {
    // Load from localStorage on mount
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('generated-videos');
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (e) {
        console.warn('[VideoGenerationTab] Failed to load videos from localStorage:', e);
      }
    }
    return [];
  });
  const [selectedVideo, setSelectedVideo] = useState<GeneratedVideo | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generationHistory, setGenerationHistory] = useState<GenerationParams[]>(() => {
    // Load from localStorage on mount
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('video-generation-history');
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (e) {
        console.warn('[VideoGenerationTab] Failed to load history from localStorage:', e);
      }
    }
    return [];
  });
  const abortControllerRef = useRef<AbortController | null>(null);

  // Ref to store the generate function to avoid initialization order issues
  const generateFnRef = useRef<(() => Promise<void>) | null>(null);

  // Save generated videos to localStorage
  React.useEffect(() => {
    try {
      localStorage.setItem('generated-videos', JSON.stringify(generatedVideos));
    } catch (e) {
      console.warn('[VideoGenerationTab] Failed to save videos to localStorage:', e);
    }
  }, [generatedVideos]);

  // Save generation history to localStorage
  React.useEffect(() => {
    try {
      localStorage.setItem('video-generation-history', JSON.stringify(generationHistory));
    } catch (e) {
      console.warn('[VideoGenerationTab] Failed to save history to localStorage:', e);
    }
  }, [generationHistory]);

  // Update dimensions when aspect ratio changes
  const handleAspectRatioChange = useCallback((value: string) => {
    const ratio = VIDEO_ASPECT_RATIOS.find((r) => r.value === value);
    if (ratio) {
      setParams((prev) => ({
        ...prev,
        aspectRatio: value,
        width: ratio.width,
        height: ratio.height,
      }));
    }
  }, []);

  // Update duration when quality changes
  const handleQualityChange = useCallback((value: "low" | "medium" | "high" | "ultra") => {
    const preset = QUALITY_PRESETS[value];
    if (preset) {
      setParams((prev) => ({
        ...prev,
        quality: value,
        duration: preset.duration,
      }));
    }
  }, []);

  // Generate video - stored in ref to avoid initialization order issues
  const handleGenerate = useCallback(async () => {
    if (!params.prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }

    setIsGenerating(true);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/video/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildApiHeaders(),
        },
        body: JSON.stringify({
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          width: params.width,
          height: params.height,
          duration: params.duration,
          quality: params.quality,
          seed: params.seed,
          aspectRatio: params.aspectRatio,
          style: params.style,
          motionStrength: params.motionStrength,
          cameraMovement: params.cameraMovement,
          model: params.model === "default" ? undefined : params.model,
          provider: params.provider === "auto" ? undefined : params.provider,
          initImageUrl: params.initImageUrl,
        }),
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();

      console.log('[VideoGenerationTab] API Response:', data);

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate video");
      }

      // Handle different response structures
      const videos = data?.data?.videos || data?.videos || [];
      
      console.log('[VideoGenerationTab] Extracted videos:', videos);

      if (videos && videos.length > 0) {
        // Append new videos to the front (newest first), limit to 20 videos
        setGeneratedVideos((prev) => [...videos, ...prev].slice(0, 20));
        setSelectedVideo(videos[0]);

        // Save to history (keep last 10)
        setGenerationHistory((prev) => [params, ...prev.slice(0, 9)]);

        toast.success(
          `Generated ${videos.length} video${videos.length > 1 ? "s" : ""} using ${data?.data?.provider || data?.provider || 'unknown'}`
        );

        onVideoGenerated?.(videos[0].url);
      } else {
        console.error('[VideoGenerationTab] No videos in response:', data);
        throw new Error("No videos were generated");
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        toast.info("Generation cancelled");
      } else {
        console.error("Generation error:", error);
        const errorMessage = error.message || "Failed to generate video";
        toast.error(errorMessage);
        
        // Record this failure and show BYOK input if appropriate
        recordFailure(params.provider === 'auto' ? selectedProvider : params.provider, error);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [params, onVideoGenerated]);

  // Store generate function in ref for use by keyboard handlers
  React.useEffect(() => {
    generateFnRef.current = handleGenerate;
  }, [handleGenerate]);

  // Cancel generation
  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  // Generate random seed
  const randomizeSeed = useCallback(() => {
    setParams((prev) => ({
      ...prev,
      seed: Math.floor(Math.random() * 2147483647),
    }));
  }, []);

  // Copy video prompt
  const copyPrompt = useCallback(async () => {
    try {
      await clipboard.writeText(params.prompt);
      toast.success("Prompt copied to clipboard");
    } catch (error) {
      console.error('Clipboard write failed:', error);
      toast.error("Failed to copy prompt to clipboard");
    }
  }, [params.prompt]);

  // Reuse video parameters
  const reuseParameters = useCallback((historyItem: GenerationParams) => {
    setParams(historyItem);
    toast.success("Parameters loaded");
  }, []);

  // Clear all videos
  const clearVideos = useCallback(() => {
    setGeneratedVideos([]);
    setSelectedVideo(null);
    setVideoErrors(new Set());
    localStorage.removeItem('generated-videos');
    localStorage.removeItem('video-generation-history');
    toast.info("Cleared all videos");
  }, []);

  // Video error handler state
  const [videoErrors, setVideoErrors] = useState<Set<string>>(new Set());

  // Video error handler
  const handleVideoError = useCallback((videoUrl: string) => {
    setVideoErrors(prev => new Set(prev).add(videoUrl));
    console.warn('[VideoGenerationTab] Video failed to load:', videoUrl);
  }, []);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl+Enter or Cmd+Enter to generate from anywhere
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isGenerating && params.prompt.trim()) {
        generateFnRef.current?.();
      }
    }
  }, [isGenerating, params.prompt]);

  // Handle prompt textarea keyboard events
  const handlePromptKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter without Shift to generate (in textarea)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating && params.prompt.trim()) {
        generateFnRef.current?.();
      }
    }
    // Ctrl+Enter or Cmd+Enter also works
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isGenerating && params.prompt.trim()) {
        generateFnRef.current?.();
      }
    }
  }, [isGenerating, params.prompt]);

  return (
    <>
      <BYOKFadeInWrapper isVisible={showBYOKInput} onDismiss={() => setShowBYOKInput(false)}>
        {byokError && (
          <BYOKFadeInInput
            providerId={byokError.providerId}
            providerName={byokError.providerName}
            errorMessage={byokError.errorMessage}
            onSave={handleApiKeySave}
            onRetry={handleRetry}
            onDismiss={() => setShowBYOKInput(false)}
            initialApiKey={getApiKey(byokError.providerId)}
          />
        )}
      </BYOKFadeInWrapper>
      <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <VideoIcon className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold">Video Generator</h3>
          <Badge variant="secondary" className="text-xs">
            {params.provider === "auto" ? "Auto" : params.provider}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <Settings2 className="w-4 h-4 mr-1" />
            {showAdvanced ? "Simple" : "Advanced"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden" onKeyDown={handleKeyDown}>
        <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 overflow-auto">
          {/* Left Panel - Controls */}
          <div className="lg:col-span-1 space-y-4 overflow-auto">
            {/* Prompt */}
            <Card className="border-0 shadow-none bg-transparent">
              <CardContent className="p-0 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Prompt</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyPrompt}
                    className="h-6 text-xs"
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy
                  </Button>
                </div>
                <Textarea
                  value={params.prompt}
                  onChange={(e) =>
                    setParams((prev) => ({ ...prev, prompt: e.target.value }))
                  }
                  onKeyDown={handlePromptKeyDown}
                  placeholder="Describe the video you want to generate..."
                  className="min-h-[100px] resize-none"
                  disabled={isGenerating}
                />
              </CardContent>
            </Card>

            {/* Negative Prompt (Advanced) */}
            {showAdvanced && (
              <Card className="border-0 shadow-none bg-transparent">
                <CardContent className="p-0 space-y-3">
                  <Label className="text-sm font-medium">Negative Prompt</Label>
                  <Textarea
                    value={params.negativePrompt}
                    onChange={(e) =>
                      setParams((prev) => ({
                        ...prev,
                        negativePrompt: e.target.value,
                      }))
                    }
                    placeholder="What to avoid in the video..."
                    className="min-h-[60px] resize-none"
                    disabled={isGenerating}
                  />
                </CardContent>
              </Card>
            )}

            {/* Quick Settings */}
            <Card className="border-0 shadow-none bg-transparent">
              <CardContent className="p-0 space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Aspect Ratio</Label>
                  <Select
                    value={params.aspectRatio}
                    onValueChange={handleAspectRatioChange}
                    disabled={isGenerating}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_ASPECT_RATIOS.map((ratio) => (
                        <SelectItem key={ratio.value} value={ratio.value}>
                          {ratio.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Quality Preset
                  </Label>
                  <Select
                    value={params.quality}
                    onValueChange={handleQualityChange}
                    disabled={isGenerating}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(QUALITY_PRESETS).map(([value, preset]) => (
                        <SelectItem key={value} value={value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Style</Label>
                  <Select
                    value={params.style}
                    onValueChange={(value) =>
                      setParams((prev) => ({ ...prev, style: value }))
                    }
                    disabled={isGenerating}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_STYLES.map((style) => (
                        <SelectItem key={style} value={style}>
                          {style}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {showAdvanced && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Provider
                      </Label>
                      <Select
                        value={params.provider}
                        onValueChange={(value) =>
                          setParams((prev) => ({ ...prev, provider: value }))
                        }
                        disabled={isGenerating}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROVIDERS.map((provider) => (
                            <SelectItem key={provider.value} value={provider.value}>
                              {provider.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Model</Label>
                      <Select
                        value={params.model}
                        onValueChange={(value) =>
                          setParams((prev) => ({ ...prev, model: value }))
                        }
                        disabled={isGenerating}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODELS_BY_PROVIDER[params.provider]?.map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label} ({model.type})
                            </SelectItem>
                          )) || (
                            <SelectItem value="default">Auto (Best Available)</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Seed</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={randomizeSeed}
                          className="h-6 text-xs"
                          disabled={isGenerating}
                        >
                          <Shuffle className="w-3 h-3 mr-1" />
                          Random
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          value={params.seed === "random" ? "" : params.seed}
                          onChange={(e) =>
                            setParams((prev) => ({
                              ...prev,
                              seed: e.target.value
                                ? parseInt(e.target.value)
                                : "random",
                            }))
                          }
                          placeholder="Random"
                          disabled={isGenerating}
                          className="flex-1"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Motion Strength: {params.motionStrength}%
                      </Label>
                      <Slider
                        value={[params.motionStrength]}
                        onValueChange={([value]) =>
                          setParams((prev) => ({ ...prev, motionStrength: value }))
                        }
                        min={0}
                        max={100}
                        step={1}
                        disabled={isGenerating}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Camera Movement</Label>
                      <Select
                        value={params.cameraMovement}
                        onValueChange={(value) =>
                          setParams((prev) => ({ ...prev, cameraMovement: value }))
                        }
                        disabled={isGenerating}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CAMERA_MOVEMENTS.map((movement) => (
                            <SelectItem key={movement.value} value={movement.value}>
                              {movement.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !params.prompt.trim()}
              className="w-full h-12 text-base"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  Generate Video
                </>
              )}
            </Button>

            {isGenerating && (
              <Button
                onClick={handleCancel}
                variant="outline"
                className="w-full"
              >
                Cancel
              </Button>
            )}
          </div>

          {/* Right Panel - Preview */}
          <div className="lg:col-span-2 space-y-4 overflow-auto">
            {/* Main Preview */}
            <Card className="min-h-[400px] border-0 shadow-none bg-transparent">
              <CardContent className="p-0">
                {selectedVideo ? (
                  <>
                    <div className="relative aspect-video max-h-[500px] mx-auto">
                      {videoErrors.has(selectedVideo.url) ? (
                        <div className="w-full h-full flex items-center justify-center bg-muted rounded-lg text-muted-foreground">
                          <div className="text-center p-4">
                            <VideoOff className="w-16 h-16 mx-auto mb-4" />
                            <p>Failed to load video</p>
                            <p className="text-xs mt-2">The video URL may have expired or have playback restrictions</p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <video
                            src={selectedVideo.url}
                            controls
                            className="w-full h-full object-contain rounded-lg"
                            onError={() => handleVideoError(selectedVideo.url)}
                            poster={selectedVideo.thumbnailUrl}
                          />
                          <div className="absolute top-2 right-2 flex gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                if (selectedVideo.url) {
                                  window.open(selectedVideo.url, "_blank", "noopener,noreferrer")
                                }
                              }}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground mt-2">
                      <div className="flex items-center gap-4">
                        <span>
                          {selectedVideo.width}x{selectedVideo.height}
                        </span>
                        <span>
                          {selectedVideo.duration}s
                        </span>
                        {selectedVideo.seed && (
                          <span>Seed: {selectedVideo.seed}</span>
                        )}
                        {selectedVideo.metadata?.provider && (
                          <Badge variant="outline">
                            {selectedVideo.metadata.provider}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                    <VideoIcon className="w-16 h-16 mb-4 opacity-20" />
                    <p className="text-center">
                      Enter a prompt and click Generate to create videos
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Generated Videos Gallery */}
            {generatedVideos.length > 0 && (
              <Card className="border-0 shadow-none bg-transparent">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium flex items-center gap-2">
                      <Layers className="w-4 h-4" />
                      Generated Videos ({generatedVideos.length})
                    </h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearVideos}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Clear
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {generatedVideos.map((video, index) => {
                      const hasError = videoErrors.has(video.url);
                      
                      return (
                        <div
                          key={index}
                          className={cn(
                            "relative aspect-video rounded-lg overflow-hidden cursor-pointer",
                            selectedVideo?.url === video.url
                              ? "ring-2 ring-purple-500"
                              : "hover:ring-2 ring-muted"
                          )}
                          onClick={() => setSelectedVideo(video)}
                        >
                          {hasError ? (
                            <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
                              <div className="text-center p-2">
                                <VideoOff className="w-8 h-8 mx-auto mb-2" />
                                <span className="text-xs">Failed to load</span>
                              </div>
                            </div>
                          ) : (
                            <>
                              <video
                                src={video.url}
                                className="w-full h-full object-cover"
                                onError={() => handleVideoError(video.url)}
                                poster={video.thumbnailUrl}
                                disablePictureInPicture
                                controlsList="nodownload"
                              />
                              <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors" />
                              <div className="absolute bottom-1 left-1 right-1 bg-black/50 text-white text-xs p-1 rounded">
                                <span>{video.duration}s</span>
                                <span className="ml-2">{video.width}x{video.height}</span>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* History */}
            {generationHistory.length > 0 && showAdvanced && (
              <Card className="border-0 shadow-none bg-transparent">
                <CardContent className="p-0">
                  <h4 className="font-medium flex items-center gap-2 mb-4">
                    <Sliders className="w-4 h-4" />
                    Recent Parameters
                  </h4>
                  <div className="space-y-2 max-h-[200px] overflow-auto">
                    {generationHistory.map((history, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm"
                      >
                        <span className="truncate flex-1">
                          {history.prompt.substring(0, 50)}
                          {history.prompt.length > 50 ? "..." : ""}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reuseParameters(history)}
                        >
                          Use
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}