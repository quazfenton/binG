/**
 * Cloudflare Workers AI Image Generation Provider
 * Serverless image generation at the edge with various models
 * Documentation: https://developers.cloudflare.com/workers-ai/models/#image-generation
 */

import type {
  ImageGenerationProvider,
  ImageGenerationParams,
  ImageGenerationResponse,
  GeneratedImage,
  ProviderConfig,
  ProviderCapabilities,
  ImageGenerationError,
  ImageGenerationErrorType,
} from '../types';
import { ASPECT_RATIO_DIMENSIONS, ImageGenerationErrorType as ErrorType } from '../types';

export interface CloudflareImageGenerationOptions {
  prompt: string;
  negative_prompt?: string;
  image?: string; // Base64 encoded image for img2img
  mask?: string;  // Base64 encoded mask for inpainting
  height?: number;
  width?: number;
  num_steps?: number;
  guidance?: number;
  seed?: number;
  strength?: number; // For img2img
}

export class CloudflareImageProvider implements ImageGenerationProvider {
  readonly id = 'cloudflare';
  readonly name = 'Cloudflare Workers AI';
  readonly defaultModel = '@cf/black-forest-labs/flux-1-schnell';

  private accountId?: string;
  private apiKey?: string;
  private baseURL = 'https://api.cloudflare.com/client/v4/accounts';

  readonly models = [
    // Flux models (fast, high quality)
    '@cf/black-forest-labs/flux-1-schnell',
    '@cf/black-forest-labs/flux-2-dev',
    '@cf/black-forest-labs/flux-2-klein-4b',
    '@cf/black-forest-labs/flux-2-klein-9b',
    // Leonardo models
    '@cf/leonardo/lucid-origin',
    '@cf/leonardo/phoenix-1.0',
  ];

  readonly capabilities: ProviderCapabilities = {
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:2', '2:3'],
    resolutions: [
      { width: 512, height: 512 },
      { width: 768, height: 768 },
      { width: 1024, height: 1024 },
      { width: 1280, height: 720 },
      { width: 720, height: 1280 },
      { width: 1152, height: 864 },
      { width: 864, height: 1152 },
    ],
    supportsNegativePrompt: true,
    supportsImg2Img: true,
    supportsSeed: true,
    supportsBatchGeneration: false,
    supportsSamplers: false,
    maxBatchSize: 1,
    stylePresets: [],
    qualityPresets: [],
  };

  initialize(config: ProviderConfig): void {
    this.apiKey = config.apiKey;
    this.accountId = config.accountId;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey || !this.accountId) {
      return false;
    }

    try {
      // Test with a simple model list call
      const response = await fetch(
        `${this.baseURL}/${this.accountId}/ai/models`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(
    params: ImageGenerationParams,
    signal?: AbortSignal
  ): Promise<ImageGenerationResponse> {
    if (!this.apiKey || !this.accountId) {
      throw this.createError(
        'Cloudflare Workers AI not initialized. Please check CLOUDFLARE_API_KEY and CLOUDFLARE_ACCOUNT_ID environment variables.',
        ErrorType.NOT_CONFIGURED
      );
    }

    console.log('[CloudflareProvider] Starting image generation with prompt:', params.prompt.substring(0, 100));

    const startTime = Date.now();
    const controller = new AbortController();

    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      // Get aspect ratio dimensions
      const aspectRatio = params.aspectRatio || '1:1';
      const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio] || ASPECT_RATIO_DIMENSIONS['1:1'];
      
      const width = params.width || dimensions.width;
      const height = params.height || dimensions.height;

      // Prepare request body
      const requestBody: CloudflareImageGenerationOptions = {
        prompt: params.prompt,
        negative_prompt: params.negativePrompt,
        height,
        width,
        num_steps: params.steps || 4, // Default to 4 steps for schnell
        guidance: params.guidance || 7.5,
        seed: typeof params.seed === 'number' ? params.seed : undefined,
      };

      // Add image for img2img if provided
      if (params.initImage) {
        requestBody.image = params.initImage;
        requestBody.strength = params.imageStrength || 0.8;
      }

      // Make API call
      const response = await fetch(
        `${this.baseURL}/${this.accountId}/ai/run/${this.defaultModel}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (response.status === 401 || response.status === 403) {
          throw this.createError(
            'Invalid Cloudflare API credentials',
            ErrorType.AUTH_FAILED,
            new Error(errorData.message || response.statusText)
          );
        }

        if (response.status === 429) {
          throw this.createError(
            'Rate limit exceeded. Cloudflare Workers AI has a free tier of 10,000 neurons/day.',
            ErrorType.RATE_LIMITED,
            new Error(errorData.message || response.statusText)
          );
        }

        throw this.createError(
          `Cloudflare API error: ${errorData.message || response.statusText}`,
          ErrorType.GENERATION_FAILED,
          new Error(errorData.message || response.statusText)
        );
      }

      // Cloudflare returns image as binary (application/octet-stream) or base64
      const contentType = response.headers.get('content-type');
      let imageBase64: string;

      if (contentType?.includes('application/json')) {
        // Some models return JSON with base64 image
        const result = await response.json();
        imageBase64 = result.image || result.images?.[0];
      } else {
        // Binary response - convert to base64
        const blob = await response.blob();
        imageBase64 = await this.blobToBase64(blob);
      }

      if (!imageBase64) {
        throw this.createError(
          'No image data received from Cloudflare API',
          ErrorType.GENERATION_FAILED
        );
      }

      const duration = Date.now() - startTime;

      console.log(`[CloudflareProvider] Generation completed in ${duration}ms`);

      return {
        success: true,
        images: [{
          url: `data:image/png;base64,${imageBase64}`,
          width,
          height,
          seed: typeof params.seed === 'number' ? params.seed : Math.floor(Math.random() * 2147483647),
          metadata: {
            model: this.defaultModel,
            provider: this.id,
            steps: requestBody.num_steps,
            guidance: requestBody.guidance,
          },
        }],
        provider: this.id,
        model: this.defaultModel,
      };
    } catch (error) {
      if (error instanceof Error && (error as ImageGenerationError).type) {
        throw error;
      }

      if ((error as any).name === 'AbortError') {
        throw this.createError(
          'Image generation timed out',
          ErrorType.TIMEOUT,
          error instanceof Error ? error : new Error(String(error))
        );
      }

      throw this.createError(
        `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`,
        ErrorType.GENERATION_FAILED,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get provider-specific default parameters
   */
  getDefaultParams(): Partial<ImageGenerationParams> {
    return {
      steps: 4,
      guidance: 7.5,
      aspectRatio: '1:1',
    };
  }

  /**
   * Convert Blob to base64
   */
  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Remove data:image/png;base64, prefix if present
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Create a standardized error
   */
  private createError(
    message: string,
    type: ImageGenerationErrorType,
    originalError?: Error
  ): ImageGenerationError {
    const error = new Error(message) as ImageGenerationError;
    error.name = 'ImageGenerationError';
    (error as any).type = type;
    (error as any).provider = this.id;
    (error as any).originalError = originalError;
    return error;
  }
}
