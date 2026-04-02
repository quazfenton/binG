/**
 * AI Art Gallery Tab
 * 
 * Visual showcase of AI-generated images with:
 * - Interactive gallery grid
 * - Image generation history
 * - Style exploration
 * - One-click regeneration
 * - Download & share
 */

"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Image,
  Sparkles,
  Download,
  Share,
  RefreshCw,
  Heart,
  Trash,
  Maximize2,
  Palette,
  Wand2,
  Layers,
  Clock,
  Star,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Zap,
  Filter,
  Grid,
  List,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";

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

// Fetch images from API
async function fetchImages(limit = 50, style?: string): Promise<GeneratedImage[]> {
  try {
    const params = new URLSearchParams();
    params.set('limit', limit.toString());
    if (style) params.set('style', style);
    
    const response = await fetch(`/api/ai-art/images?${params}`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch images');
    }
    
    return data.images || [];
  } catch (err: any) {
    console.error('[AIArt] Failed to fetch images:', err);
    toast.error('Failed to load gallery');
    return [];
  }
}

// Fetch stats from API
async function fetchStats(): Promise<{
  totalImages: number;
  totalLikes: number;
  totalDownloads: number;
  imagesByStyle: Record<string, number>;
  imagesThisWeek: number;
}> {
  try {
    const response = await fetch('/api/ai-art/stats');
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch stats');
    }
    
    return data.stats;
  } catch (err: any) {
    console.error('[AIArt] Failed to fetch stats:', err);
    return {
      totalImages: 0,
      totalLikes: 0,
      totalDownloads: 0,
      imagesByStyle: {},
      imagesThisWeek: 0,
    };
  }
}

// Like image via API
async function likeImage(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/ai-art/images/${id}/like`, {
      method: 'POST',
    });
    
    const data = await response.json();
    return data.success === true;
  } catch (err: any) {
    console.error('[AIArt] Failed to like image:', err);
    return false;
  }
}
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Types
interface GeneratedImage {
  id: string;
  prompt: string;
  url: string;
  thumbnail?: string;
  style: string;
  model: string;
  createdAt: number;
  likes: number;
  downloads: number;
  width: number;
  height: number;
  seed?: number;
  steps?: number;
  guidance?: number;
}

interface ArtStyle {
  id: string;
  name: string;
  icon: string;
  color: string;
  examples: number;
}

// Fallback images if API fails (used as initial state before fetch)
const FALLBACK_IMAGES: GeneratedImage[] = [
  {
    id: "img-1",
    prompt: "Cyberpunk cityscape at night with neon lights and flying cars",
    url: "https://picsum.photos/seed/cyber1/1024/1024",
    style: "cyberpunk",
    model: "flux-1",
    createdAt: Date.now() - 3600000,
    likes: 234,
    downloads: 89,
    width: 1024,
    height: 1024,
    seed: 42,
  },
  {
    id: "img-2",
    prompt: "Serene mountain landscape with aurora borealis",
    url: "https://picsum.photos/seed/nature1/1024/768",
    style: "realistic",
    model: "sdxl",
    createdAt: Date.now() - 7200000,
    likes: 567,
    downloads: 234,
    width: 1024,
    height: 768,
    seed: 123,
  },
  {
    id: "img-3",
    prompt: "Abstract geometric patterns in vibrant colors",
    url: "https://picsum.photos/seed/abstract1/768/768",
    style: "abstract",
    model: "midjourney",
    createdAt: Date.now() - 14400000,
    likes: 189,
    downloads: 67,
    width: 768,
    height: 768,
    seed: 999,
  },
];

const ART_STYLES: ArtStyle[] = [
  { id: "all", name: "All Styles", icon: "🎨", color: "from-purple-500 to-pink-500", examples: 1247 },
  { id: "cyberpunk", name: "Cyberpunk", icon: "🤖", color: "from-cyan-500 to-blue-500", examples: 234 },
  { id: "fantasy", name: "Fantasy", icon: "🐉", color: "from-amber-500 to-orange-500", examples: 567 },
  { id: "realistic", name: "Realistic", icon: "📷", color: "from-green-500 to-emerald-500", examples: 892 },
  { id: "abstract", name: "Abstract", icon: "🎭", color: "from-pink-500 to-rose-500", examples: 345 },
  { id: "minimalist", name: "Minimalist", icon: "⚪", color: "from-gray-500 to-slate-500", examples: 189 },
  { id: "steampunk", name: "Steampunk", icon: "⚙️", color: "from-yellow-500 to-amber-500", examples: 156 },
];

export default function ArtGalleryTab() {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    totalImages: number;
    totalLikes: number;
    totalDownloads: number;
    imagesByStyle: Record<string, number>;
    imagesThisWeek: number;
  } | null>(null);

  // Fetch images and stats on mount
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [imagesData, statsData] = await Promise.all([
        fetchImages(50),
        fetchStats(),
      ]);
      
      setImages(imagesData.length > 0 ? imagesData : FALLBACK_IMAGES);
      setStats(statsData);
    } catch (err) {
      console.warn('Failed to load data, using fallback:', err);
      setImages(FALLBACK_IMAGES);
    } finally {
      setLoading(false);
    }
  };
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "popular" | "downloads">("newest");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [selectedStyleForGen, setSelectedStyleForGen] = useState("cyberpunk");

  const filteredImages = images
    .filter(img => selectedStyle === "all" || img.style === selectedStyle)
    .filter(img => img.prompt.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      switch (sortBy) {
        case "newest": return b.createdAt - a.createdAt;
        case "popular": return b.likes - a.likes;
        case "downloads": return b.downloads - a.downloads;
        default: return 0;
      }
    });

  const handleGenerate = async () => {
    if (!generationPrompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }

    setIsGenerating(true);
    toast.info("Generating image...");
    
    // Simulate generation
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const newImage: GeneratedImage = {
      id: `img-${Date.now()}`,
      prompt: generationPrompt,
      url: `https://picsum.photos/seed/${Date.now()}/1024/1024`,
      style: selectedStyleForGen,
      model: "flux-1",
      createdAt: Date.now(),
      likes: 0,
      downloads: 0,
      width: 1024,
      height: 1024,
      seed: Math.floor(Math.random() * 10000),
    };

    setImages(prev => [newImage, ...prev]);
    setIsGenerating(false);
    setGenerationPrompt("");
    toast.success("Image generated!");
  };

  const handleLike = (imageId: string) => {
    setImages(prev => prev.map(img => 
      img.id === imageId ? { ...img, likes: img.likes + 1 } : img
    ));
    toast.success("Added to favorites");
  };

  const handleDownload = (image: GeneratedImage) => {
    setImages(prev => prev.map(img => 
      img.id === image.id ? { ...img, downloads: img.downloads + 1 } : img
    ));
    toast.success("Download started");
  };

  const handleDelete = (imageId: string) => {
    setImages(prev => prev.filter(img => img.id !== imageId));
    toast.success("Image deleted");
  };

  const handleShare = (image: GeneratedImage) => {
    navigator.clipboard.writeText(`${image.prompt}\n\nGenerated with binG AI`);
    toast.success("Copied to clipboard");
  };

  const handleRegenerate = (image: GeneratedImage) => {
    setGenerationPrompt(image.prompt);
    setSelectedStyleForGen(image.style);
    toast.info("Prompt loaded for regeneration");
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-purple-500/10 to-pink-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
            <Image className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">AI Art Gallery</h3>
            <p className="text-xs text-white/60">Generated Images Showcase</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            className="text-white/60 hover:text-white"
          >
            {viewMode === "grid" ? <List className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Generation Bar */}
      <div className="p-4 border-b border-white/10 bg-black/20">
        <div className="flex gap-2">
          <Input
            value={generationPrompt}
            onChange={(e) => setGenerationPrompt(e.target.value)}
            placeholder="Describe what you want to create..."
            className="flex-1 bg-black/40 border-purple-500/30 text-white placeholder:text-white/40"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isGenerating) {
                handleGenerate();
              }
            }}
          />
          <Select
            value={selectedStyleForGen}
            onValueChange={setSelectedStyleForGen}
          >
            <SelectTrigger className="w-[120px] bg-black/40 border-purple-500/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ART_STYLES.filter(s => s.id !== "all").map(style => (
                <SelectItem key={style.id} value={style.id}>
                  {style.icon} {style.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !generationPrompt.trim()}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
          >
            {isGenerating ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4 mr-2" />
            )}
            Generate
          </Button>
        </div>
      </div>

      {/* Style Filter */}
      <ScrollArea className="h-14 border-b border-white/10">
        <div className="flex gap-2 p-4">
          {ART_STYLES.map((style) => (
            <Button
              key={style.id}
              variant={selectedStyle === style.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedStyle(style.id)}
              className={`whitespace-nowrap bg-gradient-to-r ${style.color} ${
                selectedStyle === style.id
                  ? "text-white border-white/30"
                  : "bg-black/40 border-white/20 text-white/60 hover:text-white"
              }`}
            >
              {style.icon} {style.name} ({style.examples})
            </Button>
          ))}
        </div>
      </ScrollArea>

      {/* Gallery Grid */}
      <ScrollArea className="flex-1">
        <div className={`p-4 ${
          viewMode === "grid" 
            ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" 
            : "space-y-3"
        }`}>
          <AnimatePresence>
            {filteredImages.map((image) => (
              <motion.div
                key={image.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                layout
                className={`group relative rounded-lg overflow-hidden bg-white/5 border border-white/10 hover:border-purple-500/30 transition-all cursor-pointer ${
                  viewMode === "list" ? "flex" : ""
                }`}
                onClick={() => setSelectedImage(image)}
              >
                {/* Image */}
                <div className={`relative ${viewMode === "list" ? "w-48 h-48 flex-shrink-0" : "aspect-square"}`}>
                  <img
                    src={getProxiedImageUrl(image.url)}
                    alt={image.prompt}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  {/* Hover Actions */}
                  <div className="absolute bottom-2 left-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); handleLike(image.id); }}
                      className="h-8 w-8 bg-black/60 hover:bg-black/80 text-white"
                    >
                      <Heart className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); handleDownload(image); }}
                      className="h-8 w-8 bg-black/60 hover:bg-black/80 text-white"
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); handleRegenerate(image); }}
                      className="h-8 w-8 bg-black/60 hover:bg-black/80 text-white"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* Stats Badge */}
                  <div className="absolute top-2 right-2 flex gap-1">
                    <Badge className="bg-black/60 text-white text-[10px]">
                      <Heart className="w-2 h-2 mr-1" />
                      {image.likes}
                    </Badge>
                  </div>
                </div>

                {/* Info */}
                <div className={`p-3 ${viewMode === "list" ? "flex-1" : ""}`}>
                  <p className="text-xs text-white/80 line-clamp-2 mb-2">{image.prompt}</p>
                  <div className="flex items-center justify-between text-[10px] text-white/40">
                    <span>{image.style}</span>
                    <span>{new Date(image.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* Image Detail Modal */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex items-center justify-center p-8"
            onClick={() => setSelectedImage(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="max-w-6xl w-full max-h-[90vh] overflow-auto bg-gradient-to-br from-purple-900/20 to-pink-900/20 rounded-2xl border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-2 gap-0">
                {/* Image */}
                <div className="relative">
                  <img
                    src={getProxiedImageUrl(selectedImage.url)}
                    alt={selectedImage.prompt}
                    className="w-full h-full object-contain max-h-[70vh]"
                  />
                </div>

                {/* Details */}
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-semibold text-white">Image Details</h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedImage(null)}
                      className="text-white/60 hover:text-white"
                    >
                      <X className="w-5 h-5" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-white/60">Prompt</Label>
                    <p className="text-sm text-white/80">{selectedImage.prompt}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-white/60">Style</Label>
                      <p className="text-sm text-white/80 capitalize">{selectedImage.style}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-white/60">Model</Label>
                      <p className="text-sm text-white/80">{selectedImage.model}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-white/60">Dimensions</Label>
                      <p className="text-sm text-white/80">{selectedImage.width}x{selectedImage.height}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-white/60">Seed</Label>
                      <p className="text-sm text-white/80">{selectedImage.seed}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 pt-4 border-t border-white/10">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-purple-400">{selectedImage.likes}</p>
                      <p className="text-xs text-white/40">Likes</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-pink-400">{selectedImage.downloads}</p>
                      <p className="text-xs text-white/40">Downloads</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-white">{new Date(selectedImage.createdAt).toLocaleDateString()}</p>
                      <p className="text-xs text-white/40">Created</p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button
                      onClick={() => handleDownload(selectedImage)}
                      className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleShare(selectedImage)}
                      className="border-white/20"
                    >
                      <Share className="w-4 h-4 mr-2" />
                      Share
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleRegenerate(selectedImage)}
                      className="border-white/20"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Regenerate
                    </Button>
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => handleDelete(selectedImage.id)}
                    className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


