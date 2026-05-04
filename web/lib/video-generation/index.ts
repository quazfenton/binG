/**
 * Video Generation Module
 */

export * from './types';
export * from './video-generation';

import { 
  getVideoGenerationRegistry, 
  VIDEO_STYLES, 
  VIDEO_ASPECT_RATIOS, 
  VIDEO_QUALITY_PRESETS,
  videoGenerationRegistry
} from './video-generation';
import { VideoGenerationRequest } from './types';

// Initialize with environment variables
if (typeof process !== 'undefined') {
  const registry = getVideoGenerationRegistry();
  registry.initialize({
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

/**
 * Utility functions for convenience
 */

export function getVideoProviderModels(providerId: string) {
  const provider = getVideoGenerationRegistry().getProvider(providerId);
  return provider ? provider.getModels() : [];
}

export function getAllVideoModels() {
  const models: any[] = [];
  const providers = getVideoGenerationRegistry().getAllProviders();
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

export function getVideoAspectRatios() {
  return VIDEO_ASPECT_RATIOS;
}

export function getVideoQualityPresets() {
  return VIDEO_QUALITY_PRESETS;
}

/**
 * Service wrapper for backward compatibility
 */
export const videoGenerationService = {
  generateVideo: (request: VideoGenerationRequest) => {
    const provider = request.provider || 'vercel';
    return getVideoGenerationRegistry().generateWithProvider(provider, request);
  },
  getAvailableProviders: () => getVideoGenerationRegistry().getAvailableProviders(),
  getProviderModels: (providerId: string) => getVideoProviderModels(providerId),
  getAllModels: () => getAllVideoModels(),
};
