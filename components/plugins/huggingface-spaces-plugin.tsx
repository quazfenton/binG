import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ImageIcon, Download, Sparkles, X, Shuffle, ImagePlus } from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

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
  
  const models = [
    { id: 'stability-ai/sdxl', name: 'Stable Diffusion XL' },
    { id: 'flux-schnell', name: 'FLUX Schnell' },
    { id: 'stable-diffusion-3.5', name: 'Stable Diffusion 3.5' },
  ];
  
  const styles = ['realistic', 'cinematic', 'artistic', 'cartoon', 'anime', 'painting', '3d-render', 'isometric', 'low-poly'];
  const dimensionOptions = ['512x512', '768x768', '1024x1024', '512x768', '768x512', '640x960', '960x640'];
  
  const generateImage = async () => {
    if (!prompt.trim()) {
      toast.error('Prompt is required');
      return;
    }
    try {
      setIsGenerating(true);
      const [w, h] = dimensions.split('x').map((v) => parseInt(v, 10));
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
            <CardTitle className="text-lg">Hugging Face ImageGen</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
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
                onChange={(e) => setSteps(parseInt(e.target.value || '0', 10))} />
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
                  onChange={(e) => setSeed(e.target.value === '' ? '' : parseInt(e.target.value, 10))} />
                <Button type="button" variant="secondary" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>
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
            {generatedImages.map((img, index) => (
              <div key={index} className="relative group">
                <img 
                  src={img} 
                  alt={`Generated ${index + 1}`} 
                  className="w-full h-40 object-cover rounded border border-white/10"
                />
                <div className="absolute bottom-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="secondary" size="icon" onClick={() => {
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
            ))}
            {generatedImages.length === 0 && (
              <div className="col-span-2 h-40 flex items-center justify-center border border-dashed border-white/20 rounded text-white/50">
                Images will appear here after generation
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </div>
  );
};

export default HuggingFaceSpacesPlugin;