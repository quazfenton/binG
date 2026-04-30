/**
 * Video Generation Provider Registry
 */

import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoProviderConfig,
} from './types';
import { VercelVideoProvider } from './providers/vercel-provider';
import { GoogleVideoProvider } from './providers/google-provider';

/**
 * Registry for managing video generation providers
 */
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

/**
 * Constants and presets
 */

export const VIDEO_QUALITY_PRESETS: Record<string, { 
  resolution: string; 
  bitrate?: string; 
  fps?: number;
  duration: number;
}> = {
  low: { resolution: '512x512', bitrate: '4M', fps: 24, duration: 2 },
  medium: { resolution: '768x768', bitrate: '8M', fps: 30, duration: 4 },
  high: { resolution: '1024x1024', bitrate: '16M', fps: 30, duration: 8 },
  ultra: { resolution: '1792x1024', bitrate: '32M', fps: 60, duration: 16 }
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
  'None', 'Cinematic', 'Anime', 'Cartoon', 'Realistic', 'Fantasy', 
  'Sci-Fi', 'Cyberpunk', 'Vintage', 'Watercolor', 'Pixel Art', 
  '3D Animation', 'Stop Motion', 'Minimalist', 'Abstract', 'Surreal'
]

/**
 * Create and configure the default registry
 */
export function createDefaultRegistry(): VideoGenerationRegistry {
  const registry = new VideoGenerationRegistry();
  registry.register(new VercelVideoProvider());
  registry.register(new GoogleVideoProvider());
  return registry;
}

/**
 * Singleton registry instance
 */
let defaultRegistry: VideoGenerationRegistry | null = null;

export function getVideoGenerationRegistry(): VideoGenerationRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createDefaultRegistry();
  }
  return defaultRegistry;
}
