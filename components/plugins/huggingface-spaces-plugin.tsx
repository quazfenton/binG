import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ImageIcon, Download, Sparkles, X } from 'lucide-react';

const HuggingFaceSpacesPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('realistic');
  const [dimensions, setDimensions] = useState('512x512');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  
  const models = [
    { id: 'stabilityai/stable-diffusion', name: 'Stable Diffusion' },
    { id: 'runwayml/stable-diffusion-v1-5', name: 'Runway ML SD v1.5' },
    { id: 'CompVis/stable-diffusion-v1-4', name: 'CompVis SD v1.4' },
    { id: 'hakurei/waifu-diffusion', name: 'Waifu Diffusion' },
    { id: 'prompthero/openjourney', name: 'Open Journey' }
  ];
  
  const styles = ['realistic', 'artistic', 'cartoon', 'anime', 'painting', '3d-render'];
  const dimensionOptions = ['512x512', '768x768', '1024x1024', '512x768', '768x512'];
  
  const generateImage = () => {
    setIsGenerating(true);
    // Simulate API call
    setTimeout(() => {
      const newImage = `/placeholder.svg?text=${encodeURIComponent(prompt.substring(0, 20))}&width=${dimensions.split('x')[0]}&height=${dimensions.split('x')[1]}`;
      setGeneratedImages([...generatedImages, newImage]);
      setIsGenerating(false);
    }, 2000);
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
            <Select>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map(model => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
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
                  <Button variant="secondary" size="icon">
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