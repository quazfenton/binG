/**
 * Image Generation Module
 * Modular, multi-provider image generation with fallback support
 * 
 * Supported Providers:
 * - Mistral AI (FLUX1.1 Ultra via Agents API)
 * - Replicate (SDXL, Flux, Stable Diffusion models)
 * 
 * Usage:
 * import { getDefaultRegistry, ImageGenerationParams } from '@/lib/image-generation';
 * 
 * const registry = getDefaultRegistry();
 * registry.initializeAll({
 *   mistral: { apiKey: process.env.MISTRAL_API_KEY },
 *   replicate: { apiKey: process.env.REPLICATE_API_TOKEN },
 * });
 * 
 * const result = await registry.generateWithFallback({
 *   prompt: 'A beautiful sunset',
 *   aspectRatio: '16:9',
 *   quality: 'high',
 * });
 */

// Types
export * from './types';

// Providers
export { MistralImageProvider } from './providers/mistral-provider';
export { ReplicateImageProvider } from './providers/replicate-provider';

// Registry
export { 
  ImageProviderRegistry, 
  createDefaultRegistry, 
  getDefaultRegistry 
} from './provider-registry';

// Re-export error types for convenience
export { ImageGenerationError, ImageGenerationErrorType } from './types';
