"use client";

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
import {
  ImageIcon,
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
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Image Generation Tab Component
 * ComfyUI-inspired interface for AI image generation
 */
export interface ImageGenerationTabProps {
  /** Callback when image is generated */
  onImageGenerated?: (imageUrl: string) => void;
}

interface GeneratedImage {
  url: string;
  width: number;
  height: number;
  seed?: number;
  metadata?: Record<string, any>;
}

interface GenerationParams {
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  width: number;
  height: number;
  steps: number;
  guidance: number;
  seed: number | "random";
  numImages: number;
  quality: "low" | "medium" | "high" | "ultra";
  style: string;
  sampler: string;
  model: string;
  provider: string;
}

const ASPECT_RATIOS = [
  { value: "1:1", label: "Square (1:1)", width: 1024, height: 1024 },
  { value: "16:9", label: "Landscape (16:9)", width: 1280, height: 720 },
  { value: "9:16", label: "Portrait (9:16)", width: 720, height: 1280 },
  { value: "4:3", label: "Standard (4:3)", width: 1152, height: 864 },
  { value: "3:2", label: "Photo (3:2)", width: 1152, height: 768 },
  { value: "2:3", label: "Portrait (2:3)", width: 768, height: 1152 },
  { value: "21:9", label: "Ultrawide (21:9)", width: 1344, height: 576 },
];

const STYLES = [
  "None",
  "Photorealistic",
  "Anime",
  "Digital Art",
  "Oil Painting",
  "Watercolor",
  "Sketch",
  "3D Render",
  "Pixel Art",
  "Concept Art",
  "Fantasy",
  "Sci-Fi",
  "Cinematic",
  "Minimalist",
  "Abstract",
  "Surreal",
];

const SAMPLERS = [
  "Euler",
  "Euler a",
  "DPM++ 2M Karras",
  "DPM++ SDE Karras",
  "DDIM",
  "PLMS",
  "UniPC",
  "Heun",
];

const MODELS = [
  { value: "default", label: "Auto (Best Available)", provider: "any" },
  { value: "stability-ai/stable-diffusion-xl-base-1.0", label: "SDXL 1.0", provider: "replicate" },
  { value: "black-forest-labs/flux-schnell", label: "Flux Schnell", provider: "replicate" },
  { value: "stability-ai/stable-diffusion-3.5-large", label: "SD 3.5 Large", provider: "replicate" },
  { value: "mistral-medium-2505", label: "Mistral (FLUX Ultra)", provider: "mistral" },
];

const PROVIDERS = [
  { value: "auto", label: "Auto (with Fallback)" },
  { value: "mistral", label: "Mistral AI" },
  { value: "replicate", label: "Replicate" },
];

const QUALITY_PRESETS: Record<string, { steps: number; guidance: number; label: string }> = {
  low: { steps: 20, guidance: 5, label: "Fast" },
  medium: { steps: 28, guidance: 5.5, label: "Balanced" },
  high: { steps: 40, guidance: 6, label: "High Quality" },
  ultra: { steps: 60, guidance: 7, label: "Ultra Quality" },
};

export default function ImageGenerationTab({ onImageGenerated }: ImageGenerationTabProps) {
  const [params, setParams] = useState<GenerationParams>({
    prompt: "",
    negativePrompt: "",
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    steps: 28,
    guidance: 5.5,
    seed: "random",
    numImages: 1,
    quality: "high",
    style: "None",
    sampler: "Euler",
    model: "default",
    provider: "auto",
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generationHistory, setGenerationHistory] = useState<GenerationParams[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Ref to store the generate function to avoid initialization order issues
  const generateFnRef = useRef<(() => Promise<void>) | null>(null);

  // Update dimensions when aspect ratio changes
  const handleAspectRatioChange = useCallback((value: string) => {
    const ratio = ASPECT_RATIOS.find((r) => r.value === value);
    if (ratio) {
      setParams((prev) => ({
        ...prev,
        aspectRatio: value,
        width: ratio.width,
        height: ratio.height,
      }));
    }
  }, []);

  // Generate image - stored in ref to avoid initialization order issues
  const handleGenerate = useCallback(async () => {
    if (!params.prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }

    setIsGenerating(true);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          width: params.width,
          height: params.height,
          steps: params.steps,
          guidance: params.guidance,
          seed: params.seed,
          numImages: params.numImages,
          aspectRatio: params.aspectRatio,
          quality: params.quality,
          style: params.style,
          sampler: params.sampler,
          model: params.model === "default" ? undefined : params.model,
          provider: params.provider === "auto" ? undefined : params.provider,
        }),
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();

      console.log('[ImageGenerationTab] API Response:', data);

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate image");
      }

      // Handle different response structures
      const images = data?.data?.images || data?.images || [];
      
      console.log('[ImageGenerationTab] Extracted images:', images);

      if (images && images.length > 0) {
        setGeneratedImages((prev) => [...images, ...prev]);
        setSelectedImage(images[0]);

        // Save to history
        setGenerationHistory((prev) => [params, ...prev.slice(0, 9)]);

        toast.success(
          `Generated ${images.length} image${images.length > 1 ? "s" : ""} using ${data?.data?.provider || data?.provider || 'unknown'}`
        );

        onImageGenerated?.(images[0].url);
      } else {
        console.error('[ImageGenerationTab] No images in response:', data);
        throw new Error("No images were generated");
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        toast.info("Generation cancelled");
      } else {
        console.error("Generation error:", error);
        toast.error(error.message || "Failed to generate image");
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [params, onImageGenerated]);

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

  // Update steps/guidance when quality changes
  const handleQualityChange = useCallback((value: "low" | "medium" | "high" | "ultra") => {
    const preset = QUALITY_PRESETS[value];
    if (preset) {
      setParams((prev) => ({
        ...prev,
        quality: value,
        steps: preset.steps,
        guidance: preset.guidance,
      }));
    }
  }, []);

  // Handle keyboard shortcuts - uses ref to avoid initialization order issues
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

  // Generate random seed
  const randomizeSeed = useCallback(() => {
    setParams((prev) => ({
      ...prev,
      seed: Math.floor(Math.random() * 2147483647),
    }));
  }, []);

  // Download image
  const downloadImage = useCallback(async (imageUrl: string, index: number) => {
    try {
      let blob: Blob;

      // ✅ FIX 5: Handle both base64 data URLs and remote URLs properly
      if (imageUrl.startsWith('data:')) {
        // Handle base64 data URL - convert to blob
        const response = await fetch(imageUrl);
        blob = await response.blob();
      } else {
        // Handle remote URL - fetch with CORS handling
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
        blob = await response.blob();
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `generated-image-${index + 1}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success("Image downloaded");
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Failed to download image. Try right-clicking and saving manually.");
    }
  }, []);

  // Copy image prompt
  const copyPrompt = useCallback(() => {
    navigator.clipboard.writeText(params.prompt);
    toast.success("Prompt copied to clipboard");
  }, [params.prompt]);

  // Reuse image parameters
  const reuseParameters = useCallback((historyItem: GenerationParams) => {
    setParams(historyItem);
    toast.success("Parameters loaded");
  }, []);

  // Clear all images
  const clearImages = useCallback(() => {
    setGeneratedImages([]);
    setSelectedImage(null);
    toast.info("Cleared all images");
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold">Image Generator</h3>
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
                  placeholder="Describe the image you want to generate..."
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
                    placeholder="What to avoid in the image..."
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
                      {ASPECT_RATIOS.map((ratio) => (
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
                          {preset.label} ({preset.steps} steps)
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
                      {STYLES.map((style) => (
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
                          {MODELS.map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Sampler</Label>
                      <Select
                        value={params.sampler}
                        onValueChange={(value) =>
                          setParams((prev) => ({ ...prev, sampler: value }))
                        }
                        disabled={isGenerating}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SAMPLERS.map((sampler) => (
                            <SelectItem key={sampler} value={sampler}>
                              {sampler}
                            </SelectItem>
                          ))}
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
                        Images per Batch: {params.numImages}
                      </Label>
                      <Slider
                        value={[params.numImages]}
                        onValueChange={([value]) =>
                          setParams((prev) => ({ ...prev, numImages: value }))
                        }
                        min={1}
                        max={4}
                        step={1}
                        disabled={isGenerating}
                      />
                    </div>
                  </>
                )}

                {/* Advanced Sliders */}
                {showAdvanced && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Steps: {params.steps}
                      </Label>
                      <Slider
                        value={[params.steps]}
                        onValueChange={([value]) =>
                          setParams((prev) => ({ ...prev, steps: value }))
                        }
                        min={10}
                        max={100}
                        step={1}
                        disabled={isGenerating}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Guidance: {params.guidance.toFixed(1)}
                      </Label>
                      <Slider
                        value={[params.guidance]}
                        onValueChange={([value]) =>
                          setParams((prev) => ({ ...prev, guidance: value }))
                        }
                        min={1}
                        max={20}
                        step={0.5}
                        disabled={isGenerating}
                      />
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
                  Generate
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
                {selectedImage ? (
                  <div className="space-y-4">
                    <div className="relative aspect-square max-h-[500px] mx-auto">
                      <img
                        src={selectedImage.url}
                        alt="Generated"
                        className="w-full h-full object-contain rounded-lg"
                      />
                      <div className="absolute top-2 right-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            downloadImage(selectedImage.url, 0)
                          }
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            window.open(selectedImage.url, "_blank")
                          }
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <div className="flex items-center gap-4">
                        <span>
                          {selectedImage.width}x{selectedImage.height}
                        </span>
                        {selectedImage.seed && (
                          <span>Seed: {selectedImage.seed}</span>
                        )}
                        {selectedImage.metadata?.provider && (
                          <Badge variant="outline">
                            {selectedImage.metadata.provider}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                    <ImageIcon className="w-16 h-16 mb-4 opacity-20" />
                    <p className="text-center">
                      Enter a prompt and click Generate to create images
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Generated Images Gallery */}
            {generatedImages.length > 0 && (
              <Card className="border-0 shadow-none bg-transparent">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium flex items-center gap-2">
                      <Layers className="w-4 h-4" />
                      Generated Images ({generatedImages.length})
                    </h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearImages}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Clear
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {generatedImages.map((image, index) => (
                      <div
                        key={index}
                        className={cn(
                          "relative aspect-square rounded-lg overflow-hidden cursor-pointer",
                          selectedImage?.url === image.url
                            ? "ring-2 ring-purple-500"
                            : "hover:ring-2 ring-muted"
                        )}
                        onClick={() => setSelectedImage(image)}
                      >
                        <img
                          src={image.url}
                          alt={`Generated ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors" />
                      </div>
                    ))}
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
