/**
 * Vercel Video Generation Provider
 * Uses Vercel's video generation models via OpenAI-compatible API
 */

import { createOpenAI } from '@ai-sdk/openai';
import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoProviderConfig,
} from '../types';

export class VercelVideoProvider implements VideoGenerationProvider {
  readonly id = 'vercel';
  readonly name = 'Vercel AI';
  
  private client: any = null;
  private apiKey?: string;
  private baseURL?: string;

  initialize(config: VideoProviderConfig): void {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    
    if (this.apiKey) {
      this.client = createOpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseURL || 'https://api.vercel.com/v1',
      });
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.client || !this.apiKey) {
      return false;
    }
    
    try {
      // Simple API call to check availability
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  getModels(): Array<{ 
    id: string; 
    tags?: string[]; 
    type?: string;
    capabilities?: any
  }> {
    return [
      {
        id: 'vercel:alibaba/wan-v2.5-t2v-preview',
        tags: ['text-to-video'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 4,
          resolutions: [{ width: 1024, height: 576 }],
          styles: ['cinematic', 'realistic', 'anime']
        }
      },
      {
        id: 'vercel:alibaba/wan-v2.6-i2v',
        tags: ['image-to-video'],
        type: 'image-to-video',
        capabilities: {
          maxDuration: 8,
          resolutions: [{ width: 1280, height: 720 }],
          styles: ['cinematic', 'realistic']
        }
      },
      {
        id: 'vercel:alibaba/wan-v2.6-i2v-flash',
        tags: ['image-to-video', 'fast'],
        type: 'image-to-video',
        capabilities: {
          maxDuration: 4,
          resolutions: [{ width: 1024, height: 576 }],
          styles: ['cinematic', 'realistic']
        }
      },
      {
        id: 'vercel:alibaba/wan-v2.6-r2v',
        tags: ['video-to-video'],
        type: 'video-to-video',
        capabilities: {
          maxDuration: 16,
          resolutions: [{ width: 1280, height: 720 }],
          styles: ['enhance', 'upscale']
        }
      },
      {
        id: 'vercel:alibaba/wan-v2.6-r2v-flash',
        tags: ['video-to-video', 'fast'],
        type: 'video-to-video',
        capabilities: {
          maxDuration: 8,
          resolutions: [{ width: 1024, height: 576 }],
          styles: ['enhance', 'upscale']
        }
      },
      {
        id: 'vercel:alibaba/wan-v2.6-t2v',
        tags: ['text-to-video'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 8,
          resolutions: [{ width: 1280, height: 720 }],
          styles: ['cinematic', 'realistic', 'anime']
        }
      },
      {
        id: 'vercel:bytedance/seedance-2.0',
        tags: ['text-to-video', 'high-quality'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 16,
          resolutions: [{ width: 1920, height: 1080 }],
          styles: ['cinematic', 'realistic', 'fantasy']
        }
      },
      {
        id: 'vercel:bytedance/seedance-2.0-fast',
        tags: ['text-to-video', 'fast'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 8,
          resolutions: [{ width: 1280, height: 720 }],
          styles: ['cinematic', 'realistic']
        }
      },
      {
        id: 'vercel:bytedance/seedance-v1.0-lite-i2v',
        tags: ['image-to-video', 'lightweight'],
        type: 'image-to-video',
        capabilities: {
          maxDuration: 4,
          resolutions: [{ width: 768, height: 768 }],
          styles: ['basic']
        }
      },
      {
        id: 'vercel:bytedance/seedance-v1.0-lite-t2v',
        tags: ['text-to-video', 'lightweight'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 4,
          resolutions: [{ width: 768, height: 768 }],
          styles: ['basic']
        }
      },
      {
        id: 'vercel:bytedance/seedance-v1.0-pro',
        tags: ['text-to-video', 'professional'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 16,
          resolutions: [{ width: 1920, height: 1080 }],
          styles: ['cinematic', 'realistic', 'fantasy', 'anime']
        }
      },
      {
        id: 'vercel:bytedance/seedance-v1.0-pro-fast',
        tags: ['text-to-video', 'professional', 'fast'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 8,
          resolutions: [{ width: 1280, height: 720 }],
          styles: ['cinematic', 'realistic']
        }
      },
      {
        id: 'vercel:bytedance/seedance-v1.5-pro',
        tags: ['text-to-video', 'professional'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 32,
          resolutions: [{ width: 1920, height: 1080 }],
          styles: ['cinematic', 'realistic', 'fantasy', 'anime', 'sci-fi']
        }
      },
      {
        id: 'vercel:klingai/kling-v2.5-turbo-i2v',
        tags: ['image-to-video', 'turbo'],
        type: 'image-to-video',
        capabilities: {
          maxDuration: 8,
          resolutions: [{ width: 1280, height: 720 }],
          styles: ['cinematic', 'realistic']
        }
      },
      {
        id: 'vercel:klingai/kling-v2.5-turbo-t2v',
        tags: ['text-to-video', 'turbo'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 8,
          resolutions: [{ width: 1280, height: 720 }],
          styles: ['cinematic', 'realistic', 'anime']
        }
      },
      {
        id: 'vercel:klingai/kling-v2.6-i2v',
        tags: ['image-to-video'],
        type: 'image-to-video',
        capabilities: {
          maxDuration: 16,
          resolutions: [{ width: 1920, height: 1080 }],
          styles: ['cinematic', 'realistic', 'fantasy']
        }
      },
      {
        id: 'vercel:klingai/kling-v2.6-motion-control',
        tags: ['text-to-video', 'motion-control'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 16,
          resolutions: [{ width: 1920, height: 1080 }],
          styles: ['cinematic', 'realistic']
        }
      },
      {
        id: 'vercel:klingai/kling-v2.6-t2v',
        tags: ['text-to-video'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 16,
          resolutions: [{ width: 1920, height: 1080 }],
          styles: ['cinematic', 'realistic', 'anime', 'fantasy']
        }
      },
      {
        id: 'vercel:klingai/kling-v3.0-i2v',
        tags: ['image-to-video', 'high-quality'],
        type: 'image-to-video',
        capabilities: {
          maxDuration: 32,
          resolutions: [{ width: 2560, height: 1440 }],
          styles: ['cinematic', 'realistic', 'fantasy', 'sci-fi']
        }
      },
      {
        id: 'vercel:klingai/kling-v3.0-t2v',
        tags: ['text-to-video', 'high-quality'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 32,
          resolutions: [{ width: 2560, height: 1440 }],
          styles: ['cinematic', 'realistic', 'fantasy', 'sci-fi', 'anime']
        }
      }
    ]
  }

  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    if (!this.client) {
      throw new Error('Vercel provider not initialized. Please check your VERCEL_API_KEY environment variable.');
    }

    const {
      prompt,
      negativePrompt,
      width,
      height,
      duration,
      quality = 'medium',
      seed,
      model: requestedModel,
      initImageUrl,
      aspectRatio,
      style,
      motionStrength,
      cameraMovement,
    } = request;

    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required');
    }

    // Use requested model or default to first available
    const model = requestedModel || this.getModels()[0].id;
    const qualityPreset = VIDEO_QUALITY_PRESETS[quality] || VIDEO_QUALITY_PRESETS.medium;
    const finalDuration = duration || qualityPreset.duration;

    try {
      // Map parameters to Vercel API format
      const generationParams: any = {
        model,
        prompt: prompt.trim(),
        ...(negativePrompt && { negative_prompt: negativePrompt }),
        ...(finalDuration && { duration: finalDuration }),
        ...(quality && { quality }),
        ...(seed && typeof seed === 'number' && { seed }),
        ...(initImageUrl && { init_image: initImageUrl }),
        ...(aspectRatio && { aspect_ratio: aspectRatio }),
        ...(style && style !== 'None' && { style }),
        ...(motionStrength && { motion_strength: motionStrength }),
        ...(cameraMovement && { camera_movement: cameraMovement }),
      };

      const response = await this.client.videos.generate(generationParams);

      if (!response.data || response.data.length === 0) {
        throw new Error('No video was generated by the Vercel API');
      }

      const videoData = response.data[0];

      return {
        videoUrl: videoData.url,
        thumbnailUrl: videoData.thumbnail_url,
        provider: this.id,
        model: model,
        duration: videoData.duration || finalDuration,
        width: videoData.width || width || 1024,
        height: videoData.height || height || 576,
        metadata: {
          seed: videoData.seed,
          style: style,
          quality: quality,
          framesGenerated: videoData.frames,
          providerData: videoData
        }
      };
    } catch (error) {
      console.error('Vercel video generation error:', error);
      throw new Error(`Video generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getAspectRatio(width?: number, height?: number): string {
    if (!width || !height) return '16:9';
    
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.01) return '1:1';
    if (Math.abs(ratio - 1.777) < 0.01) return '16:9';
    if (Math.abs(ratio - 0.5625) < 0.01) return '9:16';
    if (Math.abs(ratio - 1.333) < 0.01) return '4:3';
    if (Math.abs(ratio - 1.5) < 0.01) return '3:2';
    if (Math.abs(ratio - 2.37) < 0.01) return '21:9';
    
    return '16:9';
  }
}