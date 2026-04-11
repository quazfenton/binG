"use client";

import React, { useState } from 'react';
import { secureRandomInt } from '@/lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ImageIcon, Download, Sparkles, X, Shuffle, ImagePlus, TerminalSquare, Globe2 } from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';
import useIframeLoader from '@/hooks/use-iframe-loader';
import { IframeUnavailableScreen } from '../ui/iframe-unavailable-screen';

const HuggingFaceSpacesPlugin: React.FC<PluginProps> = ({ onClose, onResult, initialData }) => {
  const [prompt, setPrompt] = useState(initialData?.prompt || '');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [style, setStyle] = useState('realistic');
  const [dimensions, setDimensions] = useState('768x768');
  const [steps, setSteps] = useState(28);
  const [guidance, setGuidance] = useState(4.5);
  const [seed, setSeed] = useState<number | ''>('');
  const [model, setModel] = useState('stability-ai/sdxl');
  const [initImageUrl, setInitImageUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [spaceUrl, setSpaceUrl] = useState('');
  const [hfToken, setHfToken] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [apiInput, setApiInput] = useState('');
  const [apiResponse, setApiResponse] = useState('');
  const [apiLoading, setApiLoading] = useState(false);
  
  const models = [
    { id: 'stability-ai/sdxl', name: 'Stable Diffusion XL' },
    { id: 'flux-schnell', name: 'FLUX Schnell' },
    { id: 'stable-diffusion-3.5', name: 'Stable Diffusion 3.5' },
  ];
  
  const styles = ['realistic', 'cinematic', 'artistic', 'cartoon', 'anime', 'painting', '3d-render', 'isometric', 'low-poly'];
  const dimensionOptions = ['512x512', '768x768', '1024x1024', '512x768', '768x512', '640x960', '960x640'];
  
  const spaceEmbedUrl = (() => {
    if (!spaceUrl.trim()) return '';
    const match = spaceUrl.match(/huggingface\.co\/spaces\/([^\/]+)\/([^\/\s?#]+)/);
    if (match) return `https://${match[1]}-${match[2]}.hf.space`;
    return spaceUrl.trim();
  })();

  // Use iframe loader hook with fallback for Spaces
  const {
    isLoading,
    isLoaded,
    isFailed,
    failureReason,
    errorMessage,
    retryCount,
    canRetry,
    isUsingFallback,
    fallbackUrl,
    handleLoad,
    handleRetry,
    handleReset,
    handleFallback,
  } = useIframeLoader({
    url: spaceEmbedUrl,
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 5000,
    enableAutoRetry: true,
    enableFallback: true,
    onLoaded: () => {},
    onFailed: () => {},
  });

  const runInference = async () => {
    setApiLoading(true);
    setApiResponse('');
    try {
      const res = await fetch(`https://api-inference.huggingface.co/models/${apiModel}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: apiInput }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `API error: ${res.statusText}`);
      }
      const data = await res.json();
      setApiResponse(JSON.stringify(data, null, 2));
    } catch (e: any) {
      toast.error(e?.message || 'Inference failed');
      setApiResponse(`Error: ${e?.message}`);
    } finally {
      setApiLoading(false);
    }
  };

  const generateImage = async () => {
    if (!prompt.trim()) {
      toast.error('Prompt is required');
      return;
    }
    try {
      setIsGenerating(true);
      const [w, h] = dimensions.split('x').map((v) => Number.parseInt(v, 10));
      const res = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${prompt}${style ? `, ${style}` : ''}`,
          negativePrompt,
          width: Number.isFinite(w) ? w : 768,
          height: Number.isFinite(h) ? h : 768,
          steps,
          guidance,
          seed: seed === '' ? undefined : Number(seed),
          model,
          initImageUrl: initImageUrl || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to generate image');
      }
      const data = await res.json();
      const images: string[] = data?.data?.images || [];
      setGeneratedImages((prev) => [...images, ...prev]);
      if (images.length) {
        onResult?.({
          content: `Generated ${images.length} image(s) for: "${prompt}"\nModel: ${model}\nStyle: ${style}`,
          images,
        });
      }
      toast.success('Image(s) generated');
    } catch (e: any) {
      toast.error(e?.message || 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };
  
  return (
    <div className="h-full flex flex-col">
      <CardHeader className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-yellow-400" />
            <CardTitle className="text-lg">Hugging Face Spaces</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-y-auto p-4">
        <Tabs defaultValue="image-gen" className="w-full">
          <TabsList>
            <TabsTrigger value="image-gen" className="flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Image Gen</TabsTrigger>
            <TabsTrigger value="spaces" className="flex items-center gap-2"><Globe2 className="w-4 h-4" /> Spaces</TabsTrigger>
            <TabsTrigger value="api" className="flex items-center gap-2"><TerminalSquare className="w-4 h-4" /> API</TabsTrigger>
          </TabsList>

          <TabsContent value="image-gen" className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Model</label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Prompt</label>
                <Textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Describe the image you want to generate"
                  className="min-h-[120px]"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Negative Prompt</label>
                <Input
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="Unwanted elements, e.g. low quality, blurry"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Style</label>
                  <Select value={style} onValueChange={setStyle}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select style" />
                    </SelectTrigger>
                    <SelectContent>
                      {styles.map(s => (
                        <SelectItem key={s} value={s}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-2 block">Dimensions</label>
                  <Select value={dimensions} onValueChange={setDimensions}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select dimensions" />
                    </SelectTrigger>
                    <SelectContent>
                      {dimensionOptions.map(d => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Steps</label>
                  <Input type="number" min={1} max={64} value={steps}
                    onChange={(e) => setSteps(Number.parseInt(e.target.value || '0', 10))} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Guidance</label>
                  <Input type="number" step="0.1" min={0} max={20} value={guidance}
                    onChange={(e) => setGuidance(parseFloat(e.target.value || '0'))} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Seed</label>
                  <div className="flex gap-2">
                    <Input type="number" placeholder="random" value={seed}
                      onChange={(e) => setSeed(e.target.value === '' ? '' : Number.parseInt(e.target.value, 10))} />
                    <Button type="button" variant="secondary" onClick={() => setSeed(secureRandomInt(0, 999999999))}>
                      <Shuffle className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Init Image URL (optional)</label>
                <div className="flex gap-2">
                  <Input value={initImageUrl} onChange={(e) => setInitImageUrl(e.target.value)} placeholder="https://..." />
                  <Button type="button" variant="secondary" onClick={() => setInitImageUrl('')}>
                    <ImagePlus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              <Button 
                onClick={generateImage} 
                disabled={!prompt || isGenerating}
                className="w-full"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {isGenerating ? 'Generating...' : 'Generate Image'}
              </Button>
            </div>
            
            <div>
              <h3 className="text-sm font-medium mb-3">Generated Images</h3>
              <div className="grid grid-cols-2 gap-3">
                {generatedImages.map((img, index) => {
                  // Use image proxy for external URLs to bypass CORS restrictions
                  const displayImgUrl = img.startsWith('http') 
                    ? `/api/image-proxy?url=${encodeURIComponent(img)}`
                    : img;
                   
                  return (
                    <div key={index} className="relative group">
                      <img
                        src={displayImgUrl}
                        alt={`Generated ${index + 1}`}
                        className="w-full h-40 object-cover rounded border border-white/10"
                        onError={(e) => {
                          // Fallback to direct URL if proxy fails
                          const target = e.target as HTMLImageElement;
                          if (target.src.includes('/api/image-proxy') && target.src !== img) {
                            target.src = img;
                          }
                        }}
                      />
                      <div className="absolute bottom-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="secondary" size="icon" onClick={async () => {
                          // Try to download via proxy first for CORS bypass
                          try {
                            const response = await fetch(`/api/image-proxy?url=${encodeURIComponent(img)}`);
                            if (response.ok) {
                              const blob = await response.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `image-${index + 1}.png`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              window.URL.revokeObjectURL(url);
                              return;
                            }
                          } catch (e) {
                            console.warn('Proxy download failed, using fallback');
                          }
                          // Fallback: direct download
                          const a = document.createElement('a');
                          a.href = img;
                          a.download = `image-${index + 1}.png`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }}>
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {generatedImages.length === 0 && (
                  <div className="col-span-2 h-40 flex items-center justify-center border border-dashed border-white/20 rounded text-white/50">
                    Images will appear here after generation
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="spaces" className="pt-4">
            <div className="space-y-3">
              <label className="text-sm font-medium">Hugging Face Space URL</label>
              <Input
                placeholder="https://huggingface.co/spaces/owner/space-name"
                value={spaceUrl}
                onChange={(e) => setSpaceUrl(e.target.value)}
              />
              <div className="rounded border border-white/10 overflow-hidden h-[420px]">
                {isFailed ? (
                  <div className="w-full h-full">
                    <IframeUnavailableScreen
                      url={spaceEmbedUrl}
                      reason={failureReason || 'failed'}
                      errorMessage={errorMessage || undefined}
                      onRetry={handleRetry}onOpenExternal={() => window.open(spaceUrl, '_blank', 'noopener,noreferrer')}
                      onClose={onClose}
                      autoRetryCount={retryCount}
                      maxRetries={3}
                    />
                  </div>
                ) : spaceEmbedUrl ? (
                  <iframe className="w-full h-full" src={isUsingFallback && fallbackUrl ? fallbackUrl : spaceEmbedUrl} allow="clipboard-read; clipboard-write; microphone; camera; autoplay; encrypted-media" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/50">
                    Enter a Space URL above to load it
                  </div>
                )}
              </div>
              <p className="text-xs text-white/60">Tip: many Spaces support query parameters. We can enhance this to pass input programmatically based on Space configuration.</p>
            </div>
          </TabsContent>

          <TabsContent value="api" className="pt-4">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">HF API Token</label>
                <Input
                  type="password"
                  value={hfToken}
                  onChange={(e) => setHfToken(e.target.value)}
                  placeholder="hf_..."
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Model ID</label>
                <Input
                  value={apiModel}
                  onChange={(e) => setApiModel(e.target.value)}
                  placeholder="e.g. gpt2, facebook/bart-large-cnn"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Input Text</label>
                <Textarea
                  value={apiInput}
                  onChange={(e) => setApiInput(e.target.value)}
                  placeholder="Enter text to send to the model..."
                  rows={4}
                />
              </div>
              <Button
                onClick={runInference}
                disabled={!hfToken || !apiModel || !apiInput || apiLoading}
                className="w-full"
              >
                <TerminalSquare className="w-4 h-4 mr-2" />
                {apiLoading ? 'Running...' : 'Run Inference'}
              </Button>
              {apiResponse && (
                <div className="bg-black/20 rounded border border-white/10 p-3 max-h-60 overflow-y-auto">
                  <pre className="text-xs whitespace-pre-wrap">{apiResponse}</pre>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
};

export default HuggingFaceSpacesPlugin;
