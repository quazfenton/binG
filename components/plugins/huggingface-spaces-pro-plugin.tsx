"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Slider } from '../ui/slider';
import { 
  Sparkles, Search, Download, Upload, Play, Pause, Volume2,
  Image as ImageIcon, Music, Mic, Video, Brain, Languages,
  TrendingUp, Heart, Eye, ChevronRight, Loader2, XCircle,
  Shuffle, Wand2, Grid3x3, Layers, Zap, Settings
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface HFModel {
  id: string;
  modelId: string;
  author: string;
  downloads: number;
  likes: number;
  tags: string[];
  pipeline_tag: string;
  library_name?: string;
}

interface HFSpace {
  id: string;
  author: string;
  title: string;
  likes: number;
  sdk: string;
  tags: string[];
  emoji: string;
}

interface ImageGenParams {
  prompt: string;
  negativePrompt: string;
  model: string;
  width: number;
  height: number;
  steps: number;
  guidance: number;
  seed: number | string;
  sampler: string;
  numImages: number;
}

interface LLMParams {
  model: string;
  prompt: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
}

interface AudioParams {
  model: string;
  text?: string;
  audioFile?: File;
  speaker?: string;
  language?: string;
}

const IMAGE_MODELS = [
  { id: 'stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL 1.0' },
  { id: 'runwayml/stable-diffusion-v1-5', name: 'SD 1.5' },
  { id: 'stabilityai/stable-diffusion-2-1', name: 'SD 2.1' },
  { id: 'prompthero/openjourney', name: 'Openjourney' },
  { id: 'Lykon/DreamShaper', name: 'DreamShaper' }
];

const SAMPLERS = ['Euler', 'Euler a', 'DPM++ 2M Karras', 'DDIM', 'PLMS'];

const LLM_MODELS = [
  { id: 'meta-llama/Llama-2-70b-chat-hf', name: 'Llama 2 70B Chat' },
  { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', name: 'Mixtral 8x7B' },
  { id: 'google/flan-t5-xxl', name: 'Flan-T5 XXL' },
  { id: 'facebook/opt-66b', name: 'OPT 66B' }
];

const AUDIO_MODELS = [
  { id: 'suno/bark', name: 'Bark TTS', type: 'tts' },
  { id: 'openai/whisper-large-v3', name: 'Whisper Large', type: 'transcription' },
  { id: 'facebook/musicgen-large', name: 'MusicGen Large', type: 'music' },
  { id: 'speechbrain/sepformer-whamr', name: 'Voice Separator', type: 'separator' }
];

export default function HuggingFaceSpacesProPlugin({ onClose }: PluginProps) {
  // Image Gen State
  const [imageParams, setImageParams] = useState<ImageGenParams>({
    prompt: '',
    negativePrompt: 'low quality, blurry, distorted',
    model: IMAGE_MODELS[0].id,
    width: 1024,
    height: 1024,
    steps: 30,
    guidance: 7.5,
    seed: '',
    sampler: SAMPLERS[0],
    numImages: 1
  });
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

  // Model Hub State
  const [searchQuery, setSearchQuery] = useState('');
  const [modelFilter, setModelFilter] = useState('all');
  const [models, setModels] = useState<HFModel[]>([]);
  const [spaces, setSpaces] = useState<HFSpace[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // LLM State
  const [llmParams, setLLMParams] = useState<LLMParams>({
    model: LLM_MODELS[0].id,
    prompt: '',
    systemPrompt: 'You are a helpful AI assistant.',
    temperature: 0.7,
    maxTokens: 512,
    topP: 0.9,
    topK: 50
  });
  const [llmResponse, setLlmResponse] = useState('');
  const [llmGenerating, setLlmGenerating] = useState(false);

  // Audio State
  const [audioParams, setAudioParams] = useState<AudioParams>({
    model: AUDIO_MODELS[0].id,
    text: '',
    speaker: 'default',
    language: 'en'
  });
  const [audioResult, setAudioResult] = useState<string>('');
  const [audioGenerating, setAudioGenerating] = useState(false);

  // Workflow State
  const [workflow, setWorkflow] = useState<Array<{id: string, type: string, params: any}>>([]);

  const searchModels = async () => {
    setLoadingModels(true);
    try {
      const params = new URLSearchParams({
        search: searchQuery,
        limit: '20',
        ...(modelFilter !== 'all' && { filter: modelFilter })
      });
      
      const res = await fetch(`https://huggingface.co/api/models?${params}`);
      const data = await res.json();
      setModels(data);
      toast.success(`Found ${data.length} models`);
    } catch (err: any) {
      toast.error('Failed to search models');
    } finally {
      setLoadingModels(false);
    }
  };

  const searchSpaces = async () => {
    setLoadingModels(true);
    try {
      const params = new URLSearchParams({
        search: searchQuery,
        limit: '20'
      });
      
      const res = await fetch(`https://huggingface.co/api/spaces?${params}`);
      const data = await res.json();
      setSpaces(data);
      toast.success(`Found ${data.length} spaces`);
    } catch (err: any) {
      toast.error('Failed to search spaces');
    } finally {
      setLoadingModels(false);
    }
  };

  const generateImage = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imageParams.prompt,
          negative_prompt: imageParams.negativePrompt,
          model: imageParams.model,
          width: imageParams.width,
          height: imageParams.height,
          num_inference_steps: imageParams.steps,
          guidance_scale: imageParams.guidance,
          seed: imageParams.seed === '' ? -1 : parseInt(imageParams.seed as string),
          sampler: imageParams.sampler,
          num_images: imageParams.numImages
        })
      });

      if (!res.ok) throw new Error('Generation failed');
      
      const data = await res.json();
      setGeneratedImages(prev => [...prev, ...data.images]);
      toast.success('Images generated successfully');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const generateLLM = async () => {
    setLlmGenerating(true);
    setLlmResponse('');
    try {
      const res = await fetch('/api/huggingface/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: llmParams.model,
          inputs: `${llmParams.systemPrompt}\n\nUser: ${llmParams.prompt}\nAssistant:`,
          parameters: {
            temperature: llmParams.temperature,
            max_new_tokens: llmParams.maxTokens,
            top_p: llmParams.topP,
            top_k: llmParams.topK
          }
        })
      });

      if (!res.ok) throw new Error('LLM inference failed');
      
      const data = await res.json();
      setLlmResponse(data.generated_text || data[0]?.generated_text || 'No response');
      toast.success('Response generated');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLlmGenerating(false);
    }
  };

  const generateAudio = async () => {
    setAudioGenerating(true);
    try {
      const formData = new FormData();
      formData.append('model', audioParams.model);
      if (audioParams.text) formData.append('text', audioParams.text);
      if (audioParams.audioFile) formData.append('audio', audioParams.audioFile);
      if (audioParams.speaker) formData.append('speaker', audioParams.speaker);
      if (audioParams.language) formData.append('language', audioParams.language);

      const res = await fetch('/api/huggingface/audio', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('Audio generation failed');
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioResult(url);
      toast.success('Audio generated');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAudioGenerating(false);
    }
  };

  const downloadImage = (url: string, index: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `hf-image-${index + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="border-b border-white/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            HuggingFace Spaces Pro
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        <Tabs defaultValue="image-gen" className="w-full">
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="image-gen"><ImageIcon className="w-4 h-4 mr-1" /> Images</TabsTrigger>
            <TabsTrigger value="llm"><Brain className="w-4 h-4 mr-1" /> LLM</TabsTrigger>
            <TabsTrigger value="audio"><Music className="w-4 h-4 mr-1" /> Audio</TabsTrigger>
            <TabsTrigger value="models"><Search className="w-4 h-4 mr-1" /> Models</TabsTrigger>
            <TabsTrigger value="spaces"><Grid3x3 className="w-4 h-4 mr-1" /> Spaces</TabsTrigger>
            <TabsTrigger value="workflow"><Layers className="w-4 h-4 mr-1" /> Workflow</TabsTrigger>
          </TabsList>

          {/* Image Generation */}
          <TabsContent value="image-gen" className="grid grid-cols-2 gap-4 pt-4">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Model</label>
                <Select value={imageParams.model} onValueChange={(v) => setImageParams({...imageParams, model: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IMAGE_MODELS.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Prompt</label>
                <Textarea
                  value={imageParams.prompt}
                  onChange={(e) => setImageParams({...imageParams, prompt: e.target.value})}
                  placeholder="a beautiful landscape..."
                  rows={3}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Negative Prompt</label>
                <Input
                  value={imageParams.negativePrompt}
                  onChange={(e) => setImageParams({...imageParams, negativePrompt: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm mb-1 block">Width</label>
                  <Input type="number" value={imageParams.width} 
                    onChange={(e) => setImageParams({...imageParams, width: parseInt(e.target.value)})} />
                </div>
                <div>
                  <label className="text-sm mb-1 block">Height</label>
                  <Input type="number" value={imageParams.height}
                    onChange={(e) => setImageParams({...imageParams, height: parseInt(e.target.value)})} />
                </div>
              </div>

              <div>
                <label className="text-sm mb-2 block">Steps: {imageParams.steps}</label>
                <Slider
                  value={[imageParams.steps]}
                  onValueChange={([v]) => setImageParams({...imageParams, steps: v})}
                  min={1} max={100} step={1}
                />
              </div>

              <div>
                <label className="text-sm mb-2 block">Guidance: {imageParams.guidance}</label>
                <Slider
                  value={[imageParams.guidance]}
                  onValueChange={([v]) => setImageParams({...imageParams, guidance: v})}
                  min={1} max={20} step={0.1}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm mb-1 block">Sampler</label>
                  <Select value={imageParams.sampler} onValueChange={(v) => setImageParams({...imageParams, sampler: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SAMPLERS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm mb-1 block">Seed</label>
                  <div className="flex gap-2">
                    <Input type="number" placeholder="random" value={imageParams.seed}
                      onChange={(e) => setImageParams({...imageParams, seed: e.target.value})} />
                    <Button variant="secondary" size="icon" onClick={() => setImageParams({...imageParams, seed: Math.floor(Math.random() * 1e9)})}>
                      <Shuffle className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm mb-1 block">Number of Images</label>
                <Input type="number" min={1} max={4} value={imageParams.numImages}
                  onChange={(e) => setImageParams({...imageParams, numImages: parseInt(e.target.value)})} />
              </div>

              <Button onClick={generateImage} disabled={!imageParams.prompt || generating} className="w-full">
                {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                Generate Images
              </Button>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-3">Generated Images</h3>
              <div className="grid grid-cols-2 gap-3">
                {generatedImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img src={img} alt={`Generated ${i}`} className="w-full h-40 object-cover rounded" />
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100"
                      onClick={() => downloadImage(img, i)}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {generatedImages.length === 0 && (
                  <div className="col-span-2 h-40 flex items-center justify-center border border-dashed border-white/20 rounded">
                    Images will appear here
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* LLM Playground */}
          <TabsContent value="llm" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Model</label>
                <Select value={llmParams.model} onValueChange={(v) => setLLMParams({...llmParams, model: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LLM_MODELS.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm mb-2 block">Temperature: {llmParams.temperature}</label>
                <Slider
                  value={[llmParams.temperature]}
                  onValueChange={([v]) => setLLMParams({...llmParams, temperature: v})}
                  min={0} max={2} step={0.1}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">System Prompt</label>
              <Textarea
                value={llmParams.systemPrompt}
                onChange={(e) => setLLMParams({...llmParams, systemPrompt: e.target.value})}
                rows={2}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">User Prompt</label>
              <Textarea
                value={llmParams.prompt}
                onChange={(e) => setLLMParams({...llmParams, prompt: e.target.value})}
                placeholder="Ask me anything..."
                rows={4}
              />
            </div>

            <Button onClick={generateLLM} disabled={!llmParams.prompt || llmGenerating} className="w-full">
              {llmGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Brain className="w-4 h-4 mr-2" />}
              Generate Response
            </Button>

            {llmResponse && (
              <Card className="bg-white/5">
                <CardHeader><CardTitle>Response</CardTitle></CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap text-sm">{llmResponse}</pre>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Audio */}
          <TabsContent value="audio" className="space-y-4 pt-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Model</label>
              <Select value={audioParams.model} onValueChange={(v) => setAudioParams({...audioParams, model: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUDIO_MODELS.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Text (for TTS/Music)</label>
              <Textarea
                value={audioParams.text}
                onChange={(e) => setAudioParams({...audioParams, text: e.target.value})}
                placeholder="Enter text to synthesize..."
                rows={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm mb-2 block">Speaker/Voice</label>
                <Input
                  value={audioParams.speaker}
                  onChange={(e) => setAudioParams({...audioParams, speaker: e.target.value})}
                />
              </div>
              <div>
                <label className="text-sm mb-2 block">Language</label>
                <Select value={audioParams.language} onValueChange={(v) => setAudioParams({...audioParams, language: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="fr">French</SelectItem>
                    <SelectItem value="de">German</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button onClick={generateAudio} disabled={!audioParams.text || audioGenerating} className="w-full">
              {audioGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Music className="w-4 h-4 mr-2" />}
              Generate Audio
            </Button>

            {audioResult && (
              <Card className="bg-white/5">
                <CardHeader><CardTitle>Generated Audio</CardTitle></CardHeader>
                <CardContent>
                  <audio controls src={audioResult} className="w-full" />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Model Hub */}
          <TabsContent value="models" className="space-y-4 pt-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Select value={modelFilter} onValueChange={setModelFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="text-generation">Text Gen</SelectItem>
                  <SelectItem value="image-generation">Image Gen</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={searchModels} disabled={loadingModels}>
                {loadingModels ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
              {models.map(model => (
                <Card key={model.id} className="bg-white/5">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h4 className="font-medium text-sm truncate">{model.modelId}</h4>
                        <p className="text-xs text-gray-400">{model.author}</p>
                      </div>
                      <Badge variant="outline">{model.pipeline_tag}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <Download className="w-3 h-3" />
                        {model.downloads.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Heart className="w-3 h-3" />
                        {model.likes}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {model.tags.slice(0, 3).map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Spaces */}
          <TabsContent value="spaces" className="space-y-4 pt-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search spaces..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Button onClick={searchSpaces} disabled={loadingModels}>
                {loadingModels ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
              {spaces.map(space => (
                <Card key={space.id} className="bg-white/5">
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <span className="text-2xl">{space.emoji}</span>
                      <div className="flex-1">
                        <h4 className="font-medium text-sm">{space.title}</h4>
                        <p className="text-xs text-gray-400">{space.author}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">{space.sdk}</Badge>
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Heart className="w-3 h-3" />
                        {space.likes}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Workflow */}
          <TabsContent value="workflow" className="pt-4">
            <div className="text-center text-gray-400 py-8">
              <Layers className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Multi-model workflow builder coming soon</p>
              <p className="text-sm mt-2">Chain models: text → image → upscale → style transfer</p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
}
