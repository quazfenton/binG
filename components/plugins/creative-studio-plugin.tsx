"use client";

import React, { useEffect, useState, useRef } from 'react';
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
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(10);
  const [memeTopText, setMemeTopText] = useState('');
  const [memeBottomText, setMemeBottomText] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const memeCanvasRef = useRef<HTMLCanvasElement>(null);
  const ffmpegRef = useRef<any>(null);
  const fetchFileRef = useRef<((input: File | Blob) => Promise<Uint8Array>) | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadFfmpeg = async () => {
      try {
        // Dynamic import avoids hard compile dependency until package is installed.
        const importAny = (m: string) => new Function('moduleName', 'return import(moduleName)')(m) as Promise<any>;
        const ffmpegMod = await importAny('@ffmpeg/ffmpeg');
        const utilMod = await importAny('@ffmpeg/util');
        const instance = new ffmpegMod.FFmpeg();
        await instance.load({
          coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
          wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
        });
        if (!mounted) return;
        ffmpegRef.current = instance;
        fetchFileRef.current = utilMod.fetchFile;
        setFfmpegReady(true);
      } catch (error) {
        console.warn('FFmpeg load failed:', error);
      }
    };

    loadFfmpeg();
    return () => {
      mounted = false;
    };
  }, []);

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
    if (!videoFile) {
      toast.error('Upload a video first');
      return;
    }
    if (!ffmpegRef.current || !fetchFileRef.current) {
      toast.error('FFmpeg not ready. Install @ffmpeg/ffmpeg and @ffmpeg/util.');
      return;
    }
    if (endTime <= startTime) {
      toast.error('End time must be greater than start time');
      return;
    }

    setProcessing(true);
    try {
      const ffmpeg = ffmpegRef.current;
      const fetchFile = fetchFileRef.current;
      const inputName = `input-${Date.now()}.mp4`;
      const outputName = `output-${Date.now()}.mp4`;

      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));
      await ffmpeg.exec([
        '-i', inputName,
        '-ss', String(startTime),
        '-to', String(endTime),
        '-c', 'copy',
        outputName,
      ]);

      const outputData = await ffmpeg.readFile(outputName);
      const outputBlob = new Blob([outputData], { type: 'video/mp4' });
      const outputUrl = URL.createObjectURL(outputBlob);
      setVideoPreview(outputUrl);
      toast.success('Video trimmed successfully');

      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch (err) {
      console.error('Video trim error:', err);
      toast.error('Processing failed');
    } finally {
      setProcessing(false);
    }
  };

  const generateMeme = () => {
    if (!imagePreview) {
      toast.error('Upload an image first');
      return;
    }
    const canvas = memeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const fontSize = Math.max(canvas.width / 12, 24);
      ctx.font = `bold ${fontSize}px Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'white';
      ctx.strokeStyle = 'black';
      ctx.lineWidth = fontSize / 12;

      if (memeTopText) {
        ctx.strokeText(memeTopText.toUpperCase(), canvas.width / 2, fontSize + 10);
        ctx.fillText(memeTopText.toUpperCase(), canvas.width / 2, fontSize + 10);
      }
      if (memeBottomText) {
        ctx.strokeText(memeBottomText.toUpperCase(), canvas.width / 2, canvas.height - 20);
        ctx.fillText(memeBottomText.toUpperCase(), canvas.width / 2, canvas.height - 20);
      }
      toast.success('Meme generated');
    };
    img.src = imagePreview;
  };

  const downloadMeme = () => {
    const canvas = memeCanvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'meme.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Meme downloaded');
    });
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
              <Button variant="outline" className="w-full" onClick={() => document.getElementById('image-upload')?.click()}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Image
              </Button>
              <input id="image-upload" type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />

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
            <Button variant="outline" className="w-full" onClick={() => document.getElementById('video-upload')?.click()}>
              <Upload className="w-4 h-4 mr-2" />
              Upload Video
            </Button>
            <input id="video-upload" type="file" accept="video/*" onChange={handleVideoUpload} className="hidden" />

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
                    <Input type="number" value={startTime} min={0} onChange={(e) => setStartTime(Number(e.target.value || 0))} />
                  </div>
                  <div>
                    <label className="text-sm mb-2 block">End Time (s)</label>
                    <Input type="number" value={endTime} min={0} onChange={(e) => setEndTime(Number(e.target.value || 0))} />
                  </div>
                </div>

                <Button onClick={trimVideo} disabled={processing} className="w-full">
                  {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Scissors className="w-4 h-4 mr-2" />}
                  Trim Video
                </Button>
                {!ffmpegReady && (
                  <p className="text-xs text-yellow-300">
                    Loading FFmpeg engine. If this stays unavailable, install `@ffmpeg/ffmpeg` and `@ffmpeg/util`.
                  </p>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="meme" className="space-y-3 pt-4">
            {!imagePreview ? (
              <Card className="bg-white/5">
                <CardContent className="p-4 text-center text-gray-400">
                  <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Upload an image first in the Image tab</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <Input
                  placeholder="Top text"
                  value={memeTopText}
                  onChange={(e) => setMemeTopText(e.target.value)}
                />
                <Input
                  placeholder="Bottom text"
                  value={memeBottomText}
                  onChange={(e) => setMemeBottomText(e.target.value)}
                />
                <Button onClick={generateMeme} className="w-full">
                  <Type className="w-4 h-4 mr-2" />
                  Generate Meme
                </Button>
                <canvas ref={memeCanvasRef} className="w-full rounded" />
                <Button onClick={downloadMeme} variant="outline" className="w-full">
                  <Download className="w-4 h-4 mr-2" />
                  Download Meme
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
}
