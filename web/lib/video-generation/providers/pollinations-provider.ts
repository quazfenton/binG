/**
 * Pollinations AI Video Generation Provider
 * Documentation: https://github.com/pollinations/pollinations
 */

import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoProviderConfig,
} from '../types';

export class PollinationsVideoProvider implements VideoGenerationProvider {
  readonly id = 'pollinations';
  readonly name = 'Pollinations AI';
  
  private apiKey?: string;
  private baseURL?: string;

  initialize(config: VideoProviderConfig): void {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://video.pollinations.ai/'; // Using the GET endpoint directly in generate
  }

  async isAvailable(): Promise<boolean> {
    return true; // Pollinations API is free and doesn't explicitly require a key
  }

  getModels(): Array<{ 
    id: string; 
    tags?: string[]; 
    type?: string;
    capabilities?: any
  }> {
    return [
      { id: 'grok-video-pro', tags: ['text-to-video'], type: 'text-to-video', capabilities: {} },
      { id: 'ltx-2', tags: ['text-to-video'], type: 'text-to-video', capabilities: {} },
      { id: 'nova-reel', tags: ['text-to-video'], type: 'text-to-video', capabilities: {} },
      { id: 'p-video', tags: ['text-to-video'], type: 'text-to-video', capabilities: {} },
      { id: 'seedance', tags: ['text-to-video'], type: 'text-to-video', capabilities: {} },
      { id: 'seedance-pro', tags: ['text-to-video', 'fast'], type: 'text-to-video', capabilities: {} },
      { id: 'veo', tags: ['text-to-video', 'fast'], type: 'text-to-video', capabilities: {} },
      { id: 'wan-fast', tags: ['text-to-video', 'fast'], type: 'text-to-video', capabilities: {} },
      { id: 'wan', tags: ['text-to-video'], type: 'text-to-video', capabilities: {} }
    ];
  }

  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    const {
      prompt,
      model,
      duration,
      aspectRatio,
    } = request;

    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required');
    }

    try {
      const selectedModel = model || 'wan';
      const queryParams = new URLSearchParams();
      queryParams.append('model', selectedModel);
      
      if (duration) {
        queryParams.append('duration', duration.toString());
      }
      
      if (aspectRatio) {
        queryParams.append('aspectRatio', aspectRatio);
      }

      // We just return the video URL directly since pollinations serves videos directly via GET
      const url = `https://gen.pollinations.ai/video/${encodeURIComponent(prompt.trim())}?${queryParams.toString()}`;

      return {
        videoUrl: url,
        provider: this.id,
        model: selectedModel,
        duration: duration || 5, // Approximate
        width: 1024,
        height: 576,
        metadata: {
          aspectRatio,
        }
      };
    } catch (error) {
      console.error('Pollinations video generation error:', error);
      throw new Error(`Video generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
