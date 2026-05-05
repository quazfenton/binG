/**
 * Video Generation Module
 * Comprehensive video generation support with multiple providers and models
 * 
 * Supported Providers:
 * - Vercel AI (Alibaba WAN, ByteDance Seedance, Google Veo, Kling AI)
 * 
 * Features:
 * - Text-to-video generation
 * - Image-to-video generation
 * - Multiple quality presets
 * - Aspect ratio support
 * - Provider fallback chain
 */

import { VercelVideoProvider } from './providers/vercel-provider';
import { GoogleVideoProvider } from './providers/google-provider';
import type {
  VideoProvider,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoProviderConfig,
  VideoGenerationProvider,
} from './types';

export class VideoGenerationRegistry {
  private providers: Map<string, VideoGenerationProvider> = new Map()
  private config: Record<string, VideoProviderConfig> = {}

  constructor() {}

  register(provider: VideoGenerationProvider): void {
    this.providers.set(provider.id, provider)
  }

  initialize(config: Record<string, VideoProviderConfig>): void {
    this.config = config
    for (const [providerId, provider] of this.providers) {
      const providerConfig = config[providerId] || {}
      provider.initialize(providerConfig)
    }
  }

  async getAvailableProviders(): Promise<VideoGenerationProvider[]> {
    const available: VideoGenerationProvider[] = []
    
    for (const [id, provider] of this.providers) {
      try {
        const isAvailable = await provider.isAvailable()
        if (isAvailable) {
          available.push(provider)
        }
      } catch {
        // Provider not available
      }
    }
    
    return available
  }

  getProvider(providerId: string): VideoGenerationProvider | undefined {
    return this.providers.get(providerId)
  }

  getAllProviders(): VideoGenerationProvider[] {
    return Array.from(this.providers.values())
  }

  async generateWithProvider(providerId: string, request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`)
    }
    return await provider.generateVideo(request)
  }

  async generateWithFallback(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    const availableProviders = await this.getAvailableProviders()
    if (availableProviders.length === 0) {
      throw new Error('No available video generation providers')
    }
    
    // Try providers in order until one succeeds
    const errors: Error[] = []
    
    for (const provider of availableProviders) {
      try {
        return await provider.generateVideo(request)
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)))
      }
    }
    
    throw new Error(`All providers failed: ${errors.map(e => e.message).join('; ')}`)
  }
}

// Video generation capabilities and presets
export const VIDEO_QUALITY_PRESETS: Record<string, {
  resolution: string;
  bitrate?: string;
  fps?: number;
  duration?: number;
}> = {
  low: { resolution: '512x512', bitrate: '4M', fps: 24, duration: 5 },
  medium: { resolution: '768x768', bitrate: '8M', fps: 30, duration: 10 },
  high: { resolution: '1024x1024', bitrate: '16M', fps: 30, duration: 15 },
  ultra: { resolution: '1792x1024', bitrate: '32M', fps: 60, duration: 20 }
}

export const VIDEO_ASPECT_RATIOS = [
  { value: '1:1', label: 'Square (1:1)', width: 1024, height: 1024 },
  { value: '16:9', label: 'Landscape (16:9)', width: 1920, height: 1080 },
  { value: '9:16', label: 'Portrait (9:16)', width: 1080, height: 1920 },
  { value: '4:3', label: 'Standard (4:3)', width: 1440, height: 1080 },
  { value: '3:2', label: 'Photo (3:2)', width: 1440, height: 960 },
  { value: '21:9', label: 'Ultrawide (21:9)', width: 2560, height: 1080 }
]

export const VIDEO_STYLES = [
  'None',
  'Cinematic',
  'Anime',
  'Cartoon',
  'Realistic',
  'Fantasy',
  'Sci-Fi',
  'Cyberpunk',
  'Vintage',
  'Watercolor',
  'Pixel Art',
  '3D Animation',
  'Stop Motion',
  'Minimalist',
  'Abstract',
  'Surreal'
]

// Video providers with models from vercelModels.json (type: video)
export const VIDEO_PROVIDERS: Record<string, VideoProvider> = {
  vercel: {
    id: 'vercel',
    name: 'Vercel AI',
    models: [
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
        id: 'vercel:google/veo-3.0-fast-generate-001',
        tags: ['text-to-video', 'high-fidelity'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 32,
          resolutions: [{ width: 1920, height: 1080 }],
          styles: ['cinematic', 'realistic', 'fantasy', 'sci-fi']
        }
      },
      {
        id: 'vercel:google/veo-3.0-generate-001',
        tags: ['text-to-video', 'ultra-high-fidelity'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 64,
          resolutions: [{ width: 2560, height: 1440 }],
          styles: ['cinematic', 'realistic', 'fantasy', 'sci-fi', 'anime']
        }
      },
      {
        id: 'vercel:google/veo-3.1-fast-generate-001',
        tags: ['text-to-video', 'high-fidelity', 'fast'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 16,
          resolutions: [{ width: 1920, height: 1080 }],
          styles: ['cinematic', 'realistic', 'fantasy']
        }
      },
      {
        id: 'vercel:google/veo-3.1-generate-001',
        tags: ['text-to-video', 'ultra-high-fidelity'],
        type: 'text-to-video',
        capabilities: {
          maxDuration: 64,
          resolutions: [{ width: 2560, height: 1440 }],
          styles: ['cinematic', 'realistic', 'fantasy', 'sci-fi', 'anime']
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
    ],
    supportsStreaming: true,
    description: 'Vercel AI video generation models with text-to-video, image-to-video, and video-to-video capabilities'
  }
}

// Video generation service with provider management
class VideoGenerationService {
  private providers: Record<string, any> = {}
  private config: Record<string, VideoProviderConfig> = {}

  constructor(config: Record<string, VideoProviderConfig> = {}) {
    this.config = config
    this.initializeProviders()
  }

  private initializeProviders(): void {
    // Initialize Vercel provider
    if (this.config.vercel?.apiKey) {
      const { createOpenAI } = require('@ai-sdk/openai')
      this.providers.vercel = createOpenAI({
        apiKey: this.config.vercel.apiKey,
        baseURL: this.config.vercel.baseURL || 'https://api.vercel.com/v1'
      })
    }
  }

  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    const { provider = 'vercel', model, apiKey, ...params } = request
    
    if (!this.providers[provider]) {
      throw new Error(`Provider ${provider} not initialized or not available`)
    }

    const client = this.providers[provider]
    
    // Map our parameters to the provider's API format
    const generationParams = this.mapToProviderParams(params)
    
    try {
      // Use the provider's video generation API
      // Note: This is a simplified implementation - actual APIs may vary
      const response = await client.videos.generate({
        model,
        ...generationParams,
      })

      if (!response.data || response.data.length === 0) {
        throw new Error('No video was generated')
      }

      const videoData = response.data[0]

      return {
        videoUrl: videoData.url,
        thumbnailUrl: videoData.thumbnail_url,
        provider,
        model,
        duration: videoData.duration || 4, // default 4 seconds
        width: videoData.width || 1024,
        height: videoData.height || 576,
        metadata: {
          seed: videoData.seed,
          style: params.style,
          quality: params.quality,
          framesGenerated: videoData.frames
        }
      }
    } catch (error) {
      console.error('Video generation error:', error)
      throw new Error(`Video generation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private mapToProviderParams(params: Omit<VideoGenerationRequest, 'provider' | 'model' | 'apiKey'>): any {
    // Map our standardized parameters to provider-specific format
    const providerParams: any = {
      prompt: params.prompt,
      // Map duration to provider-specific format
      ...(params.duration && { duration: params.duration }),
      // Map quality to provider-specific format
      ...(params.quality && { quality: params.quality }),
      // Map style if supported
      ...(params.style && params.style !== 'None' && { style: params.style }),
      // Map seed if provided
      ...(typeof params.seed === 'number' && { seed: params.seed }),
      // Map input media
      ...(params.initImageUrl && { init_image: params.initImageUrl }),
      ...(params.initVideoUrl && { init_video: params.initVideoUrl }),
      // Map advanced options
      ...(params.motionStrength && { motion_strength: params.motionStrength }),
      ...(params.cameraMovement && { camera_movement: params.cameraMovement }),
    }

    // Handle aspect ratio
    if (params.aspectRatio || params.width || params.height) {
      const ratio = params.aspectRatio || this.getAspectRatio(params.width, params.height)
      const size = this.getSizeForAspectRatio(ratio)
      providerParams.size = size
    }

    return providerParams
  }

  private getAspectRatio(width?: number, height?: number): string {
    if (!width || !height) return '16:9' // default
    
    const ratio = width / height
    if (Math.abs(ratio - 1) < 0.01) return '1:1'
    if (Math.abs(ratio - 1.777) < 0.01) return '16:9'  // 16/9 ≈ 1.777
    if (Math.abs(ratio - 0.5625) < 0.01) return '9:16' // 9/16 ≈ 0.5625
    if (Math.abs(ratio - 1.333) < 0.01) return '4:3'  // 4/3 ≈ 1.333
    if (Math.abs(ratio - 1.5) < 0.01) return '3:2'    // 3/2 = 1.5
    if (Math.abs(ratio - 2.37) < 0.01) return '21:9'   // 21/9 ≈ 2.333
    
    return '16:9' // default
  }

  private getSizeForAspectRatio(ratio: string): string {
    const sizeMap: Record<string, string> = {
      '1:1': '1024x1024',
      '16:9': '1792x1024',
      '9:16': '768x1344',
      '4:3': '1344x1024',
      '3:2': '1344x896',
      '21:9': '2048x896'
    }
    return sizeMap[ratio] || '1792x1024'
  }

  async getAvailableProviders(): Promise<string[]> {
    const available: string[] = []
    
    for (const [providerId, provider] of Object.entries(this.providers)) {
      try {
        // Simple availability check
        if (provider && (await this.checkProviderAvailability(providerId))) {
          available.push(providerId)
        }
      } catch {
        // Provider not available
      }
    }
    
    return available
  }

  private async checkProviderAvailability(providerId: string): Promise<boolean> {
    try {
      // Simple check - try to list models
      await this.providers[providerId].models.list()
      return true
    } catch {
      return false
    }
  }

  // Utility methods
  getProviderModels(providerId: string): Array<{ 
    id: string; 
    tags?: string[]; 
    type?: string;
    capabilities?: any
  }> {
    const provider = VIDEO_PROVIDERS[providerId]
    if (!provider) return []
    
    return provider.models.map(model => 
      typeof model === 'string' 
        ? { id: model, tags: [], type: 'unknown' } 
        : { 
            id: model.id, 
            tags: model.tags || [], 
            type: (model as any).type || 'unknown',
            capabilities: (model as any).capabilities || {}
          }
    )
  }

  getAllModels(): Array<{ 
    id: string; 
    provider: string; 
    tags?: string[]; 
    type?: string;
    capabilities?: any
  }> {
    const models: Array<{ 
      id: string; 
      provider: string; 
      tags?: string[]; 
      type?: string;
      capabilities?: any
    }> = []
    
    for (const [providerId, provider] of Object.entries(VIDEO_PROVIDERS)) {
      provider.models.forEach(model => {
        const modelId = typeof model === 'string' ? model : model.id
        const tags = typeof model === 'string' ? [] : model.tags || []
        const type = typeof model === 'string' ? 'unknown' : (model as any).type || 'unknown'
        const capabilities = typeof model === 'string' ? {} : (model as any).capabilities || {}
        models.push({ id: modelId, provider: providerId, tags, type, capabilities })
      })
    }
    
    return models
  }

  getVideoStyles(): string[] {
    return VIDEO_STYLES
  }

  getVideoAspectRatios(): typeof VIDEO_ASPECT_RATIOS {
    return VIDEO_ASPECT_RATIOS
  }

  getQualityPresets(): typeof VIDEO_QUALITY_PRESETS {
    return VIDEO_QUALITY_PRESETS
  }
}


// Export provider classes
export { VercelVideoProvider } from './providers/vercel-provider';
export { GoogleVideoProvider } from './providers/google-provider';

// Singleton registry instance and getter function
let defaultRegistry: VideoGenerationRegistry | null = null;

export function getVideoGenerationRegistry(): VideoGenerationRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new VideoGenerationRegistry();
    // Initialize registry with available providers
    defaultRegistry.register(new VercelVideoProvider());
    defaultRegistry.register(new GoogleVideoProvider());
    
    // Initialize with environment variables
    if (typeof process !== 'undefined') {
      defaultRegistry.initialize({
        vercel: {
          apiKey: process.env.VERCEL_API_KEY,
          baseURL: process.env.VERCEL_BASE_URL
        },
        google: {
          apiKey: process.env.GEMINI_API_KEY,
          baseURL: process.env.GEMINI_BASE_URL
        }
      });
    }
  }
  return defaultRegistry;
}

// Export singleton instance for convenience
export const videoGenerationRegistry = getVideoGenerationRegistry();



// Export utility functions for convenience
export function getVideoProviderModels(providerId: string): Array<{ 
  id: string; 
  tags?: string[]; 
  type?: string;
  capabilities?: any
}> {
  const provider = videoGenerationRegistry.getProvider(providerId);
  return provider ? provider.getModels() : [];
}

export function getAllVideoModels(): Array<{ 
  id: string; 
  provider: string; 
  tags?: string[]; 
  type?: string;
  capabilities?: any
}> {
  const models: Array<{ 
    id: string; 
    provider: string; 
    tags?: string[]; 
    type?: string;
    capabilities?: any
  }> = [];
  
  const providers = videoGenerationRegistry.getAllProviders();
  for (const provider of providers) {
    const providerModels = provider.getModels();
    providerModels.forEach(model => {
      models.push({
        id: model.id,
        provider: provider.id,
        tags: model.tags || [],
        type: model.type,
        capabilities: model.capabilities
      });
    });
  }
  
  return models;
}

export function getVideoStyles(): string[] {
  return VIDEO_STYLES;
}

export function getVideoAspectRatios(): typeof VIDEO_ASPECT_RATIOS {
  return VIDEO_ASPECT_RATIOS;
}

export function getVideoQualityPresets(): typeof VIDEO_QUALITY_PRESETS {
  return VIDEO_QUALITY_PRESETS;
}