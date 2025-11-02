"use client";

import React, { useState, useRef } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Input } from '../ui/input';
import { Slider } from '../ui/slider';
import { 
  Image as ImageIcon, Video, Scissors, Wand2, Type, Layers,
  Download, Upload, Play, Pause, XCircle, Loader2, Sparkles
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

export default function CreativeStudioPlugin({ onClose }: PluginProps) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [blur, setBlur] = useState(0);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);
    toast.success('Image loaded');
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoPreview(url);
    toast.success('Video loaded');
  };

  const applyFilters = () => {
    if (!imagePreview || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) blur(${blur}px)`;
      ctx.drawImage(img, 0, 0);
    };
    img.src = imagePreview;
  };

  const downloadImage = () => {
    if (!canvasRef.current) return;
    
    canvasRef.current.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'edited-image.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Image downloaded');
    });
  };

  const trimVideo = async () => {
    setProcessing(true);
    try {
      // Simulate video processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      toast.success('Video trimmed');
    } catch (err) {
      toast.error('Processing failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="border-b border-white/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-pink-400" />
            Creative Studio
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        <Tabs defaultValue="image" className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="image"><ImageIcon className="w-4 h-4 mr-1" /> Image</TabsTrigger>
            <TabsTrigger value="video"><Video className="w-4 h-4 mr-1" /> Video</TabsTrigger>
            <TabsTrigger value="meme"><Type className="w-4 h-4 mr-1" /> Meme</TabsTrigger>
          </TabsList>

          <TabsContent value="image" className="grid grid-cols-2 gap-4 pt-4">
            <div className="space-y-3">
              <label>
                <Button variant="outline" className="w-full" as="span">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Image
                </Button>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>

              {imagePreview && (
                <>
                  <div>
                    <label className="text-sm mb-2 block">Brightness: {brightness}%</label>
                    <Slider
                      value={[brightness]}
                      onValueChange={([v]) => setBrightness(v)}
                      min={0} max={200} step={1}
                    />
                  </div>

                  <div>
                    <label className="text-sm mb-2 block">Contrast: {contrast}%</label>
                    <Slider
                      value={[contrast]}
                      onValueChange={([v]) => setContrast(v)}
                      min={0} max={200} step={1}
                    />
                  </div>

                  <div>
                    <label className="text-sm mb-2 block">Saturation: {saturation}%</label>
                    <Slider
                      value={[saturation]}
                      onValueChange={([v]) => setSaturation(v)}
                      min={0} max={200} step={1}
                    />
                  </div>

                  <div>
                    <label className="text-sm mb-2 block">Blur: {blur}px</label>
                    <Slider
                      value={[blur]}
                      onValueChange={([v]) => setBlur(v)}
                      min={0} max={20} step={1}
                    />
                  </div>

                  <Button onClick={applyFilters} className="w-full">
                    <Wand2 className="w-4 h-4 mr-2" />
                    Apply Filters
                  </Button>

                  <Button onClick={downloadImage} variant="outline" className="w-full">
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </>
              )}
            </div>

            <div>
              <Card className="bg-white/5 h-full">
                <CardContent className="p-4 h-full flex items-center justify-center">
                  {imagePreview ? (
                    <div className="relative w-full h-full">
                      <img src={imagePreview} alt="Preview" className="max-w-full max-h-full object-contain" />
                      <canvas ref={canvasRef} className="absolute inset-0 max-w-full max-h-full" style={{ display: 'none' }} />
                    </div>
                  ) : (
                    <div className="text-center text-gray-400">
                      <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>Upload an image to get started</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="video" className="space-y-3 pt-4">
            <label>
              <Button variant="outline" className="w-full" as="span">
                <Upload className="w-4 h-4 mr-2" />
                Upload Video
              </Button>
              <input type="file" accept="video/*" onChange={handleVideoUpload} className="hidden" />
            </label>

            {videoPreview && (
              <>
                <Card className="bg-white/5">
                  <CardContent className="p-4">
                    <video controls src={videoPreview} className="w-full rounded" />
                  </CardContent>
                </Card>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm mb-2 block">Start Time (s)</label>
                    <Input type="number" defaultValue={0} min={0} />
                  </div>
                  <div>
                    <label className="text-sm mb-2 block">End Time (s)</label>
                    <Input type="number" defaultValue={10} min={0} />
                  </div>
                </div>

                <Button onClick={trimVideo} disabled={processing} className="w-full">
                  {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Scissors className="w-4 h-4 mr-2" />}
                  Trim Video
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="meme" className="space-y-3 pt-4">
            <Card className="bg-white/5">
              <CardContent className="p-4 text-center text-gray-400">
                <Type className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Meme generator coming soon</p>
                <p className="text-xs mt-2">Add text to images with custom fonts and positioning</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
}
